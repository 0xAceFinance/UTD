import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';

const chainVerifyMocks = vi.hoisted(() => ({
  verifyDuelVoided: vi.fn(),
}));
vi.mock('@/lib/chainVerify', () => chainVerifyMocks);

import { POST as resolveRoute } from '@/app/api/admin/duels/[id]/resolve/route';
import { POST as confirmVoidRoute } from '@/app/api/admin/duels/[id]/confirm-void/route';
import Duel from '@/lib/models/Duel';
import CombatRecord from '@/lib/models/CombatRecord';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuel, makeTokenSide } from '../helpers/duelFixtures';
import { postJson, body } from '../helpers/http';

const CREATOR = '0xheldcreator000000000000000000000000001';
const OPPONENT = '0xheldopponent00000000000000000000000001';
const ESCROW = '0x1000000000000000000000000000000000000099';
const ADMIN_HEADERS = { 'x-admin-secret': 'test-admin-secret' };

/**
 * A HELD duel is already past its LIVE ticking -- computeWinnerSide reads
 * the already-locked-in sustainedPeakMarketCapUsd directly (no more
 * refreshSide calls happen for a non-LIVE duel), so these fixtures set it
 * directly rather than relying on raw samples being reprocessed. Side B is
 * built to have won (gives computeWinnerSide a deterministic answer of 1).
 */
function flatSide(tokenAddress: string) {
  return makeTokenSide({ tokenAddress, startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_000_000 });
}
function pumpingSide(tokenAddress: string) {
  return makeTokenSide({ tokenAddress, startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_500_000 });
}

async function createHeldDuel(overrides: { escrowAddress?: string; buyInUsd?: number } = {}) {
  return createDuel({
    status: 'HELD',
    creatorWallet: CREATOR,
    opponentWallet: OPPONENT,
    creatorSide: 0,
    buyInUsd: overrides.buyInUsd ?? 200,
    escrowAddress: overrides.escrowAddress,
    flaggedSybil: true,
    startTime: new Date(Date.now() - 10_000_000),
    endTime: new Date(Date.now() - 1_000),
    tokenA: flatSide('0xheldAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'),
    tokenB: pumpingSide('0xheldBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'),
  });
}

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  vi.clearAllMocks();
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('admin HELD recovery: authorization', () => {
  it('rejects a request with no admin secret header', async () => {
    const duel = await createHeldDuel();
    const res = await resolveRoute(postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'void' }), {
      params: Promise.resolve({ id: String(duel._id) }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong admin secret', async () => {
    const duel = await createHeldDuel();
    const res = await resolveRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'void' }, { 'x-admin-secret': 'wrong' }),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    expect(res.status).toBe(401);
  });
});

describe('admin HELD recovery: legacy off-chain duel (no escrowAddress)', () => {
  it('action "confirm" settles immediately and awards points', async () => {
    const duel = await createHeldDuel();
    const res = await resolveRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'confirm' }, ADMIN_HEADERS),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    const json = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(json.status).toBe('SETTLED');
    expect(json.winnerSide).toBe(1);
    expect(json.winnerPoints).toBeGreaterThan(0);

    const winnerRecord = await CombatRecord.findOne({ wallet: OPPONENT.toLowerCase() });
    expect(winnerRecord?.wins).toBe(1);
  });

  it('action "void" cancels immediately with no points awarded', async () => {
    const duel = await createHeldDuel();
    const res = await resolveRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'void' }, ADMIN_HEADERS),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    const json = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(json.status).toBe('CANCELLED');

    const anyRecord = await CombatRecord.findOne({ wallet: OPPONENT.toLowerCase() });
    expect(anyRecord).toBeNull();
  });
});

describe('admin HELD recovery: on-chain duel', () => {
  it('action "confirm" signs settlement and moves to SETTLING, awaiting the normal confirm-settlement flow', async () => {
    const duel = await createHeldDuel({ escrowAddress: ESCROW });
    const res = await resolveRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'confirm' }, ADMIN_HEADERS),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    const json = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(json.status).toBe('SETTLING');
    expect(json.winnerSide).toBe(1);
    expect(json.oracleSignature).toBeTruthy();
    // Points must NOT be awarded yet -- same invariant as the ordinary path,
    // they wait for confirm-settlement to verify the real on-chain tx.
    expect(json.winnerPoints).toBeUndefined();
  });

  it('action "void" signs a void refund but stays HELD until confirm-void verifies the on-chain tx', async () => {
    const duel = await createHeldDuel({ escrowAddress: ESCROW });
    const res = await resolveRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'void' }, ADMIN_HEADERS),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    const json = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(json.status).toBe('HELD');
    expect(json.oracleSignature).toBeTruthy();
  });

  it('confirm-void verifies the real Voided event before moving to CANCELLED', async () => {
    const duel = await createHeldDuel({ escrowAddress: ESCROW });
    await resolveRoute(postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'void' }, ADMIN_HEADERS), {
      params: Promise.resolve({ id: String(duel._id) }),
    });

    chainVerifyMocks.verifyDuelVoided.mockResolvedValue(undefined);
    const res = await confirmVoidRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/confirm-void`, { txHash: '0x' + 'dd'.repeat(32) }, ADMIN_HEADERS),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    const json = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(json.status).toBe('CANCELLED');
    expect(chainVerifyMocks.verifyDuelVoided).toHaveBeenCalledWith(expect.any(String), ESCROW);

    const record = await CombatRecord.findOne({ wallet: OPPONENT.toLowerCase() });
    expect(record).toBeNull();
  });

  it('confirm-void with a tampered/wrong txHash leaves the duel HELD, unchanged', async () => {
    const duel = await createHeldDuel({ escrowAddress: ESCROW });
    await resolveRoute(postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'void' }, ADMIN_HEADERS), {
      params: Promise.resolve({ id: String(duel._id) }),
    });

    chainVerifyMocks.verifyDuelVoided.mockRejectedValue(new Error('Voided event not found for this duel in that transaction.'));
    const res = await confirmVoidRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/confirm-void`, { txHash: '0x' + 'badbad'.repeat(10) }, ADMIN_HEADERS),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    expect(res.status).toBe(400);

    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('HELD');
  });
});

describe('admin HELD recovery: one resolution per duel', () => {
  const resolve = (id: string, action: string) =>
    resolveRoute(postJson(`http://localhost/api/admin/duels/${id}/resolve`, { action }, ADMIN_HEADERS), {
      params: Promise.resolve({ id }),
    });

  it('MONEY SAFETY: void then confirm -- the confirm is rejected and never returns or stores a settle signature', async () => {
    const duel = await createHeldDuel({ escrowAddress: ESCROW });
    const id = String(duel._id);

    const voidRes = await resolve(id, 'void');
    expect(voidRes.status).toBe(200);
    const voidSignature = (await body(voidRes)).data.oracleSignature;
    expect(voidSignature).toBeTruthy();

    const confirmRes = await resolve(id, 'confirm');
    expect(confirmRes.status).toBe(409);
    const confirmJson = await body(confirmRes);
    expect(confirmJson.error).toBe('a resolution was already signed for this duel');
    expect(JSON.stringify(confirmJson)).not.toMatch(/0x[0-9a-f]{130}/i); // no signature leaked

    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('HELD');
    expect(reloaded?.oracleSignature).toBe(voidSignature);
    expect(reloaded?.winnerSide).toBeUndefined();
  });

  it('a second void is rejected too and keeps the first signature', async () => {
    const duel = await createHeldDuel({ escrowAddress: ESCROW });
    const id = String(duel._id);
    const first = (await body(await resolve(id, 'void'))).data.oracleSignature;

    expect((await resolve(id, 'void')).status).toBe(409);
    expect((await Duel.findById(duel._id))?.oracleSignature).toBe(first);
  });

  it('the conditional update is the real guard: a signature stored between the read and the write still wins', async () => {
    const duel = await createHeldDuel({ escrowAddress: ESCROW });
    // Simulate a concurrent void landing after this request's findById but
    // before its findOneAndUpdate, by making findById return the stale doc.
    const stale = await Duel.findById(duel._id);
    await Duel.updateOne({ _id: duel._id }, { $set: { oracleSignature: '0xconcurrent' } });
    const spy = vi.spyOn(Duel, 'findById').mockResolvedValueOnce(stale);
    try {
      const res = await resolve(String(duel._id), 'confirm');
      expect(res.status).toBe(409);
    } finally {
      spy.mockRestore();
    }
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('HELD');
    expect(reloaded?.oracleSignature).toBe('0xconcurrent');
  });
});

describe('admin HELD recovery: guards', () => {
  it('rejects resolving a duel that is not HELD', async () => {
    const duel = await createDuel({ status: 'LIVE', creatorWallet: CREATOR, opponentWallet: OPPONENT });
    const res = await resolveRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'void' }, ADMIN_HEADERS),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    expect(res.status).toBe(409);
  });

  it('rejects an unknown action value', async () => {
    const duel = await createHeldDuel();
    const res = await resolveRoute(
      postJson(`http://localhost/api/admin/duels/${duel._id}/resolve`, { action: 'nonsense' }, ADMIN_HEADERS),
      { params: Promise.resolve({ id: String(duel._id) }) }
    );
    expect(res.status).toBe(400);
  });
});
