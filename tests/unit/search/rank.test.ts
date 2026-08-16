import { describe, it, expect } from "vitest";
import { rankByBest, bestScore } from "@/lib/search/rank";
import type { CandidateSpot } from "@/lib/types/places";

function makeSpot(overrides: Partial<CandidateSpot>): CandidateSpot {
  return {
    osmId: "node/1",
    lat: 41.0,
    lon: -74.0,
    name: "Test spot",
    type: "park",
    accessConfidence: "likely-public",
    parkingQuality: 0.5,
    openness: 0.5,
    greenery: 0.5,
    rawCellLat: 41.0,
    rawCellLon: -74.0,
    distKmFromCell: 0,
    snapScore: 0.5,
    sqmMpsas: 21.0,
    deepLinks: {
      googleMaps: "",
      appleMaps: "",
      waze: "",
      geo: "",
    },
    driveTimeMin: 30,
    driveTimeEstimated: true,
    distKmFromOrigin: 30,
    score: 0,
    scoreReasons: [],
    rank: 1,
    ...overrides,
  };
}

describe("rankByBest (bugfix: darkness tier must dominate the composite score)", () => {
  it("never ranks a Bortle 5 site above a Bortle 4 site, even when every other signal favours the brighter site", () => {
    // Bortle 4 band: SQM 20.49–21.69. Bortle 5 band: SQM 19.50–20.49.
    const darkerButWorseElsewhere = makeSpot({
      osmId: "node/dark",
      sqmMpsas: 20.6, // Bortle 4
      openness: 0.3,
      greenery: 0.3,
      parkingQuality: 0.3,
      accessConfidence: "verify-access",
      driveTimeMin: 60,
    });
    const brighterButBetterElsewhere = makeSpot({
      osmId: "node/bright",
      sqmMpsas: 20.0, // Bortle 5
      openness: 1.0,
      greenery: 1.0,
      parkingQuality: 1.0,
      accessConfidence: "verified-public",
      driveTimeMin: 10,
    });

    const ranked = rankByBest([brighterButBetterElsewhere, darkerButWorseElsewhere]);

    expect(ranked[0].osmId).toBe("node/dark");
    expect(ranked[1].osmId).toBe("node/bright");
  });

  it("prioritizes the closer site within the same Bortle tier (beyond the drive-time tolerance)", () => {
    const closer = makeSpot({ osmId: "node/closer", sqmMpsas: 21.0, driveTimeMin: 15 });
    const farther = makeSpot({ osmId: "node/farther", sqmMpsas: 21.0, driveTimeMin: 60 });

    const ranked = rankByBest([farther, closer]);

    expect(ranked[0].osmId).toBe("node/closer");
  });

  it("uses the composite score as the final tie-breaker when tier and drive time are comparable", () => {
    const better = makeSpot({
      osmId: "node/better",
      sqmMpsas: 21.0,
      driveTimeMin: 20,
      openness: 1.0,
      parkingQuality: 1.0,
      accessConfidence: "verified-public",
    });
    const worse = makeSpot({
      osmId: "node/worse",
      sqmMpsas: 21.0,
      driveTimeMin: 22, // within the 5-minute tolerance of `better`
      openness: 0.2,
      parkingQuality: 0.2,
      accessConfidence: "verify-access",
    });

    const ranked = rankByBest([worse, better]);

    expect(ranked[0].osmId).toBe("node/better");
  });

  it("assigns sequential 1-based ranks after sorting", () => {
    const spots = [
      makeSpot({ osmId: "a", sqmMpsas: 19.0, driveTimeMin: 10 }),
      makeSpot({ osmId: "b", sqmMpsas: 21.5, driveTimeMin: 40 }),
      makeSpot({ osmId: "c", sqmMpsas: 21.9, driveTimeMin: 20 }),
    ];
    const ranked = rankByBest(spots);
    expect(ranked.map((s) => s.rank)).toEqual([1, 2, 3]);
    // Darkest (c, then b, then a) should come first regardless of input order.
    expect(ranked.map((s) => s.osmId)).toEqual(["c", "b", "a"]);
  });

  it("treats unknown darkness (sqmMpsas null) as darker-unknown, sorting after every known tier", () => {
    const known = makeSpot({ osmId: "known", sqmMpsas: 18.0, driveTimeMin: 10 }); // Bortle 8, still known
    const unknown = makeSpot({ osmId: "unknown", sqmMpsas: null, driveTimeMin: 5 });

    const ranked = rankByBest([unknown, known]);
    expect(ranked[0].osmId).toBe("known");
    expect(ranked[1].osmId).toBe("unknown");
  });
});

describe("bestScore", () => {
  it("returns a score in [0, 1] and two human-readable reasons", () => {
    const { score, reasons } = bestScore({
      openness: 0.8,
      greenery: 0.7,
      parkingQuality: 0.9,
      accessConfidence: "verified-public",
      sqmMpsas: 21.5,
      driveTimeMin: 25,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(reasons).toHaveLength(2);
  });

  it("uses a neutral 0.5 darkness term and labels it honestly when SQM is unknown", () => {
    const { reasons } = bestScore({
      openness: 0.1,
      greenery: 0.1,
      parkingQuality: 0.1,
      accessConfidence: "verify-access",
      sqmMpsas: null,
      driveTimeMin: 10,
    });
    expect(reasons.some((r) => r.startsWith("darkness unknown"))).toBe(true);
  });
});