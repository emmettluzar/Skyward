/**
 * Valhalla (FOSSGIS demo) client for isochrone + matrix routing (prd.md §3, §9).
 *
 * Rules (.clinerules §4, prd.md §9):
 *   - Always send `X-Client-Id: skyward.app` (fair-use identifier).
 *   - Keep this module swappable: self-hosting is a one-env-var change
 *     (VALHALLA_BASE_URL).
 *   - Graceful degradation is mandatory: on any failure we return a Haversine
 *     estimate and mark `estimated: true` rather than failing the search.
 *
 * Budget per search: ≤1 isochrone + ≤1 matrix call. Callers are responsible for
 * batching (the matrix call takes ALL origin/destination pairs at once).
 */

import { z } from "zod";
import { fetchJson } from "./_client";
import { haversineKm, estimatedDriveMinKm, round3 } from "@/lib/geo/distance";
import type {
  GeoJsonFeatureCollection,
  GeoJsonPolygon,
} from "@/lib/types/places";

/** Swappable base URL — one env var moves us to a self-hosted instance. */
const VALHALLA_BASE_URL =
  process.env.VALHALLA_BASE_URL ?? "https://valhalla1.openstreetmap.de";

const CLIENT_ID = "skyward.app";

/* ─────────────────────────── Zod schemas ─────────────────────────── */

const lonLatTuple = z.tuple([z.number(), z.number()]);

const isochroneSchema = z.object({
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      properties: z.object({}).passthrough(),
      geometry: z.object({
        type: z.literal("Polygon"),
        coordinates: z.array(z.array(lonLatTuple)),
      }),
    }),
  ),
});

const matrixResponseSchema = z.object({
  sources: z.array(z.object({ lat: z.number(), lon: z.number() })),
  targets: z.array(z.object({ lat: z.number(), lon: z.number() })),
  sources_to_targets: z.array(z.array(z.number().nullable())),
});

/* ─────────────────────────── Types ─────────────────────────── */

export interface MatrixResult {
  /** [sourceIndex][targetIndex] → minutes (null when unroutable). */
  minutes: number[][];
  estimated: boolean;
}

export interface IsochroneResult {
  geojson: GeoJsonFeatureCollection | null;
  estimated: boolean;
}

/* ─────────────────────────── Haversine fallbacks ─────────────────────────── */

/**
 * A circular polygon approximating the drive-time isochrone. Used only when
 * Valhalla is unreachable. Radius = (budgetMin / roadFactor) × 70 km/h.
 */
export function fallbackIsochrone(
  lat: number,
  lon: number,
  budgetMin: number,
): GeoJsonFeatureCollection {
  // Drive time → straight-line radius via the same road factor used for
  // point estimates (prd.md §11): dist ≈ (min / 60 h) × 70 km/h / 1.35.
  const radiusKm = ((budgetMin / 60) * 70) / 1.35;

  const points: [number, number][] = [];
  const STEPS = 48;
  for (let i = 0; i < STEPS; i++) {
    const angle = (i / STEPS) * Math.PI * 2;
    const dLat = (radiusKm / 110.574) * Math.sin(angle);
    const dLon =
      (radiusKm / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)))) *
      Math.cos(angle);
    points.push([round3(lon + dLon), round3(lat + dLat)]);
  }
  // Close the ring.
  points.push(points[0]);

  const polygon: GeoJsonPolygon = {
    type: "Polygon",
    coordinates: [points],
  };

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { estimated: true },
        geometry: polygon,
      },
    ],
  };
}

/** Estimate a source→target drive-time matrix with the Haversine road factor. */
export function fallbackMatrix(
  origins: readonly { lat: number; lon: number }[],
  destinations: readonly { lat: number; lon: number }[],
): number[][] {
  return origins.map((o) =>
    destinations.map((d) => {
      const km = haversineKm(o, d);
      return Math.round(estimatedDriveMinKm(km));
    }),
  );
}

/* ─────────────────────────── Public fetchers ─────────────────────────── */

/**
 * Valhalla /isochrone proxy. Returns `estimated: true` + a circular fallback
 * polygon on any failure (never throws for upstream unavailability).
 */
export async function fetchIsochrone(
  lat: number,
  lon: number,
  budgetMin: number,
): Promise<IsochroneResult> {
  const body = JSON.stringify({
    locations: [{ lat: round3(lat), lon: round3(lon) }],
    costing: "auto",
    contours: [{ time: budgetMin }],
    polygons: true,
    denoise: 0.3,
    generalize: 100,
  });

  try {
    const raw = await fetchJson({
      url: `${VALHALLA_BASE_URL}/isochrone`,
      schema: isochroneSchema,
      service: "Valhalla",
      headers: { "X-Client-Id": CLIENT_ID },
      method: "POST",
      body,
    });

    const features = raw.features.map((f) => ({
      type: "Feature" as const,
      properties: f.properties,
      geometry: f.geometry,
    }));

    return {
      geojson: { type: "FeatureCollection", features },
      estimated: false,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "valhalla_isochrone_degraded",
        cause: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      geojson: fallbackIsochrone(lat, lon, budgetMin),
      estimated: true,
    };
  }
}

/**
 * Valhalla /sources_to_targets matrix proxy — ONE call for every origin→dest
 * pair (prd.md §3.1). Returns a Haversine estimate on failure.
 */
export async function fetchMatrix(
  origins: readonly { lat: number; lon: number }[],
  destinations: readonly { lat: number; lon: number }[],
): Promise<MatrixResult> {
  const body = JSON.stringify({
    sources: origins.map((o) => ({ lat: round3(o.lat), lon: round3(o.lon) })),
    targets: destinations.map((d) => ({ lat: round3(d.lat), lon: round3(d.lon) })),
    costing: "auto",
  });

  try {
    const raw = await fetchJson({
      url: `${VALHALLA_BASE_URL}/sources_to_targets`,
      schema: matrixResponseSchema,
      service: "Valhalla",
      headers: { "X-Client-Id": CLIENT_ID },
      method: "POST",
      body,
    });

    // Valhalla /sources_to_targets returns travel time in SECONDS; everything
    // downstream expects minutes. Convert once here at the boundary so a real
    // 15-minute drive (900 s) never renders as "900 min" (15 h).
    return {
      minutes: raw.sources_to_targets.map((row) =>
        row.map((m) => (m === null ? Infinity : Math.round(m / 60))),
      ),
      estimated: false,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "valhalla_matrix_degraded",
        cause: err instanceof Error ? err.message : String(err),
      }),
    );
    return {
      minutes: fallbackMatrix(origins, destinations),
      estimated: true,
    };
  }
}