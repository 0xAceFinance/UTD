import { connectToDatabase } from '@/lib/mongoose';
import KeeperConfig, { getKeeperConfig } from '@/lib/models/KeeperConfig';
import { isAuthorizedAdmin } from '@/lib/adminAuth';
import { success, failure } from '@/utils/response';

/** Sanity ceiling on a single admin-set top-up, independent of the treasury's
 * own on-chain approve() ceiling -- catches a fat-fingered value (or a
 * leaked admin secret) before it swaps a large chunk of the treasury's
 * allowance in one shot. Raise this too if the treasury genuinely outgrows it. */
const MAX_TOP_UP_USDG = 50;

/** Current relayer gas top-up setting (lib/relayerTopUp.ts). */
export async function GET(req: Request) {
    if (!isAuthorizedAdmin(req)) return failure('unauthorized', 401);
    try {
        await connectToDatabase();
        const config = await getKeeperConfig();
        return success({ topUpUsdg: config.topUpUsdg, updatedAt: config.updatedAt, updatedBy: config.updatedBy });
    } catch (err) {
        return failure((err as Error).message);
    }
}

/**
 * Raises (or lowers) how much USDG the relayer pulls from the treasury and
 * swaps to ETH each time its gas balance runs low -- e.g. start at $1, move
 * to $5 once the treasury has grown. Takes effect on the next tick; no
 * redeploy, no restart, and it never touches the treasury's own on-chain
 * approve() ceiling (Deployment.md's "Automatic relayer gas top-up").
 */
export async function PATCH(req: Request) {
    if (!isAuthorizedAdmin(req)) return failure('unauthorized', 401);
    try {
        const { topUpUsdg } = await req.json();
        if (typeof topUpUsdg !== 'number' || !Number.isFinite(topUpUsdg) || topUpUsdg <= 0) {
            return failure('topUpUsdg must be a positive number', 400);
        }
        if (topUpUsdg > MAX_TOP_UP_USDG) {
            return failure(`topUpUsdg above the ${MAX_TOP_UP_USDG} sanity ceiling -- raise MAX_TOP_UP_USDG if this is intentional`, 400);
        }

        await connectToDatabase();
        const updated = await KeeperConfig.findOneAndUpdate(
            { _id: 'relayer' },
            { $set: { topUpUsdg, updatedAt: new Date() } },
            { upsert: true, new: true }
        );
        return success({ topUpUsdg: updated.topUpUsdg, updatedAt: updated.updatedAt });
    } catch (err) {
        return failure((err as Error).message, 400);
    }
}
