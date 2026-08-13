"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Moon, MapPin, Timer, MoonStar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerdictCard } from "@/components/verdict/VerdictCard";
import { HourRibbon } from "@/components/tonight/HourRibbon";
import { TimeBudgetPanel } from "@/components/verdict/TimeBudgetPanel";
import { useVerdict } from "@/lib/hooks/use-verdict";
import { useConditions } from "@/lib/hooks/use-conditions";
import { useTimeBudget } from "@/lib/hooks/use-timebudget";
import { useTheme } from "@/components/theme-provider";
import type { CandidateSpot } from "@/lib/types/places";

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

type HomeMode = "verdict" | "timebudget";

/**
 * Hardcoded fallback location used until live browser geolocation is wired up
 * (per the task brief, "use dummy or hardcoded coordinates"). A mundane urban
 * coordinate is deliberate: it yields a truthful "UNKNOWN-darkness, likely
 * bright/murky" verdict rather than promising a dark sky at a fake wilderness.
 */
const FALLBACK_LOCATION = { lat: 40.7128, lon: -74.006 };

export default function HomeShell() {
  const [mode, setMode] = useState<HomeMode>("verdict");
  const [selectedSpot, setSelectedSpot] = useState<CandidateSpot | null>(null);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const { theme, toggleRed } = useTheme();

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

  const timeBudget = useTimeBudget({
    lat: activeLat,
    lon: activeLon,
    budgetMin: 45,
    enabled: mode === "timebudget",
  });

  const conditionsPoint = conditions.data?.points[0];

  const tbSpots = timeBudget.data?.candidates.spots ?? [];
  const tbIso = timeBudget.data?.isochrone.geojson ?? null;

  const handleSpotSelect = useCallback((spot: CandidateSpot) => {
    setSelectedSpot(spot);
  }, []);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-background">
      {/* ── Full-screen Map ── */}
      <MapView
        onLocationReady={handleLocationReady}
        className="absolute inset-0"
        spots={mode === "timebudget" ? tbSpots : []}
        isochrone={mode === "timebudget" ? tbIso : null}
        center={
          selectedSpot
            ? [selectedSpot.lon, selectedSpot.lat]
            : undefined
        }
        onSpotSelect={handleSpotSelect}
      />

      {/* ── Top Bar ── */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 sm:px-6">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-card/80 px-3 py-1.5 backdrop-blur-md">
          <Moon className="size-5 text-primary" />
          <span className="text-sm font-semibold tracking-tight">Skyward</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl bg-card/80 backdrop-blur-md"
            aria-label={
              theme === "red"
                ? "Exit red-light mode"
                : "Enable red-light mode"
            }
            aria-pressed={theme === "red"}
            onClick={toggleRed}
          >
            <MoonStar className={`size-4 ${theme === "red" ? "text-(--goability-dot)" : ""}`} />
          </Button>
          <Button
            variant={mode === "timebudget" ? "default" : "ghost"}
            size="sm"
            className="h-8 rounded-xl bg-card/80 backdrop-blur-md"
            onClick={() => setMode(mode === "timebudget" ? "verdict" : "timebudget")}
          >
            <Timer className="size-4" />
            <span className="ml-1.5">45 min</span>
          </Button>
        </div>
      </header>

      {/* ── Bottom Sheet: Verdict + Tonight, or Time Budget ── */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[70dvh] flex-col gap-3 overflow-y-auto px-4 pb-5 sm:px-6 sm:pb-6">
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

        {mode === "verdict" ? (
          <>
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
          </>
        ) : (
          <>
            {/* Time Budget results */}
            <TimeBudgetPanel
              spots={tbSpots}
              isLoading={timeBudget.isLoading}
              isError={timeBudget.isError}
              onSpotSelect={handleSpotSelect}
            />

            {/* Selected site detail + directions link */}
            {selectedSpot && (
              <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold">{selectedSpot.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      ≈ {selectedSpot.driveTimeMin} min drive ·{" "}
                      {selectedSpot.distKmFromOrigin.toFixed(1)} km away
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close site details"
                    onClick={() => setSelectedSpot(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={selectedSpot.deepLinks.googleMaps}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="directions-link"
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
                  >
                    Directions (Google Maps)
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}