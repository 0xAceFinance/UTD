import { Types } from 'mongoose';
import { settle } from '@mcapduel/matchmaking';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { verifyDuelSettled } from '@/lib/chainVerify';
import { finalizeSettlement } from '@/lib/duelEngine';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import { success, failure } from '@/utils/response';

/**
 * Called by the frontend after it submits a real settle() transaction on the
 * escrow contract (anyone may -- BattleEscrow.settle() is permissionless
 * given the oracle's signature, see lib/oracleSigner.ts). Never trusts the
 * client's claim of what happened: re-derives the real winnerSide from the
 * real Settled event in the real transaction receipt before touching
 * anything. Safe to call more than once -- a duel that's already SETTLED
 * just returns as-is.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        if (!Types.ObjectId.isValid(id)) return failure('invalid duel id', 400);

        const { txHash } = await req.json();
        if (!txHash) return failure('txHash is required', 400);

        await connectToDatabase();
        const duel = await Duel.findById(id);
        if (!duel) return failure('duel not found', 404);

        if (duel.status === 'SETTLED') return success(duel);
        if (duel.status !== 'SETTLING' || !duel.escrowAddress) {
            return failure(`cannot confirm settlement for a duel in status ${duel.status}`, 409);
        }

        const { winnerSide } = await verifyDuelSettled(txHash, duel.escrowAddress);

        applyLobby(duel, settle(toLobbySnapshot(duel), winnerSide));
        await finalizeSettlement(duel, winnerSide);

        return success(duel);
    } catch (err) {
        return failure((err as Error).message, 400);
    }
}
