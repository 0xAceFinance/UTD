import { createWalletClient, encodeFunctionData, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomUUID } from 'node:crypto';
import { expire } from '@mcapduel/matchmaking';
import { BattleEscrowAbi, CONTRACTS } from '@/config/contracts';
import {
    chain,
    publicClient,
    EscrowStatus,
    readEscrowStatus,
    readEscrowWinnerSide,
    readFactoryPaused,
} from '@/lib/chainClient';
import { verifyDuelSettled } from '@/lib/chainVerify';
import { confirmOnChainSettlement, confirmOnChainRefund, maybeSettle, retrySettlementSigning } from '@/lib/duelEngine';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import Duel from '@/lib/models/Duel';
import KeeperLock from '@/lib/models/KeeperLock';
import { maybeTopUpRelayer, type TopUpResult } from '@/lib/relayerTopUp';
import type { IDuel } from '@/lib/models/Duel';

/**
 * The server-side keeper: every payout and refund happens automatically, so
 * no player ever has to click "Claim" or "Reclaim". One tick:
 *
 *  1. signs every LIVE duel whose timer has run out (maybeSettle) and repairs
 *     any stranded at SETTLING without a signature -- bounded-parallel, since
 *     the final DexScreener price read is the slow part;
 *  2. collects every escrow call that is now due:
 *       settle()      signed SETTLING duels -> pays the winner, referrers, treasury
 *       expire()      OPEN lobbies past their open window -> refunds the creator
 *       refundStale() duels still unsigned 24h after endTime -> refunds both
 *     All three are permissionless on BattleEscrow (msg.sender is never read),
 *     so the relayer needs no authority -- the oracle signature is what
 *     authorizes a settle();
 *  3. dry-runs each call (eth_call, free) and drops any that would revert, so
 *     a bad call can never burn gas on every tick;
 *  4. sends the rest batched through Multicall3 (aggregate3, allowFailure per
 *     call, CHUNK calls per tx) -- one nonce for many duels, so 100 duels
 *     ending at once cost a handful of transactions, not 100 sequential ones;
 *  5. re-reads each escrow's status (the chain is the ground truth) and
 *     brings the DB in line;
 *  6. tops the relayer's own ETH balance back up if it's running low, funded
 *     by a small swap of the platform's own treasury revenue (lib/relayerTopUp.ts)
 *     -- players never pay a fee for this.
 *
 * Woken at the exact moment work falls due by a Cloud Task (lib/keeperSchedule.ts
 * -> app/api/keeper/tick), right after signing when someone is watching the duel
 * (duelEngine.scheduleRelay), and every minute by the cron as a backstop.
 *
 * RELAYER_PRIVATE_KEY is a separate hot wallet holding only ETH for gas,
 * paid for out of the platform's cut of each pot (players pay no fee for
 * this) and topped up by hand -- lib/relayerHealth.ts alerts when low. Never
 * reuse the oracle signer key here -- that key decides who wins and must not
 * sit in a wallet that sends transactions.
 */

export type RelayOutcome =
    | 'settled' // we sent settle() and finalized the DB
    | 'expired' // we sent expire() and marked the lobby EXPIRED
    | 'refunded' // escrow ended up Refunded (our refundStale(), or someone else's)
    | 'synced' // escrow had already moved on-chain; DB caught up, nothing sent
    | 'paused' // factory is paused (settle() only); retried on a later tick
    | 'rejected' // the dry-run reverted; left for a later tick
    | 'failed';

export type JobKind = 'settle' | 'expire' | 'refundStale';

export interface KeeperTickResult {
    signed: number;
    repaired: number;
    /** Set when another tick holds the send lock -- nothing was sent this time. */
    busy?: boolean;
    /** Set when RELAYER_PRIVATE_KEY is missing -- duels are left for a manual claim. */
    unconfigured?: boolean;
    transactions: number;
    outcomes: Partial<Record<`${JobKind}:${RelayOutcome}`, number>>;
    /** What the automatic relayer gas top-up (lib/relayerTopUp.ts) did this tick, if anything. */
    topUp?: TopUpResult;
}

interface Job {
    kind: JobKind;
    duel: IDuel;
    escrow: `0x${string}`;
}

/** Calls per Multicall3 transaction -- a settle() is ~100-150k gas, so 30 stays well inside a block. */
const CHUNK = 30;
/** Work picked up per tick; the rest goes on the next tick (Cloud Tasks retries and the cron keep it moving). */
const MAX_JOBS_PER_TICK = 150;
const SIGN_CONCURRENCY = 10;
const READ_CONCURRENCY = 10;
const SEND_LOCK_MS = 2 * 60_000;
const RECEIPT_TIMEOUT_MS = 60_000;
/** A tx we broadcast but never saw a receipt for may still land: leave its duels alone this long. */
const PENDING_TX_LEASE_MS = 2 * 60_000;
const STALE_REFUND_AFTER_MS = 24 * 60 * 60 * 1000;
/** expire() needs block.timestamp > openDeadline; don't race a block that's a second behind our clock. */
const EXPIRE_MARGIN_MS = 3_000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

const multicall3Abi = parseAbi([
    'struct Call3 { address target; bool allowFailure; bytes callData; }',
    'struct Result { bool success; bytes returnData; }',
    'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
]);

export function relayerAccount() {
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

/** Runs `fn` over `items`, at most `limit` at a time. */
async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}

function callFor(job: Job): { functionName: 'settle' | 'expire' | 'refundStale'; args: readonly unknown[] } {
    if (job.kind === 'settle') {
        const d = job.duel;
        return {
            functionName: 'settle',
            args: [
                d.winnerSide,
                (d.creatorReferrerWallet as `0x${string}`) ?? ZERO_ADDRESS,
                BigInt(d.creatorReferrerBps ?? 0),
                (d.opponentReferrerWallet as `0x${string}`) ?? ZERO_ADDRESS,
                BigInt(d.opponentReferrerBps ?? 0),
                d.oracleSignature as `0x${string}`,
            ],
        };
    }
    return { functionName: job.kind, args: [] };
}

/** Marks an unmatched lobby EXPIRED in the DB once its escrow is Refunded on-chain. */
async function confirmExpired(duel: IDuel): Promise<boolean> {
    if (duel.status !== 'OPEN') return false;
    try {
        applyLobby(duel, expire(toLobbySnapshot(duel), Math.floor(Date.now() / 1000)));
    } catch {
        return false;
    }
    const claimed = await Duel.findOneAndUpdate({ _id: duel._id, status: 'OPEN' }, { $set: { status: duel.status } });
    return Boolean(claimed);
}

/**
 * Brings the DB in line with the escrow's real on-chain status. Returns the
 * outcome if the escrow has already moved past what `job` would do, or null if
 * the call is still needed.
 */
async function syncFromChain(job: Job, status: number, txHash?: `0x${string}`): Promise<RelayOutcome | null> {
    const { duel, escrow } = job;
    if (status === EscrowStatus.Settled) {
        let winnerSide: 0 | 1;
        let deferredPayouts: { to: string; amount: string }[] = [];
        try {
            if (!txHash) throw new Error('no tx');
            ({ winnerSide, deferredPayouts } = await verifyDuelSettled(txHash, escrow));
        } catch {
            winnerSide = await readEscrowWinnerSide(escrow); // settled by someone else's tx
        }
        await confirmOnChainSettlement(duel, winnerSide, deferredPayouts);
        return txHash && job.kind === 'settle' ? 'settled' : 'synced';
    }
    if (status === EscrowStatus.Refunded) {
        if (duel.status === 'OPEN') {
            await confirmExpired(duel);
            return txHash && job.kind === 'expire' ? 'expired' : 'synced';
        }
        await confirmOnChainRefund(duel);
        return 'refunded';
    }
    const stillNeeded = job.kind === 'expire' ? status === EscrowStatus.Open : status === EscrowStatus.Active;
    if (stillNeeded) return null;
    // e.g. an OPEN-in-DB lobby that is Active on-chain (the join registration
    // never reached us): nothing for the keeper to do -- surface it.
    console.warn(`[keeper] duel ${duel._id}: DB ${duel.status} but escrow status ${status}; skipped`);
    return 'failed';
}

/**
 * Chain reads run in parallel; the DB writes that follow (syncFromChain) run
 * one at a time on purpose: finalizing a settlement updates both players'
 * CombatRecord and referral totals, and two duels sharing a player finalized
 * concurrently collide on those documents (duplicate-key upserts, version
 * conflicts) -- after the duel is already marked SETTLED, so the points
 * would be lost.
 */
async function readStatuses(jobs: Job[]): Promise<(number | Error)[]> {
    return mapBounded(jobs, READ_CONCURRENCY, (job) =>
        readEscrowStatus(job.escrow).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
    );
}

async function findDueJobs(now: Date): Promise<Job[]> {
    const notLeased = { $or: [{ relayLockedUntil: { $exists: false } }, { relayLockedUntil: { $lt: now } }] };
    const hasEscrow = { escrowAddress: { $exists: true } };
    const [settling, expiring, stale] = await Promise.all([
        Duel.find({ status: 'SETTLING', ...hasEscrow, oracleSignature: { $exists: true }, winnerSide: { $exists: true }, ...notLeased })
            .sort({ endTime: 1 })
            .limit(MAX_JOBS_PER_TICK),
        Duel.find({ status: 'OPEN', ...hasEscrow, openDeadline: { $lt: new Date(now.getTime() - EXPIRE_MARGIN_MS) }, ...notLeased })
            .sort({ openDeadline: 1 })
            .limit(MAX_JOBS_PER_TICK),
        // Never signed 24h after the end (the oracle couldn't sign it): the
        // contract's own backstop. HELD duels are excluded -- those wait for
        // an admin (app/api/admin/duels/[id]/resolve), and cron alerts at 12h.
        Duel.find({
            status: { $in: ['LIVE', 'SETTLING'] },
            ...hasEscrow,
            oracleSignature: { $exists: false },
            endTime: { $lt: new Date(now.getTime() - STALE_REFUND_AFTER_MS) },
            ...notLeased,
        })
            .sort({ endTime: 1 })
            .limit(MAX_JOBS_PER_TICK),
    ]);
    const jobs: Job[] = [
        ...settling.map((duel) => ({ kind: 'settle' as const, duel, escrow: duel.escrowAddress as `0x${string}` })),
        ...expiring.map((duel) => ({ kind: 'expire' as const, duel, escrow: duel.escrowAddress as `0x${string}` })),
        ...stale.map((duel) => ({ kind: 'refundStale' as const, duel, escrow: duel.escrowAddress as `0x${string}` })),
    ];
    return jobs.slice(0, MAX_JOBS_PER_TICK);
}

async function acquireSendLock(holder: string): Promise<boolean> {
    const now = new Date();
    try {
        const doc = await KeeperLock.findOneAndUpdate(
            { _id: 'relayer', lockedUntil: { $lt: now } },
            { $set: { lockedUntil: new Date(now.getTime() + SEND_LOCK_MS), holder } },
            { upsert: true, new: true }
        );
        return doc?.holder === holder;
    } catch (err) {
        // The upsert hits the existing (still-locked) row's _id: someone else holds it.
        if ((err as { code?: number }).code === 11000) return false;
        throw err;
    }
}

/** Extends our lease before each send, so a long run of batches never outlives it. False if we lost it. */
async function renewSendLock(holder: string): Promise<boolean> {
    const res = await KeeperLock.updateOne(
        { _id: 'relayer', holder },
        { $set: { lockedUntil: new Date(Date.now() + SEND_LOCK_MS) } }
    );
    return res.matchedCount === 1;
}

async function releaseSendLock(holder: string): Promise<void> {
    await KeeperLock.updateOne({ _id: 'relayer', holder }, { $set: { lockedUntil: new Date(0) } });
}

/** Everything a tick does. Never throws: failures are logged and show up in the result. */
export async function runKeeperTick(opts: { now?: Date; multicall3?: `0x${string}` } = {}): Promise<KeeperTickResult> {
    const now = opts.now ?? new Date();
    const multicall3 = 'multicall3' in opts ? opts.multicall3 : CONTRACTS.multicall3;
    const result: KeeperTickResult = { signed: 0, repaired: 0, transactions: 0, outcomes: {} };
    const count = (job: Job, outcome: RelayOutcome) => {
        const key = `${job.kind}:${outcome}` as const;
        result.outcomes[key] = (result.outcomes[key] ?? 0) + 1;
    };

    // 1. Sign what's due.
    try {
        const ended = await Duel.find({ status: 'LIVE', endTime: { $lt: now } }).sort({ endTime: 1 }).limit(MAX_JOBS_PER_TICK);
        const sign = async (duel: IDuel) => {
            try {
                await maybeSettle(duel, { relay: false });
                if (duel.status !== 'LIVE') result.signed += 1;
            } catch (err) {
                console.error(`[keeper] maybeSettle ${duel._id}: ${(err as Error).message}`);
            }
        };
        // On-chain duels only sign here (reads + one signature), so they run in
        // parallel. A legacy off-chain duel settles and awards points on the
        // spot, which must not race another duel of the same player (see
        // readStatuses) -- those go one at a time.
        await mapBounded(ended.filter((d) => d.escrowAddress), SIGN_CONCURRENCY, sign);
        for (const duel of ended.filter((d) => !d.escrowAddress)) await sign(duel);
        const stranded = await Duel.find({ status: 'SETTLING', escrowAddress: { $exists: true }, oracleSignature: { $exists: false } })
            .sort({ endTime: 1 })
            .limit(MAX_JOBS_PER_TICK);
        await mapBounded(stranded, SIGN_CONCURRENCY, async (duel) => {
            try {
                await retrySettlementSigning(duel);
                if (duel.oracleSignature) result.repaired += 1;
            } catch (err) {
                console.error(`[keeper] retrySettlementSigning ${duel._id}: ${(err as Error).message}`);
            }
        });
    } catch (err) {
        console.error(`[keeper] signing phase: ${(err as Error).message}`);
    }

    let account;
    try {
        account = relayerAccount();
    } catch (err) {
        console.error(`[keeper] ${(err as Error).message}`);
        return result;
    }
    if (!account) {
        result.unconfigured = true;
        return result;
    }

    const holder = randomUUID();
    if (!(await acquireSendLock(holder).catch(() => false))) {
        result.busy = true;
        return result;
    }
    try {
        // 2. What's due, and 5. (below) sync anything the chain already moved.
        const candidates = await findDueJobs(now);
        const paused = candidates.some((j) => j.kind === 'settle') ? await readFactoryPaused().catch(() => true) : false;
        const pending: Job[] = [];
        const before = await readStatuses(candidates);
        for (const [i, job] of candidates.entries()) {
            try {
                const status = before[i];
                if (status instanceof Error) throw status;
                const synced = await syncFromChain(job, status);
                if (synced) {
                    count(job, synced);
                    continue;
                }
                // Pause blocks settle()/voidActive() only; expire and refundStale stay open.
                if (job.kind === 'settle' && paused) {
                    count(job, 'paused');
                    continue;
                }
                pending.push(job);
            } catch (err) {
                console.error(`[keeper] ${job.kind} ${job.duel._id}: ${(err as Error).message}`);
                count(job, 'failed');
            }
        }

        // 3. Dry-run each call; drop anything that would revert.
        const ready: Job[] = [];
        await mapBounded(pending, READ_CONCURRENCY, async (job) => {
            try {
                await publicClient.simulateContract({ account, address: job.escrow, abi: BattleEscrowAbi, ...callFor(job) });
                ready.push(job);
            } catch (err) {
                const reason = (err as Error)?.message ?? String(err);
                if (reason.includes('paused')) return count(job, 'paused');
                console.warn(`[keeper] ${job.kind} ${job.duel._id} would revert, skipped: ${reason.split('\n')[0]}`);
                count(job, 'rejected');
            }
        });

        // 4. Send, 5. confirm.
        const wallet = createWalletClient({ account, chain, transport: http(CONTRACTS.rpcUrl) });
        const batches: Job[][] = multicall3
            ? Array.from({ length: Math.ceil(ready.length / CHUNK) }, (_, i) => ready.slice(i * CHUNK, (i + 1) * CHUNK))
            : ready.map((job) => [job]);
        for (const batch of batches) {
            if (!(await renewSendLock(holder))) {
                console.error('[keeper] lost the send lock mid-tick; leaving the rest for the next tick');
                break;
            }
            let hash: `0x${string}` | undefined;
            try {
                if (multicall3) {
                    hash = await wallet.writeContract({
                        address: multicall3,
                        abi: multicall3Abi,
                        functionName: 'aggregate3',
                        args: [
                            batch.map((job) => ({
                                target: job.escrow,
                                allowFailure: true,
                                callData: encodeFunctionData({ abi: BattleEscrowAbi, ...callFor(job) }),
                            })),
                        ],
                        chain,
                    });
                } else {
                    const [job] = batch;
                    hash = await wallet.writeContract({ address: job.escrow, abi: BattleEscrowAbi, ...callFor(job), chain } as never);
                }
                result.transactions += 1;
                await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
            } catch (err) {
                console.error(`[keeper] batch of ${batch.length}${hash ? ` (tx ${hash})` : ''}: ${(err as Error).message}`);
                if (hash) {
                    // Broadcast but no receipt: it may still land. Don't resend these duels until it has had time to.
                    await Duel.updateMany(
                        { _id: { $in: batch.map((j) => j.duel._id) } },
                        { $set: { relayLockedUntil: new Date(Date.now() + PENDING_TX_LEASE_MS) } }
                    );
                }
                batch.forEach((job) => count(job, 'failed'));
                continue;
            }
            const after = await readStatuses(batch);
            for (const [i, job] of batch.entries()) {
                try {
                    const status = after[i];
                    if (status instanceof Error) throw status;
                    count(job, (await syncFromChain(job, status, hash)) ?? 'failed');
                } catch (err) {
                    console.error(`[keeper] confirm ${job.kind} ${job.duel._id}: ${(err as Error).message}`);
                    count(job, 'failed');
                }
            }
        }

        // 6. Top the relayer's own gas back up if it's running low -- still under
        // the send lock, right after this tick's own sends, so it reacts within
        // seconds of the settlement that (indirectly) made the balance drop.
        result.topUp = await maybeTopUpRelayer(account, wallet);
    } catch (err) {
        console.error(`[keeper] ${(err as Error).message}`);
    } finally {
        await releaseSendLock(holder).catch(() => {});
    }
    return result;
}
