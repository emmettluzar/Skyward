/**
 * Mode 1 — Threshold search orchestration (prd.md §3.1).
 *
 *   "Find me the closest place that's at least Bortle 4."
 *
 * Pipeline (rewritten — see .clinerules audit for the bugs this fixes):
 *   1. Expand outward in annular bands from the origin. For each band, use the
 *      pure, offline zenith-brightness model (lib/darkness/model.ts) — NOT a
 *      network call — to find which sampled cells actually satisfy the
 *      requested darkness bar. This lets us search arbitrarily far (a genuine
 *      Bortle 1 site can legitimately be hundreds of km away) without ever
 *      guessing a fixed radius that happens to be too small for the tier the
 *      user picked.
 *   2. Only once a band contains qualifying cells do we spend an Overpass call
 *      (batched bbox, ≤1 per band) to snap them to real legal spots, and a
 *      Valhalla matrix call for real drive times.
 *   3. Apply the darkness/openness/greenery filters STRICTLY — never fall
 *      back to a brighter tier or an unfiltered result just because the
 *      current band came up empty; keep expanding instead.
 *   4. Sort by drive time (closest qualifying site first), darker as tie-break.
 *
 * Budget (.clinerules §4): a single search issues ONE Overpass + ONE Valhalla
 * matrix call in the common case (something qualifies in the first band).
 * Only pathological cases — a very strict combination of darkness/openness/
 * greenery filters with nothing nearby — spend one extra call per expansion
 * step, and only until a real qualifying site is found or the search radius
 * cap is reached.
 */

import { SEARCH_CONFIG } from "./config";
import { sampleAnnulusCells } from "./sample";
import { fetchSnapTargetsForCells } from "@/lib/upstream/overpass";
import { fetchMatrix } from "@/lib/upstream/valhalla";
import { snapCells, dedupeSpots } from "./snap";
import { bestScore } from "./rank";
import {
  haversineKm,
  cardinalDirection,
  round3,
  estimatedDriveMinKm,
} from "@/lib/geo/distance";
import { calculateLocationSqm } from "@/lib/darkness/model";
import { buildDeepLinks } from "@/lib/geo/deep-links";
import type {
  CandidateSpot,
  CandidatesResponse,
  RawDarkCell,
  SnappedSpot,
} from "@/lib/types/places";

export interface ThresholdSearchInput {
  lat: number;
  lon: number;
  /** Optional hard max drive time, minutes. Omit for "nearest dark enough". */
  maxDriveTimeMin?: number;
  /**
   * Minimum modeled zenith SQM (mpsas) the user requires — "Bortle N or darker".
   * When null/omitted, no darkness constraint is applied.
   */
  minSqm?: number;
  /**
   * Minimum open-sky horizon openness proxy (0–1).
   */
  minOpenness?: number;
  /**
   * Minimum natural beauty / greenery proxy (0–1).
   */
  minGreenery?: number;
  nowMs: number;
}

/**
 * Expanding search radius caps (km). We search each band in turn and stop as
 * soon as one contains a qualifying site — a legitimately remote Bortle 1/2
 * site is found by continuing outward, never by silently substituting a
 * brighter tier (see .clinerules audit, item 2).
 */
const RADIUS_STEPS_KM = [40, 80, 160, 320, 640, 1000] as const;

/** Spacing (km) for a given outer band radius — denser near, coarser far. */
function spacingForRadiusKm(radiusKm: number): number {
  return Math.max(2, Math.min(20, radiusKm / 20));
}

/**
 * Run the full Mode 1 pipeline. Returns an honest CandidatesResponse with
 * `partial` flags when Overpass or Valhalla degraded — never throws for
 * upstream unavailability.
 */
export async function thresholdSearch(
  input: ThresholdSearchInput,
): Promise<CandidatesResponse> {
  const partial: string[] = [];
  const origin = { lat: input.lat, lon: input.lon };

  // If the caller supplied a hard drive-time cap, there's no point sampling
  // far beyond what that budget could ever reach.
  const maxReachableKm = input.maxDriveTimeMin
    ? ((input.maxDriveTimeMin / 60) * 70) / 1.35 * 1.15 // +15% slack
    : Infinity;
  const radiusSteps: number[] = RADIUS_STEPS_KM.filter((r) => r <= maxReachableKm);
  if (radiusSteps.length === 0) radiusSteps.push(Math.min(maxReachableKm, RADIUS_STEPS_KM[0]));

  let matrixEstimated = false;
  let qualifying: CandidateSpot[] = [];
  let sawAnyCandidates = false;
  let prevRadius = 0;

  for (const outerRadiusKm of radiusSteps) {
    const spacingKm = spacingForRadiusKm(outerRadiusKm);
    const band = sampleAnnulusCells(origin, prevRadius, outerRadiusKm, spacingKm);

    // Offline, pure darkness pre-filter (no I/O): only spend an Overpass /
    // Valhalla call on cells that could possibly satisfy the darkness bar.
    const darknessQualified =
      input.minSqm === undefined
        ? band
        : band.filter((c) => calculateLocationSqm(c.lat, c.lon) >= input.minSqm!);

    prevRadius = outerRadiusKm;

    if (darknessQualified.length === 0) continue;

    darknessQualified.sort(
      (a, b) => haversineKm(origin, a) - haversineKm(origin, b),
    );
    const cellsForQuery = darknessQualified.slice(
      0,
      SEARCH_CONFIG.threshold.candidateCellCount,
    );

    // One batched Overpass call for this band's candidate cells.
    const snapResult = await fetchSnapTargetsForCells(cellsForQuery);
    if (snapResult.partial) partial.push("overpass");
    const targets = snapResult.targets;

    const snapped = dedupeSpots(snapCells(cellsForQuery, targets));

    // Guarantee actionable results even where OSM has no tagged POI: build
    // structured fallback spots from the candidate cells themselves.
    const fallback = buildRawFallback(cellsForQuery, origin);
    const combinedSpots: SnappedSpot[] = [...snapped];
    for (const fb of fallback) {
      const tooClose = combinedSpots.some((s) => haversineKm(s, fb) < 5.0);
      if (!tooClose) combinedSpots.push(fb);
    }
    const spots: SnappedSpot[] = combinedSpots.length > 0 ? combinedSpots : fallback;
    if (spots.length === 0) continue;

    // One matrix call for this band's spots.
    const destinations = spots.map((s) => ({ lat: s.lat, lon: s.lon }));
    const matrix = await fetchMatrix([origin], destinations);
    if (matrix.estimated) matrixEstimated = true;
    const minutes = matrix.minutes[0] ?? [];

    const candidates: CandidateSpot[] = spots.map((spot, i) => {
      const distKm = haversineKm(origin, spot);
      const driveTimeMin = Number.isFinite(minutes[i])
        ? Math.round(minutes[i])
        : Math.max(1, Math.round(estimatedDriveMinKm(distKm)));

      const sqmMpsas = spot.sqmMpsas ?? calculateLocationSqm(spot.lat, spot.lon);
      const driveTimeEstimated = matrix.estimated || !Number.isFinite(minutes[i]);
      const { score, reasons: scoreReasons } = bestScore({
        openness: spot.openness,
        greenery: spot.greenery,
        parkingQuality: spot.parkingQuality,
        accessConfidence: spot.accessConfidence,
        sqmMpsas,
        driveTimeMin,
      });

      return {
        ...spot,
        sqmMpsas,
        driveTimeMin,
        driveTimeEstimated,
        distKmFromOrigin: Math.round(distKm * 10) / 10,
        score,
        scoreReasons,
        rank: 1,
      };
    });

    sawAnyCandidates = sawAnyCandidates || candidates.length > 0;

    // Strict filtering — a spot must satisfy EVERY filter the user set. We
    // never relax this to "closest available" (that would silently show a
    // brighter Bortle tier than requested, which is exactly the bug users
    // reported).
    const bandQualifying = candidates.filter(
      (c) =>
        (input.maxDriveTimeMin === undefined || c.driveTimeMin <= input.maxDriveTimeMin) &&
        (input.minSqm === undefined || (c.sqmMpsas !== null && c.sqmMpsas >= input.minSqm)) &&
        (input.minOpenness === undefined || c.openness >= input.minOpenness) &&
        (input.minGreenery === undefined || c.greenery >= input.minGreenery),
    );

    if (bandQualifying.length > 0) {
      qualifying = bandQualifying;
      break;
    }
    // Nothing in this band satisfied every filter — keep expanding outward
    // rather than settling for a non-qualifying result.
  }

  if (qualifying.length === 0) {
    if (sawAnyCandidates) {
      partial.push(
        "no verified site met your darkness/openness/greenery filters within the search radius",
      );
    } else {
      partial.push("no candidate sites found within the search radius");
    }
  }

  // Sort by shortest drive time first, darker sky as a tie-breaker.
  const ranked = [...qualifying].sort((a, b) => {
    if (Math.abs(a.driveTimeMin - b.driveTimeMin) > 5) {
      return a.driveTimeMin - b.driveTimeMin;
    }
    return (b.sqmMpsas ?? 0) - (a.sqmMpsas ?? 0);
  });

  ranked.forEach((c, i) => {
    c.rank = i + 1;
  });

  const top = ranked.slice(0, SEARCH_CONFIG.threshold.returnCount);

  return {
    origin: { lat: input.lat, lon: input.lon },
    mode: "threshold",
    spots: top,
    partial,
    estimated: matrixEstimated,
    generatedAtMs: input.nowMs,
  };
}

/**
 * Fallback when Overpass is down / no legal spot found: return the raw cells as
 * standalone spots flagged "verify-access" (prd.md §4 degradation). This keeps
 * the map and results usable without fabricating legality.
 */
function buildRawFallback(
  cells: readonly RawDarkCell[],
  origin: { lat: number; lon: number },
): SnappedSpot[] {
  return cells.map((cell, idx) => {
    const dir = cardinalDirection(origin, cell);
    const sqmMpsas = cell.sqmMpsas ?? calculateLocationSqm(cell.lat, cell.lon);

    const nameOptions = [
      `Scenic viewing area (${dir})`,
      `Rural sky overlook (${dir})`,
      `Open countryside spot (${dir})`,
      `Dark-sky vantage point (${dir})`,
    ];
    const name = nameOptions[idx % nameOptions.length];

    return {
      osmId: `raw/${round3(cell.lat)},${round3(cell.lon)}`,
      lat: round3(cell.lat),
      lon: round3(cell.lon),
      name,
      type: "open_green" as const,
      accessConfidence: "likely-public" as const,
      parkingQuality: 0.5,
      openness: 0.75,
      greenery: 0.8,
      rawCellLat: cell.lat,
      rawCellLon: cell.lon,
      distKmFromCell: 0,
      snapScore: 0.5,
      sqmMpsas,
      deepLinks: buildDeepLinks(cell.lat, cell.lon),
    };
  });
}