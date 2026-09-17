import { runOraclePipeline } from "../oracle/aggregator.js";
import { ALL_SCENARIOS } from "./scenarios.js";

/**
 * The Phase 0 -> 1 rollout gate from Section 09: run the oracle pipeline
 * against known adversarial patterns and report whether it does what the
 * spec says it should. These are synthetic scenarios, not real historical
 * Robinhood Chain data — that data doesn't exist yet for a chain this new.
 * Once it does, extend ALL_SCENARIOS with real replayed battles alongside
 * these, rather than replacing them: the synthetic cases pin down exact
 * attack shapes that real history may not happen to contain.
 */
function main() {
  console.log("MCAP DUEL — oracle pipeline backtest\n");
  let allPassed = true;

  for (const scenario of ALL_SCENARIOS) {
    const result = runOraclePipeline({
      tokenAddress: scenario.samples[0]?.tokenAddress ?? "0xtoken",
      totalSupply: scenario.totalSupply,
      rawSamples: scenario.samples,
      startLiquidityUsd: scenario.startLiquidityUsd,
    });

    const peak = result.validatedPeakMarketCapUsd;
    let pass = peak !== null;
    if (pass && scenario.expected.peakBelow) pass = pass && peak! < scenario.expected.peakBelow;
    if (pass && scenario.expected.peakAbove) pass = pass && peak! > scenario.expected.peakAbove;

    allPassed = allPassed && pass;

    console.log(`[${pass ? "PASS" : "FAIL"}] ${scenario.name}`);
    console.log(`  ${scenario.description}`);
    console.log(`  validated peak MC: ${peak === null ? "null" : `$${Math.round(peak).toLocaleString()}`}`);
    console.log(`  samples rejected for liquidity: ${result.rejectedForLiquidity}/${result.totalSamplesConsidered}`);
    console.log(`  sample log verified: ${result.sampleLogVerified}`);
    console.log();
  }

  console.log(allPassed ? "All scenarios behaved as expected." : "One or more scenarios did NOT behave as expected.");
  process.exitCode = allPassed ? 0 : 1;
}

main();
