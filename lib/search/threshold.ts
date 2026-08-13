/**
 * Mode 1 — Threshold search orchestration (prd.md §3.1).
 *
 *   "Find me the closest place that's at least Bortle 4."
 *
 * Pipeline:
 *   1. Sample k nearest candidate cells (expanding ring; raster unpublished →
 *      every cell qualifies, sqm null).
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
import { haversineKm } from "@/lib/geo/distance";
import { buildDeepLinks } from "@/lib/geo/deep-links";
import type {
  CandidateSpot,
  CandidatesResponse,
  RawDarkCell,
} from "@/lib/types/places";

export interface ThresholdSearchInput {
  lat: number;
  lon: number;
  /** Optional hard max drive time, minutes. Omit for "nearest dark enough". */
  maxDriveTimeMin?: number;
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

  // 1. Candidate cells (raster unpublished → neutralize darkness honestly).
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

  // If no legal spots exist anywhere nearby, degrade to raw coordinates with
  // `snapped` semantics (prd.md §4: Overpass down → raw coords + snapped:false).
  // We represent that by producing raw-coordinate candidates built in place.
  const spots = snapped.length > 0 ? snapped : buildRawFallback(cells);

  // 4. ONE matrix call for all spots.
  const destinations = spots.map((s) => ({ lat: s.lat, lon: s.lon }));
  const matrix = await fetchMatrix([origin], destinations);
  if (matrix.estimated) partial.push("valhalla");

  const minutes = matrix.minutes[0] ?? [];

  // 5. Build CandidateSpot list and sort by drive time.
  const candidates: CandidateSpot[] = spots
    .map((spot, i) => {
      const driveTimeMin = Number.isFinite(minutes[i])
        ? Math.round(minutes[i])
        : Math.round(
            // Degenerate fallback for an unroutable pair → estimate from distance.
            // (fetchMatrix already supplies Haversine fallback on failure, but a
            // single null in an otherwise-good matrix is also possible.)
            (haversineKm(origin, spot) * 1.35) / 70 * 60,
          );

      const driveTimeEstimated = matrix.estimated || !Number.isFinite(minutes[i]);

      return {
        ...spot,
        driveTimeMin,
        driveTimeEstimated,
        distKmFromOrigin: Math.round(haversineKm(origin, spot) * 10) / 10,
        rank: 1,
      };
    })
    .filter((c) => input.maxDriveTimeMin === undefined || c.driveTimeMin <= input.maxDriveTimeMin)
    .sort((a, b) => a.driveTimeMin - b.driveTimeMin);

  // Assign 1-based ranks after sorting.
  candidates.forEach((c, i) => {
    c.rank = i + 1;
  });

  const top = candidates.slice(0, SEARCH_CONFIG.threshold.returnCount);

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
function buildRawFallback(cells: readonly RawDarkCell[]) {
  return cells.map((cell) => ({
    osmId: `raw/${cell.lat},${cell.lon}`,
    lat: cell.lat,
    lon: cell.lon,
    name: `Dark site near ${cell.lat.toFixed(2)}°, ${cell.lon.toFixed(2)}° (raw)`,
    type: "other" as const,
    accessConfidence: "verify-access" as const,
    parkingQuality: 0,
    openness: 0.5,
    rawCellLat: cell.lat,
    rawCellLon: cell.lon,
    distKmFromCell: 0,
    snapScore: 0,
    deepLinks: buildDeepLinks(cell.lat, cell.lon),
  }));
}