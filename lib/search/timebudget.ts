/**
 * Mode 3 — Time Budget search orchestration (prd.md §3.3).
 *
 *   "I have 45 minutes of driving in me. What's the best sky I can reach?"
 *
 * Pipeline:
 *   1. Valhalla /isochrone (Haversine circular fallback on failure).
 *   2. Sample candidate cells, mask to the isochrone polygon.
 *   3. One batched Overpass call for masked cells → snap.
 *   4. Non-maximum suppression (≥5 km mutual spacing).
 *   5. Rank by drive time (budget already constrains it).
 *
 * Budget (.clinerules §4): ≤1 isochrone + ≤1 Overpass per search.
 */

import { SEARCH_CONFIG } from "./config";
import { sampleCandidateCells, filterCellsInPolygon } from "./sample";
import { fetchIsochrone } from "@/lib/upstream/valhalla";
import { fetchSnapTargetsForCells } from "@/lib/upstream/overpass";
import { snapCells, dedupeSpots } from "./snap";
import { rankByBest } from "./rank";
import { haversineKm, estimatedDriveMinKm } from "@/lib/geo/distance";
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
 */
export async function timeBudgetSearch(
  input: TimeBudgetSearchInput,
): Promise<TimeBudgetResult> {
  const partial: string[] = [];
  const origin = { lat: input.lat, lon: input.lon };

  // 1. Isochrone.
  const iso = await fetchIsochrone(input.lat, input.lon, input.budgetMin);
  if (iso.estimated) partial.push("valhalla-isochrone");

  const ring = iso.geojson?.features[0]?.geometry.type === "Polygon"
    ? iso.geojson.features[0].geometry.coordinates[0]
    : null;

  // 2. Sample cells around the origin and mask to the polygon.
  const cells = sampleCandidateCells(
    origin,
    SEARCH_CONFIG.threshold.candidateCellCount,
    SEARCH_CONFIG.threshold.cellSpacingKm,
  );
  const masked: RawDarkCell[] = filterCellsInPolygon(cells, ring);

  // 3. One batched Overpass call for masked cells → snap.
  const snapResult = await fetchSnapTargetsForCells(masked);
  if (snapResult.partial) partial.push("overpass");

  const snapped = dedupeSpots(snapCells(masked, snapResult.targets));

  // 4. Non-maximum suppression: keep spots ≥ minSpotSpacingKm apart.
  const filtered = nonMaximumSuppression(
    snapped,
    SEARCH_CONFIG.timeBudget.minSpotSpacingKm,
  );

  // 5. Build ranked candidates; drive time is already constrained by the
  //    budget, so a per-spot matrix call is unnecessary here. We estimate drive
  //    time via Haversine (correct for display; the polygon enforces the budget).
  // A per-spot matrix is unnecessary here: the isochrone already enforces the
  // drive-time budget, so we estimate drive time for display only and rank by
  // "best" (the composite score), not simply by which field is nearest.
  const candidates: CandidateSpot[] = rankByBest(
    filtered.map((spot) => {
      const distKm = haversineKm(origin, spot);
      return {
        ...spot,
        driveTimeMin: Math.round(estimatedDriveMinKm(distKm)),
        driveTimeEstimated: true,
        distKmFromOrigin: Math.round(distKm * 10) / 10,
        score: 0,
        scoreReasons: [],
        rank: 1,
      };
    }),
  ).slice(0, SEARCH_CONFIG.timeBudget.returnCount);

  candidates.forEach((c, i) => {
    c.rank = i + 1;
  });

  const candidatesResponse: CandidatesResponse = {
    origin: { lat: input.lat, lon: input.lon },
    mode: "timebudget",
    spots: candidates,
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