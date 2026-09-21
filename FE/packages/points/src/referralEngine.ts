import { REFERRAL_TIER_CONFIG, REFERRAL_VOLUME_CHECKPOINTS, REFERRAL_EARNINGS_CHECKPOINTS } from "./config.js";

/**
 * A referrer's current commission rate, in bps, purely as a function of
 * their own cumulative settled volume (never their referrals' volume) --
 * see REFERRAL_TIER_CONFIG. Crossing a threshold takes effect for the
 * *next* settled bet; it never reprices one already settled (callers pass
 * the volume as it stood right before the bet being settled now, not after).
 *
 * Boundaries are exclusive on the low end, per spec: "$0–$100 → 1%",
 * ">$100–$500 → 2%" -- a referrer sitting at exactly $100 of their own
 * volume is still 1%; only volume strictly above $100 promotes them to 2%.
 */
export function referralTierBpsForVolume(cumulativeVolumeUsd: number): number {
  const { tiers } = REFERRAL_TIER_CONFIG;
  let bps = tiers[0].bps;
  for (const tier of tiers) {
    if (cumulativeVolumeUsd > tier.minVolumeUsd) bps = tier.bps;
  }
  return Math.min(bps, REFERRAL_TIER_CONFIG.maxBps);
}

/** Generic one-time-per-wallet checkpoint crossing: returns every checkpoint whose threshold
 * lies in (previousTotal, newTotal] that isn't already in `alreadyHit`, in ascending order. */
function crossedCheckpoints<T extends { points: number }>(
  checkpoints: T[],
  thresholdOf: (c: T) => number,
  idOf: (c: T) => string,
  previousTotal: number,
  newTotal: number,
  alreadyHit: ReadonlySet<string>
): { id: string; points: number }[] {
  if (newTotal <= previousTotal) return [];
  return checkpoints
    .filter((c) => thresholdOf(c) > previousTotal && thresholdOf(c) <= newTotal && !alreadyHit.has(idOf(c)))
    .map((c) => ({ id: idOf(c), points: c.points }));
}

/** Stable, threshold-derived id so "already awarded" tracking doesn't depend on array position. */
function volumeCheckpointId(volumeUsd: number): string {
  return `volume:${volumeUsd}`;
}
function earningsCheckpointId(earningsUsd: number): string {
  return `earnings:${earningsUsd}`;
}

/**
 * Volume checkpoints a referred player just crossed by settling a bet that
 * took their cumulative settled volume from `previousVolumeUsd` to
 * `newVolumeUsd` -- each fires at most once per wallet, ever (checked against
 * `alreadyHit`, that wallet's ReferralAccount.volumeCheckpointsHit).
 */
export function crossedVolumeCheckpoints(
  previousVolumeUsd: number,
  newVolumeUsd: number,
  alreadyHit: ReadonlySet<string>
): { id: string; points: number }[] {
  return crossedCheckpoints(
    REFERRAL_VOLUME_CHECKPOINTS,
    (c) => c.volumeUsd,
    (c) => volumeCheckpointId(c.volumeUsd),
    previousVolumeUsd,
    newVolumeUsd,
    alreadyHit
  );
}

/**
 * Earnings checkpoints a referrer just crossed by being credited a
 * commission that took their cumulative referral earnings from
 * `previousEarningsUsd` to `newEarningsUsd` -- same one-time-per-wallet
 * semantics as crossedVolumeCheckpoints, against that wallet's
 * ReferralAccount.earningsCheckpointsHit.
 */
export function crossedEarningsCheckpoints(
  previousEarningsUsd: number,
  newEarningsUsd: number,
  alreadyHit: ReadonlySet<string>
): { id: string; points: number }[] {
  return crossedCheckpoints(
    REFERRAL_EARNINGS_CHECKPOINTS,
    (c) => c.earningsUsd,
    (c) => earningsCheckpointId(c.earningsUsd),
    previousEarningsUsd,
    newEarningsUsd,
    alreadyHit
  );
}
