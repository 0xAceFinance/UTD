import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { recoverAddress, hashMessage, keccak256, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// The only external-network dependency simulateTick/maybeSettle pull in --
// everything else (engine's real oracle pipeline, matchmaking's real state
// machine, risk's real wallet clustering) runs unmocked against the
// in-memory DB, per the task's "don't mock the pipeline" instruction.
// vi.mock factories are hoisted above all imports, so the mock fn itself
// must be created through vi.hoisted() to avoid a temporal-dead-zone error.
const { getLivePoolSamples } = vi.hoisted(() => ({ getLivePoolSamples: vi.fn() }));
vi.mock('@/lib/dexScreenerSource', () => ({ getLivePoolSamples }));

import { simulateTick, maybeSettle, finalizeSettlement, retrySettlementSigning } from '@/lib/duelEngine';
import WalletSighting from '@/lib/models/WalletSighting';
import CombatRecord from '@/lib/models/CombatRecord';
import Duel, { type IDuel } from '@/lib/models/Duel';
import { CONTRACTS } from '@/config/contracts';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuel, makeSampleSeries, makeTokenSide } from '../helpers/duelFixtures';

// Mirrors lib/duelEngine.ts's own (unexported) constants -- see that file's
// doc comments. If these ever change, these tests should be updated to match.
const MIN_SAMPLE_INTERVAL_SEC = 15;
const MAX_SAMPLES_PER_SIDE = 4000;

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  getLivePoolSamples.mockReset();
  getLivePoolSamples.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await mongoose.connection.close();
});

/** Neuters a side so refreshSide's very first guard clause no-ops it, keeping
 * assertions about the *other* side's fetch behavior uncontaminated. */
function neuter(side: { tokenAddress?: string; totalSupply?: number }) {
  side.tokenAddress = undefined;
  side.totalSupply = undefined;
}

describe('lib/duelEngine::simulateTick', () => {
  it('throttles fresh pool fetches to at most once per MIN_SAMPLE_INTERVAL_SEC', async () => {
    const nowSec = 2_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowSec * 1000);

    const duel = await createDuel({
      status: 'LIVE',
      startTime: new Date((nowSec - 500) * 1000),
      endTime: new Date((nowSec + 500) * 1000),
      tokenA: { rawSamples: makeSampleSeries({ tokenAddress: 'tokA', priceUsd: 1, liquidityUsd: 100_000, fromSec: nowSec - 10, toSec: nowSec - 10, stepSec: 1 }) },
    });
    neuter(duel.tokenB);

    // Last sample is only 10s old -- under the 15s throttle -- so the first
    // tick must not fetch.
    await simulateTick(duel);
    expect(getLivePoolSamples).not.toHaveBeenCalled();

    // Advance past the throttle window; now it must fetch.
    vi.setSystemTime((nowSec + 20) * 1000);
    await simulateTick(duel);
    expect(getLivePoolSamples).toHaveBeenCalledTimes(1);
    expect(getLivePoolSamples).toHaveBeenCalledWith(duel.tokenA.tokenAddress);
  });

  it('caps stored raw samples per side at MAX_SAMPLES_PER_SIDE, dropping the oldest first', async () => {
    const nowSec = 3_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowSec * 1000);

    const oldSamples = makeSampleSeries({
      tokenAddress: 'tokA',
      priceUsd: 1,
      liquidityUsd: 100_000,
      fromSec: 0,
      toSec: (MAX_SAMPLES_PER_SIDE - 1) * 10,
      stepSec: 10,
    });
    expect(oldSamples).toHaveLength(MAX_SAMPLES_PER_SIDE);
    const firstOriginalSample = oldSamples[0];

    const duel = await createDuel({
      status: 'LIVE',
      startTime: new Date((nowSec - 500) * 1000),
      endTime: new Date((nowSec + 500) * 1000),
      tokenA: { rawSamples: oldSamples, startLiquidityUsd: 100_000 },
    });
    neuter(duel.tokenB);

    getLivePoolSamples.mockResolvedValueOnce([
      { poolAddress: 'FRESH-MARKER', tokenAddress: duel.tokenA.tokenAddress!, dexName: 'test', reserveToken: 50_000, reserveQuote: 50_000, quotePriceUsd: 1, timestampSec: nowSec },
    ]);

    await simulateTick(duel);

    expect(duel.tokenA.rawSamples).toHaveLength(MAX_SAMPLES_PER_SIDE);
    expect(duel.tokenA.rawSamples[duel.tokenA.rawSamples.length - 1].poolAddress).toBe('FRESH-MARKER');
    expect(duel.tokenA.rawSamples.some((s: { poolAddress: string; timestampSec: number }) => s.poolAddress === firstOriginalSample.poolAddress && s.timestampSec === firstOriginalSample.timestampSec)).toBe(false);
  });

  it('is a no-op for a duel that is not LIVE', async () => {
    const duel = await createDuel({ status: 'OPEN' });
    await simulateTick(duel);
    expect(getLivePoolSamples).not.toHaveBeenCalled();
  });

  it('leaves a side untouched if it has no tokenAddress/totalSupply (pre-chain-integration duel)', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      startTime: new Date(Date.now() - 500_000),
      endTime: new Date(Date.now() + 500_000),
    });
    neuter(duel.tokenA);
    neuter(duel.tokenB);
    const before = JSON.parse(JSON.stringify(duel.tokenA));
    await simulateTick(duel);
    expect(JSON.parse(JSON.stringify(duel.tokenA))).toEqual(before);
    expect(getLivePoolSamples).not.toHaveBeenCalled();
  });
});

describe('lib/duelEngine::maybeSettle winner determination', () => {
  /** Side A: flat price the whole battle -- 0% return. */
  function flatSide(tokenAddress: string) {
    return makeTokenSide({
      tokenAddress,
      totalSupply: 1_000_000,
      startMarketCapUsd: 1_000_000,
      startLiquidityUsd: 100_000,
      rawSamples: makeSampleSeries({ tokenAddress, priceUsd: 1, liquidityUsd: 100_000, fromSec: 0, toSec: 90, stepSec: 15 }),
    });
  }

  /** Side B: price steps up 50% and holds for the full sustained-peak dwell window -- validated +50% return. */
  function pumpingSide(tokenAddress: string) {
    const flat = makeSampleSeries({ tokenAddress, priceUsd: 1, liquidityUsd: 100_000, fromSec: 0, toSec: 30, stepSec: 15 });
    const pumped = makeSampleSeries({ tokenAddress, priceUsd: 1.5, liquidityUsd: 100_000, fromSec: 45, toSec: 150, stepSec: 15 });
    return makeTokenSide({
      tokenAddress,
      totalSupply: 1_000_000,
      startMarketCapUsd: 1_000_000,
      startLiquidityUsd: 100_000,
      rawSamples: [...flat, ...pumped],
    });
  }

  it('picks the side whose sustained-peak market cap grew more (side B pumps, wins)', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: '0xopponent000000000000000000000000000001',
      startTime: new Date(Date.now() - 10_000_000),
      endTime: new Date(Date.now() - 1_000),
      tokenA: flatSide('0xflatAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'),
      tokenB: pumpingSide('0xpumpBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'),
    });

    await maybeSettle(duel);

    expect(duel.winnerSide).toBe(1);
    expect(duel.status).toBe('SETTLED'); // legacy off-chain duel (no escrowAddress) settles immediately
    expect(duel.tokenB.sustainedPeakMarketCapUsd).toBeGreaterThan(duel.tokenA.sustainedPeakMarketCapUsd);
  });

  it('an exact tie in return% resolves to side A (documents actual, non-randomized tie behavior -- see computeWinnerSide\'s ">=" comparison in lib/duelEngine.ts)', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: '0xopponent000000000000000000000000000002',
      startTime: new Date(Date.now() - 10_000_000),
      endTime: new Date(Date.now() - 1_000),
      tokenA: flatSide('0xtieAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'),
      tokenB: flatSide('0xtieBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'),
    });

    await maybeSettle(duel);

    expect(duel.winnerSide).toBe(0);
  });

  it('does not settle a LIVE duel before its endTime has elapsed', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: '0xopponent000000000000000000000000000003',
      startTime: new Date(Date.now() - 1000),
      endTime: new Date(Date.now() + 10_000_000), // far in the future
    });
    await maybeSettle(duel);
    expect(duel.status).toBe('LIVE');
    expect(duel.winnerSide).toBeUndefined();
  });

  it('on-chain duel: signs the settlement with a signature that verifies against the configured oracle key, and stops at SETTLING', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: '0xopponent000000000000000000000000000004',
      escrowAddress: '0x1000000000000000000000000000000000000001',
      startTime: new Date(Date.now() - 10_000_000),
      endTime: new Date(Date.now() - 1_000),
      tokenA: flatSide('0xchainAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'),
      tokenB: pumpingSide('0xchainBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'),
    });

    await maybeSettle(duel);

    expect(duel.status).toBe('SETTLING');
    expect(duel.winnerSide).toBe(1);
    expect(duel.oracleSignature).toBeTruthy();

    const expectedSigner = privateKeyToAccount(process.env.ORACLE_SIGNER_PRIVATE_KEY as `0x${string}`).address;
    // Neither wallet has any WhitelistEntry referral attribution set up here,
    // so computeReferralSnapshot resolves to no referrer on either side --
    // the message is signed with NO_REFERRERS (zero address, zero bps both sides).
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const message = keccak256(
      encodePacked(
        ['address', 'uint8', 'address', 'uint256', 'address', 'uint256', 'uint256'],
        [duel.escrowAddress as `0x${string}`, 1, ZERO_ADDRESS, 0n, ZERO_ADDRESS, 0n, BigInt(CONTRACTS.chainId)]
      )
    );
    const digest = hashMessage({ raw: message });
    const recovered = await recoverAddress({ hash: digest, signature: duel.oracleSignature as `0x${string}` });
    expect(recovered.toLowerCase()).toBe(expectedSigner.toLowerCase());

    // Referral snapshot fields persist even when empty (0 bps, no referrer).
    expect(duel.creatorReferrerBps).toBe(0);
    expect(duel.opponentReferrerBps).toBe(0);

    // Points/CombatRecord must NOT be awarded yet -- they wait for confirm-settlement.
    expect(duel.winnerPoints).toBeUndefined();
  });

  it('MONEY SAFETY: a suspected sybil match is HELD and never produces an oracle signature, even for an on-chain duel', async () => {
    const creatorWallet = '0xsybilcreator00000000000000000000000001';
    const opponentWallet = '0xsybilopponent0000000000000000000000001';
    const sharedIp = '203.0.113.42';
    await WalletSighting.create({ wallet: creatorWallet, ip: sharedIp });
    await WalletSighting.create({ wallet: opponentWallet, ip: sharedIp });

    const duel = await createDuel({
      status: 'LIVE',
      creatorWallet,
      opponentWallet,
      escrowAddress: '0x1000000000000000000000000000000000000002',
      startTime: new Date(Date.now() - 10_000_000),
      endTime: new Date(Date.now() - 1_000),
      tokenA: flatSide('0xsybilAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'),
      tokenB: pumpingSide('0xsybilBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'),
    });

    await maybeSettle(duel);

    expect(duel.status).toBe('HELD');
    expect(duel.flaggedSybil).toBe(true);
    // The real-money-safety invariant: no signature was ever produced for a
    // flagged match, since BattleEscrow.settle() is permissionless once a
    // valid signature exists -- a flag issued after signing couldn't stop
    // the payout.
    expect(duel.oracleSignature).toBeUndefined();
    expect(duel.winnerPoints).toBeUndefined();
  });

  it('legacy off-chain duel (no escrowAddress) settles immediately and awards points/CombatRecord', async () => {
    const creatorWallet = '0xlegacycreator0000000000000000000000001';
    const opponentWallet = '0xlegacyopponent000000000000000000000001';
    const duel = await createDuel({
      status: 'LIVE',
      creatorWallet,
      opponentWallet,
      creatorSide: 0,
      buyInUsd: 200,
      startTime: new Date(Date.now() - 10_000_000),
      endTime: new Date(Date.now() - 1_000),
      tokenA: flatSide('0xlegacyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'),
      tokenB: pumpingSide('0xlegacyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'),
    });

    await maybeSettle(duel);

    expect(duel.status).toBe('SETTLED');
    expect(duel.winnerSide).toBe(1);
    expect(duel.winnerPoints).toBeGreaterThan(0);
    expect(duel.loserPoints).toBeGreaterThan(0);
    expect(duel.winnerPoints).toBeGreaterThan(duel.loserPoints!);

    const winnerRecord = await CombatRecord.findOne({ wallet: opponentWallet.toLowerCase() });
    const loserRecord = await CombatRecord.findOne({ wallet: creatorWallet.toLowerCase() });
    expect(winnerRecord?.wins).toBe(1);
    expect(winnerRecord?.totalPoints).toBe(duel.winnerPoints);
    expect(loserRecord?.losses).toBe(1);
    expect(loserRecord?.totalPoints).toBe(duel.loserPoints);
  });

  it('MONEY SAFETY: concurrent maybeSettle calls for the same duel award points exactly once', async () => {
    // Simulates two concurrent GET /api/duels/[id] polls (two tabs, a retried
    // request, or two serverless instances) each independently fetching their
    // own copy of the same LIVE duel and racing to settle it.
    const creatorWallet = '0xracecreator00000000000000000000000001';
    const opponentWallet = '0xraceopponent0000000000000000000000001';
    const buyInUsd = 200;
    const saved = await createDuel({
      status: 'LIVE',
      creatorWallet,
      opponentWallet,
      creatorSide: 0,
      buyInUsd,
      startTime: new Date(Date.now() - 10_000_000),
      endTime: new Date(Date.now() - 1_000),
      tokenA: flatSide('0xraceAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'),
      tokenB: pumpingSide('0xraceBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'),
    });

    const [copyA, copyB] = await Promise.all([
      Duel.findById(saved._id) as Promise<IDuel>,
      Duel.findById(saved._id) as Promise<IDuel>,
    ]);

    await Promise.all([maybeSettle(copyA), maybeSettle(copyB)]);

    const winnerRecord = await CombatRecord.findOne({ wallet: opponentWallet.toLowerCase() });
    const loserRecord = await CombatRecord.findOne({ wallet: creatorWallet.toLowerCase() });
    // Exactly one of the two racing calls should have won the atomic claim
    // and awarded points -- never both, never neither.
    expect(winnerRecord?.wins).toBe(1);
    expect(winnerRecord?.totalPoints).toBeGreaterThan(0);
    expect(loserRecord?.losses).toBe(1);

    const settled = await Duel.findById(saved._id);
    expect(settled!.status).toBe('SETTLED');
  });
});

describe('lib/duelEngine::retrySettlementSigning', () => {
  it('repairs a duel stranded at SETTLING with no signature: signs it and persists winnerSide + oracleSignature', async () => {
    const duel = await createDuel({
      status: 'SETTLING',
      opponentWallet: '0xretryopponent00000000000000000000000001',
      escrowAddress: '0x1000000000000000000000000000000000000005',
      tokenA: { startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_000_000 },
      tokenB: { startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_500_000 },
    });
    expect(duel.oracleSignature).toBeUndefined();
    expect(duel.winnerSide).toBeUndefined();

    await retrySettlementSigning(duel);

    expect(duel.status).toBe('SETTLING');
    expect(duel.winnerSide).toBe(1); // token B's stored peak already shows the bigger gain
    expect(duel.oracleSignature).toBeTruthy();

    const expectedSigner = privateKeyToAccount(process.env.ORACLE_SIGNER_PRIVATE_KEY as `0x${string}`).address;
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const message = keccak256(
      encodePacked(
        ['address', 'uint8', 'address', 'uint256', 'address', 'uint256', 'uint256'],
        [duel.escrowAddress as `0x${string}`, 1, ZERO_ADDRESS, 0n, ZERO_ADDRESS, 0n, BigInt(CONTRACTS.chainId)]
      )
    );
    const digest = hashMessage({ raw: message });
    const recovered = await recoverAddress({ hash: digest, signature: duel.oracleSignature as `0x${string}` });
    expect(recovered.toLowerCase()).toBe(expectedSigner.toLowerCase());

    // Persisted, not just held in memory on the passed-in doc.
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded!.oracleSignature).toBe(duel.oracleSignature);
    expect(reloaded!.winnerSide).toBe(1);
  });

  it('is a no-op for a duel that already has a signature', async () => {
    const duel = await createDuel({
      status: 'SETTLING',
      escrowAddress: '0x1000000000000000000000000000000000000006',
    });
    duel.winnerSide = 0;
    duel.oracleSignature = '0xalready-signed';
    await duel.save();

    await retrySettlementSigning(duel);

    expect(duel.oracleSignature).toBe('0xalready-signed');
  });

  it('is a no-op for a duel not at SETTLING', async () => {
    const duel = await createDuel({ status: 'LIVE', escrowAddress: '0x1000000000000000000000000000000000000007' });
    await retrySettlementSigning(duel);
    expect(duel.oracleSignature).toBeUndefined();
  });

  it('is a no-op for an off-chain duel (no escrowAddress) -- nothing to sign for', async () => {
    const duel = await createDuel({ status: 'SETTLING' });
    await retrySettlementSigning(duel);
    expect(duel.oracleSignature).toBeUndefined();
  });
});

describe('lib/duelEngine::finalizeSettlement', () => {
  it('awards the winner wallet, not just whichever side index won (creatorSide=1 case)', async () => {
    const creatorWallet = '0xfinalizecreator00000000000000000000001';
    const opponentWallet = '0xfinalizeopponent0000000000000000000001';
    // Creator plays side 1 -- winnerSide 1 must credit the CREATOR, not the opponent.
    const duel = await createDuel({
      status: 'SETTLING',
      creatorWallet,
      opponentWallet,
      creatorSide: 1,
      tokenA: { startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_000_000 },
      tokenB: { startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_500_000 },
    });

    await finalizeSettlement(duel, 1);

    const creatorRecord = await CombatRecord.findOne({ wallet: creatorWallet.toLowerCase() });
    const opponentRecord = await CombatRecord.findOne({ wallet: opponentWallet.toLowerCase() });
    expect(creatorRecord?.wins).toBe(1);
    expect(opponentRecord?.losses).toBe(1);
  });
});
