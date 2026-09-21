import { describe, it, expect, beforeEach } from 'vitest';
import { GET as referralsRoute } from '@/app/api/referrals/[wallet]/route';
import WhitelistEntry from '@/lib/models/WhitelistEntry';
import ReferralAccount from '@/lib/models/ReferralAccount';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuel } from '../helpers/duelFixtures';
import { getReq, body } from '../helpers/http';

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
});

async function call(wallet: string) {
  const res = await referralsRoute(getReq(`http://localhost/api/referrals/${wallet}`), {
    params: Promise.resolve({ wallet }),
  });
  return { res, data: (await body(res)).data };
}

describe('GET /api/referrals/[wallet]', () => {
  it('returns safe zeroed defaults for a wallet nobody has ever seen', async () => {
    const { res, data } = await call('0xbrandnew');
    expect(res.status).toBe(200);
    expect(data.referralCode).toBeNull();
    expect(data.referredByWallet).toBeNull();
    expect(data.referredCount).toBe(0);
    expect(data.tier).toEqual({ bps: 100, volumeUsd: 0, nextBps: 200, nextThresholdUsd: 100, maxBps: 500 });
    expect(data.earningsUsd).toBe(0);
    expect(data.recentReferrals).toEqual([]);
    expect(data.recentCommissions).toEqual([]);
    expect(data.volumeCheckpoints).toHaveLength(5);
    expect(data.volumeCheckpoints.every((c: { hit: boolean }) => c.hit === false)).toBe(true);
  });

  it('surfaces the wallet\'s own referral code and who referred it', async () => {
    await WhitelistEntry.create({
      identifier: '0xupline',
      kind: 'wallet',
      passNumber: 0,
      walletVerified: true,
      referralCode: 'UPLINE01',
    });
    await WhitelistEntry.create({
      identifier: '0xplayer',
      kind: 'wallet',
      passNumber: 0,
      walletVerified: true,
      referralCode: 'PLAYER01',
      referredBy: 'UPLINE01',
    });

    const { data } = await call('0xplayer');
    expect(data.referralCode).toBe('PLAYER01');
    expect(data.referredByWallet).toBe('0xupline');
  });

  it('counts only verified, non-sybil-flagged referrals toward referredCount', async () => {
    await WhitelistEntry.create({
      identifier: '0xreferrer',
      kind: 'wallet',
      passNumber: 0,
      walletVerified: true,
      referralCode: 'REFCODE1',
    });
    await WhitelistEntry.create({ identifier: '0xverified', kind: 'wallet', passNumber: 0, walletVerified: true, referredBy: 'REFCODE1' });
    await WhitelistEntry.create({ identifier: '0xunverified', kind: 'wallet', passNumber: 0, walletVerified: false, referredBy: 'REFCODE1' });
    await WhitelistEntry.create({ identifier: '0xsybil', kind: 'wallet', passNumber: 0, walletVerified: true, referredBy: 'REFCODE1', referralSybilFlagged: true });

    const { data } = await call('0xreferrer');
    expect(data.referredCount).toBe(1);
    // But the recent-referrals list itself is unfiltered -- the dashboard
    // shows every referral with its real status (PENDING/FLAGGED/VERIFIED),
    // it just doesn't count the non-qualifying ones toward the headline number.
    expect(data.recentReferrals).toHaveLength(3);
    const flagged = data.recentReferrals.find((r: { wallet: string }) => r.wallet === '0xsybil');
    expect(flagged.sybilFlagged).toBe(true);
    const unverified = data.recentReferrals.find((r: { wallet: string }) => r.wallet === '0xunverified');
    expect(unverified.verified).toBe(false);
  });

  it('reports the referrer\'s live commission tier and the volume needed for the next one', async () => {
    await ReferralAccount.create({ wallet: '0xgrowing', cumulativeSettledVolumeUsd: 600 });
    const { data } = await call('0xgrowing');
    expect(data.tier.bps).toBe(300); // > $500
    expect(data.tier.volumeUsd).toBe(600);
    expect(data.tier.nextBps).toBe(400);
    expect(data.tier.nextThresholdUsd).toBe(1_000);
  });

  it('reports no next tier once at the top', async () => {
    await ReferralAccount.create({ wallet: '0xmaxed', cumulativeSettledVolumeUsd: 10_000 });
    const { data } = await call('0xmaxed');
    expect(data.tier.bps).toBe(500);
    expect(data.tier.nextBps).toBeNull();
    expect(data.tier.nextThresholdUsd).toBeNull();
  });

  it('marks checkpoints as hit once recorded on the ReferralAccount', async () => {
    await ReferralAccount.create({
      wallet: '0xearner',
      cumulativeReferralEarningsUsd: 150,
      earningsCheckpointsHit: ['earnings:100'],
    });
    const { data } = await call('0xearner');
    const hit = data.earningsCheckpoints.find((c: { thresholdUsd: number }) => c.thresholdUsd === 100);
    const notHit = data.earningsCheckpoints.find((c: { thresholdUsd: number }) => c.thresholdUsd === 200);
    expect(hit.hit).toBe(true);
    expect(notHit.hit).toBe(false);
  });

  it('lists commissions only from SETTLED duels where this wallet was the paid referrer, on whichever side', async () => {
    // Paid on the creator side.
    await createDuel({
      status: 'SETTLED',
      creatorWallet: '0xcreator1',
      opponentWallet: '0xopponent1',
      buyInUsd: 200,
      creatorReferrerWallet: '0xreferrer',
      creatorReferrerBps: 300,
      endTime: new Date('2026-01-01'),
      tokenA: { symbol: 'FOO' },
      tokenB: { symbol: 'BAR' },
    });
    // Paid on the opponent side of a different duel.
    await createDuel({
      status: 'SETTLED',
      creatorWallet: '0xcreator2',
      opponentWallet: '0xopponent2',
      buyInUsd: 100,
      opponentReferrerWallet: '0xreferrer',
      opponentReferrerBps: 200,
      endTime: new Date('2026-01-02'),
      tokenA: { symbol: 'BAZ' },
      tokenB: { symbol: 'QUX' },
    });
    // Not this wallet's referral -- must not show up.
    await createDuel({
      status: 'SETTLED',
      creatorReferrerWallet: '0xsomeoneelse',
      creatorReferrerBps: 500,
      endTime: new Date('2026-01-03'),
    });
    // Same wallet as referrer, but bps is 0 (nothing was actually paid on-chain) -- must not show up.
    await createDuel({
      status: 'SETTLED',
      creatorReferrerWallet: '0xreferrer',
      creatorReferrerBps: 0,
      endTime: new Date('2026-01-04'),
    });
    // Referrer set on an OPEN (not yet settled) duel -- must not show up.
    await createDuel({
      status: 'OPEN',
      creatorReferrerWallet: '0xreferrer',
      creatorReferrerBps: 300,
    });

    const { data } = await call('0xreferrer');
    expect(data.recentCommissions).toHaveLength(2);

    const fromCreatorSide = data.recentCommissions.find((c: { referredWallet: string }) => c.referredWallet === '0xcreator1');
    expect(fromCreatorSide.matchup).toBe('FOO vs BAR');
    expect(fromCreatorSide.buyInUsd).toBe(200);
    expect(fromCreatorSide.bps).toBe(300);
    expect(fromCreatorSide.commissionUsd).toBe(6); // 200 * 300bps / 10000

    const fromOpponentSide = data.recentCommissions.find((c: { referredWallet: string }) => c.referredWallet === '0xopponent2');
    expect(fromOpponentSide.matchup).toBe('BAZ vs QUX');
    expect(fromOpponentSide.commissionUsd).toBe(2); // 100 * 200bps / 10000
  });

  it('is case-insensitive on the wallet path param', async () => {
    await WhitelistEntry.create({
      identifier: '0xmixedcase',
      kind: 'wallet',
      passNumber: 0,
      walletVerified: true,
      referralCode: 'MIXED001',
    });
    const { data } = await call('0xMixedCase');
    expect(data.referralCode).toBe('MIXED001');
  });
});
