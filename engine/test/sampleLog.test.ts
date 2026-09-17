import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { SampleLog } from "../src/oracle/sampleLog.js";

/** Mirrors sampleLog.ts's private hashEntry() so a test can forge a self-consistent hash. */
function hashEntry(seq: number, prevHash: string, data: unknown): string {
  return createHash("sha256").update(`${seq}:${prevHash}:${JSON.stringify(data)}`).digest("hex");
}

describe("SampleLog", () => {
  it("verifies a chain nothing has tampered with", () => {
    const log = new SampleLog<{ price: number }>();
    log.append({ price: 1 });
    log.append({ price: 1.1 });
    log.append({ price: 1.05 });
    expect(log.verify()).toBe(true);
  });

  it("detects tampering with a historical entry", () => {
    const log = new SampleLog<{ price: number }>();
    log.append({ price: 1 });
    log.append({ price: 1.1 });
    const entries = log.all();
    entries[0].data.price = 999; // simulate someone editing history
    expect(log.verify()).toBe(false);
  });

  it("chains sequence numbers and hashes in order", () => {
    const log = new SampleLog<number>();
    const a = log.append(1);
    const b = log.append(2);
    expect(b.prevHash).toBe(a.hash);
    expect(b.seq).toBe(a.seq + 1);
  });

  it("detects tampering with a PRIOR entry even when the attacker forges a self-consistent hash for it", () => {
    // The weak version of this test just edits entry[0].data and leaves its
    // stored hash alone — that's caught trivially because the *entry's own*
    // recomputed hash no longer matches, without ever exercising the chain
    // link itself. Here the attacker does the harder, more realistic thing:
    // edit the data AND recompute that entry's own hash so it's internally
    // consistent. The tamper must still be caught — via the NEXT entry's
    // prevHash no longer matching the (now-changed) forged hash. That's the
    // actual "hash-chained" guarantee, not just per-entry hash recomputation.
    const log = new SampleLog<{ price: number }>();
    log.append({ price: 1 });
    log.append({ price: 1.1 });
    log.append({ price: 1.05 });

    expect(log.verify()).toBe(true); // sanity: untampered chain verifies first

    const entries = log.all();
    const forged = { price: 999 };
    entries[0].data = forged;
    entries[0].hash = hashEntry(entries[0].seq, entries[0].prevHash, forged); // self-consistent forgery

    expect(log.verify()).toBe(false); // still caught, via entries[1].prevHash mismatch
  });

  it("a forged entry that also patches the immediate successor's prevHash still breaks two links later", () => {
    // Push the forgery one step further: the attacker re-links entry[1] to
    // point at the new forged hash, but doesn't (can't, without redoing the
    // whole downstream chain) fix entry[1]'s own hash, which was computed
    // from the OLD prevHash. The chain must still catch this at entry[1].
    const log = new SampleLog<{ price: number }>();
    log.append({ price: 1 });
    log.append({ price: 1.1 });
    log.append({ price: 1.05 });

    const entries = log.all();
    const forged = { price: 999 };
    const forgedHash = hashEntry(entries[0].seq, entries[0].prevHash, forged);
    entries[0].data = forged;
    entries[0].hash = forgedHash;
    entries[1].prevHash = forgedHash; // re-link, but entry[1].hash is now stale

    expect(log.verify()).toBe(false);
  });
});
