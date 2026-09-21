export const POINTS_CONFIG = {
  basePoints: 100,
  loserFlatRate: 0.25, // Section 07: loser earns a flat ~25% of the winner's base rate
  // Stake multiplier: linear in buy-in size, capped so one huge stake can't
  // dominate the points economy on its own.
  stakeMultiplierPer100Usd: 1,
  stakeMultiplierCap: 10,
  // Margin multiplier: rewards a bigger performance gap between the two sides.
  marginMultiplierCap: 3,
};

/**
 * Referral commission tiers: a referrer's rate on every settled bet made by
 * their direct referrals is driven entirely by the referrer's *own*
 * cumulative settled volume -- never by how much their referrals bet.
 * `minVolumeUsd` is exclusive (a referrer sitting exactly at a boundary
 * stays in the tier below it -- see referralEngine.ts's
 * referralTierBpsForVolume doc comment); the last entry has no ceiling. `bps` mirrors
 * Contracts/src/duel/BattleEscrow.sol's MAX_REFERRER_BPS -- the top tier here
 * (500) must never exceed that on-chain ceiling, since settle() enforces it
 * regardless of what this off-chain tier lookup produces.
 */
export const REFERRAL_TIER_CONFIG = {
  tiers: [
    { minVolumeUsd: 0, bps: 100 }, // 1%: $0–$100
    { minVolumeUsd: 100, bps: 200 }, // 2%: >$100–$500
    { minVolumeUsd: 500, bps: 300 }, // 3%: >$500–$1,000
    { minVolumeUsd: 1_000, bps: 400 }, // 4%: >$1,000–$2,000
    { minVolumeUsd: 2_000, bps: 500 }, // 5%: >$2,000 (spec's top bracket is "$2,000–$5,000"; held at 5% beyond that too)
  ],
  /** Must match BattleEscrow.sol's MAX_REFERRER_BPS exactly -- kept in sync by hand, same pattern as CombatRecordNFT's tierOf()/pointsEngine.ts's tierForPoints. */
  maxBps: 500,
};

/**
 * One-time point bonuses as a referred player's *own* cumulative settled bet
 * volume crosses each threshold -- awarded once per wallet, ever, tracked via
 * ReferralAccount.volumeCheckpointsHit (see lib/referralAccount.ts). Values
 * land in the same lifetime CombatRecord.totalPoints ledger that drives
 * CombatRecordNFT's tier -- see that contract's tierOf() doc comment for why
 * the tier thresholds were raised to accommodate numbers this size.
 */
export const REFERRAL_VOLUME_CHECKPOINTS: { volumeUsd: number; points: number }[] = [
  { volumeUsd: 50, points: 250 },
  { volumeUsd: 250, points: 2_500 },
  { volumeUsd: 750, points: 15_000 },
  { volumeUsd: 1_500, points: 45_000 },
  { volumeUsd: 3_000, points: 150_000 },
];

/**
 * One-time point bonuses as a referrer's cumulative referral *earnings* (real
 * dollars paid out to them via BattleEscrow.settle(), not volume) cross each
 * threshold -- same one-time-per-wallet tracking as the volume checkpoints
 * above, via ReferralAccount.earningsCheckpointsHit.
 */
export const REFERRAL_EARNINGS_CHECKPOINTS: { earningsUsd: number; points: number }[] = [
  { earningsUsd: 100, points: 10_000 },
  { earningsUsd: 200, points: 40_000 },
  { earningsUsd: 300, points: 90_000 },
  { earningsUsd: 400, points: 160_000 },
  { earningsUsd: 500, points: 250_000 },
];

export const OPPONENT_DIVERSITY_CONFIG = {
  // Section 07 hard rule: no single opponent may account for more than this
  // share of a wallet's points-eligible matches in the rolling window below.
  maxShareOfWindow: 0.2,
  rollingWindowSize: 50,
  // Below this many matches, the sample is too small for a share to mean
  // anything (a brand-new player's 1st match is trivially "100% vs one
  // opponent"). Below the threshold, everyone is eligible.
  minWindowSizeToEnforce: 5,
};
