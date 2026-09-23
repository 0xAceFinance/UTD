import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import type { TokenCandidate } from '@mcapduel/engine';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import DuelToken from '@/lib/models/DuelToken';

const GOOD = '0x5f62C57e5C537887117EeF828b7E3Ad41C009FEb';

/** A candidate comfortably clearing every Section 01 gate, at $1/token. */
function candidate(tokenAddress: string, symbol: string, marketCapUsd = 1_000_000): TokenCandidate {
  const liquidityUsd = 200_000;
  return {
    tokenAddress,
    symbol,
    totalSupply: marketCapUsd,
    ageDays: 30,
    uniqueTraders24h: 1_000,
    txCount24h: 1_000,
    volume24hUsd: 500_000,
    holderConcentrationTop10Pct: 0,
    lpLockedDaysRemaining: 999,
    rugCheckPassed: true,
    isBlocklisted: false,
    pools: [
      {
        poolAddress: tokenAddress,
        tokenAddress,
        dexName: 'dexscreener',
        reserveToken: liquidityUsd / 2,
        reserveQuote: liquidityUsd / 2,
        quotePriceUsd: 1,
        timestampSec: 0,
      },
    ],
  };
}

const { universe } = vi.hoisted(() => ({ universe: { tokens: [] as TokenCandidate[] } }));

vi.mock('@/lib/dexScreenerSource', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dexScreenerSource')>();
  class FakeSource {
    readonly displayInfo = new Map<string, { name: string; change24hPct: number; imageUrl?: string }>();
    private remember(list: TokenCandidate[]) {
      for (const c of list) this.displayInfo.set(c.symbol, { name: `${c.symbol} name`, change24hPct: 1, imageUrl: `https://img/${c.symbol}.png` });
      return list;
    }
    async listCandidates() {
      return this.remember(universe.tokens);
    }
    async fetchTokens(addresses: string[]) {
      const wanted = new Set(addresses.map((a) => a.toLowerCase()));
      return this.remember(universe.tokens.filter((c) => wanted.has(c.tokenAddress.toLowerCase())));
    }
  }
  return { ...actual, DexScreenerSource: FakeSource };
});

const { runDailyScan } = await import('@/lib/duelTokenScan');
const { upsertPinnedTokens, isPinnedConflict } = await import('@/lib/pinnedTokens');

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  universe.tokens = [];
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('lib/pinnedTokens', () => {
  it('flags the pinned address (any case) and symbol lookalikes as conflicts', () => {
    expect(isPinnedConflict({ tokenAddress: GOOD.toLowerCase(), symbol: 'X' })).toBe(true);
    expect(isPinnedConflict({ tokenAddress: '0x2768076F421C74729Bad394aE58d4Af76F748E4F', symbol: 'GOOD' })).toBe(true);
    expect(isPinnedConflict({ tokenAddress: '0x2768076F421C74729Bad394aE58d4Af76F748E4F', symbol: 'WOOD' })).toBe(false);
  });

  it('upserts GOOD as pinned, rank 0, with live numbers and logo', async () => {
    universe.tokens = [candidate(GOOD, 'GOOD', 2_000_000)];
    await upsertPinnedTokens();
    const doc = await DuelToken.findOne({ tokenAddress: GOOD });
    expect(doc).toMatchObject({ symbol: 'GOOD', pinned: true, rank: 0, imageUrl: 'https://img/GOOD.png' });
    expect(doc!.marketCapUsd).toBeCloseTo(2_000_000);
    expect(doc!.liquidityUsd).toBeCloseTo(200_000);
  });

  it('leaves the existing doc untouched when DexScreener has no pair', async () => {
    universe.tokens = [candidate(GOOD, 'GOOD')];
    await upsertPinnedTokens();
    universe.tokens = [];
    await upsertPinnedTokens();
    expect(await DuelToken.countDocuments({ pinned: true })).toBe(1);
  });
});

describe('lib/duelTokenScan::runDailyScan with pinned tokens', () => {
  it('keeps GOOD pinned, drops lookalikes from the Top 10, and stores logos', async () => {
    const others = Array.from({ length: 12 }, (_, i) =>
      candidate(`0x${(i + 1).toString(16).padStart(40, '0')}`, `T${i + 1}`, 1_000_000 + i)
    );
    const lookalike = candidate('0x2768076F421C74729Bad394aE58d4Af76F748E4F', 'GOOD', 9_000_000);
    universe.tokens = [candidate(GOOD, 'GOOD'), lookalike, ...others];

    await runDailyScan();
    await runDailyScan(); // a second scan must not wipe the pinned doc

    const pinned = await DuelToken.find({ pinned: true });
    expect(pinned).toHaveLength(1);
    expect(pinned[0].tokenAddress).toBe(GOOD);

    const scanned = await DuelToken.find({ pinned: { $ne: true } });
    expect(scanned).toHaveLength(10);
    expect(scanned.some((t) => t.symbol === 'GOOD')).toBe(false);
    expect(scanned.every((t) => t.imageUrl === `https://img/${t.symbol}.png`)).toBe(true);
  });
});
