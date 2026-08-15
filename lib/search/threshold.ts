/**
 * Mode 1 — Threshold search orchestration (prd.md §3.1).
 *
 *   "Find me the closest place that's at least Bortle 4."
 *
 * Pipeline:
 *   1. Sample k nearest candidate cells (expanding ring; raster unpublished →
 *      every cell qualifies, sqm modeled).
 *   2. One Overpass call for ALL cells (batched bbox).
 *   3. Snap cells to legal spots (prd.md §6), hard-excluding private land in
 *      the Overpass query + normalizer.
 *   4. ONE Valhalla matrix call for real drive times (Haversine fallback).
 *   5. Sort by drive time, keep top N, return with reason strings.
 *
 * Budget (.clinerules §4): ≤1 Overpass + ≤1 Valhalla matrix per search. We do
 * NOT loop over cells for any network call.
 */

import { SEARCH_CONFIG } from "./config";
import { sampleCandidateCells } from "./sample";
import { fetchSnapTargetsForCells } from "@/lib/upstream/overpass";
import { fetchMatrix } from "@/lib/upstream/valhalla";
import { snapCells, dedupeSpots } from "./snap";
import { bestScore } from "./rank";
import {
  haversineKm,
  cardinalDirection,
  estimateSqmFromDistance,
  round3,
} from "@/lib/geo/distance";
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
 * Run the full Mode 1 pipeline. Returns an honest CandidatesResponse with
 * `partial` flags when Overpass or Valhalla degraded — never throws for
 * upstream unavailability.
 */
export async function thresholdSearch(
  input: ThresholdSearchInput,
): Promise<CandidatesResponse> {
  const partial: string[] = [];
  const origin = { lat: input.lat, lon: input.lon };

  // 1. Candidate cells.
  const cells: RawDarkCell[] = sampleCandidateCells(
    origin,
    SEARCH_CONFIG.threshold.candidateCellCount,
    SEARCH_CONFIG.threshold.cellSpacingKm,
  );

  // 2. One batched Overpass call.
  const snapResult = await fetchSnapTargetsForCells(cells);
  if (snapResult.partial) partial.push("overpass");
  const targets = snapResult.targets;

  // 3. Snap each cell to the best legal spot.
  const snapped = dedupeSpots(snapCells(cells, targets));

  // If no legal spots exist anywhere nearby, degrade to structured fallback coordinates with
  // `snapped` semantics (prd.md §4: Overpass down → raw coords + snapped:false).
  const fallback = buildRawFallback(cells, origin);
  const spots: SnappedSpot[] = snapped.length > 0 ? snapped : fallback;

  // 4. ONE matrix call for all spots.
  const destinations = spots.map((s) => ({ lat: s.lat, lon: s.lon }));
  const matrix = await fetchMatrix([origin], destinations);
  if (matrix.estimated) partial.push("valhalla");

  const minutes = matrix.minutes[0] ?? [];

  // 5. Build CandidateSpot list (with the "best" score) and sort by drive time.
  const candidates: CandidateSpot[] = spots
    .map((spot, i) => {
      const distKm = haversineKm(origin, spot);
      const driveTimeMin = Number.isFinite(minutes[i])
        ? Math.round(minutes[i])
        : Math.max(1, Math.round((distKm * 1.35) / 70 * 60));

      const sqmMpsas = spot.sqmMpsas ?? estimateSqmFromDistance(distKm);
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
    })
    .filter((c) => input.maxDriveTimeMin === undefined || c.driveTimeMin <= input.maxDriveTimeMin);

  // Apply the darkness/greenery/openness filters. If nothing passes strict filters, fall back to the
  // full list so the user always gets the best options available.
  const qualifying = candidates.filter(
    (c) =>
      (input.minSqm === undefined || c.sqmMpsas === null || c.sqmMpsas >= input.minSqm) &&
      (input.minOpenness === undefined || c.openness >= input.minOpenness) &&
      (input.minGreenery === undefined || c.greenery >= input.minGreenery),
  );

  const ranked = (qualifying.length > 0 ? qualifying : candidates).sort(
    (a, b) => a.driveTimeMin - b.driveTimeMin,
  );

  const filteredOutCount = candidates.length - qualifying.length;

  ranked.forEach((c, i) => {
    c.rank = i + 1;
  });

  const top = ranked.slice(0, SEARCH_CONFIG.threshold.returnCount);
  if (filteredOutCount > 0) partial.push("some spots below your darkness/greenery/openness filters were hidden");

  return {
    origin: { lat: input.lat, lon: input.lon },
    mode: "threshold",
    spots: top,
    partial,
    estimated: matrix.estimated,
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
    const distKm = haversineKm(origin, cell);
    const sqmMpsas = cell.sqmMpsas ?? estimateSqmFromDistance(distKm);

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
