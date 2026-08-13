"use client";

import { useQuery } from "@tanstack/react-query";
import type { VerdictResponse } from "@/lib/types/verdict";

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface Params {
  lat: number;
  lon: number;
  /** Optional candidate site (second point). */
  site?: { lat: number; lon: number } | null;
  enabled?: boolean;
}

/**
 * Full Mode-2 verdict. When the darkness raster isn't published yet, this
 * returns `verdict: "UNKNOWN"` with live cloud/moon/transparency chips.
 */
export function useVerdict({ lat, lon, site, enabled = true }: Params) {
  const params = new URLSearchParams({
    lat: r3(lat).toString(),
    lon: r3(lon).toString(),
  });
  if (site) {
    params.set("slat", r3(site.lat).toString());
    params.set("slon", r3(site.lon).toString());
  }

  const qs = params.toString();

  return useQuery<VerdictResponse>({
    queryKey: ["verdict", qs],
    queryFn: async () => {
      const res = await fetch(`/api/verdict?${qs}`);
      if (!res.ok) throw new Error("verdict request failed");
      return (await res.json()) as VerdictResponse;
    },
    enabled,
  });
}