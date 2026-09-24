import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { decodeFunctionData, parseAbi } from 'viem';

const { writeContract } = vi.hoisted(() => ({ writeContract: vi.fn() }));
vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  createWalletClient: () => ({ writeContract }),
}));

const chainVerifyMocks = vi.hoisted(() => ({ verifyDuelSettled: vi.fn() }));
vi.mock('@/lib/chainVerify', () => chainVerifyMocks);

// Real signing logic by default; individual tests make it fail to reach refundStale().
vi.mock('@/lib/duelEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/duelEngine')>();
  return { ...actual, maybeSettle: vi.fn(actual.maybeSettle), retrySettlementSigning: vi.fn(actual.retrySettlementSigning) };
});

import { runKeeperTick } from '@/lib/settlementRelayer';
import { maybeSettle } from '@/lib/duelEngine';
import {
  publicClient,
  EscrowStatus,
  readEscrowStatus,
  readEscrowWinnerSide,
  readFactoryPaused,
} from '@/lib/chainClient';
import Duel from '@/lib/models/Duel';
import KeeperLock from '@/lib/models/KeeperLock';
import CombatRecord from '@/lib/models/CombatRecord';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuel, makeTokenSide } from '../helpers/duelFixtures';

// Anvil's well-known test key #2 -- a stand-in hot wallet, never a real secret.
const RELAYER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const OPPONENT = '0xrelayopponent0000000000000000000000001';
const TX = `0x${'ab'.repeat(32)}` as `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const simulate = vi.mocked(publicClient.simulateContract);
const waitForReceipt = vi.mocked(publicClient.waitForTransactionReceipt);
const statusMock = vi.mocked(readEscrowStatus);

let escrowCounter = 0;
function nextEscrow(): `0x${string}` {
  escrowCounter += 1;
  return `0x10000000000000000000000000000000000${String(escrowCounter).padStart(5, '0')}` as `0x${string}`;
}

/**
 * A fake chain: every escrow sits at its starting status until a transaction
 * is sent, then moves to the status that call produces -- unless listed in
 * `failOnChain` (its call reverted inside the batch).
 */
function fakeChain(start: Record<string, number>, failOnChain: Set<string> = new Set()) {
  const state = new Map(Object.entries(start).map(([k, v]) => [k.toLowerCase(), v]));
  statusMock.mockImplementation(async (escrow) => state.get(escrow.toLowerCase()) ?? EscrowStatus.Active);
  writeContract.mockImplementation(async (req: { address: string; functionName: string; args: unknown[] }) => {
    const calls =
      req.functionName === 'aggregate3'
        ? (req.args[0] as { target: string; callData: `0x${string}` }[]).map((c) => ({
            target: c.target,
            fn: decodeFunctionData({ abi: parseAbi(['function settle(uint8,address,uint256,address,uint256,bytes)', 'function expire()', 'function refundStale()']), data: c.callData }).functionName,
          }))
        : [{ target: req.address, fn: req.functionName }];
    for (const { target, fn } of calls) {
      if (failOnChain.has(target.toLowerCase())) continue;
      state.set(target.toLowerCase(), fn === 'settle' ? EscrowStatus.Settled : EscrowStatus.Refunded);
    }
    return TX;
  });
  return state;
}

async function createSettlingDuel(overrides: { relayLockedUntil?: Date; escrow?: `0x${string}` } = {}) {
  const duel = await createDuel({
    status: 'SETTLING',
    opponentWallet: OPPONENT,
    escrowAddress: overrides.escrow ?? nextEscrow(),
    startTime: new Date(Date.now() - 3_600_000),
    endTime: new Date(Date.now() - 60_000),
    tokenA: makeTokenSide({ startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_000_000 }),
    tokenB: makeTokenSide({ startMarketCapUsd: 1_000_000, sustainedPeakMarketCapUsd: 1_400_000 }),
  });
  duel.winnerSide = 1;
  duel.oracleSignature = `0x${'cd'.repeat(65)}`;
  if (overrides.relayLockedUntil) duel.relayLockedUntil = overrides.relayLockedUntil;
  await duel.save();
  return duel;
}

async function createExpiredLobby(openDeadline = new Date(Date.now() - 60_000)) {
  return createDuel({ status: 'OPEN', escrowAddress: nextEscrow(), openDeadline });
}

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  vi.clearAllMocks();
  process.env.RELAYER_PRIVATE_KEY = RELAYER_KEY;
  statusMock.mockResolvedValue(EscrowStatus.Active);
  vi.mocked(readFactoryPaused).mockResolvedValue(false);
  simulate.mockResolvedValue({ request: {} } as never);
  writeContract.mockResolvedValue(TX);
  waitForReceipt.mockResolvedValue({ status: 'success' } as never);
  chainVerifyMocks.verifyDuelSettled.mockResolvedValue({ winnerSide: 1, deferredPayouts: [] });
});

afterAll(async () => {
  delete process.env.RELAYER_PRIVATE_KEY;
  await mongoose.connection.close();
});

describe('keeper tick: settle()', () => {
  it('pays out a signed duel: dry-runs settle() with the stored terms, sends it, verifies Settled, finalizes the DB', async () => {
    const duel = await createSettlingDuel();
    fakeChain({ [duel.escrowAddress!]: EscrowStatus.Active });

    const result = await runKeeperTick({ multicall3: undefined });

    expect(result.outcomes).toEqual({ 'settle:settled': 1 });
    expect(result.transactions).toBe(1);
    expect(simulate).toHaveBeenCalledWith(
      expect.objectContaining({
        address: duel.escrowAddress,
        functionName: 'settle',
        args: [1, ZERO_ADDRESS, 0n, ZERO_ADDRESS, 0n, duel.oracleSignature],
      })
    );
    expect(chainVerifyMocks.verifyDuelSettled).toHaveBeenCalledWith(TX, duel.escrowAddress);
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('SETTLED');
    expect(reloaded?.winnerPoints).toBeGreaterThan(0);
    expect((await CombatRecord.findOne({ wallet: OPPONENT }))?.wins).toBe(1);
  });

  it('records PayoutDeferred events from the settle() receipt', async () => {
    const duel = await createSettlingDuel();
    fakeChain({ [duel.escrowAddress!]: EscrowStatus.Active });
    chainVerifyMocks.verifyDuelSettled.mockResolvedValue({ winnerSide: 1, deferredPayouts: [{ to: OPPONENT, amount: '160000000' }] });
    await runKeeperTick({ multicall3: undefined });
    expect((await Duel.findById(duel._id))?.toObject().deferredPayouts).toEqual([{ to: OPPONENT, amount: '160000000' }]);
  });

  it('IDEMPOTENT: escrow already Settled on-chain -- syncs the DB, sends nothing', async () => {
    const duel = await createSettlingDuel();
    statusMock.mockResolvedValue(EscrowStatus.Settled);
    vi.mocked(readEscrowWinnerSide).mockResolvedValue(1);
    const result = await runKeeperTick();
    expect(result.outcomes).toEqual({ 'settle:synced': 1 });
    expect(writeContract).not.toHaveBeenCalled();
    expect((await Duel.findById(duel._id))?.status).toBe('SETTLED');
  });

  it('IDEMPOTENT: escrow already Refunded on-chain -- marks it refunded, no points, nothing sent', async () => {
    const duel = await createSettlingDuel();
    statusMock.mockResolvedValue(EscrowStatus.Refunded);
    expect((await runKeeperTick()).outcomes).toEqual({ 'settle:refunded': 1 });
    expect(writeContract).not.toHaveBeenCalled();
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).not.toBe('SETTLED');
    expect(reloaded?.winnerPoints).toBeUndefined();
  });

  it('IDEMPOTENT: a second tick after success sends nothing and never double-credits points', async () => {
    const duel = await createSettlingDuel();
    fakeChain({ [duel.escrowAddress!]: EscrowStatus.Active });
    await runKeeperTick({ multicall3: undefined });
    const second = await runKeeperTick({ multicall3: undefined });
    expect(second.transactions).toBe(0);
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect((await CombatRecord.findOne({ wallet: OPPONENT }))?.wins).toBe(1);
  });

  it('factory paused: settle() is held back, but expire() of a lobby still goes out the same tick', async () => {
    const settling = await createSettlingDuel();
    const lobby = await createExpiredLobby();
    fakeChain({ [settling.escrowAddress!]: EscrowStatus.Active, [lobby.escrowAddress!]: EscrowStatus.Open });
    vi.mocked(readFactoryPaused).mockResolvedValue(true);

    const result = await runKeeperTick({ multicall3: undefined });

    expect(result.outcomes).toEqual({ 'settle:paused': 1, 'expire:expired': 1 });
    expect((await Duel.findById(settling._id))?.status).toBe('SETTLING');
    expect((await Duel.findById(lobby._id))?.status).toBe('EXPIRED');
  });

  it('a call whose dry-run reverts is never sent (no gas burned), and the duel stays for a later tick', async () => {
    const duel = await createSettlingDuel();
    simulate.mockRejectedValue(new Error('execution reverted: invalid oracle signature'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runKeeperTick();
    warn.mockRestore();
    expect(result.outcomes).toEqual({ 'settle:rejected': 1 });
    expect(writeContract).not.toHaveBeenCalled();
    expect((await Duel.findById(duel._id))?.status).toBe('SETTLING');
  });
});

describe('keeper tick: automatic refunds', () => {
  it('expire(): refunds an unmatched lobby past its open window and marks it EXPIRED', async () => {
    const lobby = await createExpiredLobby();
    fakeChain({ [lobby.escrowAddress!]: EscrowStatus.Open });

    const result = await runKeeperTick({ multicall3: undefined });

    expect(result.outcomes).toEqual({ 'expire:expired': 1 });
    expect(simulate).toHaveBeenCalledWith(expect.objectContaining({ address: lobby.escrowAddress, functionName: 'expire' }));
    expect((await Duel.findById(lobby._id))?.status).toBe('EXPIRED');
  });

  it('leaves a lobby alone while its open window is still running', async () => {
    const lobby = await createExpiredLobby(new Date(Date.now() + 60_000));
    const result = await runKeeperTick();
    expect(result.outcomes).toEqual({});
    expect((await Duel.findById(lobby._id))?.status).toBe('OPEN');
  });

  it('a lobby the creator already reclaimed themselves just syncs to EXPIRED', async () => {
    const lobby = await createExpiredLobby();
    statusMock.mockResolvedValue(EscrowStatus.Refunded);
    expect((await runKeeperTick()).outcomes).toEqual({ 'expire:synced': 1 });
    expect(writeContract).not.toHaveBeenCalled();
    expect((await Duel.findById(lobby._id))?.status).toBe('EXPIRED');
  });

  it('refundStale(): refunds both players of a duel the oracle never signed, 24h after it ended', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: OPPONENT,
      escrowAddress: nextEscrow(),
      startTime: new Date(Date.now() - 26 * 3600_000),
      endTime: new Date(Date.now() - 25 * 3600_000),
    });
    vi.mocked(maybeSettle).mockResolvedValueOnce(undefined); // signing fails to happen
    fakeChain({ [duel.escrowAddress!]: EscrowStatus.Active });

    const result = await runKeeperTick({ multicall3: undefined });

    expect(result.outcomes).toEqual({ 'refundStale:refunded': 1 });
    expect(simulate).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'refundStale' }));
    expect((await Duel.findById(duel._id))?.status).not.toBe('LIVE');
  });

  it('never refundStale()s a HELD duel -- that waits for an admin', async () => {
    await createDuel({ status: 'HELD', escrowAddress: nextEscrow(), endTime: new Date(Date.now() - 25 * 3600_000) });
    expect((await runKeeperTick()).outcomes).toEqual({});
  });
});

describe('keeper tick: batching through Multicall3', () => {
  it('pays out and refunds many duels in ONE transaction', async () => {
    const settling = await Promise.all([createSettlingDuel(), createSettlingDuel(), createSettlingDuel()]);
    const lobby = await createExpiredLobby();
    fakeChain({
      ...Object.fromEntries(settling.map((d) => [d.escrowAddress!, EscrowStatus.Active])),
      [lobby.escrowAddress!]: EscrowStatus.Open,
    });

    const result = await runKeeperTick({ multicall3: MULTICALL3 });

    expect(result.transactions).toBe(1);
    expect(writeContract).toHaveBeenCalledTimes(1);
    const req = writeContract.mock.calls[0][0];
    expect(req.address).toBe(MULTICALL3);
    expect(req.functionName).toBe('aggregate3');
    const calls = req.args[0] as { target: string; allowFailure: boolean; callData: `0x${string}` }[];
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.allowFailure)).toBe(true);
    expect(result.outcomes).toEqual({ 'settle:settled': 3, 'expire:expired': 1 });
    for (const d of settling) expect((await Duel.findById(d._id))?.status).toBe('SETTLED');
    expect((await Duel.findById(lobby._id))?.status).toBe('EXPIRED');
  });

  it('one call reverting inside the batch does not block the others', async () => {
    const [ok, bad] = await Promise.all([createSettlingDuel(), createSettlingDuel()]);
    fakeChain(
      { [ok.escrowAddress!]: EscrowStatus.Active, [bad.escrowAddress!]: EscrowStatus.Active },
      new Set([bad.escrowAddress!.toLowerCase()])
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runKeeperTick({ multicall3: MULTICALL3 });
    warn.mockRestore();
    expect(result.outcomes).toEqual({ 'settle:settled': 1, 'settle:failed': 1 });
    expect((await Duel.findById(ok._id))?.status).toBe('SETTLED');
    expect((await Duel.findById(bad._id))?.status).toBe('SETTLING');
  });

  it('100 duels ending at once go out in a handful of transactions, not 100', async () => {
    const duels = [];
    for (let i = 0; i < 100; i++) duels.push(await createSettlingDuel());
    fakeChain(Object.fromEntries(duels.map((d) => [d.escrowAddress!, EscrowStatus.Active])));

    const result = await runKeeperTick({ multicall3: MULTICALL3 });

    expect(result.transactions).toBe(4); // ceil(100 / 30)
    expect(result.outcomes).toEqual({ 'settle:settled': 100 });
    expect(await Duel.countDocuments({ status: 'SETTLED' })).toBe(100);
  });
});

describe('keeper tick: safety', () => {
  it('another tick holding the send lock: this one sends nothing and reports busy', async () => {
    await createSettlingDuel();
    await KeeperLock.create({ _id: 'relayer', lockedUntil: new Date(Date.now() + 60_000), holder: 'other' });
    const result = await runKeeperTick();
    expect(result.busy).toBe(true);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('releases the send lock when done, so the next tick can run', async () => {
    const duel = await createSettlingDuel();
    fakeChain({ [duel.escrowAddress!]: EscrowStatus.Active });
    await runKeeperTick({ multicall3: undefined });
    const lock = await KeeperLock.findById('relayer');
    expect(lock!.lockedUntil.getTime()).toBeLessThan(Date.now());
  });

  it('a broadcast tx that never produced a receipt leaves its duels leased, so no duplicate tx is sent', async () => {
    const duel = await createSettlingDuel();
    waitForReceipt.mockRejectedValueOnce(new Error('timed out'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await runKeeperTick({ multicall3: undefined });
    errSpy.mockRestore();
    expect(first.outcomes).toEqual({ 'settle:failed': 1 });
    expect((await Duel.findById(duel._id))?.relayLockedUntil?.getTime()).toBeGreaterThan(Date.now());

    const second = await runKeeperTick({ multicall3: undefined });
    expect(second.transactions).toBe(0);
    expect(writeContract).toHaveBeenCalledTimes(1);
  });

  it('never throws on an unexpected RPC failure', async () => {
    await createSettlingDuel();
    statusMock.mockRejectedValue(new Error('rpc down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runKeeperTick();
    errSpy.mockRestore();
    expect(result.outcomes).toEqual({ 'settle:failed': 1 });
  });

  it('without RELAYER_PRIVATE_KEY: still signs, sends nothing, reports unconfigured', async () => {
    delete process.env.RELAYER_PRIVATE_KEY;
    await createSettlingDuel();
    const result = await runKeeperTick();
    expect(result.unconfigured).toBe(true);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('refuses to send from the oracle signer key', async () => {
    process.env.RELAYER_PRIVATE_KEY = process.env.ORACLE_SIGNER_PRIVATE_KEY;
    await createSettlingDuel();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runKeeperTick();
    errSpy.mockRestore();
    expect(writeContract).not.toHaveBeenCalled();
  });
});
