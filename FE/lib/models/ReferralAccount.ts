import { Schema, Document, model, models } from 'mongoose';

/**
 * Per-wallet referral state: a wallet's own cumulative settled volume (which
 * drives the commission tier it earns as a *referrer* -- see
 * @mcapduel/points's referralTierBpsForVolume) and its cumulative referral
 * earnings (real dollars credited via BattleEscrow.settle()'s referrerA/B
 * payout, which drive the separate earnings-checkpoint points ladder).
 *
 * Every wallet that has ever settled a duel gets one of these, whether or
 * not it has ever referred anyone -- volume tracking has to start somewhere,
 * and a wallet's tier must be known before its first referral commission is
 * computed. checkpointsHit records are permanent: a checkpoint fires at most
 * once per wallet, ever (lib/referralAccount.ts).
 */
export interface IReferralAccount extends Document {
    wallet: string;
    /** This wallet's own lifetime settled duel volume (its buyIn on every settled duel, win or lose) -- drives referralTierBpsForVolume. */
    cumulativeSettledVolumeUsd: number;
    /** Real dollars this wallet has been credited as a referrer, via BattleEscrow.settle()'s referrerA/B payout. */
    cumulativeReferralEarningsUsd: number;
    /** Ids from @mcapduel/points's crossedVolumeCheckpoints, e.g. "volume:50" -- each fires once, ever. */
    volumeCheckpointsHit: string[];
    /** Ids from @mcapduel/points's crossedEarningsCheckpoints, e.g. "earnings:100" -- each fires once, ever. */
    earningsCheckpointsHit: string[];
}

const ReferralAccountSchema = new Schema<IReferralAccount>({
    wallet: { type: String, required: true, unique: true, lowercase: true, index: true },
    cumulativeSettledVolumeUsd: { type: Number, default: 0 },
    cumulativeReferralEarningsUsd: { type: Number, default: 0 },
    volumeCheckpointsHit: { type: [String], default: [] },
    earningsCheckpointsHit: { type: [String], default: [] },
});

export default models.ReferralAccount || model<IReferralAccount>('ReferralAccount', ReferralAccountSchema);
