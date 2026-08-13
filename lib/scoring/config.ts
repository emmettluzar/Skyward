/**
 * Tuning configuration for the scoring engine (prd.md §4).
 *
 * EVERY magic number referenced by §4.1–§4.4 lives here, typed and documented.
 * No other file may hardcode a coefficient (see .clinerules §3). Comment each
 * value with the exact prd.md formula it feeds so reviews can trace it back.
 */

export const SCORING_CONFIG = {
  /** Overall quality is scaled to 0–100 in the UI (Q = 100 · product of factors). */
  quality: {
    /** prd.md §4.1: Q = 100 · S_dark · C_cloud · T_trans · M_moon · H_open · A_access */
    scale: 100,
  },

  darkness: {
    /**
     * prd.md §4.1 S_dark = clamp((SQM - 17.5) / (21.95 - 17.5), 0, 1) ^ 0.85
     * 17.5 mpsas is the "no darkness value" floor; 21.95 mpsas the saturation
     * ceiling; 0.85 gives a γ-shaped diminishing-returns curve.
     */
    sqmFloor: 17.5,
    sqmCeiling: 21.95,
    gamma: 0.85,
  },

  cloud: {
    /**
     * prd.md §4.1 C_cloud = (1-c_low)^1.0 · (1-c_mid)^0.85 · (1-c_high)^0.55
     * Low cloud/fog is opaque (full weight); mid layers are part-opaque;
     * cirrus dims but never blocks (relaxed exponent).
     */
    lowExponent: 1.0,
    midExponent: 0.85,
    highExponent: 0.55,
    /**
     * prd.md §4.1 fog penalty: when T_air - T_dew < 2 °C AND wind < 5 km/h.
     * Fog is an extra multiplicative penalty on C_cloud (not modeled as a
     * separate Q factor), defaulting to 0.85 when those conditions hold.
     */
    fogPenalty: 0.85,
    fogDewSpreadC: 2.0,
    fogWindKph: 5.0,
  },

  transparency: {
    /** prd.md §4.1 T_trans = exp(-1.9 · max(0, AOD550 - 0.05)) · ... */
    aodKappa: 1.9,
    aodFloor: 0.05,
    /** prd.md §4.1 · (1 - 0.25 · clamp((RH - 70)/30, 0, 1)) */
    rhOffset: 70,
    rhSpan: 30,
    rhWeight: 0.25,
    /** prd.md §4.1 · (1 - 0.30 · clamp(PM2.5 / 60, 0, 1)) */
    pm25Denominator: 60,
    pm25Weight: 0.3,
  },

  moon: {
    /**
     * prd.md §4.1 M_moon = 1 - 0.88 · f_up · I^1.4
     * 0.88 scales the worst case (full moon up all night) to ≈ 0.12; I^1.4
     * makes a thin crescent's contribution nearly negligible.
     */
    scale: 0.88,
    illumExponent: 1.4,
  },

  horizon: {
    /** prd.md §4.1 H_open = (1 - 0.6·blocked) · (1 - 0.5·canopy_200m) · elevation_bonus */
    blockedWeight: 0.6,
    blockedThresholdDeg: 12,
    canopyWeight: 0.5,
    /** Elevation bonus: +up to 8% for being above the haze layer. */
    maxElevationBonus: 0.08,
    /** Elevation (m) at which the full bonus is reached. */
    elevationSaturateM: 1500,
    /** Southern-quadrant extra weight (horizon 135°–225° in N hemisphere). */
    southernWeight: 1.5,
  },

  access: {
    /**
     * prd.md §4.1 A_access multiplicative penalties/bonuses, applied in order.
     */
    noPublicRoadPenalty: 0.55,
    noParkingPenalty: 0.75,
    unpavedRoadPenalty: 0.85,
    privateAccessPenalty: 0.6,
    gateClosurePenalty: 0.9,
    darkSkyPlaceBonus: 1.05,
  },

  window: {
    /** prd.md §4.2: windows shorter than 45 min cap the verdict at MAYBE. */
    minDurationMin: 45,
  },

  worthIt: {
    /**
     * prd.md §4.3 W = time_efficiency - fuel_cost_pts - fatigue_pts
     * time_efficiency = ΔQ · t_o / (2·t_d + t_o)
     */
    defaultObservingMin: 90,
    /** fuel_cost_pts = κ · (2·dist_km / 100 · L_per_100km · price) — κ small. */
    kappa: 0.8,
    /** prd.md §4.3 L_per_100km = 8 (default) */
    litresPer100km: 8,
    /** fatigue_pts = φ · max(0, arrive_home - bedtime) hours */
    phi: 4,
  },

  verdict: {
    /** prd.md §4.4 thresholds. */
    goW: 12,
    goMinCloud: 0.55,
    maybeW: 4,
    /** "STAY HOME — your backyard is nearly as good" when Q_home ≥ ratio · Q_best. */
    homeNearBestRatio: 0.8,
    /** "Wait for a better night" when W_future > ratio · W_tonight. */
    betterNightRatio: 1.35,
  },
} as const;

export type ScoringConfig = typeof SCORING_CONFIG;