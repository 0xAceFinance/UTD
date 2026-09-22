import { createPublicClient, http, parseEventLogs } from 'viem';
import { foundry } from 'viem/chains';
import { CONTRACTS, BattleEscrowFactoryAbi, BattleEscrowAbi } from '@/config/contracts';

/**
 * Every fund-moving action (create/join/cancel/expire/settle) is confirmed
 * against the real chain here, never trusted from the client -- the
 * frontend submits the transaction with the user's own wallet, then hands
 * us the tx hash; these functions decode the real event log from the real
 * receipt and throw if it doesn't say what the client claimed.
 */
const publicClient = createPublicClient({
    chain: { ...foundry, id: CONTRACTS.chainId },
    transport: http(CONTRACTS.rpcUrl),
});

async function getSuccessfulReceipt(txHash: `0x${string}`) {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error('Transaction did not succeed on-chain.');
    return receipt;
}

/**
 * Verifies a createDuel() tx really happened for this wallet; returns the
 * real escrow clone address plus the real on-chain terms from the
 * DuelCreated event -- callers should treat these as ground truth over
 * anything the client claims separately.
 */
export async function verifyDuelCreated(
    txHash: `0x${string}`,
    expectedCreator: string
): Promise<{
    escrowAddress: `0x${string}`;
    event: {
        buyIn: bigint;
        creatorSide: number;
        durationSeconds: bigint;
        tokenASymbol: string;
        tokenBSymbol: string;
    };
}> {
    const receipt = await getSuccessfulReceipt(txHash);
    const events = parseEventLogs({ abi: BattleEscrowFactoryAbi, logs: receipt.logs, eventName: 'DuelCreated' });
    // The address check is load-bearing: without it, a log matching this
    // event's signature but emitted by an arbitrary (attacker) contract would
    // decode and be trusted just the same. This is what actually stops a
    // forged "duel created" event from getting a phantom lobby listed at all.
    const event = events.find(
        (e: any) =>
            e.address.toLowerCase() === CONTRACTS.battleEscrowFactory.toLowerCase() &&
            e.args.creator.toLowerCase() === expectedCreator.toLowerCase()
    );
    if (!event) throw new Error('DuelCreated event not found for this wallet in that transaction.');
    const args = (event as any).args;
    return {
        escrowAddress: args.duel,
        event: {
            buyIn: args.buyIn,
            creatorSide: Number(args.creatorSide),
            durationSeconds: args.durationSeconds,
            tokenASymbol: args.tokenASymbol,
            tokenBSymbol: args.tokenBSymbol,
        },
    };
}

/** Verifies a joinDuel() tx really happened for this escrow and opponent. */
export async function verifyDuelJoined(txHash: `0x${string}`, escrowAddress: string, expectedOpponent: string): Promise<void> {
    const receipt = await getSuccessfulReceipt(txHash);
    const events = parseEventLogs({ abi: BattleEscrowFactoryAbi, logs: receipt.logs, eventName: 'DuelJoined' });
    const event = events.find(
        (e: any) =>
            e.address.toLowerCase() === CONTRACTS.battleEscrowFactory.toLowerCase() &&
            e.args.duel.toLowerCase() === escrowAddress.toLowerCase() &&
            e.args.opponent.toLowerCase() === expectedOpponent.toLowerCase()
    );
    if (!event) throw new Error('DuelJoined event not found for this duel and wallet in that transaction.');
}

/**
 * Verifies a settle() tx really happened on this specific escrow; returns the
 * real winnerSide from its Settled event, plus any PayoutDeferred events the
 * same escrow emitted in that tx (a recipient the stake token refused to pay,
 * e.g. USDC-blacklisted -- credited to owed[] for a later withdraw()).
 */
export async function verifyDuelSettled(
    txHash: `0x${string}`,
    escrowAddress: string
): Promise<{ winnerSide: 0 | 1; deferredPayouts: { to: string; amount: string }[] }> {
    const receipt = await getSuccessfulReceipt(txHash);
    const fromEscrow = (e: { address: string }) => e.address.toLowerCase() === escrowAddress.toLowerCase();
    const event = parseEventLogs({ abi: BattleEscrowAbi, logs: receipt.logs, eventName: 'Settled' }).find(fromEscrow);
    if (!event) throw new Error('Settled event not found for this duel in that transaction.');
    const deferredPayouts = parseEventLogs({ abi: BattleEscrowAbi, logs: receipt.logs, eventName: 'PayoutDeferred' })
        .filter(fromEscrow)
        .map((e: any) => ({ to: String(e.args.to).toLowerCase(), amount: String(e.args.amount) }));
    return { winnerSide: Number((event as any).args.winnerSide) as 0 | 1, deferredPayouts };
}

/** Verifies a voidActive() tx really happened on this specific escrow (the HELD-duel
 * recovery path -- see app/api/admin/duels/[id]/confirm-void/route.ts). */
export async function verifyDuelVoided(txHash: `0x${string}`, escrowAddress: string): Promise<void> {
    const receipt = await getSuccessfulReceipt(txHash);
    const events = parseEventLogs({ abi: BattleEscrowAbi, logs: receipt.logs, eventName: 'Voided' });
    const event = events.find((e) => e.address.toLowerCase() === escrowAddress.toLowerCase());
    if (!event) throw new Error('Voided event not found for this duel in that transaction.');
}

/** Verifies a refundStale() tx really happened on this specific escrow (the
 * last-resort stuck-duel recovery path -- see
 * app/api/duels/[id]/refund-stale/route.ts). */
export async function verifyDuelRefundedStale(txHash: `0x${string}`, escrowAddress: string): Promise<void> {
    const receipt = await getSuccessfulReceipt(txHash);
    const events = parseEventLogs({ abi: BattleEscrowAbi, logs: receipt.logs, eventName: 'RefundedStale' });
    const event = events.find((e) => e.address.toLowerCase() === escrowAddress.toLowerCase());
    if (!event) throw new Error('RefundedStale event not found for this duel in that transaction.');
}

/** Verifies a cancelDuel()/expireDuel() tx really happened for this escrow. */
export async function verifyDuelClosed(
    txHash: `0x${string}`,
    escrowAddress: string,
    eventName: 'DuelCancelled' | 'DuelExpired'
): Promise<void> {
    const receipt = await getSuccessfulReceipt(txHash);
    const events = parseEventLogs({ abi: BattleEscrowFactoryAbi, logs: receipt.logs, eventName });
    const event = events.find(
        (e: any) =>
            e.address.toLowerCase() === CONTRACTS.battleEscrowFactory.toLowerCase() &&
            e.args.duel.toLowerCase() === escrowAddress.toLowerCase()
    );
    if (!event) throw new Error(`${eventName} event not found for this duel in that transaction.`);
}
