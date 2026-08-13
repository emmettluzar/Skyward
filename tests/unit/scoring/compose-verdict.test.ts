import { describe, it, expect } from "vitest";
import type { ConditionsPoint } from "@/lib/types/conditions";
import { composeVerdict } from "@/lib/scoring/compose-verdict";

const HOUR_MS = 3_600_000;

/** Build a minimal ConditionsPoint with clear, new-moon, dry conditions. */
function makePoint(lat: number, lon: number): ConditionsPoint {
  const base = Date.UTC(2026, 7, 13, 2, 0, 0); // fixed epoch, no wall-clock dependence

  const hours = [0, 1, 2].map((i) => ({
    timeMs: base + i * HOUR_MS,
    cloudLowFrac: 0.02,
    cloudMidFrac: 0.05,
    cloudHighFrac: 0.05,
    tempC: 12,
    dewPointC: 4,
    windKph: 8,
    relHumidityPct: 30,
    aod550: 0.04,
    pm25UgM3: 2,
    moonAltitudeDeg: -20,
    moonIllumFrac: 0.01,
    twilight: "astro" as const,
    goAbility: null,
  }));

  return {
    lat,
    lon,
    roundedLat: lat,
    roundedLon: lon,
    timezone: "UTC",
    utcOffsetSeconds: 0,
    moonPhaseLabel: "New Moon",
    moonIllumFrac: 0.01,
    moonRiseMs: null,
    moonSetMs: null,
    astroDuskMs: base,
    astroDawnMs: base + 3 * HOUR_MS,
    hours,
    provenance: {
      weatherSourceName: "Open-Meteo",
      weatherForecastThroughMs: base + 3 * HOUR_MS,
      airQualitySourceName: "Open-Meteo Air Quality",
      airQualityForecastThroughMs: base + 3 * HOUR_MS,
      ephemerisSourceName: "astronomy-engine",
    },
  };
}

describe("composeVerdict", () => {
  it("degrades to UNKNOWN when the darkness model is absent", () => {
    const home = makePoint(40.7128, -74.006);

    const result = composeVerdict({
      home,
      site: null,
      sqmHome: null,
      sqmSite: null,
      driveTimeMin: 0,
      distKm: 0,
      fuelPricePerLitre: 1.5,
      earliestDepartureMs: home.astroDuskMs! - HOUR_MS,
      bedtimeMs: home.astroDuskMs! + 4 * HOUR_MS,
    });

    expect(result.verdict).toBe("UNKNOWN");
    expect(result.wTonight).toBeNull();
    expect(result.deltaQ).toBeNull();
    expect(result.partial).toContain("darkness");
    // Honest provenance: must not fabricate a GO/STAY-HOME call.
    expect(result.reasons.some((r) => r.includes("darkness model"))).toBe(true);
  });

  it("runs the full pipeline when darkness SQM is available", () => {
    const home = makePoint(40.7128, -74.006);

    const result = composeVerdict({
      home,
      site: null,
      sqmHome: 21.9,
      sqmSite: null,
      driveTimeMin: 0,
      distKm: 0,
      fuelPricePerLitre: 1.5,
      earliestDepartureMs: home.astroDuskMs! - HOUR_MS,
      bedtimeMs: home.astroDuskMs! + 4 * HOUR_MS,
    });

    expect(result.verdict).not.toBe("UNKNOWN");
    expect(result.wTonight).not.toBeNull();
    expect(result.deltaQ).not.toBeNull();
  });
});