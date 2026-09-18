import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';

const { writeContract } = vi.hoisted(() => ({ writeContract: vi.fn() }));
vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  createWalletClient: () => ({ writeContract }),
}));

const chainVerifyMocks = vi.hoisted(() => ({ verifyDuelSettled: vi.fn() }));
vi.mock('@/lib/chainVerify', () => chainVerifyMocks);

import { submitSettlement } from '@/lib/settlementRelayer';
import {
  publicClient,
  EscrowStatus,
  readEscrowStatus,
  readEscrowWinnerSide,
  readFactoryPaused,
} from '@/lib/chainClient';
import Duel from '@/lib/models/Duel';
import CombatRecord from '@/lib/models/CombatRecord';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuel, makeTokenSide } from '../helpers/duelFixtures';

// Anvil's well-known test key #2 -- a stand-in hot wallet, never a real secret.
const RELAYER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const ESCROW = '0x1000000000000000000000000000000000000077';
const OPPONENT = '0xrelayopponent0000000000000000000000001';
const TX = `0x${'ab'.repeat(32)}` as `0x${string}`;

const simulate = vi.mocked(publicClient.simulateContract);
const waitForReceipt = vi.mocked(publicClient.waitForTransactionReceipt);

async function createSettlingDuel(overrides: { relayLockedUntil?: Date } = {}) {
  const duel = await createDuel({
    status: 'SETTLING',
    opponentWallet: OPPONENT,
    escrowAddress: ESCROW,
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

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
  vi.clearAllMocks();
  process.env.RELAYER_PRIVATE_KEY = RELAYER_KEY;
  vi.mocked(readEscrowStatus).mockResolvedValue(EscrowStatus.Active);
  vi.mocked(readFactoryPaused).mockResolvedValue(false);
  simulate.mockResolvedValue({ request: { fake: 'request' } } as never);
  writeContract.mockResolvedValue(TX);
  waitForReceipt.mockResolvedValue({ status: 'success' } as never);
  chainVerifyMocks.verifyDuelSettled.mockResolvedValue({ winnerSide: 1, deferredPayouts: [] });
});

afterAll(async () => {
  delete process.env.RELAYER_PRIVATE_KEY;
  await mongoose.connection.close();
});

describe('lib/settlementRelayer::submitSettlement', () => {
  it('submits settle() with the stored signature, verifies the Settled event, and finalizes the duel', async () => {
    const duel = await createSettlingDuel();

    expect(await submitSettlement(duel)).toBe('settled');

    expect(simulate).toHaveBeenCalledWith(
      expect.objectContaining({ address: ESCROW, functionName: 'settle', args: [1, duel.oracleSignature] })
    );
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect(chainVerifyMocks.verifyDuelSettled).toHaveBeenCalledWith(TX, ESCROW);
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('SETTLED');
    expect(reloaded?.winnerPoints).toBeGreaterThan(0);
    expect(reloaded?.relayLockedUntil).toBeUndefined();
    expect((await CombatRecord.findOne({ wallet: OPPONENT }))?.wins).toBe(1);
  });

  it('records PayoutDeferred events from the settle() receipt', async () => {
    chainVerifyMocks.verifyDuelSettled.mockResolvedValue({
      winnerSide: 1,
      deferredPayouts: [{ to: OPPONENT, amount: '160000000' }],
    });
    const duel = await createSettlingDuel();
    await submitSettlement(duel);
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.toObject().deferredPayouts).toEqual([{ to: OPPONENT, amount: '160000000' }]);
  });

  it('IDEMPOTENT: escrow already Settled on-chain -- syncs the DB from the chain, sends no transaction', async () => {
    vi.mocked(readEscrowStatus).mockResolvedValue(EscrowStatus.Settled);
    vi.mocked(readEscrowWinnerSide).mockResolvedValue(1);
    const duel = await createSettlingDuel();

    expect(await submitSettlement(duel)).toBe('synced');

    expect(writeContract).not.toHaveBeenCalled();
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('SETTLED');
    expect(reloaded?.winnerSide).toBe(1);
  });

  it('IDEMPOTENT: escrow already Refunded on-chain -- marks it refunded, no points, no transaction', async () => {
    vi.mocked(readEscrowStatus).mockResolvedValue(EscrowStatus.Refunded);
    const duel = await createSettlingDuel();

    expect(await submitSettlement(duel)).toBe('refunded');

    expect(writeContract).not.toHaveBeenCalled();
    expect((await Duel.findById(duel._id))?.status).toBe('CANCELLED');
    expect(await CombatRecord.countDocuments()).toBe(0);
  });

  it('IDEMPOTENT: a second call after success does nothing and never double-credits points', async () => {
    const duel = await createSettlingDuel();
    await submitSettlement(duel);
    const fresh = await Duel.findById(duel._id);

    expect(await submitSettlement(fresh!)).toBe('skipped');
    expect(writeContract).toHaveBeenCalledTimes(1);
    expect((await CombatRecord.findOne({ wallet: OPPONENT }))?.wins).toBe(1);
  });

  it('a "not active" revert (someone else settled first) re-reads the chain and syncs', async () => {
    vi.mocked(readEscrowStatus)
      .mockResolvedValueOnce(EscrowStatus.Active)
      .mockResolvedValueOnce(EscrowStatus.Settled);
    vi.mocked(readEscrowWinnerSide).mockResolvedValue(1);
    simulate.mockRejectedValue(new Error('The contract function "settle" reverted with the following reason:\nnot active'));
    const duel = await createSettlingDuel();

    expect(await submitSettlement(duel)).toBe('synced');
    expect((await Duel.findById(duel._id))?.status).toBe('SETTLED');
  });

  it('factory paused (pre-check): leaves the duel SETTLING for a later retry, sends nothing', async () => {
    vi.mocked(readFactoryPaused).mockResolvedValue(true);
    const duel = await createSettlingDuel();

    expect(await submitSettlement(duel)).toBe('paused');
    expect(simulate).not.toHaveBeenCalled();
    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('SETTLING');
    expect(reloaded?.relayLockedUntil).toBeUndefined();
  });

  it('a "paused" revert (pause landed mid-flight) is retried later, never thrown', async () => {
    simulate.mockRejectedValue(new Error('The contract function "settle" reverted with the following reason:\npaused'));
    const duel = await createSettlingDuel();

    expect(await submitSettlement(duel)).toBe('paused');
    expect((await Duel.findById(duel._id))?.status).toBe('SETTLING');
  });

  it('never throws on an unexpected RPC failure', async () => {
    vi.mocked(readEscrowStatus).mockRejectedValue(new Error('rpc down'));
    const duel = await createSettlingDuel();
    await expect(submitSettlement(duel)).resolves.toBe('failed');
  });

  it('does nothing without RELAYER_PRIVATE_KEY', async () => {
    delete process.env.RELAYER_PRIVATE_KEY;
    const duel = await createSettlingDuel();
    expect(await submitSettlement(duel)).toBe('unconfigured');
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('refuses to relay from the oracle signer key', async () => {
    process.env.RELAYER_PRIVATE_KEY = process.env.ORACLE_SIGNER_PRIVATE_KEY;
    const duel = await createSettlingDuel();
    expect(await submitSettlement(duel)).toBe('failed');
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('a live lease from another attempt blocks a second concurrent submission', async () => {
    const duel = await createSettlingDuel({ relayLockedUntil: new Date(Date.now() + 60_000) });
    expect(await submitSettlement(duel)).toBe('busy');
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('keeps the lease when a broadcast tx never produced a receipt, so no duplicate tx is sent', async () => {
    waitForReceipt.mockRejectedValue(new Error('timed out'));
    const duel = await createSettlingDuel();

    expect(await submitSettlement(duel)).toBe('failed');
    expect((await Duel.findById(duel._id))?.relayLockedUntil).toBeInstanceOf(Date);
    expect(await submitSettlement((await Duel.findById(duel._id))!)).toBe('busy');
    expect(writeContract).toHaveBeenCalledTimes(1);
  });

  it('skips duels that are not SETTLING or have no signature', async () => {
    const live = await createDuel({ status: 'LIVE', escrowAddress: ESCROW });
    expect(await submitSettlement(live)).toBe('skipped');
    expect(readEscrowStatus).not.toHaveBeenCalled();
  });
});
