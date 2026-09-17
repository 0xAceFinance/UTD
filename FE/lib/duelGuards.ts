import { canCreateLobby, CANCELLATION_CONFIG } from '@mcapduel/matchmaking';
import { shouldPauseNewLobbies, isAllowedJurisdiction } from '@mcapduel/risk';
import Duel from '@/lib/models/Duel';
import OracleHealthSample from '@/lib/models/OracleHealthSample';
import { getClientCountry } from '@/lib/requestSignals';
import { BLOCKED_COUNTRY_CODES, ORACLE_CIRCUIT_BREAKER_CONFIG } from '@/lib/riskConfig';

/**
 * The three real gates a wallet must clear before creating a lobby: the
 * oracle circuit breaker, the geofence, and the cancellation rate limit (see
 * app/api/duels/precheck/route.ts and app/api/duels/route.ts). Shared so the
 * frontend can check before spending gas on an on-chain createDuel() call
 * that the backend would reject anyway, and the backend can re-check for
 * real right before writing the database record -- the same rules, run twice,
 * never trusting that the earlier check still holds.
 *
 * Returns an error message if the wallet is blocked, or null if it can proceed.
 */
export async function checkCanCreateLobby(req: Request, creatorWallet: string): Promise<string | null> {
    const nowSec = Math.floor(Date.now() / 1000);

    const recentHealth = await OracleHealthSample.find().sort({ timestampSec: -1 }).limit(10).lean();
    if (
        shouldPauseNewLobbies(
            recentHealth.map((s) => ({ timestampSec: s.timestampSec, succeeded: s.succeeded })),
            nowSec,
            ORACLE_CIRCUIT_BREAKER_CONFIG
        )
    ) {
        return 'New duels are paused while we recover the price feed. Try again shortly.';
    }

    const country = getClientCountry(req);
    if (country && !isAllowedJurisdiction(country, BLOCKED_COUNTRY_CODES)) {
        return 'Duels are not available in your region.';
    }

    const recentCancellations = await Duel.find({
        creatorWallet: creatorWallet.toLowerCase(),
        status: 'CANCELLED',
        cancelledAt: { $exists: true },
    })
        .select('cancelledAt')
        .lean();
    const cancellationTimestamps = recentCancellations.map((d) => Math.floor(new Date(d.cancelledAt!).getTime() / 1000));
    if (!canCreateLobby(cancellationTimestamps, nowSec)) {
        return `Too many cancelled lobbies recently. Try again in a few minutes (limit: ${CANCELLATION_CONFIG.maxCancellationsPerWindow} per hour).`;
    }

    return null;
}
