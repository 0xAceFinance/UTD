import { connectToDatabase } from '@/lib/mongoose';
import WhitelistEntry from '@/lib/models/WhitelistEntry';
import { getReferralStats } from '@/lib/referralStats';
import { success, failure } from '@/utils/response';

/**
 * A returning visitor reconnecting their wallet: if it's already a verified
 * whitelist entry, hand back their referral dashboard directly rather than
 * making them sign again. 404 (not a plain empty 200) when there's nothing
 * to show, so the frontend can tell "not registered yet" apart from "you
 * have zero referrals" -- the latter still returns 200 with points: 0.
 */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const wallet = (searchParams.get('wallet') ?? '').toLowerCase();
        if (!wallet) return failure('wallet is required', 400);

        await connectToDatabase();
        const entry = await WhitelistEntry.findOne({ identifier: wallet });
        if (!entry || !entry.walletVerified || !entry.referralCode) {
            return failure('No verified whitelist entry for this wallet.', 404);
        }

        const stats = await getReferralStats(entry.referralCode);
        return success({
            passNumber: entry.passNumber,
            referralCode: entry.referralCode,
            ...stats,
        });
    } catch (err) {
        return failure((err as Error).message);
    }
}
