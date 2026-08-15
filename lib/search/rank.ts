/**
 * "Best" composite score for a candidate spot (prd.md §4.1 + .clinerules §3).
 *
 * The user-facing question is "which spot is *best* within my drive time?" —
 * not merely "which is darkest" or "which is closest". This module combines the
 * signals we already model into one 0–1 number plus plain-language reasons:
 *
 *   score = w_open·openness + w_park·parking + w_access·access
 *         + w_dark·S_dark + w_close·closeness
 *
 *   openness       → OSM tag proxy for open sky / greenery (prd.md §6)
 *   parking        → legal parking quality (prd.md §6)
 *   access         → access confidence label (prd.md §6, .clinerules §7)
 *   S_dark         → the SAME γ-shaped darkness factor used by Q (§4.1), so the
 *                    "best" ranking never disagrees with the scoring engine.
 *   closeness      → normalized against a config max drive time.
 *
 * Darkness reuses `darknessFactor` from lib/scoring/quality rather than
 * re-deriving the sacred formula. When the Phase 0 raster is unpublished
 * (sqmMpsas === null) we contribute a neutral 0.5 and record "darkness unknown"
 * in the reasons — we never fabricate a Bortle value (.clinerules §0.3).
 */

import { SEARCH_CONFIG } from "./config";
import { darknessFactor } from "@/lib/scoring/quality";
import type { CandidateSpot, AccessConfidence } from "@/lib/types/places";

/** Access confidence → 0..1 score (verified is best; verify-access lowest). */
const ACCESS_SCORES: Record<AccessConfidence, number> =
  SEARCH_CONFIG.best.accessScores;

export interface BestScoreInput {
  openness: number;
  greenery: number;
  parkingQuality: number;
  accessConfidence: AccessConfidence;
  sqmMpsas: number | null;
  /** One-way drive time, minutes (for the closeness term). */
  driveTimeMin: number;
}

export interface BestScoreResult {
  /** Composite "best" score, 0..1. */
  score: number;
  /** Human-readable reasons for the largest contributors. */
  reasons: string[];
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Compute the "best" score for a candidate spot. Pure (no I/O, no Date.now()).
 */
export function bestScore(input: BestScoreInput): BestScoreResult {
  const { opennessWeight, greeneryWeight, parkingWeight, accessWeight, darknessWeight, closenessWeight, maxDriveTimeMin } =
    SEARCH_CONFIG.best;

  const openTerm = clamp01(input.openness);
  const greenTerm = clamp01(input.greenery);
  const parkTerm = clamp01(input.parkingQuality);
  const accessTerm = ACCESS_SCORES[input.accessConfidence];

  // Darkness reuses the canonical γ-shaped S_dark factor. When the raster is
  // unavailable we use a neutral 0.5 and mark it honestly — no invented Bortle.
  const darkKnown = input.sqmMpsas !== null;
  const darkTerm = darkKnown
    ? darknessFactor(input.sqmMpsas as number).value
    : 0.5;

  const closeTerm = clamp01(1 - input.driveTimeMin / maxDriveTimeMin);

  const terms: Array<{ label: string; value: number; weight: number }> = [
    { label: "open sky", value: openTerm, weight: opennessWeight },
    { label: "nature & greenery", value: greenTerm, weight: greeneryWeight },
    { label: "parking", value: parkTerm, weight: parkingWeight },
    { label: "public access", value: accessTerm, weight: accessWeight },
    { label: darkKnown ? "darkness" : "darkness unknown", value: darkTerm, weight: darknessWeight },
    { label: "closeness", value: closeTerm, weight: closenessWeight },
  ];

  const score =
    opennessWeight * openTerm +
    greeneryWeight * greenTerm +
    parkingWeight * parkTerm +
    accessWeight * accessTerm +
    darknessWeight * darkTerm +
    closenessWeight * closeTerm;

  // Surface the two strongest signals as reasons (stable, human-readable).
  const ranked = [...terms].sort((a, b) => b.weight * b.value - a.weight * a.value);
  const reasons = ranked.slice(0, 2).map((t) => {
    const pct = Math.round(t.value * 100);
    return `${t.label} ${pct}%`;
  });

  return { score: clamp01(score), reasons };
}

/**
 * Assign a "best" score to each spot, then sort by score descending so the
 * "best within reach" tab ranks genuinely-best first (not simply closest).
 */
export function rankByBest(
  spots: readonly CandidateSpot[],
): CandidateSpot[] {
  const scored = spots.map((spot) => {
    const { score, reasons } = bestScore({
      openness: spot.openness,
      greenery: spot.greenery,
      parkingQuality: spot.parkingQuality,
      accessConfidence: spot.accessConfidence,
      sqmMpsas: spot.sqmMpsas,
      driveTimeMin: spot.driveTimeMin,
    });
    return { ...spot, score, scoreReasons: reasons };
  });

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((c, i) => {
    c.rank = i + 1;
  });
  return scored;
}