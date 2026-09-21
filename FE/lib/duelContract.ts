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

let stakeTokenSymbol: Promise<string> | undefined;

/** e.g. "USDG" on production, "mUSD" on the local MockERC20. Cached like decimals above. */
export function getStakeTokenSymbol(): Promise<string> {
    stakeTokenSymbol ??= (
        readContract(wagmiConfig, {
            chainId: CONTRACTS.chainId,
            address: CONTRACTS.stakeToken,
            abi: Erc20Abi,
            functionName: 'symbol',
        }) as Promise<string>
    ).catch((err) => {
        stakeTokenSymbol = undefined;
        throw err;
    });
    return stakeTokenSymbol;
}

export async function getStakeTokenBalanceUsd(wallet: `0x${string}`): Promise<number> {
    const [balanceWei, decimals] = await Promise.all([
        readContract(wagmiConfig, {
            chainId: CONTRACTS.chainId,
            address: CONTRACTS.stakeToken,
            abi: Erc20Abi,
            functionName: 'balanceOf',
            args: [wallet],
        }) as Promise<bigint>,
        getStakeTokenDecimals(),
    ]);
    return Number(formatUnits(balanceWei, decimals));
}

/**
 * Thrown instead of ever asking for a wallet signature we already know will
 * fail on-chain -- lets the UI show a clear "top up / swap" message instead
 * of the wallet's own scary pre-flight gas-estimation warning (which is what
 * a bare `transferFrom` revert from the stake token looks like to the user).
 */
export class InsufficientStakeBalanceError extends Error {
    constructor(
        public readonly neededUsd: number,
        public readonly balanceUsd: number,
        public readonly symbol: string
    ) {
        super(
            `You need $${neededUsd.toFixed(2)} ${symbol} for this stake, but this wallet only has ` +
                `$${balanceUsd.toFixed(2)} ${symbol}. Add or swap into ${symbol} and try again.`
        );
        this.name = 'InsufficientStakeBalanceError';
    }
}

async function requireStakeBalance(wallet: `0x${string}`, buyInUsd: number): Promise<void> {
    const [balanceUsd, symbol] = await Promise.all([getStakeTokenBalanceUsd(wallet), getStakeTokenSymbol()]);
    if (balanceUsd < buyInUsd) throw new InsufficientStakeBalanceError(buyInUsd, balanceUsd, symbol);
}

/**
 * Live factory gates the UI must respect before asking for a signature:
 * createDuel()/joinDuel() revert while paused, and createDuel() reverts
 * "bad buyIn"/"buyIn above maximum" outside [minBuyIn, maxBuyIn]. Both *Usd
 * fields are in whole stake-token units (the stake token is a dollar
 * stablecoin). maxBuyInUsd is `null` when the factory has no cap set (the
 * default -- BattleEscrowFactory.maxBuyIn() reads 0, meaning uncapped).
 * winnerBps/maxReferrerBps are owner-tunable on the factory too
 * (BattleEscrowFactory.sol's setWinnerBps/setMaxReferrerBps) -- surfaced here
 * so UI copy showing the payout split never hardcodes a split that could
 * drift from what's actually configured on-chain.
 */
export async function getFactoryState(): Promise<{
    paused: boolean;
    minBuyInUsd: number;
    maxBuyInUsd: number | null;
    winnerBps: number;
    maxReferrerBps: number;
}> {
    const [paused, minBuyIn, maxBuyIn, winnerBps, maxReferrerBps, decimals] = await Promise.all([
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
        readContract(wagmiConfig, {
            chainId: CONTRACTS.chainId,
            address: CONTRACTS.battleEscrowFactory,
            abi: BattleEscrowFactoryAbi,
            functionName: 'maxBuyIn',
        }) as Promise<bigint>,
        readContract(wagmiConfig, {
            chainId: CONTRACTS.chainId,
            address: CONTRACTS.battleEscrowFactory,
            abi: BattleEscrowFactoryAbi,
            functionName: 'winnerBps',
        }) as Promise<bigint>,
        readContract(wagmiConfig, {
            chainId: CONTRACTS.chainId,
            address: CONTRACTS.battleEscrowFactory,
            abi: BattleEscrowFactoryAbi,
            functionName: 'maxReferrerBps',
        }) as Promise<bigint>,
        getStakeTokenDecimals(),
    ]);
    return {
        paused,
        minBuyInUsd: Number(formatUnits(minBuyIn, decimals)),
        maxBuyInUsd: maxBuyIn > 0n ? Number(formatUnits(maxBuyIn, decimals)) : null,
        winnerBps: Number(winnerBps),
        maxReferrerBps: Number(maxReferrerBps),
    };
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
    const { paused, minBuyInUsd, maxBuyInUsd } = await getFactoryState();
    if (paused) throw new Error('Duels are paused right now. Try again later.');
    if (params.buyInUsd < minBuyInUsd) throw new Error(`Minimum buy-in is $${minBuyInUsd}.`);
    if (maxBuyInUsd !== null && params.buyInUsd > maxBuyInUsd) throw new Error(`Maximum buy-in is $${maxBuyInUsd}.`);
    await requireStakeBalance(params.creator, params.buyInUsd);

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
    await requireStakeBalance(opponent, buyInUsd);

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

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

/** Permissionless on the contract -- anyone holding the oracle's signature can submit it.
 * referrerA/B must be exactly what was signed into `signature` (lib/oracleSigner.ts) --
 * a mismatch fails the on-chain signature check, it never silently pays the wrong party. */
export async function settleDuelOnChain(
    escrowAddress: `0x${string}`,
    winnerSide: 0 | 1,
    signature: `0x${string}`,
    referrerA: `0x${string}` = ZERO_ADDRESS,
    referrerABps: number = 0,
    referrerB: `0x${string}` = ZERO_ADDRESS,
    referrerBBps: number = 0
): Promise<`0x${string}`> {
    const hash = await writeContract(wagmiConfig, {
        chainId: CONTRACTS.chainId,
        address: escrowAddress,
        abi: BattleEscrowAbi,
        functionName: 'settle',
        args: [winnerSide, referrerA, BigInt(referrerABps), referrerB, BigInt(referrerBBps), signature],
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
