/**
 * Shared Zod string parsers for route-handler query params. All values arrive
 * as `unknown` at this boundary and are validated here (no `any`, no `!`).
 */

import { z } from "zod";
import { AppError } from "@/lib/errors";

const COORD_MAX_ABS = 90;
const LON_MAX_ABS = 180;

const latSchema = z.coerce.number().min(-COORD_MAX_ABS).max(COORD_MAX_ABS);
const lonSchema = z.coerce.number().min(-LON_MAX_ABS).max(LON_MAX_ABS);

/** A single coordinate pair. */
export interface PointParam {
  lat: number;
  lon: number;
}

export interface QueryOptions {
  requiredPoints: 1 | "many";
}

/**
 * Parse `lat`/`lon` query params. For a single point, `lat=40.7&lon=-74.0`.
 * For many, comma-separated equal-length lists (`lat=40.7,39&lon=-74,-105`).
 */
export function parsePoints(
  url: string,
  options: QueryOptions,
): PointParam[] {
  const { searchParams } = new URL(url);
  const latRaw = searchParams.get("lat");
  const lonRaw = searchParams.get("lon");

  if (!latRaw || !lonRaw) {
    throw new AppError({
      code: "BAD_REQUEST",
      userMessage: "Missing lat/lon query parameters.",
    });
  }

  const lats = latRaw.split(",");
  const lons = lonRaw.split(",");

  if (options.requiredPoints === 1) {
    if (lats.length !== 1 || lons.length !== 1) {
      throw new AppError({
        code: "BAD_REQUEST",
        userMessage: "Expected exactly one lat/lon pair.",
      });
    }
  } else if (lats.length === 0 || lats.length !== lons.length) {
    throw new AppError({
      code: "BAD_REQUEST",
      userMessage: "lat and lon must be comma-separated lists of equal length.",
    });
  }

  return lats.map((lat, i) => ({
    lat: latSchema.parse(lat),
    lon: lonSchema.parse(lons[i]),
  }));
}

/** Optional `now` query param as epoch ms, defaulting to the current time. */
export function parseNowMs(url: string): number {
  const { searchParams } = new URL(url);
  const raw = searchParams.get("now");
  if (!raw) return Date.now();
  return z.coerce.number().int().nonnegative().parse(raw);
}

/** Optional numeric query param with a default. */
export function parseOptionalNumber(
  url: string,
  key: string,
  fallback: number,
): number {
  const { searchParams } = new URL(url);
  const raw = searchParams.get(key);
  if (raw === null) return fallback;
  return z.coerce.number().parse(raw);
}

/**
 * Optional numeric query param that may be absent (→ fallback) or explicitly
 * empty (→ null). Used for the darkness SQM override, which is null when the
 * Phase 0 raster has not been published yet.
 */
export function parseOptionalNullableNumber(
  url: string,
  key: string,
): number | null {
  const { searchParams } = new URL(url);
  const raw = searchParams.get(key);
  if (raw === null) return null;
  if (raw === "") return null;
  return z.coerce.number().parse(raw);
}

export { AppError };