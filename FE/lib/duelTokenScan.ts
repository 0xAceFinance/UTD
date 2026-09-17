import { selectTopTen } from "@mcapduel/engine";
import { DexScreenerSource } from "./dexScreenerSource";
import { connectToDatabase } from "./mongoose";
import DuelToken from "./models/DuelToken";
import OracleHealthSample from "./models/OracleHealthSample";

/**
 * Runs the real Section 01 scanner (@mcapduel/engine's evaluateGates +
 * selectTopTen -- the exact tested code from Phase 1, 29 passing tests)
 * against a real, live candidate pool (lib/dexScreenerSource.ts) and
 * persists the result as today's Top 10.
 */
export async function runDailyScan() {
  await connectToDatabase();

  try {
    const source = new DexScreenerSource();
    const candidates = await source.listCandidates();

    // The gladiator filter: every candidate must clear every Section 01 gate
    // (market cap, liquidity, volume, traders, age, rug-check, LP-lock,
    // holder concentration, blocklist) to earn a spot in today's arena.
    const result = selectTopTen(candidates);

    await DuelToken.deleteMany({});

    const docs = result.selected.map((scored, i) => {
      const candidate = candidates.find((c) => c.tokenAddress === scored.tokenAddress);
      const display = source.displayInfo.get(scored.symbol);
      return {
        symbol: scored.symbol,
        name: display?.name ?? scored.symbol,
        rank: i + 1,
        tokenAddress: scored.tokenAddress,
        totalSupply: candidate?.totalSupply ?? 0,
        marketCapUsd: scored.marketCapUsd,
        liquidityUsd: scored.liquidityUsd,
        volume24hUsd: candidate?.volume24hUsd ?? 0,
        change24hPct: display?.change24hPct ?? 0,
      };
    });

    if (docs.length > 0) await DuelToken.insertMany(docs);

    await recordOracleHealth(true);

    return {
      selectedCount: docs.length,
      candidatePoolSize: candidates.length,
      rankingRelaxed: result.rankingRelaxed,
      relaxationLevel: result.relaxationLevel,
      excluded: result.excluded.map((e) => ({
        symbol: e.symbol,
        failedGates: e.checks.filter((c) => !c.passed).map((c) => c.name),
      })),
    };
  } catch (err) {
    await recordOracleHealth(false, (err as Error).message);
    throw err;
  }
}

/**
 * Real health history for @mcapduel/risk's circuit breaker (Section 05):
 * every scan attempt, success or failure. app/api/duels/route.ts checks this
 * history before allowing a new lobby to be created -- see
 * lib/models/OracleHealthSample.ts.
 */
async function recordOracleHealth(succeeded: boolean, detail?: string): Promise<void> {
  await OracleHealthSample.create({
    timestampSec: Math.floor(Date.now() / 1000),
    succeeded,
    detail,
  });
}
