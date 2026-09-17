import { describe, it, expect } from "vitest";
import { canCreateLobby } from "../src/cancellationLimiter.js";

const NOW = 1_700_000_000;
const HOUR = 60 * 60;

/** Small deterministic PRNG (mulberry32) so fuzz tests are reproducible, not flaky. */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("canCreateLobby — the anti-spam brake, not a fee", () => {
  it("allows lobby creation with no prior cancellations", () => {
    expect(canCreateLobby([], NOW)).toBe(true);
  });

  it("allows up to 4 cancellations in the window without any cooldown", () => {
    const cancellations = [NOW - 100, NOW - 200, NOW - 300, NOW - 400];
    expect(canCreateLobby(cancellations, NOW)).toBe(true);
  });

  it("blocks new lobby creation right after the 5th cancellation in an hour", () => {
    const cancellations = [NOW - 100, NOW - 200, NOW - 300, NOW - 400, NOW - 500];
    expect(canCreateLobby(cancellations, NOW)).toBe(false);
  });

  it("unblocks once the cooldown period has passed since the most recent cancellation", () => {
    const fifthCancellationAt = NOW - 20 * 60; // 20 minutes ago
    const cancellations = [NOW - 3000, NOW - 3100, NOW - 3200, NOW - 3300, fifthCancellationAt];
    // cooldown is 15 minutes; 20 minutes have passed since the 5th cancellation
    expect(canCreateLobby(cancellations, NOW)).toBe(true);
  });

  it("ignores cancellations that have aged out of the rolling window", () => {
    const cancellations = [NOW - HOUR - 10, NOW - HOUR - 20, NOW - HOUR - 30, NOW - HOUR - 40, NOW - HOUR - 50];
    expect(canCreateLobby(cancellations, NOW)).toBe(true);
  });
});

describe("canCreateLobby — exact boundaries", () => {
  it("excludes a cancellation exactly at the window boundary (filter is strictly-greater-than)", () => {
    const windowStart = NOW - HOUR;
    // windowStart itself must age out, leaving only 3 counted -> well under the cap
    const cancellations = [windowStart, NOW - 100, NOW - 200, NOW - 300];
    expect(canCreateLobby(cancellations, NOW)).toBe(true);
  });

  it("counts a cancellation one second inside the window boundary", () => {
    const justInsideWindow = NOW - HOUR + 1;
    const cancellations = [justInsideWindow, NOW - 100, NOW - 200, NOW - 300, NOW - 400];
    // now 5 timestamps count within the window -> at the cap -> blocked
    expect(canCreateLobby(cancellations, NOW)).toBe(false);
  });

  it("unblocks at the exact cooldown boundary (comparison is >=, not strictly >)", () => {
    // The cooldown is measured from the *most recent* of the within-window
    // cancellations, so all 5 must be at or before that most-recent one for
    // it to actually be the value the cooldown check uses.
    const cooldown = 15 * 60;
    const mostRecentAt = NOW - cooldown;
    const cancellations = [mostRecentAt - 10, mostRecentAt - 20, mostRecentAt - 30, mostRecentAt - 40, mostRecentAt];
    expect(canCreateLobby(cancellations, NOW)).toBe(true);
  });

  it("still blocks one second before the cooldown fully elapses", () => {
    const cooldown = 15 * 60;
    const mostRecentAt = NOW - (cooldown - 1);
    const cancellations = [mostRecentAt - 10, mostRecentAt - 20, mostRecentAt - 30, mostRecentAt - 40, mostRecentAt];
    expect(canCreateLobby(cancellations, NOW)).toBe(false);
  });

  it("exact-count boundary: the 5th cancellation is allowed to happen, but creating a 6th lobby right after is blocked", () => {
    let history: number[] = [];
    let t = NOW;

    for (let i = 0; i < 5; i++) {
      // allowed to create (and then immediately cancel) for cancellations 1 through 5
      expect(canCreateLobby(history, t)).toBe(true);
      history = [...history, t];
      t += 60;
    }

    // immediately after the 5th cancellation, a 6th create is blocked
    expect(canCreateLobby(history, t)).toBe(false);
  });
});

describe("canCreateLobby — window/cooldown reset correctly as time advances", () => {
  it("walks a timeline: blocked right at the cap, still blocked mid-cooldown, unblocked exactly at cooldown", () => {
    const history = [NOW, NOW + 60, NOW + 120, NOW + 180, NOW + 240];
    const lastCancellationAt = NOW + 240;
    const cooldown = 15 * 60;

    expect(canCreateLobby(history, lastCancellationAt)).toBe(false);
    expect(canCreateLobby(history, lastCancellationAt + cooldown - 1)).toBe(false);
    expect(canCreateLobby(history, lastCancellationAt + cooldown)).toBe(true);
  });

  it("re-blocks if the user immediately cancels again after the cooldown clears (a fresh 5th within the window)", () => {
    // 4 old cancellations still within the 1h window, cooldown from the 5th just cleared,
    // user creates+cancels again -> that's a fresh 5th in-window cancellation -> blocked again
    const fourOld = [NOW - 3000, NOW - 3100, NOW - 3200, NOW - 3300];
    const afterCooldownCleared = NOW; // caller allowed to create here
    expect(canCreateLobby(fourOld, afterCooldownCleared)).toBe(true);

    const withFreshCancellation = [...fourOld, afterCooldownCleared];
    expect(canCreateLobby(withFreshCancellation, afterCooldownCleared + 1)).toBe(false);
  });

  it("fuzz: for any fixed cancellation history, once unblocked at time T it stays unblocked for all later times", () => {
    const rng = mulberry32(999);

    for (let trial = 0; trial < 200; trial++) {
      const count = 1 + Math.floor(rng() * 8);
      const history: number[] = [];
      let t = NOW;
      for (let i = 0; i < count; i++) {
        t -= Math.floor(rng() * 5000);
        history.push(t);
      }

      let seenTrue = false;
      for (let dt = 0; dt <= 3 * HOUR; dt += 5 * 60) {
        const now = NOW + dt;
        const result = canCreateLobby(history, now);
        if (seenTrue) {
          expect(result).toBe(true);
        }
        if (result) seenTrue = true;
      }
    }
  });
});
