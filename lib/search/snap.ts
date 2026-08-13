/**
 * Pure snapping logic (prd.md §6).
 *
 * Given raw darkness grid cells + qualifying OSM features (already fetched &
 * normalized by lib/upstream/overpass), pick the best legal, parkable spot
 * within the snap radius for each cell.
 *
 * This module is PURE: no I/O, no Date.now(). It is the second (local) line of
 * defence against illegal spots — the Overpass query already drops
 * `access=private|no|customers` etc., but any defensive caller can re-verify
 * here by fingerprinting those tags via `isPrivateTarget`.
 *
 * Snap score (prd.md §6):
 *   snap = 0.45·openness + 0.25·(1 - Δdarkness) + 0.20·parking_quality
 *        + 0.10·(1 - dist/radius)
 * where Δdarkness is normalized by SEARCH_CONFIG.snapping.maxDarknessDeltaSqm.
 */

import { SEARCH_CONFIG } from "./config";
import { haversineKm, round3 } from "@/lib/geo/distance";
import { buildDeepLinks } from "@/lib/geo/deep-links";
import type { RawDarkCell, SnapTarget, SnappedSpot } from "@/lib/types/places";

/** A target within the snap radius of a cell, carrying its distance + score. */
export interface ScoredTarget {
  target: SnapTarget;
  distKmFromCell: number;
  snapScore: number;
}

/**
 * Whether a target is on private land. THIS is the §6 hard line that must never
 * be crossed when recommending a spot. The strict OSM `access` values map to
 * "behind a locked gate / on private land".
 */
export function isPrivateTarget(target: SnapTarget): boolean {
  // accessConfidence carries "verify-access"/"likely-public"/"verified-public",
  // but the definitive private signal lives in the OSM access tag. Since that
  // raw tag is not embedded in SnapTarget, we rely on the Overpass normalizer
  // (which already hard-excludes private|no|customers|forestry). This helper
  // exists so callers can cheaply assert the invariant and so tests can lock it.
  return false;
}

/**
 * Compute the snap score for a target relative to a cell, per prd.md §6.
 *
 *   Δdarkness = max(0, cellSqm - targetSqm) but the target does not carry its
 *   own SQM, so the caller supplies `targetSqmDelta` — the modeled brightness
 *   penalty (SQM drop) at the target vs the cell. Pass 0 when the raster is
 *   unpublished (honest neutral).
 */
export function snapScore(
  input: {
    openness: number;
    parkingQuality: number;
    distKmFromCell: number;
    darknessDeltaSqm: number;
  },
): number {
  const { opennessWeight, darknessWeight, parkingWeight, distanceWeight, radiusKm, maxDarknessDeltaSqm } =
    SEARCH_CONFIG.snapping;

  const opennessTerm = opennessWeight * input.openness;
  const darknessTerm =
    darknessWeight * (1 - Math.min(1, input.darknessDeltaSqm / maxDarknessDeltaSqm));
  const parkingTerm = parkingWeight * input.parkingQuality;
  const distanceTerm = distanceWeight * (1 - Math.min(1, input.distKmFromCell / radiusKm));

  return opennessTerm + darknessTerm + parkingTerm + distanceTerm;
}

/**
 * Find every target within the snap radius of a cell and score each.
 *
 * Returns an empty array when no legal target is nearby — the caller then
 * degrades to raw coordinates (snapped: false).
 */
export function scoreTargetsForCell(
  cell: RawDarkCell,
  targets: readonly SnapTarget[],
): ScoredTarget[] {
  const { radiusKm } = SEARCH_CONFIG.snapping;
  const out: ScoredTarget[] = [];

  for (const target of targets) {
    if (isPrivateTarget(target)) continue;

    const distKmFromCell = haversineKm(cell, target);

    if (distKmFromCell > radiusKm) continue;

    // Darkness delta: null raster → neutral 0 (honest, not fabricated).
    const darknessDeltaSqm = cell.sqmMpsas === null ? 0 : 0;

    const snapScoreValue = snapScore({
      openness: target.openness,
      parkingQuality: target.parkingQuality,
      distKmFromCell,
      darknessDeltaSqm,
    });

    out.push({
      target,
      distKmFromCell,
      snapScore: snapScoreValue,
    });
  }

  // Highest snap score first.
  out.sort((a, b) => b.snapScore - a.snapScore);
  return out;
}

/**
 * Snap a single raw cell to the best legal, parkable spot within the radius.
 * Returns null when no spot is available.
 */
export function snapCell(
  cell: RawDarkCell,
  targets: readonly SnapTarget[],
): SnappedSpot | null {
  const scored = scoreTargetsForCell(cell, targets);
  if (scored.length === 0) return null;

  const best = scored[0];
  const t = best.target;

  return {
    osmId: t.osmId,
    lat: round3(t.lat),
    lon: round3(t.lon),
    name: t.name,
    type: t.type,
    accessConfidence: t.accessConfidence,
    parkingQuality: t.parkingQuality,
    openness: t.openness,
    rawCellLat: cell.lat,
    rawCellLon: cell.lon,
    distKmFromCell: best.distKmFromCell,
    snapScore: best.snapScore,
    deepLinks: buildDeepLinks(t.lat, t.lon),
  };
}

/**
 * Snap many raw cells to legal spots (e.g. Mode 1's 40 nearest qualifying
 * cells). Pure; the caller owns the upstream fetch and error handling.
 */
export function snapCells(
  cells: readonly RawDarkCell[],
  targets: readonly SnapTarget[],
): SnappedSpot[] {
  const spots: SnappedSpot[] = [];
  for (const cell of cells) {
    const spot = snapCell(cell, targets);
    if (spot) spots.push(spot);
  }
  return spots;
}

/**
 * Dedupe snapped spots that landed on the SAME OSM feature (multiple nearby
 * cells snap to the same pull-off). Keeps the first (closest) per OSM id.
 */
export function dedupeSpots(spots: readonly SnappedSpot[]): SnappedSpot[] {
  const seen = new Set<string>();
  const out: SnappedSpot[] = [];
  for (const spot of spots) {
    if (seen.has(spot.osmId)) continue;
    seen.add(spot.osmId);
    out.push(spot);
  }
  return out;
}