import type { PoolSample } from "../types.js";
import { priceSample } from "./pricing.js";
import { liquidityWeightedMedianPrice } from "./median.js";
import { computeTwapSeries, type TimePoint } from "./twap.js";
import { computeSustainedPeak } from "./sustainedPeak.js";
import { passesLiquidityGate } from "./liquidityGate.js";
import { SampleLog } from "./sampleLog.js";
import { ORACLE_CONFIG } from "../config.js";

export interface OraclePipelineInput {
  tokenAddress: string;
  totalSupply: number;
  /** Every raw pool sample taken during the battle window, across all of the token's pools. */
  rawSamples: PoolSample[];
  startLiquidityUsd: number;
}

export interface OraclePipelineResult {
  tokenAddress: string;
  /** The final answer: this is what settlement uses. Null if no reading ever validated. */
  validatedPeakMarketCapUsd: number | null;
  rejectedForLiquidity: number;
  totalSamplesConsidered: number;
  sampleLogVerified: boolean;
  auditTrail: ReturnType<SampleLog["all"]>;
}

/**
 * The full Section 04 pipeline, end to end: raw multi-pool reserve samples in,
 * a single validated peak market cap out (or null if nothing ever validated).
 *
 * Steps, matching the spec diagram exactly:
 *  1. group raw samples by timestamp, take the liquidity-weighted median price
 *  2. reject any per-timestamp reading whose liquidity has fallen too far from battle start
 *  3. smooth the surviving readings into a 60s TWAP series
 *  4. run the sustained-peak check over the TWAP series
 *  5. log every raw sample into the hash-chained audit log along the way
 */
export function runOraclePipeline(input: OraclePipelineInput): OraclePipelineResult {
  const log = new SampleLog<PoolSample>();
  input.rawSamples.forEach((s) => log.append(s));

  const byTimestamp = new Map<number, PoolSample[]>();
  for (const sample of input.rawSamples) {
    const bucket = byTimestamp.get(sample.timestampSec) ?? [];
    bucket.push(sample);
    byTimestamp.set(sample.timestampSec, bucket);
  }

  const validatedPoints: TimePoint[] = [];
  let rejectedForLiquidity = 0;

  for (const [timestampSec, samples] of byTimestamp) {
    const priced = samples.map(priceSample);
    const liquidityUsd = priced.reduce((s, p) => s + p.liquidityUsd, 0);

    if (!passesLiquidityGate(liquidityUsd, input.startLiquidityUsd, ORACLE_CONFIG.liquidityGateMinRatio)) {
      rejectedForLiquidity += 1;
      continue;
    }

    const medianPrice = liquidityWeightedMedianPrice(priced);
    validatedPoints.push({ timestampSec, priceUsd: medianPrice });
  }

  const twapSeries = computeTwapSeries(validatedPoints, ORACLE_CONFIG.twapWindowSeconds);
  const sustainedPeak = computeSustainedPeak(twapSeries, {
    dwellSeconds: ORACLE_CONFIG.sustainedPeakDwellSeconds,
    toleranceRatio: ORACLE_CONFIG.sustainedPeakToleranceRatio,
  });

  return {
    tokenAddress: input.tokenAddress,
    validatedPeakMarketCapUsd: sustainedPeak ? sustainedPeak.peakPriceUsd * input.totalSupply : null,
    rejectedForLiquidity,
    totalSamplesConsidered: input.rawSamples.length,
    sampleLogVerified: log.verify(),
    auditTrail: log.all(),
  };
}
