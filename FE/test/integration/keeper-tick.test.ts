import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { POST as tickRoute } from '@/app/api/keeper/tick/route';
import KeeperLock from '@/lib/models/KeeperLock';
import { enqueueKeeperTick } from '@/lib/keeperSchedule';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { postJson, body } from '../helpers/http';

const URL = 'http://localhost/api/keeper/tick';
const SECRET = 'test-cron-secret';
// Anvil's well-known test key #2 -- never a real secret.
const RELAYER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  process.env.CRON_SECRET = SECRET;
  process.env.RELAYER_PRIVATE_KEY = RELAYER_KEY;
});

afterAll(async () => {
  delete process.env.CRON_SECRET;
  delete process.env.RELAYER_PRIVATE_KEY;
  await mongoose.connection.close();
});

describe('POST /api/keeper/tick', () => {
  it('rejects a request without the cron bearer secret', async () => {
    expect((await tickRoute(postJson(URL, {}))).status).toBe(401);
    expect((await tickRoute(postJson(URL, {}, { authorization: 'Bearer nope' }))).status).toBe(401);
  });

  it('runs a tick with the right secret', async () => {
    const res = await tickRoute(postJson(URL, {}, { authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect((await body(res)).data.transactions).toBe(0);
  });

  it('answers 503 while another tick holds the send lock, so Cloud Tasks retries', async () => {
    await KeeperLock.create({ _id: 'relayer', lockedUntil: new Date(Date.now() + 60_000), holder: 'other' });
    const res = await tickRoute(postJson(URL, {}, { authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
  });
});

describe('lib/keeperSchedule', () => {
  it('is a no-op when Cloud Tasks is not configured (the cron covers it)', async () => {
    delete process.env.KEEPER_TASKS_QUEUE;
    delete process.env.KEEPER_TICK_URL;
    expect(await enqueueKeeperTick(new Date(), 'settle-abc')).toBe(false);
  });
});
