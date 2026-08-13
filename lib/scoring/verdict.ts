/**
 * Verdict thresholds (prd.md §4.4).
 *
 * | Condition                         | Verdict                                  |
 * |-----------------------------------|------------------------------------------|
 * | W ≥ 12 and C_cloud ≥ 0.55         | GO                                       |
 * | W ≥ 4                             | MAYBE                                    |
 * | W < 4 or C_cloud < 0.25           | STAY HOME                                |
 * | Q_home ≥ 0.8 · Q_best             | STAY HOME — backyard nearly as good      |
 *
 * A too-short observing window (§4.2) caps the verdict at MAYBE with reason
 * "not enough dark time tonight." The better-night hint uses
 * max(W_future) > 1.35 · W_tonight (§4.5).
 */

import { SCORING_CONFIG } from "./config";
import type { Verdict } from "@/lib/types/scoring";

export interface VerdictInput {
  /** W for the recommended site. */
  wTonight: number;
  /** C_cloud factor for the recommended site (0–1). */
  cloudFactor: number;
  /** Q at the candidate site (0–100). */
  qSite: number;
  /** Q staying home (0–100). */
  qHome: number;
  /** True when the observing window is too short for a worthwhile session. */
  windowTooShort: boolean;
  /** Max W over the next 5 nights (optional — enables better-night hint). */
  bestFutureW?: number;
  /** Human-readable label for the better night (e.g. "Thursday"). */
  betterNightLabel?: string;
}

export interface VerdictResult {
  verdict: Verdict;
  /** 2–4 plain-language reason chips. */
  reasons: string[];
  /** True when a "wait for a better night" hint should be shown. */
  suggestBetterNight: boolean;
  /** Label for the better night, when computed. */
  betterNightLabel?: string;
}

/**
 * Decide GO / MAYBE / STAY HOME. Order matters: the backyard near-tie takes
 * precedence, then the absolute GO bar, then the MAYBE floor, then the
 * in-window short-circuit to STAY HOME.
 */
export function decideVerdict(input: VerdictInput): VerdictResult {
  const { goW, goMinCloud, maybeW, homeNearBestRatio, betterNightRatio } =
    SCORING_CONFIG.verdict;

  const reasons: string[] = [];

  let verdict: Verdict;

  // Backyard near-tie: no gain worth the drive.
  if (input.qHome >= homeNearBestRatio * input.qSite) {
    verdict = "STAY HOME";
    reasons.push("your backyard is nearly as good tonight");
  } else if (input.wTonight >= goW && input.cloudFactor >= goMinCloud) {
    verdict = "GO";
  } else if (input.wTonight >= maybeW) {
    verdict = "MAYBE";
  } else {
    verdict = "STAY HOME";
  }

  // Cloud veto: a solid overcast means staying home regardless of W.
  if (input.cloudFactor < 0.25) {
    verdict = "STAY HOME";
    reasons.push("cloud cover too low to justify the drive");
  } else if (verdict === "GO" && input.cloudFactor < goMinCloud) {
    // Defensive: GO requires cloud ≥ goMinCloud, so this is normally
    // unreachable; kept as a boundary guard for future threshold changes.
    verdict = "MAYBE";
    reasons.push("cloud cover borderline for a long drive");
  }

  // Window cap: not enough dark time tonight caps at MAYBE (never GO).
  if (input.windowTooShort && verdict === "GO") {
    verdict = "MAYBE";
    reasons.push("not enough dark time tonight");
  }

  // Better-night hint (only meaningful when tonight isn't already a GO).
  let suggestBetterNight = false;
  let betterNightLabel: string | undefined;
  if (input.bestFutureW !== undefined) {
    if (input.bestFutureW > betterNightRatio * input.wTonight) {
      suggestBetterNight = true;
      betterNightLabel = input.betterNightLabel;
    }
  }

  // Ensure 2–4 chips total so the UI always justifies the verdict.
  const chips = dedupe(reasons).slice(0, 4);
  if (chips.length === 0) chips.push("conditions are workable");
  if (chips.length < 2) {
    chips.push(verdict === "GO" ? "clear enough to make the drive" : "check the forecast before leaving");
  }

  return { verdict, reasons: chips, suggestBetterNight, betterNightLabel };
}

/** Remove duplicate reason strings while preserving order. */
function dedupe(items: readonly string[]): string[] {
  return Array.from(new Set(items));
}