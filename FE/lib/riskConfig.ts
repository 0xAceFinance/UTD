/**
 * @mcapduel/risk's geofence (Section 08) deliberately ships with no default
 * blocklist -- which jurisdictions to exclude is a legal decision, not a
 * technical one. This is that decision's home: empty today means the
 * geofence check always passes, but the check itself is live (see
 * app/api/duels/route.ts and the join route), wired against the real
 * request country (lib/requestSignals.ts::getClientCountry). The moment
 * legal defines the real list, this is the only line that needs to change.
 */
export const BLOCKED_COUNTRY_CODES: readonly string[] = [];

/** @mcapduel/risk's circuit breaker thresholds (Section 05). */
export const ORACLE_CIRCUIT_BREAKER_CONFIG = {
    maxStalenessSeconds: 60 * 60, // no successful scan in the last hour -> pause
    maxConsecutiveFailures: 3,
};
