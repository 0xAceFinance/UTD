import { createPublicClient, http } from "viem";
import { CHAIN_CONFIG } from "../config.js";

type ChainClient = ReturnType<typeof createPublicClient>;

let client: ChainClient | undefined;

/**
 * Lazily creates a viem public client against CHAIN_RPC_URL.
 * Throws with a clear message if called while no RPC is configured — this is
 * expected until real Robinhood Chain connection details are supplied; use
 * DATA_SOURCE=mock (the default) for everything that doesn't need live chain data.
 */
export function getChainClient(): ChainClient {
  if (!CHAIN_CONFIG.rpcUrl) {
    throw new Error(
      "CHAIN_RPC_URL is not set. Set DATA_SOURCE=mock in .env for local/dev use, " +
        "or provide a real RPC endpoint to read live chain data."
    );
  }
  if (!client) {
    client = createPublicClient({ transport: http(CHAIN_CONFIG.rpcUrl) });
  }
  return client;
}
