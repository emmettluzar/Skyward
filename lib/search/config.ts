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
     * Snap score weights:
     *   snap = 0.30·openness + 0.20·greenery + 0.25·(1 - Δdarkness) + 0.15·parking_quality
     *        + 0.10·(1 - dist/radius)
     */
    opennessWeight: 0.30,
    greeneryWeight: 0.20,
    darknessWeight: 0.25,
    parkingWeight: 0.15,
    distanceWeight: 0.10,

    /**
     * Δdarkness is normalized against this maximum SQM penalty. A spot at the
     * very edge of the radius AND much brighter than the cell scores ~0 on the
     * darkness term. (prd.md §6: Δdarkness is the cell-spot SQM delta.)
     */
    maxDarknessDeltaSqm: 1.0,
  },

  /**
   * prd.md §3.1 Mode 1 threshold search.
   *
   * The actual search radius/spacing is computed dynamically in
   * lib/search/threshold.ts (it expands outward in bands — see
   * `RADIUS_STEPS_KM` there — because a genuinely dark Bortle 1/2 site can
   * legitimately be hundreds of km from a light-polluted origin, and a fixed
   * radius/spacing here would either miss it or waste a query on a giant
   * area). `candidateCellCount` caps how many of the nearest *qualifying*
   * cells within a band we spend the Overpass/Valhalla budget on.
   */
  threshold: {
    /** Nearest qualifying cells sent to Overpass/Valhalla per band (k=40). */
    candidateCellCount: 40 as number,
    /** Keep the top N by drive time (§3.1 step 5). */
    returnCount: 8 as number,
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
   *   score = w_open·openness + w_green·greenery + w_park·parking + w_access·access
   *         + w_dark·S_dark + w_close·closeness
   */
  best: {
    opennessWeight: 0.25,
    greeneryWeight: 0.15,
    parkingWeight: 0.15,
    accessWeight: 0.15,
    darknessWeight: 0.20,
    closenessWeight: 0.10,
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