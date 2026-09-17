export const LOBBY_CONFIG = {
  maxOpenWindowSeconds: 60 * 60, // Section 02: unmatched lobbies auto-expire after 60 min
  minDurationSeconds: 15 * 60,
  maxDurationSeconds: 40 * 60,
};

export const CANCELLATION_CONFIG = {
  // Section 02 cancellation rule: free, instant cancellation, but rate-limited
  // so the lobby list can't be used as a scanning tool (open -> peek -> cancel -> repeat).
  maxCancellationsPerWindow: 5,
  windowSeconds: 60 * 60,
  cooldownSecondsAfterLimitHit: 15 * 60,
};
