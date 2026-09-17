import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import Duel from '@/lib/models/Duel';
import { ensureDbConnected, clearDatabase } from '../helpers/db';
import { createDuel } from '../helpers/duelFixtures';
import mongoose from 'mongoose';

beforeEach(async () => {
  await ensureDbConnected();
  await clearDatabase();
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('lib/lobbyAdapter snapshot/apply round trip', () => {
  it('toLobbySnapshot faithfully mirrors every field the matchmaking state machine reads', async () => {
    const duel = await createDuel({
      status: 'LIVE',
      opponentWallet: '0xOpponent0000000000000000000000000000001',
      startTime: new Date(1_700_000_000_000),
      endTime: new Date(1_700_000_900_000),
    });

    const lobby = toLobbySnapshot(duel);

    expect(lobby.id).toBe(String(duel._id));
    expect(lobby.status).toBe('LIVE');
    expect(lobby.creator).toBe(duel.creatorWallet);
    expect(lobby.opponent).toBe(duel.opponentWallet);
    expect(lobby.tokenASymbol).toBe(duel.tokenA.symbol);
    expect(lobby.tokenBSymbol).toBe(duel.tokenB.symbol);
    expect(lobby.creatorSide).toBe(duel.creatorSide);
    expect(lobby.durationSeconds).toBe(duel.durationSeconds);
    expect(lobby.createdAtSec).toBe(Math.floor(duel.createdAt.getTime() / 1000));
    expect(lobby.openDeadlineSec).toBe(Math.floor(duel.openDeadline.getTime() / 1000));
    expect(lobby.startTimeSec).toBe(1_700_000_000);
    expect(lobby.endTimeSec).toBe(1_700_000_900);
  });

  it('omits startTimeSec/endTimeSec when the duel has not started yet', async () => {
    const duel = await createDuel({ status: 'OPEN' });
    const lobby = toLobbySnapshot(duel);
    expect(lobby.startTimeSec).toBeUndefined();
    expect(lobby.endTimeSec).toBeUndefined();
  });

  it('applyLobby round-trips status/opponent/timestamps/winnerSide back onto the Mongoose doc', async () => {
    const duel = await createDuel({ status: 'OPEN' });
    const lobby = toLobbySnapshot(duel);

    applyLobby(duel, {
      ...lobby,
      status: 'LIVE',
      opponent: '0xnewopponent000000000000000000000000001',
      startTimeSec: 1_800_000_000,
      endTimeSec: 1_800_000_900,
      winnerSide: 1,
    });

    expect(duel.status).toBe('LIVE');
    expect(duel.opponentWallet).toBe('0xnewopponent000000000000000000000000001');
    expect(duel.startTime?.getTime()).toBe(1_800_000_000_000);
    expect(duel.endTime?.getTime()).toBe(1_800_000_900_000);
    expect(duel.winnerSide).toBe(1);
  });

  it('a full snapshot -> transition -> apply round trip persists correctly through Mongoose', async () => {
    const duel = await createDuel({ status: 'OPEN' });
    const lobby = toLobbySnapshot(duel);
    applyLobby(duel, { ...lobby, status: 'CANCELLED' });
    await duel.save();

    const reloaded = await Duel.findById(duel._id);
    expect(reloaded?.status).toBe('CANCELLED');
  });
});
