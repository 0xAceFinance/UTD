import { MockDataSource } from "../chain/mockSource.js";
import { ChainDexReader } from "../chain/dexReader.js";
import { selectTopTen } from "../scanner/topTen.js";
import { CHAIN_CONFIG } from "../config.js";
import type { DataSource } from "../chain/dataSource.js";

async function main() {
  const source: DataSource =
    CHAIN_CONFIG.dataSource === "chain"
      ? new ChainDexReader(async () => 1) // TODO: real quote-asset USD pricing once live
      : new MockDataSource();

  console.log(`Running daily scan (data source: ${CHAIN_CONFIG.dataSource})...\n`);

  const candidates = await source.listCandidates();
  const result = selectTopTen(candidates);

  console.log(`Top ${result.selected.length} of ${candidates.length} candidates:`);
  result.selected.forEach((t, i) => {
    console.log(
      `  ${i + 1}. ${t.symbol.padEnd(10)} score=${t.score.toFixed(3)}  MC=$${Math.round(t.marketCapUsd).toLocaleString()}  liq=$${Math.round(t.liquidityUsd).toLocaleString()}`
    );
  });

  if (result.rankingRelaxed) {
    console.log(`\nNote: ranking gates were relaxed to level ${result.relaxationLevel} to reach a full Top 10.`);
  }

  console.log(`\nExcluded (${result.excluded.length}):`);
  result.excluded.forEach((e) => {
    const failed = e.checks.filter((c) => !c.passed).map((c) => c.name);
    console.log(`  ${e.symbol}: failed [${failed.join(", ")}]`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
