/**
 * Shared types for site snapping & place results (prd.md §2.3, §6).
 *
 * Units follow .clinerules §3: distances are km, drive times are minutes,
 * coordinates are plain degrees (rounded to 3 dp before any outbound call).
 *
 * The snapping pipeline turns *raw* darkness grid cells into *snapped*,
 * legal, parkable places you can actually stand at (prd.md §6). This file is
 * the contract between the Overpass/Valhalla upstreams, the snapping logic,
 * and the API routes / map UI.
 */

/** What a place actually is, in descending preference for snapping (§6). */
export type SpotType =
  | "viewpoint"
  | "peak"
  | "parking"
  | "rest_area"
  | "park"
  | "open_green"
  | "water_access"
  | "pull-off"
  | "cemetery_field"
  | "other";

/**
 * Access confidence label (.clinerules §7). Every result card must show one of
 * these; "verify-access" means we could not confirm public status from tags.
 */
export type AccessConfidence =
  | "verified-public"
  | "likely-public"
  | "verify-access";

/** Deep links only — plain URLs, never the paid Maps Platform APIs (§0). */
export interface DeepLinks {
  googleMaps: string;
  appleMaps: string;
  waze: string;
  geo: string;
}

/** A raw darkness grid cell that needs snapping. */
export interface RawDarkCell {
  lat: number;
  lon: number;
  /**
   * Modeled zenith SQM (mpsas) at the cell, or null while the Phase 0 raster
   * is unpublished. Snap score degrades neutrally (Δdarkness = 0) when null.
   */
  sqmMpsas: number | null;
}

/** A qualifying OSM feature found near a raw cell, before scoring. */
export interface SnapTarget {
  /** OSM id with element type, e.g. "node/123456789" or "way/987654321". */
  osmId: string;
  lat: number;
  lon: number;
  /** Name, or a generated fallback like "Unnamed pull-off on Forest Rd 218". */
  name: string;
  type: SpotType;
  accessConfidence: AccessConfidence;
  /** 0..1 — presence/legality of parking on or adjacent to the target. */
  parkingQuality: number;
  /** 0..1 — openness estimate from OSM tags (canopy/landcover proxy). */
  openness: number;
}

/** A raw cell snapped to the best legal, parkable spot within the radius. */
export interface SnappedSpot {
  osmId: string;
  lat: number;
  lon: number;
  name: string;
  type: SpotType;
  accessConfidence: AccessConfidence;
  parkingQuality: number;
  openness: number;
  /** The raw cell this spot was snapped to. */
  rawCellLat: number;
  rawCellLon: number;
  /** Straight-line distance from the raw cell, km. */
  distKmFromCell: number;
  /** prd.md §6 snap score, 0..1. */
  snapScore: number;
  /**
   * Modeled zenith SQM (mpsas) at the spot, or null while the Phase 0 darkness
   * raster is unpublished. UI renders "≈ Bortle N" only when this is non-null;
   * a null value is shown honestly as "darkness unknown" (never fabricated).
   */
  sqmMpsas: number | null;
  deepLinks: DeepLinks;
}

/** A snapped spot with drive-time ranking, the API-facing result. */
export interface CandidateSpot extends SnappedSpot {
  /** One-way drive time from the origin, minutes. */
  driveTimeMin: number;
  /** True when drive time is a Haversine estimate (Valhalla unavailable). */
  driveTimeEstimated: boolean;
  /** Straight-line distance from the origin, km. */
  distKmFromOrigin: number;
  /** 1-based ranking (1 = recommended). */
  rank: number;
  /**
   * Composite "best" score in [0, 1] — see lib/search/rank.ts. Used to explain
   * why one spot ranks above another (greenery/open sky, parking, access,
   * darkness, and how close it is). Threshold mode ranks by drive time; the
   * score is still shown for transparency.
   */
  score: number;
  /** Human-readable reasons for the "best" score, for the educational tooltip. */
  scoreReasons: string[];
}

export type SearchMode = "threshold" | "timebudget";

export interface CandidatesResponse {
  origin: { lat: number; lon: number };
  mode: SearchMode;
  spots: CandidateSpot[];
  /** Enrichments/products that are missing or estimated (honest degradation). */
  partial: string[];
  estimated: boolean;
  generatedAtMs: number;
}

/* Minimal GeoJSON types (we deliberately avoid @turf for the upstream boundary;
 * .clinerules §1 allows it but Phase 1 needs only these two shapes). */

export interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoJsonPolygon {
  type: "Polygon";
  /** Array of rings; each ring is an array of [lon, lat] tuples. */
  coordinates: [number, number][][];
}

export interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJsonPolygon | GeoJsonPoint;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface IsochroneResponse {
  origin: { lat: number; lon: number };
  budgetMin: number;
  /** Isochrone polygon; null when it could not be produced at all. */
  geojson: GeoJsonFeatureCollection | null;
  /** True when the polygon is a Haversine fallback (not a true road network). */
  estimated: boolean;
  partial: string[];
  generatedAtMs: number;
}