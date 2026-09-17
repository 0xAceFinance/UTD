import { NextRequest } from 'next/server';
import { connectToDatabase } from '@/lib/mongoose';
import { checkCanCreateLobby } from '@/lib/duelGuards';
import { success, failure } from '@/utils/response';

/**
 * Checked by the frontend before it prompts a wallet to sign the on-chain
 * createDuel() transaction, so a wallet that's about to be rejected (circuit
 * breaker, geofence, cancellation rate limit) doesn't waste gas finding that
 * out. The real POST /api/duels re-checks the same rules afterward -- this
 * is a fast-fail convenience, not the security boundary.
 */
export async function GET(req: NextRequest) {
    try {
        const wallet = req.nextUrl.searchParams.get('wallet');
        if (!wallet) return failure('wallet is required', 400);

        await connectToDatabase();
        const blockedReason = await checkCanCreateLobby(req, wallet);
        if (blockedReason) return failure(blockedReason, 403);

        return success({ canCreate: true });
    } catch (err) {
        return failure((err as Error).message);
    }
}
