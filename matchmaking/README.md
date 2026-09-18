# MCAP DUEL — Matchmaking (Phase 2)

Pure lobby state machine + cancellation rate limit, now wired end-to-end into
the real backend. See `../Contracts/src/duel/` for the on-chain half
(BattleEscrow) and `../engine/` for Phase 1.

## What's real and tested

- `src/stateMachine.ts` — every transition from Section 02's lobby table
  (`createLobby`, `submitJoin`, `failJoin`, `confirmLive`, `closeBattleWindow`,
  `flagForReview`, `settle`, `voidHeld`, `refundStale`, `cancel`, `expire`),
  each validating its own preconditions and throwing `InvalidTransitionError`
  otherwise (29 tests, `npm test`).
  - `voidHeld`: the other half of the `HELD` recovery path — an admin decided
    a flagged match should refund instead of settle (see `../risk/README.md`).
  - `refundStale`: the last-resort, signature-free recovery path for a duel
    stuck in `LIVE`/`SETTLING`/`HELD` well past its end time (mirrors
    `BattleEscrow.refundStale()` on-chain).
- `src/cancellationLimiter.ts` — the 5-per-hour / 15-minute-cooldown rule
  (`canCreateLobby`), as a pure function over a list of past cancellation
  timestamps.

## How it's wired into the backend today

This package still knows nothing about MongoDB, viem, or Next.js by design —
it stays pure logic with no I/O — but every transition it exposes is now
driven by real backend code:

- **Persistence.** `backend/lib/models/Duel.ts` is the Mongoose model
  (`LobbyStatus` from this package is reused directly as the schema's
  `status` enum). `backend/lib/lobbyAdapter.ts` is the only place that
  translates between a `Duel` Mongoose document and this package's plain
  `Lobby` object (epoch-second timestamps, immutable updates) — every route
  goes through `toLobbySnapshot()` / `applyLobby()` rather than re-implementing
  the rules against the document directly.
- **BattleEscrow.** `backend/lib/duelContract.ts` (frontend-called, wagmi)
  submits the real `createDuel`/`joinDuel`/`cancelDuel`/`expireDuel`/`settle`
  transactions; `backend/lib/chainVerify.ts` decodes the real
  `DuelCreated`/`DuelJoined`/`DuelCancelled`/`DuelExpired`/`Settled` events
  from the confirmed receipt before any backend route trusts what happened.
  No event listener/indexer exists — verification is pull-based, triggered by
  the frontend handing the tx hash to the matching route right after its own
  wallet-signed call confirms.
- **API routes**, all under `backend/app/api/duels/`:
  - `POST /api/duels` → `createLobby()` (only to validate duration bounds and
    compute `openDeadlineSec` consistently) after verifying the on-chain
    `DuelCreated` event.
  - `POST /api/duels/[id]/join` → `submitJoin()` then `confirmLive()`
    (collapsed into one call since the on-chain join is already confirmed by
    the time this route runs).
  - `GET /api/duels/[id]` → self-heals an `OPEN` lobby past its deadline via
    `expire()` (off-chain-only duels) and drives a `LIVE` duel's settlement
    check on every poll.
  - `POST /api/duels/[id]/cancel`, `POST /api/duels/[id]/expire` →
    `cancel()` / `expire()`, both re-verifying the matching on-chain event
    first when the duel has a real `escrowAddress`.
  - `backend/lib/duelEngine.ts` → `closeBattleWindow()`, `flagForReview()`
    (Section 05/06 sybil hold, see `../risk/`), and `settle()`.
  - `backend/lib/duelGuards.ts` → `canCreateLobby()` (the cancellation rate
    limit) plus the risk package's circuit breaker and geofence, shared by
    `POST /api/duels` and the fast-fail `GET /api/duels/precheck`.

## What's still not built

- **`failJoin()`** has no caller yet. The current flow only calls `submitJoin`
  once the on-chain join transaction is already confirmed, so there's no
  "join tx reverted, reopen the lobby" path wired up today — `failJoin` exists
  and is tested, waiting for that path if/when the frontend submits before
  confirming.
- **No on-chain event listener.** Every state change is driven by the
  frontend calling a backend route right after its own transaction confirms,
  not by a background indexer watching `BattleEscrow` events directly. Fine
  for a single frontend client; would need revisiting for a multi-client or
  fully permissionless settlement flow.
