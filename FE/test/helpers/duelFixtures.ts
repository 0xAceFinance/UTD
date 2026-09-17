import Duel, { type IDuel, type StoredPoolSample, type TokenSide } from '@/lib/models/Duel';
import DuelToken from '@/lib/models/DuelToken';

let addrCounter = 0;
export function nextAddress(prefix = '0xaa'): `0x${string}` {
  addrCounter += 1;
  return (prefix + addrCounter.toString().padStart(38 - prefix.length + 2, '0')) as `0x${string}`;
}

export function makePoolSample(overrides: Partial<StoredPoolSample> = {}): StoredPoolSample {
  return {
    poolAddress: overrides.poolAddress ?? '0xpool0000000000000000000000000000000001',
    tokenAddress: overrides.tokenAddress ?? '0xtoken000000000000000000000000000000001',
    dexName: overrides.dexName ?? 'dexscreener',
    reserveToken: overrides.reserveToken ?? 1_000_000,
    reserveQuote: overrides.reserveQuote ?? 500_000,
    quotePriceUsd: overrides.quotePriceUsd ?? 1,
    timestampSec: overrides.timestampSec ?? Math.floor(Date.now() / 1000),
  };
}

/** A single pool sample carrying a specific price/liquidity, using the same
 * price = reserveQuote/reserveToken, liquidityUsd = 2*reserveQuote*quotePriceUsd
 * derivation as lib/dexScreenerSource.ts (quotePriceUsd pinned at 1) -- so
 * feeding this through the real engine pricing/median/TWAP/sustained-peak
 * code produces exactly the price/liquidity requested. */
export function makeSampleAtPrice(params: {
  tokenAddress: string;
  priceUsd: number;
  liquidityUsd: number;
  timestampSec: number;
  poolAddress?: string;
}): StoredPoolSample {
  const reserveQuote = params.liquidityUsd / 2;
  const reserveToken = reserveQuote / params.priceUsd;
  return {
    poolAddress: params.poolAddress ?? `${params.tokenAddress}-pool`,
    tokenAddress: params.tokenAddress,
    dexName: 'test-dex',
    reserveToken,
    reserveQuote,
    quotePriceUsd: 1,
    timestampSec: params.timestampSec,
  };
}

/** A run of same-price samples at `stepSec` intervals from `fromSec` to `toSec` inclusive. */
export function makeSampleSeries(params: {
  tokenAddress: string;
  priceUsd: number;
  liquidityUsd: number;
  fromSec: number;
  toSec: number;
  stepSec: number;
}): StoredPoolSample[] {
  const samples: StoredPoolSample[] = [];
  for (let t = params.fromSec; t <= params.toSec; t += params.stepSec) {
    samples.push(
      makeSampleAtPrice({
        tokenAddress: params.tokenAddress,
        priceUsd: params.priceUsd,
        liquidityUsd: params.liquidityUsd,
        timestampSec: t,
      })
    );
  }
  return samples;
}

export function makeTokenSide(overrides: Partial<TokenSide> = {}): TokenSide {
  const startMarketCapUsd = overrides.startMarketCapUsd ?? 1_000_000;
  return {
    symbol: overrides.symbol ?? 'FOO',
    name: overrides.name ?? 'Foo Token',
    tokenAddress: overrides.tokenAddress ?? nextAddress(),
    totalSupply: overrides.totalSupply ?? 1_000_000,
    startLiquidityUsd: overrides.startLiquidityUsd ?? 100_000,
    rawSamples: overrides.rawSamples ?? [],
    startMarketCapUsd,
    currentMarketCapUsd: overrides.currentMarketCapUsd ?? startMarketCapUsd,
    sustainedPeakMarketCapUsd: overrides.sustainedPeakMarketCapUsd ?? startMarketCapUsd,
    oracleVerified: overrides.oracleVerified ?? false,
  };
}

/** Persists a DuelToken doc (today's Top 10 entry) usable by POST /api/duels. */
export async function createDuelToken(overrides: Partial<{ symbol: string; tokenAddress: string; marketCapUsd: number; liquidityUsd: number }> = {}) {
  return DuelToken.create({
    symbol: overrides.symbol ?? 'FOO',
    name: overrides.symbol ?? 'Foo Token',
    rank: 1,
    tokenAddress: overrides.tokenAddress ?? nextAddress(),
    totalSupply: 1_000_000,
    marketCapUsd: overrides.marketCapUsd ?? 1_000_000,
    liquidityUsd: overrides.liquidityUsd ?? 100_000,
    volume24hUsd: 500_000,
    change24hPct: 1,
  });
}

export interface DuelOverrides {
  status?: IDuel['status'];
  creatorWallet?: string;
  opponentWallet?: string;
  creatorSide?: 0 | 1;
  tokenA?: Partial<TokenSide>;
  tokenB?: Partial<TokenSide>;
  buyInUsd?: number;
  durationSeconds?: number;
  openDeadline?: Date;
  startTime?: Date;
  endTime?: Date;
  escrowAddress?: string;
  cancelledAt?: Date;
  flaggedSybil?: boolean;
}

/** Persists a Duel document in whatever status/shape a test needs, skipping the HTTP layer. */
export async function createDuel(overrides: DuelOverrides = {}) {
  const now = Date.now();
  const doc = await Duel.create({
    status: overrides.status ?? 'OPEN',
    creatorWallet: (overrides.creatorWallet ?? '0xcreator0000000000000000000000000000001').toLowerCase(),
    opponentWallet: overrides.opponentWallet?.toLowerCase(),
    creatorSide: overrides.creatorSide ?? 0,
    tokenA: makeTokenSide(overrides.tokenA),
    tokenB: makeTokenSide(overrides.tokenB),
    buyInUsd: overrides.buyInUsd ?? 100,
    durationSeconds: overrides.durationSeconds ?? 900,
    openDeadline: overrides.openDeadline ?? new Date(now + 60 * 60 * 1000),
    startTime: overrides.startTime,
    endTime: overrides.endTime,
    escrowAddress: overrides.escrowAddress,
    cancelledAt: overrides.cancelledAt,
    flaggedSybil: overrides.flaggedSybil,
  });
  return doc;
}
