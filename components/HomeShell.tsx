"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Moon,
  MapPin,
  Timer,
  MoonStar,
  X,
  SlidersHorizontal,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HourRibbon } from "@/components/tonight/HourRibbon";
import { useConditions } from "@/lib/hooks/use-conditions";
import { useTimeBudget } from "@/lib/hooks/use-timebudget";
import { useThresholdSearch } from "@/lib/hooks/use-threshold-search";
import { useTheme } from "@/components/theme-provider";
import { kmToMiles } from "@/lib/geo/distance";
import { minSqmForBortle } from "@/lib/darkness/bortle";
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

type HomeMode = "timebudget" | "threshold";

/**
 * Hardcoded fallback location used until live browser geolocation is wired up
 * (per the task brief, "use dummy or hardcoded coordinates"). A mundane urban
 * coordinate is deliberate: it yields a truthful "darkness unknown" verdict
 * rather than promising a dark sky at a fake wilderness.
 */
const FALLBACK_LOCATION = { lat: 40.7128, lon: -74.006 };

/** Drive-time budget presets (minutes). */
const BUDGET_PRESETS = [30, 45, 60, 90, 120] as const;

/** Bortle levels the user can choose for "Closest Dark Site". */
const BORTLE_OPTIONS = [
  { label: "Any darkness", bortle: 0 },
  { label: "≈ Bortle 4 or darker", bortle: 4 },
  { label: "≈ Bortle 3 or darker", bortle: 3 },
  { label: "≈ Bortle 2 or darker", bortle: 2 },
  { label: "≈ Bortle 1", bortle: 1 },
] as const;

/** Greenery/openness filter options. */
const OPENNESS_OPTIONS = [
  { label: "Any greenery", value: 0 },
  { label: "Open sky (≥ 70%)", value: 0.7 },
  { label: "Very open (≥ 85%)", value: 0.85 },
] as const;

/** Access confidence labels. */
const ACCESS_LABELS: Record<CandidateSpot["accessConfidence"], string> = {
  "verified-public": "Verified public",
  "likely-public": "Likely public",
  "verify-access": "Verify access before going",
};

export default function HomeShell() {
  const [mode, setMode] = useState<HomeMode>("timebudget");
  const [selectedSpot, setSelectedSpot] = useState<CandidateSpot | null>(null);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [budgetMin, setBudgetMin] = useState<number>(45);
  const [customBudget, setCustomBudget] = useState<string>("");
  const [bortleFilter, setBortleFilter] = useState<number>(0);
  const [opennessFilter, setOpennessFilter] = useState<number>(0);
  const [showBestInfo, setShowBestInfo] = useState(false);
  const { theme, toggleRed } = useTheme();

  const handleLocationReady = useCallback((lat: number, lng: number) => {
    setUserLocation({ lat, lng });
    setLocationLoading(false);
  }, []);

  // Use the live geolocation when available, otherwise the hardcoded fallback.
  const activeLat = userLocation?.lat ?? FALLBACK_LOCATION.lat;
  const activeLon = userLocation?.lng ?? FALLBACK_LOCATION.lon;

  const conditions = useConditions({
    lat: activeLat,
    lon: activeLon,
    enabled: true,
  });

  const timeBudget = useTimeBudget({
    lat: activeLat,
    lon: activeLon,
    budgetMin,
    enabled: mode === "timebudget",
  });

  const minSqm = bortleFilter > 0 ? minSqmForBortle(bortleFilter) : undefined;
  const minOpenness = opennessFilter > 0 ? opennessFilter : undefined;

  const threshold = useThresholdSearch({
    lat: activeLat,
    lon: activeLon,
    minSqm,
    minOpenness,
    enabled: mode === "threshold",
  });

  const conditionsPoint = conditions.data?.points[0];

  const tbSpots = timeBudget.data?.candidates.spots ?? [];
  const tbIso = timeBudget.data?.isochrone.geojson ?? null;

  const thSpots = threshold.data?.spots ?? [];

  // Determine which spots and isochrone to show on the map.
  const mapSpots = mode === "timebudget" ? tbSpots : thSpots;
  const mapIso = mode === "timebudget" ? tbIso : null;

  const handleSpotSelect = useCallback((spot: CandidateSpot) => {
    setSelectedSpot(spot);
  }, []);

  // Reset selected spot when mode changes.
  const switchMode = useCallback((newMode: HomeMode) => {
    setMode(newMode);
    setSelectedSpot(null);
  }, []);

  // Determine if the budget is custom (not a preset).
  const isCustomBudget = !BUDGET_PRESETS.includes(budgetMin as (typeof BUDGET_PRESETS)[number]);

  // Cloud factor for the "worth the drive?" suggestion.
  const cloudFactor = conditionsPoint
    ? conditionsPoint.hours.reduce((sum, h) => {
        if (h.cloudLowFrac === null) return sum;
        return sum + (1 - h.cloudLowFrac);
      }, 0) / conditionsPoint.hours.filter((h) => h.cloudLowFrac !== null).length
    : null;

  const cloudOk = cloudFactor !== null && cloudFactor >= 0.55;
  const cloudMarginal = cloudFactor !== null && cloudFactor >= 0.25 && cloudFactor < 0.55;

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-background">
      {/* ── Full-screen Map ── */}
      <MapView
        onLocationReady={handleLocationReady}
        className="absolute inset-0"
        spots={mapSpots}
        isochrone={mapIso}
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
        </div>
      </header>

      {/* ── Bottom Sheet ── */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[65dvh] flex-col gap-2 overflow-y-auto px-4 pb-5 sm:px-6 sm:pb-6">
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

        {/* ── Mode selector tabs ── */}
        <div className="flex gap-1.5 rounded-xl bg-card/80 p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={() => switchMode("timebudget")}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              mode === "timebudget"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Timer className="mr-1 inline size-3" />
            Best Within Reach
          </button>
          <button
            type="button"
            onClick={() => switchMode("threshold")}
            className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              mode === "threshold"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="mr-1 inline size-3" />
            Closest Dark Site
          </button>
        </div>

        {/* ── Tonight ribbon (shared across both tabs) ── */}
        <HourRibbon
          point={conditionsPoint}
          isLoading={conditions.isLoading}
          isError={conditions.isError}
        />

        {/* ── Cloud / worth-it suggestion ── */}
        {cloudFactor !== null && (
          <div
            className={`rounded-xl px-3 py-2 text-xs font-medium backdrop-blur-md ${
              cloudOk
                ? "bg-(--verdict-go-bg) text-(--verdict-go-text)"
                : cloudMarginal
                  ? "bg-(--verdict-maybe-bg) text-(--verdict-maybe-text)"
                  : "bg-(--verdict-stay-bg) text-(--verdict-stay-text)"
            }`}
          >
            {cloudOk
              ? "Clear skies tonight — worth the drive"
              : cloudMarginal
                ? "Some cloud — check the hour ribbon before you go"
                : "Heavy cloud tonight — stargazing may be limited"}
          </div>
        )}

        {mode === "timebudget" ? (
          <>
            {/* Budget selector */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card/80 px-3 py-2 backdrop-blur-md">
              <Timer className="size-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Drive time:</span>
              <div className="flex gap-1">
                {BUDGET_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setBudgetMin(m);
                      setCustomBudget("");
                    }}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      budgetMin === m && !isCustomBudget
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={480}
                  placeholder="Custom"
                  value={customBudget}
                  onChange={(e) => {
                    setCustomBudget(e.target.value);
                    const v = parseInt(e.target.value, 10);
                    if (v >= 5 && v <= 480) setBudgetMin(v);
                  }}
                  className={`w-16 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground placeholder:text-muted-foreground/50 ${
                    isCustomBudget ? "ring-1 ring-primary" : ""
                  }`}
                  aria-label="Custom drive time in minutes"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>

              {/* "How is 'best' decided?" info popup */}
              <button
                type="button"
                onClick={() => setShowBestInfo(!showBestInfo)}
                className="ml-auto rounded-full p-1 text-muted-foreground hover:text-foreground"
                aria-label="How is best decided?"
              >
                <Info className="size-4" />
              </button>
            </div>

            {showBestInfo && (
              <div className="rounded-xl border border-border/50 bg-card/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur-xl">
                <p className="font-medium text-foreground">How &ldquo;best&rdquo; is decided</p>
                <p className="mt-1">
                  We combine five signals into one score: open sky / greenery (30%), parking quality (15%),
                  public access confidence (20%), darkness (25%), and how close the site is (10%).
                  The darkness factor uses the same formula as our full scoring engine.
                  {bortleFilter === 0 && " When the darkness model is published, this will include modeled sky brightness."}
                </p>
              </div>
            )}

            {/* Time Budget results */}
            <ResultsPanel
              spots={tbSpots}
              isLoading={timeBudget.isLoading}
              isError={timeBudget.isError}
              onSpotSelect={handleSpotSelect}
              showScore
            />

            {/* Selected site detail + directions link */}
            {selectedSpot && (
              <SpotDetailCard spot={selectedSpot} onClose={() => setSelectedSpot(null)} />
            )}
          </>
        ) : (
          <>
            {/* Threshold filters */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card/80 px-3 py-2 backdrop-blur-md">
              <SlidersHorizontal className="size-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Darkness:</span>
              <select
                value={bortleFilter}
                onChange={(e) => setBortleFilter(Number(e.target.value))}
                className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground"
                aria-label="Minimum darkness level"
              >
                {BORTLE_OPTIONS.map((opt) => (
                  <option key={opt.bortle} value={opt.bortle}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <span className="text-xs font-medium text-muted-foreground">Greenery:</span>
              <select
                value={opennessFilter}
                onChange={(e) => setOpennessFilter(Number(e.target.value))}
                className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-foreground"
                aria-label="Minimum greenery/openness"
              >
                {OPENNESS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Threshold search results */}
            <ResultsPanel
              spots={thSpots}
              isLoading={threshold.isLoading}
              isError={threshold.isError}
              onSpotSelect={handleSpotSelect}
            />

            {/* Selected site detail + directions link */}
            {selectedSpot && (
              <SpotDetailCard spot={selectedSpot} onClose={() => setSelectedSpot(null)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Reusable results panel for both tabs. */
function ResultsPanel({
  spots,
  isLoading,
  isError,
  onSpotSelect,
  showScore,
}: {
  spots: CandidateSpot[];
  isLoading: boolean;
  isError: boolean;
  onSpotSelect?: (spot: CandidateSpot) => void;
  showScore?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
            <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
          <p className="text-sm font-medium">Finding reachable dark skies…</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
        <p className="text-sm text-muted-foreground">Could not run the search. Check your connection and try again.</p>
      </div>
    );
  }

  if (spots.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
        <p className="text-sm text-muted-foreground">
          No publicly accessible spots found. Try a longer drive time or relax your filters.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-border/50 bg-card/90 p-3 shadow-lg backdrop-blur-xl"
      data-testid="timebudget-results"
      aria-label="Reachable dark sky sites"
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <Timer className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Reachable sites
        </span>
      </div>
      <ul className="space-y-2">
        {spots.map((spot) => (
          <li key={spot.osmId}>
            <button
              type="button"
              onClick={() => onSpotSelect?.(spot)}
              className="w-full rounded-xl border border-border/40 bg-secondary/30 px-3 py-2 text-left transition-colors hover:bg-secondary"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">
                  <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                    {spot.rank}
                  </span>
                  {spot.name}
                </span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {spot.driveTimeEstimated ? "~" : ""}
                  {spot.driveTimeMin} min
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{ACCESS_LABELS[spot.accessConfidence]}</span>
                <span>{kmToMiles(spot.distKmFromOrigin).toFixed(1)} mi</span>
                {showScore && (
                  <span title={spot.scoreReasons.join(" · ")}>
                    Score {Math.round(spot.score * 100)}%
                  </span>
                )}
                <a
                  href={spot.deepLinks.googleMaps}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                  data-testid="directions-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  Directions
                </a>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Selected site detail card with directions link. */
function SpotDetailCard({
  spot,
  onClose,
}: {
  spot: CandidateSpot;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold">{spot.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {spot.driveTimeEstimated ? "~" : ""}
            {spot.driveTimeMin} min drive ·{" "}
            {kmToMiles(spot.distKmFromOrigin).toFixed(1)} mi away
          </p>
          {spot.scoreReasons.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              {spot.scoreReasons.join(" · ")}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close site details"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={spot.deepLinks.googleMaps}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="directions-link"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
        >
          Directions (Google Maps)
        </a>
      </div>
    </div>
  );
}