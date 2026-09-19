export const LOBBY_CONFIG = {
  maxOpenWindowSeconds: 5 * 60, // Section 02: unmatched lobbies auto-expire after 5 min
  minDurationSeconds: 5 * 60,
  maxDurationSeconds: 20 * 60,
};

export const CANCELLATION_CONFIG = {
  // Section 02 cancellation rule: free, instant cancellation, but rate-limited
  // so the lobby list can't be used as a scanning tool (open -> peek -> cancel -> repeat).
  maxCancellationsPerWindow: 5,
  windowSeconds: 60 * 60,
  cooldownSecondsAfterLimitHit: 15 * 60,
};
