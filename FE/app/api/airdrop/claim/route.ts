import { connectToDatabase } from '@/lib/mongoose';
import AirdropClaim from '@/lib/models/AirdropClaim';
import WhitelistEntry from '@/lib/models/WhitelistEntry';
import { getAirdropProgress } from '@/lib/airdrop';
import { SOCIAL_TASK_IDS, isSocialTaskEnabled } from '@/lib/airdropConfig';
import { isValidWalletAddress } from '@/lib/walletVerification';
import { success, failure } from '@/utils/response';

/**
 * Records a self-reported social task. Only social tasks go through here --
 * everything else is verified from source data and can't be claimed.
 *
 * Gated on a signature-verified whitelist entry so each claim is tied to a
 * wallet that proved ownership once; that caps farming at one set of social
 * rewards per verified wallet. There is still no per-request signature, so
 * anyone could trigger a claim *for* a verified wallet -- which only ever
 * gives that wallet its own small, capped reward, so it isn't worth the extra
 * signing prompt on every click.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        const wallet = String(body?.wallet ?? '').toLowerCase();
        const taskId = String(body?.taskId ?? '');

        if (!isValidWalletAddress(wallet)) return failure('A valid wallet address is required.', 400);
        if (!SOCIAL_TASK_IDS.has(taskId)) return failure('That task is verified automatically and cannot be claimed.', 400);
        if (!isSocialTaskEnabled(taskId)) return failure('That task is not live yet.', 409);

        await connectToDatabase();

        const entry = await WhitelistEntry.findOne({ identifier: wallet });
        if (!entry?.walletVerified) {
            return failure('Verify your wallet first to unlock social tasks.', 403);
        }

        try {
            await AirdropClaim.create({ wallet, taskId });
        } catch (err: any) {
            if (err?.code !== 11000) throw err; // already claimed: fine, fall through
        }

        return success(await getAirdropProgress(wallet));
    } catch (err) {
        return failure((err as Error).message);
    }
}
