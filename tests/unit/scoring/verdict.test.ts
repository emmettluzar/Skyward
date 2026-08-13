import { describe, it, expect } from "vitest";
import { decideVerdict } from "@/lib/scoring/verdict";

const BASE = {
  qSite: 60,
  qHome: 10,
  windowTooShort: false,
};

describe("verdict thresholds (prd.md §4.4)", () => {
  it("GO when W ≥ 12 and cloud ≥ 0.55", () => {
    const r = decideVerdict({ ...BASE, wTonight: 15, cloudFactor: 0.7 });
    expect(r.verdict).toBe("GO");
  });

  it("MAYBE when W ≥ 4 but below the GO bar", () => {
    const r = decideVerdict({ ...BASE, wTonight: 6, cloudFactor: 0.6 });
    expect(r.verdict).toBe("MAYBE");
  });

  it("STAY HOME when W < 4", () => {
    const r = decideVerdict({ ...BASE, wTonight: 2, cloudFactor: 0.6 });
    expect(r.verdict).toBe("STAY HOME");
  });

  it("STAY HOME when cloud < 0.25 even with high W", () => {
    const r = decideVerdict({ ...BASE, wTonight: 20, cloudFactor: 0.1 });
    expect(r.verdict).toBe("STAY HOME");
  });

  it("STAY HOME when the backyard is nearly as good (Q_home ≥ 0.8 · Q_site)", () => {
    const r = decideVerdict({
      qSite: 50,
      qHome: 40, // 40 ≥ 0.8·50
      wTonight: 15,
      cloudFactor: 0.7,
      windowTooShort: false,
    });
    expect(r.verdict).toBe("STAY HOME");
    expect(r.reasons.some((x) => x.includes("backyard"))).toBe(true);
  });

  it("caps GO at MAYBE when the observing window is too short", () => {
    const r = decideVerdict({
      ...BASE,
      wTonight: 15,
      cloudFactor: 0.7,
      windowTooShort: true,
    });
    expect(r.verdict).toBe("MAYBE");
    expect(r.reasons.some((x) => x.includes("not enough dark time"))).toBe(true);
  });

  it("suggests a better night when future W exceeds 1.35× tonight", () => {
    const r = decideVerdict({
      ...BASE,
      wTonight: 8,
      cloudFactor: 0.6,
      bestFutureW: 20,
      betterNightLabel: "Thursday",
    });
    expect(r.suggestBetterNight).toBe(true);
    expect(r.betterNightLabel).toBe("Thursday");
  });

  it("always returns 2–4 reason chips", () => {
    const go = decideVerdict({ ...BASE, wTonight: 15, cloudFactor: 0.7 });
    const stay = decideVerdict({ ...BASE, wTonight: 2, cloudFactor: 0.1 });
    for (const r of [go, stay]) {
      expect(r.reasons.length).toBeGreaterThanOrEqual(2);
      expect(r.reasons.length).toBeLessThanOrEqual(4);
    }
  });
});