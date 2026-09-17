import type { TokenCandidate, TopTenResult, GateEvaluation, ScoredToken } from "../types.js";
import { evaluateGates } from "./gates.js";
import { scoreCandidates } from "./score.js";
import { priceSample, marketCapUsd, weightedAveragePriceUsd } from "../oracle/pricing.js";

const MAX_RELAXATION_LEVEL = 3;
const TARGET_SIZE = 10;

function toScoredToken(candidate: TokenCandidate, score: number): ScoredToken {
  const priced = candidate.pools.map(priceSample);
  const liquidityUsd = priced.reduce((s, p) => s + p.liquidityUsd, 0);
  const priceUsd = weightedAveragePriceUsd(priced);
  return {
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    score,
    marketCapUsd: marketCapUsd(priceUsd, candidate.totalSupply),
    liquidityUsd,
  };
}

/**
 * Section 01, Stage 1 + Stage 2 + the low-supply edge case, in one place:
 * apply hard gates, and if fewer than 10 tokens survive, progressively relax
 * only the soft eligibility gates (never the 5 safety gates) until either 10
 * survive or MAX_RELAXATION_LEVEL is reached.
 */
export function selectTopTen(candidates: TokenCandidate[]): TopTenResult {
  let relaxation = 0;
  let survivors: TokenCandidate[] = [];
  let evaluations: GateEvaluation[] = [];

  while (relaxation <= MAX_RELAXATION_LEVEL) {
    evaluations = candidates.map((c) => evaluateGates(c, relaxation));
    survivors = candidates.filter((c) => evaluations.find((e) => e.tokenAddress === c.tokenAddress)?.passedAll);
    if (survivors.length >= TARGET_SIZE || relaxation === MAX_RELAXATION_LEVEL) break;
    relaxation += 1;
  }

  const scores = survivors.length > 0 ? scoreCandidates(survivors) : new Map<string, number>();
  const scored = survivors
    .map((c) => toScoredToken(c, scores.get(c.tokenAddress) ?? 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_SIZE);

  const excluded = evaluations.filter((e) => !e.passedAll);

  return {
    selected: scored,
    rankingRelaxed: relaxation > 0,
    relaxationLevel: relaxation,
    excluded,
  };
}
