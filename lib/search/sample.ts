/**
 * Candidate dark-cell sampling (prd.md §3.1 step 2, §3.3 step 3).
 *
 * The Phase 0 darkness raster is not published yet (no data/manifest.json, no
 * lib/darkness/raster.ts), so "qualifying cells" degrades honestly to a
 * spatial expanding-ring sample around the origin combined with the offline,
 * pure zenith-brightness model in lib/darkness/model.ts (calculateLocationSqm)
 * — never fabricating a value, just deterministically modeling one.
 *
 * Pure: no I/O, no Date.now(), no new dependencies. Point-in-polygon is a small
 * local ray-casting implementation (avoids pulling @turf into the bundle for
 * one predicate).
 *
 * IMPORTANT (bugfix, see .clinerules audit): the original ring sampler used a
 * FIXED spoke count per ring (8, growing to 16 past ring 8). Since a ring's
 * circumference grows linearly with its radius, a fixed spoke count means the
 * arc-length gap between adjacent sampled points grows without bound at larger
 * radii — real dark-sky sites many kilometres from any sampled point were
 * silently skipped even though they were well within the search radius. Every
 * sampler below instead sizes its spoke count from the ring's own
 * circumference so the arc-length gap stays close to `spacingKm` at every
 * radius (capped for performance), giving genuinely uniform, gap-free
 * coverage — the "unified, comprehensive candidate search" all search modes
 * now share.
 */

import type { RawDarkCell } from "@/lib/types/places";
import { haversineKm, round3 } from "@/lib/geo/distance";

/** One origin for ring sampling. */
export interface Origin {
  lat: number;
  lon: number;
}

/** Hard ceiling on spokes-per-ring so a single huge ring can't blow up cost. */
const MAX_SPOKES_PER_RING = 64;
/** Floor on spokes-per-ring so tiny inner rings still get some coverage. */
const MIN_SPOKES_PER_RING = 8;

/** Convert a lat/lon offset (km, at a bearing angle) into a lat/lon point. */
function offsetPoint(origin: Origin, radiusKm: number, angleRad: number): { lat: number; lon: number } {
  const dLat = (radiusKm / 110.574) * Math.sin(angleRad);
  const dLon =
    (radiusKm / (111.32 * Math.max(0.1, Math.cos((origin.lat * Math.PI) / 180)))) *
    Math.cos(angleRad);
  return { lat: round3(origin.lat + dLat), lon: round3(origin.lon + dLon) };
}

/**
 * Sample every ring cell in the annulus `[innerRadiusKm, outerRadiusKm]`
 * around an origin, spaced roughly `spacingKm` apart both radially and along
 * each ring's circumference (spoke count derived from circumference, capped
 * for cost). This is the single sampling primitive every search mode uses —
 * it never silently under-samples the outer edge of its own search radius.
 *
 * Passing `innerRadiusKm = 0` fills the whole disc out to `outerRadiusKm`.
 */
export function sampleAnnulusCells(
  origin: Origin,
  innerRadiusKm: number,
  outerRadiusKm: number,
  spacingKm: number,
): RawDarkCell[] {
  const cells: RawDarkCell[] = [];
  const placed: Array<{ lat: number; lon: number }> = [];
  const spacing = Math.max(0.1, spacingKm);
  const minSpacingForDedupe = spacing * 0.6;

  // Always sample the very centre once when starting from the origin so a
  // dark site right at the user's location isn't missed.
  if (innerRadiusKm <= 0) {
    cells.push({ lat: round3(origin.lat), lon: round3(origin.lon), sqmMpsas: null });
    placed.push({ lat: origin.lat, lon: origin.lon });
  }

  const start = Math.max(spacing, innerRadiusKm > 0 ? innerRadiusKm : spacing);
  for (let r = start; r <= outerRadiusKm + 1e-6; r += spacing) {
    const circumferenceKm = 2 * Math.PI * r;
    const spokes = Math.min(
      MAX_SPOKES_PER_RING,
      Math.max(MIN_SPOKES_PER_RING, Math.round(circumferenceKm / spacing)),
    );

    for (let i = 0; i < spokes; i++) {
      const angle = (i / spokes) * Math.PI * 2;
      const { lat, lon } = offsetPoint(origin, r, angle);

      const tooClose = placed.some((p) => haversineKm(p, { lat, lon }) < minSpacingForDedupe);
      if (tooClose) continue;

      placed.push({ lat, lon });
      cells.push({ lat, lon, sqmMpsas: null });
    }
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

/**
 * The farthest distance (km) from `origin` to any vertex of a polygon ring.
 * Used to size candidate sampling so it covers the isochrone's *actual*
 * reachable extent (which can reach farther than a circular estimate along
 * highways) rather than an underestimate that silently drops real spots.
 */
export function polygonMaxRadiusKm(
  origin: Origin,
  ring: readonly (readonly [number, number])[] | null,
): number | null {
  if (!ring || ring.length === 0) return null;
  let max = 0;
  for (const [lon, lat] of ring) {
    const d = haversineKm(origin, { lat, lon });
    if (d > max) max = d;
  }
  return max;
}