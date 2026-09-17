import type { PoolSample } from "../types.js";

/** Builds one pool sample with an exact price and liquidity, back-solving reserves. */
export function makeSample(timestampSec: number, priceUsd: number, liquidityUsd: number): PoolSample {
  const reserveQuote = liquidityUsd / 2;
  const reserveToken = priceUsd === 0 ? 0 : reserveQuote / priceUsd;
  return {
    poolAddress: "0xpool",
    tokenAddress: "0xtoken",
    dexName: "scenario-dex",
    reserveToken,
    reserveQuote,
    quotePriceUsd: 1,
    timestampSec,
  };
}

export interface Scenario {
  name: string;
  description: string;
  samples: PoolSample[];
  totalSupply: number;
  startLiquidityUsd: number;
  /** What a correct oracle pipeline should report, for the backtest report to check itself against. */
  expected: { peakNear?: number; peakBelow?: number; peakAbove?: number };
}

const TOTAL_SUPPLY = 1_000_000_000;

/** A genuine, steady rally that holds — the pipeline should report the real peak. */
export const normalRally: Scenario = {
  name: "normal-rally",
  description: "Token climbs from $500K to $650K MC over 3 minutes and holds — no manipulation.",
  totalSupply: TOTAL_SUPPLY,
  startLiquidityUsd: 500_000,
  samples: [
    makeSample(0, 0.0005, 500_000),
    makeSample(30, 0.00054, 500_000),
    makeSample(60, 0.00058, 505_000),
    makeSample(90, 0.00062, 510_000),
    makeSample(120, 0.00065, 512_000),
    makeSample(150, 0.00065, 512_000),
    makeSample(180, 0.00064, 512_000),
  ],
  expected: { peakNear: 650_000 },
};

/** A self-pump: one wild spike, dumped immediately, while everything else holds ~$580K. */
export const wickAttack: Scenario = {
  name: "wick-attack",
  description: "A player buys their own token for one sample to fake a peak, then dumps straight back down.",
  totalSupply: TOTAL_SUPPLY,
  startLiquidityUsd: 500_000,
  samples: [
    makeSample(0, 0.0005, 500_000),
    makeSample(30, 0.00054, 500_000),
    makeSample(60, 0.00058, 500_000),
    makeSample(70, 0.002, 500_000), // the wick: an instant, unsustained spike to $2M MC
    makeSample(80, 0.0006, 500_000), // dumped right back down
    makeSample(110, 0.00059, 500_000),
    makeSample(140, 0.0006, 500_000),
  ],
  expected: { peakNear: 600_000, peakBelow: 1_000_000 },
};

/** LP gets pulled mid-battle; the thin pool left behind gets whipsawed. Should be rejected outright. */
export const liquidityRug: Scenario = {
  name: "liquidity-rug",
  description: "Liquidity is pulled mid-battle; post-rug price swings in the shallow pool must not count.",
  totalSupply: TOTAL_SUPPLY,
  startLiquidityUsd: 500_000,
  samples: [
    makeSample(0, 0.0005, 500_000),
    makeSample(30, 0.00054, 500_000),
    makeSample(60, 0.00058, 505_000),
    // LP pulled here: liquidity collapses to 8% of start.
    makeSample(90, 0.0009, 40_000),
    makeSample(120, 0.0011, 38_000),
    makeSample(150, 0.0007, 36_000),
  ],
  expected: { peakNear: 580_000, peakBelow: 900_000 },
};

export const ALL_SCENARIOS: Scenario[] = [normalRally, wickAttack, liquidityRug];
