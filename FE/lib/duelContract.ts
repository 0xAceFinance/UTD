'use client';

import { formatUnits, parseUnits } from 'viem';
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
 */

let stakeTokenDecimals: Promise<number> | undefined;

/** Read from the token once and cached: 18 on the local MockERC20, 6 on production USDC. */
export function getStakeTokenDecimals(): Promise<number> {
    stakeTokenDecimals ??= readContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: CONTRACTS.stakeToken,
        abi: Erc20Abi,
        functionName: 'decimals',
    })
        .then(Number)
        .catch((err) => {
            stakeTokenDecimals = undefined;
            throw err;
        });
    return stakeTokenDecimals;
}

/**
 * Live factory gates the UI must respect before asking for a signature:
 * createDuel()/joinDuel() revert while paused, and createDuel() reverts
 * "bad buyIn" below minBuyIn. minBuyInUsd is minBuyIn in whole stake-token
 * units (the stake token is a dollar stablecoin).
 */
export async function getFactoryState(): Promise<{ paused: boolean; minBuyInUsd: number }> {
    const [paused, minBuyIn, decimals] = await Promise.all([
        readContract(wagmiConfig, {
            chainId: CONTRACTS.chainId,
            address: CONTRACTS.battleEscrowFactory,
            abi: BattleEscrowFactoryAbi,
            functionName: 'paused',
        }) as Promise<boolean>,
        readContract(wagmiConfig, {
            chainId: CONTRACTS.chainId,
            address: CONTRACTS.battleEscrowFactory,
            abi: BattleEscrowFactoryAbi,
            functionName: 'minBuyIn',
        }) as Promise<bigint>,
        getStakeTokenDecimals(),
    ]);
    return { paused, minBuyInUsd: Number(formatUnits(minBuyIn, decimals)) };
}

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
    const { paused, minBuyInUsd } = await getFactoryState();
    if (paused) throw new Error('Duels are paused right now. Try again later.');
    if (params.buyInUsd < minBuyInUsd) throw new Error(`Minimum buy-in is $${minBuyInUsd}.`);

    const amountWei = parseUnits(String(params.buyInUsd), await getStakeTokenDecimals());
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
    if ((await getFactoryState()).paused) throw new Error('Duels are paused right now. Try again later.');

    const amountWei = parseUnits(String(buyInUsd), await getStakeTokenDecimals());
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

/**
 * The last-resort recovery path: refunds both stakes for a duel that's sat
 * unsettled for STALE_REFUND_GRACE_PERIOD past its end time (Contracts/src/duel/BattleEscrow.sol).
 * Permissionless and needs no signature -- either player (or anyone else) can
 * call this once it's clear the match was never going to resolve normally.
 * Called directly on the escrow, not through the factory, same as settle().
 */
export async function refundStaleDuelOnChain(escrowAddress: `0x${string}`): Promise<`0x${string}`> {
    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: escrowAddress,
        abi: BattleEscrowAbi,
        functionName: 'refundStale',
        args: [],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: CONTRACTS.chainId, hash });
    return hash;
}

/** A payout the escrow couldn't push to this wallet (PayoutDeferred) and is holding for withdraw(). */
export async function readOwed(escrowAddress: `0x${string}`, wallet: `0x${string}`): Promise<bigint> {
    return (await readContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: escrowAddress,
        abi: BattleEscrowAbi,
        functionName: 'owed',
        args: [wallet],
    })) as bigint;
}

/** Pulls owed[msg.sender] -- only ever to the caller's own wallet. */
export async function withdrawOwedOnChain(escrowAddress: `0x${string}`): Promise<`0x${string}`> {
    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: escrowAddress,
        abi: BattleEscrowAbi,
        functionName: 'withdraw',
        args: [],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: CONTRACTS.chainId, hash });
    return hash;
}
