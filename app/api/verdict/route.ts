/**
 * GET /api/verdict?lat=40.7&lon=-74.0[&slat=...&slon=...][&sqmHome=21.0][&sqmSite=21.5][&driveMin=45][&distKm=60][&fuelPrice=1.50][&departMs=...][&bedMs=...][&now=...]
 *
 * Mode 2 verdict — the home-screen card. When only `lat`/`lon` are provided
 * (no site coords, no dark SQM), the response renders "UNKNOWN" with live
 * cloud/moon/transparency chips. As the darkness raster (Phase 0) comes online,
 * supplying `sqmHome`/`sqmSite` enables the full GO/MAYBE/STAY HOME pipeline.
 *
 * Two batched upstream calls total (home + site fetched together in one
 * forecast + one AQ call). No per-point loop .clinerules §4.
 */

import type { VerdictResponse } from "@/lib/types/verdict";
import { fetchConditionsForPoints } from "@/lib/upstream/conditions";
import { composeVerdict } from "@/lib/scoring/compose-verdict";
import {
  parsePoints,
  parseNowMs,
  parseOptionalNumber,
  parseOptionalNullableNumber,
  AppError,
} from "@/lib/http/query";
import { ZodError } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hardcoded defaults for Phase 1 where the user hasn't configured them yet. */
const FALLBACK_DRIVE_MIN = 0;
const FALLBACK_DIST_KM = 0;
const FALLBACK_FUEL_PRICE = 1.5;
const MS_PER_MIN = 60_000;

export async function GET(request: Request): Promise<Response> {
  try {
    const url = request.url;
    const points = parsePoints(url, { requiredPoints: 1 });
    const { lat: homeLat, lon: homeLon } = points[0];

    // Optional site coordinates (second point).
    const sitePoints = (() => {
      const sp = new URL(url).searchParams;
      const slat = sp.get("slat");
      const slon = sp.get("slon");
      if (slat && slon) {
        return [{ lat: Number(slat), lon: Number(slon) }];
      }
      return [];
    })();

    const sqmHome = parseOptionalNullableNumber(url, "sqmHome");
    const sqmSite = parseOptionalNullableNumber(url, "sqmSite");
    const driveMin = parseOptionalNumber(url, "driveMin", FALLBACK_DRIVE_MIN);
    const distKm = parseOptionalNumber(url, "distKm", FALLBACK_DIST_KM);
    const fuelPrice = parseOptionalNumber(url, "fuelPrice", FALLBACK_FUEL_PRICE);
    const nowMs = parseNowMs(url);

    // Departure and bedtime: default to "now" and "now + 8 hours" if unset.
    const departMs = parseOptionalNumber(url, "departMs", nowMs);
    const bedMs = parseOptionalNumber(
      url,
      "bedMs",
      nowMs + 8 * 60 * MS_PER_MIN,
    );

    // Fetch conditions for home + optional site in ONE forecast + ONE AQ call.
    const batchPoints = [{ lat: homeLat, lon: homeLon }, ...sitePoints];
    const { points: conditions, partial: condPartial } =
      await fetchConditionsForPoints(batchPoints, nowMs);

    const home = conditions[0];
    const site = sitePoints.length > 0 ? conditions[1] : null;

    const verdict = composeVerdict({
      home,
      site,
      sqmHome,
      sqmSite,
      driveTimeMin: driveMin,
      distKm,
      fuelPricePerLitre: fuelPrice,
      earliestDepartureMs: departMs,
      bedtimeMs: bedMs,
    });

    const body: VerdictResponse = {
      ...verdict,
      partial: [...verdict.partial, ...condPartial],
    };

    return Response.json(body, {
      headers: {
        // 15-minute verdict cache, per .clinerules §4.
        "Cache-Control": "public, max-age=900, stale-while-revalidate=300",
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
      { error: "Invalid request parameters." },
      { status: 400 },
    );
  }

  if (error instanceof AppError) {
    console.error(
      JSON.stringify({
        event: "verdict_error",
        code: error.code,
        cause: error.cause,
      }),
    );
    return Response.json(
      { error: "Could not compute verdict; results may be partial." },
      { status: 503 },
    );
  }

  console.error(
    JSON.stringify({
      event: "verdict_error",
      code: "UNKNOWN",
      cause: String(error),
    }),
  );
  return Response.json(
    { error: "Unexpected error computing verdict." },
    { status: 500 },
  );
}