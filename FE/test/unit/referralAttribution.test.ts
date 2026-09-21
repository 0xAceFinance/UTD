import { describe, it, expect, beforeEach } from 'vitest';
import WhitelistEntry from '@/lib/models/WhitelistEntry';
import { attributeReferral } from '@/lib/referralAttribution';
import { ensureDbConnected, clearDatabase } from '../helpers/db';

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
});

describe('attributeReferral', () => {
  it('creates a new WhitelistEntry for a first-seen wallet, with no referral code', async () => {
    await attributeReferral('0xNewWallet', undefined);

    const entry = await WhitelistEntry.findOne({ identifier: '0xnewwallet' });
    expect(entry).toBeTruthy();
    expect(entry?.kind).toBe('wallet');
    expect(entry?.walletVerified).toBe(true);
    expect(entry?.passNumber).toBe(0);
    expect(entry?.referralCode).toBeTruthy(); // always gets its own shareable code
    expect(entry?.referredBy).toBeUndefined();
  });

  it('attributes a first-seen wallet to the referrer that owns the given code', async () => {
    await WhitelistEntry.create({
      identifier: '0xreferrer',
      kind: 'wallet',
      passNumber: 0,
      walletVerified: true,
      referralCode: 'ABC1234',
    });

    await attributeReferral('0xnewwallet', 'ABC1234');

    const entry = await WhitelistEntry.findOne({ identifier: '0xnewwallet' });
    expect(entry?.referredBy).toBe('ABC1234');
  });

  it('ignores a referral code that does not resolve to anyone', async () => {
    await attributeReferral('0xnewwallet', 'GHOSTCODE');
    const entry = await WhitelistEntry.findOne({ identifier: '0xnewwallet' });
    expect(entry?.referredBy).toBeUndefined();
  });

  it('never lets a wallet refer itself, even if it somehow presents its own code', async () => {
    // Can't happen through normal attribution (a wallet doesn't know its own
    // code before its first entry exists), but the guard must hold anyway.
    await attributeReferral('0xnewwallet', undefined);
    const own = await WhitelistEntry.findOne({ identifier: '0xnewwallet' });
    await attributeReferral('0xnewwallet', own!.referralCode);

    const entry = await WhitelistEntry.findOne({ identifier: '0xnewwallet' });
    expect(entry?.referredBy).toBeUndefined();
  });

  it('is first-touch and permanent: an existing referredBy is never overwritten by a later call', async () => {
    await WhitelistEntry.create({
      identifier: '0xrefa',
      kind: 'wallet',
      passNumber: 0,
      walletVerified: true,
      referralCode: 'REFA0001',
    });
    await WhitelistEntry.create({
      identifier: '0xrefb',
      kind: 'wallet',
      passNumber: 0,
      walletVerified: true,
      referralCode: 'REFB0001',
    });

    await attributeReferral('0xplayer', 'REFA0001');
    await attributeReferral('0xplayer', 'REFB0001'); // a later duel with a different stored ref code

    const entry = await WhitelistEntry.findOne({ identifier: '0xplayer' });
    expect(entry?.referredBy).toBe('REFA0001');
  });

  it('backfills a referral code for a pre-existing entry that never had one (e.g. an old pass signup)', async () => {
    await WhitelistEntry.create({
      identifier: '0xoldsignup',
      kind: 'wallet',
      passNumber: 5,
      walletVerified: true,
      // no referralCode set -- simulates an entry created before referral attribution existed
    });
    await WhitelistEntry.create({
      identifier: '0xreferrer',
      kind: 'wallet',
      passNumber: 0,
      walletVerified: true,
      referralCode: 'REFX0001',
    });

    await attributeReferral('0xoldsignup', 'REFX0001');

    const entry = await WhitelistEntry.findOne({ identifier: '0xoldsignup' });
    expect(entry?.referredBy).toBe('REFX0001');
    expect(entry?.referralCode).toBeTruthy();
  });

  it('silently ignores a malformed ref code (never throws, never blocks the caller)', async () => {
    await expect(attributeReferral('0xplayer', 'not a valid code!!')).resolves.toBeUndefined();
    const entry = await WhitelistEntry.findOne({ identifier: '0xplayer' });
    expect(entry?.referredBy).toBeUndefined();
  });

  it('is case-insensitive and trims to a lowercase identifier', async () => {
    await attributeReferral('0xMixedCaseWallet', undefined);
    const entry = await WhitelistEntry.findOne({ identifier: '0xmixedcasewallet' });
    expect(entry).toBeTruthy();
  });

  it('two different wallets each get their own unique referral code', async () => {
    await attributeReferral('0xwalletone', undefined);
    await attributeReferral('0xwallettwo', undefined);
    const one = await WhitelistEntry.findOne({ identifier: '0xwalletone' });
    const two = await WhitelistEntry.findOne({ identifier: '0xwallettwo' });
    expect(one?.referralCode).not.toBe(two?.referralCode);
  });
});
