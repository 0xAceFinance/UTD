import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';

const { getLivePoolSamples } = vi.hoisted(() => ({ getLivePoolSamples: vi.fn() }));
vi.mock('@/lib/dexScreenerSource', () => ({ getLivePoolSamples }));

// The keeper tick runs for real (signing included); with no RELAYER_PRIVATE_KEY
// it stops before sending anything. Relaying itself is covered in
// test/unit/settlementRelayer.test.ts.

import { GET as cronRoute } from '@/app/api/cron/settle/route';
import Duel from '@/lib/models/Duel';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuel, makeTokenSide } from '../helpers/duelFixtures';
import { getReq, body } from '../helpers/http';

const URL = 'http://localhost/api/cron/settle';
const SECRET = 'test-cron-secret';
const auth = { authorization: `Bearer ${SECRET}` };

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  delete process.env.RELAYER_PRIVATE_KEY;
  getLivePoolSamples.mockResolvedValue([]);
});

afterAll(async () => {
  delete process.env.CRON_SECRET;
  await mongoose.connection.close();
});

describe('GET /api/cron/settle: auth', () => {
  it('rejects a request with no Authorization header', async () => {
    expect((await cronRoute(getReq(URL))).status).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    expect((await cronRoute(getReq(URL, { authorization: 'Bearer nope' }))).status).toBe(401);
  });

  it('rejects the right secret without the Bearer scheme', async () => {
    expect((await cronRoute(getReq(URL, { authorization: SECRET }))).status).toBe(401);
  });

  it('rejects everything when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    expect((await cronRoute(getReq(URL, { authorization: 'Bearer ' }))).status).toBe(401);
    expect((await cronRoute(getReq(URL, { authorization: 'Bearer undefined' }))).status).toBe(401);
  });

  it('does no work on an unauthorized call', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: '0xcronopp00000000000000000000000000000001',
      escrowAddress: '0x1000000000000000000000000000000000000055',
      startTime: new Date(Date.now() - 3_600_000),
      endTime: new Date(Date.now() - 1_000),
    });
    await cronRoute(getReq(URL));
    expect((await Duel.findById(duel._id))?.status).toBe('LIVE');
  });
});

describe('GET /api/cron/settle: keeper', () => {
  it('signs an ended LIVE duel nobody is viewing (the relay step reports unconfigured without a relayer key)', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: '0xcronopp00000000000000000000000000000002',
      escrowAddress: '0x1000000000000000000000000000000000000056',
      startTime: new Date(Date.now() - 3_600_000),
      endTime: new Date(Date.now() - 1_000),
      tokenA: makeTokenSide({ startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_000_000 }),
      tokenB: makeTokenSide({ startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_300_000 }),
    });

    const res = await cronRoute(getReq(URL, auth));
    expect(res.status).toBe(200);
    const json = (await body(res)).data;
    expect(json.signed).toBe(1);
    expect(json.unconfigured).toBe(true);

    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('SETTLING');
    expect(reloaded?.oracleSignature).toBeTruthy();
  });

  it('leaves LIVE duels that have not ended yet alone', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: '0xcronopp00000000000000000000000000000003',
      startTime: new Date(Date.now() - 60_000),
      endTime: new Date(Date.now() + 600_000),
    });
    const json = (await body(await cronRoute(getReq(URL, auth)))).data;
    expect(json.signed).toBe(0);
    expect((await Duel.findById(duel._id))?.status).toBe('LIVE');
  });

  it('repairs a duel stranded at SETTLING with no signature', async () => {
    const duel = await createDuel({
      status: 'SETTLING',
      opponentWallet: '0xcronopp00000000000000000000000000000009',
      escrowAddress: '0x1000000000000000000000000000000000000058',
      endTime: new Date(Date.now() - 3_600_000),
      tokenA: makeTokenSide({ startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_000_000 }),
      tokenB: makeTokenSide({ startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_300_000 }),
    });
    expect(duel.oracleSignature).toBeUndefined();

    const json = (await body(await cronRoute(getReq(URL, auth)))).data;
    expect(json.repaired).toBe(1);

    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.oracleSignature).toBeTruthy();
    expect(reloaded?.winnerSide).toBe(1);
  });

  it('flags HELD duels still unresolved more than 12h after endTime', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const overdue = await createDuel({ status: 'HELD', endTime: new Date(Date.now() - 13 * 3600_000) });
    await createDuel({ status: 'HELD', endTime: new Date(Date.now() - 1 * 3600_000) });

    const json = (await body(await cronRoute(getReq(URL, auth)))).data;
    expect(json.overdueHeld).toEqual([String(overdue._id)]);
    expect(errSpy.mock.calls.some(([m]) => String(m).includes(String(overdue._id)))).toBe(true);
    errSpy.mockRestore();
  });
});
