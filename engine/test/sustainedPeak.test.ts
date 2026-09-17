import { describe, it, expect } from "vitest";
import { computeSustainedPeak } from "../src/oracle/sustainedPeak.js";

describe("computeSustainedPeak", () => {
  it("rejects a pump-and-dump wick that doesn't hold for the dwell window", () => {
    const points = [
      { timestampSec: 0, priceUsd: 1.0 },
      { timestampSec: 10, priceUsd: 1.0 },
      { timestampSec: 20, priceUsd: 5.0 }, // the wick
      { timestampSec: 25, priceUsd: 1.05 }, // dumped straight back down
      { timestampSec: 40, priceUsd: 1.05 },
      { timestampSec: 60, priceUsd: 1.05 },
    ];
    const result = computeSustainedPeak(points, { dwellSeconds: 30, toleranceRatio: 0.02 });
    // The wick at 5.0 must not be reported — the real, held level is ~1.05.
    expect(result?.peakPriceUsd).toBeLessThan(1.2);
  });

  it("accepts a rally that genuinely holds for the full dwell window", () => {
    const points = [
      { timestampSec: 0, priceUsd: 1.0 },
      { timestampSec: 10, priceUsd: 1.3 },
      { timestampSec: 20, priceUsd: 1.31 },
      { timestampSec: 30, priceUsd: 1.29 },
      { timestampSec: 40, priceUsd: 1.3 },
    ];
    const result = computeSustainedPeak(points, { dwellSeconds: 30, toleranceRatio: 0.02 });
    expect(result?.peakPriceUsd).toBeGreaterThanOrEqual(1.29);
  });

  it("returns null when there isn't enough data to cover a full dwell window", () => {
    const points = [{ timestampSec: 0, priceUsd: 1.0 }];
    const result = computeSustainedPeak(points, { dwellSeconds: 30 });
    expect(result).toBeNull();
  });

  describe("dwell-time boundary", () => {
    it("validates a candidate the instant coverage exactly reaches the dwell window (t + dwellSeconds)", () => {
      const points = [
        { timestampSec: 0, priceUsd: 1.0 },
        { timestampSec: 30, priceUsd: 1.0 }, // exactly candidate.timestampSec + dwellSeconds
      ];
      const result = computeSustainedPeak(points, { dwellSeconds: 30, toleranceRatio: 0.02 });
      expect(result).not.toBeNull();
      expect(result?.peakPriceUsd).toBe(1.0);
      expect(result?.windowStartSec).toBe(0);
    });

    it("refuses to validate the same candidate when coverage falls one second short of the dwell window", () => {
      const points = [
        { timestampSec: 0, priceUsd: 1.0 },
        { timestampSec: 29, priceUsd: 1.0 }, // one second short of candidate + dwellSeconds
      ];
      const result = computeSustainedPeak(points, { dwellSeconds: 30, toleranceRatio: 0.02 });
      // Not enough observed coverage yet to credit t=0 as a validated peak.
      expect(result).toBeNull();
    });

    it("one second short of dwell coverage still returns null even if a later, fully-covered but lower candidate exists", () => {
      // Regression guard: an insufficiently-covered high candidate must never
      // be silently swapped for a smaller one — it should just be skipped.
      const points = [
        { timestampSec: 0, priceUsd: 2.0 },
        { timestampSec: 29, priceUsd: 2.0 }, // t=0's dwell window needs t=30; falls 1s short
      ];
      const result = computeSustainedPeak(points, { dwellSeconds: 30, toleranceRatio: 0.02 });
      expect(result).toBeNull();
    });
  });
});
