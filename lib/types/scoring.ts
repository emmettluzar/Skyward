/**
 * Shared types for the darkness & scoring engine (prd.md §2.1, §4).
 *
 * Conventions (see .clinerules §3):
 *  - Units are in identifiers when ambiguous: driveTimeMin, distKm, sqmMpsas,
 *    brightnessMcdM2, cloudFrac (0–1, never percent), elevationM, etc.
 *  - All scoring functions are pure: (inputs) => { ... }. No I/O, no Date.now().
 *    Absolute time is injected as epoch milliseconds.
 */

/** Which hemisphere an observing site lies in (mirrors the weighted horizon quadrant). */
export type Hemisphere = "north" | "south";

/** Verdict-level result for the worth-it decision. */
export type Verdict = "GO" | "MAYBE" | "STAY HOME";

/** Result shape shared by every scoring factor. */
export interface FactorResult {
  /** Factor value, always within the documented [0, 1] range where applicable. */
  value: number;
  /** Human-readable justification strings, rendered as reason chips in the UI. */
  reasons: string[];
}

/**
 * One hour of cloud/weather conditions within an observing window.
 * Cloud fields are fractions in [0, 1] (converted from API percentages once,
 * at the upstream boundary). Optional humidity/thermal fields drive the fog
 * penalty; omit them when a provider does not supply them.
 */
export interface CloudLayerHour {
  cloudLowFrac: number;
  cloudMidFrac: number;
  cloudHighFrac: number;
  /** Air temperature at the site, °C. */
  tempC?: number;
  /** Dew point at the site, °C. */
  dewPointC?: number;
  /** Wind speed, km/h. */
  windKph?: number;
  /** Optional local label used to surface "clearest from 11pm–1am" in the UI. */
  label?: string;
}

/** One hour of Moon position/brightness within an observing window. */
export interface MoonHour {
  /** Moon altitude in degrees; negative values mean the Moon is below the horizon. */
  altitudeDeg: number;
  /** Illuminated fraction of the lunar disk, [0, 1]. */
  illumFrac: number;
}

/** Practical accessibility facts used by the A_access factor (prd.md §4.1). */
export interface AccessInput {
  hasPublicRoadWithin400m: boolean;
  hasLegalParking: boolean;
  lastRoadUnpaved: boolean;
  /** True when access=private|no, i.e. not publicly accessible. */
  accessPrivateOrNo: boolean;
  /** True when a gate or opening_hours close before the observing window ends. */
  closesBeforeWindowEnd: boolean;
  /** True when the site is a certified Dark Sky Place. */
  certifiedDarkSkyPlace: boolean;
}

/** Result of computing the observing window (prd.md §4.2). */
export interface ObservingWindow {
  /** Window open, epoch milliseconds. */
  startMs: number;
  /** Window close, epoch milliseconds. */
  endMs: number;
  /** Observing duration in minutes. */
  durationMin: number;
  /** True when durationMin < minWindowMin (45). Caps the verdict at MAYBE. */
  tooShort: boolean;
  reasons: string[];
}