'use client';

import { parseUnits } from 'viem';
import { readContract, writeContract, waitForTransactionReceipt } from 'wagmi/actions';
import { wagmiConfig } from '@/config/wagmiConfig';
import { CONTRACTS, BattleEscrowFactoryAbi, BattleEscrowAbi, Erc20Abi } from '@/config/contracts';

/**
 * Every wallet-signed call the duel flow needs, composed from wagmi's
 * framework-agnostic actions (wagmi/actions) rather than the hook-based
 * useWriteContract/useWaitForTransactionReceipt -- these are plain async
 * functions callable from an event handler, so a multi-step flow (approve,
 * then write, then wait) reads top-to-bottom instead of being spread across
 * hook state. Each function returns the confirmed transaction hash; callers
 * hand that hash to the matching backend route, which re-derives the real
 * outcome from the real event log rather than trusting the client
 * (see lib/chainVerify.ts).
 *
 * Every call below pins `chainId: CONTRACTS.chainId` explicitly. Without it,
 * wagmi reads/writes against whatever chain the connected wallet currently
 * has active (e.g. Ethereum mainnet by default in a fresh MetaMask), not
 * necessarily the chain these contracts are actually deployed on -- that
 * mismatch is exactly what produced a read against mainnet's eth.merkle.io
 * RPC instead of the local Anvil chain. Pinning chainId makes wagmi prompt a
 * network switch for writes and always read from the right RPC regardless of
 * the wallet's currently-selected network.
 *
 * stakeToken decimals: 18 (MockERC20 on the local Anvil deployment -- see
 * Contracts/script/DeployDuel.s.sol). A real stablecoin (e.g. USDC, 6
 * decimals) needs this adjusted at production deployment time.
 */
const STAKE_TOKEN_DECIMALS = 18;

async function ensureApproval(owner: `0x${string}`, amountWei: bigint): Promise<void> {
    const allowance = (await readContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: CONTRACTS.stakeToken,
        abi: Erc20Abi,
        functionName: 'allowance',
        args: [owner, CONTRACTS.battleEscrowFactory],
    })) as bigint;
    if (allowance >= amountWei) return;

    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: CONTRACTS.stakeToken,
        abi: Erc20Abi,
        functionName: 'approve',
        args: [CONTRACTS.battleEscrowFactory, amountWei],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: CONTRACTS.chainId, hash });
}

export async function createDuelOnChain(params: {
    creator: `0x${string}`;
    buyInUsd: number;
    creatorSide: 0 | 1;
    durationSeconds: number;
    tokenASymbol: string;
    tokenBSymbol: string;
}): Promise<`0x${string}`> {
    const amountWei = parseUnits(String(params.buyInUsd), STAKE_TOKEN_DECIMALS);
    await ensureApproval(params.creator, amountWei);

    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: CONTRACTS.battleEscrowFactory,
        abi: BattleEscrowFactoryAbi,
        functionName: 'createDuel',
        args: [CONTRACTS.stakeToken, amountWei, params.creatorSide, BigInt(params.durationSeconds), params.tokenASymbol, params.tokenBSymbol],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: CONTRACTS.chainId, hash });
    return hash;
}

export async function joinDuelOnChain(
    opponent: `0x${string}`,
    escrowAddress: `0x${string}`,
    buyInUsd: number
): Promise<`0x${string}`> {
    const amountWei = parseUnits(String(buyInUsd), STAKE_TOKEN_DECIMALS);
    await ensureApproval(opponent, amountWei);

    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: CONTRACTS.battleEscrowFactory,
        abi: BattleEscrowFactoryAbi,
        functionName: 'joinDuel',
        args: [escrowAddress],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: CONTRACTS.chainId, hash });
    return hash;
}

export async function cancelDuelOnChain(escrowAddress: `0x${string}`): Promise<`0x${string}`> {
    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: CONTRACTS.battleEscrowFactory,
        abi: BattleEscrowFactoryAbi,
        functionName: 'cancelDuel',
        args: [escrowAddress],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: CONTRACTS.chainId, hash });
    return hash;
}

/** Permissionless on the contract -- anyone can reclaim a creator's stake once the open window passes. */
export async function expireDuelOnChain(escrowAddress: `0x${string}`): Promise<`0x${string}`> {
    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: CONTRACTS.battleEscrowFactory,
        abi: BattleEscrowFactoryAbi,
        functionName: 'expireDuel',
        args: [escrowAddress],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: CONTRACTS.chainId, hash });
    return hash;
}

/** Permissionless on the contract -- anyone holding the oracle's signature can submit it. */
export async function settleDuelOnChain(
    escrowAddress: `0x${string}`,
    winnerSide: 0 | 1,
    signature: `0x${string}`
): Promise<`0x${string}`> {
    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: escrowAddress,
        abi: BattleEscrowAbi,
        functionName: 'settle',
        args: [winnerSide, signature],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: CONTRACTS.chainId, hash });
    return hash;
}
