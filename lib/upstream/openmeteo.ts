/**
 * Open-Meteo clients (Forecast + Air Quality) — the ONLY weather/AQ upstream
 * for Phase 1 (prd.md §9: CC BY 4.0, no key, 10k/day free non-commercial).
 *
 * Batching (.clinerules §4): every endpoint accepts comma-separated
 * latitude/longitude, so ONE forecast call + ONE air-quality call serve ALL
 * candidate points (home + sites) in a verdict request. No per-point loops.
 *
 * Boundary rule (.clinerules §3): cloud percentages are converted to 0–1
 * fractions here, once, at the boundary. AOD and PM2.5 are passed through as
 * unitless / μg·m⁻³. All responses are Zod-validated; nothing untyped crosses
 * fetchJson.
 */

import { z } from "zod";
import { fetchJson } from "./_client";

const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality";

/** Open-Meteo hourly forecast variables used by the scoring engine. */
const WEATHER_VARS = [
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "temperature_2m",
  "dew_point_2m",
  "relative_humidity_2m",
  "wind_speed_10m",
];

/** Open-Meteo Air Quality variables (AOD550 + PM2.5). */
const AIR_QUALITY_VARS = ["pm2_5", "aerosol_optical_depth"];

const FORECAST_DAYS = 4;

/* ─────────────────────────── Zod schemas ─────────────────────────── */

// A value may be null when the provider has no data for that hour/variable.
const nullableNumber = z.number().nullable();

const weatherHourlySchema = z.object({
  time: z.array(z.string()),
  cloud_cover_low: z.array(nullableNumber),
  cloud_cover_mid: z.array(nullableNumber),
  cloud_cover_high: z.array(nullableNumber),
  temperature_2m: z.array(nullableNumber),
  dew_point_2m: z.array(nullableNumber),
  relative_humidity_2m: z.array(nullableNumber),
  wind_speed_10m: z.array(nullableNumber),
});

const forecastLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  hourly: weatherHourlySchema,
});

const airQualityHourlySchema = z.object({
  time: z.array(z.string()),
  pm2_5: z.array(nullableNumber),
  aerosol_optical_depth: z.array(nullableNumber),
});

const airQualityLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  utc_offset_seconds: z.number(),
  timezone: z.string(),
  hourly: airQualityHourlySchema,
});

// Open-Meteo returns a single object for one coordinate, and an array for
// several. Normalize both shapes to an array.
const forecastResponseSchema = z.union([
  z.array(forecastLocationSchema),
  forecastLocationSchema,
]);

const airQualityResponseSchema = z.union([
  z.array(airQualityLocationSchema),
  airQualityLocationSchema,
]);

/* ─────────────────────────── Domain types ─────────────────────────── */

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** One hour of weather, with units normalized at the boundary. */
export interface WeatherHour {
  timeMs: number;
  /** 0–1, converted from Open-Meteo percent. */
  cloudLowFrac: number;
  cloudMidFrac: number;
  cloudHighFrac: number;
  tempC?: number;
  dewPointC?: number;
  relHumidityPct?: number;
  windKph?: number;
}

export interface WeatherLocation {
  latitude: number;
  longitude: number;
  timezone: string;
  utcOffsetSeconds: number;
  hours: WeatherHour[];
}

export interface AirQualityLocation {
  latitude: number;
  longitude: number;
  hours: AirQualityHour[];
}

export interface AirQualityHour {
  timeMs: number;
  /** PM2.5, μg·m⁻³. */
  pm25UgM3?: number;
  /** Aerosol optical depth at 550 nm, unitless. */
  aod550?: number;
}

export type BatchResult<T> = { data: T[]; partial: boolean };

/* ─────────────────────────── Helpers ─────────────────────────── */

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Open-Meteo returns `hourly.time` strings in the requested timezone's LOCAL
 * time WITHOUT an offset (e.g. "2026-08-13T00:00" for Europe/Berlin). The
 * offset is carried separately in `utc_offset_seconds`.
 *
 * Appending "Z" forces the wall-clock components to be parsed as UTC, then we
 * subtract the reported offset to recover the true absolute instant. A naive
 * `Date.parse(iso)` would wrongly interpret the string in the *server's* local
 * timezone.
 */
function localIsoToMs(iso: string, utcOffsetSeconds: number): number {
  const normalized = iso.endsWith("Z") ? iso : `${iso}Z`;
  return Date.parse(normalized) - utcOffsetSeconds * 1000;
}

function buildUrl(base: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params);
  return `${base}?${q.toString()}`;
}

/** Round a coordinate to 3 dp — cache-hit strategy + privacy measure. */
function r3(n: number): string {
  return n.toFixed(3);
}

/* ─────────────────────────── Public fetchers ─────────────────────────── */

/**
 * One batched forecast call for every point. Coordinates are rounded to 3 dp
 * before being sent (privacy + cache-key strategy, .clinerules §4).
 */
export async function fetchForecastBatch(
  points: readonly GeoPoint[],
): Promise<BatchResult<WeatherLocation>> {
  const params: Record<string, string> = {
    latitude: points.map((p) => r3(p.lat)).join(","),
    longitude: points.map((p) => r3(p.lon)).join(","),
    hourly: WEATHER_VARS.join(","),
    forecast_days: String(FORECAST_DAYS),
    timezone: "auto",
  };

  const raw = await fetchJson({
    url: buildUrl(FORECAST_BASE, params),
    schema: forecastResponseSchema,
    service: "Open-Meteo",
  });

  let partial = false;
  const data = toArray(raw).map((loc) => {
    const hours = buildWeatherHours(loc.hourly, loc.utc_offset_seconds);
    if (hours.length < loc.hourly.time.length) partial = true;
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      timezone: loc.timezone,
      utcOffsetSeconds: loc.utc_offset_seconds,
      hours,
    };
  });

  return { data, partial };
}

/**
 * One batched Air Quality call for every point.
 */
export async function fetchAirQualityBatch(
  points: readonly GeoPoint[],
): Promise<BatchResult<AirQualityLocation>> {
  const params: Record<string, string> = {
    latitude: points.map((p) => r3(p.lat)).join(","),
    longitude: points.map((p) => r3(p.lon)).join(","),
    hourly: AIR_QUALITY_VARS.join(","),
    forecast_days: String(FORECAST_DAYS),
    timezone: "auto",
  };

  const raw = await fetchJson({
    url: buildUrl(AIR_QUALITY_BASE, params),
    schema: airQualityResponseSchema,
    service: "Open-Meteo Air Quality",
  });

  let partial = false;
  const data = toArray(raw).map((loc) => {
    const hours = buildAirQualityHours(loc.hourly, loc.utc_offset_seconds);
    if (hours.some((h) => h.aod550 === undefined || h.pm25UgM3 === undefined)) {
      partial = true;
    }
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      hours,
    };
  });

  return { data, partial };
}

/* ─────────────────────────── Normalization ─────────────────────────── */

function buildWeatherHours(
  hourly: z.infer<typeof weatherHourlySchema>,
  utcOffsetSeconds: number,
): WeatherHour[] {
  const hours: WeatherHour[] = [];
  const n = hourly.time.length;

  for (let i = 0; i < n; i++) {
    const low = hourly.cloud_cover_low[i];
    const mid = hourly.cloud_cover_mid[i];
    const high = hourly.cloud_cover_high[i];

    // Cloud is the core visibility input: an hour with no cloud data must not
    // be silently treated as "clear". Drop the hour; the scoring layer already
    // degrades honestly ("cloud data unavailable") when hours are missing.
    if (low === null || mid === null || high === null) continue;

    hours.push({
      timeMs: localIsoToMs(hourly.time[i], utcOffsetSeconds),
      cloudLowFrac: low / 100,
      cloudMidFrac: mid / 100,
      cloudHighFrac: high / 100,
      tempC: hourly.temperature_2m[i] ?? undefined,
      dewPointC: hourly.dew_point_2m[i] ?? undefined,
      relHumidityPct: hourly.relative_humidity_2m[i] ?? undefined,
      windKph: hourly.wind_speed_10m[i] ?? undefined,
    });
  }

  return hours;
}

function buildAirQualityHours(
  hourly: z.infer<typeof airQualityHourlySchema>,
  utcOffsetSeconds: number,
): AirQualityHour[] {
  const hours: AirQualityHour[] = [];
  const n = hourly.time.length;

  for (let i = 0; i < n; i++) {
    hours.push({
      timeMs: localIsoToMs(hourly.time[i], utcOffsetSeconds),
      pm25UgM3: hourly.pm2_5[i] ?? undefined,
      aod550: hourly.aerosol_optical_depth[i] ?? undefined,
    });
  }

  return hours;
}