/**
 * SQM → Bortle mapping (prd.md §2.1).
 *
 * Bortle is a *subjective* whole-sky visual judgement (Unihedron/Bortle). We
 * model zenith sky brightness, so this mapping is an **approximation** only.
 * The UI must always render "≈ Bortle N" with an explanatory tooltip — this is
 * a credibility requirement (see .clinerules §0.3), not a style preference.
 */

/** Bortle class 1–9 with the SQM band that maps to it (prd.md §2.1 table). */
export interface BortleBand {
  bortle: number;
  /** Lower (darker) bound of the SQM band, mpsas. */
  minSqm: number;
  /** Upper (brighter, non-inclusive) bound of the SQM band, mpsas. */
  maxSqm: number;
  /** Plain-language description for tooltips/labels. */
  label: string;
}

/**
 * SQM → Bortle table from prd.md §2.1. Bands are [min, max], i.e. a value of
 * exactly 21.99 falls in Bortle 1 (min 21.99).
 */
export const BORTLE_BANDS: readonly BortleBand[] = [
  { bortle: 1, minSqm: 21.99, maxSqm: Infinity, label: "Excellent dark-sky site" },
  { bortle: 2, minSqm: 21.89, maxSqm: 21.99, label: "Typical truly dark site" },
  { bortle: 3, minSqm: 21.69, maxSqm: 21.89, label: "Rural sky" },
  { bortle: 4, minSqm: 20.49, maxSqm: 21.69, label: "Rural/suburban transition" },
  { bortle: 5, minSqm: 19.50, maxSqm: 20.49, label: "Suburban sky" },
  { bortle: 6, minSqm: 18.94, maxSqm: 19.50, label: "Bright suburban sky" },
  { bortle: 7, minSqm: 18.38, maxSqm: 18.94, label: "Suburban/urban transition" },
  { bortle: 8, minSqm: 17.80, maxSqm: 18.38, label: "City sky" },
  { bortle: 9, minSqm: -Infinity, maxSqm: 17.80, label: "Inner-city sky" },
];

/**
 * Modeled zenith SQM (mpsas) → approximate Bortle class (1–9).
 *
 * Higher SQM means darker skies. Evaluated from darkest (Bortle 1) to brightest (Bortle 9).
 */
export function bortleFromSqm(sqmMpsas: number): number {
  for (const band of BORTLE_BANDS) {
    if (sqmMpsas >= band.minSqm) {
      return band.bortle;
    }
  }
  return 9;
}

/**
 * Approximate Bortle label for a modeled SQM, for tooltips.
 */
export function bortleLabel(sqmMpsas: number): string {
  const b = bortleFromSqm(sqmMpsas);
  const band = BORTLE_BANDS[b - 1];
  return band.label;
}

/**
 * The minimum modeled zenith SQM needed to qualify as "Bortle N or darker"
 * (i.e. Bortle ≤ N). For example a user choosing "≈ Bortle 4 or darker" needs
 * SQM ≥ 20.49 mpsas. Used for the threshold search darkness filter.
 */
export function minSqmForBortle(bortle: number): number {
  const band = BORTLE_BANDS[Math.min(9, Math.max(1, Math.round(bortle))) - 1];
  return band.minSqm;
}
