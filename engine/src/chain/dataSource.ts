import type { PoolSample, TokenCandidate } from "../types.js";

/**
 * Everything above the chain layer (scanner, oracle) talks to a DataSource,
 * never to viem or Mongo directly. Swapping "mock" for "chain" is a config
 * change (DATA_SOURCE env var) — see chain/mockSource.ts and chain/dexReader.ts.
 */
export interface DataSource {
  /** Rolled-up market data for every currently-tracked candidate token. */
  listCandidates(): Promise<TokenCandidate[]>;
  /** Fresh pool reads for one token, across every pool it trades on. */
  samplePools(tokenAddress: string): Promise<PoolSample[]>;
}
