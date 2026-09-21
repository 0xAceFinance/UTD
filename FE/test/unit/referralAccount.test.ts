import { describe, it, expect, beforeEach, vi } from 'vitest';
import WhitelistEntry from '@/lib/models/WhitelistEntry';
import ReferralAccount from '@/lib/models/ReferralAccount';
import {
  getReferrerWallet,
  currentReferrerBps,
  computeReferralSnapshot,
  applyReferralSettlement,
} from '@/lib/referralAccount';
import { ensureDbConnected, clearDatabase } from '../helpers/db';

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
});

async function seedEntry(identifier: string, overrides: Partial<{ referralCode: string; referredBy: string }> = {}) {
  return WhitelistEntry.create({
    identifier: identifier.toLowerCase(),
    kind: 'wallet',
    passNumber: 0,
    walletVerified: true,
    referralCode: overrides.referralCode,
    referredBy: overrides.referredBy,
  });
}

describe('getReferrerWallet', () => {
  it('returns undefined for a wallet with no WhitelistEntry at all', async () => {
    expect(await getReferrerWallet('0xnobody')).toBeUndefined();
  });

  it('returns undefined when the wallet has an entry but was never referred', async () => {
    await seedEntry('0xplayer');
    expect(await getReferrerWallet('0xplayer')).toBeUndefined();
  });

  it('returns undefined when referredBy points at a code nobody owns (deleted/typo)', async () => {
    await seedEntry('0xplayer', { referredBy: 'GHOSTCODE' });
    expect(await getReferrerWallet('0xplayer')).toBeUndefined();
  });

  it('resolves the referrer wallet through the referral code, case-insensitively', async () => {
    await seedEntry('0xReferrer', { referralCode: 'ABC1234' });
    await seedEntry('0xPlayer', { referredBy: 'ABC1234' });
    expect(await getReferrerWallet('0XPLAYER')).toBe('0xreferrer');
  });

  it('never resolves a wallet as its own referrer, even if the data says so', async () => {
    // Should never happen given how referredBy is set, but getReferrerWallet
    // must not trust it blindly -- see its own doc comment.
    await seedEntry('0xself', { referralCode: 'SELF001', referredBy: 'SELF001' });
    expect(await getReferrerWallet('0xself')).toBeUndefined();
  });
});

describe('currentReferrerBps', () => {
  it('defaults to the bottom tier (100 bps) for a wallet with no ReferralAccount yet', async () => {
    expect(await currentReferrerBps('0xfresh')).toBe(100);
  });

  it('reflects the wallet\'s own cumulative settled volume', async () => {
    await ReferralAccount.create({ wallet: '0xveteran', cumulativeSettledVolumeUsd: 2_500 });
    expect(await currentReferrerBps('0xveteran')).toBe(500); // top tier, > $2,000
  });
});

describe('computeReferralSnapshot', () => {
  it('returns zeroed/undefined for both sides when neither was referred', async () => {
    const snap = await computeReferralSnapshot('0xcreator', '0xopponent');
    expect(snap).toEqual({
      creatorReferrerWallet: undefined,
      creatorReferrerBps: 0,
      opponentReferrerWallet: undefined,
      opponentReferrerBps: 0,
    });
  });

  it('resolves each side independently, at each referrer\'s own current tier', async () => {
    await seedEntry('0xrefa', { referralCode: 'REFA001' });
    await seedEntry('0xrefb', { referralCode: 'REFB001' });
    await seedEntry('0xcreator', { referredBy: 'REFA001' });
    await seedEntry('0xopponent', { referredBy: 'REFB001' });
    await ReferralAccount.create({ wallet: '0xrefa', cumulativeSettledVolumeUsd: 0 }); // bottom tier
    await ReferralAccount.create({ wallet: '0xrefb', cumulativeSettledVolumeUsd: 5_000 }); // top tier

    const snap = await computeReferralSnapshot('0xcreator', '0xopponent');
    expect(snap.creatorReferrerWallet).toBe('0xrefa');
    expect(snap.creatorReferrerBps).toBe(100);
    expect(snap.opponentReferrerWallet).toBe('0xrefb');
    expect(snap.opponentReferrerBps).toBe(500);
  });
});

describe('applyReferralSettlement', () => {
  it('bumps each player\'s own cumulative settled volume by the buy-in, regardless of a referrer', async () => {
    const awardPoints = vi.fn(async () => {});
    await applyReferralSettlement({
      creatorWallet: '0xcreator',
      opponentWallet: '0xopponent',
      buyInUsd: 40,
      creatorReferrerBps: 0,
      opponentReferrerBps: 0,
      awardPoints,
    });

    const creatorAcct = await ReferralAccount.findOne({ wallet: '0xcreator' });
    const opponentAcct = await ReferralAccount.findOne({ wallet: '0xopponent' });
    expect(creatorAcct?.cumulativeSettledVolumeUsd).toBe(40);
    expect(opponentAcct?.cumulativeSettledVolumeUsd).toBe(40);
  });

  it('awards a volume checkpoint exactly once when a player\'s own volume crosses it, never again on a later settlement', async () => {
    const awardPoints = vi.fn(async () => {});
    // First bet: 0 -> 50, crosses the $50 checkpoint (250 pts).
    await applyReferralSettlement({
      creatorWallet: '0xplayer',
      opponentWallet: '0xrival',
      buyInUsd: 50,
      creatorReferrerBps: 0,
      opponentReferrerBps: 0,
      awardPoints,
    });
    expect(awardPoints).toHaveBeenCalledWith('0xplayer', 250);
    awardPoints.mockClear();

    // Second bet: 50 -> 60, doesn't cross another checkpoint (next is $250).
    await applyReferralSettlement({
      creatorWallet: '0xplayer',
      opponentWallet: '0xrival',
      buyInUsd: 10,
      creatorReferrerBps: 0,
      opponentReferrerBps: 0,
      awardPoints,
    });
    expect(awardPoints).not.toHaveBeenCalledWith('0xplayer', 250);

    const acct = await ReferralAccount.findOne({ wallet: '0xplayer' });
    expect(acct?.volumeCheckpointsHit).toEqual(['volume:50']);
  });

  it('credits the referrer\'s earnings and never touches the referred player\'s own earnings', async () => {
    const awardPoints = vi.fn(async () => {});
    await applyReferralSettlement({
      creatorWallet: '0xplayer',
      opponentWallet: '0xrival',
      buyInUsd: 200,
      creatorReferrerWallet: '0xreferrer',
      creatorReferrerBps: 200, // 2%
      opponentReferrerBps: 0,
      awardPoints,
    });

    const referrerAcct = await ReferralAccount.findOne({ wallet: '0xreferrer' });
    expect(referrerAcct?.cumulativeReferralEarningsUsd).toBe(4); // 200 * 200bps / 10000

    const playerAcct = await ReferralAccount.findOne({ wallet: '0xplayer' });
    expect(playerAcct?.cumulativeReferralEarningsUsd).toBe(0);
  });

  it('never credits a referrer when referrerBps is 0, even if a referrer wallet is set (matches nothing paid on-chain)', async () => {
    const awardPoints = vi.fn(async () => {});
    await applyReferralSettlement({
      creatorWallet: '0xplayer',
      opponentWallet: '0xrival',
      buyInUsd: 200,
      creatorReferrerWallet: '0xreferrer',
      creatorReferrerBps: 0,
      opponentReferrerBps: 0,
      awardPoints,
    });

    const referrerAcct = await ReferralAccount.findOne({ wallet: '0xreferrer' });
    expect(referrerAcct).toBeNull();
  });

  it('awards an earnings checkpoint exactly once as the referrer\'s cumulative earnings cross it', async () => {
    const awardPoints = vi.fn(async () => {});
    // $5,000 buy-in at 2% = $100 commission -- lands exactly on the first earnings checkpoint.
    await applyReferralSettlement({
      creatorWallet: '0xplayer',
      opponentWallet: '0xrival',
      buyInUsd: 5_000,
      creatorReferrerWallet: '0xreferrer',
      creatorReferrerBps: 200,
      opponentReferrerBps: 0,
      awardPoints,
    });
    expect(awardPoints).toHaveBeenCalledWith('0xreferrer', 10_000);

    const acct = await ReferralAccount.findOne({ wallet: '0xreferrer' });
    expect(acct?.earningsCheckpointsHit).toEqual(['earnings:100']);
  });

  it('processes both sides of one duel independently -- each side\'s own referrer only sees that side\'s volume', async () => {
    const awardPoints = vi.fn(async () => {});
    await applyReferralSettlement({
      creatorWallet: '0xcreator',
      opponentWallet: '0xopponent',
      buyInUsd: 100,
      creatorReferrerWallet: '0xrefa',
      creatorReferrerBps: 100,
      opponentReferrerWallet: '0xrefb',
      opponentReferrerBps: 500,
      awardPoints,
    });

    const refa = await ReferralAccount.findOne({ wallet: '0xrefa' });
    const refb = await ReferralAccount.findOne({ wallet: '0xrefb' });
    expect(refa?.cumulativeReferralEarningsUsd).toBe(1); // 100 * 100bps / 10000
    expect(refb?.cumulativeReferralEarningsUsd).toBe(5); // 100 * 500bps / 10000
  });
});
