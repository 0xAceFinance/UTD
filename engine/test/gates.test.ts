import { describe, it, expect } from "vitest";
import { evaluateGates } from "../src/scanner/gates.js";
import { GATE_CONFIG } from "../src/config.js";
import type { PoolSample, TokenCandidate } from "../src/types.js";

/** Back-solves reserves so the candidate's single pool hits an exact market cap and liquidity. */
function poolForTarget(tokenAddress: string, totalSupply: number, mcUsd: number, liquidityUsd: number): PoolSample {
  const reserveQuote = liquidityUsd / 2;
  const priceUsd = mcUsd / totalSupply;
  const reserveToken = priceUsd === 0 ? 0 : reserveQuote / priceUsd;
  return {
    poolAddress: "0xpool",
    tokenAddress,
    dexName: "test-dex",
    reserveToken,
    reserveQuote,
    quotePriceUsd: 1,
    timestampSec: 0,
  };
}

function passed(candidate: TokenCandidate, gate: string, relaxation = 0): boolean | undefined {
  return evaluateGates(candidate, relaxation).checks.find((c) => c.name === gate)?.passed;
}

function healthyCandidate(overrides: Partial<TokenCandidate> = {}): TokenCandidate {
  return {
    tokenAddress: "0xtoken",
    symbol: "TEST",
    totalSupply: 1_000_000_000,
    ageDays: 45,
    uniqueTraders24h: 800,
    txCount24h: 3200,
    volume24hUsd: 900_000,
    holderConcentrationTop10Pct: 22,
    lpLockedDaysRemaining: 120,
    rugCheckPassed: true,
    isBlocklisted: false,
    pools: [
      {
        poolAddress: "0xpool",
        tokenAddress: "0xtoken",
        dexName: "test-dex",
        reserveToken: 500_000_000,
        reserveQuote: 300_000,
        quotePriceUsd: 1,
        timestampSec: 0,
      },
    ],
    ...overrides,
  };
}

describe("evaluateGates", () => {
  it("passes a token that clears every hard gate", () => {
    const result = evaluateGates(healthyCandidate());
    expect(result.passedAll).toBe(true);
  });

  it("fails on holder concentration regardless of everything else being healthy", () => {
    const result = evaluateGates(healthyCandidate({ holderConcentrationTop10Pct: 55 }));
    expect(result.passedAll).toBe(false);
    expect(result.checks.find((c) => c.name === "holderConcentration")?.passed).toBe(false);
  });

  it("fails on the blocklist gate even with perfect metrics", () => {
    const result = evaluateGates(healthyCandidate({ isBlocklisted: true }));
    expect(result.passedAll).toBe(false);
    expect(result.checks.find((c) => c.name === "blocklist")?.passed).toBe(false);
  });

  it("safety gates (lpLock) do not relax even at max relaxation level", () => {
    const thin = healthyCandidate({ lpLockedDaysRemaining: 5 });
    const relaxed = evaluateGates(thin, 3);
    expect(relaxed.checks.find((c) => c.name === "lpLock")?.passed).toBe(false);
  });

  it("soft gates (volume) do relax at higher relaxation levels", () => {
    const lowVolume = healthyCandidate({ volume24hUsd: 50_000 }); // below 75k default
    const strict = evaluateGates(lowVolume, 0);
    const relaxed = evaluateGates(lowVolume, 3);
    expect(strict.checks.find((c) => c.name === "volume24h")?.passed).toBe(false);
    expect(relaxed.checks.find((c) => c.name === "volume24h")?.passed).toBe(true);
  });

  describe("exact-boundary thresholds", () => {
    it("marketCap: one below / at / one above the $150k floor", () => {
      const at = (mc: number) =>
        healthyCandidate({ totalSupply: 1, pools: [poolForTarget("0xtoken", 1, mc, 50_000)] });
      expect(passed(at(GATE_CONFIG.minMarketCapUsd - 1), "marketCap")).toBe(false);
      expect(passed(at(GATE_CONFIG.minMarketCapUsd), "marketCap")).toBe(true);
      expect(passed(at(GATE_CONFIG.minMarketCapUsd + 1), "marketCap")).toBe(true);
    });

    it("liquidityAbsolute: one below / at / one above the $25k floor", () => {
      // mc fixed at 200k so liquidity/mc ratio stays well above the 0.08 safety floor
      // throughout, isolating the liquidityAbsolute check.
      const at = (liq: number) =>
        healthyCandidate({ totalSupply: 1, pools: [poolForTarget("0xtoken", 1, 200_000, liq)] });
      expect(passed(at(GATE_CONFIG.minLiquidityUsd - 1), "liquidityAbsolute")).toBe(false);
      expect(passed(at(GATE_CONFIG.minLiquidityUsd), "liquidityAbsolute")).toBe(true);
      expect(passed(at(GATE_CONFIG.minLiquidityUsd + 1), "liquidityAbsolute")).toBe(true);
    });

    it("liquidityToMcRatio (safety gate): one below / at / one above 0.08, and never relaxes", () => {
      const mc = 200_000;
      const at = (ratio: number) =>
        healthyCandidate({ totalSupply: 1, pools: [poolForTarget("0xtoken", 1, mc, ratio * mc)] });
      const below = at(GATE_CONFIG.minLiquidityToMcRatio - 0.0005);
      const exact = at(GATE_CONFIG.minLiquidityToMcRatio);
      const above = at(GATE_CONFIG.minLiquidityToMcRatio + 0.0005);
      expect(passed(below, "liquidityToMcRatio")).toBe(false);
      expect(passed(exact, "liquidityToMcRatio")).toBe(true);
      expect(passed(above, "liquidityToMcRatio")).toBe(true);
      // Safety gate: must still fail at max relaxation.
      expect(passed(below, "liquidityToMcRatio", 3)).toBe(false);
    });

    it("liquidityToMcRatio: mc === 0 is treated as a hard fail, not a division by zero", () => {
      const zeroMc = healthyCandidate({ totalSupply: 1, pools: [poolForTarget("0xtoken", 1, 0, 10_000)] });
      expect(passed(zeroMc, "liquidityToMcRatio")).toBe(false);
    });

    it("volume24h: one below / at / one above the $75k floor", () => {
      const at = (v: number) => healthyCandidate({ volume24hUsd: v });
      expect(passed(at(GATE_CONFIG.minVolume24hUsd - 1), "volume24h")).toBe(false);
      expect(passed(at(GATE_CONFIG.minVolume24hUsd), "volume24h")).toBe(true);
      expect(passed(at(GATE_CONFIG.minVolume24hUsd + 1), "volume24h")).toBe(true);
    });

    it("uniqueTraders24h: one below / at / one above 150 at default relaxation", () => {
      const at = (n: number) => healthyCandidate({ uniqueTraders24h: n });
      expect(passed(at(GATE_CONFIG.minUniqueTraders24h - 1), "uniqueTraders24h")).toBe(false);
      expect(passed(at(GATE_CONFIG.minUniqueTraders24h), "uniqueTraders24h")).toBe(true);
      expect(passed(at(GATE_CONFIG.minUniqueTraders24h + 1), "uniqueTraders24h")).toBe(true);
    });

    it("uniqueTraders24h: relaxed threshold is a raw (non-rounded) fraction — 112.5 at relaxation=1", () => {
      // relaxFactor at relaxation=1 is 0.75, so the true threshold is 150*0.75=112.5,
      // even though the human-readable `detail` string rounds it to 113 for display.
      const at = (n: number) => healthyCandidate({ uniqueTraders24h: n });
      expect(passed(at(112), "uniqueTraders24h", 1)).toBe(false);
      expect(passed(at(113), "uniqueTraders24h", 1)).toBe(true);
    });

    it("txCount24h: one below / at / one above 500", () => {
      const at = (n: number) => healthyCandidate({ txCount24h: n });
      expect(passed(at(GATE_CONFIG.minTxCount24h - 1), "txCount24h")).toBe(false);
      expect(passed(at(GATE_CONFIG.minTxCount24h), "txCount24h")).toBe(true);
      expect(passed(at(GATE_CONFIG.minTxCount24h + 1), "txCount24h")).toBe(true);
    });

    it("age: one day below / at / one day above the 2-day floor", () => {
      const at = (n: number) => healthyCandidate({ ageDays: n });
      expect(passed(at(GATE_CONFIG.minAgeDays - 1), "age")).toBe(false);
      expect(passed(at(GATE_CONFIG.minAgeDays), "age")).toBe(true);
      expect(passed(at(GATE_CONFIG.minAgeDays + 1), "age")).toBe(true);
    });

    it("lpLock (safety gate): one day below / at / one day above 30, unaffected by relaxation", () => {
      const at = (n: number) => healthyCandidate({ lpLockedDaysRemaining: n });
      expect(passed(at(GATE_CONFIG.minLpLockDaysRemaining - 1), "lpLock")).toBe(false);
      expect(passed(at(GATE_CONFIG.minLpLockDaysRemaining), "lpLock")).toBe(true);
      expect(passed(at(GATE_CONFIG.minLpLockDaysRemaining + 1), "lpLock")).toBe(true);
      // Still fails one-below-threshold even at max relaxation — never relaxes.
      expect(passed(at(GATE_CONFIG.minLpLockDaysRemaining - 1), "lpLock", 3)).toBe(false);
    });

    it("holderConcentration (safety gate): strict less-than — exactly at the 40% cap FAILS", () => {
      // Unlike every other gate here, this one is `<` not `<=`, so the exact
      // boundary value itself is on the failing side, not the passing side.
      const at = (pct: number) => healthyCandidate({ holderConcentrationTop10Pct: pct });
      expect(passed(at(GATE_CONFIG.maxHolderConcentrationTop10Pct - 1), "holderConcentration")).toBe(true);
      expect(passed(at(GATE_CONFIG.maxHolderConcentrationTop10Pct), "holderConcentration")).toBe(false);
      expect(passed(at(GATE_CONFIG.maxHolderConcentrationTop10Pct + 1), "holderConcentration")).toBe(false);
    });
  });

  describe("property: relaxation is monotonic and never touches safety gates", () => {
    const safetyGates = ["liquidityToMcRatio", "rugCheck", "lpLock", "holderConcentration", "blocklist"];
    const softGates = ["marketCap", "liquidityAbsolute", "volume24h", "uniqueTraders24h", "txCount24h", "age"];

    it("fuzz: safety-gate outcomes are identical across every relaxation level, soft-gate passes never flip back to fail", () => {
      let seed = 42;
      const rand = () => {
        // deterministic LCG so failures are reproducible
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };

      for (let trial = 0; trial < 200; trial++) {
        const candidate = healthyCandidate({
          uniqueTraders24h: Math.floor(rand() * 400),
          txCount24h: Math.floor(rand() * 1500),
          volume24hUsd: rand() * 200_000,
          ageDays: rand() * 5,
          holderConcentrationTop10Pct: rand() * 60,
          lpLockedDaysRemaining: rand() * 60,
          pools: [poolForTarget("0xtoken", 1, rand() * 400_000, rand() * 60_000)],
        });

        const evals = [0, 1, 2, 3].map((r) => evaluateGates(candidate, r));

        for (const name of safetyGates) {
          const values = evals.map((e) => e.checks.find((c) => c.name === name)?.passed);
          expect(new Set(values).size).toBe(1); // identical at every relaxation level
        }

        for (const name of softGates) {
          for (let r = 0; r < 3; r++) {
            const prevPassed = evals[r].checks.find((c) => c.name === name)?.passed;
            const nextPassed = evals[r + 1].checks.find((c) => c.name === name)?.passed;
            if (prevPassed) expect(nextPassed).toBe(true); // easing relaxation never un-passes a soft gate
          }
        }
      }
    });

    it("clamps relaxation so thresholds never go negative even if called with an out-of-range level", () => {
      // evaluateGates is exported and callable directly with any relaxation value,
      // even though selectTopTen only ever calls it with 0..3.
      const zeroEverything = healthyCandidate({
        volume24hUsd: 0,
        uniqueTraders24h: 0,
        txCount24h: 0,
        ageDays: 0,
      });
      const result = evaluateGates(zeroEverything, 10);
      // relaxFactor is clamped at 0, so soft-gate thresholds bottom out at 0 —
      // a candidate with literally zero volume/traders/age still passes those
      // soft gates once relaxed this far (Math.max(0, ...) floor, not negative).
      expect(passed(zeroEverything, "volume24h", 10)).toBe(true);
      expect(passed(zeroEverything, "age", 10)).toBe(true);
      expect(result.checks.find((c) => c.name === "volume24h")?.detail).toContain("$0");
    });
  });
});
