/**
 * Pure great-circle distance helpers (Haversine), used both for snapping radius
 * checks and the Valhalla-down fallback drive-time estimate (.clinerules §4).
 *
 * No external geo dependency required for the one distance formula we need in
 * Phase 1 — keeps the offline/zero-cost constraint and avoids a runtime dep.
 */

const EARTH_RADIUS_KM = 6371.0088;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Degrees → radians. */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Uses the standard haversine formula; stable for the short candidate↔cell and
 * origin↔destination distances this product needs (tens to hundreds of km).
 */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);

  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;

  // Guard against floating point pushing h slightly above 1.
  const hc = Math.min(1, h);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(hc));
}

/**
 * Drive-time estimate used ONLY when Valhalla is unreachable (prd.md §11):
 *   minutes = (haversine km × 1.35 road factor) / 70 km/h × 60
 *
 * The 1.35 road-factor and 70 km/h average come from prd.md §11 / §4 degradation
 * guidance. Callers MUST mark the result `estimated: true` so the UI shows "~".
 */
export const ROAD_FACTOR = 1.35;
export const AVG_SPEED_KPH = 70;

export function estimatedDriveMinKm(distKm: number): number {
  return (distKm * ROAD_FACTOR) / AVG_SPEED_KPH * 60;
}

/** Round a coordinate to 3 dp (~110 m) — privacy + cache-key strategy. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}