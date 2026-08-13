"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Moon, MapPin, Sparkles, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

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
        {/* Verdict Card */}
        <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl sm:p-5">
          {/* Location status */}
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="size-3.5" />
            {locationLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="block size-2 animate-pulse rounded-full bg-primary" />
                Finding your location…
              </span>
            ) : userLocation ? (
              <span>
                {userLocation.lat.toFixed(3)}°,{" "}
                {userLocation.lng.toFixed(3)}°
              </span>
            ) : (
              <span>Location unavailable</span>
            )}
          </div>

          {/* Placeholder verdict */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-secondary">
                <Sparkles className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-lg font-semibold leading-tight">
                  Finding the best sky…
                </p>
                <p className="text-sm text-muted-foreground">
                  Analyzing darkness, clouds & moon for tonight
                </p>
              </div>
            </div>
            <div className="hidden sm:block">
              <div className="rounded-full bg-secondary px-4 py-1.5 text-xs font-medium text-muted-foreground">
                Phase 1 MVP
              </div>
            </div>
          </div>
        </div>

        {/* Tonight Ribbon Placeholder */}
        <div className="rounded-2xl border border-border/50 bg-card/90 p-3 shadow-lg backdrop-blur-xl sm:p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tonight · 6pm – 6am
            </span>
            <span className="text-xs text-muted-foreground">
              Awaiting site selection
            </span>
          </div>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: 13 }).map((_, i) => (
              <div
                key={i}
                className="h-8 flex-1 rounded-sm bg-secondary"
                title={`${i + 6}pm – ${i + 7}${i + 6 >= 12 ? "am" : "pm"}`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground/60">
            <span>6pm</span>
            <span>Midnight</span>
            <span>6am</span>
          </div>
        </div>
      </div>
    </div>
  );
}