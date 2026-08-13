/**
 * Client-facing shape of the `/api/verdict` response (Mode 2 Verdict card).
 *
 * The scoring engine's `Verdict` type is intentionally GO | MAYBE | STAY HOME
 * (lib/types/scoring.ts). At the route boundary we add a fourth "UNKNOWN"
 * state for honest degradation: when a required enrichment (currently the
 * darkness model) is unavailable we must not fabricate a GO/STAY-HOME call.
 * `.clinerules` §4 uses exactly this wording for upstream failure.
 */

import type { ConditionsPoint } from "./conditions";

/** Verdict the UI renders, including the degraded "conditions unknown" state. */
export type ApiVerdict = "GO" | "MAYBE" | "STAY HOME" | "UNKNOWN";

export interface VerdictResponse {
  verdict: ApiVerdict;
  /** 2–4 plain-language reason chips. */
  reasons: string[];
  /** W — worth-it score, null when it cannot be computed (darkness missing). */
  wTonight: number | null;
  /** C_cloud factor (0–1), or null when weather is down. */
  cloudFactor: number | null;
  /** Q_site - Q_home marginal quality gain, 0–100. */
  deltaQ: number | null;
  /** One-way drive time in minutes (always known; estimated flag notes hedging). */
  driveTimeMin: number;
  estimated: boolean;
  /** Enrichments/products that are missing or estimated. */
  partial: string[];
  /** Conditions for the home/location point, so the ribbon stays live. */
  conditions: ConditionsPoint;
  generatedAtMs: number;
}