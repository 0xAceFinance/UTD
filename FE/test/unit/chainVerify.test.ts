import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLog, buildReceipt, ADDR } from '../helpers/chainFixtures';
import { BattleEscrowFactoryAbi, BattleEscrowAbi } from '@/config/contracts';

const getTransactionReceipt = vi.fn();

// lib/chainVerify.ts builds its publicClient at module load time from
// viem's createPublicClient -- mocking the network boundary (the RPC
// transport) rather than the decoding logic itself (parseEventLogs stays
// real) is what lets these tests exercise the actual event-decoding code
// against realistic, ABI-encoded fixture logs.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({ getTransactionReceipt }),
  };
});

const TX_HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;

beforeEach(() => {
  getTransactionReceipt.mockReset();
});

describe('lib/chainVerify', () => {
  describe('verifyDuelCreated', () => {
    it('decodes a real DuelCreated event and returns escrow address + terms', async () => {
      const log = buildLog({
        address: ADDR.factory,
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelCreated',
        args: {
          duel: ADDR.escrow,
          creator: ADDR.creator,
          stakeToken: ADDR.stakeToken,
          buyIn: 100_000_000_000_000_000_000n, // 100e18
          creatorSide: 0,
          durationSeconds: 900n,
          tokenASymbol: 'FOO',
          tokenBSymbol: 'BAR',
        },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelCreated } = await import('@/lib/chainVerify');
      const result = await verifyDuelCreated(TX_HASH, ADDR.creator);

      expect(result.escrowAddress.toLowerCase()).toBe(ADDR.escrow.toLowerCase());
      expect(result.event.buyIn).toBe(100_000_000_000_000_000_000n);
      expect(result.event.creatorSide).toBe(0);
      expect(result.event.durationSeconds).toBe(900n);
    });

    it('fails closed when the event exists but for a different creator wallet', async () => {
      const log = buildLog({
        address: ADDR.factory,
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelCreated',
        args: {
          duel: ADDR.escrow,
          creator: ADDR.opponent, // not the wallet we're checking
          stakeToken: ADDR.stakeToken,
          buyIn: 100n,
          creatorSide: 0,
          durationSeconds: 900n,
          tokenASymbol: 'FOO',
          tokenBSymbol: 'BAR',
        },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelCreated } = await import('@/lib/chainVerify');
      await expect(verifyDuelCreated(TX_HASH, ADDR.creator)).rejects.toThrow(/DuelCreated event not found/);
    });

    it('fails closed when the receipt has no DuelCreated event at all (wrong tx / malformed logs)', async () => {
      getTransactionReceipt.mockResolvedValue(buildReceipt([]));
      const { verifyDuelCreated } = await import('@/lib/chainVerify');
      await expect(verifyDuelCreated(TX_HASH, ADDR.creator)).rejects.toThrow(/DuelCreated event not found/);
    });

    it('fails closed when the transaction reverted on-chain', async () => {
      getTransactionReceipt.mockResolvedValue(buildReceipt([], 'reverted'));
      const { verifyDuelCreated } = await import('@/lib/chainVerify');
      await expect(verifyDuelCreated(TX_HASH, ADDR.creator)).rejects.toThrow(/did not succeed/);
    });

    it('fails closed when a DuelCreated-shaped event is emitted by anything other than the real factory (forged event)', async () => {
      const forgedLog = buildLog({
        address: ADDR.otherEscrow, // standing in for an attacker-controlled contract, not CONTRACTS.battleEscrowFactory
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelCreated',
        args: {
          duel: ADDR.escrow,
          creator: ADDR.creator,
          stakeToken: ADDR.stakeToken,
          buyIn: 100_000_000_000_000_000_000n,
          creatorSide: 0,
          durationSeconds: 900n,
          tokenASymbol: 'FOO',
          tokenBSymbol: 'BAR',
        },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([forgedLog]));

      const { verifyDuelCreated } = await import('@/lib/chainVerify');
      await expect(verifyDuelCreated(TX_HASH, ADDR.creator)).rejects.toThrow(/DuelCreated event not found/);
    });
  });

  describe('verifyDuelJoined', () => {
    it('decodes a real DuelJoined event for the right escrow + opponent', async () => {
      const log = buildLog({
        address: ADDR.factory,
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelJoined',
        args: { duel: ADDR.escrow, opponent: ADDR.opponent },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelJoined } = await import('@/lib/chainVerify');
      await expect(verifyDuelJoined(TX_HASH, ADDR.escrow, ADDR.opponent)).resolves.toBeUndefined();
    });

    it('fails closed when the DuelJoined event is for a different escrow (tampered escrow claim)', async () => {
      const log = buildLog({
        address: ADDR.factory,
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelJoined',
        args: { duel: ADDR.otherEscrow, opponent: ADDR.opponent },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelJoined } = await import('@/lib/chainVerify');
      await expect(verifyDuelJoined(TX_HASH, ADDR.escrow, ADDR.opponent)).rejects.toThrow(/DuelJoined event not found/);
    });

    it('fails closed when a DuelJoined-shaped event is emitted by anything other than the real factory (forged event)', async () => {
      const forgedLog = buildLog({
        address: ADDR.otherEscrow, // not CONTRACTS.battleEscrowFactory
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelJoined',
        args: { duel: ADDR.escrow, opponent: ADDR.opponent },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([forgedLog]));

      const { verifyDuelJoined } = await import('@/lib/chainVerify');
      await expect(verifyDuelJoined(TX_HASH, ADDR.escrow, ADDR.opponent)).rejects.toThrow(/DuelJoined event not found/);
    });
  });

  describe('verifyDuelSettled', () => {
    it('decodes the real winnerSide from the Settled event, never trusting a client-supplied value', async () => {
      const log = buildLog({
        address: ADDR.escrow,
        abi: BattleEscrowAbi,
        eventName: 'Settled',
        args: {
          winnerSide: 1,
          winner: ADDR.opponent,
          winnerAmount: 190_000_000_000_000_000_000n,
          platformAmount: 10_000_000_000_000_000_000n,
        },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelSettled } = await import('@/lib/chainVerify');
      const result = await verifyDuelSettled(TX_HASH, ADDR.escrow);
      expect(result.winnerSide).toBe(1);
    });

    it('returns PayoutDeferred events from this escrow only (a blacklisted winner is credited to owed[])', async () => {
      const settled = buildLog({
        address: ADDR.escrow,
        abi: BattleEscrowAbi,
        eventName: 'Settled',
        args: { winnerSide: 0, winner: ADDR.creator, winnerAmount: 160n, platformAmount: 40n },
      });
      const deferred = buildLog({
        address: ADDR.escrow,
        abi: BattleEscrowAbi,
        eventName: 'PayoutDeferred',
        args: { to: ADDR.creator, amount: 160n },
      });
      const foreign = buildLog({
        address: ADDR.otherEscrow,
        abi: BattleEscrowAbi,
        eventName: 'PayoutDeferred',
        args: { to: ADDR.opponent, amount: 999n },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([settled, deferred, foreign]));

      const { verifyDuelSettled } = await import('@/lib/chainVerify');
      const result = await verifyDuelSettled(TX_HASH, ADDR.escrow);
      expect(result.deferredPayouts).toEqual([{ to: ADDR.creator.toLowerCase(), amount: '160' }]);
    });

    it('fails closed when the Settled event is emitted by a different escrow address', async () => {
      const log = buildLog({
        address: ADDR.otherEscrow,
        abi: BattleEscrowAbi,
        eventName: 'Settled',
        args: { winnerSide: 0, winner: ADDR.creator, winnerAmount: 1n, platformAmount: 1n },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelSettled } = await import('@/lib/chainVerify');
      await expect(verifyDuelSettled(TX_HASH, ADDR.escrow)).rejects.toThrow(/Settled event not found/);
    });

    it('fails closed on a receipt containing an unrelated event (e.g. Activated) but no Settled event', async () => {
      const log = buildLog({
        address: ADDR.escrow,
        abi: BattleEscrowAbi,
        eventName: 'Activated',
        args: { opponent: ADDR.opponent, startTime: 1n, endTime: 2n },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelSettled } = await import('@/lib/chainVerify');
      await expect(verifyDuelSettled(TX_HASH, ADDR.escrow)).rejects.toThrow(/Settled event not found/);
    });
  });

  describe('verifyDuelClosed', () => {
    it('decodes a real DuelCancelled event for the right escrow', async () => {
      const log = buildLog({
        address: ADDR.factory,
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelCancelled',
        args: { duel: ADDR.escrow, canceller: ADDR.creator },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelClosed } = await import('@/lib/chainVerify');
      await expect(verifyDuelClosed(TX_HASH, ADDR.escrow, 'DuelCancelled')).resolves.toBeUndefined();
    });

    it('does not accept a DuelExpired event as proof of DuelCancelled (event-name confusion)', async () => {
      const log = buildLog({
        address: ADDR.factory,
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelExpired',
        args: { duel: ADDR.escrow },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelClosed } = await import('@/lib/chainVerify');
      await expect(verifyDuelClosed(TX_HASH, ADDR.escrow, 'DuelCancelled')).rejects.toThrow(/DuelCancelled event not found/);
    });

    it('fails closed when a DuelCancelled-shaped event is emitted by anything other than the real factory (forged event)', async () => {
      const forgedLog = buildLog({
        address: ADDR.otherEscrow, // not CONTRACTS.battleEscrowFactory
        abi: BattleEscrowFactoryAbi,
        eventName: 'DuelCancelled',
        args: { duel: ADDR.escrow, canceller: ADDR.creator },
      });
      getTransactionReceipt.mockResolvedValue(buildReceipt([forgedLog]));

      const { verifyDuelClosed } = await import('@/lib/chainVerify');
      await expect(verifyDuelClosed(TX_HASH, ADDR.escrow, 'DuelCancelled')).rejects.toThrow(/DuelCancelled event not found/);
    });
  });

  describe('verifyDuelRefundedStale', () => {
    it('decodes a real RefundedStale event for the right escrow', async () => {
      const log = buildLog({ address: ADDR.escrow, abi: BattleEscrowAbi, eventName: 'RefundedStale', args: {} });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelRefundedStale } = await import('@/lib/chainVerify');
      await expect(verifyDuelRefundedStale(TX_HASH, ADDR.escrow)).resolves.toBeUndefined();
    });

    it('fails closed when the RefundedStale event is emitted by a different escrow address', async () => {
      const log = buildLog({ address: ADDR.otherEscrow, abi: BattleEscrowAbi, eventName: 'RefundedStale', args: {} });
      getTransactionReceipt.mockResolvedValue(buildReceipt([log]));

      const { verifyDuelRefundedStale } = await import('@/lib/chainVerify');
      await expect(verifyDuelRefundedStale(TX_HASH, ADDR.escrow)).rejects.toThrow(/RefundedStale event not found/);
    });
  });
});
