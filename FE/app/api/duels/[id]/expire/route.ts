import { Types } from 'mongoose';
import { expire } from '@mcapduel/matchmaking';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { verifyDuelClosed } from '@/lib/chainVerify';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import { success, failure } from '@/utils/response';

/**
 * expireDuel() on the real contract is permissionless (anyone can reclaim a
 * creator's stake once the open window passes -- Contracts/src/duel/BattleEscrow.sol),
 * so this route is too: no wallet ownership check, just proof the real
 * transaction happened. Without a real escrowAddress (a legacy duel from
 * before on-chain integration), there's no stake to reclaim on-chain, so
 * this just applies the state transition directly.
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
            await verifyDuelClosed(txHash, duel.escrowAddress, 'DuelExpired');
        }

        try {
            applyLobby(duel, expire(toLobbySnapshot(duel), Math.floor(Date.now() / 1000)));
        } catch (err) {
            return failure((err as Error).message, 409);
        }
        await duel.save();

        return success(duel);
    } catch (err) {
        return failure((err as Error).message);
    }
}
