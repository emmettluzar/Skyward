/**
 * GET /api/isochrone?lat=40.7&lon=-74.0&minutes=45
 *
 * Valhalla isochrone proxy (prd.md §8.3, §3.3). Returns a GeoJSON feature
 * collection; degrades to a circular Haversine approximation on Valhalla
 * failure, marked `estimated: true` (.clinerules §4).
 *
 * Standalone route for the map (Mode 3 draws the polygon without needing the
 * full candidate pipeline). The full Mode 3 pipeline (spots + polygon) lives on
 * POST /api/candidates with mode=timebudget.
 */

import { z } from "zod";
import { AppError } from "@/lib/errors";
import { ZodError } from "zod";
import { fetchIsochrone } from "@/lib/upstream/valhalla";
import { round3 } from "@/lib/geo/distance";
import type { IsochroneResponse } from "@/lib/types/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);

    const lat = z.coerce.number().min(-90).max(90).parse(searchParams.get("lat"));
    const lon = z.coerce.number().min(-180).max(180).parse(searchParams.get("lon"));
    const minutes = z.coerce.number().int().positive().max(300).parse(
      searchParams.get("minutes") ?? "45",
    );

    const iso = await fetchIsochrone(round3(lat), round3(lon), minutes);

    const body: IsochroneResponse = {
      origin: { lat: round3(lat), lon: round3(lon) },
      budgetMin: minutes,
      geojson: iso.geojson,
      estimated: iso.estimated,
      partial: iso.estimated ? ["valhalla-isochrone"] : [],
      generatedAtMs: Date.now(),
    };

    return Response.json(body, {
      headers: {
        // 24-hour isochrone cache (prd.md §8.3) keyed to quantized origin.
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=43200",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): Response {
  if (
    error instanceof ZodError ||
    (error instanceof AppError && error.code === "BAD_REQUEST")
  ) {
    return Response.json(
      { error: "Invalid isochrone parameters." },
      { status: 400 },
    );
  }

  console.error(
    JSON.stringify({
      event: "isochrone_error",
      code: error instanceof AppError ? error.code : "UNKNOWN",
      cause: error instanceof AppError ? error.cause : String(error),
    }),
  );
  return Response.json({ error: "Could not compute isochrone." }, { status: 502 });
}