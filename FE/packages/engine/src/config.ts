import "dotenv/config";

/**
 * Every threshold here is the "default, tunable" value from the spec — not a
 * hardcoded constant. Calibrated down from the original spec defaults
 * (minMarketCapUsd 500k, minLiquidityUsd 150k, minLiquidityToMcRatio 0.25,
 * minVolume24hUsd 250k, minAgeDays 14) once real Robinhood Chain data showed
 * those were tuned for a mature market: against real live pairs, the
 * platform's own liquidity/market-cap safety gate (the one that never
 * relaxes) was rejecting nearly every real, actively-traded token on this
 * young chain, not just thin/manipulable ones. These values are calibrated
 * against that real distribution (see backend/lib/dexScreenerSource.ts) —
 * loose enough to admit genuinely active tokens, still well above the
 * near-zero-volume/near-zero-liquidity ghost tokens the real data also
 * turned up. Revisit upward as the chain's liquidity matures.
 */
export const GATE_CONFIG = {
  minMarketCapUsd: 150_000,
  minLiquidityUsd: 25_000,
  minLiquidityToMcRatio: 0.08,
  minVolume24hUsd: 75_000,
  minUniqueTraders24h: 150,
  minTxCount24h: 500,
  minAgeDays: 2,
  minLpLockDaysRemaining: 30,
  maxHolderConcentrationTop10Pct: 40,
};

export const SCORE_WEIGHTS = {
  volume: 0.35,
  txCount: 0.25,
  liquidity: 0.25,
  volatility: 0.15,
};

export const ORACLE_CONFIG = {
  /** Rolling window for TWAP smoothing, Section 04 mechanism 2. */
  twapWindowSeconds: 60,
  /** A new high must hold within this tolerance for dwellSeconds to count as a validated peak. */
  sustainedPeakDwellSeconds: 30,
  sustainedPeakToleranceRatio: 0.02,
  /** Reject a read if pool liquidity has dropped below this fraction of the battle-start liquidity. */
  liquidityGateMinRatio: 0.7,
};

export const CHAIN_CONFIG = {
  rpcUrl: process.env.CHAIN_RPC_URL ?? "",
  chainId: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : undefined,
  dexFactoryAddresses: (process.env.DEX_FACTORY_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  dataSource: (process.env.DATA_SOURCE ?? "mock") as "mock" | "chain",
};
