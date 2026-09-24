import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { GET as getConfigRoute, PATCH as patchConfigRoute } from '@/app/api/admin/keeper-config/route';
import KeeperConfig, { DEFAULT_TOP_UP_USDG } from '@/lib/models/KeeperConfig';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { getReq, patchJson, body } from '../helpers/http';

const URL = 'http://localhost/api/admin/keeper-config';
const ADMIN_HEADERS = { 'x-admin-secret': 'test-admin-secret' };

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('GET /api/admin/keeper-config', () => {
  it('rejects without the admin secret', async () => {
    expect((await getConfigRoute(getReq(URL))).status).toBe(401);
  });

  it('seeds and returns the default ($1) on first read', async () => {
    const res = await getConfigRoute(getReq(URL, ADMIN_HEADERS));
    expect(res.status).toBe(200);
    expect((await body(res)).data.topUpUsdg).toBe(DEFAULT_TOP_UP_USDG);
  });
});

describe('PATCH /api/admin/keeper-config', () => {
  it('rejects without the admin secret', async () => {
    const res = await patchConfigRoute(patchJson(URL, { topUpUsdg: 5 }));
    expect(res.status).toBe(401);
    expect(await KeeperConfig.findById('relayer')).toBeNull();
  });

  it('raises the top-up amount, takes effect immediately for the next read', async () => {
    const res = await patchConfigRoute(patchJson(URL, { topUpUsdg: 5 }, ADMIN_HEADERS));
    expect(res.status).toBe(200);
    expect((await body(res)).data.topUpUsdg).toBe(5);

    const reread = await getConfigRoute(getReq(URL, ADMIN_HEADERS));
    expect((await body(reread)).data.topUpUsdg).toBe(5);
  });

  it('rejects zero, negative, and non-numeric values, leaving the config unchanged', async () => {
    await patchConfigRoute(patchJson(URL, { topUpUsdg: 5 }, ADMIN_HEADERS));
    for (const bad of [0, -1, 'five', null, NaN]) {
      const res = await patchConfigRoute(patchJson(URL, { topUpUsdg: bad }, ADMIN_HEADERS));
      expect(res.status).toBe(400);
    }
    expect((await KeeperConfig.findById('relayer'))?.topUpUsdg).toBe(5);
  });

  it('rejects a value above the sanity ceiling', async () => {
    const res = await patchConfigRoute(patchJson(URL, { topUpUsdg: 51 }, ADMIN_HEADERS));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/ceiling/);
  });

  it('allows exactly the ceiling value', async () => {
    const res = await patchConfigRoute(patchJson(URL, { topUpUsdg: 50 }, ADMIN_HEADERS));
    expect(res.status).toBe(200);
  });
});
