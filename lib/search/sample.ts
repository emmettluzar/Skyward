/**
 * Candidate dark-cell sampling (prd.md §3.1 step 2, §3.3 step 3).
 *
 * The Phase 0 darkness raster is not published yet (no data/manifest.json, no
 * lib/darkness/raster.ts), so the "qualifying cells" step degrades honestly to
 * a spatial expanding-ring sample around the origin: every cell is returned
 * with `sqmMpsas: null`. When the raster lands, this module becomes the place
 * where the ring sample is filtered by the darkness threshold — but it must
 * NEVER fabricate a darkness value in the meantime.
 *
 * Pure: no I/O, no Date.now(), no new dependencies. Point-in-polygon is a small
 * local ray-casting implementation (avoids pulling @turf into the bundle for
 * one predicate).
 */

import type { RawDarkCell } from "@/lib/types/places";
import { haversineKm, round3 } from "@/lib/geo/distance";

/** One origin for ring sampling. */
export interface Origin {
  lat: number;
  lon: number;
}

/**
 * Generate an expanding-ring sample of candidate cells around an origin.
 *
 * Rings grow by `spacingKm` until `count` cells are produced. 8 cells per ring
 * (every 45°). This mirrors prd.md §3.1 step 2 but WITHOUT darkness filtering
 * (raster unpublished → all cells pass, sqm null).
 */
export function sampleCandidateCells(
  origin: Origin,
  count: number,
  spacingKm: number,
): RawDarkCell[] {
  const cells: RawDarkCell[] = [];
  const placed: Array<{ lat: number; lon: number }> = [];
  let ring = 1;

  while (cells.length < count && ring < 64) {
    const radiusKm = ring * spacingKm;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const dLat = (radiusKm / 110.574) * Math.sin(angle);
      const dLon =
        (radiusKm / (111.32 * Math.max(0.1, Math.cos((origin.lat * Math.PI) / 180)))) *
        Math.cos(angle);

      const lat = round3(origin.lat + dLat);
      const lon = round3(origin.lon + dLon);

      // Enforce minimum spacing against already-placed cells (dedup, §3.1).
      const tooClose = placed.some((p) => haversineKm(p, { lat, lon }) < spacingKm);
      if (tooClose) continue;

      placed.push({ lat, lon });
      cells.push({ lat, lon, sqmMpsas: null });
      if (cells.length >= count) break;
    }
    ring += 1;
  }

  return cells;
}

/**
 * Point-in-polygon (ray casting) for a GeoJSON-style polygon ring
 * `[ [ [lon,lat], ... ] ]`. Handles the outer ring; interior rings are ignored
 * for Phase 1 (isochrones we produce are single rings).
 */
export function pointInPolygon(
  lat: number,
  lon: number,
  ring: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Keep only candidate cells inside a polygon (used to mask the isochrone).
 * Falls back to returning all cells when the polygon is absent.
 */
export function filterCellsInPolygon(
  cells: readonly RawDarkCell[],
  ring: readonly (readonly [number, number])[] | null,
): RawDarkCell[] {
  if (!ring) return [...cells];
  return cells.filter((c) => pointInPolygon(c.lat, c.lon, ring));
}

/**
 * Keep only candidate cells within `radiusKm` of a point (the circular
 * Haversine fallback isochrone).
 */
export function filterCellsInRadius(
  cells: readonly RawDarkCell[],
  origin: Origin,
  radiusKm: number,
): RawDarkCell[] {
  return cells.filter((c) => haversineKm(origin, c) <= radiusKm);
}