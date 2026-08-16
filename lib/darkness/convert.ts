/**
 * Canonical darkness conversions (prd.md §2.1).
 *
 * Internally the model stores and computes *modeled zenith artificial
 * brightness* `b_art` in mcd/m². Everything else — SQM, NELM, Bortle — is a
 * derived presentation of that single internal quantity.
 *
 * The constants below come from the model equations in prd.md §2.1:
 *
 *   b_total  = b_art + b_natural            where b_natural = 0.171168465 mcd/m²
 *   SQM      = log10(b_total / 1.08e8) / -0.4
 *   NELM     = 7.93 - 5 * log10(10^(4.316 - SQM/5) + 1)
 *   ratio    = b_art / b_natural
 *
 * 1.08e8 is the normalizing brightness (mcd/m²) for the magnitude zero-point;
 * 0.171168465 mcd/m² is the natural (moonless, airglow-only) zenith brightness
 * at ~SQM 22.0. Verified below: b_art = 0 ⇒ SQM = 22.00.
 */

/** Natural, moonless zenith sky brightness in mcd/m² (prd.md §2.1). */
export const B_NATURAL_MCD = 0.171168465;

/** Normalizing brightness constant for the SQM zero-point, mcd/m². */
const B_ZERO_MCD = 1.08e8;

/** Scale factor used in the NELM↔SQM relation (prd.md §2.1). */
const NELM_OFFSET = 7.93;

/** Exponent offset used in the NELM↔SQM relation (prd.md §2.1). */
const NELM_SQM_OFFSET = 4.316;

/**
 * Minimum/maximum synthetic bounds used to avoid pathological math at the
 * extremes of the logarithm (e.g. b_art = 0 already yields exactly 22.00, but
 * a negative or NaN input must not produce NaN).
 */
const MIN_BRIGHTNESS_MCD = 1e-12;
const MAX_SQM = 22.0;

/**
 * Modeled zenith sky brightness in mcd/m² → SQM (mag/arcsec²).
 *
 * Pure and monotonic. b_art = 0 ⇒ 22.00 mpsas by construction.
 */
export function sqmFromBrightness(bTotalMcd: number): number {
  const b = Math.max(bTotalMcd, MIN_BRIGHTNESS_MCD);
  const sqm = Math.log10(b / B_ZERO_MCD) / -0.4;
  return Math.min(sqm, MAX_SQM);
}

/**
 * SQM (mag/arcsec²) → NELM (naked-eye limiting magnitude).
 *
 * NELM = 7.93 - 5 · log10(10^(4.316 - SQM/5) + 1)
 */
export function nelmFromSqm(sqmMpsas: number): number {
  const exponent = NELM_SQM_OFFSET - sqmMpsas / 5;
  return NELM_OFFSET - 5 * Math.log10(Math.pow(10, exponent) + 1);
}

/**
 * NELM → SQM (mag/arcsec²), inverting nelmFromSqm.
 *
 * Rearranged from NELM = 7.93 - 5·log10(10^(4.316 - SQM/5) + 1):
 *   10^((7.93 - NELM)/5) - 1 = 10^(4.316 - SQM/5)
 *   SQM = 5·(4.316 - log10(10^((7.93 - NELM)/5) - 1))
 */
export function sqmFromNelm(nelm: number): number {
  const t = Math.pow(10, (NELM_OFFSET - nelm) / 5) - 1;
  // Guard: below SQM ≈ 21.99 the subtraction underflows to 0; clamp to a tiny
  // positive value so the log10 stays defined (matches sqmFromBrightness cap).
  const safe = Math.max(t, 1e-12);
  return 5 * (NELM_SQM_OFFSET - Math.log10(safe));
}

/**
 * Artificial brightness b_art (mcd/m²) → brightness ratio vs. natural sky.
 * "this sky is 3.2× brighter than natural".
 */
export function ratioFromBrightness(bArtMcd: number): number {
  return bArtMcd / B_NATURAL_MCD;
}

/**
 * Total zenith brightness b_art + b_natural (mcd/m²) → NELM.
 *
 * Convenience pipeline: b_total → SQM → NELM.
 */
export function nelmFromBrightness(bTotalMcd: number): number {
  return nelmFromSqm(sqmFromBrightness(bTotalMcd));
}

/**
 * Artificial brightness b_art (mcd/m²) → modeled zenith SQM, using
 * b_total = b_art + b_natural. This is the primary model entry point for a
 * VIIRS radiance-derived artificial zenith brightness value.
 */
export function sqmFromArtificialBrightness(bArtMcd: number): number {
  return sqmFromBrightness(bArtMcd + B_NATURAL_MCD);
}

/**
 * Estimated visible naked-eye star count based on NELM (Naked-Eye Limiting Magnitude).
 *
 * Astronomical star count distributions over the visible hemisphere (half of total sky):
 * - NELM 2.0 (inner city / Bortle 9): ~10–20 stars
 * - NELM 4.0 (suburbs / Bortle 6-7): ~250–350 stars
 * - NELM 5.0 (rural-suburban / Bortle 5): ~800–1,000 stars
 * - NELM 6.0 (rural / Bortle 3-4): ~2,200–2,800 stars
 * - NELM 6.5–7.0+ (pristine dark sky / Bortle 1-2): ~4,500–6,000 stars
 *
 * Fits the exponential stellar density law: N_visible ≈ 0.5 * 10^(0.52 * NELM + 0.35).
 */
export function estimateStarCount(nelm: number): number {
  const safeNelm = Math.max(1.0, Math.min(7.6, nelm));
  const total = 0.5 * Math.pow(10, 0.52 * safeNelm + 0.35);
  return Math.round(total / 25) * 25; // Round to nearest 25 for display cleanliness
}

/**
 * Evaluates Milky Way visibility description based on Bortle class, moon altitude/phase, and cloud cover.
 */
export function getMilkyWayVisibility(
  bortle: number,
  moonIllumFraction = 0,
  moonAltitudeDeg = -90,
  cloudCoverPercent = 0,
): {
  status: "high-contrast" | "visible" | "faint" | "not-visible";
  label: string;
  description: string;
} {
  // Heavy clouds block the sky
  if (cloudCoverPercent > 65) {
    return {
      status: "not-visible",
      label: "Blocked by Clouds",
      description: "Cloud cover obscures Milky Way structure tonight",
    };
  }

  // Bright moon above horizon washes out the Milky Way
  const moonInterfering = moonAltitudeDeg > 0 && moonIllumFraction > 0.45;
  if (moonInterfering) {
    return {
      status: "faint",
      label: "Dimmed by Moonlight",
      description: `Moon (${Math.round(moonIllumFraction * 100)}% lit) reduces contrast`,
    };
  }

  if (bortle <= 2) {
    return {
      status: "high-contrast",
      label: "Brilliant & Detailed",
      description: "Great Rift, dust lanes, and galactic core clearly visible",
    };
  }
  if (bortle <= 4) {
    return {
      status: "visible",
      label: "Clearly Visible",
      description: "Arches overhead with distinct bright patches and structure",
    };
  }
  if (bortle <= 5) {
    return {
      status: "faint",
      label: "Faint / Subdued",
      description: "Faintly detectable near zenith away from horizon glow",
    };
  }
  return {
    status: "not-visible",
    label: "Washed Out",
    description: "Light pollution prevents naked-eye Milky Way observation",
  };
}
