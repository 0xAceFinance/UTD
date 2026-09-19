import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { maybeSettle, retrySettlementSigning } from '@/lib/duelEngine';
import { submitSettlement, type RelayOutcome } from '@/lib/settlementRelayer';
import { isAuthorizedCron } from '@/lib/adminAuth';
import { success, failure } from '@/utils/response';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Per-run caps keep one invocation inside the function timeout; the rest go next minute. */
const BATCH = 20;

/** Admin review of a HELD duel must finish well before refundStale() opens at endTime + 24h. */
const HELD_ALERT_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Vercel Cron (vercel.json), every minute. The keeper that makes settlement
 * independent of anyone having the duel page open:
 *  1. signs every LIVE duel whose timer has run out (maybeSettle -- until now
 *     this only happened when someone happened to GET the duel);
 *  2. retries signing for any duel stranded at SETTLING with no signature yet
 *     (retrySettlementSigning -- see its doc comment for how a duel ends up
 *     here: maybeSettle's LIVE->SETTLING claim lands before signing does, so
 *     a signing failure of any kind otherwise strands it forever);
 *  3. submits settle() for every signed SETTLING duel (lib/settlementRelayer.ts),
 *     retrying each run until it lands, pauses included;
 *  4. flags HELD duels still unresolved 12h after endTime, since at 24h
 *     refundStale() lets the loser walk away with their stake.
 */
export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return failure('unauthorized', 401);

    try {
        await connectToDatabase();
        const now = Date.now();

        const ended = await Duel.find({ status: 'LIVE', endTime: { $lt: new Date(now) } })
            .sort({ endTime: 1 })
            .limit(BATCH);
        let signed = 0;
        for (const duel of ended) {
            try {
                await maybeSettle(duel, { relay: false });
                if (duel.status !== 'LIVE') signed += 1;
            } catch (err) {
                console.error(`[cron/settle] maybeSettle ${duel._id}: ${(err as Error).message}`);
            }
        }

        const stranded = await Duel.find({
            status: 'SETTLING',
            escrowAddress: { $exists: true },
            oracleSignature: { $exists: false },
        })
            .sort({ endTime: 1 })
            .limit(BATCH);
        let repaired = 0;
        for (const duel of stranded) {
            try {
                await retrySettlementSigning(duel);
                if (duel.oracleSignature) repaired += 1;
            } catch (err) {
                console.error(`[cron/settle] retrySettlementSigning ${duel._id}: ${(err as Error).message}`);
            }
        }

        const settling = await Duel.find({
            status: 'SETTLING',
            escrowAddress: { $exists: true },
            oracleSignature: { $exists: true },
        })
            .sort({ endTime: 1 })
            .limit(BATCH);
        const relayed: Partial<Record<RelayOutcome, number>> = {};
        // Sequential: one relayer wallet, so parallel sends would race each other's nonces.
        for (const duel of settling) {
            const outcome = await submitSettlement(duel);
            relayed[outcome] = (relayed[outcome] ?? 0) + 1;
        }

        const overdueHeld = await Duel.find({ status: 'HELD', endTime: { $lt: new Date(now - HELD_ALERT_AFTER_MS) } })
            .select('_id endTime escrowAddress')
            .lean();
        if (overdueHeld.length > 0) await alertOverdueHeld(overdueHeld, now);

        return success({ signed, repaired, relayed, overdueHeld: overdueHeld.map((d) => String(d._id)) });
    } catch (err) {
        console.error(`[cron/settle] ${(err as Error).message}`);
        return failure((err as Error).message);
    }
}

async function alertOverdueHeld(duels: { _id: unknown; endTime?: Date; escrowAddress?: string }[], now: number) {
    const lines = duels.map((d) => {
        const refundInH = d.endTime ? ((d.endTime.getTime() + 24 * 3600_000 - now) / 3600_000).toFixed(1) : '?';
        return `HELD duel ${d._id} (escrow ${d.escrowAddress ?? 'none'}): refundStale() opens in ${refundInH}h`;
    });
    const text = `[cron/settle] ${duels.length} HELD duel(s) unresolved >12h past endTime -- resolve via /api/admin/duels/[id]/resolve:\n${lines.join('\n')}`;
    console.error(text);

    const webhook = process.env.ALERT_WEBHOOK_URL;
    if (!webhook) return;
    await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
    }).catch((err) => console.error(`[cron/settle] alert webhook failed: ${(err as Error).message}`));
}
