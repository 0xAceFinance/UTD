import { POINTS_CONFIG } from "./config.js";

export interface MatchOutcomeInput {
  buyInUsd: number;
  winnerReturnPct: number; // e.g. 30 for +30%
  loserReturnPct: number; // e.g. 10 for +10%
}

export interface MatchPoints {
  winnerPoints: number;
  loserPoints: number;
  stakeMultiplier: number;
  marginMultiplier: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Section 07: winner = base x stake-size multiplier x margin multiplier;
 * loser = a flat ~25% of the base rate, independent of stake or margin —
 * participation is rewarded, but nowhere near what winning earns.
 */
export function computeMatchPoints(input: MatchOutcomeInput): MatchPoints {
  const stakeMultiplier = clamp(
    (input.buyInUsd / 100) * POINTS_CONFIG.stakeMultiplierPer100Usd,
    1,
    POINTS_CONFIG.stakeMultiplierCap
  );

  const marginGap = Math.max(0, input.winnerReturnPct - input.loserReturnPct);
  const marginMultiplier = clamp(1 + marginGap / 100, 1, POINTS_CONFIG.marginMultiplierCap);

  const winnerPoints = POINTS_CONFIG.basePoints * stakeMultiplier * marginMultiplier;
  const loserPoints = POINTS_CONFIG.basePoints * POINTS_CONFIG.loserFlatRate;

  return { winnerPoints, loserPoints, stakeMultiplier, marginMultiplier };
}

export type Tier = "Bronze" | "Silver" | "Gold" | "Diamond";

const TIER_THRESHOLDS: { tier: Tier; min: number }[] = [
  { tier: "Diamond", min: 100_000 },
  { tier: "Gold", min: 25_000 },
  { tier: "Silver", min: 5_000 },
  { tier: "Bronze", min: 0 },
];

/** Section 07 tier table, driven off lifetime cumulative points (never decreases on redemption). */
export function tierForPoints(lifetimePoints: number): Tier {
  return TIER_THRESHOLDS.find((t) => lifetimePoints >= t.min)!.tier;
}
