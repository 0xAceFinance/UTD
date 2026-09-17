import { describe, it, expect } from "vitest";
import { passesLiquidityGate } from "../src/oracle/liquidityGate.js";

describe("passesLiquidityGate", () => {
  it("passes when liquidity is unchanged", () => {
    expect(passesLiquidityGate(100_000, 100_000)).toBe(true);
  });

  it("passes when liquidity dipped but stayed above the 70% floor", () => {
    expect(passesLiquidityGate(75_000, 100_000)).toBe(true);
  });

  it("rejects a read after liquidity has been pulled below the floor (a rug)", () => {
    expect(passesLiquidityGate(20_000, 100_000)).toBe(false);
  });

  it("rejects outright if there was never any starting liquidity", () => {
    expect(passesLiquidityGate(10_000, 0)).toBe(false);
  });

  describe("exact-boundary at the 0.7 ratio floor", () => {
    it("one unit below the 70% floor fails", () => {
      expect(passesLiquidityGate(69_999, 100_000)).toBe(false);
    });

    it("exactly at the 70% floor passes (inclusive)", () => {
      expect(passesLiquidityGate(70_000, 100_000)).toBe(true);
    });

    it("one unit above the 70% floor passes", () => {
      expect(passesLiquidityGate(70_001, 100_000)).toBe(true);
    });
  });

  it("fuzz: passesLiquidityGate agrees with a plain ratio comparison across random inputs", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 500; i++) {
      const start = rand() * 1_000_000;
      const current = rand() * 1_000_000;
      const minRatio = 0.7;
      const expected = start > 0 && current / start >= minRatio;
      expect(passesLiquidityGate(current, start, minRatio)).toBe(expected);
    }
  });
});
