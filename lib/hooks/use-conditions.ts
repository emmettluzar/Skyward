"use client";

import { useQuery } from "@tanstack/react-query";
import type { ConditionsResponse } from "@/lib/types/conditions";

/** Round a coordinate to 3 dp before any outbound call (privacy + cache). */
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface Params {
  lat: number;
  lon: number;
  /** Multiple points: one call fetches them all (batched). */
  extra?: Array<{ lat: number; lon: number }>;
  enabled?: boolean;
}

/**
 * Tonight conditions for one or more coordinates. Coordinates are rounded to
 * 3 dp on the client before the request, per .clinerules §7.
 */
export function useConditions({ lat, lon, extra, enabled = true }: Params) {
  const lats = [lat, ...(extra ?? []).map((p) => p.lat)].map(r3).join(",");
  const lons = [lon, ...(extra ?? []).map((p) => p.lon)].map(r3).join(",");

  return useQuery<ConditionsResponse>({
    queryKey: ["conditions", lats, lons],
    queryFn: async () => {
      const res = await fetch(`/api/conditions?lat=${lats}&lon=${lons}`);
      if (!res.ok) throw new Error("conditions request failed");
      return (await res.json()) as ConditionsResponse;
    },
    enabled,
  });
}