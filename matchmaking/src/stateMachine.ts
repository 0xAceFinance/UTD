import type { Lobby } from "./types.js";
import { InvalidTransitionError } from "./types.js";
import { LOBBY_CONFIG } from "./config.js";

export interface CreateLobbyInput {
  id: string;
  creator: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  creatorSide: 0 | 1;
  durationSeconds: number;
  nowSec: number;
}

export function createLobby(input: CreateLobbyInput): Lobby {
  if (
    input.durationSeconds < LOBBY_CONFIG.minDurationSeconds ||
    input.durationSeconds > LOBBY_CONFIG.maxDurationSeconds ||
    input.durationSeconds % LOBBY_CONFIG.durationStepSeconds !== 0
  ) {
    throw new Error("duration must be 5, 10, 15 or 20 minutes");
  }
  return {
    id: input.id,
    status: "OPEN",
    creator: input.creator,
    tokenASymbol: input.tokenASymbol,
    tokenBSymbol: input.tokenBSymbol,
    creatorSide: input.creatorSide,
    durationSeconds: input.durationSeconds,
    createdAtSec: input.nowSec,
    openDeadlineSec: input.nowSec + LOBBY_CONFIG.maxOpenWindowSeconds,
  };
}

/** Opponent's join transaction has been submitted, not yet confirmed. */
export function submitJoin(lobby: Lobby, opponent: string, nowSec: number): Lobby {
  if (lobby.status !== "OPEN") throw new InvalidTransitionError(lobby.status, "submitJoin");
  if (nowSec > lobby.openDeadlineSec) throw new Error("lobby's open window has already passed");
  if (opponent === lobby.creator) throw new Error("cannot join your own lobby");
  return { ...lobby, status: "MATCHED", opponent };
}

/** The join transaction reverted or was dropped — the lobby reopens for someone else. */
export function failJoin(lobby: Lobby): Lobby {
  if (lobby.status !== "MATCHED") throw new InvalidTransitionError(lobby.status, "failJoin");
  return { ...lobby, status: "OPEN", opponent: undefined };
}

/** The join transaction confirmed on-chain — BattleEscrow is now Active. */
export function confirmLive(lobby: Lobby, nowSec: number): Lobby {
  if (lobby.status !== "MATCHED") throw new InvalidTransitionError(lobby.status, "confirmLive");
  return { ...lobby, status: "LIVE", startTimeSec: nowSec, endTimeSec: nowSec + lobby.durationSeconds };
}

export function closeBattleWindow(lobby: Lobby, nowSec: number): Lobby {
  if (lobby.status !== "LIVE") throw new InvalidTransitionError(lobby.status, "closeBattleWindow");
  if (lobby.endTimeSec === undefined || nowSec < lobby.endTimeSec) {
    throw new Error("battle window has not elapsed yet");
  }
  return { ...lobby, status: "SETTLING" };
}

/** Section 05/06: the abuse-detection layer flagged this match before it could auto-settle. */
export function flagForReview(lobby: Lobby): Lobby {
  if (lobby.status !== "SETTLING") throw new InvalidTransitionError(lobby.status, "flagForReview");
  return { ...lobby, status: "HELD" };
}

/**
 * The HELD recovery path: an admin reviewed a flagged match and decided it
 * should not settle after all -- both stakes get refunded instead (on-chain,
 * BattleEscrow.voidActive() mirrors this; see Contracts/src/duel/BattleEscrow.sol).
 * Reuses CANCELLED as the terminal status since neither transition ever pays
 * out a winner. The other resolution -- confirming the match was legitimate
 * -- reuses the existing `settle` transition, which already accepts HELD.
 */
export function voidHeld(lobby: Lobby): Lobby {
  if (lobby.status !== "HELD") throw new InvalidTransitionError(lobby.status, "voidHeld");
  return { ...lobby, status: "CANCELLED" };
}

export function settle(lobby: Lobby, winnerSide: 0 | 1): Lobby {
  if (lobby.status !== "SETTLING" && lobby.status !== "HELD") {
    throw new InvalidTransitionError(lobby.status, "settle");
  }
  return { ...lobby, status: "SETTLED", winnerSide };
}

/**
 * The last-resort recovery path: the match never settled through any normal
 * route (oracle key lost, a HELD match nobody resolved, a blacklisted
 * winner address making settle()'s transfer always revert) and has now sat
 * unsettled well past its end time. On-chain, BattleEscrow.refundStale()
 * mirrors this permissionlessly, no signature required (see
 * Contracts/src/duel/BattleEscrow.sol) -- the real timing gate lives there;
 * this transition just accepts the DB-side consequence once the backend has
 * verified the real on-chain event. Reachable from LIVE (the backend itself
 * never advanced it), SETTLING (signed but never confirmed on-chain), or
 * HELD (flagged, never resolved) -- reuses CANCELLED since neither transition
 * ever pays out a winner.
 */
export function refundStale(lobby: Lobby): Lobby {
  if (lobby.status !== "LIVE" && lobby.status !== "SETTLING" && lobby.status !== "HELD") {
    throw new InvalidTransitionError(lobby.status, "refundStale");
  }
  return { ...lobby, status: "CANCELLED" };
}

export function cancel(lobby: Lobby, canceller: string): Lobby {
  if (lobby.status !== "OPEN") throw new InvalidTransitionError(lobby.status, "cancel");
  if (canceller !== lobby.creator) throw new Error("only the creator can cancel a lobby");
  return { ...lobby, status: "CANCELLED" };
}

export function expire(lobby: Lobby, nowSec: number): Lobby {
  if (lobby.status !== "OPEN") throw new InvalidTransitionError(lobby.status, "expire");
  if (nowSec <= lobby.openDeadlineSec) throw new Error("open window has not passed yet");
  return { ...lobby, status: "EXPIRED" };
}
