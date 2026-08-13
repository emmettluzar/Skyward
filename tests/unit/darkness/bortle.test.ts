import { describe, it, expect } from "vitest";
import { bortleFromSqm, bortleLabel } from "@/lib/darkness/bortle";

describe("SQM → Bortle mapping (prd.md §2.1)", () => {
  it("maps the documented band boundaries correctly", () => {
    // The table is [min, max); exact boundaries classify into the darker band.
    expect(bortleFromSqm(21.99)).toBe(1);
    expect(bortleFromSqm(21.98)).toBe(2);
    expect(bortleFromSqm(21.69)).toBe(3);
    expect(bortleFromSqm(20.49)).toBe(4);
    expect(bortleFromSqm(19.5)).toBe(5);
    expect(bortleFromSqm(18.94)).toBe(6);
    expect(bortleFromSqm(18.38)).toBe(7);
    expect(bortleFromSqm(17.8)).toBe(8);
    expect(bortleFromSqm(17.79)).toBe(9);
  });

  it("classifies a bright urban sky as Bortle 8", () => {
    expect(bortleFromSqm(18.0)).toBe(8);
  });

  it("classifies a dark desert sky as Bortle 2", () => {
    expect(bortleFromSqm(21.9)).toBe(2);
  });

  it("never returns outside 1..9 for extreme inputs", () => {
    expect(bortleFromSqm(-100)).toBeGreaterThanOrEqual(1);
    expect(bortleFromSqm(100)).toBeLessThanOrEqual(9);
  });

  it("returns a label for every class", () => {
    for (let b = 1; b <= 9; b++) {
      const label = bortleLabel(22.5 - b); // some SQM within each band
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});