import type { TokenCandidate } from "../types.js";
import { SCORE_WEIGHTS } from "../config.js";
import { priceSample } from "../oracle/pricing.js";

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5; // no spread in the candidate set — treat as neutral
  return (value - min) / (max - min);
}

function totalLiquidityUsd(candidate: TokenCandidate): number {
  return candidate.pools.reduce((sum, p) => sum + priceSample(p).liquidityUsd, 0);
}

/**
 * A single pool's reserve ratio has no volatility signal by itself in this
 * mock/early setup; volatility is approximated here from the volume/liquidity
 * ratio (a token trading heavily against a shallow pool moves more per trade).
 * Replace with realized price volatility once historical tick data exists.
 */
function volatilityProxy(candidate: TokenCandidate): number {
  const liquidity = totalLiquidityUsd(candidate);
  if (liquidity === 0) return 0;
  return candidate.volume24hUsd / liquidity;
}

/**
 * Composite score, Section 01 Stage 2: normalized blend of volume, tx count,
 * liquidity, and volatility. Ranks survivors of the hard gates down to 10 —
 * this function does not apply gates itself, see scanner/topTen.ts.
 */
export function scoreCandidates(candidates: TokenCandidate[]): Map<string, number> {
  const volumes = candidates.map((c) => c.volume24hUsd);
  const txCounts = candidates.map((c) => c.txCount24h);
  const liquidities = candidates.map(totalLiquidityUsd);
  const volatilities = candidates.map(volatilityProxy);

  const bounds = (arr: number[]) => ({ min: Math.min(...arr), max: Math.max(...arr) });
  const vB = bounds(volumes);
  const tB = bounds(txCounts);
  const lB = bounds(liquidities);
  const volB = bounds(volatilities);

  const scores = new Map<string, number>();
  candidates.forEach((c, i) => {
    const score =
      normalize(volumes[i], vB.min, vB.max) * SCORE_WEIGHTS.volume +
      normalize(txCounts[i], tB.min, tB.max) * SCORE_WEIGHTS.txCount +
      normalize(liquidities[i], lB.min, lB.max) * SCORE_WEIGHTS.liquidity +
      normalize(volatilities[i], volB.min, volB.max) * SCORE_WEIGHTS.volatility;
    scores.set(c.tokenAddress, score);
  });
  return scores;
}
