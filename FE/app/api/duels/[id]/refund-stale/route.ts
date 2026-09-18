import { Types } from 'mongoose';
import { refundStale } from '@mcapduel/matchmaking';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { verifyDuelRefundedStale } from '@/lib/chainVerify';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import { success, failure } from '@/utils/response';

/**
 * The last-resort recovery path (see BattleEscrow.refundStale() and
 * matchmaking's refundStale transition): a duel that's sat unsettled well
 * past its end time, with no oracle-signed settlement or void ever landing.
 * refundStale() on the real contract is permissionless -- no signature, no
 * wallet ownership check -- so this route is too, just proof the real
 * transaction happened. Without a real escrowAddress (a legacy duel from
 * before on-chain integration), there's no on-chain event to verify, so this
 * just applies the state transition directly.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        if (!Types.ObjectId.isValid(id)) return failure('invalid duel id', 400);

        await connectToDatabase();
        const duel = await Duel.findById(id);
        if (!duel) return failure('duel not found', 404);

        if (duel.escrowAddress) {
            const { txHash } = await req.json().catch(() => ({ txHash: undefined }));
            if (!txHash) return failure('txHash is required', 400);
            await verifyDuelRefundedStale(txHash, duel.escrowAddress);
        }

        const claimed = await Duel.findOneAndUpdate(
            { _id: duel._id, status: { $in: ['LIVE', 'SETTLING', 'HELD'] } },
            { $set: { status: refundStale(toLobbySnapshot(duel)).status } },
            { new: true }
        );
        if (!claimed) return success(await Duel.findById(id));

        return success(claimed);
    } catch (err) {
        return failure((err as Error).message, 400);
    }
}
