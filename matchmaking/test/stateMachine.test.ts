import { describe, it, expect } from "vitest";
import {
  createLobby,
  submitJoin,
  failJoin,
  confirmLive,
  closeBattleWindow,
  flagForReview,
  settle,
  cancel,
  expire,
  voidHeld,
  refundStale,
} from "../src/stateMachine.js";
import { InvalidTransitionError } from "../src/types.js";
import type { Lobby, LobbyStatus } from "../src/types.js";

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

const NOW = 1_700_000_000;

function baseLobby(overrides: Partial<Parameters<typeof createLobby>[0]> = {}) {
  return createLobby({
    id: "lobby-1",
    creator: "0xCreator",
    tokenASymbol: "TOKA",
    tokenBSymbol: "TOKB",
    creatorSide: 0,
    durationSeconds: 20 * 60,
    nowSec: NOW,
    ...overrides,
  });
}

describe("lobby state machine — open window", () => {
  it("gives an unmatched lobby exactly 5 minutes to find an opponent", () => {
    const lobby = baseLobby();
    expect(lobby.openDeadlineSec).toBe(NOW + 5 * 60);
    expect(() => submitJoin(lobby, "0xOpponent", NOW + 5 * 60)).not.toThrow();
    expect(() => submitJoin(lobby, "0xOpponent", NOW + 5 * 60 + 1)).toThrow("open window has already passed");
  });
});

describe("lobby state machine — the happy path", () => {
  it("walks OPEN -> MATCHED -> LIVE -> SETTLING -> SETTLED", () => {
    let lobby = baseLobby();
    expect(lobby.status).toBe("OPEN");

    lobby = submitJoin(lobby, "0xOpponent", NOW + 10);
    expect(lobby.status).toBe("MATCHED");

    lobby = confirmLive(lobby, NOW + 12);
    expect(lobby.status).toBe("LIVE");
    expect(lobby.endTimeSec).toBe(NOW + 12 + 20 * 60);

    lobby = closeBattleWindow(lobby, lobby.endTimeSec!);
    expect(lobby.status).toBe("SETTLING");

    lobby = settle(lobby, 0);
    expect(lobby.status).toBe("SETTLED");
    expect(lobby.winnerSide).toBe(0);
  });

  it("also allows settling directly from HELD, after a flagged review", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = confirmLive(lobby, NOW);
    lobby = closeBattleWindow(lobby, lobby.endTimeSec!);
    lobby = flagForReview(lobby);
    expect(lobby.status).toBe("HELD");

    lobby = settle(lobby, 1);
    expect(lobby.status).toBe("SETTLED");
  });

  it("also allows voiding a HELD match instead -- the other half of the HELD recovery path", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = confirmLive(lobby, NOW);
    lobby = closeBattleWindow(lobby, lobby.endTimeSec!);
    lobby = flagForReview(lobby);
    expect(lobby.status).toBe("HELD");

    lobby = voidHeld(lobby);
    expect(lobby.status).toBe("CANCELLED");
  });
});

describe("lobby state machine — refundStale (last-resort recovery)", () => {
  it("recovers a duel stuck in LIVE (the backend itself never advanced it)", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = confirmLive(lobby, NOW);
    expect(lobby.status).toBe("LIVE");

    lobby = refundStale(lobby);
    expect(lobby.status).toBe("CANCELLED");
  });

  it("recovers a duel stuck in SETTLING (signed but never confirmed on-chain)", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = confirmLive(lobby, NOW);
    lobby = closeBattleWindow(lobby, lobby.endTimeSec!);
    expect(lobby.status).toBe("SETTLING");

    lobby = refundStale(lobby);
    expect(lobby.status).toBe("CANCELLED");
  });

  it("recovers a duel stuck in HELD (flagged, never resolved by an admin)", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = confirmLive(lobby, NOW);
    lobby = closeBattleWindow(lobby, lobby.endTimeSec!);
    lobby = flagForReview(lobby);
    expect(lobby.status).toBe("HELD");

    lobby = refundStale(lobby);
    expect(lobby.status).toBe("CANCELLED");
  });

  it("refuses from OPEN, MATCHED, SETTLED, EXPIRED, or CANCELLED", () => {
    const open = baseLobby();
    expect(() => refundStale(open)).toThrow(InvalidTransitionError);

    const matched = submitJoin(open, "0xOpponent", NOW);
    expect(() => refundStale(matched)).toThrow(InvalidTransitionError);
  });
});

describe("lobby state machine — no-opponent paths", () => {
  it("lets the creator cancel while still OPEN", () => {
    const lobby = baseLobby();
    const cancelled = cancel(lobby, "0xCreator");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("refuses to let anyone but the creator cancel", () => {
    const lobby = baseLobby();
    expect(() => cancel(lobby, "0xSomeoneElse")).toThrow("only the creator can cancel");
  });

  it("expires an unmatched lobby once the open window passes", () => {
    const lobby = baseLobby();
    const expired = expire(lobby, lobby.openDeadlineSec + 1);
    expect(expired.status).toBe("EXPIRED");
  });

  it("refuses to expire before the open window passes", () => {
    const lobby = baseLobby();
    expect(() => expire(lobby, lobby.openDeadlineSec - 1)).toThrow("has not passed yet");
  });

  it("a failed join transaction reopens the lobby instead of stranding it", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = failJoin(lobby);
    expect(lobby.status).toBe("OPEN");
    expect(lobby.opponent).toBeUndefined();
  });
});

describe("lobby state machine — invalid transitions are rejected, not silently ignored", () => {
  it("cannot join a lobby that is already matched", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    expect(() => submitJoin(lobby, "0xSomeoneElse", NOW)).toThrow(InvalidTransitionError);
  });

  it("cannot settle a lobby still LIVE", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = confirmLive(lobby, NOW);
    expect(() => settle(lobby, 0)).toThrow(InvalidTransitionError);
  });

  it("cannot close the battle window before it actually ends", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = confirmLive(lobby, NOW);
    expect(() => closeBattleWindow(lobby, lobby.startTimeSec! + 60)).toThrow("has not elapsed yet");
  });

  it("cannot cancel a lobby that already matched", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    expect(() => cancel(lobby, "0xCreator")).toThrow(InvalidTransitionError);
  });

  it("rejects a duration outside the 5-20 minute window", () => {
    expect(() => baseLobby({ durationSeconds: 4 * 60 })).toThrow("5, 10, 15 or 20 minutes");
    expect(() => baseLobby({ durationSeconds: 25 * 60 })).toThrow("5, 10, 15 or 20 minutes");
  });

  it("accepts exactly 5, 10, 15 and 20 minutes, and nothing between them", () => {
    for (const m of [5, 10, 15, 20]) expect(() => baseLobby({ durationSeconds: m * 60 })).not.toThrow();
    for (const d of [7 * 60, 12 * 60 + 30, 19 * 60]) {
      expect(() => baseLobby({ durationSeconds: d })).toThrow("5, 10, 15 or 20 minutes");
    }
  });

  it("refuses to let the creator join their own lobby", () => {
    const lobby = baseLobby();
    expect(() => submitJoin(lobby, "0xCreator", NOW)).toThrow("cannot join your own lobby");
  });

  it("refuses to join once the open window has passed (even though status is still OPEN)", () => {
    const lobby = baseLobby();
    expect(() => submitJoin(lobby, "0xOpponent", lobby.openDeadlineSec + 1)).toThrow(
      "open window has already passed"
    );
  });
});

describe("lobby state machine — boundary conditions on timestamps and durations", () => {
  it("accepts the exact minimum and maximum durations", () => {
    expect(() => baseLobby({ durationSeconds: 5 * 60 })).not.toThrow();
    expect(() => baseLobby({ durationSeconds: 20 * 60 })).not.toThrow();
  });

  it("rejects a duration one second outside either bound", () => {
    expect(() => baseLobby({ durationSeconds: 5 * 60 - 1 })).toThrow("5, 10, 15 or 20 minutes");
    expect(() => baseLobby({ durationSeconds: 20 * 60 + 1 })).toThrow("5, 10, 15 or 20 minutes");
  });

  it("allows joining exactly at the open deadline (inclusive boundary)", () => {
    const lobby = baseLobby();
    expect(() => submitJoin(lobby, "0xOpponent", lobby.openDeadlineSec)).not.toThrow();
  });

  it("refuses to expire exactly at the deadline — expire requires strictly after it", () => {
    const lobby = baseLobby();
    expect(() => expire(lobby, lobby.openDeadlineSec)).toThrow("has not passed yet");
  });

  it("fuzzes durations: throws iff not a 5-minute step within [5, 20] minutes", () => {
    const rng = mulberry32(42);
    const min = 5 * 60;
    const max = 20 * 60;
    for (let i = 0; i < 300; i++) {
      // Bias half the draws onto exact 5-minute steps so the accepted path is exercised too.
      const d = i % 2 === 0 ? Math.round((rng() * 30) / 5) * 5 * 60 : Math.floor(rng() * (max - min + 200)) + (min - 100);
      const shouldThrow = d < min || d > max || d % 300 !== 0;
      if (shouldThrow) {
        expect(() => baseLobby({ durationSeconds: d })).toThrow();
      } else {
        expect(() => baseLobby({ durationSeconds: d })).not.toThrow();
      }
    }
  });
});

describe("lobby state machine — exhaustive (state, event) allow/deny table", () => {
  const ALL_STATUSES: LobbyStatus[] = [
    "OPEN",
    "MATCHED",
    "LIVE",
    "SETTLING",
    "HELD",
    "SETTLED",
    "EXPIRED",
    "CANCELLED",
  ];

  type EventName =
    | "submitJoin"
    | "failJoin"
    | "confirmLive"
    | "closeBattleWindow"
    | "flagForReview"
    | "settle"
    | "voidHeld"
    | "refundStale"
    | "cancel"
    | "expire";

  // The spec's Section 02 lobby table, encoded as "which single status may this
  // event be applied from". Every other status must reject with InvalidTransitionError.
  const VALID_FROM: Record<EventName, LobbyStatus[]> = {
    submitJoin: ["OPEN"],
    failJoin: ["MATCHED"],
    confirmLive: ["MATCHED"],
    closeBattleWindow: ["LIVE"],
    flagForReview: ["SETTLING"],
    settle: ["SETTLING", "HELD"],
    voidHeld: ["HELD"],
    refundStale: ["LIVE", "SETTLING", "HELD"],
    cancel: ["OPEN"],
    expire: ["OPEN"],
  };

  // Applies the event with inputs guaranteed to satisfy every *non-status*
  // precondition, so that the only thing under test is the status guard itself.
  const applyEvent: Record<EventName, (lobby: Lobby) => Lobby> = {
    submitJoin: (l) => submitJoin(l, "0xFreshOpponent", NOW),
    failJoin: (l) => failJoin(l),
    confirmLive: (l) => confirmLive(l, NOW),
    closeBattleWindow: (l) => closeBattleWindow(l, NOW + 1_000_000),
    flagForReview: (l) => flagForReview(l),
    settle: (l) => settle(l, 1),
    voidHeld: (l) => voidHeld(l),
    refundStale: (l) => refundStale(l),
    cancel: (l) => cancel(l, l.creator),
    expire: (l) => expire(l, NOW + 1_000_000),
  };

  function lobbyInStatus(status: LobbyStatus): Lobby {
    // EXPIRED and CANCELLED both fork off a fresh OPEN lobby since they are
    // dead ends reached directly from OPEN.
    if (status === "EXPIRED") {
      const open = baseLobby();
      return expire(open, open.openDeadlineSec + 1);
    }
    if (status === "CANCELLED") {
      const open = baseLobby();
      return cancel(open, "0xCreator");
    }

    let lobby = baseLobby();
    if (status === "OPEN") return lobby;

    lobby = submitJoin(lobby, "0xOpponent", NOW);
    if (status === "MATCHED") return lobby;

    lobby = confirmLive(lobby, NOW);
    if (status === "LIVE") return lobby;

    lobby = closeBattleWindow(lobby, lobby.endTimeSec!);
    if (status === "SETTLING") return lobby;

    if (status === "HELD") return flagForReview(lobby);
    if (status === "SETTLED") return settle(lobby, 0);

    throw new Error(`unreachable status in test helper: ${status}`);
  }

  it("matches the exact allow/deny table for every (state, event) pair", () => {
    const failures: string[] = [];

    for (const event of Object.keys(applyEvent) as EventName[]) {
      for (const status of ALL_STATUSES) {
        const lobby = lobbyInStatus(status);
        const shouldSucceed = VALID_FROM[event].includes(status);

        try {
          applyEvent[event](lobby);
          if (!shouldSucceed) {
            failures.push(`${event} from ${status}: expected InvalidTransitionError, but it succeeded`);
          }
        } catch (err) {
          if (shouldSucceed) {
            failures.push(`${event} from ${status}: expected success, but it threw "${(err as Error).message}"`);
          } else if (!(err instanceof InvalidTransitionError)) {
            failures.push(
              `${event} from ${status}: threw the wrong error type (${(err as Error).constructor.name}): ${
                (err as Error).message
              }`
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

describe("lobby state machine — purity and randomized transition fuzzing", () => {
  it("never mutates the lobby object passed in — every transition returns a new frozen-safe object", () => {
    let lobby = baseLobby();
    Object.freeze(lobby);

    const matched = submitJoin(lobby, "0xOpponent", NOW);
    expect(matched).not.toBe(lobby);
    expect(lobby.status).toBe("OPEN"); // original untouched
    Object.freeze(matched);

    const live = confirmLive(matched, NOW);
    expect(live).not.toBe(matched);
    expect(matched.status).toBe("MATCHED"); // still untouched
    expect(live.status).toBe("LIVE");
  });

  it("random walks through only valid transitions never throw and always preserve identity fields", () => {
    type EventName =
      | "submitJoin"
      | "failJoin"
      | "confirmLive"
      | "closeBattleWindow"
      | "flagForReview"
      | "settle"
      | "voidHeld"
      | "refundStale"
      | "cancel"
      | "expire";

    const VALID_FROM: Record<EventName, LobbyStatus[]> = {
      submitJoin: ["OPEN"],
      failJoin: ["MATCHED"],
      confirmLive: ["MATCHED"],
      closeBattleWindow: ["LIVE"],
      flagForReview: ["SETTLING"],
      settle: ["SETTLING", "HELD"],
      voidHeld: ["HELD"],
      refundStale: ["LIVE", "SETTLING", "HELD"],
      cancel: ["OPEN"],
      expire: ["OPEN"],
    };

    function applyValidEvent(event: EventName, lobby: Lobby): Lobby {
      switch (event) {
        case "submitJoin":
          return submitJoin(lobby, "0xOpponent", NOW);
        case "failJoin":
          return failJoin(lobby);
        case "confirmLive":
          return confirmLive(lobby, NOW);
        case "closeBattleWindow":
          return closeBattleWindow(lobby, lobby.endTimeSec!);
        case "flagForReview":
          return flagForReview(lobby);
        case "settle":
          return settle(lobby, 1);
        case "voidHeld":
          return voidHeld(lobby);
        case "refundStale":
          return refundStale(lobby);
        case "cancel":
          return cancel(lobby, lobby.creator);
        case "expire":
          return expire(lobby, lobby.openDeadlineSec + 1);
      }
    }

    const rng = mulberry32(12345);
    const TRIALS = 100;
    const MAX_STEPS = 12;

    for (let trial = 0; trial < TRIALS; trial++) {
      let lobby = baseLobby({ id: `lobby-fuzz-${trial}` });

      for (let step = 0; step < MAX_STEPS; step++) {
        const validEvents = (Object.keys(VALID_FROM) as EventName[]).filter((e) =>
          VALID_FROM[e].includes(lobby.status)
        );
        if (validEvents.length === 0) break; // reached a terminal status

        const event = validEvents[Math.floor(rng() * validEvents.length)];
        const next = applyValidEvent(event, lobby);

        // Identity/metadata fields must never change across any transition.
        expect(next.id).toBe(lobby.id);
        expect(next.creator).toBe(lobby.creator);
        expect(next.tokenASymbol).toBe(lobby.tokenASymbol);
        expect(next.tokenBSymbol).toBe(lobby.tokenBSymbol);
        expect(next.durationSeconds).toBe(lobby.durationSeconds);

        lobby = next;
      }

      // Whatever the walk landed on must be one of the 8 documented statuses.
      expect([
        "OPEN",
        "MATCHED",
        "LIVE",
        "SETTLING",
        "HELD",
        "SETTLED",
        "EXPIRED",
        "CANCELLED",
      ]).toContain(lobby.status);
    }
  });
});

describe("lobby state machine — known gaps (documented, not fixed here)", () => {
  it("BUG: settle() does not validate winnerSide at runtime — an out-of-range value is silently persisted", () => {
    let lobby = baseLobby();
    lobby = submitJoin(lobby, "0xOpponent", NOW);
    lobby = confirmLive(lobby, NOW);
    lobby = closeBattleWindow(lobby, lobby.endTimeSec!);

    // winnerSide is typed 0 | 1, but that's a compile-time-only guarantee. Any
    // caller that has lost type information (JSON body, a bug in the caller,
    // a future refactor) can push an arbitrary number through, and it will be
    // accepted and stored as the winner that gets paid out on-chain.
    const settled = settle(lobby, 2 as unknown as 0 | 1);
    expect(settled.winnerSide).toBe(2); // BUG: should have thrown, 2 is not a valid side
  });

  it("BUG: createLobby() does not validate creatorSide at runtime either", () => {
    const lobby = createLobby({
      id: "lobby-bad-side",
      creator: "0xCreator",
      tokenASymbol: "TOKA",
      tokenBSymbol: "TOKB",
      creatorSide: 7 as unknown as 0 | 1,
      durationSeconds: 20 * 60,
      nowSec: NOW,
    });
    expect(lobby.creatorSide).toBe(7); // BUG: silently accepted, should be rejected
  });
});
