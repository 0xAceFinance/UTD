import { CANCELLATION_CONFIG } from "./config.js";

/**
 * Section 02 cancellation rule: free and instant, but rate-limited so the
 * lobby list can't be used as a scanning tool (open -> peek at interest ->
 * cancel -> repeat). No fee is ever taken — this only ever blocks *creating*
 * a new lobby for a short cooldown once the limit is hit within the window.
 */
export function canCreateLobby(recentCancellationTimestampsSec: number[], nowSec: number): boolean {
  const windowStart = nowSec - CANCELLATION_CONFIG.windowSeconds;
  const withinWindow = recentCancellationTimestampsSec.filter((t) => t > windowStart);

  if (withinWindow.length < CANCELLATION_CONFIG.maxCancellationsPerWindow) return true;

  const mostRecent = Math.max(...withinWindow);
  return nowSec - mostRecent >= CANCELLATION_CONFIG.cooldownSecondsAfterLimitHit;
}
