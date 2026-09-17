import type { PricedPoolSample } from "../types.js";

/**
 * Liquidity-weighted median price across a token's pools at one instant.
 * Section 04, mechanism 1: no single pool's price is trusted alone. A median
 * is used instead of an average because one heavily-manipulated pool has to
 * pull past the *midpoint* of cumulative liquidity to move the result at all,
 * whereas an average is dragged proportionally by any single input.
 */
export function liquidityWeightedMedianPrice(samples: PricedPoolSample[]): number {
  const withLiquidity = samples.filter((s) => s.liquidityUsd > 0).sort((a, b) => a.priceUsd - b.priceUsd);
  if (withLiquidity.length === 0) return 0;
  if (withLiquidity.length === 1) return withLiquidity[0].priceUsd;

  const totalWeight = withLiquidity.reduce((s, p) => s + p.liquidityUsd, 0);
  const half = totalWeight / 2;

  let cumulative = 0;
  for (const sample of withLiquidity) {
    cumulative += sample.liquidityUsd;
    if (cumulative >= half) return sample.priceUsd;
  }
  return withLiquidity[withLiquidity.length - 1].priceUsd;
}
