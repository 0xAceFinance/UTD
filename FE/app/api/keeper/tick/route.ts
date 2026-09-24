import { connectToDatabase } from '@/lib/mongoose';
import { runKeeperTick } from '@/lib/settlementRelayer';
import { isAuthorizedCron } from '@/lib/adminAuth';
import { success, failure } from '@/utils/response';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Woken by a Cloud Task at the moment a duel's work falls due (a lobby's open
 * window closing, a live duel's timer ending -- lib/keeperSchedule.ts). Runs
 * one keeper tick (lib/settlementRelayer.ts): signs, then pays out / refunds
 * everything due, batched. Same bearer secret as the cron.
 *
 * Answers 503 when another tick holds the send lock, so Cloud Tasks retries
 * with backoff: the tick that holds it chose its work before this task fired
 * and may not include this duel.
 */
export async function POST(req: Request) {
    if (!isAuthorizedCron(req)) return failure('unauthorized', 401);
    try {
        await connectToDatabase();
        const tick = await runKeeperTick();
        if (tick.busy) return failure('keeper busy, retry', 503);
        return success(tick);
    } catch (err) {
        console.error(`[keeper/tick] ${(err as Error).message}`);
        return failure((err as Error).message);
    }
}
