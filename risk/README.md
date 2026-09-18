# MCAP DUEL — Risk & Compliance (Phase 4, code portion)

The parts of Phase 4 that are genuinely buildable and testable in isolation —
now wired into the live backend, not just standalone logic.

- `src/walletClustering.ts` — union-find over funding/device/IP links
  (`WalletClusterGraph`), flags a duel between two wallets in the same
  cluster as a suspected sybil match (`isSuspectedSybilMatch`, Section 05).
- `src/geofence.ts` — jurisdiction check (`isAllowedJurisdiction`).
  **Deliberately ships with no default blocklist** — which countries to
  exclude is a legal decision (Section 08), not a technical one, and
  inventing a list here would be guessing at legal advice.
- `src/circuitBreaker.ts` — `shouldPauseNewLobbies()` pauses new lobby
  creation on stale or failing oracle health data, fails safe (pauses) with
  zero data.

16 tests, `npm test`.

## How it's wired into the backend today

- **Wallet clustering.** `backend/lib/models/WalletSighting.ts` records every
  wallet against the request IP it created/joined a duel from
  (`backend/lib/requestSignals.ts::getClientIp`, called from
  `app/api/duels/route.ts` and `app/api/duels/[id]/join/route.ts`). At
  settlement, `backend/lib/duelEngine.ts::isSybilMatch()` builds a
  `WalletClusterGraph` from every `shared_ip` sighting for the two wallets in
  the match and calls `isSuspectedSybilMatch()` — a hit routes the match to
  `HELD` (matchmaking's `flagForReview()`) instead of settling, and only
  *before* the oracle signs a settlement (once signed, `BattleEscrow.settle()`
  is permissionless, so a flag after signing wouldn't stop the payout).
  `funded_by` is now wired up too (`FE/lib/fundingSource.ts` — a bounded
  `eth_getLogs` scan for a wallet's earliest inbound stake-token transfer,
  best-effort), catching a colluding pair that shares no network. `shared_device`
  still isn't — no device-fingerprinting data source exists yet.
- **Geofence.** `backend/lib/riskConfig.ts::BLOCKED_COUNTRY_CODES` is the
  (currently empty) real blocklist — the one line that changes once legal
  defines it. Checked in both `app/api/duels/route.ts` (create) and
  `app/api/duels/[id]/join/route.ts` (join) against
  `requestSignals.ts::getClientCountry()` (reads Vercel's
  `x-vercel-ip-country` header; absent off-Vercel, so the check no-ops in
  local dev rather than guessing).
- **Circuit breaker.** `backend/lib/models/OracleHealthSample.ts` records one
  row per `POST /api/scan` attempt (`backend/lib/duelTokenScan.ts`).
  `backend/lib/duelGuards.ts::checkCanCreateLobby()` — shared by
  `POST /api/duels` and `GET /api/duels/precheck` — reads the last 10 samples
  and calls `shouldPauseNewLobbies()` against
  `riskConfig.ts::ORACLE_CIRCUIT_BREAKER_CONFIG` before allowing a new lobby.
  Matches already `LIVE` are never affected, only new ones are gated.

## What Phase 4 also includes that isn't code

These need a vendor, an external firm, or a business decision — not something
buildable in this repo on its own:

- **KYC/AML provider integration.** Needs a chosen vendor (Section 11 open
  decision) and their SDK/API before there's anything real to integrate against.
- **Two independent smart contract audits + a public bug bounty.** Needs to be
  commissioned from outside firms once the contracts are feature-complete.
- **Dispute/HELD review process.** The actual human judgment call (was this
  really collusion?) still needs a person, and there's no admin UI for it yet
  — but the routes exist: `app/api/admin/duels/[id]/resolve` (confirm the
  oracle-computed winner if the flag was a false positive, or sign a
  `voidActive()` refund if not) and `confirm-void` (verifies the refund
  actually landed on-chain before closing it out in the DB). Gated by a
  shared-secret header (`FE/lib/adminAuth.ts`), not real admin auth. There's
  also a fully separate, signature-free fallback now:
  `BattleEscrow.refundStale()` lets anyone refund both stakes once a duel has
  sat unsettled 24h past its end time, covering the case where the oracle key
  itself is unusable (lost, or the winner's address is blacklisted by the
  stake token) and no signature-based path can ever resolve it.
