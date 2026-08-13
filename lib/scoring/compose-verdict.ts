/**
 * Pure composition of the full Mode-2 verdict from live conditions + darkness.
 * No I/O, no Date.now() — time (earliest departure, bedtime, now) is injected.
 *
 * This is the only place the scoring factors are assembled into a user-facing
 * verdict. It degrades honestly: when the darkness model (Phase 0 raster) is
 * not yet available, it returns "UNKNOWN" with the live C_cloud/M_moon/T_trans
 * factors surfaced as reason chips rather than fabricating a GO/STAY-HOME.
 *
 * Neutral defaults used here (horizon = flat/open, access = public) are flagged
 * in the response `partial` list — they are explicitly *not* measurements.
 */

import type { ConditionsPoint } from "@/lib/types/conditions";
import type { ApiVerdict, VerdictResponse } from "@/lib/types/verdict";

import {
  cloudFactor,
  moonFactor,
  transparencyFactor,
  qualityScore,
  type QualityResult,
} from "./quality";
import {
  cloudHoursFromWindow,
  moonHoursFromWindow,
  sliceToWindow,
  transparencyFromWindow,
} from "./from-conditions";
import { computeWindow } from "./window";
import { worthIt } from "./worthit";
import { decideVerdict } from "./verdict";

const MS_PER_MIN = 60_000;

export interface ComposeVerdictInput {
  home: ConditionsPoint;
  /** Candidate site; null means "evaluate home only" (no site selected). */
  site: ConditionsPoint | null;
  /** Modeled zenith SQM at home (null when the darkness raster is absent). */
  sqmHome: number | null;
  sqmSite: number | null;
  /** One-way drive time, minutes. */
  driveTimeMin: number;
  /** Round-trip distance, km. */
  distKm: number;
  /** Fuel price per litre in the user's currency. */
  fuelPricePerLitre: number;
  /** Earliest departure from home, epoch ms. */
  earliestDepartureMs: number;
  /** Bedtime, epoch ms. */
  bedtimeMs: number;
}

/**
 * Flat, unobstructed horizon + neutral public access. These are Phase 1
 * defaults for enrichments not yet wired (DEM/canopy and OSM access), not
 * measurements — the caller records them in the response `partial` list.
 */
const NEUTRAL_HORIZON = {
  horizonElevDeg: Array<number>(36).fill(0),
  canopyFraction200m: 0,
  elevationM: 0,
  hemisphere: "north" as const,
};

const NEUTRAL_ACCESS = {
  hasPublicRoadWithin400m: true,
  hasLegalParking: true,
  lastRoadUnpaved: false,
  accessPrivateOrNo: false,
  closesBeforeWindowEnd: false,
  certifiedDarkSkyPlace: false,
};

/** Full Q for one point using the canonical qualityScore (prd.md §4.1). */
function qualityForPoint(
  point: ConditionsPoint,
  sqmMpsas: number,
  startMs: number,
  endMs: number,
): QualityResult {
  const windowHours = sliceToWindow(point.hours, startMs, endMs);

  return qualityScore({
    sqmMpsas,
    cloudHours: cloudHoursFromWindow(windowHours),
    transparency: transparencyFromWindow(windowHours),
    moonHours: moonHoursFromWindow(windowHours),
    horizon: NEUTRAL_HORIZON,
    access: NEUTRAL_ACCESS,
  });
}

/** Live, darkness-independent chips for the degraded UNKNOWN state. */
function liveChips(point: ConditionsPoint): string[] {
  const chips: string[] = [];

  const cloudHours = cloudHoursFromWindow(point.hours);
  if (cloudHours.length > 0) {
    const c = cloudFactor(cloudHours);
    chips.push(c.reasons.find((r) => r.startsWith("cloud")) ?? "cloud data unavailable");
  } else {
    chips.push("cloud data unavailable");
  }

  const moon = moonFactor(moonHoursFromWindow(point.hours));
  chips.push(moon.reasons[0] ?? "moon data unavailable");

  const t = transparencyFactor(transparencyFromWindow(point.hours));
  if (t.reasons.length > 0) chips.push(t.reasons[0]);

  const firstWeather = point.hours.find((h) => h.tempC !== null);
  if (firstWeather) chips.push(`${Math.round(firstWeather.tempC as number)}°C during the night`);

  return dedupe(chips).slice(0, 3);
}

/**
 * Build the verdict response. Returns UNKNOWN (not a fabricated call) whenever
 * the darkness model is unavailable; otherwise runs the full scoring pipeline.
 */
export function composeVerdict(input: ComposeVerdictInput): VerdictResponse {
  const partial: string[] = [];
  const site = input.site ?? input.home;

  // Phase 1 enrichment gaps are honest, not neutral measurements.
  partial.push("seeing"); // 7Timer not wired yet (neutral 1.0)
  partial.push("horizon"); // no DEM/canopy enrichment yet (flat/open default)
  partial.push("access"); // no OSM access enrichment yet (public default)

  const canScoreDarkness =
    input.sqmHome !== null && (input.site ? input.sqmSite !== null : true);

  if (!canScoreDarkness) {
    partial.push("darkness");
    const cloudHours = cloudHoursFromWindow(site.hours);
    return {
      verdict: "UNKNOWN",
      reasons: dedupe([
        "darkness model not yet published (Phase 0)",
        ...liveChips(site),
      ]).slice(0, 4),
      wTonight: null,
      cloudFactor: cloudHours.length > 0 ? cloudFactor(cloudHours).value : null,
      deltaQ: null,
      driveTimeMin: input.driveTimeMin,
      estimated: false,
      partial,
      conditions: site,
      generatedAtMs: input.earliestDepartureMs,
    };
  }

  // canScoreDarkness (guarded above) guarantees these are non-null here.
  const sqm = (input.site ? input.sqmSite : input.sqmHome)!;
  const sqmHome = input.sqmHome!;

  // Observing window from the site's astronomical dusk/dawn, or a degenerate
  // zero window when either bound is null (polar/no-dark case).
  const dusk = site.astroDuskMs ?? 0;
  const dawn = site.astroDawnMs ?? 0;
  const win = computeWindow({
    astroDuskMs: dusk,
    astroDawnMs: dawn,
    earliestDepartureMs: input.earliestDepartureMs,
    driveTimeMin: input.driveTimeMin,
    bedtimeMs: input.bedtimeMs,
  });

  const siteQ = qualityForPoint(site, sqm, win.startMs, win.endMs);
  const homeQ = qualityForPoint(input.home, sqmHome, win.startMs, win.endMs);

  const w = worthIt({
    qSite: siteQ.value,
    qHome: homeQ.value,
    driveTimeMin: input.driveTimeMin,
    distKm: input.distKm,
    fuelPricePerLitre: input.fuelPricePerLitre,
    arriveHomeMs: win.endMs + input.driveTimeMin * MS_PER_MIN,
    bedtimeMs: input.bedtimeMs,
  });

  const decision = decideVerdict({
    wTonight: w.value,
    cloudFactor: siteQ.factors.C_cloud,
    qSite: siteQ.value,
    qHome: homeQ.value,
    windowTooShort: win.tooShort,
  });

  return {
    verdict: decision.verdict as ApiVerdict,
    reasons: dedupe([...decision.reasons, ...siteQ.reasons]).slice(0, 4),
    wTonight: w.value,
    cloudFactor: siteQ.factors.C_cloud,
    deltaQ: w.deltaQ,
    driveTimeMin: input.driveTimeMin,
    estimated: false,
    partial,
    conditions: site,
    generatedAtMs: input.earliestDepartureMs,
  };
}

function dedupe(items: readonly string[]): string[] {
  return Array.from(new Set(items));
}