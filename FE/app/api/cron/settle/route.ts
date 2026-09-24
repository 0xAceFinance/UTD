import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { runKeeperTick } from '@/lib/settlementRelayer';
import { checkRelayerHealth } from '@/lib/relayerHealth';
import { postAlert } from '@/lib/alerts';
import { isAuthorizedCron } from '@/lib/adminAuth';
import { success, failure } from '@/utils/response';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Admin review of a HELD duel must finish well before refundStale() opens at endTime + 24h. */
const HELD_ALERT_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Cloud Scheduler, every minute: the backstop for the keeper. Work is
 * normally picked up within seconds of falling due by a Cloud Task
 * (lib/keeperSchedule.ts -> app/api/keeper/tick); this catches anything a
 * task missed (a failed enqueue, a crashed instance, a tick that found the
 * send lock busy). It runs the same tick (lib/settlementRelayer.ts):
 *  1. signs every LIVE duel whose timer has run out, and repairs any stranded
 *     at SETTLING with no signature;
 *  2. pays out signed duels (settle), refunds unmatched lobbies (expire) and
 *     never-signed duels 24h after the end (refundStale), batched;
 * then flags HELD duels still unresolved 12h after endTime (at 24h
 * refundStale() would let the loser walk away with their stake) and checks the
 * relayer wallet's gas balance.
 */
export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return failure('unauthorized', 401);

    try {
        await connectToDatabase();
        const now = Date.now();

        const tick = await runKeeperTick({ now: new Date(now) });

        const overdueHeld = await Duel.find({ status: 'HELD', endTime: { $lt: new Date(now - HELD_ALERT_AFTER_MS) } })
            .select('_id endTime escrowAddress')
            .lean();
        if (overdueHeld.length > 0) await alertOverdueHeld(overdueHeld, now);

        const relayer = await checkRelayerHealth().catch((err) => {
            console.error(`[cron/settle] relayer health: ${(err as Error).message}`);
            return null;
        });

        return success({ ...tick, overdueHeld: overdueHeld.map((d) => String(d._id)), relayer });
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
    await postAlert(text);
}
