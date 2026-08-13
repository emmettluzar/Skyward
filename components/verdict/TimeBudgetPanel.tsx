"use client";

import { Loader2, Timer, TriangleAlert } from "lucide-react";
import type { CandidateSpot } from "@/lib/types/places";

/** Human label for access confidence (.clinerules §7). */
const ACCESS_LABELS: Record<CandidateSpot["accessConfidence"], string> = {
  "verified-public": "Verified public",
  "likely-public": "Likely public",
  "verify-access": "Verify access before going",
};

/**
 * Mode 3 "Time Budget" results panel. Lists the ranked spots with a well-formed
 * Google Maps directions deep link and an honest access-confidence label, per
 * .clinerules §7 and the Playwright smoke path (open a site → directions link).
 */
export function TimeBudgetPanel({
  spots,
  isLoading,
  isError,
  onSpotSelect,
}: {
  spots: CandidateSpot[];
  isLoading: boolean;
  isError: boolean;
  onSpotSelect?: (spot: CandidateSpot) => void;
}) {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Finding reachable dark skies…</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
            <TriangleAlert className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Could not run the search.</p>
        </div>
      </div>
    );
  }

  if (spots.length === 0) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/90 p-4 shadow-lg backdrop-blur-xl">
        <p className="text-sm text-muted-foreground">
          No publicly accessible spots found within this drive time.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-border/50 bg-card/90 p-3 shadow-lg backdrop-blur-xl"
      data-testid="timebudget-results"
      aria-label="Reachable dark sky sites ranked by drive time"
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
                <span>{spot.distKmFromOrigin.toFixed(1)} km</span>
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