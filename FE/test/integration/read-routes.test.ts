import { describe, it, expect, beforeEach, vi } from 'vitest';

// scan route hits the real DexScreener network + the real engine gates --
// mock the network boundary only, the same pattern used for chainVerify in
// the duel lifecycle tests, so runDailyScan's own persistence/health-record
// logic still runs for real against the in-memory DB.
const { listCandidatesMock } = vi.hoisted(() => ({ listCandidatesMock: vi.fn() }));
vi.mock('@/lib/dexScreenerSource', () => ({
  DexScreenerSource: class {
    displayInfo = new Map();
    listCandidates = listCandidatesMock;
  },
}));

// BLOCKED_COUNTRY_CODES ships empty by design (a legal decision, not a
// technical one -- see lib/riskConfig.ts's own comment) so nothing is
// blocked in the real config today. Mocking one entry in here tests that
// the geofence wiring actually works, without asserting a business policy
// this app deliberately hasn't set yet.
vi.mock('@/lib/riskConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/riskConfig')>();
  return { ...actual, BLOCKED_COUNTRY_CODES: ['KP'] };
});

import { GET as precheckRoute } from '@/app/api/duels/precheck/route';
import { GET as listDuelsRoute } from '@/app/api/duels/route';
import { POST as scanRoute } from '@/app/api/scan/route';
import { GET as leaderboardRoute } from '@/app/api/leaderboard/route';
import { GET as combatRecordRoute } from '@/app/api/combat-record/[wallet]/route';
import { GET as duelTokensRoute } from '@/app/api/duel-tokens/route';
import { GET as usersRoute } from '@/app/api/users/route';
import { GET as userByIdRoute } from '@/app/api/users/[id]/route';
import CombatRecord from '@/lib/models/CombatRecord';
import DuelToken from '@/lib/models/DuelToken';
import OracleHealthSample from '@/lib/models/OracleHealthSample';
import User from '@/lib/models/User';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuel, createDuelToken } from '../helpers/duelFixtures';
import { getReq, body } from '../helpers/http';

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  vi.clearAllMocks();
});

describe('GET /api/duels/precheck', () => {
  it('400s when the wallet query param is missing', async () => {
    const res = await precheckRoute(getReq('http://localhost/api/duels/precheck'));
    expect(res.status).toBe(400);
  });

  it('happy path: canCreate true when every gate passes', async () => {
    await OracleHealthSample.create({ timestampSec: Math.floor(Date.now() / 1000), succeeded: true });
    const res = await precheckRoute(getReq('http://localhost/api/duels/precheck?wallet=0xabc'));
    expect(res.status).toBe(200);
    expect((await body(res)).data.canCreate).toBe(true);
  });

  it('403s when the oracle circuit breaker has tripped (no health samples at all)', async () => {
    const res = await precheckRoute(getReq('http://localhost/api/duels/precheck?wallet=0xabc'));
    expect(res.status).toBe(403);
  });

  it('403s when the request comes from a geofenced country', async () => {
    await OracleHealthSample.create({ timestampSec: Math.floor(Date.now() / 1000), succeeded: true });
    const res = await precheckRoute(
      getReq('http://localhost/api/duels/precheck?wallet=0xabc', { 'x-vercel-ip-country': 'KP' })
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/scan', () => {
  it('persists a fresh Top 10 and records a successful health sample', async () => {
    // A single, deliberately overwhelming candidate -- not trying to
    // exercise every Section 01 gate here (that's engine's own 68-test
    // suite), just confirming the route wires listCandidates -> selectTopTen
    // -> DuelToken persistence -> OracleHealthSample correctly end to end.
    listCandidatesMock.mockResolvedValue([
      {
        tokenAddress: '0xscan00000000000000000000000000000001',
        symbol: 'SCAN',
        totalSupply: 1_000_000,
        ageDays: 30,
        uniqueTraders24h: 500,
        txCount24h: 2000,
        volume24hUsd: 5_000_000,
        holderConcentrationTop10Pct: 10,
        lpLockedDaysRemaining: 365,
        rugCheckPassed: true,
        isBlocklisted: false,
        pools: [
          {
            poolAddress: '0xpool0000000000000000000000000000000001',
            tokenAddress: '0xscan00000000000000000000000000000001',
            dexName: 'test-dex',
            reserveToken: 500_000,
            reserveQuote: 500_000,
            quotePriceUsd: 1,
            timestampSec: Math.floor(Date.now() / 1000),
          },
        ],
      },
    ]);

    const res = await scanRoute();
    expect(res.status).toBe(200);
    const json = (await body(res)).data;
    expect(json.candidatePoolSize).toBe(1);

    const health = await OracleHealthSample.find();
    expect(health.length).toBe(1);
    expect(health[0].succeeded).toBe(true);
  });

  it('replaces the previous Top 10 rather than appending to it', async () => {
    await createDuelToken({ symbol: 'STALE' });
    listCandidatesMock.mockResolvedValue([]);

    await scanRoute();

    const tokens = await DuelToken.find();
    expect(tokens.find((t) => t.symbol === 'STALE')).toBeUndefined();
  });

  it('records a FAILED health sample (not a thrown 500 that skips it) when the data source errors', async () => {
    listCandidatesMock.mockRejectedValue(new Error('DexScreener is down'));

    const res = await scanRoute();
    expect(res.status).toBe(500);

    const health = await OracleHealthSample.find();
    expect(health.length).toBe(1);
    expect(health[0].succeeded).toBe(false);
    expect(health[0].detail).toMatch(/DexScreener is down/);
  });
});

describe('GET /api/leaderboard', () => {
  it('ranks by totalPoints descending and attaches a tier', async () => {
    await CombatRecord.create({ wallet: '0xlow', totalPoints: 100, wins: 1, losses: 0 });
    await CombatRecord.create({ wallet: '0xhigh', totalPoints: 30_000, wins: 10, losses: 1 });

    const res = await leaderboardRoute();
    const ranked = (await body(res)).data;
    expect(ranked[0].wallet).toBe('0xhigh');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].tier).toBe('Gold');
    expect(ranked[1].tier).toBe('Bronze');
  });

  it('returns an empty list, not an error, when nobody has a combat record yet', async () => {
    const res = await leaderboardRoute();
    expect(res.status).toBe(200);
    expect((await body(res)).data).toEqual([]);
  });
});

describe('GET /api/combat-record/[wallet]', () => {
  it('returns zeroed defaults for a wallet with no record yet, rather than 404ing', async () => {
    const res = await combatRecordRoute(getReq('http://localhost/api/combat-record/0xnewwallet'), {
      params: Promise.resolve({ wallet: '0xnewwallet' }),
    });
    expect(res.status).toBe(200);
    const data = (await body(res)).data;
    expect(data.totalPoints).toBe(0);
    expect(data.tier).toBe('Bronze');
    expect(data.matches).toEqual([]);
  });

  it('computes availablePoints as totalPoints minus redeemedPoints, and lists only that wallet\'s SETTLED matches', async () => {
    await CombatRecord.create({ wallet: '0xplayer', totalPoints: 1000, redeemedPoints: 400, wins: 3, losses: 1 });
    await createDuel({ status: 'SETTLED', creatorWallet: '0xplayer', opponentWallet: '0xrival', endTime: new Date() });
    await createDuel({ status: 'OPEN', creatorWallet: '0xplayer' }); // must NOT show up -- not SETTLED
    await createDuel({ status: 'SETTLED', creatorWallet: '0xsomeoneelse', opponentWallet: '0xanother', endTime: new Date() }); // must NOT show up -- not this wallet

    const res = await combatRecordRoute(getReq('http://localhost/api/combat-record/0xplayer'), {
      params: Promise.resolve({ wallet: '0xplayer' }),
    });
    const data = (await body(res)).data;
    expect(data.availablePoints).toBe(600);
    expect(data.matches).toHaveLength(1);
  });

  it('is case-insensitive on wallet address', async () => {
    await CombatRecord.create({ wallet: '0xmixedcase', totalPoints: 50 });
    const res = await combatRecordRoute(getReq('http://localhost/api/combat-record/0xMixedCase'), {
      params: Promise.resolve({ wallet: '0xMixedCase' }),
    });
    expect((await body(res)).data.totalPoints).toBe(50);
  });
});

describe('GET /api/duels (list + filters)', () => {
  it('filters by status', async () => {
    await createDuel({ status: 'OPEN' });
    await createDuel({ status: 'SETTLED' });
    const res = await listDuelsRoute(getReq('http://localhost/api/duels?status=OPEN'));
    const duels = (await body(res)).data;
    expect(duels).toHaveLength(1);
    expect(duels[0].status).toBe('OPEN');
  });

  it('filters by wallet, matching either creator or opponent, case-insensitively', async () => {
    await createDuel({ creatorWallet: '0xPlayerOne', opponentWallet: '0xother' });
    await createDuel({ creatorWallet: '0xsomeoneelse', opponentWallet: '0xplayerone' }); // as opponent, different case
    await createDuel({ creatorWallet: '0xunrelated' });

    const res = await listDuelsRoute(getReq('http://localhost/api/duels?wallet=0xPLAYERONE'));
    const duels = (await body(res)).data;
    expect(duels).toHaveLength(2);
  });
});

describe('GET /api/duel-tokens', () => {
  it('returns at most 10, ordered by rank', async () => {
    for (let i = 1; i <= 12; i++) {
      await DuelToken.create({ symbol: `T${i}`, name: `T${i}`, rank: i, tokenAddress: `0x${i}`.padEnd(42, '0'), totalSupply: 1, marketCapUsd: 1, liquidityUsd: 1, volume24hUsd: 1, change24hPct: 0 });
    }
    const res = await duelTokensRoute();
    const tokens = (await body(res)).data;
    expect(tokens).toHaveLength(10);
    expect(tokens[0].rank).toBe(1);
    expect(tokens[9].rank).toBe(10);
  });
});

describe('GET /api/users (KNOWN BUG: field-name mismatch)', () => {
  it('lists all users when no wallet filter is given', async () => {
    await User.create({ username: 'a', email: 'a@x.com', passwordHash: 'h', walletAddress: '0xaaa' });
    const res = await usersRoute(getReq('http://localhost/api/users'));
    expect(res.status).toBe(200);
    expect((await body(res)).data).toHaveLength(1);
  });

  it('BUG: ?wallet= filter never matches, even for a wallet that genuinely exists -- queries "wallets.address" but the User schema field is "walletAddress"', async () => {
    // lib/models/User.ts defines a top-level `walletAddress: string`, not a
    // `wallets` array. app/api/users/route.ts's ?wallet= branch queries
    // `{ 'wallets.address': ... }`, which can never match any document under
    // the real schema. Documents the current (broken) behavior; not fixed
    // here -- fixing the query to `{ walletAddress: walletAddress.toLowerCase() }`
    // is a one-line product-owner call, included in the test-pass report.
    await User.create({ username: 'a', email: 'a@x.com', passwordHash: 'h', walletAddress: '0xrealwallet' });
    const res = await usersRoute(getReq('http://localhost/api/users?wallet=0xrealwallet'));
    expect(res.status).toBe(404); // should be 200 with the user, once fixed
  });
});

describe('GET /api/users/[id]', () => {
  it('returns the user by id, excluding passwordHash', async () => {
    // Was previously stuck on the pre-Next-15 synchronous params shape
    // (`{ params }: { params: { id: string } }`), which always 400'd since
    // `params.id` read a property off a Promise object. Fixed to match every
    // other dynamic route in this app (duels/[id], combat-record/[wallet]):
    // `{ params }: { params: Promise<{ id: string }> }`, awaited.
    const user = await User.create({ username: 'a', email: 'a@x.com', passwordHash: 'h', walletAddress: '0xabc' });
    const res = await userByIdRoute(getReq(`http://localhost/api/users/${user._id}`), {
      params: Promise.resolve({ id: String(user._id) }),
    });
    const json = await body(res);
    expect(res.status).toBe(200);
    expect(json.data.username).toBe('a');
    expect(json.data.passwordHash).toBeUndefined();
  });

  it('400s on an invalid id', async () => {
    const res = await userByIdRoute(getReq('http://localhost/api/users/not-a-valid-id'), {
      params: Promise.resolve({ id: 'not-a-valid-id' }),
    });
    expect(res.status).toBe(400);
  });
});
