import { describe, it, expect } from "vitest";
import { scoreCandidates } from "../src/scanner/score.js";
import { MockDataSource } from "../src/chain/mockSource.js";

describe("scoreCandidates", () => {
  it("scores every candidate between 0 and 1", async () => {
    const candidates = await new MockDataSource().listCandidates();
    const scores = scoreCandidates(candidates);
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("ranks the highest-volume, highest-liquidity token above a thin one", async () => {
    const candidates = await new MockDataSource().listCandidates();
    const scores = scoreCandidates(candidates);
    const healthy = scores.get("0xAAA...healthy")!;
    const thin = scores.get("0xBBB...thinliquidity")!;
    expect(healthy).toBeGreaterThan(thin);
  });
});
