/**
 * Assembles the client-facing conditions shape by merging the two batched
 * Open-Meteo fetches with offline ephemeris. This is the single place a
 * "Tonight" point is built for the route handlers.
 *
 * Graceful degradation (.clinerules §4): if weather or air-quality fails, the
 * affected fields are null and the `partial` list records the gap — the ribbon
 * shows "no data" for that channel instead of a fabricated clear sky.
 */

import type { ConditionsPoint, HourCondition } from "@/lib/types/conditions";
import {
  fetchForecastBatch,
  fetchAirQualityBatch,
  type AirQualityLocation,
  type GeoPoint,
  type WeatherLocation,
} from "./openmeteo";
import {
  ephemerisAt,
  findAstroTwilight,
  findMoonRiseSet,
  classifyTwilight,
  moonPhaseLabelFromAngle,
} from "@/lib/astronomy/ephemeris";
import {
  hourGoAbility,
  type HourConditionInput,
} from "@/lib/scoring/from-conditions";
import { AppError } from "@/lib/errors";

const RIBBON_HOURS = 13; // 18:00 → 06:00 local, hourly.
const HOUR_MS = 3_600_000;
const MATCH_WINDOW_MS = HOUR_MS / 2;

export interface FetchConditionsResult {
  points: ConditionsPoint[];
  partial: string[];
}

/** Nearest element within `MATCH_WINDOW_MS`, or undefined. */
function nearest<T extends { timeMs: number }>(
  haystack: readonly T[],
  timeMs: number,
): T | undefined {
  let best: T | undefined;
  let bestDelta = MATCH_WINDOW_MS;
  for (const item of haystack) {
    const d = Math.abs(item.timeMs - timeMs);
    if (d < bestDelta) {
      bestDelta = d;
      best = item;
    }
  }
  return best;
}

/** Rough UTC offset from longitude when Open-Meteo is unavailable. */
function roughUtcOffsetSeconds(lon: number): number {
  return Math.round(lon / 15) * 3600;
}

/** The 13 hourly instants of tonight's ribbon in the site's local frame. */
function buildTonightGrid(nowMs: number, utcOffsetSeconds: number): number[] {
  const localNow = nowMs + utcOffsetSeconds * 1000;
  const localDayStart = Math.floor(localNow / 86_400_000) * 86_400_000;
  const localSeventeen = localDayStart + 18 * HOUR_MS;
  const startEpoch = localSeventeen - utcOffsetSeconds * 1000;

  return Array.from({ length: RIBBON_HOURS }, (_, i) => startEpoch + i * HOUR_MS);
}

export async function fetchConditionsForPoints(
  points: readonly GeoPoint[],
  nowMs: number,
): Promise<FetchConditionsResult> {
  const partial: string[] = [];

  // Two upstream calls total, batched over every point (.clinerules §4).
  let weather: WeatherLocation[] = [];
  let weatherOk = false;
  try {
    const w = await fetchForecastBatch(points);
    weather = w.data;
    weatherOk = w.data.length === points.length;
    if (w.partial) partial.push("cloud");
  } catch {
    partial.push("weather");
  }

  let airQuality: AirQualityLocation[] = [];
  try {
    const a = await fetchAirQualityBatch(points);
    airQuality = a.data;
    if (a.partial) partial.push("aod");
  } catch {
    partial.push("air_quality");
  }

  const assembled = points.map((p, i) =>
    assemblePoint(
      p,
      weatherOk ? weather[i] : undefined,
      airQuality[i],
      nowMs,
    ),
  );

  return { points: assembled, partial };
}

function assemblePoint(
  point: GeoPoint,
  weather: WeatherLocation | undefined,
  aq: AirQualityLocation | undefined,
  nowMs: number,
): ConditionsPoint {
  const roundedLat = round3(point.lat);
  const roundedLon = round3(point.lon);

  const utcOffsetSeconds =
    weather?.utcOffsetSeconds ?? roughUtcOffsetSeconds(point.lon);
  const timezone = weather?.timezone ?? "UTC";

  const grid = buildTonightGrid(nowMs, utcOffsetSeconds);

  const hours: HourCondition[] = grid.map((timeMs) => {
    const wh = weather ? nearest(weather.hours, timeMs) : undefined;
    const ah = aq ? nearest(aq.hours, timeMs) : undefined;
    const eph = ephemerisAt(roundedLat, roundedLon, timeMs);

    const base: HourConditionInput = {
      timeMs,
      cloudLowFrac: wh ? wh.cloudLowFrac : null,
      cloudMidFrac: wh ? wh.cloudMidFrac : null,
      cloudHighFrac: wh ? wh.cloudHighFrac : null,
      tempC: wh?.tempC ?? null,
      dewPointC: wh?.dewPointC ?? null,
      windKph: wh?.windKph ?? null,
      relHumidityPct: wh?.relHumidityPct ?? null,
      aod550: ah?.aod550 ?? null,
      pm25UgM3: ah?.pm25UgM3 ?? null,
      moonAltitudeDeg: eph.moonAltDeg,
      moonIllumFrac: eph.moonIllumFrac,
      twilight: classifyTwilight(eph.sunAltDeg),
    };

    return { ...base, goAbility: hourGoAbility(base) };
  });

  const twilight = findAstroTwilight(roundedLat, roundedLon, nowMs);
  const moonRiseSet = findMoonRiseSet(roundedLat, roundedLon, nowMs);
  const nowEph = ephemerisAt(roundedLat, roundedLon, nowMs);

  const weatherThrough =
    weather && weather.hours.length > 0
      ? weather.hours[weather.hours.length - 1].timeMs
      : null;
  const aqThrough =
    aq && aq.hours.length > 0 ? aq.hours[aq.hours.length - 1].timeMs : null;

  return {
    lat: roundedLat,
    lon: roundedLon,
    roundedLat,
    roundedLon,
    timezone,
    utcOffsetSeconds,
    moonPhaseLabel: moonPhaseLabelFromAngle(nowEph.moonPhaseAngle),
    moonIllumFrac: nowEph.moonIllumFrac,
    moonRiseMs: moonRiseSet.riseMs,
    moonSetMs: moonRiseSet.setMs,
    astroDuskMs: twilight.duskMs,
    astroDawnMs: twilight.dawnMs,
    hours,
    provenance: {
      weatherSourceName: "Open-Meteo (CC BY 4.0)",
      weatherForecastThroughMs: weatherThrough,
      airQualitySourceName: "Open-Meteo Air Quality (CC BY 4.0)",
      airQualityForecastThroughMs: aqThrough,
      ephemerisSourceName: "astronomy-engine (MIT) — offline",
    },
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Re-export for error handling convenience in route handlers. */
export { AppError };