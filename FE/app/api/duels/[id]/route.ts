import { Types } from 'mongoose';
import { expire } from '@mcapduel/matchmaking';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { simulateTick, maybeSettle, retrySettlementSigning } from '@/lib/duelEngine';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import { success, failure } from '@/utils/response';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        if (!Types.ObjectId.isValid(id)) return failure('invalid duel id', 400);

        await connectToDatabase();
        const duel = await Duel.findById(id);
        if (!duel) return failure('duel not found', 404);

        // Self-healing reads: a LIVE duel advances/settles on whoever happens
        // to GET it next -- no separate cron needed for this demo's scale
        // (maybeSettle drives its own transitions internally, lib/duelEngine.ts).
        // An unmatched lobby past its open window is different: reclaiming the
        // creator's real stake needs a real expireDuel() transaction (anyone
        // may submit it, permissionlessly -- Contracts/src/duel/BattleEscrow.sol),
        // so a GET alone can't mark it EXPIRED for an on-chain duel. The
        // frontend shows a "Reclaim Stake" action once past deadline and
        // confirms it through app/api/duels/[id]/expire/route.ts. A legacy
        // duel with no escrowAddress has no on-chain stake to reclaim, so it
        // still self-heals here exactly as before.
        if (duel.status === 'OPEN' && !duel.escrowAddress && Date.now() > duel.openDeadline.getTime()) {
            applyLobby(duel, expire(toLobbySnapshot(duel), Math.floor(Date.now() / 1000)));
            await duel.save();
        } else if (duel.status === 'LIVE') {
            await simulateTick(duel);
            await duel.save();
            await maybeSettle(duel);
        } else if (duel.status === 'SETTLING' && !duel.oracleSignature) {
            // Repairs a duel that got stranded here before it ever got a
            // signature -- see retrySettlementSigning's doc comment.
            await retrySettlementSigning(duel);
        }

        return success(duel);
    } catch (err) {
        return failure((err as Error).message);
    }
}
