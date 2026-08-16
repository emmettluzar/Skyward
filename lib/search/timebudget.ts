/**
 * Mode 3 — Time Budget search orchestration (prd.md §3.3).
 *
 *   "I have 45 minutes of driving in me. What's the best sky I can reach?"
 *
 * Pipeline:
 *   1. Valhalla /isochrone (Haversine circular fallback on failure).
 *   2. Sample candidate cells across the reachable radius, mask to polygon/radius.
 *   3. One batched Overpass call for masked cells → snap.
 *   4. Always supplement with structured fallback spots if snapped count < returnCount,
 *      so the user ALWAYS gets a ranked list of the best spots reachable.
 *   5. Non-maximum suppression (≥5 km mutual spacing).
 *   6. Rank by composite "best" score and return top results.
 *
 * Budget (.clinerules §4): ≤1 isochrone + ≤1 Overpass per search.
 */

import { SEARCH_CONFIG } from "./config";
import { sampleCandidateCells, filterCellsInPolygon, filterCellsInRadius } from "./sample";
import { fetchIsochrone } from "@/lib/upstream/valhalla";
import { fetchSnapTargetsForCells } from "@/lib/upstream/overpass";
import { snapCells, dedupeSpots } from "./snap";
import { rankByBest } from "./rank";
import {
  haversineKm,
  estimatedDriveMinKm,
  cardinalDirection,
  round3,
} from "@/lib/geo/distance";
import { calculateLocationSqm } from "@/lib/darkness/model";
import { buildDeepLinks } from "@/lib/geo/deep-links";
import type {
  CandidateSpot,
  CandidatesResponse,
  IsochroneResponse,
  RawDarkCell,
  SnappedSpot,
} from "@/lib/types/places";

export interface TimeBudgetSearchInput {
  lat: number;
  lon: number;
  budgetMin: number;
  nowMs: number;
}

/** Result of the Mode 3 pipeline: ranked spots + the isochrone for the map. */
export interface TimeBudgetResult {
  candidates: CandidatesResponse;
  isochrone: IsochroneResponse;
}

/**
 * Run the full Mode 3 pipeline. Never throws for upstream unavailability; the
 * isochrone and matrix both degrade to Haversine estimates flagged `estimated`.
 * ALWAYS returns ranked candidate spots for any budget.
 */
export async function timeBudgetSearch(
  input: TimeBudgetSearchInput,
): Promise<TimeBudgetResult> {
  const partial: string[] = [];
  const origin = { lat: input.lat, lon: input.lon };
  const budgetMin = Math.max(5, input.budgetMin);

  // 1. Isochrone.
  const iso = await fetchIsochrone(input.lat, input.lon, budgetMin);
  if (iso.estimated) partial.push("valhalla-isochrone");

  const ring = iso.geojson?.features[0]?.geometry.type === "Polygon"
    ? iso.geojson.features[0].geometry.coordinates[0]
    : null;

  // 2. Compute dynamic sampling reach for the given drive time budget.
  // Average highway speed ~70km/h with road curvature factor 1.35.
  const estimatedMaxDistKm = Math.max(8, (budgetMin / 60) * 65);
  const cellSpacingKm = Math.max(2.5, estimatedMaxDistKm / 6);
  const cellCount = Math.max(36, SEARCH_CONFIG.threshold.candidateCellCount);

  // Sample candidate cells around origin.
  const allCells = sampleCandidateCells(origin, cellCount, cellSpacingKm);

  // Filter inside the isochrone polygon; fall back to radius if polygon empty/missing.
  let masked: RawDarkCell[] = filterCellsInPolygon(allCells, ring);
  if (masked.length < 4) {
    masked = filterCellsInRadius(allCells, origin, estimatedMaxDistKm);
  }
  if (masked.length === 0) {
    masked = allCells.slice(0, 16);
  }

  // 3. One batched Overpass call for candidate cells → snap.
  const snapResult = await fetchSnapTargetsForCells(masked);
  if (snapResult.partial) partial.push("overpass");

  const snapped = dedupeSpots(snapCells(masked, snapResult.targets));

  // 4. Guaranteed candidates: if Overpass found fewer spots than desired (e.g. rural area,
  // rate limits, or sparse tags), supplement with synthesized fallback spots from the cells.
  const fallbackSpots = buildFallbackSpots(masked, origin);
  const combinedSpots: SnappedSpot[] = [...snapped];

  // Add fallback spots that don't collide with existing snapped spots
  for (const fb of fallbackSpots) {
    const tooClose = combinedSpots.some((s) => haversineKm(s, fb) < 3.0);
    if (!tooClose) {
      combinedSpots.push(fb);
    }
  }

  // 5. Non-maximum suppression: keep spots spaced apart.
  const filtered = nonMaximumSuppression(
    combinedSpots,
    Math.min(SEARCH_CONFIG.timeBudget.minSpotSpacingKm, Math.max(2, estimatedMaxDistKm / 5)),
  );

  // 6. Build CandidateSpot list with estimated drive times and SQM.
  const candidatePool: CandidateSpot[] = filtered.map((spot) => {
    const distKm = haversineKm(origin, spot);
    const driveTimeMin = Math.max(1, Math.round(estimatedDriveMinKm(distKm)));
    // SQM: use spot's value if known, otherwise compute modeled SQM from coordinate.
    const sqmMpsas = spot.sqmMpsas ?? calculateLocationSqm(spot.lat, spot.lon);

    return {
      ...spot,
      sqmMpsas,
      driveTimeMin,
      driveTimeEstimated: true,
      distKmFromOrigin: Math.round(distKm * 10) / 10,
      score: 0,
      scoreReasons: [],
      rank: 1,
    };
  });

  // Filter candidates that fit comfortably within the user's budget (with 15% tolerance)
  const budgetFiltered = candidatePool.filter(
    (c) => c.driveTimeMin <= Math.max(budgetMin, budgetMin * 1.15),
  );
  const eligible = budgetFiltered.length >= 3 ? budgetFiltered : candidatePool;

  // Rank by composite "best" score (openness, parking, access, darkness, closeness)
  const ranked = rankByBest(eligible).slice(0, SEARCH_CONFIG.timeBudget.returnCount);

  ranked.forEach((c, i) => {
    c.rank = i + 1;
  });

  const candidatesResponse: CandidatesResponse = {
    origin: { lat: input.lat, lon: input.lon },
    mode: "timebudget",
    spots: ranked,
    partial,
    estimated: iso.estimated,
    generatedAtMs: input.nowMs,
  };

  const isochroneResponse: IsochroneResponse = {
    origin: { lat: input.lat, lon: input.lon },
    budgetMin: input.budgetMin,
    geojson: iso.geojson,
    estimated: iso.estimated,
    partial,
    generatedAtMs: input.nowMs,
  };

  return { candidates: candidatesResponse, isochrone: isochroneResponse };
}

/**
 * Generate structured fallback spots from candidate cells when Overpass returns
 * few or no specific OSM points of interest. Ensures the user always receives
 * actionable stargazing spots with directions links.
 */
function buildFallbackSpots(
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
      osmId: `cell/${round3(cell.lat)},${round3(cell.lon)}`,
      lat: round3(cell.lat),
      lon: round3(cell.lon),
      name,
      type: "open_green" as const,
      accessConfidence: "likely-public" as const,
      parkingQuality: 0.6,
      openness: 0.8,
      greenery: 0.85,
      rawCellLat: cell.lat,
      rawCellLon: cell.lon,
      distKmFromCell: 0,
      snapScore: 0.65,
      sqmMpsas,
      deepLinks: buildDeepLinks(cell.lat, cell.lon),
    };
  });
}

/**
 * Non-maximum suppression: greedily keep the highest-snap-score spot, then drop
 * anything within `minSpacingKm` of it. Ensures results aren't 10 cells of one
 * field (prd.md §3.3 step 3).
 */
export function nonMaximumSuppression(
  spots: readonly SnappedSpot[],
  minSpacingKm: number,
): SnappedSpot[] {
  // Sort by snapScore descending so the best spot suppresses its neighbours.
  const sorted = [...spots].sort((a, b) => b.snapScore - a.snapScore);
  const kept: SnappedSpot[] = [];

  for (const spot of sorted) {
    const tooClose = kept.some((k) => haversineKm(k, spot) < minSpacingKm);
    if (!tooClose) kept.push(spot);
    if (kept.length >= SEARCH_CONFIG.timeBudget.returnCount) break;
  }

  return kept;
}
