import { describe, it, expect } from "vitest";
import { computeWindow } from "@/lib/scoring/window";

const MIN = 60_000;

describe("observing window (prd.md §4.2)", () => {
  it("start = max(dusk, depart + drive) and end = min(dawn, bedtime - drive_home)", () => {
    const w = computeWindow({
      astroDuskMs: 22 * 60 * MIN, // 22:00
      astroDawnMs: 28 * 60 * MIN, // 04:00 next day
      earliestDepartureMs: 21 * 60 * MIN, // 21:00
      driveTimeMin: 60,
      bedtimeMs: 26 * 60 * MIN, // 02:00 (26h to keep within this epoch range)
    });

    // depart 21:00 + 60 = 22:00; dusk 22:00 → start 22:00
    expect(w.startMs).toBe(22 * 60 * MIN);
    // bedtime 02:00 − 60 = 01:00; dawn 04:00 → end 01:00 (25h)
    expect(w.endMs).toBe(25 * 60 * MIN);
    expect(w.durationMin).toBe(180);
    expect(w.tooShort).toBe(false);
  });

  it("flags a window shorter than 45 min", () => {
    const w = computeWindow({
      astroDuskMs: 22 * 60 * MIN, // 22:00
      astroDawnMs: 23 * 60 * MIN, // 23:00
      earliestDepartureMs: 22 * 60 * MIN, // 22:00
      driveTimeMin: 30,
      bedtimeMs: 24 * 60 * MIN, // 00:00 next day
    });
    // start = max(22:00, 22:30) = 22:30; end = min(23:00, 23:30) = 23:00 → 30 min
    expect(w.tooShort).toBe(true);
    expect(w.reasons.some((r) => r.includes("not enough dark time"))).toBe(true);
  });

  it("returns zero duration (and a reason) for a degenerate window", () => {
    const w = computeWindow({
      astroDuskMs: 22 * 60 * MIN,
      astroDawnMs: 23 * 60 * MIN,
      earliestDepartureMs: 21 * 60 * MIN,
      driveTimeMin: 600, // can't get there before dawn
      bedtimeMs: 24 * 60 * MIN,
    });
    expect(w.durationMin).toBe(0);
    expect(w.reasons.some((r) => r.includes("no dark window"))).toBe(true);
  });

  it("reuses driveTimeMin for drive-home when driveHomeTimeMin is omitted", () => {
    const a = computeWindow({
      astroDuskMs: 20 * 60 * MIN,
      astroDawnMs: 28 * 60 * MIN,
      earliestDepartureMs: 20 * 60 * MIN,
      driveTimeMin: 30,
      bedtimeMs: 26 * 60 * MIN,
    });
    const b = computeWindow({
      astroDuskMs: 20 * 60 * MIN,
      astroDawnMs: 28 * 60 * MIN,
      earliestDepartureMs: 20 * 60 * MIN,
      driveTimeMin: 30,
      driveHomeTimeMin: 30,
      bedtimeMs: 26 * 60 * MIN,
    });
    expect(a.endMs).toBe(b.endMs);
  });
});