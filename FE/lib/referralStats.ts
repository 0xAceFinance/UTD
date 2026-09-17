import WhitelistEntry from './models/WhitelistEntry';
import { totalReferralPoints } from './referralPoints';

export interface ReferralStats {
    referredCount: number;
    points: number;
}

/** Only wallet-verified, non-sybil-flagged referrals count -- see WhitelistEntry's field comments. */
export async function getReferralStats(referralCode: string): Promise<ReferralStats> {
    const referredCount = await WhitelistEntry.countDocuments({
        referredBy: referralCode,
        walletVerified: true,
        referralSybilFlagged: { $ne: true },
    });

    return { referredCount, points: totalReferralPoints(referredCount) };
}
