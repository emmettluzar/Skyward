import { describe, it, expect } from "vitest";
import {
  sampleAnnulusCells,
  polygonMaxRadiusKm,
} from "@/lib/search/sample";
import { haversineKm } from "@/lib/geo/distance";

const ORIGIN = { lat: 40.7128, lon: -74.006 };

describe("sampleAnnulusCells (bugfix: no angular gaps at any radius)", () => {
  it("scales spoke density with ring circumference instead of a fixed count", () => {
    // The original implementation used a FIXED 8 spokes for every one of the
    // first 8 rings regardless of radius, so a ring at 30km had the same
    // point count as a ring at 3km — leaving huge, real, undetected gaps at
    // the outer edge of the search radius. A correct sampler must produce
    // meaningfully MORE cells in a band farther from the origin than in an
    // equally-wide band close to the origin, because its circumference is
    // larger.
    const innerBand = sampleAnnulusCells(ORIGIN, 0, 6, 3);
    const outerBand = sampleAnnulusCells(ORIGIN, 30, 36, 3);

    expect(outerBand.length).toBeGreaterThan(innerBand.length);
  });

  it("never leaves a gap much larger than the requested spacing at the outer edge", () => {
    const radiusKm = 50;
    const spacingKm = 3;
    const cells = sampleAnnulusCells(ORIGIN, 0, radiusKm, spacingKm);

    // Probe points around the outer edge at 16 evenly spaced bearings and
    // confirm each one has a sampled cell within a small multiple of the
    // spacing — i.e. no real dark site near the edge of the search radius
    // could fall through a gap between sampled points.
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const dLat = (radiusKm / 110.574) * Math.sin(angle);
      const dLon =
        (radiusKm / (111.32 * Math.cos((ORIGIN.lat * Math.PI) / 180))) *
        Math.cos(angle);
      const probe = { lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon };

      const nearestKm = Math.min(...cells.map((c) => haversineKm(probe, c)));
      expect(nearestKm).toBeLessThan(spacingKm * 2.5);
    }
  });

  it("respects the inner radius bound — no cells closer than innerRadiusKm (beyond the origin point)", () => {
    const innerRadiusKm = 20;
    const cells = sampleAnnulusCells(ORIGIN, innerRadiusKm, 40, 4);
    for (const c of cells) {
      const d = haversineKm(ORIGIN, c);
      // small tolerance for the half-spacing start offset
      expect(d).toBeGreaterThanOrEqual(innerRadiusKm - 4);
    }
  });

  it("samples the origin itself when innerRadiusKm is 0 (a dark site right at the user's location isn't missed)", () => {
    const cells = sampleAnnulusCells(ORIGIN, 0, 10, 3);
    const hasOrigin = cells.some(
      (c) => haversineKm(ORIGIN, c) < 0.2,
    );
    expect(hasOrigin).toBe(true);
  });
});

describe("polygonMaxRadiusKm", () => {
  it("returns null when there is no polygon", () => {
    expect(polygonMaxRadiusKm(ORIGIN, null)).toBeNull();
  });

  it("returns the farthest vertex distance from the origin", () => {
    // A simple square roughly 1 degree of longitude east of the origin.
    const ring: Array<[number, number]> = [
      [ORIGIN.lon, ORIGIN.lat],
      [ORIGIN.lon + 1, ORIGIN.lat],
      [ORIGIN.lon + 1, ORIGIN.lat + 1],
      [ORIGIN.lon, ORIGIN.lat + 1],
      [ORIGIN.lon, ORIGIN.lat],
    ];
    const maxKm = polygonMaxRadiusKm(ORIGIN, ring);
    expect(maxKm).not.toBeNull();
    // The farthest vertex is the diagonal corner, ~1.41 degrees away.
    const expected = haversineKm(ORIGIN, { lat: ORIGIN.lat + 1, lon: ORIGIN.lon + 1 });
    expect(maxKm as number).toBeCloseTo(expected, 0);
  });
});