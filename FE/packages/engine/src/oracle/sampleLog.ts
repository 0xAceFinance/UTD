import { createHash } from "node:crypto";

export interface SampleLogEntry<T = unknown> {
  seq: number;
  data: T;
  prevHash: string;
  hash: string;
}

const GENESIS_HASH = "0".repeat(64);

function hashEntry(seq: number, prevHash: string, data: unknown): string {
  return createHash("sha256").update(`${seq}:${prevHash}:${JSON.stringify(data)}`).digest("hex");
}

/**
 * Section 04, mechanism 5: every raw oracle sample is written to an
 * append-only, hash-chained log. Any settled match can be independently
 * re-derived and audited after the fact — tamper with one entry and every
 * hash after it stops matching.
 */
export class SampleLog<T = unknown> {
  private entries: SampleLogEntry<T>[] = [];

  append(data: T): SampleLogEntry<T> {
    const seq = this.entries.length;
    const prevHash = seq === 0 ? GENESIS_HASH : this.entries[seq - 1].hash;
    const hash = hashEntry(seq, prevHash, data);
    const entry: SampleLogEntry<T> = { seq, data, prevHash, hash };
    this.entries.push(entry);
    return entry;
  }

  all(): ReadonlyArray<SampleLogEntry<T>> {
    return this.entries;
  }

  /** Recomputes every hash in the chain and confirms nothing has been altered. */
  verify(): boolean {
    let prevHash = GENESIS_HASH;
    for (const entry of this.entries) {
      if (entry.prevHash !== prevHash) return false;
      if (hashEntry(entry.seq, entry.prevHash, entry.data) !== entry.hash) return false;
      prevHash = entry.hash;
    }
    return true;
  }
}
