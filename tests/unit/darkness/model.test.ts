import { describe, it, expect } from "vitest";
import {
  calculateArtificialBrightness,
  calculateLocationSqm,
  getLocationDarkness,
  generateHighResHeatmapPoints,
} from "@/lib/darkness/model";

describe("Light pollution model & darkness calculation", () => {
  it("calculates brighter skies in urban centers and darker skies in remote regions", () => {
    // NYC center vs rural upstate NY
    const nycSqm = calculateLocationSqm(40.7128, -74.006);
    const ruralNySqm = calculateLocationSqm(44.0, -74.5);

    expect(nycSqm).toBeLessThan(19.5); // Bright urban sky
    expect(ruralNySqm).toBeGreaterThan(21.0); // Dark rural sky
    expect(ruralNySqm).toBeGreaterThan(nycSqm); // Higher SQM = darker sky
  });

  it("produces gradient differences across short local distances", () => {
    const centerSqm = calculateLocationSqm(40.7128, -74.006);
    // Point 10 miles (~16 km) away
    const suburbanSqm = calculateLocationSqm(40.85, -74.15);

    expect(suburbanSqm).not.toBe(centerSqm);
    expect(suburbanSqm).toBeGreaterThan(centerSqm);
  });

  it("getLocationDarkness returns consistent Bortle and SQM values", () => {
    const darkness = getLocationDarkness(40.7128, -74.006);
    expect(darkness.sqmMpsas).toBeGreaterThanOrEqual(17.0);
    expect(darkness.sqmMpsas).toBeLessThanOrEqual(22.0);
    expect(darkness.bortle).toBeGreaterThanOrEqual(1);
    expect(darkness.bortle).toBeLessThanOrEqual(9);
    expect(typeof darkness.bortleLabel).toBe("string");
  });

  it("generateHighResHeatmapPoints produces valid non-empty feature collection points", () => {
    const points = generateHighResHeatmapPoints(40.7128, -74.006, 50, 10);
    expect(points.length).toBeGreaterThan(10);
    for (const p of points) {
      expect(p.intensity).toBeGreaterThanOrEqual(0);
      expect(p.intensity).toBeLessThanOrEqual(1);
    }
  });
});