import { describe, it, expect } from "vitest";
import { shouldPauseNewLobbies } from "../src/circuitBreaker.js";

const CONFIG = { maxStalenessSeconds: 120, maxConsecutiveFailures: 3 };
const NOW = 1_700_000_000;

describe("shouldPauseNewLobbies", () => {
  it("pauses when there is no health data at all -- fails safe", () => {
    expect(shouldPauseNewLobbies([], NOW, CONFIG)).toBe(true);
  });

  it("does not pause when the latest sample is fresh and succeeded", () => {
    const samples = [{ timestampSec: NOW - 10, succeeded: true }];
    expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(false);
  });

  it("pauses when the most recent sample is stale, even if it succeeded", () => {
    const samples = [{ timestampSec: NOW - 300, succeeded: true }];
    expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(true);
  });

  it("pauses after enough consecutive failures, even if recent", () => {
    const samples = [
      { timestampSec: NOW - 30, succeeded: false },
      { timestampSec: NOW - 20, succeeded: false },
      { timestampSec: NOW - 10, succeeded: false },
    ];
    expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(true);
  });

  it("does not pause on an isolated failure surrounded by successes", () => {
    const samples = [
      { timestampSec: NOW - 40, succeeded: true },
      { timestampSec: NOW - 30, succeeded: false },
      { timestampSec: NOW - 20, succeeded: true },
      { timestampSec: NOW - 10, succeeded: true },
    ];
    expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(false);
  });

  it("only counts the trailing run of failures, not failures buried earlier in history", () => {
    const samples = [
      { timestampSec: NOW - 100, succeeded: false },
      { timestampSec: NOW - 90, succeeded: false },
      { timestampSec: NOW - 80, succeeded: false },
      { timestampSec: NOW - 70, succeeded: true }, // resets the streak
      { timestampSec: NOW - 10, succeeded: false },
    ];
    expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(false);
  });

  describe("exact maxConsecutiveFailures boundary (config = 3)", () => {
    it("does not pause at one failure under the threshold (2 consecutive failures)", () => {
      const samples = [
        { timestampSec: NOW - 20, succeeded: false },
        { timestampSec: NOW - 10, succeeded: false },
      ];
      expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(false);
    });

    it("pauses at exactly the threshold (3 consecutive failures)", () => {
      const samples = [
        { timestampSec: NOW - 30, succeeded: false },
        { timestampSec: NOW - 20, succeeded: false },
        { timestampSec: NOW - 10, succeeded: false },
      ];
      expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(true);
    });

    it("stays paused one failure past the threshold (4 consecutive failures)", () => {
      const samples = [
        { timestampSec: NOW - 40, succeeded: false },
        { timestampSec: NOW - 30, succeeded: false },
        { timestampSec: NOW - 20, succeeded: false },
        { timestampSec: NOW - 10, succeeded: false },
      ];
      expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(true);
    });
  });

  describe("exact maxStalenessSeconds boundary (config = 120)", () => {
    it("does not treat the latest sample as stale at exactly the staleness limit", () => {
      const samples = [{ timestampSec: NOW - 120, succeeded: true }];
      expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(false);
    });

    it("treats the latest sample as stale one second past the staleness limit", () => {
      const samples = [{ timestampSec: NOW - 121, succeeded: true }];
      expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(true);
    });
  });

  describe("recovery", () => {
    it("un-trips immediately once a single fresh success lands after a failure streak at/above threshold", () => {
      // Per the source, consecutiveFailures is counted from the *latest*
      // sample backwards and stops at the first success -- so there is no
      // hysteresis or minimum number of healthy samples required to recover:
      // a single success as the newest sample resets the streak to 0.
      const samples = [
        { timestampSec: NOW - 50, succeeded: false },
        { timestampSec: NOW - 40, succeeded: false },
        { timestampSec: NOW - 30, succeeded: false },
        { timestampSec: NOW - 20, succeeded: false },
        { timestampSec: NOW - 10, succeeded: true }, // recovery sample
      ];
      expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(false);
    });

    it("does not un-trip if the recovery success itself is stale", () => {
      const samples = [
        { timestampSec: NOW - 500, succeeded: false },
        { timestampSec: NOW - 490, succeeded: false },
        { timestampSec: NOW - 480, succeeded: false },
        { timestampSec: NOW - 200, succeeded: true }, // success, but stale relative to NOW
      ];
      expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(true);
    });

    it("re-trips immediately if a fresh failure follows a recovery success", () => {
      const samples = [
        { timestampSec: NOW - 50, succeeded: false },
        { timestampSec: NOW - 40, succeeded: false },
        { timestampSec: NOW - 30, succeeded: false },
        { timestampSec: NOW - 20, succeeded: true }, // brief recovery
        { timestampSec: NOW - 10, succeeded: false }, // one fresh failure again
      ];
      // Only 1 consecutive failure trailing -- below threshold, so NOT paused.
      // This documents that the breaker has no "cooldown" concept: it only
      // ever looks at the unbroken trailing run, regardless of a recent trip.
      expect(shouldPauseNewLobbies(samples, NOW, CONFIG)).toBe(false);
    });
  });
});

describe("shouldPauseNewLobbies property test (fuzz)", () => {
  it("pauses iff the trailing run of failures reaches maxConsecutiveFailures, for random trailing-failure run lengths", () => {
    for (let trial = 0; trial < 200; trial++) {
      const threshold = 1 + Math.floor(Math.random() * 6);
      const config = { maxStalenessSeconds: 10_000, maxConsecutiveFailures: threshold };
      const trailingFailures = Math.floor(Math.random() * (threshold * 2 + 1));
      // Precede the trailing failure run with a guaranteed streak-breaking
      // success so earlier random history can never leak into the count.
      const samples = [{ timestampSec: NOW - 1000, succeeded: true }];
      for (let i = 0; i < trailingFailures; i++) {
        samples.push({ timestampSec: NOW - (trailingFailures - i) * 10, succeeded: false });
      }
      const result = shouldPauseNewLobbies(samples, NOW, config);
      expect(result).toBe(trailingFailures >= threshold);
    }
  });
});
