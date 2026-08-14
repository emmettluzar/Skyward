/**
 * Deterministic upstream response fixtures for the Playwright smoke test.
 *
 * The app's upstream calls (Open-Meteo, Valhalla, Overpass) happen *inside*
 * Next.js route handlers — server→server fetches that a browser Service Worker
 * (MSW) cannot intercept. The smoke test therefore stubs the app's own `/api/*`
 * boundary with Playwright `page.route()`, so the route handlers never execute
 * and zero external network calls occur in CI (.clinerules §6).
 *
 * These objects match the client-facing shapes in lib/types.
 */

import type {
  ConditionsPoint,
  ConditionsResponse,
  HourCondition,
} from "../../lib/types/conditions";
import type { VerdictResponse } from "../../lib/types/verdict";
import type {
  CandidatesResponse,
  CandidateSpot,
  IsochroneResponse,
} from "../../lib/types/places";

const HOUR_MS = 3_600_000;

function makeHours(startMs: number, count: number): HourCondition[] {
  const hours: HourCondition[] = [];
  for (let i = 0; i < count; i++) {
    hours.push({
      timeMs: startMs + i * HOUR_MS,
      cloudLowFrac: 0.1,
      cloudMidFrac: 0.15,
      cloudHighFrac: 0.2,
      tempC: 14,
      dewPointC: 9,
      windKph: 8,
      relHumidityPct: 60,
      aod550: 0.08,
      pm25UgM3: 5,
      moonAltitudeDeg: i < 6 ? 20 : -10,
      moonIllumFrac: 0.08,
      twilight: i < 4 ? "daylight" : i < 6 ? "civil" : "astro",
      goAbility: 0.82,
    });
  }
  return hours;
}

/** A clear, new-moon, Bortle-2-style conditions point for the smoke test. */
export function makeConditionsPoint(overrides: Partial<ConditionsPoint> = {}): ConditionsPoint {
  const now = 1_800_000_000_000; // fixed epoch for deterministic tests
  const base: ConditionsPoint = {
    lat: 40.7128,
    lon: -74.006,
    roundedLat: 40.713,
    roundedLon: -74.006,
    timezone: "America/New_York",
    utcOffsetSeconds: -14_400,
    moonPhaseLabel: "New Moon",
    moonIllumFrac: 0.05,
    moonRiseMs: now + 2 * HOUR_MS,
    moonSetMs: now + 14 * HOUR_MS,
    astroDuskMs: now - 2 * HOUR_MS,
    astroDawnMs: now + 12 * HOUR_MS,
    hours: makeHours(now - 2 * HOUR_MS, 13),
    provenance: {
      weatherSourceName: "Open-Meteo",
      weatherForecastThroughMs: now + 12 * HOUR_MS,
      airQualitySourceName: "Open-Meteo Air Quality",
      airQualityForecastThroughMs: now + 12 * HOUR_MS,
      ephemerisSourceName: "astronomy-engine",
    },
  };
  return { ...base, ...overrides };
}

export const conditionsResponse: ConditionsResponse = {
  points: [makeConditionsPoint()],
  generatedAtMs: 1_800_000_000_000,
  partial: [],
  estimated: false,
};

export const verdictResponse: VerdictResponse = {
  verdict: "GO",
  reasons: ["≈ Bortle 2", "42 min drive", "Clear after 11pm", "New moon"],
  wTonight: 14.2,
  cloudFactor: 0.9,
  deltaQ: 18.4,
  driveTimeMin: 42,
  estimated: false,
  partial: [],
  conditions: makeConditionsPoint(),
  generatedAtMs: 1_800_000_000_000,
};

const deepLinks = {
  googleMaps:
    "https://www.google.com/maps/dir/?api=1&destination=41.123456,-74.123456",
  appleMaps: "https://maps.apple.com/?daddr=41.123456,-74.123456",
  waze: "https://waze.com/ul?ll=41.123456,-74.123456&navigate=yes",
  geo: "geo:41.123456,-74.123456",
};

function makeSpot(rank: number): CandidateSpot {
  return {
    osmId: `node/1000${rank}`,
    lat: 41.123456,
    lon: -74.123456 + rank * 0.01,
    name: rank === 1 ? "Stargazer Pull-off" : `Dark Field ${rank}`,
    type: "pull-off",
    accessConfidence: "likely-public",
    parkingQuality: 0.9,
    openness: 0.85,
    rawCellLat: 41.12,
    rawCellLon: -74.12,
    distKmFromCell: 0.4,
    snapScore: 0.71,
    sqmMpsas: null,
    deepLinks,
    driveTimeMin: 40 + rank * 5,
    driveTimeEstimated: false,
    distKmFromOrigin: 48 + rank * 4,
    score: 0.72 - rank * 0.05,
    scoreReasons: ["open sky / greenery 85%", "public access 80%"],
    rank,
  };
}

const timeBudgetCandidates: CandidatesResponse = {
  origin: { lat: 40.7128, lon: -74.006 },
  mode: "timebudget",
  spots: [makeSpot(1), makeSpot(2), makeSpot(3)],
  partial: [],
  estimated: false,
  generatedAtMs: 1_800_000_000_000,
};

/** A small triangular isochrone polygon around the origin. */
const isochrone: IsochroneResponse = {
  origin: { lat: 40.7128, lon: -74.006 },
  budgetMin: 45,
  geojson: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-74.3, 40.9],
              [-73.7, 40.9],
              [-74.0, 41.3],
              [-74.3, 40.9],
            ],
          ],
        },
      },
    ],
  },
  estimated: false,
  partial: [],
  generatedAtMs: 1_800_000_000_000,
};

export const timeBudgetResult = {
  candidates: timeBudgetCandidates,
  isochrone,
};

/** Well-formed Google Maps directions link the smoke test asserts against. */
export const EXPECTED_DIRECTIONS_PREFIX =
  "https://www.google.com/maps/dir/?api=1&destination=";