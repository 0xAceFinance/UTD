import type { DataSource } from "./dataSource.js";
import type { PoolSample, TokenCandidate } from "../types.js";

const now = () => Math.floor(Date.now() / 1000);

/**
 * Synthetic DataSource for local development and tests: a handful of
 * candidate tokens spanning "should make the Top 10", "fails a hard gate",
 * and "borderline" cases, so the scanner pipeline is exercisable end-to-end
 * without live chain access. Replace with ChainDexReader once real
 * Robinhood Chain RPC + DEX details are available.
 */
export class MockDataSource implements DataSource {
  async listCandidates(): Promise<TokenCandidate[]> {
    const t = now();
    const pool = (tokenAddress: string, reserveToken: number, reserveQuote: number): PoolSample => ({
      poolAddress: `${tokenAddress}-pool`,
      tokenAddress,
      dexName: "mock-dex",
      reserveToken,
      reserveQuote,
      quotePriceUsd: 1, // quote asset priced 1:1 USD for simplicity (e.g. a USDC pair)
      timestampSec: t,
    });

    return [
      {
        tokenAddress: "0xAAA...healthy",
        symbol: "HEALTHY",
        totalSupply: 1_000_000_000,
        ageDays: 45,
        uniqueTraders24h: 800,
        txCount24h: 3200,
        volume24hUsd: 900_000,
        holderConcentrationTop10Pct: 22,
        lpLockedDaysRemaining: 120,
        rugCheckPassed: true,
        isBlocklisted: false,
        pools: [pool("0xAAA...healthy", 500_000_000, 300_000)],
      },
      {
        tokenAddress: "0xBBB...thinliquidity",
        symbol: "THIN",
        totalSupply: 1_000_000_000,
        ageDays: 30,
        uniqueTraders24h: 400,
        txCount24h: 1500,
        volume24hUsd: 400_000,
        holderConcentrationTop10Pct: 18,
        lpLockedDaysRemaining: 60,
        rugCheckPassed: true,
        isBlocklisted: false,
        // Liquidity well under the $150k / 25%-of-MC floor.
        pools: [pool("0xBBB...thinliquidity", 500_000_000, 40_000)],
      },
      {
        tokenAddress: "0xCCC...newlaunch",
        symbol: "NEWB",
        totalSupply: 1_000_000_000,
        ageDays: 3, // fails minAgeDays
        uniqueTraders24h: 900,
        txCount24h: 4000,
        volume24hUsd: 1_200_000,
        holderConcentrationTop10Pct: 15,
        lpLockedDaysRemaining: 90,
        rugCheckPassed: true,
        isBlocklisted: false,
        pools: [pool("0xCCC...newlaunch", 500_000_000, 400_000)],
      },
      {
        tokenAddress: "0xDDD...concentrated",
        symbol: "WHALE",
        totalSupply: 1_000_000_000,
        ageDays: 60,
        uniqueTraders24h: 500,
        txCount24h: 1800,
        volume24hUsd: 600_000,
        holderConcentrationTop10Pct: 55, // fails holder-concentration safety gate
        lpLockedDaysRemaining: 90,
        rugCheckPassed: true,
        isBlocklisted: false,
        pools: [pool("0xDDD...concentrated", 500_000_000, 350_000)],
      },
      {
        tokenAddress: "0xEEE...unlocked",
        symbol: "RISKY",
        totalSupply: 1_000_000_000,
        ageDays: 40,
        uniqueTraders24h: 600,
        txCount24h: 2200,
        volume24hUsd: 500_000,
        holderConcentrationTop10Pct: 25,
        lpLockedDaysRemaining: 5, // fails LP-lock safety gate
        rugCheckPassed: true,
        isBlocklisted: false,
        pools: [pool("0xEEE...unlocked", 500_000_000, 320_000)],
      },
      {
        tokenAddress: "0xFFF...blocked",
        symbol: "BANNED",
        totalSupply: 1_000_000_000,
        ageDays: 90,
        uniqueTraders24h: 1000,
        txCount24h: 5000,
        volume24hUsd: 2_000_000,
        holderConcentrationTop10Pct: 20,
        lpLockedDaysRemaining: 200,
        rugCheckPassed: true,
        isBlocklisted: true, // fails blocklist safety gate regardless of everything else
        pools: [pool("0xFFF...blocked", 500_000_000, 900_000)],
      },
    ];
  }

  async samplePools(tokenAddress: string): Promise<PoolSample[]> {
    const candidates = await this.listCandidates();
    const match = candidates.find((c) => c.tokenAddress === tokenAddress);
    return match?.pools ?? [];
  }
}
