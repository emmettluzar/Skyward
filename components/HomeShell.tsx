"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Moon, MapPin, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerdictCard } from "@/components/verdict/VerdictCard";
import { HourRibbon } from "@/components/tonight/HourRibbon";
import { useVerdict } from "@/lib/hooks/use-verdict";
import { useConditions } from "@/lib/hooks/use-conditions";

// Lazy-load MapLibre to avoid SSR issues (WebGL, window, etc.)
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => (
    <div className="map-container flex items-center justify-center bg-card">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Loading map…</span>
      </div>
    </div>
  ),
});

/**
 * Hardcoded fallback location used until live browser geolocation is wired up
 * (per the task brief, "use dummy or hardcoded coordinates"). A mundane urban
 * coordinate is deliberate: it yields a truthful "UNKNOWN-darkness, likely
 * bright/murky" verdict rather than promising a dark sky at a fake wilderness.
 */
const FALLBACK_LOCATION = { lat: 40.7128, lon: -74.006 };

export default function HomeShell() {
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);

  const handleLocationReady = useCallback((lat: number, lng: number) => {
    setUserLocation({ lat, lng });
    setLocationLoading(false);
  }, []);

  // Use the live geolocation when available, otherwise the hardcoded fallback.
  const activeLat = userLocation?.lat ?? FALLBACK_LOCATION.lat;
  const activeLon = userLocation?.lng ?? FALLBACK_LOCATION.lon;

  const verdict = useVerdict({
    lat: activeLat,
    lon: activeLon,
    enabled: true,
  });

  const conditions = useConditions({
    lat: activeLat,
    lon: activeLon,
    enabled: true,
  });

  const conditionsPoint = conditions.data?.points[0];

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-background">
      {/* ── Full-screen Map ── */}
      <MapView
        onLocationReady={handleLocationReady}
        className="absolute inset-0"
      />

      {/* ── Top Bar ── */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-card/80 px-3 py-1.5 backdrop-blur-md">
          <Moon className="size-5 text-primary" />
          <span className="text-sm font-semibold tracking-tight">
            Skyward
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl bg-card/80 backdrop-blur-md"
            aria-label="Settings"
          >
            <Settings className="size-4" />
          </Button>
        </div>
      </header>

      {/* ── Bottom Sheet: Verdict + Tonight ── */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 px-4 pb-5 sm:px-6 sm:pb-6">
        {/* Location status line */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="size-3.5" />
          {locationLoading ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="block size-2 animate-pulse rounded-full bg-primary" />
              Finding your location…
            </span>
          ) : (
            <span>
              {activeLat.toFixed(3)}°, {activeLon.toFixed(3)}°
              {userLocation === null ? " (fallback)" : ""}
            </span>
          )}
        </div>

        {/* Verdict Card */}
        <VerdictCard
          verdict={verdict.data}
          isLoading={verdict.isLoading}
          isError={verdict.isError}
        />

        {/* Tonight Ribbon */}
        <HourRibbon
          point={conditionsPoint}
          isLoading={conditions.isLoading}
          isError={conditions.isError}
        />
      </div>
    </div>
  );
}