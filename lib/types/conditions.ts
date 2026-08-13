/**
 * Client-facing shape of the `/api/conditions` response (Tonight panel).
 *
 * Units follow .clinerules §3: cloud fractions are 0–1 (never percent),
 * wind is km/h, temperatures °C. Coordinates are rounded to 3 dp (≈110 m)
 * before any outbound call and before they appear in these payloads.
 *
 * Weather/AQ fields are nullable: when an upstream is down we degrade
 * gracefully (honest "no data") rather than fabricating a clear sky.
 */

/** Solar twilight state for the hour ribbon (prd.md §5 Row 1). */
export type TwilightState = "daylight" | "civil" | "nautical" | "astro";

/** One hourly column in the Tonight ribbon. */
export interface HourCondition {
  /** Hour start, epoch ms. */
  timeMs: number;
  cloudLowFrac: number | null;
  cloudMidFrac: number | null;
  cloudHighFrac: number | null;
  tempC: number | null;
  dewPointC: number | null;
  windKph: number | null;
  relHumidityPct: number | null;
  /** Aerosol optical depth at 550 nm, unitless. */
  aod550: number | null;
  /** PM2.5, μg·m⁻³. */
  pm25UgM3: number | null;
  moonAltitudeDeg: number;
  moonIllumFrac: number;
  twilight: TwilightState;
  /**
   * Per-hour "go-ability" = C_cloud · M_moon · T_trans ∈ [0, 1] (prd.md §5
   * Row 4). Null when cloud data is missing (no fabricated clear-sky signal).
   */
  goAbility: number | null;
}

export interface ConditionsProvenance {
  weatherSourceName: string;
  /** Last forecasted hour covered by the weather source, epoch ms (or null). */
  weatherForecastThroughMs: number | null;
  airQualitySourceName: string;
  airQualityForecastThroughMs: number | null;
  ephemerisSourceName: string;
}

export interface ConditionsPoint {
  lat: number;
  lon: number;
  /** Rounded coordinates (3 dp) used as the cache key and privacy measure. */
  roundedLat: number;
  roundedLon: number;
  timezone: string;
  utcOffsetSeconds: number;
  moonPhaseLabel: string;
  moonIllumFrac: number;
  moonRiseMs: number | null;
  moonSetMs: number | null;
  /** Astronomical dusk/dawn used for the dark window; null if none tonight. */
  astroDuskMs: number | null;
  astroDawnMs: number | null;
  hours: HourCondition[];
  provenance: ConditionsProvenance;
}

export interface ConditionsResponse {
  points: ConditionsPoint[];
  generatedAtMs: number;
  /** Enrichments that failed or were unavailable (honest degradation). */
  partial: string[];
  estimated: boolean;
}