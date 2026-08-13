/**
 * POST /api/candidates
 *
 * Mode 1 Threshold Search (prd.md §3.1) + Mode 3 Time Budget (§3.3).
 *
 * Body (JSON):
 *   { lat, lon, mode: "threshold"|"timebudget", maxDriveTimeMin?, budgetMin? }
 *
 * Upside: a single search runs at most one Overpass call plus (threshold) one
 * Valhalla matrix call, or (timebudget) one Valhalla isochrone call. All
 * degradation is handled inside the search modules (.clinerules §4).
 *
 * Coordinates are rounded to 3 dp before any outbound call (privacy + cache).
 */

import { z } from "zod";
import { AppError } from "@/lib/errors";
import { ZodError } from "zod";
import { thresholdSearch } from "@/lib/search/threshold";
import { timeBudgetSearch } from "@/lib/search/timebudget";
import { round3 } from "@/lib/geo/distance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  mode: z.enum(["threshold", "timebudget"]).default("threshold"),
  /** Optional hard max drive time (threshold mode), minutes. */
  maxDriveTimeMin: z.number().positive().optional(),
  /** Required time budget for "timebudget" mode, minutes. */
  budgetMin: z.number().positive().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const raw: unknown = await request.json();
    const body = bodySchema.parse(raw);

    const lat = round3(body.lat);
    const lon = round3(body.lon);
    const nowMs = Date.now();

    if (body.mode === "timebudget") {
      const budgetMin = body.budgetMin ?? 45;
      const result = await timeBudgetSearch({ lat, lon, budgetMin, nowMs });
      // Return both candidates + isochrone in one payload so the map draws in a
      // single fetch (performance target §8.4, ≤5s).
      return Response.json(
        { candidates: result.candidates, isochrone: result.isochrone },
        { headers: cacheHeaders(86400) },
      );
    }

    const candidates = await thresholdSearch({
      lat,
      lon,
      maxDriveTimeMin: body.maxDriveTimeMin,
      nowMs,
    });
    return Response.json(candidates, { headers: cacheHeaders(3600) });
  } catch (error) {
    return errorResponse(error);
  }
}

function cacheHeaders(maxAgeSec: number): Record<string, string> {
  return {
    // The PRD assigns candidates 1h and isochrone 24h cache; quantized origins
    // make this a cache-hit AND privacy measure (.clinerules §4).
    "Cache-Control": `public, max-age=${maxAgeSec}, stale-while-revalidate=${
      maxAgeSec / 2
    }`,
  };
}

function errorResponse(error: unknown): Response {
  if (
    error instanceof ZodError ||
    (error instanceof AppError && error.code === "BAD_REQUEST")
  ) {
    return Response.json(
      { error: "Invalid search parameters." },
      { status: 400 },
    );
  }

  if (error instanceof AppError) {
    console.error(
      JSON.stringify({
        event: "candidates_error",
        code: error.code,
        cause: error.cause,
      }),
    );
    return Response.json(
      { error: "Search failed; results may be partial." },
      { status: 503 },
    );
  }

  console.error(
    JSON.stringify({
      event: "candidates_error",
      code: "UNKNOWN",
      cause: String(error),
    }),
  );
  return Response.json({ error: "Unexpected error searching." }, { status: 500 });
}