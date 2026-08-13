/**
 * Overpass (OpenStreetMap) client for site snapping (prd.md §6).
 *
 * OSM via Overpass is ODbL — attribution "© OpenStreetMap contributors" is a
 * launch blocker (see /about and .clinerules §0.5). No API key, no cost tier.
 *
 * Snapping budget (.clinerules §4): at most ONE Overpass call per user search.
 * To honour that we do NOT loop per raw cell — we issue a single query over the
 * bounding box that covers every raw cell padded by the snap radius, then let
 * the pure `snap.ts` logic assign each cell to nearby features by haversine.
 *
 * The query eagerly drops `access=private|no|customers`, military, industrial
 * and quarry land so we never even download obviously-illegal spots. The
 * normalizer below is the second line of defence: if an element slipped through
 * (e.g. inherited access expressed another way), it is filtered there too.
 */

import { z } from "zod";
import { fetchJson } from "./_client";
import type { RawDarkCell, SnapTarget } from "@/lib/types/places";
import { SEARCH_CONFIG } from "@/lib/search/config";

/** Public Overpass endpoints, tried in order. Swappable via env for self-hosting. */
const OVERPASS_ENDPOINTS = (
  process.env.OVERPASS_BASE_URL ??
  "https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter"
).split(",");

const OVERPASS_TIMEOUT_QUERY = 25;
const QUERY_TIMEOUT_MAX = 60; // hard ceiling on the URL timeout param

/* ─────────────────────────── Zod schemas ─────────────────────────── */

const overpassElementSchema = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

const overpassResponseSchema = z.object({
  elements: z.array(overpassElementSchema).default([]),
});

type OverpassElement = z.infer<typeof overpassElementSchema>;

/* ─────────────────────────── Query building ─────────────────────────── */

/**
 * Convert a snap radius (km) to degrees of latitude/longitude. Longitude
 * degrees shrink with latitude, hence the cos(lat) term.
 */
function radiusToDeg(radiusKm: number, latDeg: number): { dLat: number; dLon: number } {
  const dLat = radiusKm / 110.574;
  const dLon = radiusKm / (111.32 * Math.max(0.1, Math.cos((latDeg * Math.PI) / 180)));
  return { dLat, dLon };
}

/**
 * Bounding box string ("south,west,north,east") covering all raw cells plus the
 * snap radius padding. A tiny epsilon avoids cutting off features on the edge.
 */
export function buildBoundingBox(cells: readonly RawDarkCell[]): string {
  if (cells.length === 0) {
    throw new Error("buildBoundingBox requires at least one cell");
  }

  const { radiusKm } = SEARCH_CONFIG.snapping;
  const maxAbsLat = Math.max(...cells.map((c) => Math.abs(c.lat)));
  const { dLat, dLon } = radiusToDeg(radiusKm, maxAbsLat);

  const lats = cells.map((c) => c.lat);
  const lons = cells.map((c) => c.lon);

  const south = Math.min(...lats) - dLat - 0.001;
  const north = Math.max(...lats) + dLat + 0.001;
  const west = Math.min(...lons) - dLon - 0.001;
  const east = Math.max(...lons) + dLon + 0.001;

  return `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
}

/**
 * The tag filter that drops explicitly non-public access at the source.
 * Overpass negation (`!~`) matches both a mismatching value AND a missing tag,
 * so we only lose elements that are unambiguously restricted.
 */
const PUBLIC_ACCESS_FILTER = '["access"!~"^(private|no|customers|forestry)$"]';
const NOT_INDUSTRIAL = '["landuse"!="industrial"]';
const NOT_QUARRY = '["landuse"!="quarry"]';
const NOT_MILITARY = '["military"!~"."]';

/**
 * One side of a query union: a set of (key,value) tag selectors for a feature
 * tier. `preferAreas` adds way/relation support where a centroid is useful.
 */
interface Tier {
  /** Matching tag pairs. */
  tags: Array<[string, string]>;
  /** Include ways (centroid) in addition to nodes. */
  ways: boolean;
}

/**
 * Snapping target tiers in prd.md §6 scoring order.
 */
const TIERS: readonly Tier[] = [
  {
    tags: [
      ["tourism", "viewpoint"],
      ["natural", "peak"],
    ],
    ways: true,
  },
  {
    tags: [
      ["amenity", "parking"],
      ["highway", "trailhead"],
    ],
    ways: true,
  },
  {
    tags: [
      ["highway", "rest_area"],
      ["highway", "services"],
    ],
    ways: true,
  },
  {
    tags: [
      ["leisure", "park"],
      ["leisure", "nature_reserve"],
      ["leisure", "recreation_ground"],
    ],
    ways: true,
  },
  {
    tags: [
      ["landuse", "meadow"],
      ["landuse", "grass"],
      ["natural", "grassland"],
      ["natural", "heath"],
      ["natural", "scrub"],
      ["natural", "beach"],
    ],
    ways: true,
  },
  {
    // Boat ramps / water access (open southern horizon over water, §6 tier 6).
    tags: [
      ["leisure", "slipway"],
    ],
    ways: false,
  },
  {
    // Flagged "check local rules" sites (§6 tier 8).
    tags: [
      ["landuse", "cemetery"],
      ["amenity", "school"],
    ],
    ways: true,
  },
];

/**
 * Build the full Overpass QL body for a bounding box.
 *
 * Returns the query string (without scheme/host). Uses one big union over all
 * tiers, then `out center tags` so ways come back with a centroid.
 */
export function buildSnapQuery(bbox: string): string {
  const statements: string[] = [];

  for (const tier of TIERS) {
    for (const [key, value] of tier.tags) {
      const selector = `["${key}"="${value}"]`;
      const filters = `${PUBLIC_ACCESS_FILTER}${NOT_INDUSTRIAL}${NOT_QUARRY}${NOT_MILITARY}`;

      statements.push(`node${selector}${filters}(${bbox});`);
      if (tier.ways) {
        statements.push(`way${selector}${filters}(${bbox});`);
        // Relations are rarely useful for a standable point; we skip them to
        // keep the payload and parse time small.
      }
    }
  }

  const timeout = Math.min(QUERY_TIMEOUT_MAX, OVERPASS_TIMEOUT_QUERY);
  return `[out:json][timeout:${timeout}];(${statements.join("\n")});out center tags;`;
}

/* ─────────────────────────── Classification ─────────────────────────── */

/** Read a tag with a default. */
function tag(el: OverpassElement, key: string): string | undefined {
  return el.tags?.[key];
}

function hasTag(el: OverpassElement, key: string): boolean {
  return key in (el.tags ?? {});
}

/** Access confidence from OSM tags (prd.md §6 + .clinerules §7). */
function accessConfidenceOf(el: OverpassElement): "verified-public" | "likely-public" | "verify-access" {
  const access = tag(el, "access");
  if (access === "yes" || access === "public" || access === "permissive") {
    return "verified-public";
  }

  // Parks/nature reserves are almost always publicly accessible; treat the
  // absence of a restriction as "likely public" rather than unknown.
  const likely = [
    "leisure",
    "tourism",
    "natural",
    "amenity",
  ].some((k) => hasTag(el, k) && el.tags?.[k] !== "cemetery");

  if (likely && !access) return "likely-public";

  // Parking with no access tag is common on public land, but not certain.
  if (tag(el, "amenity") === "parking" && !access) return "likely-public";

  return "verify-access";
}

/** Parking quality 0..1 from tags (prd.md §6 parking_quality term). */
function parkingQualityOf(el: OverpassElement): number {
  const parking = tag(el, "parking");
  const fee = tag(el, "fee");

  if (tag(el, "amenity") === "parking" || tag(el, "highway") === "trailhead") {
    // A dedicated lot is the best parking signal; trailheads usually have a lot.
    return fee === "yes" ? 0.9 : 1.0;
  }
  if (parking === "surface" || parking === "yes" || parking === "multi-storey" || parking === "street_side") {
    return 1.0;
  }
  if (parking === "no") return 0.0;
  // No parking signal: rest areas/parking-adjacent get a modest default.
  if (tag(el, "highway") === "rest_area" || tag(el, "highway") === "services") return 1.0;
  return 0.5;
}

/** Openness 0..1 — OSM-tag proxy for prd.md §6 "openness" (canopy/tree cover). */
function opennessOf(el: OverpassElement): number {
  const type = classifyType(el);

  switch (type) {
    case "viewpoint":
    case "peak":
      return 1.0; // viewpoints/peaks are by definition open
    case "water_access":
      return 0.95; // open horizon over water
    case "open_green":
      return 0.9;
    case "pull-off":
      return 0.8;
    case "parking":
      return 0.6; // lots often have some tree cover
    case "park":
      return tag(el, "leisure") === "nature_reserve" ? 0.7 : 0.75;
    case "cemetery_field":
      return 0.7;
    case "rest_area":
    case "other":
    default:
      return 0.65;
  }
}

/** Prd §6 tier name used for the fallback label. */
export function classifyType(el: OverpassElement): SnapTarget["type"] {
  const amenity = tag(el, "amenity");
  const tourism = tag(el, "tourism");
  const leisure = tag(el, "leisure");
  const highway = tag(el, "highway");
  const natural = tag(el, "natural");
  const landuse = tag(el, "landuse");

  if (tourism === "viewpoint") return "viewpoint";
  if (natural === "peak") return "peak";
  if (amenity === "parking" || highway === "trailhead") return "parking";
  if (highway === "rest_area" || highway === "services") return "rest_area";
  if (
    leisure === "park" ||
    leisure === "nature_reserve" ||
    leisure === "recreation_ground"
  ) {
    return "park";
  }
  if (
    landuse === "meadow" ||
    landuse === "grass" ||
    natural === "grassland" ||
    natural === "heath" ||
    natural === "scrub" ||
    natural === "beach"
  ) {
    return "open_green";
  }
  if (leisure === "slipway") return "water_access";
  if (landuse === "cemetery" || amenity === "school") return "cemetery_field";
  return "other";
}

/**
 * Second-line exclusion (prd.md §6 hard excludes). Returns true when a feature
 * must NEVER be recommended regardless of tags.
 */
function isHardExcluded(el: OverpassElement): boolean {
  const access = tag(el, "access");
  if (access === "private" || access === "no" || access === "customers" || access === "forestry") {
    return true;
  }
  // anything military, an airport, or a quarry is a no-go
  if (tag(el, "military") !== undefined) return true;
  if (tag(el, "aeroway") !== undefined) return true;
  if (tag(el, "landuse") === "quarry" || tag(el, "landuse") === "industrial") return true;
  if (tag(el, "barrier") === "gate" && tag(el, "locked") === "yes") return true;
  return false;
}

/** Build a human-facing name, with a generated fallback (prd.md §6). */
function nameOf(el: OverpassElement, type: SnapTarget["type"]): string {
  const name = tag(el, "name");
  if (name) return name;
  const ref = tag(el, "ref");
  if (ref) return ref;

  switch (type) {
    case "viewpoint":
      return "Unnamed viewpoint";
    case "peak":
      return "Unnamed peak";
    case "parking":
      return "Unnamed parking area";
    case "rest_area":
      return "Unnamed rest area";
    case "park":
      return "Unnamed park";
    case "open_green":
      return "Unnamed open field";
    case "water_access":
      return "Unnamed boat ramp";
    case "cemetery_field":
      return "Unnamed field (check local rules)";
    default:
      return "Unnamed spot";
  }
}

/** Normalize a single Overpass element into a SnapTarget, or null if excluded. */
export function normalizeElement(el: OverpassElement): SnapTarget | null {
  if (isHardExcluded(el)) return null;

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat === undefined || lon === undefined) return null;

  const type = classifyType(el);

  return {
    osmId: `${el.type}/${el.id}`,
    lat,
    lon,
    name: nameOf(el, type),
    type,
    accessConfidence: accessConfidenceOf(el),
    parkingQuality: parkingQualityOf(el),
    openness: opennessOf(el),
  };
}

/* ─────────────────────────── Public fetcher ─────────────────────────── */

export interface SnapTargetsResult {
  targets: SnapTarget[];
  partial: boolean;
}

/**
 * One Overpass call for ALL raw cells (batched into a single bbox query).
 *
 * Degrades gracefully per .clinerules §4: on any upstream failure we return an
 * empty target list with `partial: true` — the caller falls back to raw
 * coordinates with `snapped: false` rather than failing the whole search.
 */
export async function fetchSnapTargetsForCells(
  cells: readonly RawDarkCell[],
): Promise<SnapTargetsResult> {
  const bbox = buildBoundingBox(cells);
  const query = buildSnapQuery(bbox);
  const body = new URLSearchParams({ data: query });

  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const raw = await fetchJson({
        url: `${endpoint}`,
        schema: overpassResponseSchema,
        service: "Overpass",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "skyward.app/1.0 (stargazing trip planner; https://github.com/skyward)",
        },
        method: "POST",
        body: body.toString(),
      });

      const targets: SnapTarget[] = [];
      for (const el of raw.elements) {
        const t = normalizeElement(el);
        if (t) targets.push(t);
      }
      return { targets, partial: false };
    } catch (err) {
      lastError = err;
      // Try the next endpoint.
    }
  }

  console.error(
    JSON.stringify({
      event: "overpass_degraded",
      cause: lastError instanceof Error ? lastError.message : String(lastError),
    }),
  );
  return { targets: [], partial: true };
}