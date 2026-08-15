"use client";

import { useQuery } from "@tanstack/react-query";
import type { CandidatesResponse } from "@/lib/types/places";

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface Params {
  lat: number;
  lon: number;
  /** Maximum one-way drive time in minutes (optional — omit for unbounded). */
  maxDriveTimeMin?: number;
  /** Minimum SQM (mag/arcsec²) — "Bortle N or darker". Optional. */
  minSqm?: number;
  /** Minimum open-sky horizon openness proxy (0–1). Optional. */
  minOpenness?: number;
  /** Minimum greenery/natural beauty proxy (0–1). Optional. */
  minGreenery?: number;
  enabled?: boolean;
}

/**
 * Mode 1 "Threshold" search (prd.md §3.1).
 *
 * "Find me the closest spot that meets a quality bar." The server-side pipeline
 * samples candidate cells, snaps to legal OSM spots, runs one Valhalla matrix,
 * and returns spots sorted by drive time.
 */
export function useThresholdSearch({
  lat,
  lon,
  maxDriveTimeMin,
  minSqm,
  minOpenness,
  minGreenery,
  enabled = true,
}: Params) {
  return useQuery<CandidatesResponse>({
    queryKey: [
      "threshold",
      r3(lat),
      r3(lon),
      maxDriveTimeMin ?? "unbounded",
      minSqm ?? "any",
      minOpenness ?? "any",
      minGreenery ?? "any",
    ],
    queryFn: async () => {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: r3(lat),
          lon: r3(lon),
          mode: "threshold",
          maxDriveTimeMin,
          minSqm,
          minOpenness,
          minGreenery,
        }),
      });
      if (!res.ok) throw new Error("threshold search failed");
      return (await res.json()) as CandidatesResponse;
    },
    enabled,
  });
}