/**
 * Observing window (prd.md §4.2).
 *
 *   window_start = max(astronomical_dusk, user_earliest_departure + drive)
 *   window_end   = min(astronomical_dawn, user_bedtime - drive_home)
 *
 * If window_end - window_start < 45 min → verdict capped at MAYBE
 * ("not enough dark time tonight").
 *
 * Astronomical dusk/dawn are **injected** as epoch milliseconds. They are
 * computed locally by astronomy-engine in Phase 1; keeping them as parameters
 * makes this function pure, offline-safe, and unit-testable without I/O.
 */

import { SCORING_CONFIG } from "./config";
import type { ObservingWindow } from "@/lib/types/scoring";

export interface WindowInput {
  /** Astronomical dusk, epoch ms. */
  astroDuskMs: number;
  /** Astronomical dawn (next morning), epoch ms. */
  astroDawnMs: number;
  /** Earliest the user can leave home, epoch ms. */
  earliestDepartureMs: number;
  /** One-way drive time to the site, minutes. */
  driveTimeMin: number;
  /** User's bedtime, epoch ms. */
  bedtimeMs: number;
  /** Drive home time, minutes. If not given, reuses driveTimeMin. */
  driveHomeTimeMin?: number;
}

const MS_PER_MIN = 60_000;

/**
 * Compute the observing window for a candidate site.
 *
 * Always returns { startMs, endMs, durationMin, tooShort, reasons } even when
 * the window is degenerate (end <= start), so callers can surface the reason
 * rather than throwing.
 */
export function computeWindow(input: WindowInput): ObservingWindow {
  const { minDurationMin } = SCORING_CONFIG.window;

  const driveHomeMin = input.driveHomeTimeMin ?? input.driveTimeMin;

  const startMs = Math.max(
    input.astroDuskMs,
    input.earliestDepartureMs + input.driveTimeMin * MS_PER_MIN,
  );

  const endMs = Math.min(
    input.astroDawnMs,
    input.bedtimeMs - driveHomeMin * MS_PER_MIN,
  );

  // Guard against a non-positive window (bedtime before you could get there,
  // or dawn before dusk — e.g. polar conditions where astro twilight never
  // ends). Treat it as zero usable time and explain honestly.
  const durationMin = endMs > startMs ? (endMs - startMs) / MS_PER_MIN : 0;
  const tooShort = durationMin < minDurationMin;

  const reasons: string[] = [];
  if (durationMin <= 0) {
    reasons.push("no dark window tonight");
  } else if (tooShort) {
    reasons.push(`not enough dark time tonight (${Math.round(durationMin)} min)`);
  } else {
    reasons.push(`${Math.round(durationMin)} min of dark sky`);
  }

  return { startMs, endMs, durationMin, tooShort, reasons };
}