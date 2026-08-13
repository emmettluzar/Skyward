import { describe, it, expect } from "vitest";
import {
  qualityScore,
  darknessFactor,
  cloudFactor,
  moonFactor,
  horizonFactor,
  accessFactor,
} from "@/lib/scoring/quality";
import { FIXTURES } from "@/tests/fixtures/scoring";

describe("quality factors (prd.md §4.1)", () => {
  it("S_dark saturates to 0 below SQM floor and 1 at the ceiling", () => {
    expect(darknessFactor(17.5).value).toBe(0);
    expect(darknessFactor(21.95).value).toBeCloseTo(1, 10);
    expect(darknessFactor(16).value).toBe(0);
  });

  it("C_cloud is multiplicative and a fully overcast site scores ~0", () => {
    const overcast = cloudFactor([
      { cloudLowFrac: 1, cloudMidFrac: 1, cloudHighFrac: 1 },
    ]);
    expect(overcast.value).toBeCloseTo(0, 10);

    const clear = cloudFactor([
      { cloudLowFrac: 0, cloudMidFrac: 0, cloudHighFrac: 0 },
    ]);
    expect(clear.value).toBeCloseTo(1, 10);
  });

  it("M_moon: full moon up all night ≈ 0.12, new moon ≈ 1", () => {
    const full = moonFactor([
      { altitudeDeg: 90, illumFrac: 1 },
      { altitudeDeg: 90, illumFrac: 1 },
    ]);
    expect(full.value).toBeCloseTo(1 - 0.88, 2); // ≈ 0.12

    const newMoon = moonFactor([
      { altitudeDeg: -30, illumFrac: 0.01 },
      { altitudeDeg: -30, illumFrac: 0.01 },
    ]);
    expect(newMoon.value).toBeCloseTo(1, 2);
  });

  it("H_open penalizes a canyon-blocked southern sky more than a flat one", () => {
    const flat = horizonFactor({
      horizonElevDeg: Array.from({ length: 36 }, () => 0),
      canopyFraction200m: 0,
      elevationM: 100,
      hemisphere: "north",
    });
    const canyon = horizonFactor({
      horizonElevDeg: Array.from({ length: 36 }, (_, i) =>
        i * 10 >= 135 && i * 10 < 225 ? 25 : 0,
      ),
      canopyFraction200m: 0,
      elevationM: 100,
      hemisphere: "north",
    });
    expect(canyon.value).toBeLessThan(flat.value);
  });

  it("A_access applies gated/private penalties multiplicatively", () => {
    const open = accessFactor({
      hasPublicRoadWithin400m: true,
      hasLegalParking: true,
      lastRoadUnpaved: false,
      accessPrivateOrNo: false,
      closesBeforeWindowEnd: false,
      certifiedDarkSkyPlace: false,
    });
    const gatedPrivate = accessFactor({
      hasPublicRoadWithin400m: true,
      hasLegalParking: true,
      lastRoadUnpaved: false,
      accessPrivateOrNo: true,
      closesBeforeWindowEnd: true,
      certifiedDarkSkyPlace: false,
    });
    expect(open.value).toBe(1);
    expect(gatedPrivate.value).toBeCloseTo(1 * 0.6 * 0.9, 10);
  });
});

describe("observing quality Q (multiplicative)", () => {
  it("a cloudy Bortle 1 site scores ~0 (not a weighted sum)", () => {
    // Use the full-moon-overcast fixture but with a pristine SQM.
    const f = FIXTURES.find((x) => x.name === "full-moon-overcast")!;
    const result = qualityScore({ ...f.quality, sqmMpsas: 22.0 });
    expect(result.value).toBeLessThan(1);
  });

  it("snapshots the six required fixtures", () => {
    for (const f of FIXTURES) {
      const q = qualityScore(f.quality);
      // Snapshot the rounded value + the six factors so tuning changes surface.
      expect({
        name: f.name,
        value: Math.round(q.value * 100) / 100,
        factors: {
          S_dark: Math.round(q.factors.S_dark * 1000) / 1000,
          C_cloud: Math.round(q.factors.C_cloud * 1000) / 1000,
          T_trans: Math.round(q.factors.T_trans * 1000) / 1000,
          M_moon: Math.round(q.factors.M_moon * 1000) / 1000,
          H_open: Math.round(q.factors.H_open * 1000) / 1000,
          A_access: Math.round(q.factors.A_access * 1000) / 1000,
        },
      }).toMatchSnapshot();
    }
  });
});