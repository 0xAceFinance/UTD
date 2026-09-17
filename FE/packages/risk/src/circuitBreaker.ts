/**
 * Section 05 "Oracle/indexer downtime" mitigation: pause new lobby creation
 * during degraded service instead of letting matches start against a price
 * feed that might be stale or wrong. This never touches matches already in
 * progress — it only gates whether new ones are allowed to start.
 */
export interface OracleHealthSample {
  timestampSec: number;
  succeeded: boolean;
}

export interface CircuitBreakerConfig {
  maxStalenessSeconds: number;
  maxConsecutiveFailures: number;
}

export function shouldPauseNewLobbies(
  samples: OracleHealthSample[],
  nowSec: number,
  config: CircuitBreakerConfig
): boolean {
  if (samples.length === 0) return true; // no health data at all -> fail safe, pause

  const sorted = [...samples].sort((a, b) => a.timestampSec - b.timestampSec);
  const latest = sorted[sorted.length - 1];

  if (nowSec - latest.timestampSec > config.maxStalenessSeconds) return true;

  let consecutiveFailures = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].succeeded) break;
    consecutiveFailures++;
  }
  return consecutiveFailures >= config.maxConsecutiveFailures;
}
