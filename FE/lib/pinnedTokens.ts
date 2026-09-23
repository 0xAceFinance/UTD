import { DexScreenerSource } from "./dexScreenerSource";
import { connectToDatabase } from "./mongoose";
import DuelToken from "./models/DuelToken";

export interface PinnedToken {
  /** The ERC-20 token address -- what pricing, the oracle and duels key off. */
  tokenAddress: string;
  /** Reference pool on DexScreener (informational; pricing picks the deepest pool). */
  pairAddress: string;
  symbol: string;
}

/**
 * Tokens the platform always lists first, above the daily scan's Top 10.
 * Checked into source rather than env, same reasoning as config/contracts.ts:
 * every deploy target gets the identical list from the same commit.
 *
 * A pinned token is deliberately exempt from the Section 01 gates -- listing
 * it is a platform decision -- and the daily scan never deletes or replaces
 * it (lib/duelTokenScan.ts::runDailyScan).
 */
export const PINNED_TOKENS: PinnedToken[] = [
  {
    // "Good In The Hood". pairAddress is its GOOD/WETH Uniswap v3 pool.
    tokenAddress: "0x5f62C57e5C537887117EeF828b7E3Ad41C009FEb",
    pairAddress: "0x8EA7c66395fD7e25E9713Edd0B297d4ABE05C304",
    symbol: "GOOD",
  },
];

const pinnedAddresses = new Set(PINNED_TOKENS.map((t) => t.tokenAddress.toLowerCase()));
const pinnedSymbols = new Set(PINNED_TOKENS.map((t) => t.symbol));

/** True if a scanned token must be dropped because it is (or shares a symbol
 * with) a pinned one. The symbol check matters as much as the address:
 * DuelToken.symbol is unique, and duels resolve tokens by symbol
 * (lib/resolveDuelToken.ts), so a lookalike "GOOD" would be ambiguous. */
export function isPinnedConflict(token: { tokenAddress: string; symbol: string }): boolean {
  return pinnedAddresses.has(token.tokenAddress.toLowerCase()) || pinnedSymbols.has(token.symbol);
}

/**
 * Upserts every pinned token's DuelToken doc from live DexScreener data. A
 * token DexScreener has no pair for right now is left as-is (or stays absent
 * until the next attempt) rather than written with zeroed numbers.
 */
export async function upsertPinnedTokens(source = new DexScreenerSource()): Promise<{ upserted: number }> {
  await connectToDatabase();

  const candidates = await source.fetchTokens(PINNED_TOKENS.map((t) => t.tokenAddress));

  let upserted = 0;
  for (const pinned of PINNED_TOKENS) {
    const candidate = candidates.find((c) => c.tokenAddress.toLowerCase() === pinned.tokenAddress.toLowerCase());
    if (!candidate) continue;
    const display = source.displayInfo.get(candidate.symbol);
    // toCandidate() encodes DexScreener's price and liquidity into a synthetic
    // reserve pair; invert that here (exact, see dexScreenerSource.ts).
    const pool = candidate.pools[0];
    const priceUsd = pool ? pool.reserveQuote / pool.reserveToken : 0;

    // A scanned lookalike from before this token was pinned would block the
    // upsert on DuelToken's unique symbol index.
    await DuelToken.deleteMany({ pinned: { $ne: true }, symbol: pinned.symbol, tokenAddress: { $ne: candidate.tokenAddress } });
    await DuelToken.updateOne(
      { tokenAddress: candidate.tokenAddress },
      {
        $set: {
          symbol: pinned.symbol,
          name: display?.name ?? pinned.symbol,
          rank: 0,
          pinned: true,
          tokenAddress: candidate.tokenAddress,
          totalSupply: candidate.totalSupply,
          marketCapUsd: candidate.totalSupply * priceUsd,
          liquidityUsd: pool ? pool.reserveQuote * 2 : 0,
          volume24hUsd: candidate.volume24hUsd,
          change24hPct: display?.change24hPct ?? 0,
          imageUrl: display?.imageUrl,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    upserted += 1;
  }

  return { upserted };
}
