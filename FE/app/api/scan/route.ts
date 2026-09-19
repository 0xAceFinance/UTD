import { runDailyScan } from '@/lib/duelTokenScan';
import { success, failure } from '@/utils/response';

/**
 * Fetches real, live candidates from DexScreener (lib/dexScreenerSource.ts)
 * and runs them through the real Phase 1 scanner (@mcapduel/engine) to
 * refresh today's Top 10 -- the gladiators eligible to fight in the arena.
 * See lib/duelTokenScan.ts.
 */
export async function POST() {
    try {
        const result = await runDailyScan();
        return success(result);
    } catch (err) {
        return failure((err as Error).message);
    }
}

export async function GET() {
    return POST();
}

