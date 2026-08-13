/**
 * Offline ephemeris (prd.md §5) — sun/moon/twilight computed locally with
 * `astronomy-engine` (MIT). NEVER call an API for this .clinerules §1; it must
 * work offline.
 *
 * Functions are pure w.r.t. time: every calculation takes an injected epoch-ms
 * timestamp and a location, so they are deterministic and unit-testable.
 */

import {
  Body,
  Observer,
  Equator,
  Horizon,
  Illumination,
  MoonPhase,
  SearchAltitude,
  SearchRiseSet,
  SearchMoonPhase,
} from "astronomy-engine";

import type { TwilightState } from "@/lib/types/conditions";

const MS_PER_DAY = 86_400_000;

/** Solar altitude below which astronomical twilight ends (deg). */
const TWILIGHT_ASTRO_ALT = -18;
const TWILIGHT_NAUTICAL_ALT = -12;
const TWILIGHT_CIVIL_ALT = -6;

export interface EphemerisPoint {
  timeMs: number;
  /** Sun altitude, degrees (corrected for refraction when above horizon). */
  sunAltDeg: number;
  /** Moon altitude, degrees. */
  moonAltDeg: number;
  /** Illuminated fraction of the lunar disk, 0–1. */
  moonIllumFrac: number;
  /** Optical phase angle, 0–360 (0 = new, 180 = full). */
  moonPhaseAngle: number;
}

export interface TwilightWindow {
  /** Astronomical dusk (Sun descending through -18°), epoch ms. */
  duskMs: number | null;
  /** Astronomical dawn (Sun ascending through -18°), epoch ms. */
  dawnMs: number | null;
}

export interface MoonRiseSet {
  riseMs: number | null;
  setMs: number | null;
}

/** Build an astronomy-engine Observer from a 3-dp-rounded coordinate. */
function makeObserver(lat: number, lon: number, elevationM = 0): Observer {
  return new Observer(lat, lon, elevationM);
}

/** Altitude of a body's center for the given time/location. */
function bodyAltitude(
  body: Body,
  dateMs: number,
  lat: number,
  lon: number,
  elevationM = 0,
): number {
  const observer = makeObserver(lat, lon, elevationM);
  const eq = Equator(body, new Date(dateMs), observer, true, true);
  const hor = Horizon(new Date(dateMs), observer, eq.ra, eq.dec, "normal");
  return hor.altitude;
}

/** Sun/moon state for a single instant. */
export function ephemerisAt(
  lat: number,
  lon: number,
  timeMs: number,
  elevationM = 0,
): EphemerisPoint {
  const date = new Date(timeMs);

  const sunAlt = bodyAltitude(Body.Sun, timeMs, lat, lon, elevationM);
  const moonAlt = bodyAltitude(Body.Moon, timeMs, lat, lon, elevationM);

  const illum = Illumination(Body.Moon, date);
  const moonIllumFrac = Math.min(1, Math.max(0, illum.phase_fraction));

  const moonPhaseAngle = ((MoonPhase(date) % 360) + 360) % 360;

  return {
    timeMs,
    sunAltDeg: sunAlt,
    moonAltDeg: moonAlt,
    moonIllumFrac,
    moonPhaseAngle,
  };
}

/**
 * Sample ephemeris at a fixed cadence over [startMs, endMs).
 * `stepMin` defaults to 60 (one sample/hour).
 */
export function sampleEphemeris(
  lat: number,
  lon: number,
  startMs: number,
  endMs: number,
  stepMin = 60,
  elevationM = 0,
): EphemerisPoint[] {
  const stepMs = stepMin * 60_000;
  const count = Math.max(0, Math.ceil((endMs - startMs) / stepMs));

  const points: EphemerisPoint[] = [];
  for (let i = 0; i < count; i++) {
    const timeMs = startMs + i * stepMs;
    points.push(ephemerisAt(lat, lon, timeMs, elevationM));
  }

  return points;
}

/** Classify the Sun's altitude into a twilight state (prd.md §5 Row 1). */
export function classifyTwilight(sunAltDeg: number): TwilightState {
  if (sunAltDeg >= TWILIGHT_CIVIL_ALT) return "daylight";
  if (sunAltDeg >= TWILIGHT_NAUTICAL_ALT) return "civil";
  if (sunAltDeg >= TWILIGHT_ASTRO_ALT) return "nautical";
  return "astro";
}

/**
 * Astronomical dusk/dawn bounding the night that contains `dateMs` (or the
 * upcoming night if `dateMs` is during daylight).
 *
 * Robust pairing strategy: find the next dawn (Sun ascending through -18°),
 * then find the dusk (Sun descending through -18°) immediately before it.
 * This yields [dusk, dawn] correctly whether "now" is daytime or night-time,
 * and returns null for either bound in polar cases with no astronomical dark.
 */
export function findAstroTwilight(
  lat: number,
  lon: number,
  dateMs: number,
  elevationM = 0,
): TwilightWindow {
  const observer = makeObserver(lat, lon, elevationM);

  // Next astronomical dawn (ascending through -18°), searching up to 2 days.
  const dawn = SearchAltitude(
    Body.Sun,
    observer,
    +1,
    new Date(dateMs),
    +2,
    TWILIGHT_ASTRO_ALT,
  );

  let duskMs: number | null = null;
  if (dawn) {
    // Dusk immediately before that dawn (descending through -18°).
    const dusk = SearchAltitude(
      Body.Sun,
      observer,
      -1,
      dawn.date,
      -1,
      TWILIGHT_ASTRO_ALT,
    );
    if (dusk) duskMs = dusk.date.getTime();
  }

  return {
    duskMs,
    dawnMs: dawn ? dawn.date.getTime() : null,
  };
}

/** Moon rise/set around `dateMs` (up to 2 days each direction). */
export function findMoonRiseSet(
  lat: number,
  lon: number,
  dateMs: number,
  elevationM = 0,
): MoonRiseSet {
  const observer = makeObserver(lat, lon, elevationM);

  const rise = SearchRiseSet(Body.Moon, observer, +1, new Date(dateMs), 2);
  const set = SearchRiseSet(Body.Moon, observer, -1, new Date(dateMs), 2);

  return {
    riseMs: rise ? rise.date.getTime() : null,
    setMs: set ? set.date.getTime() : null,
  };
}

/** Friendly phase label from the Moon's ecliptic phase angle (0–360). */
export function moonPhaseLabelFromAngle(angleDeg: number): string {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return "New Moon";
  if (a < 67.5) return "Waxing Crescent";
  if (a < 112.5) return "First Quarter";
  if (a < 157.5) return "Waxing Gibbous";
  if (a < 202.5) return "Full Moon";
  if (a < 247.5) return "Waning Gibbous";
  if (a < 292.5) return "Third Quarter";
  return "Waning Crescent";
}

/** Time of the next new moon after `dateMs`, epoch ms. */
export function nextNewMoonMs(dateMs: number): number | null {
  const result = SearchMoonPhase(0, new Date(dateMs), 30);
  return result ? result.date.getTime() : null;
}

/** Whole days from `fromMs` to `toMs` (rounded to nearest day). */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}
