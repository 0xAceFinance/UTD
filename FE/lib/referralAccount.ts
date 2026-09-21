import { referralTierBpsForVolume, crossedVolumeCheckpoints, crossedEarningsCheckpoints } from '@mcapduel/points';
import ReferralAccount from '@/lib/models/ReferralAccount';
import WhitelistEntry from '@/lib/models/WhitelistEntry';
import type { IReferralAccount } from '@/lib/models/ReferralAccount';
import type { IWhitelistEntry } from '@/lib/models/WhitelistEntry';

async function getOrCreateAccount(wallet: string): Promise<IReferralAccount> {
    const lower = wallet.toLowerCase();
    return (
        (await ReferralAccount.findOne({ wallet: lower })) ??
        new ReferralAccount({ wallet: lower })
    );
}

/**
 * Resolves a wallet's direct referrer, if any, by following its
 * WhitelistEntry.referredBy code back to the entry that owns it. Returns
 * undefined if the wallet was never referred, its referrer code doesn't
 * resolve to anyone (deleted/typo'd), or the referrer is the wallet itself
 * (should never happen given how referredBy is set, but never trust it to
 * pay a wallet a commission on its own bets).
 */
export async function getReferrerWallet(wallet: string): Promise<string | undefined> {
    const lower = wallet.toLowerCase();
    const entry = await WhitelistEntry.findOne({ identifier: lower }).lean<IWhitelistEntry>();
    if (!entry?.referredBy) return undefined;

    const referrer = await WhitelistEntry.findOne({ referralCode: entry.referredBy }).lean<IWhitelistEntry>();
    if (!referrer || referrer.identifier === lower) return undefined;
    return referrer.identifier;
}

export interface ReferralSnapshot {
    creatorReferrerWallet?: string;
    creatorReferrerBps: number;
    opponentReferrerWallet?: string;
    opponentReferrerBps: number;
}

/**
 * Resolves both sides' referrers and their current commission tiers in one
 * call -- what lib/duelEngine.ts::maybeSettle() snapshots onto the Duel
 * document and folds into the oracle's signed settlement message before it's
 * ever produced, so what's signed, what's paid on-chain, and what's later
 * credited off-chain (lib/duelEngine.ts::finalizeSettlement, via
 * applyReferralSettlement below) are always the exact same numbers.
 */
export async function computeReferralSnapshot(creatorWallet: string, opponentWallet: string): Promise<ReferralSnapshot> {
    const [creatorReferrerWallet, opponentReferrerWallet] = await Promise.all([
        getReferrerWallet(creatorWallet),
        getReferrerWallet(opponentWallet),
    ]);
    const [creatorReferrerBps, opponentReferrerBps] = await Promise.all([
        creatorReferrerWallet ? currentReferrerBps(creatorReferrerWallet) : 0,
        opponentReferrerWallet ? currentReferrerBps(opponentReferrerWallet) : 0,
    ]);
    return { creatorReferrerWallet, creatorReferrerBps, opponentReferrerWallet, opponentReferrerBps };
}

/**
 * A referrer's commission rate right now, in bps -- purely a function of
 * their own cumulative settled volume so far (0 if they've never settled a
 * duel, which still resolves to the bottom 1% tier -- see
 * referralTierBpsForVolume). Called at settlement-signing time
 * (lib/duelEngine.ts::maybeSettle) so the rate gets snapshotted into the
 * signed payload before it can drift.
 */
export async function currentReferrerBps(referrerWallet: string): Promise<number> {
    const account = await getOrCreateAccount(referrerWallet);
    return referralTierBpsForVolume(account.cumulativeSettledVolumeUsd);
}

/**
 * The full off-chain bookkeeping for one settled duel's referral
 * consequences, called from lib/duelEngine.ts::finalizeSettlement() once a
 * settlement is confirmed real. For each side (creator, opponent):
 *
 *  1. Bumps that player's own cumulative settled volume (their buyIn),
 *     which is what determines *their* tier the next time they refer
 *     someone -- win or lose, every settled bet counts as volume.
 *  2. Awards any newly-crossed volume-checkpoint points to that player
 *     (@mcapduel/points's REFERRAL_VOLUME_CHECKPOINTS), added to the same
 *     CombatRecord.totalPoints ledger combat points use.
 *  3. If that side had a referrer and paid them a nonzero commission
 *     on-chain (referrerBps > 0, matching what was actually signed and
 *     settled -- never recomputed here), credits the referrer's
 *     cumulative earnings and awards any newly-crossed earnings-checkpoint
 *     points to the referrer.
 *
 * `applyPoints` is injected rather than imported directly so this stays
 * decoupled from CombatRecord's own eligibility rules (opponent diversity
 * etc. don't apply to these checkpoint bonuses -- they're a flat award).
 */
export async function applyReferralSettlement(params: {
    creatorWallet: string;
    opponentWallet: string;
    buyInUsd: number;
    creatorReferrerWallet?: string;
    creatorReferrerBps: number;
    opponentReferrerWallet?: string;
    opponentReferrerBps: number;
    awardPoints: (wallet: string, points: number) => Promise<void>;
}): Promise<void> {
    await Promise.all([
        applyOneSide(params.creatorWallet, params.buyInUsd, params.creatorReferrerWallet, params.creatorReferrerBps, params.awardPoints),
        applyOneSide(params.opponentWallet, params.buyInUsd, params.opponentReferrerWallet, params.opponentReferrerBps, params.awardPoints),
    ]);
}

async function applyOneSide(
    playerWallet: string,
    buyInUsd: number,
    referrerWallet: string | undefined,
    referrerBps: number,
    awardPoints: (wallet: string, points: number) => Promise<void>
): Promise<void> {
    const playerAccount = await getOrCreateAccount(playerWallet);
    const previousVolume = playerAccount.cumulativeSettledVolumeUsd;
    const newVolume = previousVolume + buyInUsd;
    playerAccount.cumulativeSettledVolumeUsd = newVolume;
    await playerAccount.save();

    const volumeHits = crossedVolumeCheckpoints(previousVolume, newVolume, new Set(playerAccount.volumeCheckpointsHit));
    if (volumeHits.length > 0) {
        await ReferralAccount.updateOne(
            { wallet: playerWallet.toLowerCase() },
            { $addToSet: { volumeCheckpointsHit: { $each: volumeHits.map((h) => h.id) } } }
        );
        for (const hit of volumeHits) await awardPoints(playerWallet, hit.points);
    }

    if (!referrerWallet || referrerBps <= 0) return;
    const commissionUsd = (buyInUsd * referrerBps) / 10_000;

    const referrerAccount = await getOrCreateAccount(referrerWallet);
    const previousEarnings = referrerAccount.cumulativeReferralEarningsUsd;
    const newEarnings = previousEarnings + commissionUsd;
    referrerAccount.cumulativeReferralEarningsUsd = newEarnings;
    await referrerAccount.save();

    const earningsHits = crossedEarningsCheckpoints(previousEarnings, newEarnings, new Set(referrerAccount.earningsCheckpointsHit));
    if (earningsHits.length > 0) {
        await ReferralAccount.updateOne(
            { wallet: referrerWallet.toLowerCase() },
            { $addToSet: { earningsCheckpointsHit: { $each: earningsHits.map((h) => h.id) } } }
        );
        for (const hit of earningsHits) await awardPoints(referrerWallet, hit.points);
    }
}
