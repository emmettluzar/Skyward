"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  CandidatesResponse,
  IsochroneResponse,
} from "@/lib/types/places";

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Shape of `POST /api/candidates` in `timebudget` mode (see route handler). */
export interface TimeBudgetResult {
  candidates: CandidatesResponse;
  isochrone: IsochroneResponse;
}

interface Params {
  lat: number;
  lon: number;
  budgetMin: number;
  enabled?: boolean;
}

/**
 * Mode 3 "Time Budget" search (prd.md §3.3). One POST runs exactly one Valhalla
 * isochrone + one Overpass call server-side (enforced in the route handler);
 * the client just renders the returned spots + polygon.
 */
export function useTimeBudget({
  lat,
  lon,
  budgetMin,
  enabled = true,
}: Params) {
  return useQuery<TimeBudgetResult>({
    queryKey: ["timebudget", r3(lat), r3(lon), budgetMin],
    queryFn: async () => {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: r3(lat),
          lon: r3(lon),
          mode: "timebudget",
          budgetMin,
        }),
      });
      if (!res.ok) throw new Error("timebudget request failed");
      return (await res.json()) as TimeBudgetResult;
    },
    enabled,
  });
}