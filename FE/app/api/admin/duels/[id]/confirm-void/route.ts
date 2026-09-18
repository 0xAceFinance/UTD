import { Types } from 'mongoose';
import { voidHeld } from '@mcapduel/matchmaking';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { verifyDuelVoided } from '@/lib/chainVerify';
import { toLobbySnapshot } from '@/lib/lobbyAdapter';
import { isAuthorizedAdmin } from '@/lib/adminAuth';
import { success, failure } from '@/utils/response';

/**
 * Finalizes the "void" half of the HELD recovery path once the admin-signed
 * voidActive() transaction (app/api/admin/duels/[id]/resolve) has actually
 * been submitted on-chain. Never trusts the caller's claim of what
 * happened -- re-derives it from the real Voided event in the real
 * transaction receipt first, same pattern as confirm-settlement. Safe to
 * call more than once -- a duel that's already CANCELLED just returns as-is.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        if (!isAuthorizedAdmin(req)) return failure('unauthorized', 401);

        const { id } = await params;
        if (!Types.ObjectId.isValid(id)) return failure('invalid duel id', 400);

        const { txHash } = await req.json();
        if (!txHash) return failure('txHash is required', 400);

        await connectToDatabase();
        const duel = await Duel.findById(id);
        if (!duel) return failure('duel not found', 404);

        if (duel.status === 'CANCELLED') return success(duel);
        if (duel.status !== 'HELD' || !duel.escrowAddress) {
            return failure(`cannot confirm void for a duel in status ${duel.status}`, 409);
        }

        await verifyDuelVoided(txHash, duel.escrowAddress);
        const nextStatus = voidHeld(toLobbySnapshot(duel)).status;

        const claimed = await Duel.findOneAndUpdate(
            { _id: duel._id, status: 'HELD' },
            { $set: { status: nextStatus } },
            { new: true }
        );
        if (!claimed) return success(await Duel.findById(id));

        return success(claimed);
    } catch (err) {
        return failure((err as Error).message, 400);
    }
}
