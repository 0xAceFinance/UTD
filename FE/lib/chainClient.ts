import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';
import { CONTRACTS, BattleEscrowFactoryAbi, BattleEscrowAbi, Erc20Abi } from '@/config/contracts';

/**
 * Server-side reads of live contract state (the settlement relayer, the
 * oracle signer's key selection, stake-token decimals). Kept apart from
 * lib/chainVerify.ts, which only decodes events from receipts the client
 * hands us -- these read the chain directly, so they are ground truth with
 * no client input involved.
 */
export const chain = { ...foundry, id: CONTRACTS.chainId };

export const publicClient = createPublicClient({
    chain,
    transport: http(process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545'),
});

/** BattleEscrow.Status, in declaration order (Contracts/src/duel/BattleEscrow.sol). */
export const EscrowStatus = { Open: 0, Active: 1, Settled: 2, Refunded: 3 } as const;

export async function readEscrowStatus(escrow: `0x${string}`): Promise<number> {
    return Number(await publicClient.readContract({ address: escrow, abi: BattleEscrowAbi, functionName: 'status' }));
}

export async function readEscrowWinnerSide(escrow: `0x${string}`): Promise<0 | 1> {
    return Number(await publicClient.readContract({ address: escrow, abi: BattleEscrowAbi, functionName: 'winnerSide' })) as 0 | 1;
}

/** The oracle signer this escrow snapshotted at activate() -- what settle()/voidActive() actually verify against. */
export async function readSettlementSigner(escrow: `0x${string}`): Promise<`0x${string}`> {
    return (await publicClient.readContract({
        address: escrow,
        abi: BattleEscrowAbi,
        functionName: 'settlementSigner',
    })) as `0x${string}`;
}

/** When the lobby stops accepting an opponent -- set by the escrow at creation from block time. */
export async function readEscrowOpenDeadline(escrow: `0x${string}`): Promise<Date> {
    const sec = await publicClient.readContract({ address: escrow, abi: BattleEscrowAbi, functionName: 'openDeadline' });
    return new Date(Number(sec) * 1000);
}

export async function readFactoryPaused(): Promise<boolean> {
    return (await publicClient.readContract({
        address: CONTRACTS.battleEscrowFactory,
        abi: BattleEscrowFactoryAbi,
        functionName: 'paused',
    })) as boolean;
}

let stakeTokenDecimals: Promise<number> | undefined;

/** Read once per process: the stake token never changes decimals (18 on the local MockERC20, 6 on USDC). */
export function readStakeTokenDecimals(): Promise<number> {
    stakeTokenDecimals ??= publicClient
        .readContract({ address: CONTRACTS.stakeToken, abi: Erc20Abi, functionName: 'decimals' })
        .then(Number)
        .catch((err) => {
            stakeTokenDecimals = undefined; // don't cache a failed read
            throw err;
        });
    return stakeTokenDecimals;
}
