"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Moon,
  MapPin,
  Timer,
  X,
  SlidersHorizontal,
  Info,
  Navigation,
  Compass,
  Sparkles,
  Car,
  Trees,
  Eye,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HourRibbon } from "@/components/tonight/HourRibbon";
import { useConditions } from "@/lib/hooks/use-conditions";
import { useTimeBudget } from "@/lib/hooks/use-timebudget";
import { useThresholdSearch } from "@/lib/hooks/use-threshold-search";
import { kmToMiles } from "@/lib/geo/distance";
import { bortleFromSqm, minSqmForBortle } from "@/lib/darkness/bortle";
import { nelmFromSqm } from "@/lib/darkness/convert";
import type { CandidateSpot } from "@/lib/types/places";

// Lazy-load MapLibre to avoid SSR issues (WebGL, window, etc.)
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => (
    <div className="map-container flex items-center justify-center bg-card">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm text-muted-foreground">Loading interactive dark sky map…</span>
      </div>
    </div>
  ),
});

type HomeMode = "timebudget" | "threshold";

/**
 * Hardcoded fallback location used until live browser geolocation is wired up.
 */
const FALLBACK_LOCATION = { lat: 40.7128, lon: -74.006 };

/** Drive-time budget presets (minutes). */
const BUDGET_PRESETS = [30, 45, 60, 90, 120] as const;

/** Bortle levels the user can choose for "Closest Dark Site". Lower is darker. */
const BORTLE_OPTIONS = [
  { label: "Any darkness", bortle: 0 },
  { label: "≈ Bortle 4 or darker", bortle: 4 },
  { label: "≈ Bortle 3 or darker", bortle: 3 },
  { label: "≈ Bortle 2 or darker", bortle: 2 },
  { label: "≈ Bortle 1 (Pristine)", bortle: 1 },
] as const;

/** Openness (sky/horizon visibility) filter options. */
const OPENNESS_OPTIONS = [
  { label: "Any horizon", value: 0 },
  { label: "Open sky (≥ 70%)", value: 0.7 },
  { label: "Panoramic horizon (≥ 85%)", value: 0.85 },
] as const;

/** Greenery / nature filter options (parks, scenic fields, reserves over asphalt). */
const GREENERY_OPTIONS = [
  { label: "Any setting", value: 0 },
  { label: "Scenic / Nature (≥ 70%)", value: 0.7 },
  { label: "Parks & Reserves (≥ 85%)", value: 0.85 },
] as const;

/** Access confidence badges. */
const ACCESS_CONFIG: Record<
  CandidateSpot["accessConfidence"],
  { label: string; icon: typeof ShieldCheck; class: string }
> = {
  "verified-public": {
    label: "Verified public",
    icon: ShieldCheck,
    class: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  "likely-public": {
    label: "Likely public",
    icon: ShieldCheck,
    class: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  },
  "verify-access": {
    label: "Verify access",
    icon: ShieldAlert,
    class: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
};

/** Bortle color styling. */
function getBortleBadgeClass(bortle: number): string {
  if (bortle <= 2) return "bg-indigo-950 text-indigo-200 border-indigo-400/40";
  if (bortle <= 4) return "bg-blue-950 text-blue-200 border-blue-400/40";
  if (bortle <= 6) return "bg-amber-950 text-amber-200 border-amber-400/40";
  return "bg-zinc-900 text-zinc-300 border-zinc-700";
}

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
  const [greeneryFilter, setGreeneryFilter] = useState<number>(0);
  const [showBestInfo, setShowBestInfo] = useState(false);

  const handleLocationReady = useCallback((lat: number, lng: number) => {
    setUserLocation({ lat, lng });
    setLocationLoading(false);
  }, []);

  const handleRequestLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        handleLocationReady(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [handleLocationReady]);

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
  const minGreenery = greeneryFilter > 0 ? greeneryFilter : undefined;

  const threshold = useThresholdSearch({
    lat: activeLat,
    lon: activeLon,
    minSqm,
    minOpenness,
    minGreenery,
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
      }, 0) / Math.max(1, conditionsPoint.hours.filter((h) => h.cloudLowFrac !== null).length)
    : null;

  const cloudOk = cloudFactor !== null && cloudFactor >= 0.55;
  const cloudMarginal = cloudFactor !== null && cloudFactor >= 0.25 && cloudFactor < 0.55;

  // Location label for the worth-it banner
  const locationLabel = selectedSpot
    ? `Spot #${selectedSpot.rank} (${selectedSpot.name})`
    : mapSpots.length > 0 && mapSpots[0]
      ? `Best spot (#1 ${mapSpots[0].name})`
      : `Your location (${activeLat.toFixed(2)}°, ${activeLon.toFixed(2)}°)`;

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-background">
      {/* ── Full-screen Map ── */}
      <MapView
        onLocationReady={handleLocationReady}
        className="absolute inset-0"
        spots={mapSpots}
        isochrone={mapIso}
        userOrigin={[activeLon, activeLat]}
        center={
          selectedSpot
            ? [selectedSpot.lon, selectedSpot.lat]
            : undefined
        }
        onSpotSelect={handleSpotSelect}
      />

      {/* ── Top Bar ── */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 py-2.5 sm:px-6 sm:py-3.5">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border/40 bg-card/85 px-3 py-1.5 shadow-md backdrop-blur-md">
          <Moon className="size-5 text-primary" />
          <span className="text-sm font-bold tracking-tight">Skyward</span>
        </div>

        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
          {/* Re-locate button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-xl border border-border/40 bg-card/85 px-2.5 text-xs backdrop-blur-md hover:bg-secondary"
            onClick={handleRequestLocation}
            title="Update to current GPS location"
          >
            <Navigation className="size-3.5 text-primary mr-1" />
            <span className="hidden sm:inline">Locate</span>
          </Button>

          {/* About & Attribution page link */}
          <Link
            href="/about"
            className="inline-flex size-8 items-center justify-center rounded-xl border border-border/40 bg-card/85 text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground hover:bg-secondary"
            title="About & Data Sources"
            aria-label="About Skyward"
          >
            <HelpCircle className="size-4" />
          </Link>
        </div>
      </header>

      {/* ── Bottom Sheet ── */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[68dvh] flex-col gap-2.5 overflow-y-auto px-3 pb-5 sm:px-6 sm:pb-6">
        {/* Location status badge */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-primary" />
            {locationLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="block size-2 animate-pulse rounded-full bg-primary" />
                Finding your location…
              </span>
            ) : (
              <span>
                Origin: <strong>{activeLat.toFixed(3)}°, {activeLon.toFixed(3)}°</strong>
                {userLocation === null ? " (default)" : ""}
              </span>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground/70 hidden sm:inline">
            Ranked by dark sky quality & drive time
          </span>
        </div>

        {/* ── Mode selector tabs ── */}
        <div className="flex gap-1.5 rounded-xl border border-border/40 bg-card/90 p-1 shadow-md backdrop-blur-md">
          <button
            type="button"
            onClick={() => switchMode("timebudget")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              mode === "timebudget"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
          >
            <Timer className="size-3.5" />
            Best Within Reach
          </button>
          <button
            type="button"
            onClick={() => switchMode("threshold")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
              mode === "threshold"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            }`}
          >
            <SlidersHorizontal className="size-3.5" />
            Closest Dark Site
          </button>
        </div>

        {/* ── Tonight Sky & Cloud Forecast Ribbon ── */}
        <HourRibbon
          point={conditionsPoint}
          isLoading={conditions.isLoading}
          isError={conditions.isError}
        />

        {/* ── Worth-it Verdict Suggestion with Explicit Location ── */}
        {cloudFactor !== null && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium backdrop-blur-md shadow-sm ${
              cloudOk
                ? "bg-emerald-950/70 border-emerald-500/40 text-emerald-200"
                : cloudMarginal
                  ? "bg-amber-950/70 border-amber-500/40 text-amber-200"
                  : "bg-zinc-900/80 border-zinc-700 text-zinc-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 shrink-0 text-primary" />
              <div>
                <p className="font-semibold text-foreground">
                  {cloudOk
                    ? `Clear skies tonight — worth the drive!`
                    : cloudMarginal
                      ? `Mixed skies tonight — check the hourly forecast`
                      : `Heavy clouds tonight — stargazing may be limited`}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Forecast for <strong>{locationLabel}</strong> ·{" "}
                  {cloudOk
                    ? "Great visibility across observing hours"
                    : cloudMarginal
                      ? "Check the hour ribbon above for clear sky windows"
                      : "Consider waiting for a clearer night"}
                </p>
              </div>
            </div>
          </div>
        )}

        {mode === "timebudget" ? (
          <>
            {/* Drive Time Budget Selector */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-card/90 px-3 py-2.5 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Car className="size-3.5 text-primary" />
                <span>Max drive time:</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {BUDGET_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setBudgetMin(m);
                      setCustomBudget("");
                    }}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      budgetMin === m && !isCustomBudget
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-secondary/70 text-muted-foreground hover:text-foreground hover:bg-secondary"
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
                  className={`w-16 rounded-lg bg-secondary/80 px-2 py-1 text-xs font-medium text-foreground placeholder:text-muted-foreground/50 ${
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
                className="ml-auto rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                aria-label="How is best decided?"
                title="How ranking is calculated"
              >
                <Info className="size-4" />
              </button>
            </div>

            {showBestInfo && (
              <div className="rounded-xl border border-border/60 bg-card/95 p-3 text-xs text-muted-foreground shadow-md backdrop-blur-xl">
                <p className="font-semibold text-foreground">How &ldquo;best&rdquo; spot is ranked:</p>
                <p className="mt-1 leading-relaxed">
                  We balance 6 key factors: <strong>Zenith Darkness (20%)</strong> (modeled SQM & Bortle),{" "}
                  <strong>Open Horizon (25%)</strong>, <strong>Natural Setting & Greenery (15%)</strong>,{" "}
                  <strong>Public Access Confidence (15%)</strong>, <strong>Legal Parking (15%)</strong>, and{" "}
                  <strong>Drive Closeness (10%)</strong>.
                </p>
              </div>
            )}

            {/* Time Budget Results List */}
            <ResultsPanel
              spots={tbSpots}
              isLoading={timeBudget.isLoading}
              isError={timeBudget.isError}
              selectedSpotId={selectedSpot?.osmId}
              onSpotSelect={handleSpotSelect}
              showScore
            />

            {/* Selected site detail card */}
            {selectedSpot && (
              <SpotDetailCard spot={selectedSpot} onClose={() => setSelectedSpot(null)} />
            )}
          </>
        ) : (
          <>
            {/* Threshold Filters */}
            <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border/40 bg-card/90 px-3 py-2.5 shadow-sm backdrop-blur-md">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="size-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">Darkness:</span>
              </div>
              <select
                value={bortleFilter}
                onChange={(e) => setBortleFilter(Number(e.target.value))}
                className="rounded-lg bg-secondary/80 px-2.5 py-1 text-xs font-medium text-foreground border border-border/40"
                aria-label="Minimum darkness level"
              >
                {BORTLE_OPTIONS.map((opt) => (
                  <option key={opt.bortle} value={opt.bortle}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <Eye className="size-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">Openness:</span>
              </div>
              <select
                value={opennessFilter}
                onChange={(e) => setOpennessFilter(Number(e.target.value))}
                className="rounded-lg bg-secondary/80 px-2.5 py-1 text-xs font-medium text-foreground border border-border/40"
                aria-label="Minimum horizon openness"
              >
                {OPENNESS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <Trees className="size-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-foreground">Greenery:</span>
              </div>
              <select
                value={greeneryFilter}
                onChange={(e) => setGreeneryFilter(Number(e.target.value))}
                className="rounded-lg bg-secondary/80 px-2.5 py-1 text-xs font-medium text-foreground border border-border/40"
                aria-label="Minimum greenery and nature setting"
              >
                {GREENERY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Threshold Search Results List */}
            <ResultsPanel
              spots={thSpots}
              isLoading={threshold.isLoading}
              isError={threshold.isError}
              selectedSpotId={selectedSpot?.osmId}
              onSpotSelect={handleSpotSelect}
            />

            {/* Selected site detail card */}
            {selectedSpot && (
              <SpotDetailCard spot={selectedSpot} onClose={() => setSelectedSpot(null)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Reusable results panel with clear Bortle + SQM badges and drive times. */
function ResultsPanel({
  spots,
  isLoading,
  isError,
  selectedSpotId,
  onSpotSelect,
  showScore,
}: {
  spots: CandidateSpot[];
  isLoading: boolean;
  isError: boolean;
  selectedSpotId?: string;
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
          <div>
            <p className="text-sm font-semibold">Finding reachable dark sky spots…</p>
            <p className="text-xs text-muted-foreground">Analyzing light pollution & travel times</p>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
        <p className="text-sm text-muted-foreground">
          Could not complete the search. Check your connection and try again.
        </p>
      </div>
    );
  }

  if (spots.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
        <p className="text-sm text-muted-foreground">
          No publicly accessible spots found. Try increasing your drive time.
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
      <div className="flex items-center justify-between px-1 pb-2 border-b border-border/30">
        <div className="flex items-center gap-1.5">
          <Compass className="size-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Top Recommended Stargazing Spots
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {spots.length} options found
        </span>
      </div>

      <ul className="mt-2 space-y-2">
        {spots.map((spot) => {
          const isSelected = selectedSpotId === spot.osmId;
          const bortle = spot.sqmMpsas !== null ? bortleFromSqm(spot.sqmMpsas) : 4;
          const accessInfo = ACCESS_CONFIG[spot.accessConfidence] ?? ACCESS_CONFIG["verify-access"];
          const AccessIcon = accessInfo.icon;

          return (
            <li key={spot.osmId}>
              <button
                type="button"
                onClick={() => onSpotSelect?.(spot)}
                className={`group w-full rounded-xl border p-2.5 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border/40 bg-secondary/30 hover:bg-secondary/70 hover:border-border/70"
                }`}
              >
                {/* Line 1: Rank, Name, Drive Time */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                      {spot.rank}
                    </span>
                    <span className="truncate">{spot.name}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs font-semibold text-foreground">
                    {spot.driveTimeEstimated ? "~" : ""}
                    {spot.driveTimeMin} min drive
                  </span>
                </div>

                {/* Line 2: Darkness (Bortle + SQM) & Distance */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  {/* Bortle badge */}
                  <span
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${getBortleBadgeClass(
                      bortle,
                    )}`}
                    title="Estimated zenith sky brightness on the Bortle scale"
                  >
                    ≈ Bortle {bortle}
                  </span>

                  {/* SQM unit */}
                  {spot.sqmMpsas !== null && (
                    <span
                      className="rounded-md border border-border/40 bg-background/50 px-1.5 py-0.5 text-[10px] font-mono font-medium text-foreground"
                      title="Sky Quality Meter (mag/arcsec²)"
                    >
                      {spot.sqmMpsas.toFixed(2)} mag/arcsec²
                    </span>
                  )}

                  {/* Straight-line distance */}
                  <span className="text-muted-foreground">
                    {kmToMiles(spot.distKmFromOrigin).toFixed(1)} mi
                  </span>

                  {/* Access status */}
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${accessInfo.class}`}
                  >
                    <AccessIcon className="size-3" />
                    {accessInfo.label}
                  </span>

                  {/* Composite quality score */}
                  {showScore && spot.score > 0 && (
                    <span
                      className="ml-auto rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                      title={spot.scoreReasons.join(" · ")}
                    >
                      Score {Math.round(spot.score * 100)}%
                    </span>
                  )}
                </div>

                {/* Line 3: Direct Actions & Reason */}
                <div className="mt-2 flex items-center justify-between border-t border-border/20 pt-1.5 text-[11px] text-muted-foreground">
                  <span className="truncate max-w-[220px]">
                    {spot.scoreReasons.length > 0 ? spot.scoreReasons.join(" · ") : "Good open sky visibility"}
                  </span>
                  <a
                    href={spot.deepLinks.googleMaps}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                    data-testid="directions-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Directions
                    <ChevronRight className="size-3" />
                  </a>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Selected site detail card with deep links & full darkness + parking breakdown. */
function SpotDetailCard({
  spot,
  onClose,
}: {
  spot: CandidateSpot;
  onClose: () => void;
}) {
  const bortle = spot.sqmMpsas !== null ? bortleFromSqm(spot.sqmMpsas) : 4;
  const nelm = spot.sqmMpsas !== null ? nelmFromSqm(spot.sqmMpsas) : null;
  const accessInfo = ACCESS_CONFIG[spot.accessConfidence] ?? ACCESS_CONFIG["verify-access"];

  return (
    <div className="rounded-2xl border border-border/60 bg-card/95 p-4 shadow-xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {spot.rank}
            </span>
            <p className="text-base font-bold text-foreground">{spot.name}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {spot.driveTimeEstimated ? "~" : ""}
            {spot.driveTimeMin} min drive (estimated) · {kmToMiles(spot.distKmFromOrigin).toFixed(1)} miles away
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close site details"
          onClick={onClose}
          className="size-7 rounded-full"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Darkness & Quality Signals */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {/* Darkness metric box */}
        <div className="rounded-xl border border-border/40 bg-secondary/40 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Darkness Level
          </p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-xs font-bold border ${getBortleBadgeClass(bortle)}`}>
              ≈ Bortle {bortle}
            </span>
            {spot.sqmMpsas !== null && (
              <span className="font-mono text-xs text-foreground">
                {spot.sqmMpsas.toFixed(2)} SQM
              </span>
            )}
          </div>
          {nelm !== null && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Limiting star magnitude: <strong>Mag {nelm.toFixed(1)}</strong>
            </p>
          )}
        </div>

        {/* Access & Sky open proxy box */}
        <div className="rounded-xl border border-border/40 bg-secondary/40 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Site Setting
          </p>
          <p className="mt-1 text-xs font-medium text-foreground">
            {accessInfo.label} · {Math.round(spot.openness * 100)}% open sky
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {Math.round(spot.greenery * 100)}% nature setting · {Math.round(spot.parkingQuality * 100)}% parking
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-3.5 flex flex-wrap gap-2">
        <a
          href={spot.deepLinks.googleMaps}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="directions-link"
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
        >
          <Navigation className="size-3.5" />
          Directions (Google Maps)
        </a>
        <a
          href={spot.deepLinks.appleMaps}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border/40 bg-secondary px-3 text-xs font-medium text-foreground transition-all hover:bg-secondary/80"
        >
          Apple Maps
        </a>
      </div>
    </div>
  );
}