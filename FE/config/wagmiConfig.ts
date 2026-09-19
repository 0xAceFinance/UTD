import { base, baseSepolia, foundry, mainnet, sepolia } from 'viem/chains';
import { createConfig, http } from 'wagmi';
import { getDefaultConfig } from 'connectkit';
import { robinhoodChain } from './chains';

/**
 * Plain wagmi + ConnectKit -- no Privy. ConnectKit's getDefaultConfig wires
 * up injected wallets (MetaMask, Rabby, Brave, etc.), Coinbase Wallet, and
 * WalletConnect (any mobile wallet via QR code) in one call, and the
 * ConnectKitButton/ConnectKitProvider in hooks/providers.tsx and
 * app/components/Header.tsx drive the actual connect modal.
 *
 * WalletConnect requires a free project ID from https://cloud.reown.com
 * (formerly WalletConnect Cloud) -- set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 * in .env.local. Without it, injected/Coinbase Wallet connections still
 * work; only the WalletConnect (QR code / mobile wallet) option won't.
 *
 * robinhoodChain is listed first -- that's what makes it the default/target
 * network ConnectKit connects to and offers to switch a wallet onto. mainnet
 * stays in the list purely for ENS name resolution in the wallet button
 * (WalletButton in Header.tsx), not because duels run there.
 */
export const wagmiConfig = createConfig(
    getDefaultConfig({
        // Foundry (local Anvil, chainId 31337) is where the duel contracts
        // live for local dev -- see Contracts/script/DeployDuel.s.sol and
        // config/contracts.ts. Drop it from this list once local dev no
        // longer needs it.
        chains: [robinhoodChain, foundry, mainnet, sepolia, base, baseSepolia],
        transports: {
            // NEXT_PUBLIC_RPC_URL is Robinhood Chain's RPC (see .env.example) --
            // foundry always points at local Anvil regardless of it, since both
            // chains are in this list at once and shouldn't share one URL.
            [robinhoodChain.id]: http(process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'),
            [foundry.id]: http('http://127.0.0.1:8545'),
            [mainnet.id]: http(),
            [sepolia.id]: http(),
            [base.id]: http(),
            [baseSepolia.id]: http(),
        },
        walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '',
        appName: 'Underground Token Duel',
        appDescription: 'Pick a side. Lock a stake. Whoever pumps harder wins the duel.',
    })
);
