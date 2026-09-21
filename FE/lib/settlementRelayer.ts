import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BattleEscrowAbi } from '@/config/contracts';
import {
    chain,
    publicClient,
    EscrowStatus,
    readEscrowStatus,
    readEscrowWinnerSide,
    readFactoryPaused,
} from '@/lib/chainClient';
import { verifyDuelSettled } from '@/lib/chainVerify';
import { confirmOnChainSettlement, confirmOnChainRefund } from '@/lib/duelEngine';
import Duel from '@/lib/models/Duel';
import type { IDuel } from '@/lib/models/Duel';

/**
 * Server-side keeper for signed settlements. BattleEscrow.refundStale() opens
 * permissionlessly at endTime + 24h and refunds both players -- so if the
 * signed settle() isn't on-chain by then, the loser can take back a stake
 * they already lost. This submits settle() from a platform hot wallet as soon
 * as the oracle signs (lib/duelEngine.ts::maybeSettle) and again from the
 * cron (app/api/cron/settle) until it lands, so a winner's payout never
 * depends on them clicking "Claim" in time.
 *
 * RELAYER_PRIVATE_KEY is a separate wallet holding only a little ETH for gas.
 * It needs no authority: settle() is permissionless, the oracle signature is
 * what authorizes the payout. Never reuse the oracle signer key here -- that
 * key decides who wins and must not sit in a wallet that sends transactions.
 */

export type RelayOutcome =
    | 'settled' // we submitted settle() and finalized the DB
    | 'synced' // escrow was already Settled on-chain; DB caught up
    | 'refunded' // escrow was already Refunded on-chain (refundStale won the race)
    | 'paused' // factory is paused; retry on a later cron run
    | 'busy' // another relay attempt holds the lease
    | 'skipped' // nothing to relay for this duel
    | 'unconfigured' // no RELAYER_PRIVATE_KEY
    | 'failed';

/** How long one relay attempt holds a duel before another may retry it. Longer than the receipt wait below. */
const RELAY_LEASE_MS = 2 * 60_000;
const RECEIPT_TIMEOUT_MS = 60_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

function relayerAccount() {
    const key = process.env.RELAYER_PRIVATE_KEY;
    if (!key) return null;
    const account = privateKeyToAccount(key as `0x${string}`);
    const oracleAddresses = [process.env.ORACLE_SIGNER_PRIVATE_KEY, process.env.ORACLE_SIGNER_PRIVATE_KEY_PREVIOUS]
        .filter(Boolean)
        .map((k) => privateKeyToAccount(k as `0x${string}`).address.toLowerCase());
    if (oracleAddresses.includes(account.address.toLowerCase())) {
        throw new Error('RELAYER_PRIVATE_KEY must be a separate hot wallet, never an oracle signer key');
    }
    return account;
}

/**
 * If the escrow has already left Active on-chain, bring the DB in line and
 * return what happened; null if it's still Active (settle() still needed).
 * The chain read is the ground truth -- no client input involved.
 */
async function syncFromChain(duel: IDuel): Promise<RelayOutcome | null> {
    const escrow = duel.escrowAddress as `0x${string}`;
    const status = await readEscrowStatus(escrow);
    if (status === EscrowStatus.Settled) {
        await confirmOnChainSettlement(duel, await readEscrowWinnerSide(escrow));
        return 'synced';
    }
    if (status === EscrowStatus.Refunded) {
        await confirmOnChainRefund(duel);
        return 'refunded';
    }
    return status === EscrowStatus.Active ? null : 'skipped';
}

/**
 * Submits settle(winnerSide, oracleSignature) for a SETTLING duel and
 * finalizes it exactly the way confirm-settlement does (verified Settled
 * event -> confirmOnChainSettlement). Idempotent and safe to call from
 * anywhere, any number of times: never throws, so it can run in the
 * background of a user request without affecting it.
 */
export async function submitSettlement(duel: IDuel): Promise<RelayOutcome> {
    try {
        return await relay(duel);
    } catch (err) {
        console.error(`[settlementRelayer] duel ${duel._id}: ${(err as Error)?.message ?? err}`);
        return 'failed';
    }
}

async function relay(duel: IDuel): Promise<RelayOutcome> {
    if (duel.status !== 'SETTLING' || !duel.escrowAddress || !duel.oracleSignature || duel.winnerSide === undefined) {
        return 'skipped';
    }
    const escrow = duel.escrowAddress as `0x${string}`;

    const synced = await syncFromChain(duel);
    if (synced) return synced;

    if (await readFactoryPaused()) {
        console.warn(`[settlementRelayer] duel ${duel._id}: factory is paused, will retry`);
        return 'paused';
    }

    const account = relayerAccount();
    if (!account) {
        console.warn(`[settlementRelayer] duel ${duel._id}: RELAYER_PRIVATE_KEY not configured, left for a manual claim`);
        return 'unconfigured';
    }

    const now = new Date();
    const leased = await Duel.findOneAndUpdate(
        {
            _id: duel._id,
            status: 'SETTLING',
            $or: [{ relayLockedUntil: { $exists: false } }, { relayLockedUntil: { $lt: now } }],
        },
        { $set: { relayLockedUntil: new Date(now.getTime() + RELAY_LEASE_MS) } }
    );
    if (!leased) return 'busy';

    let broadcast = false;
    let done = false;
    try {
        const { request } = await publicClient.simulateContract({
            account,
            address: escrow,
            abi: BattleEscrowAbi,
            functionName: 'settle',
            args: [
                duel.winnerSide,
                (duel.creatorReferrerWallet as `0x${string}`) ?? ZERO_ADDRESS,
                BigInt(duel.creatorReferrerBps ?? 0),
                (duel.opponentReferrerWallet as `0x${string}`) ?? ZERO_ADDRESS,
                BigInt(duel.opponentReferrerBps ?? 0),
                duel.oracleSignature as `0x${string}`,
            ],
        });
        const hash = await createWalletClient({
            account,
            chain,
            transport: http(process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545'),
        }).writeContract(request);
        broadcast = true;

        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
        done = true;
        if (receipt.status !== 'success') return (await syncFromChain(duel)) ?? 'failed';

        const { winnerSide, deferredPayouts } = await verifyDuelSettled(hash, escrow);
        await confirmOnChainSettlement(duel, winnerSide, deferredPayouts);
        return 'settled';
    } catch (err) {
        const reason = (err as Error)?.message ?? String(err);
        if (reason.includes('not active')) return (await syncFromChain(duel)) ?? 'failed';
        if (reason.includes('paused')) {
            console.warn(`[settlementRelayer] duel ${duel._id}: settle() reverted "paused", will retry`);
            return 'paused';
        }
        throw err;
    } finally {
        // A tx we broadcast but never saw a receipt for may still be pending:
        // keep the lease until it expires instead of racing it with a second tx.
        if (!broadcast || done) await Duel.updateOne({ _id: duel._id }, { $unset: { relayLockedUntil: 1 } });
    }
}
