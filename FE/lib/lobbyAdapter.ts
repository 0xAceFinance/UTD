import type { Lobby } from '@mcapduel/matchmaking';
import type { IDuel } from '@/lib/models/Duel';

/**
 * @mcapduel/matchmaking's state machine works on a plain, immutable `Lobby`
 * object with epoch-second timestamps -- not a Mongoose document with Date
 * fields and a different field naming convention. These two functions are
 * the only place that translation happens, so every route applies the exact
 * same tested transition functions instead of re-implementing the rules.
 */
export function toLobbySnapshot(duel: IDuel): Lobby {
    return {
        id: String(duel._id),
        status: duel.status,
        creator: duel.creatorWallet,
        opponent: duel.opponentWallet,
        tokenASymbol: duel.tokenA.symbol,
        tokenBSymbol: duel.tokenB?.symbol ?? '',
        creatorSide: duel.creatorSide,
        durationSeconds: duel.durationSeconds,
        createdAtSec: Math.floor(duel.createdAt.getTime() / 1000),
        openDeadlineSec: Math.floor(duel.openDeadline.getTime() / 1000),
        startTimeSec: duel.startTime ? Math.floor(duel.startTime.getTime() / 1000) : undefined,
        endTimeSec: duel.endTime ? Math.floor(duel.endTime.getTime() / 1000) : undefined,
        winnerSide: duel.winnerSide,
    };
}

/** Writes a transition's result back onto the Mongoose document. Does not save. */
export function applyLobby(duel: IDuel, lobby: Lobby): void {
    duel.status = lobby.status;
    duel.opponentWallet = lobby.opponent;
    if (lobby.startTimeSec !== undefined) duel.startTime = new Date(lobby.startTimeSec * 1000);
    if (lobby.endTimeSec !== undefined) duel.endTime = new Date(lobby.endTimeSec * 1000);
    if (lobby.winnerSide !== undefined) duel.winnerSide = lobby.winnerSide;
}
