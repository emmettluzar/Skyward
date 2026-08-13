/**
 * Observing quality Q (prd.md §4.1).
 *
 *   Q = 100 · S_dark · C_cloud · T_trans · M_moon · H_open · A_access
 *
 * Multiplicative by design: any near-zero factor must veto the trip. An
 * overcast Bortle 1 site scores ~0, which is correct. Each factor ∈ [0, 1] and
 * is evaluated over the injected observing window (pure; no I/O, no Date.now).
 */

import { SCORING_CONFIG } from "./config";
import type {
  AccessInput,
  CloudLayerHour,
  Hemisphere,
  MoonHour,
} from "@/lib/types/scoring";

/** Result shape for a single factor (value + human-readable reasons). */
export interface FactorResult {
  value: number;
  reasons: string[];
}

/** Result of the full Q computation. */
export interface QualityResult {
  /** Q, scaled to 0–100. */
  value: number;
  factors: {
    S_dark: number;
    C_cloud: number;
    T_trans: number;
    M_moon: number;
    H_open: number;
    A_access: number;
  };
  /** Combined reason chips across all factors. */
  reasons: string[];
}

/** Inputs required to compute Q. */
export interface QualityInput {
  sqmMpsas: number;
  cloudHours: readonly CloudLayerHour[];
  transparency: {
    aod550: number;
    relHumidityPct: number;
    pm25UgM3: number;
    seeingBonus: number;
  };
  moonHours: readonly MoonHour[];
  horizon: {
    horizonElevDeg: readonly number[];
    canopyFraction200m: number;
    elevationM: number;
    hemisphere: Hemisphere;
  };
  access: AccessInput;
}

/** Clamp a value into [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/**
 * S_dark — darkness factor, γ-shaped with diminishing returns.
 *
 * S_dark = clamp((SQM - 17.5) / (21.95 - 17.5), 0, 1) ^ 0.85
 */
export function darknessFactor(sqmMpsas: number): FactorResult {
  const { sqmFloor, sqmCeiling, gamma } = SCORING_CONFIG.darkness;
  const t = clamp((sqmMpsas - sqmFloor) / (sqmCeiling - sqmFloor), 0, 1);
  const value = Math.pow(t, gamma);
  return {
    value,
    reasons: [`zenith SQM ${sqmMpsas.toFixed(1)} mpsas`],
  };
}

/**
 * C_cloud — clear-sky factor, layer-weighted.
 *
 *   c_low, c_mid, c_high ∈ [0,1] (window-averaged)
 *   C_cloud = (1 - c_low)^1.0 · (1 - c_mid)^0.85 · (1 - c_high)^0.55
 *
 * Low cloud/fog is opaque; cirrus dims but doesn't block. A fog penalty is
 * applied when the dew spread is small AND wind is light. We also surface the
 * clearest hour as a separate reason chip.
 */
export function cloudFactor(
  hours: readonly CloudLayerHour[],
): FactorResult {
  const { lowExponent, midExponent, highExponent, fogPenalty, fogDewSpreadC, fogWindKph } =
    SCORING_CONFIG.cloud;

  if (hours.length === 0) {
    // No cloud data: degrade gracefully and be honest about it.
    return { value: 1, reasons: ["cloud data unavailable"] };
  }

  const avg = (sel: (h: CloudLayerHour) => number) =>
    hours.reduce((sum, h) => sum + sel(h), 0) / hours.length;

  const cLow = avg((h) => h.cloudLowFrac);
  const cMid = avg((h) => h.cloudMidFrac);
  const cHigh = avg((h) => h.cloudHighFrac);

  let cCloud =
    Math.pow(1 - cLow, lowExponent) *
    Math.pow(1 - cMid, midExponent) *
    Math.pow(1 - cHigh, highExponent);

  const reasons: string[] = [];

  // Fog risk: small dew spread + light wind ⇒ an extra opacity penalty.
  const dewSpread = hours.reduce((sum, h) => {
    const spread =
      h.tempC !== undefined && h.dewPointC !== undefined
        ? h.tempC - h.dewPointC
        : Infinity;
    return Math.min(sum, spread);
  }, Infinity);

  const minWind = hours.reduce((sum, h) => {
    return Math.min(sum, h.windKph ?? Infinity);
  }, Infinity);

  const fogRisk = dewSpread < fogDewSpreadC && minWind < fogWindKph;

  if (fogRisk) {
    cCloud *= fogPenalty;
    reasons.push("fog risk — bring a dew shield");
  }

  // Best-hour cloud: max over hours of the product of the three layer terms.
  let bestHour = 0;
  let bestLabel: string | undefined;
  for (const h of hours) {
    const score =
      Math.pow(1 - h.cloudLowFrac, lowExponent) *
      Math.pow(1 - h.cloudMidFrac, midExponent) *
      Math.pow(1 - h.cloudHighFrac, highExponent);
    if (score > bestHour) {
      bestHour = score;
      bestLabel = h.label;
    }
  }

  reasons.push(
    `cloud ${(cCloud * 100).toFixed(0)}% clear${
      bestHour > cCloud + 0.05 && bestLabel
        ? `, clearest ${bestLabel}`
        : ""
    }`,
  );

  if (cLow > 0.1) reasons.push("low cloud / fog layer present");
  else if (cHigh > 0.4) reasons.push("high cirrus may dim, not block");

  return { value: clamp(cCloud, 0, 1), reasons };
}

/**
 * T_trans — atmospheric transparency.
 *
 *   T_trans = exp(-1.9 · max(0, AOD550 - 0.05))
 *           · (1 - 0.25 · clamp((RH - 70)/30, 0, 1))
 *           · (1 - 0.30 · clamp(PM2.5 / 60, 0, 1))
 *           · seeing_bonus                         # from 7Timer, ±5%
 */
export function transparencyFactor(input: {
  aod550: number;
  relHumidityPct: number;
  pm25UgM3: number;
  seeingBonus: number;
}): FactorResult {
  const { aodKappa, aodFloor, rhOffset, rhSpan, rhWeight, pm25Denominator, pm25Weight } =
    SCORING_CONFIG.transparency;

  const aodTerm = Math.exp(-aodKappa * Math.max(0, input.aod550 - aodFloor));
  const rhTerm = 1 - rhWeight * clamp((input.relHumidityPct - rhOffset) / rhSpan, 0, 1);
  const pmTerm = 1 - pm25Weight * clamp(input.pm25UgM3 / pm25Denominator, 0, 1);

  const reasons: string[] = [];
  if (input.aod550 > aodFloor) reasons.push(`AOD ${input.aod550.toFixed(2)} — haze`);
  if (input.relHumidityPct > rhOffset) reasons.push(`RH ${input.relHumidityPct.toFixed(0)}% — humid`);
  if (input.pm25UgM3 > 20) reasons.push(`PM2.5 ${input.pm25UgM3.toFixed(0)} μg/m³ — smoke/haze`);

  const value = aodTerm * rhTerm * pmTerm * input.seeingBonus;
  return { value: clamp(value, 0, 1), reasons };
}

/**
 * M_moon — moon interference.
 *
 *   f_up = fraction of observing window with Moon above horizon, weighted by
 *          sin(altitude) (moon low ≈ less sky glow)
 *   I    = illuminated fraction (0..1)
 *   M_moon = 1 - 0.88 · f_up · I^1.4
 */
export function moonFactor(hours: readonly MoonHour[]): FactorResult {
  const { scale, illumExponent } = SCORING_CONFIG.moon;

  if (hours.length === 0) {
    return { value: 1, reasons: ["moon data unavailable"] };
  }

  // f_up: fraction of the window with the Moon up, weighted by sin(altitude).
  const fUp =
    hours.reduce((sum, h) => {
      const weighted = Math.max(0, Math.sin((Math.PI / 180) * h.altitudeDeg));
      return sum + weighted;
    }, 0) / hours.length;

  const avgIllum = hours.reduce((sum, h) => sum + h.illumFrac, 0) / hours.length;

  const interference = scale * fUp * Math.pow(avgIllum, illumExponent);
  const value = 1 - interference;

  const reasons: string[] = [];
  if (avgIllum > 0.9 && fUp > 0.5) reasons.push("full moon up much of the night");
  else if (avgIllum > 0.5) reasons.push("bright moon interferes");
  else if (avgIllum > 0.15) reasons.push("crescent moon — minor glow");
  else reasons.push("moonless night");

  return { value: clamp(value, 0, 1), reasons };
}

/**
 * H_open — horizon openness / terrain & canopy.
 *
 *   horizon profile h(az) sampled every 10° from DEM within 20 km
 *   blocked = fraction of azimuths with horizon elevation > 12°
 *   H_open = (1 - 0.6·blocked) · (1 - 0.5·canopy_fraction_200m) · elevation_bonus
 *
 * The southern quadrant (azimuth 135°–225° in the N hemisphere) is weighted
 * 1.5× because it holds the Milky Way core; mirrored for the S hemisphere.
 */
export function horizonFactor(input: {
  /** Horizon elevations, degrees, per azimuth (36 samples, every 10°). */
  horizonElevDeg: readonly number[];
  canopyFraction200m: number;
  elevationM: number;
  hemisphere: Hemisphere;
}): FactorResult {
  const {
    blockedWeight,
    blockedThresholdDeg,
    canopyWeight,
    maxElevationBonus,
    elevationSaturateM,
    southernWeight,
  } = SCORING_CONFIG.horizon;

  let blockedSum = 0;
  let totalWeight = 0;
  const n = input.horizonElevDeg.length;
  for (let i = 0; i < n; i++) {
    const az = (360 / n) * i;
    const isSouth =
      input.hemisphere === "north"
        ? az >= 135 && az < 225
        : az >= 315 || az < 45;
    const w = isSouth ? southernWeight : 1;
    totalWeight += w;
    if (input.horizonElevDeg[i] > blockedThresholdDeg) blockedSum += w;
  }

  const blocked = totalWeight > 0 ? blockedSum / totalWeight : 0;
  const blockedTerm = 1 - blockedWeight * blocked;
  const canopyTerm = 1 - canopyWeight * clamp(input.canopyFraction200m, 0, 1);
  const elevationBonus =
    1 + maxElevationBonus * clamp(input.elevationM / elevationSaturateM, 0, 1);

  const reasons: string[] = [];
  if (blocked > 0.33) reasons.push("terrain blocks much of the horizon");
  else if (blocked > 0.1) reasons.push("some horizon blockage");
  if (input.canopyFraction200m > 0.3) reasons.push("tree canopy limits open sky");
  if (input.elevationM > 1000) reasons.push(`elevation ${Math.round(input.elevationM)} m — above haze`);

  const value = blockedTerm * canopyTerm * elevationBonus;
  return { value: clamp(value, 0, 1), reasons };
}

/**
 * A_access — practical accessibility. Start at 1.0 and multiply penalties.
 *
 *   × 0.55 if no public road within 400 m
 *   × 0.75 if no legal parking / pull-off identified
 *   × 0.85 if last road segment is unpaved
 *   × 0.60 if inside access=private / no public access
 *   × 0.90 if gate/opening_hours closes before the observing window ends
 *   × 1.05 if certified Dark Sky Place
 */
export function accessFactor(input: AccessInput): FactorResult {
  const a = SCORING_CONFIG.access;

  let value = 1;
  const reasons: string[] = [];

  if (!input.hasPublicRoadWithin400m) {
    value *= a.noPublicRoadPenalty;
    reasons.push("no public road within 400 m");
  }
  if (!input.hasLegalParking) {
    value *= a.noParkingPenalty;
    reasons.push("no legal parking identified");
  }
  if (input.lastRoadUnpaved) {
    value *= a.unpavedRoadPenalty;
    reasons.push("last road segment unpaved");
  }
  if (input.accessPrivateOrNo) {
    value *= a.privateAccessPenalty;
    reasons.push("private access — verify before going");
  }
  if (input.closesBeforeWindowEnd) {
    value *= a.gateClosurePenalty;
    reasons.push("gate/opening hours close before window ends");
  }
  if (input.certifiedDarkSkyPlace) {
    value *= a.darkSkyPlaceBonus;
    reasons.push("certified Dark Sky Place — curated & safe");
  }

  return { value, reasons };
}

/**
 * Full observing quality Q (0–100), multiplicative over all six factors.
 */
export function qualityScore(input: QualityInput): QualityResult {
  const sDark = darknessFactor(input.sqmMpsas);
  const cCloud = cloudFactor(input.cloudHours);
  const tTrans = transparencyFactor(input.transparency);
  const mMoon = moonFactor(input.moonHours);
  const hOpen = horizonFactor(input.horizon);
  const aAccess = accessFactor(input.access);

  const value =
    SCORING_CONFIG.quality.scale *
    sDark.value *
    cCloud.value *
    tTrans.value *
    mMoon.value *
    hOpen.value *
    aAccess.value;

  return {
    value,
    factors: {
      S_dark: sDark.value,
      C_cloud: cCloud.value,
      T_trans: tTrans.value,
      M_moon: mMoon.value,
      H_open: hOpen.value,
      A_access: aAccess.value,
    },
    reasons: [
      ...sDark.reasons,
      ...cCloud.reasons,
      ...tTrans.reasons,
      ...mMoon.reasons,
      ...hOpen.reasons,
      ...aAccess.reasons,
    ],
  };
}