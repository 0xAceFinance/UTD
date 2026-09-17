# UTD / MCAP DUEL — Backend

This document covers the server-side half of the app: the Next.js API routes,
the MongoDB schema, and how they wire together the four workspace packages
(`@mcapduel/engine`, `@mcapduel/matchmaking`, `@mcapduel/points`,
`@mcapduel/risk`) and the on-chain contracts in `Contracts/`. The frontend
(`app/(app)/**`, `app/landing/**`, `components/`, `hooks/`) is out of scope
here.

## Overview

This is a gambling game, not a launchpad: players pit two of the day's "Top
10" already-trading tokens (discovered from the open market, not launched by
this app — a previous bonding-curve token-launch mechanic, `TokenFactory`/
`PumpPool`, has been removed as out of scope) against each other in a
time-boxed **duel**: both sides buy in with a fixed stake, no selling during
the duel,
and whichever token's oracle-validated market cap grows more wins. Funds sit
in an on-chain escrow (`BattleEscrow`) for the duration; the backend never
custodies money — it discovers eligible tokens, runs the price-integrity
pipeline that decides the winner, enforces anti-abuse rules, and verifies
every on-chain transaction the frontend claims happened before trusting it.

## Tech stack

- **Next.js 15 App Router API routes** (`app/api/**/route.ts`) — the entire
  server surface; no separate backend process.
- **MongoDB via Mongoose** (`lib/mongoose.ts::connectToDatabase()`, cached
  across hot reloads/lambda invocations) — the system of record for lobbies,
  scan results, points, and abuse signals. (`lib/mongodb.ts`, a second, raw
  `MongoClient` singleton, was dead code and has been removed — every route
  uses `lib/mongoose.ts`.)
- **viem** — reads/verifies on-chain state: decoding event logs from
  transaction receipts (`lib/chainVerify.ts`) and signing oracle settlements
  (`lib/oracleSigner.ts`). `ethers` was previously used only by the
  now-removed `tokens/create` route (token-launch indexing) and is an unused
  dependency as of this pass (flagged, not pruned from `package.json`).
- **Four workspace packages**, imported like any npm dependency
  (`file:../engine` etc. in `package.json`) but kept as pure, DB/network-free
  logic — every side effect happens in `backend/lib/*.ts` adapters:
  - `@mcapduel/engine` — Phase 1: token discovery gates/scoring + the Phase
    04 oracle integrity pipeline.
  - `@mcapduel/matchmaking` — Phase 2: the lobby state machine + cancellation
    rate limit.
  - `@mcapduel/points` — Phase 3: points formulas + opponent-diversity
    anti-farm gate.
  - `@mcapduel/risk` — Phase 4: wallet-clustering sybil detection, geofence,
    oracle circuit breaker.

## Request lifecycle traces

### 1. Creating a duel

1. Frontend calls `GET /api/duels/precheck?wallet=0x...` (optional fast-fail)
   → `lib/duelGuards.ts::checkCanCreateLobby()` checks, in order: the oracle
   circuit breaker (`risk`'s `shouldPauseNewLobbies()` over the last 10
   `OracleHealthSample` rows), the geofence (`risk`'s `isAllowedJurisdiction()`
   against `lib/riskConfig.ts::BLOCKED_COUNTRY_CODES` and the request's
   `x-vercel-ip-country`), and the cancellation rate limit (`matchmaking`'s
   `canCreateLobby()` over the wallet's `CANCELLED` duels).
2. Frontend has the wallet sign and submit `createDuel()` on
   `BattleEscrowFactory` (`lib/duelContract.ts::createDuelOnChain()` —
   approves the stake token, then calls the factory, then waits for the
   receipt), collects the resulting `txHash`.
3. Frontend calls `POST /api/duels` with `{ creatorWallet, tokenASymbol,
   tokenBSymbol, txHash }`.
4. The route re-runs `checkCanCreateLobby()` for real (the precheck is a
   convenience, not the security boundary), loads both `DuelToken` documents
   (must be in today's Top 10), then calls
   `lib/chainVerify.ts::verifyDuelCreated(txHash, creatorWallet)` — decodes
   the real `DuelCreated` event from the real receipt (never trusts the
   client's claim of buy-in/side/duration) to get `escrowAddress` and the
   on-chain terms.
5. `matchmaking`'s `createLobby()` validates duration bounds and computes
   `openDeadlineSec`; the route persists a new `Duel` document (`status:
   "OPEN"`) with both `TokenSide`s seeded from the `DuelToken` snapshot.
6. The creator's wallet + request IP is recorded in `WalletSighting` (the
   real signal `risk`'s wallet-clustering check uses at settlement).

### 2. Joining a duel

1. Frontend has the opponent's wallet sign `joinDuel()` on the factory
   (`lib/duelContract.ts::joinDuelOnChain()`), gets a `txHash`.
2. `POST /api/duels/[id]/join` with `{ opponentWallet, txHash }`: re-checks
   the geofence, then (for an on-chain duel) calls
   `chainVerify.ts::verifyDuelJoined()` to confirm the real `DuelJoined`
   event for this escrow and wallet.
3. `matchmaking`'s `submitJoin()` then `confirmLive()` are applied back-to-back
   via `lib/lobbyAdapter.ts` (`toLobbySnapshot()`/`applyLobby()`) — the
   on-chain join is already confirmed by this point, so `MATCHED` collapses
   straight into `LIVE`, setting `startTime`/`endTime`.
4. Both `TokenSide`s are re-snapshotted with a **fresh** live multi-pool read
   (`lib/dexScreenerSource.ts::getLivePoolSamples()`) so `startMarketCapUsd`,
   `startLiquidityUsd`, and the first `rawSamples` entry reflect the real
   moment the clock starts, not the scan-time snapshot from creation.
5. The opponent's wallet + IP is recorded in `WalletSighting`.

### 3. Living / polling a duel

- `GET /api/duels/[id]` is polled by the frontend every ~3s. Each call:
  - If `OPEN` and past `openDeadline` (off-chain-only duel): self-heals to
    `EXPIRED` via `matchmaking`'s `expire()`.
  - If `LIVE`: calls `lib/duelEngine.ts::simulateTick()`, which for each side
    fetches a fresh live pool sample at most every 15s
    (`MIN_SAMPLE_INTERVAL_SEC`), appends it to `rawSamples` (capped at 4000
    via `MAX_SAMPLES_PER_SIDE`), and re-runs `engine`'s full
    `runOraclePipeline()` over the accumulated samples to refresh
    `currentMarketCapUsd` (latest raw read, for the animated bar) and
    `sustainedPeakMarketCapUsd` (the oracle-validated peak — monotonically
    increasing, this is what decides the winner). Then calls
    `maybeSettle()` (see below).

### 4. Settling a duel

1. `lib/duelEngine.ts::maybeSettle()` fires once `Date.now() >=
   duel.endTime`: takes one final live sample per side, computes the winner
   from whichever side's `sustainedPeakMarketCapUsd` grew more relative to
   its `startMarketCapUsd`, and calls `matchmaking`'s `closeBattleWindow()`.
2. **Sybil check first, always** (`isSybilMatch()` — builds a
   `WalletClusterGraph` from `WalletSighting` rows shared between the two
   wallets by IP, then `risk`'s `isSuspectedSybilMatch()`). A hit calls
   `flagForReview()` → `status: "HELD"`, `flaggedSybil: true`, and stops —
   deliberately *before* any oracle signature is produced, since once signed,
   `BattleEscrow.settle()` is permissionless and a flag afterward can't stop
   the payout.
3. **On-chain duel** (`escrowAddress` set): signs the result
   (`lib/oracleSigner.ts::signSettlement()` — the same
   `keccak256(abi.encodePacked(duel, winnerSide))` + EIP-191 scheme
   `BattleEscrow.settle()` verifies) and moves to `status: "SETTLING"`,
   storing `oracleSignature`. Points/`CombatRecord` updates wait.
4. Frontend (anyone, permissionlessly) submits `settle()` on the escrow with
   that signature (`lib/duelContract.ts::settleDuelOnChain()`), then calls
   `POST /api/duels/[id]/confirm-settlement` with the `txHash`. That route
   calls `chainVerify.ts::verifyDuelSettled()` to decode the real `Settled`
   event's `winnerSide` (re-derived, never trusted from the client), applies
   `matchmaking`'s `settle()`, and calls `finalizeSettlement()`.
5. **Legacy off-chain duel** (no `escrowAddress`, predates on-chain
   integration): `maybeSettle()` calls `settle()` and `finalizeSettlement()`
   immediately, no separate confirmation step.
6. `finalizeSettlement()`: computes each side's return %, calls `points`'s
   `computeMatchPoints({ buyInUsd, winnerReturnPct, loserReturnPct })`,
   stores `winnerPoints`/`loserPoints` on the `Duel`, then updates both
   wallets' `CombatRecord` — `points`'s `isPointsEligible()` (opponent
   diversity, last 50 opponents) gates whether `totalPoints` actually
   increases; `wins`/`losses`/`currentStreak`/`recentOpponents` update either
   way.

## Oracle / risk / points / matchmaking pipeline

```
DexScreener (live pools)
        │  lib/dexScreenerSource.ts
        ▼
engine: evaluateGates() + selectTopTen()   ── daily scan, POST /api/scan
        │  (Section 01 hard gates: mcap, liquidity, volume, traders,
        │   age, rug-check, LP-lock, holder concentration, blocklist)
        ▼
DuelToken (today's Top 10)  ──►  Duel created (2 tokens picked)
        │
        │  while LIVE, every poll:
        ▼
engine: runOraclePipeline()                ── lib/duelEngine.ts::refreshSide()
    1. liquidity-weighted median price across every real pool (median.ts)
    2. liquidity-depth gate vs. battle-start liquidity (liquidityGate.ts)
    3. 60s TWAP smoothing (twap.ts)
    4. sustained-peak dwell-time validation (sustainedPeak.ts)
    5. hash-chained tamper-evident sample log (sampleLog.ts)
        │
        ▼
sustainedPeakMarketCapUsd (monotonic) ──► winner decided at duel.endTime
        │
        ▼
risk: isSuspectedSybilMatch()   ── shared-IP wallet clustering, checked
        │                          before any oracle signature is produced
        ├── hit  → matchmaking: flagForReview() → HELD (human review, not built)
        └── miss → oracleSigner.signSettlement() → on-chain settle() → confirmed
                        │
                        ▼
                points: computeMatchPoints() + isPointsEligible()
                        │
                        ▼
                CombatRecord updated → leaderboard / profile
```

`risk`'s circuit breaker and geofence gate the *start* of this pipeline
(new-lobby creation, see `duelGuards.ts`), not anything already `LIVE`.

## Database schema

MongoDB via Mongoose, models in `lib/models/`. Registered with mongoose
directly (each file does `models.X || model<IX>(...)`); there is **no**
barrel/index file — every route imports the model it needs directly
(`lib/models/index.ts` was dead code, unused anywhere, and has been removed).

| Model | Key fields | Purpose |
|---|---|---|
| `Duel` (`Duel.ts`) | `status` (matchmaking's `LobbyStatus`), `creatorWallet`/`opponentWallet`, `creatorSide`, `tokenA`/`tokenB` (`TokenSide`: symbol, tokenAddress, totalSupply, startLiquidityUsd, rawSamples[], start/current/sustainedPeak market caps, oracleVerified), `buyInUsd`, `durationSeconds`, `openDeadline`, `startTime`/`endTime`, `winnerSide`, `winnerPoints`/`loserPoints`, `cancelledAt`, `flaggedSybil`, `escrowAddress`, `oracleSignature` | The lobby/battle record — off-chain mirror + orchestration state around the on-chain `BattleEscrow`. Central model of the whole duel flow. |
| `DuelToken` (`DuelToken.ts`) | `symbol` (unique), `name`, `rank`, `tokenAddress`, `totalSupply`, `marketCapUsd`, `liquidityUsd`, `volume24hUsd`, `change24hPct` | Today's Top 10 gladiators, replaced wholesale by every `POST /api/scan`. |
| `CombatRecord` (`CombatRecord.ts`) | `wallet` (unique), `totalPoints`, `redeemedPoints`, `wins`, `losses`, `currentStreak`, `recentOpponents[]` | Off-chain stand-in for `CombatRecordNFT.sol` (not deployed yet) — points/streak/leaderboard system of record. |
| `OracleHealthSample` (`OracleHealthSample.ts`) | `timestampSec`, `succeeded`, `detail?` | One row per scan attempt; feeds `risk`'s circuit breaker. |
| `WalletSighting` (`WalletSighting.ts`) | `wallet`, `ip`, `seenAt` | Every wallet recorded against the request IP it created/joined a duel from; the only wired-up edge (`shared_ip`) for `risk`'s wallet-clustering sybil check. |
| `User` (`User.ts`) | `username`, `email` (unique), `passwordHash`, `walletAddress` (unique), `chain`, `portfolio`, `stats` (tokensOwned, activeWars, warsWon, totalVolume, totalProfit) | Account record, currently only read by `/api/users`/`/api/users/[id]` (no confirmed frontend caller). `stats` field names (`activeWars`/`warsWon`) predate the duel-based rebuild. Not used anywhere in the duel flow, which is wallet-address-keyed throughout instead. |

**Removed as dead:** `Transaction.ts` and `UserHolding.ts` both referenced a
`ref: 'War'` — a model that doesn't exist anywhere in this codebase (the
matchmaking package's own README documents replacing the old `War` model
with `Duel` as part of a "fresh build" decision). Neither model was imported
by any route, script, or the other model files; both were pre-rebuild legacy
left behind. `lib/models/index.ts` (a barrel re-exporting every model) had
zero importers anywhere in the repo — every route already imports models
directly — and has also been removed.

**Removed as part of the launchpad mechanic being dropped:** `Token.ts`
(tokens launched through `TokenFactory`/`PumpPool` — separate from
`DuelToken`, which remains and is the *duel-eligible* daily ranking) and
`Pool.ts` (the bonding-curve pool paired 1:1 with a launched `Token`; had zero
importers even before this pass). This product is a duel/gambling game, not a
token launchpad, and the bonding-curve contracts (`Contracts/src/TokenFactory.sol`,
`PumpToken.sol`, `PumpPool.sol`) have been removed to match.

## API route reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/duels` | List duels, filterable by `status` and/or `wallet`. |
| POST | `/api/duels` | Create a duel from a confirmed `createDuel()` tx. |
| GET | `/api/duels/precheck` | Fast-fail check (circuit breaker/geofence/rate-limit) before spending gas. |
| GET | `/api/duels/[id]` | Fetch one duel; self-heals `OPEN→EXPIRED` and drives `LIVE` tick/settle-check. |
| POST | `/api/duels/[id]/join` | Join a duel from a confirmed `joinDuel()` tx; snapshots real start market caps. |
| POST | `/api/duels/[id]/cancel` | Cancel an `OPEN` duel (creator only), verifying `DuelCancelled` if on-chain. |
| POST | `/api/duels/[id]/expire` | Expire an unmatched `OPEN` duel past its window (permissionless), verifying `DuelExpired` if on-chain. |
| POST | `/api/duels/[id]/confirm-settlement` | Confirm a real `settle()` tx, decode `Settled`, award points/CombatRecord. |
| GET | `/api/duel-tokens` | Today's Top 10 duel-eligible tokens. |
| POST | `/api/scan` | Re-run the discovery scan (DexScreener → `engine` gates/scoring) and refresh the Top 10. |
| GET | `/api/combat-record/[wallet]` | One wallet's points/tier/streak/recent settled matches. |
| GET | `/api/leaderboard` | Top 50 wallets by `totalPoints`, with tier. |
| GET | `/api/users` | List users, or one by `?wallet=`. No caller found in the frontend. |
| GET | `/api/users/[id]` | One user by Mongo `_id`. No caller found in the frontend; its own comment says "no need to use this route for now." |

**Removed as dead scaffolding** (not listed above): `GET /api/test` (a
leftover template route hardcoded to `mongodb://127.0.0.1:27017`/db
`tugzone`, ignoring `MONGODB_URI` entirely, no caller anywhere) and
`/api/transactions` (`route.ts` was a literal empty file — zero exports, not
a working endpoint under Next.js's route convention — with no matching
frontend caller and no code anywhere using the also-now-removed `Transaction`
model).

**Removed as part of the launchpad mechanic being dropped:** `GET/POST
/api/tokens`, `POST /api/tokens/create`, and `GET /api/tokens/[symbol]` (all
served the bonding-curve token-launch flow, now out of scope — see the
Contracts and DB schema sections).
