export const LOBBY_CONFIG = {
  maxOpenWindowSeconds: 60 * 60, // Section 02: unmatched lobbies auto-expire after 60 min
  // Mirrors BattleEscrowFactory: a duel runs for exactly 5, 10, 15 or 20 minutes.
  minDurationSeconds: 5 * 60,
  maxDurationSeconds: 20 * 60,
  durationStepSeconds: 5 * 60,
};

export const CANCELLATION_CONFIG = {
  // Section 02 cancellation rule: free, instant cancellation, but rate-limited
  // so the lobby list can't be used as a scanning tool (open -> peek -> cancel -> repeat).
  maxCancellationsPerWindow: 5,
  windowSeconds: 60 * 60,
  cooldownSecondsAfterLimitHit: 15 * 60,
};
