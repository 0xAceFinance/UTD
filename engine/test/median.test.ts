import { describe, it, expect } from "vitest";
import { liquidityWeightedMedianPrice } from "../src/oracle/median.js";

describe("liquidityWeightedMedianPrice", () => {
  it("returns the single price when only one pool exists", () => {
    const price = liquidityWeightedMedianPrice([
      { poolAddress: "a", timestampSec: 0, priceUsd: 1.5, liquidityUsd: 100_000 },
    ]);
    expect(price).toBe(1.5);
  });

  it("is not dragged proportionally by one thin, manipulated pool", () => {
    // Two deep pools agree on ~$1.00; one shallow pool has been pumped to $5.
    const price = liquidityWeightedMedianPrice([
      { poolAddress: "deep-1", timestampSec: 0, priceUsd: 1.0, liquidityUsd: 500_000 },
      { poolAddress: "deep-2", timestampSec: 0, priceUsd: 1.02, liquidityUsd: 500_000 },
      { poolAddress: "thin-manipulated", timestampSec: 0, priceUsd: 5.0, liquidityUsd: 10_000 },
    ]);
    // The median should land on one of the deep pools' prices, nowhere near $5.
    expect(price).toBeLessThan(1.1);
  });

  it("ignores pools with zero liquidity entirely", () => {
    const price = liquidityWeightedMedianPrice([
      { poolAddress: "dead", timestampSec: 0, priceUsd: 999, liquidityUsd: 0 },
      { poolAddress: "live", timestampSec: 0, priceUsd: 2.0, liquidityUsd: 100_000 },
    ]);
    expect(price).toBe(2.0);
  });

  describe("degenerate inputs", () => {
    it("returns 0 for an empty sample set", () => {
      expect(liquidityWeightedMedianPrice([])).toBe(0);
    });

    it("returns 0 when every pool has zero liquidity", () => {
      const price = liquidityWeightedMedianPrice([
        { poolAddress: "a", timestampSec: 0, priceUsd: 1.0, liquidityUsd: 0 },
        { poolAddress: "b", timestampSec: 0, priceUsd: 999, liquidityUsd: 0 },
      ]);
      expect(price).toBe(0);
    });

    it("returns the common price when every pool reports the same price, regardless of wildly different weights", () => {
      const price = liquidityWeightedMedianPrice([
        { poolAddress: "a", timestampSec: 0, priceUsd: 3.0, liquidityUsd: 1 },
        { poolAddress: "b", timestampSec: 0, priceUsd: 3.0, liquidityUsd: 1_000_000 },
        { poolAddress: "c", timestampSec: 0, priceUsd: 3.0, liquidityUsd: 500 },
      ]);
      expect(price).toBe(3.0);
    });

    it("single pool with zero liquidity is excluded, falling back to the empty-set result of 0", () => {
      const price = liquidityWeightedMedianPrice([{ poolAddress: "only", timestampSec: 0, priceUsd: 42, liquidityUsd: 0 }]);
      expect(price).toBe(0);
    });

    it("even count of equal-weight pools resolves to the lower of the two middle prices (documents the tie-break rule)", () => {
      // With 4 equal-liquidity pools priced 1,2,3,4: total weight 4L, half is 2L.
      // Cumulative liquidity reaches 2L exactly at the second sample (price 2),
      // so that's what's returned — not an interpolated 2.5. This is a
      // deliberate, documented tie-break (favors the lower price on exact ties),
      // not a defect, but pinning it down here so a refactor can't silently change it.
      const price = liquidityWeightedMedianPrice([
        { poolAddress: "a", timestampSec: 0, priceUsd: 1, liquidityUsd: 100 },
        { poolAddress: "b", timestampSec: 0, priceUsd: 2, liquidityUsd: 100 },
        { poolAddress: "c", timestampSec: 0, priceUsd: 3, liquidityUsd: 100 },
        { poolAddress: "d", timestampSec: 0, priceUsd: 4, liquidityUsd: 100 },
      ]);
      expect(price).toBe(2);
    });
  });

  it("fuzz: the weighted median never falls outside the [min, max] price of the liquid inputs", () => {
    let seed = 99;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 6);
      const samples = Array.from({ length: n }, (_, i) => ({
        poolAddress: `p${i}`,
        timestampSec: 0,
        priceUsd: rand() * 1000,
        liquidityUsd: rand() * 100_000,
      }));
      const price = liquidityWeightedMedianPrice(samples);
      const liquid = samples.filter((s) => s.liquidityUsd > 0);
      if (liquid.length === 0) {
        expect(price).toBe(0);
      } else {
        const min = Math.min(...liquid.map((s) => s.priceUsd));
        const max = Math.max(...liquid.map((s) => s.priceUsd));
        expect(price).toBeGreaterThanOrEqual(min);
        expect(price).toBeLessThanOrEqual(max);
      }
    }
  });

  it("fuzz: adding a zero-liquidity pool never changes the result", () => {
    let seed = 123;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 100; trial++) {
      const n = 1 + Math.floor(rand() * 5);
      const samples = Array.from({ length: n }, (_, i) => ({
        poolAddress: `p${i}`,
        timestampSec: 0,
        priceUsd: rand() * 1000,
        liquidityUsd: rand() * 100_000 + 1, // ensure > 0
      }));
      const before = liquidityWeightedMedianPrice(samples);
      const withDead = [...samples, { poolAddress: "dead", timestampSec: 0, priceUsd: rand() * 1_000_000, liquidityUsd: 0 }];
      const after = liquidityWeightedMedianPrice(withDead);
      expect(after).toBe(before);
    }
  });
});
