import { getChainClient } from "./client.js";
import { UNISWAP_V2_PAIR_ABI, ERC20_ABI } from "./dexAbi.js";
import type { DataSource } from "./dataSource.js";
import type { PoolSample, TokenCandidate } from "../types.js";

/**
 * Live DataSource backed by on-chain reads via viem.
 *
 * This is intentionally thin: it knows how to read a Uniswap-V2-style pool's
 * reserves and a token's decimals/supply. It does NOT know anything about
 * volume, tx counts, holder concentration, LP-lock status, or rug-check
 * results — those aren't derivable from reserves alone and need a real
 * indexer (subgraph, or a dedicated event-log scanner) once Robinhood
 * Chain's actual DEX contracts are known. Wiring that up is flagged as a
 * follow-up rather than guessed at here.
 */
export class ChainDexReader implements DataSource {
  constructor(private readonly quoteTokenPriceUsd: (quoteToken: string) => Promise<number>) {}

  async listCandidates(): Promise<TokenCandidate[]> {
    throw new Error(
      "ChainDexReader.listCandidates() needs a real indexer (volume, tx count, holder " +
        "concentration, LP-lock, rug-check) wired in before it can run — not yet available " +
        "for Robinhood Chain. Use the mock data source for scanner/oracle logic in the meantime."
    );
  }

  async samplePools(tokenAddress: string): Promise<PoolSample[]> {
    void tokenAddress;
    throw new Error(
      "ChainDexReader.samplePools() needs known pool addresses for this token, which " +
        "requires either a factory event scan or a subgraph — not yet wired up."
    );
  }

  /** The one piece that's fully real today: read a single pool's live reserves. */
  async readPool(poolAddress: `0x${string}`, tokenAddress: string, dexName: string): Promise<PoolSample> {
    const client = getChainClient();
    const [reserves, token0, token1] = await Promise.all([
      client.readContract({ address: poolAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: "getReserves" }),
      client.readContract({ address: poolAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: "token0" }),
      client.readContract({ address: poolAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: "token1" }),
    ]);

    const isToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    const quoteToken = isToken0 ? token1 : token0;
    const [tokenDecimals, quoteDecimals] = await Promise.all([
      client.readContract({ address: tokenAddress as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }),
      client.readContract({ address: quoteToken as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }),
    ]);

    const [reserve0, reserve1] = reserves;
    const rawToken = isToken0 ? reserve0 : reserve1;
    const rawQuote = isToken0 ? reserve1 : reserve0;
    const quotePriceUsd = await this.quoteTokenPriceUsd(quoteToken);

    return {
      poolAddress,
      tokenAddress,
      dexName,
      reserveToken: Number(rawToken) / 10 ** tokenDecimals,
      reserveQuote: Number(rawQuote) / 10 ** quoteDecimals,
      quotePriceUsd,
      timestampSec: Math.floor(Date.now() / 1000),
    };
  }
}
