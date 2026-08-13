/**
 * Worth It `W` — is the drive justified? (prd.md §4.3)
 *
 *   ΔQ  = Q_site - Q_home                       # marginal gain over your backyard
 *   t_d = one-way drive minutes
 *   t_o = planned observing minutes (default 90)
 *
 *   time_efficiency = ΔQ · t_o / (2·t_d + t_o)
 *   fuel_cost_pts   = κ · (2 · dist_km / 100 · L_per_100km · price)
 *   fatigue_pts     = φ · max(0, (arrive_home - bedtime) in hours)
 *
 *   W = time_efficiency - fuel_cost_pts - fatigue_pts
 *
 * t_o / (2·t_d + t_o) is the fraction of committed time actually spent under
 * the stars — a real, explainable quantity. Long drives become acceptable for
 * long sessions and unacceptable for a 30-minute peek.
 */

import { SCORING_CONFIG } from "./config";

export interface WorthItInput {
  /** Q for the candidate site (0–100). */
  qSite: number;
  /** Q for staying home (0–100). */
  qHome: number;
  /** One-way drive time, minutes. */
  driveTimeMin: number;
  /** Planned observing time, minutes (defaults to config). */
  observingMin?: number;
  /** Round-trip distance, km. */
  distKm: number;
  /** Fuel price per litre in the user's currency. */
  fuelPricePerLitre: number;
  /** Time you arrive back home, epoch ms. */
  arriveHomeMs: number;
  /** Bedtime, epoch ms. */
  bedtimeMs: number;
}

export interface WorthItResult {
  /** The W score. */
  value: number;
  /** ΔQ marginal gain. */
  deltaQ: number;
  /** time_efficiency component. */
  timeEfficiency: number;
  /** fuel_cost_pts component. */
  fuelCostPts: number;
  /** fatigue_pts component. */
  fatiguePts: number;
  /** Fraction of committed time spent observing (0..1). */
  observingFraction: number;
  reasons: string[];
}

/**
 * Compute W. Pure and side-effect free.
 */
export function worthIt(input: WorthItInput): WorthItResult {
  const { defaultObservingMin, kappa, litresPer100km, phi } = SCORING_CONFIG.worthIt;

  const observingMin = input.observingMin ?? defaultObservingMin;
  const deltaQ = input.qSite - input.qHome;

  // Fraction of committed trip time actually observing.
  const observingFraction = observingMin / (2 * input.driveTimeMin + observingMin);
  const timeEfficiency = deltaQ * observingFraction;

  // Fuel: round-trip distance → litres → cost → κ points.
  const fuelCostPts =
    kappa * ((2 * input.distKm) / 100) * litresPer100km * input.fuelPricePerLitre;

  // Fatigue: hours late beyond bedtime.
  const lateHours = Math.max(0, (input.arriveHomeMs - input.bedtimeMs) / 3_600_000);
  const fatiguePts = phi * lateHours;

  const value = timeEfficiency - fuelCostPts - fatiguePts;

  const reasons = [
    `ΔQ ${deltaQ.toFixed(1)} over home`,
    `${input.driveTimeMin} min drive`,
    `${Math.round(observingFraction * 100)}% of trip under the stars`,
  ];
  if (lateHours > 0) reasons.push(`arrive home ${lateHours.toFixed(1)} h past bedtime`);

  return {
    value,
    deltaQ,
    timeEfficiency,
    fuelCostPts,
    fatiguePts,
    observingFraction,
    reasons,
  };
}