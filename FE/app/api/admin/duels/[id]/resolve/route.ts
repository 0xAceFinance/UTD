import { Types } from 'mongoose';
import { connectToDatabase } from '@/lib/mongoose';
import Duel from '@/lib/models/Duel';
import { computeWinnerSide, finalizeSettlement } from '@/lib/duelEngine';
import { signSettlement, signVoid } from '@/lib/oracleSigner';
import { isAuthorizedAdmin } from '@/lib/adminAuth';
import { success, failure } from '@/utils/response';

/**
 * The HELD recovery path (Section 05/06): a duel flagged by the wallet-clustering
 * sybil check has no other way to move forward or refund (see
 * matchmaking/README.md and lib/duelEngine.ts::isSybilMatch). An admin reviews it
 * and picks one of two outcomes:
 *
 *  - action "confirm": the flag was a false positive (shared IP from a VPN/NAT/
 *    shared wifi, not real collusion) -- proceed with the oracle-computed winner
 *    exactly as a normal settlement would have. For an on-chain duel this signs
 *    the result and moves to SETTLING, same as the ordinary maybeSettle path;
 *    the usual confirm-settlement call finishes it once the signed settle() tx
 *    lands. A legacy off-chain duel (no escrowAddress) settles immediately.
 *
 *  - action "void": the match should not settle. For an on-chain duel this signs
 *    a voidActive() refund (Contracts/src/duel/BattleEscrow.sol) and stores it on
 *    the duel -- the duel stays HELD until app/api/admin/duels/[id]/confirm-void
 *    verifies the real on-chain Voided event, mirroring the sign-then-confirm
 *    shape already used for settlement. A legacy off-chain duel has no on-chain
 *    funds to move, so it goes straight to CANCELLED.
 *
 * Internal-only: gated by a shared secret (lib/adminAuth.ts), not a
 * player-facing endpoint. Every status transition below is an atomic
 * conditional update off the HELD status, so two concurrent resolve calls
 * for the same duel can't both proceed (same pattern as maybeSettle/
 * confirm-settlement in lib/duelEngine.ts and its route).
 */
const ALREADY_SIGNED = 'a resolution was already signed for this duel';

/** Every claim below is conditional on no signature having been stored yet.
 * A void signature leaves the duel HELD (it only leaves HELD once
 * confirm-void sees the on-chain Voided event), so a status check alone would
 * let a later "confirm" also sign a settlement for the same escrow -- two
 * valid, conflicting on-chain outcomes, first submitter wins. Once any
 * signature is stored, no second one is ever issued or returned. */
const UNSIGNED_HELD = (id: unknown) => ({ _id: id, status: 'HELD', oracleSignature: { $exists: false } });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        if (!isAuthorizedAdmin(req)) return failure('unauthorized', 401);

        const { id } = await params;
        if (!Types.ObjectId.isValid(id)) return failure('invalid duel id', 400);

        const { action } = await req.json();
        if (action !== 'confirm' && action !== 'void') return failure('action must be "confirm" or "void"', 400);

        await connectToDatabase();
        const duel = await Duel.findById(id);
        if (!duel) return failure('duel not found', 404);
        if (duel.status !== 'HELD') return failure(`duel is not HELD (status: ${duel.status})`, 409);
        if (duel.oracleSignature) return failure(ALREADY_SIGNED, 409);

        if (action === 'confirm') {
            const winnerSide = computeWinnerSide(duel);

            if (duel.escrowAddress) {
                const oracleSignature = await signSettlement(duel.escrowAddress as `0x${string}`, winnerSide);
                const claimed = await Duel.findOneAndUpdate(
                    UNSIGNED_HELD(duel._id),
                    { $set: { status: 'SETTLING', winnerSide, oracleSignature } },
                    { new: true }
                );
                if (!claimed) return failure(ALREADY_SIGNED, 409);
                return success(claimed);
            }

            const claimed = await Duel.findOneAndUpdate(
                UNSIGNED_HELD(duel._id),
                { $set: { status: 'SETTLED', winnerSide } }
            );
            if (!claimed) return failure(ALREADY_SIGNED, 409);
            duel.status = 'SETTLED';
            await finalizeSettlement(duel, winnerSide);
            return success(duel);
        }

        // action === 'void'
        if (duel.escrowAddress) {
            const oracleSignature = await signVoid(duel.escrowAddress as `0x${string}`);
            const claimed = await Duel.findOneAndUpdate(
                UNSIGNED_HELD(duel._id),
                { $set: { oracleSignature } },
                { new: true }
            );
            if (!claimed) return failure(ALREADY_SIGNED, 409);
            return success(claimed);
        }

        const claimed = await Duel.findOneAndUpdate(
            UNSIGNED_HELD(duel._id),
            { $set: { status: 'CANCELLED' } },
            { new: true }
        );
        if (!claimed) return failure(ALREADY_SIGNED, 409);
        return success(claimed);
    } catch (err) {
        return failure((err as Error).message, 400);
    }
}
