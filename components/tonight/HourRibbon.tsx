"use client";

import { useState } from "react";
import { Info, Moon, Sparkles, Sun, Cloud, Eye, Clock, Star, Compass } from "lucide-react";
import type { ConditionsPoint, HourCondition } from "@/lib/types/conditions";

function formatTimeOnly(timeMs: number): string {
  const d = new Date(timeMs);
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const mins = d.getMinutes().toString().padStart(2, "0");
  return mins === "00" ? `${hour12} ${ampm}` : `${hour12}:${mins} ${ampm}`;
}

function hourLabel(timeMs: number): string {
  const d = new Date(timeMs);
  const h = d.getHours();
  const ampm = h >= 12 ? "p" : "a";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${ampm}`;
}

function maxCloudFrac(h: HourCondition): number | null {
  if (h.cloudLowFrac === null && h.cloudMidFrac === null && h.cloudHighFrac === null) {
    return null;
  }
  const low = h.cloudLowFrac ?? 0;
  const mid = h.cloudMidFrac ?? 0;
  const high = h.cloudHighFrac ?? 0;
  return Math.min(1, Math.max(low, mid, high, (low + mid + high) * 0.7));
}

function getClarityInfo(h: HourCondition): {
  label: string;
  colorClass: string;
  barColor: string;
  cloudPct: number | null;
} {
  const cloud = maxCloudFrac(h);
  if (cloud === null) {
    return {
      label: "No data",
      colorClass: "text-muted-foreground",
      barColor: "bg-muted",
      cloudPct: null,
    };
  }
  const pct = Math.round(cloud * 100);
  if (pct <= 15) {
    return {
      label: "Clear skies",
      colorClass: "text-emerald-400 font-semibold",
      barColor: "bg-emerald-500",
      cloudPct: pct,
    };
  }
  if (pct <= 40) {
    return {
      label: "Mostly clear",
      colorClass: "text-sky-400",
      barColor: "bg-sky-400",
      cloudPct: pct,
    };
  }
  if (pct <= 70) {
    return {
      label: "Partly cloudy",
      colorClass: "text-amber-400",
      barColor: "bg-amber-400",
      cloudPct: pct,
    };
  }
  return {
    label: "Overcast",
    colorClass: "text-muted-foreground",
    barColor: "bg-zinc-500",
    cloudPct: pct,
  };
}

function getTwilightName(twilight: HourCondition["twilight"]): {
  name: string;
  bgClass: string;
} {
  switch (twilight) {
    case "astro":
      return { name: "Dark Sky (Astro)", bgClass: "bg-indigo-950 border-indigo-500/40 text-indigo-200" };
    case "nautical":
      return { name: "Nautical Dusk", bgClass: "bg-indigo-900/60 border-indigo-400/30 text-indigo-300" };
    case "civil":
      return { name: "Civil Twilight", bgClass: "bg-violet-800/40 border-violet-400/30 text-violet-300" };
    case "daylight":
      return { name: "Daylight", bgClass: "bg-blue-600/30 border-blue-400/30 text-blue-200" };
    default:
      return { name: "Night", bgClass: "bg-secondary text-foreground" };
  }
}

export function HourRibbon({
  point,
  isLoading,
  isError,
}: {
  point?: ConditionsPoint;
  isLoading: boolean;
  isError: boolean;
}) {
  const [selectedHour, setSelectedHour] = useState<HourCondition | null>(null);
  const [showLegend, setShowLegend] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-3.5 shadow-lg backdrop-blur-xl sm:p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tonight's Sky & Cloud Forecast
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Loading weather…</span>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-hidden">
          {Array.from({ length: 13 }).map((_, i) => (
            <div key={i} className="h-16 flex-1 animate-pulse rounded-lg bg-secondary/60" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !point || point.hours.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-3.5 shadow-lg backdrop-blur-xl sm:p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Tonight's Sky & Cloud Forecast
          </span>
          <span className="text-xs text-muted-foreground">Forecast unavailable</span>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Could not load tonight's hourly weather forecast.
        </div>
      </div>
    );
  }

  // Active hour for details
  const activeDetailHour = selectedHour ?? point.hours.find((h) => h.twilight === "astro") ?? point.hours[Math.floor(point.hours.length / 2)];
  const activeClarity = activeDetailHour ? getClarityInfo(activeDetailHour) : null;
  const activeTwilight = activeDetailHour ? getTwilightName(activeDetailHour.twilight) : null;

  // Dark window and Peak Observing calculations
  const darkStartStr = point.astroDuskMs ? formatTimeOnly(point.astroDuskMs) : null;
  const darkEndStr = point.astroDawnMs ? formatTimeOnly(point.astroDawnMs) : null;
  const darkWindowStr = darkStartStr && darkEndStr
    ? `${darkStartStr} – ${darkEndStr}`
    : "Summer twilight (partial dark)";

  // Find Peak Observing Hours (highest goAbility or best dark + clear hours)
  const sortedByQuality = [...point.hours]
    .filter((h) => h.twilight === "astro" || h.twilight === "nautical")
    .sort((a, b) => (b.goAbility ?? 0) - (a.goAbility ?? 0));

  const bestHour = sortedByQuality[0] ?? point.hours[Math.floor(point.hours.length / 2)];
  const peakTimeStr = bestHour ? formatTimeOnly(bestHour.timeMs) : "Midnight";
  const peakQualityPct = bestHour && bestHour.goAbility !== null ? Math.round(bestHour.goAbility * 100) : 80;

  return (
    <div
      className="rounded-2xl border border-border/50 bg-card/90 p-3.5 shadow-lg backdrop-blur-xl sm:p-4"
      aria-label="Tonight hour-by-hour stargazing conditions"
    >
      {/* ── Top Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
            Tonight's Stargazing Forecast
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-medium text-foreground/90">
            <Moon className="size-3.5 text-primary" />
            {point.moonPhaseLabel} ({Math.round(point.moonIllumFrac * 100)}% lit)
          </span>
          <button
            type="button"
            onClick={() => setShowLegend(!showLegend)}
            className="rounded p-0.5 hover:text-foreground text-muted-foreground transition-colors"
            aria-label="Explain forecast chart"
            title="How to read this chart"
          >
            <Info className="size-3.5" />
          </button>
        </div>
      </div>

      {/* ── Astronomical Peak Times & Optimal Observing Window ── */}
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
        {/* Astronomical Dark Window */}
        <div className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-950/40 px-3 py-2 text-indigo-200">
          <Clock className="size-4 shrink-0 text-indigo-400" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-300/80">
              Astronomical Dark Window
            </p>
            <p className="font-bold text-indigo-100">
              {darkWindowStr}
            </p>
          </div>
        </div>

        {/* Peak Observing Window */}
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-emerald-200">
          <Star className="size-4 shrink-0 text-emerald-400" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">
              Peak Sky Window (Best Rating)
            </p>
            <p className="font-bold text-emerald-100">
              Around {peakTimeStr} · {peakQualityPct}% Optimal
            </p>
          </div>
        </div>
      </div>

      {/* ── Visual Bar Strip Legend Labels ── */}
      <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-muted-foreground px-0.5">
        <span>Timeline (6 PM → 6 AM)</span>
        <span>Tap hour for details</span>
      </div>

      {/* ── Hourly Forecast Visual Strip ── */}
      <div className="mt-1.5 flex gap-1 overflow-x-auto pb-1 pt-0.5">
        {point.hours.map((h) => {
          const clarity = getClarityInfo(h);
          const isSelected = selectedHour?.timeMs === h.timeMs;
          const isAstroDark = h.twilight === "astro";

          return (
            <button
              key={h.timeMs}
              type="button"
              onClick={() => setSelectedHour(h)}
              className={`group flex flex-1 min-w-[26px] flex-col items-center rounded-lg p-1.5 transition-all ${
                isSelected
                  ? "bg-primary/25 ring-2 ring-primary shadow-sm"
                  : isAstroDark
                    ? "bg-indigo-950/50 hover:bg-indigo-900/60"
                    : "bg-secondary/40 hover:bg-secondary/80"
              }`}
              title={`${hourLabel(h.timeMs)}: ${clarity.label} (${clarity.cloudPct !== null ? `${clarity.cloudPct}% cloud` : "N/A"}) · ${h.twilight}`}
            >
              {/* Hour time label */}
              <span className="text-[10px] font-bold text-muted-foreground group-hover:text-foreground">
                {hourLabel(h.timeMs)}
              </span>

              {/* Sky darkness indicator bar */}
              <div
                className={`mt-1 h-1.5 w-full rounded-full transition-colors ${
                  h.twilight === "astro"
                    ? "bg-indigo-500"
                    : h.twilight === "nautical"
                      ? "bg-purple-400"
                      : h.twilight === "civil"
                        ? "bg-amber-400"
                        : "bg-blue-400"
                }`}
                title={`Sky darkness: ${h.twilight}`}
              />

              {/* Cloud cover visual bar */}
              <div className="mt-1.5 flex h-8 w-full flex-col justify-end overflow-hidden rounded bg-background/80 p-0.5">
                {clarity.cloudPct !== null ? (
                  <div
                    className={`w-full rounded-xs transition-all ${clarity.barColor}`}
                    style={{
                      height: `${Math.max(15, clarity.cloudPct)}%`,
                      opacity: clarity.cloudPct <= 20 ? 0.95 : 0.75,
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[8px] text-muted-foreground">—</div>
                )}
              </div>

              {/* Clarity status dot */}
              <div className="mt-1 flex items-center justify-center">
                <span
                  className={`block size-1.5 rounded-full ${
                    clarity.cloudPct !== null && clarity.cloudPct <= 25
                      ? "bg-emerald-400 ring-2 ring-emerald-400/30"
                      : clarity.cloudPct !== null && clarity.cloudPct <= 60
                        ? "bg-amber-400"
                        : "bg-zinc-500"
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Active Selected Hour Detail Card ── */}
      {activeDetailHour && activeClarity && activeTwilight && (
        <div className="mt-2.5 rounded-xl border border-border/50 bg-secondary/40 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">
                {formatTimeOnly(activeDetailHour.timeMs)}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${activeTwilight.bgClass}`}>
                {activeTwilight.name}
              </span>
              <span className={`text-[11px] ${activeClarity.colorClass}`}>
                {activeClarity.label}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {activeClarity.cloudPct !== null && (
                <span>☁️ {activeClarity.cloudPct}% cloud</span>
              )}
              {activeDetailHour.tempC !== null && (
                <span>🌡️ {Math.round((activeDetailHour.tempC * 9) / 5 + 32)}°F</span>
              )}
              {activeDetailHour.windKph !== null && (
                <span>💨 {Math.round(activeDetailHour.windKph * 0.621371)} mph</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Chart Guide / Legend ── */}
      {showLegend && (
        <div className="mt-2.5 rounded-xl border border-border/50 bg-card p-3 text-xs text-muted-foreground">
          <p className="font-bold text-foreground">How to read this forecast chart:</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 text-[11px]">
            <div className="flex items-start gap-2">
              <span className="size-2.5 mt-0.5 shrink-0 rounded-full bg-indigo-500" />
              <span><strong>Top Darkness Bar:</strong> Blue = Daylight, Yellow = Civil Twilight, Purple = Nautical Dusk, Indigo = Full Astronomical Dark.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="size-2.5 mt-0.5 shrink-0 rounded-full bg-emerald-400" />
              <span><strong>Middle Cloud Block:</strong> Bar height shows % cloud cover. Green = Clear (0–15%), Blue = Mostly Clear (15–40%), Amber = Partly Cloudy, Gray = Overcast.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="size-2.5 mt-0.5 shrink-0 rounded-full bg-emerald-400 ring-2 ring-emerald-400/40" />
              <span><strong>Bottom Dot:</strong> Green indicates high clarity; amber is moderate; gray is poor visibility.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="size-2.5 mt-0.5 shrink-0 rounded-full bg-primary" />
              <span><strong>Best Observing:</strong> Hours where Indigo bar (dark) aligns with minimal cloud (green/low bar).</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}