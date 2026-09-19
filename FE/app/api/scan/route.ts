import { runDailyScan } from '@/lib/duelTokenScan';
import { success, failure } from '@/utils/response';

/**
 * Fetches real, live candidates from DexScreener (lib/dexScreenerSource.ts)
 * and runs them through the real Phase 1 scanner (@mcapduel/engine) to
 * refresh today's Top 10 -- the gladiators eligible to fight in the arena.
 * See lib/duelTokenScan.ts.
 */
let isScanLoopRunning = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function executeScanPass() {
    try {
        const result = await runDailyScan();
        return { success: true, timestamp: new Date().toISOString(), selectedCount: result.selectedCount };
    } catch (err) {
        return { success: false, timestamp: new Date().toISOString(), error: (err as Error).message };
    }
}

export async function POST(req?: Request) {
    let loop = false;
    if (req) {
        try {
            const url = req.url ? new URL(req.url) : null;
            const ua = req.headers?.get('user-agent') || '';
            loop = url?.searchParams.get('loop') === 'true' || ua.includes('Google-Cloud-Scheduler');
        } catch {}
    }

    if (!loop) {
        try {
            const result = await runDailyScan();
            return success(result);
        } catch (err) {
            return failure((err as Error).message);
        }
    }

    if (isScanLoopRunning) {
        return success({ message: 'Scan loop is already active in another request.', running: true });
    }

    isScanLoopRunning = true;
    const passes = [];
    const INTERVAL_MS = 15_000;
    const TOTAL_PASSES = 4; // Spaced at 0s, 15s, 30s, 45s across the 1-minute cron window

    try {
        for (let i = 0; i < TOTAL_PASSES; i++) {
            const start = Date.now();
            const passResult = await executeScanPass();
            passes.push(passResult);

            if (i < TOTAL_PASSES - 1) {
                const elapsed = Date.now() - start;
                const delay = Math.max(100, INTERVAL_MS - elapsed);
                await sleep(delay);
            }
        }
        return success({ message: 'Completed 15s scan cycle (4 passes).', passes });
    } finally {
        isScanLoopRunning = false;
    }
}

export async function GET(req?: Request) {
    return POST(req);
}



