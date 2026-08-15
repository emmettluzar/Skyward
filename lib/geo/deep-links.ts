/**
 * Navigation deep links (prd.md §6).
 *
 * These are PLAIN URLS only — Google Maps / Apple Maps / Waze / geo: URIs.
 * This is explicitly ALLOWED by .clinerules §0: "Google/Apple Maps deep links
 * are allowed — they're just URLs." We must never call the paid Maps Platform
 * APIs (Directions/Geocoding/etc.), only hand the user a URL to open.
 */

import type { DeepLinks } from "@/lib/types/places";

/** Round a coordinate to 6 dp for a compact, sufficient link target (~0.1 m). */
function r6(n: number): string {
  return n.toFixed(6);
}

/**
 * Build the four deep links for a destination coordinate.
 *
 * - Google Maps: `https://www.google.com/maps/dir/?api=1&destination=lat,lon`
 *   (universal web URL; opens the app or browser without a key).
 * - Apple Maps:  `https://maps.apple.com/?daddr=lat,lon`
 * - Waze:        `https://waze.com/ul?ll=lat,lon&navigate=yes`
 * - geo: URI:    `geo:lat,lon` (browser/OS routing intent).
 */
export function buildDeepLinks(lat: number, lon: number): DeepLinks {
  // Use exact coordinates with sufficient precision for navigation
  const precisionLat = Math.round(lat * 1000000) / 1000000;
  const precisionLon = Math.round(lon * 1000000) / 1000000;

  return {
    googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${precisionLat},${precisionLon}`,
    appleMaps: `https://maps.apple.com/?daddr=${precisionLat},${precisionLon}`,
    waze: `https://waze.com/ul?ll=${precisionLat},${precisionLon}&navigate=yes`,
    geo: `geo:${precisionLat},${precisionLon}`,
  };
}
