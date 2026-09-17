import { describe, it, expect } from "vitest";
import { twapAt } from "../src/oracle/twap.js";

describe("twapAt", () => {
  it("returns the flat price when nothing moves", () => {
    const points = [
      { timestampSec: 0, priceUsd: 1 },
      { timestampSec: 30, priceUsd: 1 },
      { timestampSec: 60, priceUsd: 1 },
    ];
    expect(twapAt(points, 60, 60)).toBeCloseTo(1);
  });

  it("barely moves for a one-sample spike inside a 60s window", () => {
    const points = [
      { timestampSec: 0, priceUsd: 1 },
      { timestampSec: 58, priceUsd: 1 },
      { timestampSec: 59, priceUsd: 100 }, // one-block wick
      { timestampSec: 60, priceUsd: 1 },
    ];
    const twap = twapAt(points, 60, 60);
    // A single instantaneous spike over a 60s trailing window should stay
    // far closer to 1 than to the spike value.
    expect(twap).toBeLessThan(10);
  });

  it("tracks a sustained move that holds across the whole window", () => {
    const points = [
      { timestampSec: 0, priceUsd: 1 },
      { timestampSec: 20, priceUsd: 1.3 },
      { timestampSec: 40, priceUsd: 1.3 },
      { timestampSec: 60, priceUsd: 1.3 },
    ];
    const twap = twapAt(points, 60, 60);
    expect(twap).toBeGreaterThan(1.1);
  });

  describe("window-edge timing", () => {
    it("includes a sample exactly at the trailing window start (inclusive lower bound)", () => {
      // windowStart = 60 - 60 = 0. If the point at t=0 were wrongly excluded,
      // only the single point at t=60 would remain and twap would collapse to
      // that point's price (60) instead of averaging across the window (30).
      const points = [
        { timestampSec: 0, priceUsd: 0 },
        { timestampSec: 60, priceUsd: 60 },
      ];
      expect(twapAt(points, 60, 60)).toBeCloseTo(30);
    });

    it("excludes a sample exactly one second before the window start", () => {
      const points = [
        { timestampSec: -1, priceUsd: 10_000 }, // just outside the window
        { timestampSec: 0, priceUsd: 1 },
        { timestampSec: 60, priceUsd: 1 },
      ];
      expect(twapAt(points, 60, 60)).toBeCloseTo(1);
    });

    it("includes a sample exactly at `atTimestampSec` (inclusive upper bound)", () => {
      const points = [
        { timestampSec: 0, priceUsd: 1 },
        { timestampSec: 60, priceUsd: 5 },
      ];
      // If the point at t=60 were excluded, this would return the single
      // remaining point's price (1) instead of the trapezoid average.
      expect(twapAt(points, 60, 60)).toBeCloseTo(3);
    });

    it("never leaks a future sample one second past `atTimestampSec`", () => {
      const points = [
        { timestampSec: 0, priceUsd: 1 },
        { timestampSec: 60, priceUsd: 1 },
        { timestampSec: 61, priceUsd: 1_000 }, // must not influence a TWAP snapshot at t=60
      ];
      expect(twapAt(points, 60, 60)).toBeCloseTo(1);
    });
  });

  it("fuzz: a constant price series always TWAPs to that same constant, at any window/timestamp", () => {
    let seed = 55;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 200; trial++) {
      const price = rand() * 1000;
      const n = 2 + Math.floor(rand() * 8);
      let t = 0;
      const points = Array.from({ length: n }, () => {
        t += Math.floor(rand() * 30) + 1;
        return { timestampSec: t, priceUsd: price };
      });
      const windowSeconds = 30 + Math.floor(rand() * 90);
      const at = points[points.length - 1].timestampSec;
      expect(twapAt(points, at, windowSeconds)).toBeCloseTo(price, 8);
    }
  });
});
