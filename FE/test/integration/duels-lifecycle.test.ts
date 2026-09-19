import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose, { Types } from 'mongoose';

const chainVerifyMocks = vi.hoisted(() => ({
  verifyDuelCreated: vi.fn(),
  verifyDuelJoined: vi.fn(),
  verifyDuelClosed: vi.fn(),
  verifyDuelSettled: vi.fn(),
  verifyDuelRefundedStale: vi.fn(),
}));
vi.mock('@/lib/chainVerify', () => chainVerifyMocks);

const { getLivePoolSamples } = vi.hoisted(() => ({ getLivePoolSamples: vi.fn() }));
vi.mock('@/lib/dexScreenerSource', () => ({ getLivePoolSamples }));

// getFundingSource hits a real RPC (eth_getLogs) -- mock the network boundary
// so these tests don't pay real (or, worse, unreachable-and-retried) network
// latency. Defaults to "no funding source found", the same as the real
// function's behavior when nothing turns up.
const { getFundingSource } = vi.hoisted(() => ({ getFundingSource: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/fundingSource', () => ({ getFundingSource }));

import { POST as createDuelRoute } from '@/app/api/duels/route';
import { GET as getDuelRoute } from '@/app/api/duels/[id]/route';
import { POST as joinDuelRoute } from '@/app/api/duels/[id]/join/route';
import { POST as cancelDuelRoute } from '@/app/api/duels/[id]/cancel/route';
import { POST as expireDuelRoute } from '@/app/api/duels/[id]/expire/route';
import { POST as confirmSettlementRoute } from '@/app/api/duels/[id]/confirm-settlement/route';
import { POST as refundStaleRoute } from '@/app/api/duels/[id]/refund-stale/route';
import Duel from '@/lib/models/Duel';
import { readEscrowOpenDeadline } from '@/lib/chainClient';
import OracleHealthSample from '@/lib/models/OracleHealthSample';
import CombatRecord from '@/lib/models/CombatRecord';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuelToken } from '../helpers/duelFixtures';
import { postJson, getReq, body } from '../helpers/http';

const CREATOR = '0xcreatorAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OPPONENT = '0xopponentBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
// Deliberately distinct from postJson's default x-forwarded-for -- a
// creator and opponent sharing the *same* fake IP is exactly what the
// wallet-clustering sybil check is designed to catch (see the dedicated
// "BUG:" test below for the case where that check over-fires).
const OPPONENT_IP = '8.8.8.8';
const ESCROW = '0x1000000000000000000000000000000000000010';

function samplesFor(tokenAddress: string, priceUsd = 1) {
  const reserveQuote = 50_000;
  const reserveToken = reserveQuote / priceUsd;
  return [
    {
      poolAddress: `${tokenAddress}-pool`,
      tokenAddress,
      dexName: 'test-dex',
      reserveToken,
      reserveQuote,
      quotePriceUsd: 1,
      timestampSec: Math.floor(Date.now() / 1000),
    },
  ];
}

async function setupTop10() {
  const tokenA = await createDuelToken({ symbol: 'FOO', marketCapUsd: 1_000_000, liquidityUsd: 100_000 });
  const tokenB = await createDuelToken({ symbol: 'BAR', marketCapUsd: 1_000_000, liquidityUsd: 100_000 });
  return { tokenA, tokenB };
}

function mockCreatedEvent(overrides: Partial<{ creatorSide: 0 | 1; durationSeconds: bigint; buyIn: bigint; escrowAddress: string }> = {}) {
  chainVerifyMocks.verifyDuelCreated.mockResolvedValue({
    escrowAddress: overrides.escrowAddress ?? ESCROW,
    event: {
      buyIn: overrides.buyIn ?? 100_000_000_000_000_000_000n, // 100e18
      creatorSide: overrides.creatorSide ?? 0,
      durationSeconds: overrides.durationSeconds ?? 1_200n, // 20 minutes -- one of the allowed 5/10/15/20 min durations
    },
  });
}

async function createOnChainDuel() {
  const { tokenA, tokenB } = await setupTop10();
  mockCreatedEvent();
  getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));

  const res = await createDuelRoute(
    postJson('http://localhost/api/duels', {
      creatorWallet: CREATOR,
      tokenASymbol: tokenA.symbol,
      tokenBSymbol: tokenB.symbol,
      txHash: '0x' + 'aa'.repeat(32),
    })
  );
  const json = await body(res);
  expect(res.status).toBe(201);
  return json.data;
}

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  vi.clearAllMocks();
  // vi.clearAllMocks() only clears call history, not a previously-set
  // mockResolvedValue -- re-establish the safe default explicitly so a test
  // that overrides this (e.g. the funded_by sybil test below) can't leak its
  // override into every test that runs after it.
  getFundingSource.mockResolvedValue(undefined);
  await OracleHealthSample.create({ timestampSec: Math.floor(Date.now() / 1000), succeeded: true });
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('create: open deadline', () => {
  it("stores the escrow's on-chain openDeadline, not the server's clock", async () => {
    const onChain = new Date('2026-01-01T00:05:00Z');
    vi.mocked(readEscrowOpenDeadline).mockResolvedValueOnce(onChain);
    const duel = await createOnChainDuel();
    expect(new Date(duel.openDeadline).getTime()).toBe(onChain.getTime());
    expect(readEscrowOpenDeadline).toHaveBeenCalledWith(ESCROW);
  });
});

describe('Full duel lifecycle: create -> join -> live tick -> settle', () => {
  it('walks the entire happy path end to end, verifying every on-chain claim against decoded events (never trusting client input)', async () => {
    const duel = await createOnChainDuel();
    expect(duel.status).toBe('OPEN');
    expect(duel.escrowAddress.toLowerCase()).toBe(ESCROW.toLowerCase());
    expect(duel.buyInUsd).toBe(100);
    expect(duel.durationSeconds).toBe(1200);

    // JOIN
    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    const joinRes = await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, { 'x-forwarded-for': OPPONENT_IP }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    const joined = (await body(joinRes)).data;
    expect(joinRes.status).toBe(200);
    expect(joined.status).toBe('LIVE');
    expect(joined.startTime).toBeTruthy();
    expect(joined.endTime).toBeTruthy();
    expect(joined.tokenA.rawSamples.length).toBeGreaterThan(0);
    expect(chainVerifyMocks.verifyDuelJoined).toHaveBeenCalledWith(expect.any(String), duel.escrowAddress, OPPONENT.toLowerCase());

    // LIVE tick (well before endTime) -- stays LIVE, oracle pipeline runs
    const tickRes = await getDuelRoute(getReq(`http://localhost/api/duels/${duel._id}`), {
      params: Promise.resolve({ id: duel._id }),
    });
    const ticked = (await body(tickRes)).data;
    expect(ticked.status).toBe('LIVE');

    // Force the battle window closed (simulating real elapsed time) and poll
    // again -- this should settle it (sign, since it's on-chain) via the
    // same self-healing GET route real users poll.
    await Duel.findByIdAndUpdate(duel._id, { endTime: new Date(Date.now() - 1000) });
    const settleTickRes = await getDuelRoute(getReq(`http://localhost/api/duels/${duel._id}`), {
      params: Promise.resolve({ id: duel._id }),
    });
    const settling = (await body(settleTickRes)).data;
    expect(settling.status).toBe('SETTLING');
    expect(settling.oracleSignature).toBeTruthy();
    expect(settling.winnerSide === 0 || settling.winnerSide === 1).toBe(true);

    // CONFIRM SETTLEMENT -- decodes the real winnerSide from the tx, must match.
    chainVerifyMocks.verifyDuelSettled.mockResolvedValue({ winnerSide: settling.winnerSide });
    const confirmRes = await confirmSettlementRoute(
      postJson(`http://localhost/api/duels/${duel._id}/confirm-settlement`, { txHash: '0x' + 'cc'.repeat(32) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    const settled = (await body(confirmRes)).data;
    expect(confirmRes.status).toBe(200);
    expect(settled.status).toBe('SETTLED');
    expect(settled.winnerPoints).toBeGreaterThan(0);
    expect(settled.loserPoints).toBeGreaterThan(0);

    const winnerWallet = settled.winnerSide === 0 ? CREATOR : OPPONENT;
    const record = await CombatRecord.findOne({ wallet: winnerWallet.toLowerCase() });
    expect(record?.wins).toBe(1);
  });

  it('cancel before join: creator can cancel an OPEN duel, and the cancellation is recorded for the rate limiter', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelClosed.mockResolvedValue(undefined);

    const res = await cancelDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/cancel`, { wallet: CREATOR, txHash: '0x' + 'dd'.repeat(32) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    const cancelled = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(chainVerifyMocks.verifyDuelClosed).toHaveBeenCalledWith(expect.any(String), duel.escrowAddress, 'DuelCancelled');
  });

  it('rejects cancellation by anyone other than the creator', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelClosed.mockResolvedValue(undefined);

    const res = await cancelDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/cancel`, { wallet: OPPONENT, txHash: '0x' + 'dd'.repeat(32) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    expect(res.status).toBe(409);
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('OPEN');
  });

  it('expire after the open window with no joiner: on-chain duel expires once verified', async () => {
    const duel = await createOnChainDuel();
    await Duel.findByIdAndUpdate(duel._id, { openDeadline: new Date(Date.now() - 1000) });
    chainVerifyMocks.verifyDuelClosed.mockResolvedValue(undefined);

    const res = await expireDuelRoute(postJson(`http://localhost/api/duels/${duel._id}/expire`, { txHash: '0x' + 'ee'.repeat(32) }), {
      params: Promise.resolve({ id: duel._id }),
    });
    const expired = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(expired.status).toBe('EXPIRED');
  });

  it('a legacy off-chain duel self-heals OPEN -> EXPIRED on a GET past its open window (no separate expire tx needed)', async () => {
    const { tokenA, tokenB } = await setupTop10();
    const legacyDuel = await Duel.create({
      status: 'OPEN',
      creatorWallet: CREATOR.toLowerCase(),
      creatorSide: 0,
      tokenA: { symbol: tokenA.symbol, name: tokenA.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      tokenB: { symbol: tokenB.symbol, name: tokenB.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      buyInUsd: 100,
      durationSeconds: 900,
      openDeadline: new Date(Date.now() - 1000),
    });

    const res = await getDuelRoute(getReq(`http://localhost/api/duels/${legacyDuel._id}`), {
      params: Promise.resolve({ id: String(legacyDuel._id) }),
    });
    const json = (await body(res)).data;
    expect(json.status).toBe('EXPIRED');
  });

  it('expiring before the open window has passed fails (409), state stays OPEN', async () => {
    const duel = await createOnChainDuel(); // openDeadline defaults far in the future
    const res = await expireDuelRoute(postJson(`http://localhost/api/duels/${duel._id}/expire`, { txHash: '0x' + 'ee'.repeat(32) }), {
      params: Promise.resolve({ id: duel._id }),
    });
    expect(res.status).toBe(409);
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('OPEN');
  });

  it('joining twice: the second join attempt on an already-LIVE duel fails', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));

    const first = await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    expect(first.status).toBe(200);

    const thirdWallet = '0xthirdwalletCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    const second = await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: thirdWallet, txHash: '0x' + 'ff'.repeat(32) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    expect(second.status).toBe(409);
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.opponentWallet).toBe(OPPONENT.toLowerCase());
  });

  it('rejects a join on a duel that is already SETTLED', async () => {
    const { tokenA, tokenB } = await setupTop10();
    const settledDuel = await Duel.create({
      status: 'SETTLED',
      creatorWallet: CREATOR.toLowerCase(),
      opponentWallet: OPPONENT.toLowerCase(),
      creatorSide: 0,
      winnerSide: 0,
      tokenA: { symbol: tokenA.symbol, name: tokenA.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      tokenB: { symbol: tokenB.symbol, name: tokenB.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      buyInUsd: 100,
      durationSeconds: 900,
      openDeadline: new Date(Date.now() + 1000),
    });

    const thirdWallet = '0xthirdwalletCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    const res = await joinDuelRoute(
      postJson(`http://localhost/api/duels/${settledDuel._id}/join`, { opponentWallet: thirdWallet, txHash: '0x' + 'ff'.repeat(32) }),
      { params: Promise.resolve({ id: settledDuel._id }) }
    );
    expect(res.status).toBe(409);
  });

  it('rejects a join on a duel that is already EXPIRED', async () => {
    const { tokenA, tokenB } = await setupTop10();
    const expiredDuel = await Duel.create({
      status: 'EXPIRED',
      creatorWallet: CREATOR.toLowerCase(),
      creatorSide: 0,
      tokenA: { symbol: tokenA.symbol, name: tokenA.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      tokenB: { symbol: tokenB.symbol, name: tokenB.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      buyInUsd: 100,
      durationSeconds: 900,
      openDeadline: new Date(Date.now() - 100_000),
    });

    const res = await joinDuelRoute(
      postJson(`http://localhost/api/duels/${expiredDuel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'ff'.repeat(32) }),
      { params: Promise.resolve({ id: expiredDuel._id }) }
    );
    expect(res.status).toBe(409);
  });

  it('confirm-settlement attempted while a duel is still LIVE (before settling) fails', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));
    await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, { 'x-forwarded-for': OPPONENT_IP }),
      { params: Promise.resolve({ id: duel._id }) }
    );

    const res = await confirmSettlementRoute(
      postJson(`http://localhost/api/duels/${duel._id}/confirm-settlement`, { txHash: '0x' + 'cc'.repeat(32) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    expect(res.status).toBe(409);
    expect((await body(res)).error).toMatch(/cannot confirm settlement for a duel in status LIVE/);
  });

  it('confirm-settlement with a tampered/wrong txHash (decode fails) does not settle the duel', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));
    await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, { 'x-forwarded-for': OPPONENT_IP }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    await Duel.findByIdAndUpdate(duel._id, { endTime: new Date(Date.now() - 1000) });
    await getDuelRoute(getReq(`http://localhost/api/duels/${duel._id}`), { params: Promise.resolve({ id: duel._id }) });

    const settlingDuel = await Duel.findById(duel._id);
    expect(settlingDuel?.status).toBe('SETTLING');

    // The frontend claims a settle() tx happened, but the real receipt
    // doesn't contain a Settled event for this escrow -- chainVerify fails
    // closed, exactly as it would for a wrong/unrelated/tampered tx hash.
    chainVerifyMocks.verifyDuelSettled.mockRejectedValue(new Error('Settled event not found for this duel in that transaction.'));

    const res = await confirmSettlementRoute(
      postJson(`http://localhost/api/duels/${duel._id}/confirm-settlement`, { txHash: '0x' + 'badbad'.repeat(10) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    expect(res.status).toBe(400);

    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('SETTLING'); // unchanged -- never settled off a bad tx
    expect(reloaded?.winnerPoints).toBeUndefined();
  });

  it('confirm-settlement is idempotent: calling it again on an already-SETTLED duel just returns it', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));
    await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, { 'x-forwarded-for': OPPONENT_IP }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    await Duel.findByIdAndUpdate(duel._id, { endTime: new Date(Date.now() - 1000) });
    await getDuelRoute(getReq(`http://localhost/api/duels/${duel._id}`), { params: Promise.resolve({ id: duel._id }) });

    chainVerifyMocks.verifyDuelSettled.mockResolvedValue({ winnerSide: 0 });
    const first = await confirmSettlementRoute(postJson(`http://localhost/api/duels/${duel._id}/confirm-settlement`, { txHash: '0x' + 'cc'.repeat(32) }), {
      params: Promise.resolve({ id: duel._id }),
    });
    expect(first.status).toBe(200);

    const second = await confirmSettlementRoute(postJson(`http://localhost/api/duels/${duel._id}/confirm-settlement`, { txHash: '0x' + 'cc'.repeat(32) }), {
      params: Promise.resolve({ id: duel._id }),
    });
    expect(second.status).toBe(200);
    expect(chainVerifyMocks.verifyDuelSettled).toHaveBeenCalledTimes(1); // second call short-circuits before re-verifying
  });

  it('two wallets with no reverse-proxy IP header (both resolve to the "unknown" sentinel) are NOT treated as sharing an IP', async () => {
    // getClientIp() (lib/requestSignals.ts) falls back to the literal
    // string 'unknown' when neither x-forwarded-for nor x-real-ip is
    // present. Both app/api/duels/route.ts and .../join/route.ts guard
    // this explicitly (`if (ip !== 'unknown') { await WalletSighting.create(...) }`),
    // so unlike a real shared IP, this sentinel is never recorded as a
    // clustering signal -- confirms two genuinely unrelated wallets settle
    // normally even when neither request carried a proxy header.
    const { tokenA, tokenB } = await setupTop10();
    mockCreatedEvent();
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));
    const noProxyHeaders = { 'x-forwarded-for': '' }; // falsy -> getClientIp() falls through to 'unknown'

    const createRes = await createDuelRoute(
      postJson(
        'http://localhost/api/duels',
        { creatorWallet: CREATOR, tokenASymbol: tokenA.symbol, tokenBSymbol: tokenB.symbol, txHash: '0x' + 'aa'.repeat(32) },
        noProxyHeaders
      )
    );
    const duel = (await body(createRes)).data;

    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, noProxyHeaders),
      { params: Promise.resolve({ id: duel._id }) }
    );

    await Duel.findByIdAndUpdate(duel._id, { endTime: new Date(Date.now() - 1000) });
    const settleTickRes = await getDuelRoute(getReq(`http://localhost/api/duels/${duel._id}`), {
      params: Promise.resolve({ id: duel._id }),
    });
    const settled = (await body(settleTickRes)).data;

    expect(settled.status).toBe('SETTLING');
    expect(settled.flaggedSybil).toBeFalsy();
  });

  it('two wallets on different IPs but funded from the same source are flagged HELD (the funded_by signal shared-IP alone would miss)', async () => {
    const { tokenA, tokenB } = await setupTop10();
    mockCreatedEvent();
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));

    const SHARED_FUNDER = '0xsharedfunderaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    getFundingSource.mockResolvedValue(SHARED_FUNDER);

    const createRes = await createDuelRoute(
      postJson(
        'http://localhost/api/duels',
        { creatorWallet: CREATOR, tokenASymbol: tokenA.symbol, tokenBSymbol: tokenB.symbol, txHash: '0x' + 'aa'.repeat(32) },
        { 'x-forwarded-for': '1.1.1.1' } // distinct IP from the join below
      )
    );
    const duel = (await body(createRes)).data;

    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, { 'x-forwarded-for': '2.2.2.2' }),
      { params: Promise.resolve({ id: duel._id }) }
    );

    await Duel.findByIdAndUpdate(duel._id, { endTime: new Date(Date.now() - 1000) });
    const settleTickRes = await getDuelRoute(getReq(`http://localhost/api/duels/${duel._id}`), {
      params: Promise.resolve({ id: duel._id }),
    });
    const held = (await body(settleTickRes)).data;

    expect(held.status).toBe('HELD');
    expect(held.flaggedSybil).toBe(true);
  });
});

describe('POST /api/duels/[id]/refund-stale (last-resort recovery)', () => {
  it('refunds an on-chain duel stuck in SETTLING once the real RefundedStale event verifies', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));
    await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, { 'x-forwarded-for': OPPONENT_IP }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    await Duel.findByIdAndUpdate(duel._id, { endTime: new Date(Date.now() - 1000) });
    await getDuelRoute(getReq(`http://localhost/api/duels/${duel._id}`), { params: Promise.resolve({ id: duel._id }) });

    const stuck = await Duel.findById(duel._id);
    expect(stuck?.status).toBe('SETTLING'); // signed, but never confirmed on-chain -- the stuck scenario

    chainVerifyMocks.verifyDuelRefundedStale.mockResolvedValue(undefined);
    const res = await refundStaleRoute(
      postJson(`http://localhost/api/duels/${duel._id}/refund-stale`, { txHash: '0x' + 'ee'.repeat(32) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    const json = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(json.status).toBe('CANCELLED');
  });

  it('requires a txHash for an on-chain duel', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));
    await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, { 'x-forwarded-for': OPPONENT_IP }),
      { params: Promise.resolve({ id: duel._id }) }
    );

    const res = await refundStaleRoute(postJson(`http://localhost/api/duels/${duel._id}/refund-stale`, {}), {
      params: Promise.resolve({ id: duel._id }),
    });
    expect(res.status).toBe(400);

    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('LIVE'); // unchanged
  });

  it('rejects a tampered/wrong txHash, leaving the duel unchanged', async () => {
    const duel = await createOnChainDuel();
    chainVerifyMocks.verifyDuelJoined.mockResolvedValue(undefined);
    getLivePoolSamples.mockImplementation(async (addr: string) => samplesFor(addr));
    await joinDuelRoute(
      postJson(`http://localhost/api/duels/${duel._id}/join`, { opponentWallet: OPPONENT, txHash: '0x' + 'bb'.repeat(32) }, { 'x-forwarded-for': OPPONENT_IP }),
      { params: Promise.resolve({ id: duel._id }) }
    );

    chainVerifyMocks.verifyDuelRefundedStale.mockRejectedValue(new Error('RefundedStale event not found for this duel in that transaction.'));
    const res = await refundStaleRoute(
      postJson(`http://localhost/api/duels/${duel._id}/refund-stale`, { txHash: '0x' + 'badbad'.repeat(10) }),
      { params: Promise.resolve({ id: duel._id }) }
    );
    expect(res.status).toBe(400);

    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('LIVE'); // unchanged
  });

  it('a legacy off-chain duel (no escrowAddress) refunds directly, no txHash needed', async () => {
    const { tokenA, tokenB } = await setupTop10();
    const legacyDuel = await Duel.create({
      status: 'LIVE',
      creatorWallet: CREATOR.toLowerCase(),
      opponentWallet: OPPONENT.toLowerCase(),
      creatorSide: 0,
      tokenA: { symbol: tokenA.symbol, name: tokenA.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      tokenB: { symbol: tokenB.symbol, name: tokenB.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      buyInUsd: 100,
      durationSeconds: 900,
      openDeadline: new Date(Date.now() + 1000),
      startTime: new Date(Date.now() - 10_000),
      endTime: new Date(Date.now() - 5_000),
    });

    const res = await refundStaleRoute(postJson(`http://localhost/api/duels/${legacyDuel._id}/refund-stale`, {}), {
      params: Promise.resolve({ id: String(legacyDuel._id) }),
    });
    const json = (await body(res)).data;
    expect(res.status).toBe(200);
    expect(json.status).toBe('CANCELLED');
    expect(chainVerifyMocks.verifyDuelRefundedStale).not.toHaveBeenCalled();
  });

  it('rejects a duel that is not LIVE/SETTLING/HELD (e.g. already SETTLED)', async () => {
    const { tokenA, tokenB } = await setupTop10();
    const settledDuel = await Duel.create({
      status: 'SETTLED',
      creatorWallet: CREATOR.toLowerCase(),
      opponentWallet: OPPONENT.toLowerCase(),
      creatorSide: 0,
      winnerSide: 0,
      tokenA: { symbol: tokenA.symbol, name: tokenA.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      tokenB: { symbol: tokenB.symbol, name: tokenB.name, startMarketCapUsd: 1, currentMarketCapUsd: 1, sustainedPeakMarketCapUsd: 1, rawSamples: [] },
      buyInUsd: 100,
      durationSeconds: 900,
      openDeadline: new Date(Date.now() + 1000),
    });

    const res = await refundStaleRoute(postJson(`http://localhost/api/duels/${settledDuel._id}/refund-stale`, {}), {
      params: Promise.resolve({ id: String(settledDuel._id) }),
    });
    expect(res.status).toBe(400); // refundStale() throws InvalidTransitionError from SETTLED

    const reloaded = await Duel.findById(settledDuel._id);
    expect(reloaded?.status).toBe('SETTLED'); // unchanged
  });
});
