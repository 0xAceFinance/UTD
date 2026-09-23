import { selectTopTen } from "@mcapduel/engine";
import { DexScreenerSource, getLivePricing } from "./dexScreenerSource";
import { connectToDatabase } from "./mongoose";
import DuelToken from "./models/DuelToken";
import OracleHealthSample from "./models/OracleHealthSample";
import { isPinnedConflict, upsertPinnedTokens } from "./pinnedTokens";

/** Minimum time between re-price passes over today's Top 10 (see repriceTopTen
 * below). Matches the cadence lib/duelEngine.ts already uses for a live
 * duel's own market-cap refresh (MIN_SAMPLE_INTERVAL_SEC), so the token list
 * feels just as live without hammering DexScreener on every page load. */
export const MIN_REPRICE_INTERVAL_SEC = 20;

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
    // Pinned tokens (lib/pinnedTokens.ts) are listed separately, above the
    // Top 10; drop them (and symbol lookalikes) here so they neither take a
    // Top 10 slot nor collide on DuelToken's unique symbol.
    const candidates = (await source.listCandidates()).filter((c) => !isPinnedConflict(c));

    // The gladiator filter: every candidate must clear every Section 01 gate
    // (market cap, liquidity, volume, traders, age, rug-check, LP-lock,
    // holder concentration, blocklist) to earn a spot in today's arena.
    const result = selectTopTen(candidates);

    await DuelToken.deleteMany({ pinned: { $ne: true } });

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
        imageUrl: display?.imageUrl,
      };
    });

    if (docs.length > 0) await DuelToken.insertMany(docs);
    // Non-fatal: a pinned token's existing doc survives the deleteMany above,
    // so a transient refresh miss only leaves its numbers a scan behind.
    await upsertPinnedTokens(source).catch(() => {});

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
 * Cheap real-time refresh for today's Top 10: re-prices every listed token
 * against DexScreener (lib/dexScreenerSource.ts::getLivePricing) without
 * re-running discovery or the safety gates, so the roster stays exactly what
 * the last full runDailyScan() selected -- only marketCapUsd/liquidityUsd/
 * volume24hUsd/change24hPct move. Called on a throttle (MIN_REPRICE_INTERVAL_SEC)
 * from GET /api/duel-tokens, the same self-healing-on-read pattern
 * app/api/duels/[id]/route.ts uses for a live duel.
 */
export async function repriceTopTen(): Promise<{ repriced: number }> {
  await connectToDatabase();

  const tokens = await DuelToken.find();
  if (tokens.length === 0) return { repriced: 0 };

  const pricing = await getLivePricing(tokens.map((t) => t.tokenAddress)).catch(() => new Map());

  const now = new Date();
  let repriced = 0;
  await Promise.all(
    tokens.map((token) => {
      const fresh = pricing.get(token.tokenAddress);
      if (!fresh) return Promise.resolve();
      repriced += 1;
      return DuelToken.updateOne(
        { _id: token._id },
        {
          $set: {
            marketCapUsd: fresh.marketCapUsd,
            liquidityUsd: fresh.liquidityUsd,
            volume24hUsd: fresh.volume24hUsd,
            change24hPct: fresh.change24hPct,
            updatedAt: now,
          },
        }
      );
    })
  );

  return { repriced };
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
