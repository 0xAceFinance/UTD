import { defineChain } from 'viem';
import { ROBINHOOD_CHAIN_RPC_URL } from './contracts';

/**
 * Robinhood Chain mainnet (chain id 4663) -- see Contracts/README.md
 * "Deployments". Native gas token is ETH (Contracts/.env.example's relayer
 * comment: "Needs only a small ETH balance for gas"). Block explorer is
 * Blockscout, per the same README.
 *
 * Giving this chain full metadata (not just an id, unlike the old
 * `{ ...foundry, id: CONTRACTS.chainId }` pattern elsewhere) is what lets an
 * injected wallet's `wallet_switchEthereumChain` fall back to
 * `wallet_addEthereumChain` automatically when the wallet doesn't have this
 * chain configured yet -- wagmi only has enough info to build that
 * add-chain request if the chain object here carries it.
 */
export const robinhoodChain = defineChain({
    id: 4663,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
        default: { http: [ROBINHOOD_CHAIN_RPC_URL] },
    },
    blockExplorers: {
        default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
    },
});
