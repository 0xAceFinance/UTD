import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import DuelToken from '@/lib/models/DuelToken';

const { getLivePricing } = vi.hoisted(() => ({ getLivePricing: vi.fn() }));
vi.mock('@/lib/dexScreenerSource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dexScreenerSource')>()),
  getLivePricing,
}));

const { repriceTopTen } = await import('@/lib/duelTokenScan');

const TOKEN_A_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B_ADDRESS = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function seedTopTwo() {
  await DuelToken.create([
    {
      symbol: 'AAA',
      name: 'Token A',
      rank: 1,
      tokenAddress: TOKEN_A_ADDRESS,
      totalSupply: 1_000_000,
      marketCapUsd: 100,
      liquidityUsd: 50,
      volume24hUsd: 10,
      change24hPct: 0,
      updatedAt: new Date(0),
    },
    {
      symbol: 'BBB',
      name: 'Token B',
      rank: 2,
      tokenAddress: TOKEN_B_ADDRESS,
      totalSupply: 2_000_000,
      marketCapUsd: 200,
      liquidityUsd: 60,
      volume24hUsd: 20,
      change24hPct: 0,
      updatedAt: new Date(0),
    },
  ]);
}

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  getLivePricing.mockReset();
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('lib/duelTokenScan::repriceTopTen', () => {
  it('updates marketCap/liquidity/volume/change and updatedAt for every token DexScreener still has a pair for', async () => {
    await seedTopTwo();
    getLivePricing.mockResolvedValue(
      new Map([
        [TOKEN_A_ADDRESS, { marketCapUsd: 500, liquidityUsd: 90, volume24hUsd: 40, change24hPct: 12.5 }],
        [TOKEN_B_ADDRESS, { marketCapUsd: 800, liquidityUsd: 95, volume24hUsd: 41, change24hPct: -3 }],
      ])
    );

    const result = await repriceTopTen();
    expect(result).toEqual({ repriced: 2 });

    const a = await DuelToken.findOne({ tokenAddress: TOKEN_A_ADDRESS });
    expect(a!.marketCapUsd).toBe(500);
    expect(a!.liquidityUsd).toBe(90);
    expect(a!.volume24hUsd).toBe(40);
    expect(a!.change24hPct).toBe(12.5);
    expect(a!.updatedAt.getTime()).toBeGreaterThan(0);
    // totalSupply is only ever set at full-scan time (lib/duelTokenScan.ts::runDailyScan) --
    // a cheap re-price must never touch it, since a live duel's oracle pipeline
    // relies on it staying exactly what was carried forward at creation.
    expect(a!.totalSupply).toBe(1_000_000);
  });

  it('leaves a token untouched if DexScreener has no pair for it (transient miss), instead of zeroing it out', async () => {
    await seedTopTwo();
    getLivePricing.mockResolvedValue(new Map([[TOKEN_A_ADDRESS, { marketCapUsd: 500, liquidityUsd: 90, volume24hUsd: 40, change24hPct: 12.5 }]]));

    const result = await repriceTopTen();
    expect(result).toEqual({ repriced: 1 });

    const b = await DuelToken.findOne({ tokenAddress: TOKEN_B_ADDRESS });
    expect(b!.marketCapUsd).toBe(200);
    expect(b!.updatedAt.getTime()).toBe(new Date(0).getTime());
  });

  it('is a no-op, not a throw, when the Top 10 is empty', async () => {
    await expect(repriceTopTen()).resolves.toEqual({ repriced: 0 });
  });

  it('is a no-op, not a throw, when the DexScreener fetch itself fails', async () => {
    await seedTopTwo();
    getLivePricing.mockRejectedValue(new Error('DexScreener request failed: 500 Internal Server Error'));

    await expect(repriceTopTen()).resolves.toEqual({ repriced: 0 });
    const a = await DuelToken.findOne({ tokenAddress: TOKEN_A_ADDRESS });
    expect(a!.marketCapUsd).toBe(100);
  });
});
