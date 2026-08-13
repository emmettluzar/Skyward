import { describe, it, expect } from "vitest";
import { worthIt } from "@/lib/scoring/worthit";

const HOUR = 3_600_000;

describe("worth-it W (prd.md §4.3)", () => {
  it("computes time_efficiency = ΔQ · t_o / (2·t_d + t_o)", () => {
    const w = worthIt({
      qSite: 60,
      qHome: 20,
      driveTimeMin: 45,
      observingMin: 90,
      distKm: 50,
      fuelPricePerLitre: 1.5,
      arriveHomeMs: 24 * HOUR,
      bedtimeMs: 24 * HOUR,
    });

    const expectedDeltaQ = 40;
    const expectedFrac = 90 / (2 * 45 + 90); // 0.5
    expect(w.deltaQ).toBeCloseTo(expectedDeltaQ, 10);
    expect(w.observingFraction).toBeCloseTo(expectedFrac, 10);
    expect(w.timeEfficiency).toBeCloseTo(expectedDeltaQ * expectedFrac, 10);
    expect(w.value).toBe(w.timeEfficiency - w.fuelCostPts - w.fatiguePts);
  });

  it("applies fuel cost on round-trip distance", () => {
    const w = worthIt({
      qSite: 50,
      qHome: 0,
      driveTimeMin: 30,
      distKm: 200,
      fuelPricePerLitre: 2,
      arriveHomeMs: 23 * HOUR,
      bedtimeMs: 23 * HOUR,
    });
    // fuel = κ · (2·dist/100 · L/100km · price) = 0.8 · (4 · 8 · 2) = 51.2
    expect(w.fuelCostPts).toBeCloseTo(0.8 * 4 * 8 * 2, 6);
  });

  it("applies fatigue for arriving home past bedtime", () => {
    const w = worthIt({
      qSite: 50,
      qHome: 0,
      driveTimeMin: 30,
      distKm: 10,
      fuelPricePerLitre: 1,
      arriveHomeMs: 25 * HOUR,
      bedtimeMs: 23 * HOUR, // 2 hours late
    });
    expect(w.fatiguePts).toBeCloseTo(4 * 2, 6);
  });

  it("is pure: a gainless trip (ΔQ ≤ 0) yields negative W", () => {
    const w = worthIt({
      qSite: 10,
      qHome: 50,
      driveTimeMin: 30,
      distKm: 10,
      fuelPricePerLitre: 1,
      arriveHomeMs: 23 * HOUR,
      bedtimeMs: 23 * HOUR,
    });
    expect(w.deltaQ).toBeLessThan(0);
    expect(w.value).toBeLessThan(0);
  });
});