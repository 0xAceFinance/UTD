import type { DataSource, PoolSample, TokenCandidate } from "@mcapduel/engine";

/**
 * Live DataSource backed by DexScreener's public API, scoped to chainId
 * "robinhood". engine/README.md documents Robinhood Chain's RPC endpoint,
 * chain ID, and DEX contracts as unconfirmed -- but the chain itself is
 * already publicly indexed by DexScreener today, which is enough to build a
 * real candidate universe without our own subgraph or event-log indexer.
 *
 * Market data below (price, liquidity, volume, transaction counts, pool age)
 * is real and refetched on every scan. DexScreener has no equivalent for
 * three of Section 01's safety-gate inputs on this chain: holder
 * concentration, LP-lock status, and a rug-check verdict. Those are set to a
 * documented, always-passing placeholder below rather than a fabricated
 * number, until a security provider for this chain is chosen and wired in.
 * `isBlocklisted` is correctly `false`, not a placeholder: which tokens we
 * blocklist is our own platform decision (see risk/src/geofence.ts for the
 * same reasoning applied to jurisdictions), not something DexScreener knows.
 */

const CHAIN_ID = "robinhood";
const DEX_API = "https://api.dexscreener.com";
const BATCH_SIZE = 30;

// DexScreener has no "list every pair on chain X" endpoint, so discovery
// combines its trending/boost feeds (real signal: someone paid to promote
// these, or they're newly listed) with a handful of broad keyword searches,
// all filtered down to chainId === "robinhood".
const DISCOVERY_QUERIES = ["robinhood", "moon", "dog", "pepe", "inu", "coin", "cat", "ai"];

interface DexPair {
  chainId: string;
  pairAddress?: string;
  dexId?: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  priceChange?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DEX_API}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`DexScreener request failed: ${res.status} ${res.statusText} (${path})`);
  return res.json() as Promise<T>;
}

async function discoverAddresses(): Promise<Set<string>> {
  const addresses = new Set<string>();

  const [boosts, profiles] = await Promise.all([
    fetchJson<Array<{ chainId: string; tokenAddress: string }>>("/token-boosts/top/v1").catch(() => []),
    fetchJson<Array<{ chainId: string; tokenAddress: string }>>("/token-profiles/latest/v1").catch(() => []),
  ]);
  for (const t of [...boosts, ...profiles]) {
    if (t?.chainId === CHAIN_ID && t?.tokenAddress) addresses.add(t.tokenAddress);
  }

  const searches = await Promise.all(
    DISCOVERY_QUERIES.map((q) =>
      fetchJson<{ pairs: DexPair[] | null }>(`/latest/dex/search?q=${encodeURIComponent(q)}`).catch(() => ({ pairs: [] }))
    )
  );
  for (const result of searches) {
    for (const p of result.pairs ?? []) {
      if (p?.chainId === CHAIN_ID && p?.baseToken?.address) addresses.add(p.baseToken.address);
    }
  }

  return addresses;
}

async function fetchPairsForAddresses(addresses: string[]): Promise<DexPair[]> {
  const pairs: DexPair[] = [];
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const result = await fetchJson<{ pairs: DexPair[] | null }>(`/latest/dex/tokens/${batch.join(",")}`).catch(() => ({
      pairs: [],
    }));
    for (const p of result.pairs ?? []) {
      if (p?.chainId === CHAIN_ID) pairs.push(p);
    }
  }
  return pairs;
}

/** A token can trade on several pools; keep only the deepest one per token. */
function bestPairPerToken(pairs: DexPair[]): Map<string, DexPair> {
  const best = new Map<string, DexPair>();
  for (const p of pairs) {
    const addr = p.baseToken?.address;
    if (!addr) continue;
    const liq = p.liquidity?.usd ?? 0;
    const existing = best.get(addr);
    if (!existing || liq > (existing.liquidity?.usd ?? 0)) best.set(addr, p);
  }
  return best;
}

function toCandidate(pair: DexPair): TokenCandidate | null {
  const priceUsd = Number(pair.priceUsd);
  const liquidityUsd = pair.liquidity?.usd ?? 0;
  const marketCap = pair.marketCap ?? pair.fdv ?? 0;
  if (!priceUsd || !liquidityUsd || !marketCap) return null;

  // Back out a totalSupply that reproduces DexScreener's own reported market
  // cap through engine's marketCapUsd(priceUsd, totalSupply) formula, and a
  // synthetic reserve pair that reproduces its reported price and liquidity
  // through oracle/pricing.ts's priceSample() formula (quotePriceUsd fixed at
  // 1, same convention as the pre-existing mock sources in this repo).
  const totalSupply = marketCap / priceUsd;
  const reserveQuote = liquidityUsd / 2;
  const reserveToken = reserveQuote / priceUsd;

  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 86_400_000 : 0;

  const pool: PoolSample = {
    poolAddress: pair.baseToken.address,
    tokenAddress: pair.baseToken.address,
    dexName: "dexscreener",
    reserveToken,
    reserveQuote,
    quotePriceUsd: 1,
    timestampSec: Math.floor(Date.now() / 1000),
  };

  return {
    tokenAddress: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    totalSupply,
    ageDays,
    // Upper-bound proxy for unique wallets: a wallet can trade more than
    // once, so this over-counts. A true unique-trader count needs a
    // wallet-level indexer, which doesn't exist for this chain yet.
    uniqueTraders24h: buys + sells,
    txCount24h: buys + sells,
    volume24hUsd: pair.volume?.h24 ?? 0,
    holderConcentrationTop10Pct: 0, // placeholder -- see file header
    lpLockedDaysRemaining: 999, // placeholder -- see file header
    rugCheckPassed: true, // placeholder -- see file header
    isBlocklisted: false,
    pools: [pool],
  };
}

export class DexScreenerSource implements DataSource {
  /** symbol -> display info not carried by TokenCandidate, populated by the last listCandidates() call. */
  readonly displayInfo = new Map<string, { name: string; change24hPct: number }>();

  async listCandidates(): Promise<TokenCandidate[]> {
    const addresses = await discoverAddresses();
    const pairs = await fetchPairsForAddresses([...addresses]);
    const best = bestPairPerToken(pairs);

    const candidates: TokenCandidate[] = [];
    for (const pair of best.values()) {
      const candidate = toCandidate(pair);
      if (!candidate) continue;
      this.displayInfo.set(candidate.symbol, {
        name: pair.baseToken.name || candidate.symbol,
        change24hPct: pair.priceChange?.h24 ?? 0,
      });
      candidates.push(candidate);
    }
    return candidates;
  }

  async samplePools(tokenAddress: string): Promise<PoolSample[]> {
    const pairs = await fetchPairsForAddresses([tokenAddress]);
    const pair = bestPairPerToken(pairs).get(tokenAddress);
    return pair ? toCandidate(pair)?.pools ?? [] : [];
  }
}

/**
 * Every real pool DexScreener reports for one token, as raw PoolSamples --
 * this is the multi-pool input the full oracle pipeline
 * (engine/src/oracle/aggregator.ts, `runOraclePipeline`) needs for its
 * liquidity-weighted median: one manipulated pool has to drag the *median*
 * of every real pool, not just win a single "deepest pool" read. All
 * samples in one call share the same timestamp (the moment we fetched them)
 * since the pipeline treats same-timestamp samples as one instant's
 * cross-pool reading. Returns [] if DexScreener has no pairs for this
 * address or the request fails, so callers can leave prior state untouched
 * rather than treat a transient miss as zero liquidity everywhere.
 */
export async function getLivePoolSamples(tokenAddress: string): Promise<PoolSample[]> {
  const pairs = await fetchPairsForAddresses([tokenAddress]).catch(() => []);
  const nowSec = Math.floor(Date.now() / 1000);
  const samples: PoolSample[] = [];
  for (const pair of pairs) {
    const priceUsd = Number(pair.priceUsd);
    const liquidityUsd = pair.liquidity?.usd ?? 0;
    if (!priceUsd || !liquidityUsd) continue;
    // Same reserveQuote/reserveToken-from-price-and-liquidity derivation as
    // toCandidate() above, applied per pool instead of just the deepest one.
    const reserveQuote = liquidityUsd / 2;
    const reserveToken = reserveQuote / priceUsd;
    samples.push({
      poolAddress: pair.pairAddress ?? `${tokenAddress}-${samples.length}`,
      tokenAddress,
      dexName: pair.dexId ?? "dexscreener",
      reserveToken,
      reserveQuote,
      quotePriceUsd: 1,
      timestampSec: nowSec,
    });
  }
  return samples;
}
