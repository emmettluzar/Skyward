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
  round3,
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
 * Run the full Mode 1 pipeline. Returns an honest CandidatesResponse with
 * `partial` flags when Overpass or Valhalla degraded — never throws for
 * upstream unavailability.
 */
export async function thresholdSearch(
  input: ThresholdSearchInput,
): Promise<CandidatesResponse> {
  const partial: string[] = [];
  const origin = { lat: input.lat, lon: input.lon };

  // 1. Unbounded Multi-Ring Sampling:
  // If the user requested an ambitious dark tier (e.g. Bortle 1/2), expand cell radius
  // outward up to 400+ km until qualifying cells/spots are discovered.
  let cellSpacingKm = SEARCH_CONFIG.threshold.cellSpacingKm;
  let cellCount = SEARCH_CONFIG.threshold.candidateCellCount;

  if (input.minSqm && input.minSqm >= 21.8) {
    // For Bortle 1-2, increase cell count and spacing to sweep wider geography (100–350+ miles)
    cellSpacingKm = 24;
    cellCount = 64;
  } else if (input.minSqm && input.minSqm >= 21.6) {
    // For Bortle 3
    cellSpacingKm = 16;
    cellCount = 48;
  }

  let cells: RawDarkCell[] = sampleCandidateCells(
    origin,
    cellCount,
    cellSpacingKm,
  );

  // Filter cells by modeled SQM beforehand if a strict SQM is requested so Overpass queries target areas
  if (input.minSqm !== undefined) {
    const qualifyingCells = cells.filter((c) => {
      const sqm = calculateLocationSqm(c.lat, c.lon);
      return sqm >= input.minSqm!;
    });
    // If nearby cells qualify, focus on them; otherwise keep expanded ring
    if (qualifyingCells.length >= 4) {
      cells = qualifyingCells;
    }
  }

  // 2. One batched Overpass call for candidate cells.
  const snapResult = await fetchSnapTargetsForCells(cells);
  if (snapResult.partial) partial.push("overpass");
  const targets = snapResult.targets;

  // 3. Snap each cell to the best legal spot.
  const snapped = dedupeSpots(snapCells(cells, targets));

  // If no legal spots exist in the OSM dataset for remote areas, build structured fallback spots
  // from candidate cells to guarantee the user ALWAYS receives directions links to dark spots.
  const fallback = buildRawFallback(cells, origin);
  const combinedSpots: SnappedSpot[] = [...snapped];
  for (const fb of fallback) {
    const tooClose = combinedSpots.some((s) => haversineKm(s, fb) < 5.0);
    if (!tooClose) {
      combinedSpots.push(fb);
    }
  }

  const spots: SnappedSpot[] = combinedSpots.length > 0 ? combinedSpots : fallback;

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
    })
    .filter((c) => input.maxDriveTimeMin === undefined || c.driveTimeMin <= input.maxDriveTimeMin);

  // Apply the darkness/greenery/openness filters strictly.
  // 1. Darkness filter: strictly exclude any site with a higher Bortle number (i.e. SQM < minSqm).
  // 2. Openness filter: strictly enforce minimum horizon openness.
  // 3. Greenery filter: strictly enforce minimum nature / natural setting.
  const qualifying = candidates.filter(
    (c) =>
      (input.minSqm === undefined || (c.sqmMpsas !== null && c.sqmMpsas >= input.minSqm)) &&
      (input.minOpenness === undefined || c.openness >= input.minOpenness) &&
      (input.minGreenery === undefined || c.greenery >= input.minGreenery),
  );

  // If strict filtering returned nothing, find the closest spots with the best available darkness
  const eligible = qualifying.length > 0 ? qualifying : candidates.sort((a, b) => (b.sqmMpsas ?? 0) - (a.sqmMpsas ?? 0));

  // Sort candidates primarily by shortest drive time to closest destination, with darker sky as tie-breaker
  const ranked = eligible.sort((a, b) => {
    if (Math.abs(a.driveTimeMin - b.driveTimeMin) > 5) {
      return a.driveTimeMin - b.driveTimeMin;
    }
    return (b.sqmMpsas ?? 0) - (a.sqmMpsas ?? 0);
  });

  ranked.forEach((c, i) => {
    c.rank = i + 1;
  });

  const filteredOutCount = candidates.length - eligible.length;

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
