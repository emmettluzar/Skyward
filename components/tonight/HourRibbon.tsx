"use client";

import type { ConditionsPoint, HourCondition } from "@/lib/types/conditions";

/**
 * Map a twilight state to a colored bar (prd.md §5 Row 1). Colors are themeable
 * tokens so red-light mode can collapse them to monochrome red (no blue/white).
 */
function twilightLevel(h: HourCondition): string {
  switch (h.twilight) {
    case "daylight":
      return "bg-(--twilight-day)";
    case "civil":
      return "bg-(--twilight-civil)";
    case "nautical":
      return "bg-(--twilight-nautical)";
    case "astro":
      return "bg-(--twilight-astro)";
    default:
      return "bg-secondary";
  }
}

function hourLabel(timeMs: number): string {
  const d = new Date(timeMs);
  const h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${ampm}`;
}

function cloudTitle(h: HourCondition): string {
  if (
    h.cloudLowFrac === null ||
    h.cloudMidFrac === null ||
    h.cloudHighFrac === null
  ) {
    return "Cloud data unavailable";
  }
  return `Low ${Math.round(h.cloudLowFrac * 100)}% · Mid ${Math.round(
    h.cloudMidFrac * 100,
  )}% · High ${Math.round(h.cloudHighFrac * 100)}%`;
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
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-3 shadow-lg backdrop-blur-xl sm:p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tonight · 6pm – 6am
          </span>
          <span className="text-xs text-muted-foreground">Loading forecast…</span>
        </div>
        <div className="mt-2 flex gap-1">
          {Array.from({ length: 13 }).map((_, i) => (
            <div key={i} className="h-8 flex-1 animate-pulse rounded-sm bg-secondary" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !point) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-3 shadow-lg backdrop-blur-xl sm:p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tonight · 6pm – 6am
          </span>
          <span className="text-xs text-muted-foreground">Forecast unavailable</span>
        </div>
        <div className="mt-2 flex h-8 items-center justify-center text-xs text-muted-foreground">
          No conditions data
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-border/50 bg-card/90 p-3 shadow-lg backdrop-blur-xl sm:p-4"
      aria-label="Tonight hour-by-hour observing conditions"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Tonight · {hourLabel(point.hours[0]?.timeMs ?? 0)} –{" "}
          {hourLabel(
            point.hours[point.hours.length - 1]?.timeMs ??
              point.hours[0]?.timeMs ??
              0,
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {point.moonPhaseLabel} · {Math.round(point.moonIllumFrac * 100)}% lit
        </span>
      </div>

      {/* Row 1: twilight state. Row 2: cloud stack. Heat = goAbility. */}
      <div className="mt-2 flex gap-1">
        {point.hours.map((h) => (
          <div key={h.timeMs} className="flex flex-1 flex-col gap-1" title={hourLabel(h.timeMs)}>
            {/* Twilight */}
            <div className={`h-2 rounded-sm ${twilightLevel(h)}`} />

            {/* Cloud stack: low (bottom, darkest), mid, high (top, lightest). */}
            <div
              className="relative h-6 overflow-hidden rounded-sm bg-secondary/40"
              title={cloudTitle(h)}
            >
              {h.cloudHighFrac !== null && (
                <div
                  className="absolute inset-x-0 top-0 bg-(--cloud-high)"
                  style={{ height: `${h.cloudHighFrac * 100}%` }}
                />
              )}
              {h.cloudMidFrac !== null && (
                <div
                  className="absolute inset-x-0 top-0 bg-(--cloud-mid)"
                  style={{ height: `${((h.cloudLowFrac ?? 0) + h.cloudMidFrac) * 100}%` }}
                />
              )}
              {h.cloudLowFrac !== null && (
                <div
                  className="absolute inset-x-0 bottom-0 bg-(--cloud-low)"
                  style={{ height: `${h.cloudLowFrac * 100}%` }}
                />
              )}
              {h.cloudLowFrac === null && (
                <div className="flex h-full items-center justify-center text-[8px] text-muted-foreground">
                  —
                </div>
              )}
            </div>

            {/* Optional go-ability heat dot (right-most row in prd.md §5). */}
            <div className="flex h-1.5 items-center justify-center">
              {h.goAbility !== null ? (
                <span
                  className="block size-1.5 rounded-full bg-(--goability-dot)"
                  style={{
                    opacity: 0.25 + 0.75 * h.goAbility,
                  }}
                />
              ) : (
                <span className="block size-1.5 rounded-full bg-muted-foreground/30" />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground/60">
        <span>6pm</span>
        <span>Midnight</span>
        <span>6am</span>
      </div>
    </div>
  );
}