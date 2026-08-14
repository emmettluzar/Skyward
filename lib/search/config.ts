/**
 * Search & snapping tuning (prd.md §3, §6). Every magic number for the
 * candidate search pipeline lives here, typed and documented — mirroring the
 * scoring config convention (.clinerules §3). No hardcoded coefficients in the
 * snap/search/orchestration modules.
 *
 * Scoring coefficients from §4 stay in lib/scoring/config.ts; these are the
 * *spatial-query* parameters (radii, counts, spacing, weights) from §3/§6.
 */

export const SEARCH_CONFIG = {
  /** prd.md §6: snap a raw cell to a legal spot within this radius. */
  snapping: {
    radiusKm: 2.5,

    /**
     * prd.md §6 snap score weights:
     *   snap = 0.45·openness + 0.25·(1 - Δdarkness) + 0.20·parking_quality
     *        + 0.10·(1 - dist/radius)
     */
    opennessWeight: 0.45,
    darknessWeight: 0.25,
    parkingWeight: 0.2,
    distanceWeight: 0.1,

    /**
     * Δdarkness is normalized against this maximum SQM penalty. A spot at the
     * very edge of the radius AND much brighter than the cell scores ~0 on the
     * darkness term. (prd.md §6: Δdarkness is the cell-spot SQM delta.)
     */
    maxDarknessDeltaSqm: 1.0,
  },

  /** prd.md §3.1 Mode 1 threshold search. */
  threshold: {
    /** Number of nearest qualifying cells sampled per search (k=40). */
    candidateCellCount: 40,
    /** Keep the top N by drive time (§3.1 step 5). */
    returnCount: 8,
    /** Dedup minimum spacing between candidate cells, km (§3.1 step 2). */
    cellSpacingKm: 3,
  },

  /** prd.md §3.3 Mode 3 time-budget (isochrone) search. */
  timeBudget: {
    /** Maximum sites returned (§3.3: "up to 10"). */
    returnCount: 10,
    /** Non-maximum suppression: ≥5 km mutual spacing (§3.3 step 3). */
    minSpotSpacingKm: 5,
  },

  /**
   * prd.md §3.1: single Valhalla matrix call per search — no per-point loops.
   * `matrixMaxSources` is the practical cap on how many origins we can send in
   * one call while respecting FOSSGIS fair use.
   */
  matrix: {
    /** Cap on destination count per matrix call (keeps the request sane). */
    maxSources: 50,
  },

  /**
   * "Best within reach" composite score weights (see lib/search/rank.ts). The
   * user asks "which is BEST within my drive time?", not "which is closest".
   * We combine the signals we already model (§4/§6) into one 0–1 number:
   *
   *   score = w_open·openness + w_park·parking + w_access·access
   *         + w_dark·S_dark + w_close·closeness
   *
   * Openness = OSM open-sky/greenery proxy; access = the §7 confidence label;
   * S_dark = the canonical γ darkness factor (neutral 0.5 while the raster is
   * unpublished); closeness normalizes against `maxDriveTimeMin`.
   */
  best: {
    opennessWeight: 0.3,
    parkingWeight: 0.15,
    accessWeight: 0.2,
    darknessWeight: 0.25,
    closenessWeight: 0.1,
    /** Drive time (min) at which the closeness term saturates to 0. */
    maxDriveTimeMin: 120,
    /** Access confidence → 0..1 (prd.md §6 + .clinerules §7). */
    accessScores: {
      "verified-public": 1.0,
      "likely-public": 0.8,
      "verify-access": 0.5,
    },
  },
} as const;

export type SearchConfig = typeof SEARCH_CONFIG;