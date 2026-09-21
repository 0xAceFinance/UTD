import {
    referralTierBpsForVolume,
    REFERRAL_TIER_CONFIG,
    REFERRAL_VOLUME_CHECKPOINTS,
    REFERRAL_EARNINGS_CHECKPOINTS,
} from '@mcapduel/points';
import { connectToDatabase } from '@/lib/mongoose';
import WhitelistEntry from '@/lib/models/WhitelistEntry';
import type { IWhitelistEntry } from '@/lib/models/WhitelistEntry';
import ReferralAccount from '@/lib/models/ReferralAccount';
import type { IReferralAccount } from '@/lib/models/ReferralAccount';
import Duel from '@/lib/models/Duel';
import type { IDuel } from '@/lib/models/Duel';
import { success, failure } from '@/utils/response';

/**
 * Everything the referral dashboard needs for one wallet, read fresh on every
 * call -- the FE hook polls this on an interval so the page feels realtime
 * without a websocket. All numbers here are derived from the same records
 * lib/referralAccount.ts writes at settlement time (ReferralAccount) and
 * lib/referralAttribution.ts writes at first-touch (WhitelistEntry), so this
 * route never recomputes anything that already has a source of truth.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ wallet: string }> }) {
    try {
        const { wallet } = await params;
        const lower = wallet.toLowerCase();
        await connectToDatabase();

        const [entry, account] = await Promise.all([
            WhitelistEntry.findOne({ identifier: lower }).lean<IWhitelistEntry>(),
            ReferralAccount.findOne({ wallet: lower }).lean<IReferralAccount>(),
        ]);

        const referralCode = entry?.referralCode;
        const volumeUsd = account?.cumulativeSettledVolumeUsd ?? 0;
        const earningsUsd = account?.cumulativeReferralEarningsUsd ?? 0;
        const volumeHit = new Set(account?.volumeCheckpointsHit ?? []);
        const earningsHit = new Set(account?.earningsCheckpointsHit ?? []);

        const tiers = REFERRAL_TIER_CONFIG.tiers;
        const currentBps = referralTierBpsForVolume(volumeUsd);
        const currentTierIndex = tiers.findIndex((t) => t.bps === currentBps);
        const nextTier = currentTierIndex >= 0 ? tiers[currentTierIndex + 1] : undefined;

        const [referredByEntry, referredCount, recentReferrals, commissionDuels] = await Promise.all([
            entry?.referredBy
                ? WhitelistEntry.findOne({ referralCode: entry.referredBy }).select('identifier').lean<Pick<IWhitelistEntry, 'identifier'>>()
                : null,
            referralCode
                ? WhitelistEntry.countDocuments({
                      referredBy: referralCode,
                      walletVerified: true,
                      referralSybilFlagged: { $ne: true },
                  })
                : 0,
            referralCode
                ? WhitelistEntry.find({ referredBy: referralCode })
                      .sort({ createdAt: -1 })
                      .limit(25)
                      .select('identifier walletVerified referralSybilFlagged createdAt')
                      .lean<Pick<IWhitelistEntry, 'identifier' | 'walletVerified' | 'referralSybilFlagged' | 'createdAt'>[]>()
                : [],
            Duel.find({
                status: 'SETTLED',
                $or: [
                    { creatorReferrerWallet: lower, creatorReferrerBps: { $gt: 0 } },
                    { opponentReferrerWallet: lower, opponentReferrerBps: { $gt: 0 } },
                ],
            })
                .sort({ endTime: -1 })
                .limit(25)
                .select('creatorWallet opponentWallet creatorReferrerWallet creatorReferrerBps opponentReferrerWallet opponentReferrerBps buyInUsd tokenA tokenB endTime')
                .lean<(Pick<IDuel, 'creatorWallet' | 'opponentWallet' | 'creatorReferrerWallet' | 'creatorReferrerBps' | 'opponentReferrerWallet' | 'opponentReferrerBps' | 'buyInUsd' | 'tokenA' | 'tokenB' | 'endTime'> & { _id: unknown })[]>(),
        ]);

        const referredWallets = recentReferrals.map((r) => r.identifier);
        const referredAccounts = referredWallets.length
            ? await ReferralAccount.find({ wallet: { $in: referredWallets } })
                  .select('wallet cumulativeSettledVolumeUsd')
                  .lean<Pick<IReferralAccount, 'wallet' | 'cumulativeSettledVolumeUsd'>[]>()
            : [];
        const volumeByWallet = new Map(referredAccounts.map((a) => [a.wallet, a.cumulativeSettledVolumeUsd]));

        const commissions = commissionDuels.flatMap((d) => {
            const matchup = `${d.tokenA?.symbol ?? '?'} vs ${d.tokenB?.symbol ?? '?'}`;
            const rows: { duelId: string; matchup: string; referredWallet: string; buyInUsd: number; bps: number; commissionUsd: number; settledAt: Date | undefined }[] = [];
            if (d.creatorReferrerWallet === lower && (d.creatorReferrerBps ?? 0) > 0) {
                rows.push({
                    duelId: String(d._id),
                    matchup,
                    referredWallet: d.creatorWallet,
                    buyInUsd: d.buyInUsd,
                    bps: d.creatorReferrerBps!,
                    commissionUsd: (d.buyInUsd * d.creatorReferrerBps!) / 10_000,
                    settledAt: d.endTime,
                });
            }
            if (d.opponentReferrerWallet === lower && (d.opponentReferrerBps ?? 0) > 0 && d.opponentWallet) {
                rows.push({
                    duelId: String(d._id),
                    matchup,
                    referredWallet: d.opponentWallet,
                    buyInUsd: d.buyInUsd,
                    bps: d.opponentReferrerBps!,
                    commissionUsd: (d.buyInUsd * d.opponentReferrerBps!) / 10_000,
                    settledAt: d.endTime,
                });
            }
            return rows;
        });

        return success({
            wallet: lower,
            referralCode: referralCode ?? null,
            referredByWallet: referredByEntry?.identifier ?? null,
            referredCount,
            tier: {
                bps: currentBps,
                volumeUsd,
                nextBps: nextTier?.bps ?? null,
                nextThresholdUsd: nextTier?.minVolumeUsd ?? null,
                maxBps: REFERRAL_TIER_CONFIG.maxBps,
            },
            earningsUsd,
            volumeCheckpoints: REFERRAL_VOLUME_CHECKPOINTS.map((c) => ({
                thresholdUsd: c.volumeUsd,
                points: c.points,
                hit: volumeHit.has(`volume:${c.volumeUsd}`),
            })),
            earningsCheckpoints: REFERRAL_EARNINGS_CHECKPOINTS.map((c) => ({
                thresholdUsd: c.earningsUsd,
                points: c.points,
                hit: earningsHit.has(`earnings:${c.earningsUsd}`),
            })),
            recentReferrals: recentReferrals.map((r) => ({
                wallet: r.identifier,
                verified: r.walletVerified,
                sybilFlagged: !!r.referralSybilFlagged,
                joinedAt: r.createdAt,
                volumeUsd: volumeByWallet.get(r.identifier) ?? 0,
            })),
            recentCommissions: commissions,
        });
    } catch (err) {
        return failure((err as Error).message);
    }
}
