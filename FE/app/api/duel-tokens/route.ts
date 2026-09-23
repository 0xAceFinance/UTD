import { connectToDatabase } from '@/lib/mongoose';
import DuelToken from '@/lib/models/DuelToken';
import { repriceTopTen, MIN_REPRICE_INTERVAL_SEC } from '@/lib/duelTokenScan';
import { PINNED_TOKENS, upsertPinnedTokens } from '@/lib/pinnedTokens';
import { success, failure } from '@/utils/response';

/**
 * Pinned tokens plus today's Top 10 (spec Section 01). Self-healing on read, same pattern as
 * app/api/duels/[id]/route.ts: if the last re-price is older than
 * MIN_REPRICE_INTERVAL_SEC, refresh every listed token's market cap from
 * DexScreener before responding, so the numbers the frontend polls stay
 * live without a separate cron. See lib/models/DuelToken.ts for provenance.
 */
export async function GET() {
    try {
        await connectToDatabase();
        // Pinned tokens first (lib/pinnedTokens.ts), then the scanned Top 10.
        const load = () => DuelToken.find().sort({ pinned: -1, rank: 1 }).limit(10 + PINNED_TOKENS.length);

        // First boot, before any scan has run: seed the pinned tokens so
        // they show up immediately rather than waiting for POST /api/scan.
        if (!(await DuelToken.exists({ pinned: true }))) {
            await upsertPinnedTokens().catch(() => {});
        }

        let tokens = await load();

        const staleness = tokens.length > 0 ? Date.now() - tokens[0].updatedAt.getTime() : 0;
        if (tokens.length > 0 && staleness >= MIN_REPRICE_INTERVAL_SEC * 1000) {
            await repriceTopTen().catch(() => {});
            tokens = await load();
        }

        return success(tokens);
    } catch (err) {
        return failure((err as Error).message);
    }
}
