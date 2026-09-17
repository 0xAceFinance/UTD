// Shared types for the discovery engine + oracle pipeline.
// These map directly onto the MCAP DUEL spec, Sections 01 and 04.

/** A single read of one pool's reserves at one point in time. */
export interface PoolSample {
  poolAddress: string;
  tokenAddress: string;
  dexName: string;
  /** Raw reserve of the token being priced, in whole-token units (already decimal-adjusted). */
  reserveToken: number;
  /** Raw reserve of the quote asset (e.g. WETH/USDC), in whole-unit terms. */
  reserveQuote: number;
  /** USD price of one unit of the quote asset at sample time. */
  quotePriceUsd: number;
  timestampSec: number;
}

/** Derived from a PoolSample: what the oracle actually reasons about. */
export interface PricedPoolSample {
  poolAddress: string;
  timestampSec: number;
  priceUsd: number;
  liquidityUsd: number;
}

/** Rolled-up market data the scanner evaluates a token against (Section 01, hard gates). */
export interface TokenCandidate {
  tokenAddress: string;
  symbol: string;
  totalSupply: number;
  ageDays: number;
  uniqueTraders24h: number;
  txCount24h: number;
  volume24hUsd: number;
  /** % of supply held by the top 10 holders, 0-100. */
  holderConcentrationTop10Pct: number;
  lpLockedDaysRemaining: number;
  rugCheckPassed: boolean;
  isBlocklisted: boolean;
  /** Most recent sample from every pool this token trades on. */
  pools: PoolSample[];
}

export interface GateCheck {
  name: string;
  passed: boolean;
  /** Human-readable detail, e.g. "liquidity $92,000 < required $150,000". */
  detail: string;
  /** Hard safety gates can never be relaxed by the low-supply edge case (Section 01). */
  isSafetyGate: boolean;
}

export interface GateEvaluation {
  tokenAddress: string;
  symbol: string;
  passedAll: boolean;
  checks: GateCheck[];
}

export interface ScoredToken {
  tokenAddress: string;
  symbol: string;
  score: number;
  marketCapUsd: number;
  liquidityUsd: number;
}

export interface TopTenResult {
  selected: ScoredToken[];
  /** True if soft gates had to be relaxed to reach 10 candidates (safety gates never relax). */
  rankingRelaxed: boolean;
  relaxationLevel: number;
  excluded: GateEvaluation[];
}

export interface SustainedPeakResult {
  peakPriceUsd: number;
  /** Timestamp the sustained window started at. */
  windowStartSec: number;
  dwellSeconds: number;
}
