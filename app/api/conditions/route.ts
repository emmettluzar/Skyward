/**
 * GET /api/conditions?lat=40.7&lon=-74.0[&now=...]
 *
 * Tonight panel data (13 hourly columns) for one or more coordinates. Two
 * batched upstream calls total regardless of point count (.clinerules §4).
 * Coordinates are rounded to 3 dp before any outbound call (privacy + cache).
 *
 * Response is `ConditionsResponse` (see lib/types/conditions.ts), with partial
 * columns as null and the `partial` list recording any degraded channels.
 */

import type { ConditionsResponse } from "@/lib/types/conditions";
import { fetchConditionsForPoints } from "@/lib/upstream/conditions";
import { parsePoints, parseNowMs, AppError } from "@/lib/http/query";
import { ZodError } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const points = parsePoints(request.url, { requiredPoints: "many" });
    const nowMs = parseNowMs(request.url);

    const { points: data, partial } = await fetchConditionsForPoints(
      points,
      nowMs,
    );

    const body: ConditionsResponse = {
      points: data,
      generatedAtMs: nowMs,
      partial,
      estimated: false,
    };

    return Response.json(body, {
      headers: {
        // 20-minute conditions cache, per .clinerules §4.
        "Cache-Control": "public, max-age=1200, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof ZodError || (error instanceof AppError && error.code === "BAD_REQUEST")) {
    return Response.json(
      { error: "Invalid request parameters." },
      { status: 400 },
    );
  }

  if (error instanceof AppError) {
    // Upstream failures are degraded inside fetchConditionsForPoints; a thrown
    // AppError here is an unexpected infrastructure failure.
    console.error(JSON.stringify({ event: "conditions_error", code: error.code, cause: error.cause }));
    return Response.json(
      { error: "Could not load conditions; results may be partial." },
      { status: 503 },
    );
  }

  console.error(JSON.stringify({ event: "conditions_error", code: "UNKNOWN", cause: String(error) }));
  return Response.json(
    { error: "Unexpected error loading conditions." },
    { status: 500 },
  );
}