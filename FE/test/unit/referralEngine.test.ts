import { describe, it, expect } from 'vitest';
import {
  referralTierBpsForVolume,
  crossedVolumeCheckpoints,
  crossedEarningsCheckpoints,
  tierForPoints,
  REFERRAL_TIER_CONFIG,
  REFERRAL_VOLUME_CHECKPOINTS,
  REFERRAL_EARNINGS_CHECKPOINTS,
} from '@mcapduel/points';

// Pure-logic coverage for the two ladders the whole referral system is built
// on: a referrer's own volume decides their commission rate
// (referralTierBpsForVolume), and one-time point bonuses fire exactly once
// as volume/earnings cross fixed thresholds (crossed*Checkpoints). Nothing
// here touches the database -- lib/referralAccount.ts's tests cover how
// these get wired into real settlement bookkeeping.
describe('referralTierBpsForVolume', () => {
  it('starts every referrer at the bottom tier with zero volume', () => {
    expect(referralTierBpsForVolume(0)).toBe(100);
  });

  it('boundaries are exclusive on the low end -- sitting exactly at a threshold does not promote yet', () => {
    expect(referralTierBpsForVolume(100)).toBe(100); // still 1%, per spec
    expect(referralTierBpsForVolume(100.01)).toBe(200); // now over $100 -> 2%
    expect(referralTierBpsForVolume(500)).toBe(200);
    expect(referralTierBpsForVolume(500.01)).toBe(300);
    expect(referralTierBpsForVolume(1_000)).toBe(300);
    expect(referralTierBpsForVolume(1_000.01)).toBe(400);
    expect(referralTierBpsForVolume(2_000)).toBe(400);
    expect(referralTierBpsForVolume(2_000.01)).toBe(500);
  });

  it('never exceeds maxBps, however large the volume', () => {
    expect(referralTierBpsForVolume(1_000_000)).toBe(REFERRAL_TIER_CONFIG.maxBps);
  });

  it('top tier bps mirrors BattleEscrow.sol\'s on-chain MAX_REFERRER_BPS cap (500 = 5%)', () => {
    // This is a "kept in sync by hand" invariant (see config.ts's own
    // comment) -- if it ever drifts, settle() would silently clamp real
    // commissions below what this off-chain tier table promises referrers.
    expect(REFERRAL_TIER_CONFIG.maxBps).toBe(500);
  });
});

describe('crossedVolumeCheckpoints', () => {
  it('fires every checkpoint strictly between previous and new totals', () => {
    const hits = crossedVolumeCheckpoints(0, 1000, new Set());
    expect(hits.map((h) => h.id)).toEqual(['volume:50', 'volume:250', 'volume:750']);
  });

  it('fires nothing when the total does not move', () => {
    expect(crossedVolumeCheckpoints(500, 500, new Set())).toEqual([]);
  });

  it('fires nothing when the total moves backward (should never happen, but must not fire)', () => {
    expect(crossedVolumeCheckpoints(1000, 500, new Set())).toEqual([]);
  });

  it('skips a checkpoint already recorded as hit, even though it is back in range', () => {
    const hits = crossedVolumeCheckpoints(0, 1000, new Set(['volume:50']));
    expect(hits.map((h) => h.id)).toEqual(['volume:250', 'volume:750']);
  });

  it('a threshold crossed exactly on the new total counts (inclusive upper bound)', () => {
    const hits = crossedVolumeCheckpoints(0, 50, new Set());
    expect(hits.map((h) => h.id)).toEqual(['volume:50']);
  });

  it('a threshold sitting exactly on the previous total does not re-fire', () => {
    const hits = crossedVolumeCheckpoints(50, 100, new Set());
    expect(hits.map((h) => h.id)).toEqual([]);
  });

  it('carries the correct point payout for each checkpoint', () => {
    const hits = crossedVolumeCheckpoints(0, 50, new Set());
    expect(hits).toEqual([{ id: 'volume:50', points: 250 }]);
  });

  it('the top checkpoint stays within CombatRecordNFT.sol\'s raised Diamond threshold on its own', () => {
    // A single top-tier volume checkpoint (150,000 pts) must never alone
    // exceed the Diamond tier ceiling -- see pointsEngine.ts's TIER_THRESHOLDS
    // doc comment on why the tiers were raised in the first place.
    const top = REFERRAL_VOLUME_CHECKPOINTS[REFERRAL_VOLUME_CHECKPOINTS.length - 1];
    expect(top.points).toBeLessThan(500_000);
  });
});

describe('crossedEarningsCheckpoints', () => {
  it('fires every checkpoint strictly between previous and new totals', () => {
    const hits = crossedEarningsCheckpoints(0, 250, new Set());
    expect(hits.map((h) => h.id)).toEqual(['earnings:100', 'earnings:200']);
  });

  it('respects alreadyHit independently from the volume ladder (different id namespace)', () => {
    // "volume:100" being hit must never suppress "earnings:100" -- they're
    // unrelated ladders that happen to share a numeric threshold.
    const hits = crossedEarningsCheckpoints(0, 100, new Set(['volume:100']));
    expect(hits.map((h) => h.id)).toEqual(['earnings:100']);
  });

  it('carries the correct point payout for the top checkpoint', () => {
    const hits = crossedEarningsCheckpoints(400, 500, new Set());
    expect(hits).toEqual([{ id: 'earnings:500', points: 250_000 }]);
  });
});

describe('tierForPoints (CombatRecordNFT.sol tierOf() parity)', () => {
  it('exact boundaries match the raised thresholds', () => {
    expect(tierForPoints(0)).toBe('Bronze');
    expect(tierForPoints(14_999)).toBe('Bronze');
    expect(tierForPoints(15_000)).toBe('Silver');
    expect(tierForPoints(99_999)).toBe('Silver');
    expect(tierForPoints(100_000)).toBe('Gold');
    expect(tierForPoints(499_999)).toBe('Gold');
    expect(tierForPoints(500_000)).toBe('Diamond');
  });
});
