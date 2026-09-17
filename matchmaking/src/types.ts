// Lobby state machine, spec Section 02.
//
// This models the *off-chain* orchestration states. LIVE/SETTLING/SETTLED map
// onto BattleEscrow's on-chain Active/Settled statuses; MATCHED and the
// pending-join step exist purely so the UI has something to show between "join
// tx submitted" and "join tx confirmed" — the contract itself only ever sees
// Open -> Active, atomically, on confirmation.

export type LobbyStatus =
  | "OPEN"
  | "MATCHED" // opponent's join tx submitted, not yet confirmed on-chain
  | "LIVE"
  | "SETTLING"
  | "HELD" // flagged by abuse detection (Section 05/06), settlement paused
  | "SETTLED"
  | "EXPIRED"
  | "CANCELLED";

export interface Lobby {
  id: string;
  status: LobbyStatus;
  creator: string;
  opponent?: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  creatorSide: 0 | 1;
  durationSeconds: number;
  createdAtSec: number;
  openDeadlineSec: number;
  startTimeSec?: number;
  endTimeSec?: number;
  winnerSide?: 0 | 1;
}

export class InvalidTransitionError extends Error {
  constructor(from: LobbyStatus, event: string) {
    super(`cannot apply event "${event}" to a lobby in status ${from}`);
    this.name = "InvalidTransitionError";
  }
}
