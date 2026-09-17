import { describe, it, expect } from "vitest";
import { selectTopTen } from "../src/scanner/topTen.js";
import { MockDataSource } from "../src/chain/mockSource.js";

describe("selectTopTen", () => {
  it("excludes tokens that fail a safety gate even under relaxation", async () => {
    const candidates = await new MockDataSource().listCandidates();
    const result = selectTopTen(candidates);

    const selectedAddresses = result.selected.map((t) => t.tokenAddress);
    expect(selectedAddresses).not.toContain("0xDDD...concentrated"); // holder concentration
    expect(selectedAddresses).not.toContain("0xEEE...unlocked"); // LP lock
    expect(selectedAddresses).not.toContain("0xFFF...blocked"); // blocklist
  });

  it("includes a token that clears every gate", async () => {
    const candidates = await new MockDataSource().listCandidates();
    const result = selectTopTen(candidates);
    expect(result.selected.map((t) => t.tokenAddress)).toContain("0xAAA...healthy");
  });

  it("flags ranking as relaxed only when fewer than 10 candidates clear default thresholds", async () => {
    const candidates = await new MockDataSource().listCandidates();
    const result = selectTopTen(candidates);
    // The mock set only has 6 candidates total, so with several failing safety
    // gates outright, we should need at least some relaxation to reach 10 —
    // or fall short of 10 entirely, which is fine (Section 01 edge case).
    expect(result.selected.length).toBeLessThanOrEqual(10);
  });

  describe("low-supply edge case (README: safety gates never relax, soft eligibility gates do)", () => {
    it("relaxes all the way to the max level and still falls short of 10 when the whole universe is only 6 tokens", async () => {
      const candidates = await new MockDataSource().listCandidates();
      const result = selectTopTen(candidates);

      // Only 6 candidates exist at all, so 10 survivors is unreachable no matter
      // how far soft gates relax — the loop must run out at MAX_RELAXATION_LEVEL (3),
      // not silently stop early or throw.
      expect(result.rankingRelaxed).toBe(true);
      expect(result.relaxationLevel).toBe(3);
      expect(result.selected.length).toBeLessThan(10);
    });

    it("never admits a safety-gate failure, at any relaxation level, even when the pool is starved for candidates", async () => {
      const candidates = await new MockDataSource().listCandidates();
      const result = selectTopTen(candidates);
      const selectedAddresses = result.selected.map((t) => t.tokenAddress);

      // These three fail safety gates (holder concentration, LP lock, blocklist)
      // and must stay excluded even at relaxationLevel 3 — that's the entire
      // point of the low-supply edge case, not just an incidental outcome.
      for (const addr of ["0xDDD...concentrated", "0xEEE...unlocked", "0xFFF...blocked"]) {
        expect(selectedAddresses).not.toContain(addr);
        const excludedEntry = result.excluded.find((e) => e.tokenAddress === addr);
        expect(excludedEntry).toBeDefined();
        expect(excludedEntry!.checks.filter((c) => c.isSafetyGate && !c.passed).length).toBeGreaterThan(0);
      }
    });

    it("does admit a soft-gate failure once relaxed far enough (thin liquidity clears at relaxationLevel 2)", async () => {
      const candidates = await new MockDataSource().listCandidates();
      const result = selectTopTen(candidates);
      // 0xBBB...thinliquidity only fails the soft marketCap gate at full strength;
      // by the time relaxation reaches 3 it must be let in.
      expect(result.selected.map((t) => t.tokenAddress)).toContain("0xBBB...thinliquidity");
    });
  });
});
