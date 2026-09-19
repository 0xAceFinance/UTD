import { connectToDatabase } from '@/lib/mongoose';
import DuelToken from '@/lib/models/DuelToken';
import { repriceTopTen, MIN_REPRICE_INTERVAL_SEC } from '@/lib/duelTokenScan';
import { success, failure } from '@/utils/response';

/**
 * Today's Top 10 (spec Section 01). Self-healing on read, same pattern as
 * app/api/duels/[id]/route.ts: if the last re-price is older than
 * MIN_REPRICE_INTERVAL_SEC, refresh every listed token's market cap from
 * DexScreener before responding, so the numbers the frontend polls stay
 * live without a separate cron. See lib/models/DuelToken.ts for provenance.
 */
export async function GET() {
    try {
        await connectToDatabase();
        let tokens = await DuelToken.find().sort({ rank: 1 }).limit(10);

        const staleness = tokens.length > 0 ? Date.now() - tokens[0].updatedAt.getTime() : 0;
        if (tokens.length > 0 && staleness >= MIN_REPRICE_INTERVAL_SEC * 1000) {
            await repriceTopTen().catch(() => {});
            tokens = await DuelToken.find().sort({ rank: 1 }).limit(10);
        }

        return success(tokens);
    } catch (err) {
        return failure((err as Error).message);
    }
}
