import { Types } from 'mongoose';
import { cancel } from '@mcapduel/matchmaking';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { verifyDuelClosed } from '@/lib/chainVerify';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import { success, failure } from '@/utils/response';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        if (!Types.ObjectId.isValid(id)) return failure('invalid duel id', 400);

        const { wallet, txHash } = await req.json();
        if (!wallet) return failure('wallet is required', 400);

        await connectToDatabase();
        const duel = await Duel.findById(id);
        if (!duel) return failure('duel not found', 404);

        // The wallet already signed and paid gas for the on-chain cancelDuel()
        // transaction, which is what actually refunds the stake -- never trust
        // the client's claim; decode the real DuelCancelled event first.
        // (duel.escrowAddress is absent only on legacy duels created before
        // on-chain integration existed.)
        if (duel.escrowAddress) {
            if (!txHash) return failure('txHash is required', 400);
            await verifyDuelClosed(txHash, duel.escrowAddress, 'DuelCancelled');
        }

        // The real @mcapduel/matchmaking state machine -- see lib/lobbyAdapter.ts.
        try {
            applyLobby(duel, cancel(toLobbySnapshot(duel), wallet.toLowerCase()));
        } catch (err) {
            return failure((err as Error).message, 409);
        }

        // Real timestamp the cancellation rate limiter (@mcapduel/matchmaking's
        // canCreateLobby) checks against at the wallet's next lobby creation --
        // see app/api/duels/route.ts.
        duel.cancelledAt = new Date();
        await duel.save();

        return success(duel);
    } catch (err) {
        return failure((err as Error).message);
    }
}
