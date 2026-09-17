import type { GateCheck, GateEvaluation, TokenCandidate } from "../types.js";
import { GATE_CONFIG } from "../config.js";
import { priceSample, marketCapUsd, weightedAveragePriceUsd } from "../oracle/pricing.js";

/** Sums liquidity across every pool a token trades on. */
function totalLiquidityUsd(candidate: TokenCandidate): number {
  return candidate.pools.reduce((sum, p) => sum + priceSample(p).liquidityUsd, 0);
}

function estimatePriceUsd(candidate: TokenCandidate): number {
  return weightedAveragePriceUsd(candidate.pools.map(priceSample));
}

/**
 * Evaluates every hard gate from Section 01. `relaxation` (0 = default thresholds)
 * scales down the *soft* eligibility gates only — market cap, liquidity, volume,
 * unique traders/tx count, and age. The five safety gates (rug check, LP lock,
 * holder concentration, blocklist, and the liquidity/MC *ratio*) never relax,
 * regardless of relaxation level — see the Section 01 edge case.
 */
export function evaluateGates(candidate: TokenCandidate, relaxation = 0): GateEvaluation {
  const relaxFactor = Math.max(0, 1 - relaxation * 0.25); // e.g. relaxation=1 -> 75% of default threshold
  const liquidityUsd = totalLiquidityUsd(candidate);
  const priceUsd = estimatePriceUsd(candidate);
  const mc = marketCapUsd(priceUsd, candidate.totalSupply);

  const checks: GateCheck[] = [
    {
      name: "marketCap",
      passed: mc >= GATE_CONFIG.minMarketCapUsd * relaxFactor,
      detail: `market cap $${mc.toLocaleString()} vs required $${(GATE_CONFIG.minMarketCapUsd * relaxFactor).toLocaleString()}`,
      isSafetyGate: false,
    },
    {
      name: "liquidityAbsolute",
      passed: liquidityUsd >= GATE_CONFIG.minLiquidityUsd * relaxFactor,
      detail: `liquidity $${liquidityUsd.toLocaleString()} vs required $${(GATE_CONFIG.minLiquidityUsd * relaxFactor).toLocaleString()}`,
      isSafetyGate: false,
    },
    {
      name: "liquidityToMcRatio",
      passed: mc === 0 ? false : liquidityUsd / mc >= GATE_CONFIG.minLiquidityToMcRatio,
      detail: `liquidity/MC ratio ${(mc === 0 ? 0 : liquidityUsd / mc).toFixed(2)} vs required ${GATE_CONFIG.minLiquidityToMcRatio}`,
      // This is the anti-manipulation ratio, not the absolute floor — treated as a safety gate.
      isSafetyGate: true,
    },
    {
      name: "volume24h",
      passed: candidate.volume24hUsd >= GATE_CONFIG.minVolume24hUsd * relaxFactor,
      detail: `24h volume $${candidate.volume24hUsd.toLocaleString()} vs required $${(GATE_CONFIG.minVolume24hUsd * relaxFactor).toLocaleString()}`,
      isSafetyGate: false,
    },
    {
      name: "uniqueTraders24h",
      passed: candidate.uniqueTraders24h >= GATE_CONFIG.minUniqueTraders24h * relaxFactor,
      detail: `${candidate.uniqueTraders24h} unique traders vs required ${Math.round(GATE_CONFIG.minUniqueTraders24h * relaxFactor)}`,
      isSafetyGate: false,
    },
    {
      name: "txCount24h",
      passed: candidate.txCount24h >= GATE_CONFIG.minTxCount24h * relaxFactor,
      detail: `${candidate.txCount24h} txns vs required ${Math.round(GATE_CONFIG.minTxCount24h * relaxFactor)}`,
      isSafetyGate: false,
    },
    {
      name: "age",
      passed: candidate.ageDays >= GATE_CONFIG.minAgeDays * relaxFactor,
      detail: `${candidate.ageDays} days old vs required ${(GATE_CONFIG.minAgeDays * relaxFactor).toFixed(1)}`,
      isSafetyGate: false,
    },
    {
      name: "rugCheck",
      passed: candidate.rugCheckPassed,
      detail: candidate.rugCheckPassed ? "passed" : "failed rug-check equivalent screen",
      isSafetyGate: true,
    },
    {
      name: "lpLock",
      passed: candidate.lpLockedDaysRemaining >= GATE_CONFIG.minLpLockDaysRemaining,
      detail: `${candidate.lpLockedDaysRemaining} days LP-lock remaining vs required ${GATE_CONFIG.minLpLockDaysRemaining}`,
      isSafetyGate: true,
    },
    {
      name: "holderConcentration",
      passed: candidate.holderConcentrationTop10Pct < GATE_CONFIG.maxHolderConcentrationTop10Pct,
      detail: `top-10 holders own ${candidate.holderConcentrationTop10Pct}% vs max ${GATE_CONFIG.maxHolderConcentrationTop10Pct}%`,
      isSafetyGate: true,
    },
    {
      name: "blocklist",
      passed: !candidate.isBlocklisted,
      detail: candidate.isBlocklisted ? "token is on the platform blocklist" : "not blocklisted",
      isSafetyGate: true,
    },
  ];

  return {
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    passedAll: checks.every((c) => c.passed),
    checks,
  };
}
