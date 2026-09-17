import type { PoolSample, PricedPoolSample } from "../types.js";

/**
 * Turns a raw reserve reading into a price + liquidity figure.
 * price = quote reserve / token reserve, expressed in USD via the quote asset's USD price.
 * liquidity = 2x the quote-side reserve value (standard AMM convention: liquidity is
 * both sides of the pool, and for a constant-product pool the two sides are equal in value).
 */
export function priceSample(sample: PoolSample): PricedPoolSample {
  if (sample.reserveToken <= 0) {
    return { poolAddress: sample.poolAddress, timestampSec: sample.timestampSec, priceUsd: 0, liquidityUsd: 0 };
  }
  const priceUsd = (sample.reserveQuote / sample.reserveToken) * sample.quotePriceUsd;
  const liquidityUsd = sample.reserveQuote * sample.quotePriceUsd * 2;
  return { poolAddress: sample.poolAddress, timestampSec: sample.timestampSec, priceUsd, liquidityUsd };
}

export function marketCapUsd(priceUsd: number, totalSupply: number): number {
  return priceUsd * totalSupply;
}

/**
 * Fast liquidity-weighted *average* across a token's pools — good enough for the
 * scanner's daily ranking pass. The live battle oracle uses the stricter
 * liquidity-weighted *median* in oracle/median.ts instead, since a median is
 * harder for one manipulated pool to drag around than an average is.
 */
export function weightedAveragePriceUsd(priced: PricedPoolSample[]): number {
  const withLiquidity = priced.filter((p) => p.liquidityUsd > 0);
  if (withLiquidity.length === 0) return 0;
  const totalWeight = withLiquidity.reduce((s, p) => s + p.liquidityUsd, 0);
  return withLiquidity.reduce((s, p) => s + p.priceUsd * (p.liquidityUsd / totalWeight), 0);
}
