import { describe, it, expect } from "vitest";
import {
  B_NATURAL_MCD,
  sqmFromBrightness,
  sqmFromArtificialBrightness,
  nelmFromSqm,
  sqmFromNelm,
  nelmFromBrightness,
  ratioFromBrightness,
  estimateStarCount,
  getMilkyWayVisibility,
} from "@/lib/darkness/convert";

describe("darkness conversions (prd.md §2.1)", () => {
  it("b_art = 0 → SQM = 22.00", () => {
    // The canonical zero-light-pollution sanity check (.clinerules §3).
    expect(sqmFromBrightness(0 + B_NATURAL_MCD)).toBeCloseTo(22.0, 2);
    expect(sqmFromArtificialBrightness(0)).toBeCloseTo(22.0, 2);
  });

  it("SQM is monotonic: brighter (higher b) → lower SQM", () => {
    const dark = sqmFromArtificialBrightness(0); // natural sky
    const bright = sqmFromArtificialBrightness(100); // polluted sky
    expect(bright).toBeLessThan(dark);
  });

  it("matches the documented NELM formula at SQM 21.9", () => {
    const nelm = nelmFromSqm(21.9);
    // NELM ≈ 6.85 in a dark Bortle 2 sky.
    expect(nelm).toBeGreaterThan(6.5);
    expect(nelm).toBeLessThan(7.0);
  });

  it("nelmFromSqm ↔ sqmFromNelm round-trip reverses", () => {
    const sqm = 21.5;
    expect(sqmFromNelm(nelmFromSqm(sqm))).toBeCloseTo(sqm, 6);
  });

  it("ratioFromBrightness reports ×N vs natural sky", () => {
    expect(ratioFromBrightness(0)).toBe(0);
    expect(ratioFromBrightness(B_NATURAL_MCD)).toBeCloseTo(1, 6);
    expect(ratioFromBrightness(B_NATURAL_MCD * 3.2)).toBeCloseTo(3.2, 6);
  });

  it("clamps pathological brightness without producing NaN", () => {
    expect(Number.isFinite(sqmFromBrightness(-5))).toBe(true);
    expect(Number.isFinite(sqmFromBrightness(0))).toBe(true);
    expect(Number.isFinite(nelmFromBrightness(-1))).toBe(true);
  });

  it("brightness → SQM → NELM pipeline stays finite", () => {
    const nelm = nelmFromBrightness(B_NATURAL_MCD + 1);
    expect(Number.isFinite(nelm)).toBe(true);
  });

  it("estimateStarCount scales exponentially with NELM", () => {
    const starsUrban = estimateStarCount(2.5);
    const starsSuburban = estimateStarCount(4.5);
    const starsDark = estimateStarCount(6.5);

    expect(starsUrban).toBeLessThan(100);
    expect(starsSuburban).toBeGreaterThan(400);
    expect(starsDark).toBeGreaterThan(2500);
    expect(starsDark).toBeGreaterThan(starsSuburban);
  });

  it("getMilkyWayVisibility reports high contrast in pristine Bortle 1-2 and washed out under heavy clouds or bright skies", () => {
    const pristine = getMilkyWayVisibility(1, 0, -90, 0);
    expect(pristine.status).toBe("high-contrast");

    const cloudy = getMilkyWayVisibility(1, 0, -90, 80);
    expect(cloudy.status).toBe("not-visible");

    const brightMoon = getMilkyWayVisibility(1, 0.9, 45, 0);
    expect(brightMoon.status).toBe("faint");

    const lightPolluted = getMilkyWayVisibility(7, 0, -90, 0);
    expect(lightPolluted.status).toBe("not-visible");
  });
});
