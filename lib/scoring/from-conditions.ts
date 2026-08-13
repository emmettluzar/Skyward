/**
 * Pure bridge from live conditions (`HourCondition[]`) to the scoring engine's
 * typed inputs (prd.md §4). No I/O, no Date.now() — time is always injected.
 *
 * This is also where the per-hour "go-ability" heat value (prd.md §5 Row 4)
 * is derived: goAbility = C_cloud · M_moon · T_trans per hour, reusing the
 * canonical factor functions so the ribbon never disagrees with the verdict.
 */

import type { CloudLayerHour, MoonHour } from "@/lib/types/scoring";
import type { HourCondition } from "@/lib/types/conditions";

import { cloudFactor, moonFactor, transparencyFactor } from "./quality";

/** A weather+ephemeris hour before the derived `goAbility` is attached. */
export type HourConditionInput = Omit<HourCondition, "goAbility">;

/** Convert one nullable-weather hour into a scoring CloudLayerHour. */
export function toCloudLayerHour(hour: HourConditionInput): CloudLayerHour | null {
  if (
    hour.cloudLowFrac === null ||
    hour.cloudMidFrac === null ||
    hour.cloudHighFrac === null
  ) {
    return null;
  }

  return {
    cloudLowFrac: hour.cloudLowFrac,
    cloudMidFrac: hour.cloudMidFrac,
    cloudHighFrac: hour.cloudHighFrac,
    tempC: hour.tempC ?? undefined,
    dewPointC: hour.dewPointC ?? undefined,
    windKph: hour.windKph ?? undefined,
    label: hourLabel(hour.timeMs),
  };
}

function hourLabel(timeMs: number): string {
  const d = new Date(timeMs);
  const h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${ampm}`;
}

/** Convert one hour into a MoonHour (moon data is always present). */
export function toMoonHour(hour: HourConditionInput): MoonHour {
  return {
    altitudeDeg: hour.moonAltitudeDeg,
    illumFrac: hour.moonIllumFrac,
  };
}

/**
 * Defaults applied when an optional transparency input is missing. These are
 * *not* fabrications — the scoring engine degrades them into near-neutral
 * factors and the partial flags on the response record the gap honestly.
 *
 * AOD 0.05 = the formula's floor (no haze term), RH 50 = mid, PM2.5 5 = ~0,
 * seeingBonus 1.0 = the "7Timer is down" neutral case (.clinerules §4).
 */
const NEUTRAL_TRANSPARENCY = {
  aod550: 0.05,
  relHumidityPct: 50,
  pm25UgM3: 5,
  seeingBonus: 1.0,
};

export function transparencyFromHour(hour: HourConditionInput) {
  return {
    aod550: hour.aod550 ?? NEUTRAL_TRANSPARENCY.aod550,
    relHumidityPct: hour.relHumidityPct ?? NEUTRAL_TRANSPARENCY.relHumidityPct,
    pm25UgM3: hour.pm25UgM3 ?? NEUTRAL_TRANSPARENCY.pm25UgM3,
    // 7Timer seeing is not wired up in Phase 1; the route marks it partial.
    // A neutral 1.0 keeps T_trans honest without inventing a seeing quality.
    seeingBonus: NEUTRAL_TRANSPARENCY.seeingBonus,
  };
}

/**
 * Per-hour go-ability = C_cloud · M_moon · T_trans ∈ [0, 1], or null when
 * cloud data is missing (never fabricate a "clear" signal).
 */
export function hourGoAbility(hour: HourConditionInput): number | null {
  const cloud = toCloudLayerHour(hour);
  if (cloud === null) return null;

  const cCloud = cloudFactor([cloud]).value;
  const mMoon = moonFactor([toMoonHour(hour)]).value;
  const tTrans = transparencyFactor(transparencyFromHour(hour)).value;

  return cCloud * mMoon * tTrans;
}

/** Keep only hours whose start falls within [startMs, endMs). */
export function sliceToWindow(
  hours: readonly HourConditionInput[],
  startMs: number,
  endMs: number,
): HourConditionInput[] {
  return hours.filter((h) => h.timeMs >= startMs && h.timeMs < endMs);
}

/** Window cloud hours, skipping any hour with missing cloud data. */
export function cloudHoursFromWindow(
  hours: readonly HourConditionInput[],
): CloudLayerHour[] {
  const out: CloudLayerHour[] = [];
  for (const h of hours) {
    const c = toCloudLayerHour(h);
    if (c) out.push(c);
  }
  return out;
}

/** Window moon hours (moon data is always present per hour). */
export function moonHoursFromWindow(
  hours: readonly HourConditionInput[],
): MoonHour[] {
  return hours.map(toMoonHour);
}

/**
 * Window-averaged transparency inputs (AOD/RH/PM2.5), skipping missing values.
 * Returns a neutral transparency when no hour has data (honest degradation,
 * flagged via the response `partial` list by the caller).
 */
export function transparencyFromWindow(
  hours: readonly HourConditionInput[],
): {
  aod550: number;
  relHumidityPct: number;
  pm25UgM3: number;
  seeingBonus: number;
} {
  const aod: number[] = [];
  const rh: number[] = [];
  const pm: number[] = [];
  for (const h of hours) {
    if (h.aod550 !== null) aod.push(h.aod550);
    if (h.relHumidityPct !== null) rh.push(h.relHumidityPct);
    if (h.pm25UgM3 !== null) pm.push(h.pm25UgM3);
  }

  const avg = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;

  if (aod.length === 0 && rh.length === 0 && pm.length === 0) {
    return { ...NEUTRAL_TRANSPARENCY };
  }

  return {
    aod550: aod.length > 0 ? avg(aod) : NEUTRAL_TRANSPARENCY.aod550,
    relHumidityPct: rh.length > 0 ? avg(rh) : NEUTRAL_TRANSPARENCY.relHumidityPct,
    pm25UgM3: pm.length > 0 ? avg(pm) : NEUTRAL_TRANSPARENCY.pm25UgM3,
    seeingBonus: NEUTRAL_TRANSPARENCY.seeingBonus,
  };
}
