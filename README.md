# UTD — Underground Token Duel

**UTD** (internal codename **MCAP DUEL**) is a real-money PvP betting game built on
live, already-trading crypto tokens. Two players each lock the same stablecoin stake,
pick opposing sides of two tokens pulled from the day's market-discovered "Top 10,"
and duel for a fixed 5/10/15 or 20-minute window: **buy-only, no selling**, whichever
side's oracle-validated market cap grows further wins. The pot settles from an
on-chain escrow the instant an off-chain oracle attests the result; wins accrue
soulbound "Combat Record" points and, for anyone with a referral link, atomic
on-chain commissions.

This is not a token launchpad. Every duelled token already trades in the open
market — UTD discovers and ranks them, it never mints, sells, or bonds one itself. A
prior bonding-curve launch mechanic (`TokenFactory`/`PumpToken`/`PumpPool`) existed
early in this repo's history and has been fully removed; nothing described below
depends on it.

## Contents

- [Live deployment](#live-deployment)
- [Repository layout](#repository-layout)
- [Architecture](#architecture)
- [Duel lifecycle, end to end](#duel-lifecycle-end-to-end)
- [Backend logic packages](#backend-logic-packages)
- [Data model](#data-model)
- [API reference](#api-reference)
- [Frontend](#frontend)
- [Points, tiers and rewards](#points-tiers-and-rewards)
- [Referrals](#referrals)
- [Background jobs](#background-jobs)
- [Security model](#security-model)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Related documentation](#related-documentation)
- [Known gaps / open items](#known-gaps--open-items)

## Live deployment

Robinhood Chain mainnet, chain id `4663`. Full deployment history, superseded
contracts, and verification details: [`Contracts/README.md`](Contracts/README.md).

| Contract | Address |
|---|---|
| `BattleEscrowFactory` | [`0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E`](https://robinhoodchain.blockscout.com/address/0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E) |
| `BattleEscrow` (implementation) | [`0x3028ea8aDA73b722bB271797b0Ca87FC28427a62`](https://robinhoodchain.blockscout.com/address/0x3028ea8aDA73b722bB271797b0Ca87FC28427a62) |
| Stake token (USDG "Global Dollar", 6 decimals) | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |

Duels run exactly 5, 10, 15 or 20 minutes; an unmatched lobby stays open 5 minutes;
minimum buy-in is 1 USDG. Verified on-chain (`oracleSigner`, `platformTreasury`,
`approvedStakeToken`, `minBuyIn`, `winnerBps=9000`, `maxReferrerBps=500`, `owner`, `paused=false`)
and source-verified on Sourcify (`exact_match`, creation + runtime) as of 2026-09-22 — see
[`Contracts/README.md`](Contracts/README.md#deployments) for the full record, including why the
previous deployment was superseded (a real payout-repricing vulnerability, not routine tuning) and
an unresolved duel stuck on it that still needs attention. The rewards layer (`CombatRecordNFT`,
`RedemptionVault`) is **deliberately not deployed** — points and tiers are DB-only for now, see
[Known gaps](#known-gaps--open-items).

Public env for this deployment:

```
NEXT_PUBLIC_CHAIN_ID=4663
NEXT_PUBLIC_RPC_URL=https://rpc.mainnet.chain.robinhood.com
NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS=0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E
NEXT_PUBLIC_STAKE_TOKEN_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
```

## Repository layout

```
UTD/
├── README.md            you are here — product + architecture overview
├── Points.md             points/tiers ledgers, formulas, every awarding event
├── Referral.md           referral economics, on-chain mechanics, backend pipeline
├── Deployment.md         deploying contracts + FE/backend + crons, end to end
├── Contracts/            Foundry/Solidity — duel escrow + rewards layer
│   ├── src/duel/          BattleEscrow, BattleEscrowFactory
│   ├── src/rewards/       CombatRecordNFT, RedemptionVault (undeployed)
│   ├── script/            DeployDuel.s.sol, DeployRewards.s.sol
│   ├── test/              Foundry test suite (happy-path + adversarial)
│   └── README.md          contract-level reference (functions, trust model, deploy usage)
└── FE/                   Next.js 15 app — UI + API routes + DB models, single deploy unit
    ├── app/(app)/          the logged-in app shell (dashboard, duels, tokens, profile, referrals, airdrop)
    ├── app/landing/        public marketing/whitelist landing page
    ├── app/api/            every server route (duels, referrals, points, admin, cron, whitelist, airdrop)
    ├── lib/                DB models + all server-side logic (contracts, oracle signing, risk, referrals)
    ├── packages/           four pure, DB/network-free workspace packages (see below)
    └── components/, hooks/, config/   UI primitives, wallet hooks, chain/env config
```

## Architecture

```
                     ┌──────────────────────────┐
  Browser  ────────► │ Next.js 15 (FE/)          │
  (wallet:            │  app/(app)/**, landing/** │
   wagmi + viem +      │  app/api/**               │
   ConnectKit)         └───────┬───────────────────┘
                                │
                    fetch('/api/...')            wallet writes
                                │                 (createDuel/joinDuel/
                                ▼                  settle, direct to chain)
                     ┌───────────────────┐              │
                     │ MongoDB (Mongoose)│              ▼
                     │ Duel, DuelToken,   │   ┌─────────────────────────┐
                     │ CombatRecord,      │   │ BattleEscrowFactory      │
                     │ ReferralAccount,   │   │  └─ BattleEscrow clones  │
                     │ WhitelistEntry, …  │   │     (one per duel,       │
                     └────────┬──────────┘    │      holds only stakes) │
                              │                └────────────┬────────────┘
                              │  oracle signs result          │ settle() verifies
                              ▼  (lib/oracleSigner.ts)         │ an ECDSA signature
                     ┌───────────────────┐                    │ from oracleSigner
                     │ Cloud Scheduler    │◄───────────────────┘
                     │  /api/cron/settle   │  relayer submits settle()
                     │  /api/scan           │  (separate hot wallet, no authority)
                     └───────────────────┘
```

In production, the same Next.js app is deployed **twice** against two different
targets: pages on Vercel, the API surface on GCP Cloud Run (proxied transparently via
`next.config.mjs`'s `rewrites()`). Local dev runs both in one process. See
[`Deployment.md`](Deployment.md) for the full split and why it exists (Vercel's free
tier can't run the per-minute settlement cron).

The browser never talks to the contracts through the backend — wallet writes
(`createDuel`, `joinDuel`, `cancel`, `expire`, a manual `settle`) go straight from the
connected wallet to the chain (`lib/duelContract.ts`, built on `wagmi/actions`). The
backend's only on-chain role is producing the oracle signature that authorizes
`settle()`/`voidActive()`, and, via a keeper, relaying `settle()` itself so a payout
never depends on a player clicking a button in time.

## Duel lifecycle, end to end

1. **Discovery.** `POST /api/scan` runs `@mcapduel/engine`'s hard-gate scanner against
   live DexScreener pool data (market cap, liquidity, volume, unique traders, age,
   rug-check, LP-lock, holder concentration, blocklist) and writes today's `DuelToken`
   Top 10. Scheduled continuously (see [Background jobs](#background-jobs)); a stale
   or failing scan trips a circuit breaker that pauses new duel creation.
2. **Create.** The creator picks two Top-10 tokens and a side, then signs
   `BattleEscrowFactory.createDuel(...)` directly from their wallet. The factory
   clones the audited `BattleEscrow` implementation (EIP-1167 minimal proxy), pulls
   the creator's stake straight into the new clone, and opens a 5-minute matchmaking
   window. The frontend then calls `POST /api/duels` with the tx hash; the route
   **re-derives** every term from the real `DuelCreated` event
   (`lib/chainVerify.ts::verifyDuelCreated`) rather than trusting the client, records
   the wallet+IP (`WalletSighting`, feeds sybil detection later), and best-effort
   attributes any pending referral code (`lib/referralAttribution.ts`).
3. **Join.** The opponent isn't locked into the creator's proposed pair: the join UI
   shows the creator's token (fixed) plus the creator's proposed opposing token,
   pre-selected but swappable for any other token in today's Top 10. Accepting the
   default or picking a different one, the opponent signs `joinDuel()` (the on-chain
   call itself is unchanged — token choice is resolved off-chain only); `POST
   /api/duels/[id]/join` verifies the real `DuelJoined` event, validates and applies
   any token swap (`lib/resolveDuelToken.ts`, same Top-10/must-differ rules as
   creation), snapshots a fresh live market-cap read for both sides (the real starting
   line, not the scan-time snapshot), and flips the `Duel` document straight to
   `LIVE`. If the opponent swapped tokens, the original proposal is kept on
   `Duel.originalOpponentTokenSymbol` for support/audit — the on-chain `DuelCreated`
   event's symbols are immutable and will keep showing the creator's original
   proposal, which no on-chain logic (including `settle()`) ever reads again.
4. **Live.** While `LIVE`, the frontend polls `GET /api/duels/[id]` every ~3s. Each
   poll re-runs `@mcapduel/engine`'s oracle pipeline (liquidity-weighted median across
   pools → liquidity-depth gate → 60s TWAP → sustained-peak dwell validation →
   hash-chained sample log) to refresh both the live display number and the
   oracle-validated, monotonically-increasing `sustainedPeakMarketCapUsd` that
   settlement actually uses.
5. **Settle.** Once `endTime` passes, `maybeSettle()` computes the winner from each
   side's sustained peak, runs the wallet-clustering sybil check **before any
   signature is produced** (a hit routes the duel to `HELD` for admin review instead),
   then signs the result with the oracle key
   (`lib/oracleSigner.ts::signSettlement`, folding in each side's current referrer and
   commission tier — see [Referrals](#referrals)) and moves the duel to `SETTLING`.
   Anyone — typically the backend's relayer, but permissionlessly any address — submits
   `BattleEscrow.settle(...)` on-chain. The contract verifies the signature, pays the
   winner the factory's configured `winnerBps` (default 90%), pays each referred
   player's referrer their tier-rate cut of that player's own stake (win or lose, up
   to 5% each), and sends whatever's left to the platform treasury.
6. **Confirm & score.** `POST /api/duels/[id]/confirm-settlement` decodes the real
   `Settled` event, then `finalizeSettlement()` awards match points (gated by an
   opponent-diversity anti-farm rule), updates both wallets' win/loss/streak record,
   and credits any referral volume/earnings checkpoints.
7. **Recovery paths.** A lobby nobody joins self-expires after 5 minutes
   (`expire()`, permissionless); the creator can `cancel()` first. A `HELD` duel is
   resolved by an admin (`/api/admin/duels/[id]/resolve`) into either a normal
   settlement or a signed `voidActive()` refund. As a last resort, `refundStale()`
   lets anyone refund both stakes, no signature required, 24h after `endTime` if
   nothing else has resolved the duel — the hard backstop against a lost oracle key.

## Backend logic packages

Four pure, dependency-free workspace packages (`FE/packages/*`) — no DB, no network,
no Next.js — imported like ordinary npm dependencies and wired to the real world only
by adapters in `FE/lib/`:

| Package | Responsibility | Wired in via |
|---|---|---|
| `@mcapduel/engine` | Token discovery hard gates + scoring; the 5-stage oracle integrity pipeline (median → liquidity gate → TWAP → sustained-peak → tamper-evident sample log) | `lib/duelTokenScan.ts`, `lib/duelEngine.ts::refreshSide()` |
| `@mcapduel/matchmaking` | Pure lobby state machine (`OPEN → MATCHED/LIVE → SETTLING → SETTLED`, plus `HELD`/`EXPIRED`/`CANCELLED`) and the cancellation rate limiter | `lib/lobbyAdapter.ts` (the only place that translates a `Duel` Mongoose document into this package's plain `Lobby` object) |
| `@mcapduel/points` | Match-point formulas, opponent-diversity anti-farm gate, referral tier/checkpoint math | `lib/duelEngine.ts`, `lib/referralAccount.ts` — full detail in [`Points.md`](Points.md) / [`Referral.md`](Referral.md) |
| `@mcapduel/risk` | Wallet-clustering sybil detection, geofence, oracle-health circuit breaker | `lib/duelEngine.ts::isSybilMatch()`, `lib/duelGuards.ts::checkCanCreateLobby()` |

## Data model

MongoDB via Mongoose, models in `FE/lib/models/`. Every route imports the model it
needs directly — there is no barrel/index file.

| Model | Key fields | Purpose |
|---|---|---|
| `Duel` | `status` (matchmaking's `LobbyStatus`), `creatorWallet`/`opponentWallet`, `tokenA`/`tokenB` (`TokenSide`: symbol, address, live samples, start/current/sustained-peak market caps), `buyInUsd`, `durationSeconds`, `escrowAddress`, `oracleSignature`, `flaggedSybil`, `creatorReferrerWallet`/`creatorReferrerBps`, `opponentReferrerWallet`/`opponentReferrerBps`, `originalOpponentTokenSymbol` (set only if the opponent swapped the creator's proposed opposing token at join time) | The lobby/battle record — off-chain mirror + orchestration state around the on-chain escrow. Central model of the whole flow. |
| `DuelToken` | `symbol` (unique), `rank`, `tokenAddress`, `marketCapUsd`, `liquidityUsd`, `volume24hUsd`, `change24hPct` | Today's Top 10 duel-eligible tokens, replaced wholesale by every scan. |
| `CombatRecord` | `wallet` (unique), `totalPoints`, `redeemedPoints`, `wins`, `losses`, `currentStreak`, `recentOpponents[]` | Off-chain stand-in for `CombatRecordNFT.sol` (not deployed) — the points/tier/leaderboard system of record. |
| `ReferralAccount` | `wallet` (unique), `cumulativeSettledVolumeUsd`, `cumulativeReferralEarningsUsd`, `volumeCheckpointsHit[]`, `earningsCheckpointsHit[]` | A wallet's own lifetime volume (drives its tier as a referrer) and lifetime referral earnings. |
| `WhitelistEntry` | `identifier` (wallet or email), `walletVerified`, `referralCode`, `referredBy`, `referralSybilFlagged` | Originally pre-launch whitelist signups; extended (`lib/referralAttribution.ts`) to also serve as the live referral-link attribution source. |
| `OracleHealthSample` | `timestampSec`, `succeeded`, `detail?` | One row per scan attempt; feeds the discovery circuit breaker. |
| `WalletSighting` | `wallet`, `ip`, `seenAt` | Every wallet recorded against the request IP it created/joined a duel from — the sybil-clustering signal. |
| `AirdropClaim` | `wallet`, `taskId` (compound-unique) | One row per self-reported genesis-airdrop social task claim; a repeat claim is a no-op. |
| `User` | `username`, `email`, `walletAddress`, `stats` | Legacy account record; not used anywhere in the duel flow (which is wallet-address-keyed throughout) — kept for `GET /api/users(/[id])` with no confirmed frontend caller. |

## API reference

All routes live under `FE/app/api/`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/duels` | List duels, filterable by `status` and/or `wallet`. |
| POST | `/api/duels` | Create a duel from a confirmed `createDuel()` transaction. |
| GET | `/api/duels/precheck` | Fast-fail check (oracle circuit breaker, geofence, cancellation rate limit) before a wallet spends gas. |
| GET | `/api/duels/[id]` | Fetch one duel; self-heals `OPEN → EXPIRED`, drives the `LIVE` oracle tick and settle check. |
| POST | `/api/duels/[id]/join` | Join a duel from a confirmed `joinDuel()` transaction; snapshots real starting market caps. |
| POST | `/api/duels/[id]/cancel` | Cancel an `OPEN` duel (creator only). |
| POST | `/api/duels/[id]/expire` | Expire an unmatched `OPEN` duel past its window (permissionless). |
| POST | `/api/duels/[id]/refund-stale` | Confirm a permissionless `refundStale()` transaction once one lands. |
| POST | `/api/duels/[id]/confirm-settlement` | Confirm a real `settle()` transaction, decode `Settled`, award points and referral credit. |
| GET | `/api/duel-tokens` | Today's Top 10 duel-eligible tokens. |
| GET, POST | `/api/scan` | Re-run token discovery (DexScreener → engine gates/scoring) and refresh the Top 10; `POST ?loop=true` runs 4 passes 15s apart inside one invocation. |
| GET | `/api/combat-record/[wallet]` | One wallet's points, tier, streak, and recent settled matches. |
| GET | `/api/leaderboard` | Leaderboard ranked by `totalPoints`, with tier. |
| GET | `/api/referrals/[wallet]` | A wallet's referral dashboard: code, tier, cumulative volume/earnings, checkpoint progress. |
| GET | `/api/whitelist` | Pre-launch signup count (`claimed`/`total`). |
| POST | `/api/whitelist` | Submit a pre-launch wallet/email signup, generating a referral code. |
| GET | `/api/whitelist/nonce` | Issue a signing nonce for wallet-ownership verification. |
| GET | `/api/whitelist/me` | The caller's own whitelist entry (verification/referral status). |
| GET | `/api/airdrop` | Genesis airdrop task/points progress for a wallet (computed live, not stored). |
| POST | `/api/airdrop/claim` | Self-report completion of a claimable social task. |
| POST | `/api/admin/duels/[id]/resolve` | Admin-only: resolve a `HELD` (sybil-flagged) duel — confirm the oracle result or sign a `voidActive()` refund. Gated by `x-admin-secret`. |
| POST | `/api/admin/duels/[id]/confirm-void` | Admin-only: confirm a submitted `voidActive()` transaction, decode `Voided`, finalize the refund. |
| GET | `/api/cron/settle` | Keeper: sign expired `LIVE` duels, repair stranded `SETTLING` signatures, relay `settle()` on-chain, alert on overdue `HELD` duels. Bearer-token gated, run every minute. |
| GET | `/api/users`, `/api/users/[id]` | List/fetch legacy `User` records. No confirmed frontend caller. |

## Frontend

Next.js 15 App Router, React 18, TypeScript, Tailwind CSS, Radix/shadcn primitives,
`wagmi` + `viem` + ConnectKit for wallet connection. Data fetching is plain
`fetch()` + `useState`/`useEffect` throughout (React Query is provisioned as a
provider but not currently used for any request). Toasts run on `sonner`.

| Route | Renders |
|---|---|
| `/landing` | Public marketing page + pre-launch whitelist signup (outside the app shell) |
| `/` | Dashboard — stat cards, today's Top 10, lobby browser + join flow |
| `/duels/create` | Duel creation wizard |
| `/duels/[id]` | Lobby countdown → live battle (animated bar) → settlement/result view, branched per `DuelStatus` |
| `/tokens` | Today's scanned/eligible token roster |
| `/profile` | Combat Record — points, tier, win/loss, match history |
| `/referrals` | Referral dashboard — code, share link, tier, cumulative volume/earnings |
| `/airdrop` | Genesis airdrop task checklist and live point total |

Wallet writes (`createDuel`, `joinDuel`, `cancel`, `expire`, a manual `settle`) are
plain async functions in `lib/duelContract.ts` built on `wagmi/actions` rather than
hooks, so an approve → write → wait-for-receipt sequence can run top-to-bottom inside
one event handler; pages then POST the resulting tx hash to the matching API route,
which re-derives the outcome from the real event log rather than trusting the client.

## Points, tiers and rewards

Every settled duel awards Combat Record points (winner scaled by stake size and
margin of victory, loser a flat participation amount), gated by an opponent-diversity
rule that stops two wallets farming each other. A separate, pre-launch-only genesis
airdrop ledger tracks onboarding/social/arena tasks. Full formulas, worked examples,
and every point-awarding event in the system: **[`Points.md`](Points.md)**.

Points currently drive an off-chain tier (Bronze/Silver/Gold/Diamond) only — the
on-chain rewards layer (`CombatRecordNFT`, `RedemptionVault`, documented in
[`Contracts/README.md`](Contracts/README.md)) exists in source but is deliberately
undeployed; see [Known gaps](#known-gaps--open-items).

## Referrals

Any wallet can refer others. A referrer's commission rate is driven by their **own**
cumulative settled duel volume (1–5%, five tiers) and is paid **on-chain, atomically,
in the same `settle()` transaction** that pays the winner — no claim step, no
custodial holding period. Full economics, the exact signed-message shape, the
attribution pipeline, and database schema: **[`Referral.md`](Referral.md)**.

## Background jobs

Two scheduled jobs, run against the backend deployment via Google Cloud Scheduler
(not Vercel Cron — see [`Deployment.md`](Deployment.md) for why):

| Job | Schedule | Does |
|---|---|---|
| `GET /api/cron/settle` | Every minute | Signs expired `LIVE` duels, repairs stranded unsigned `SETTLING` duels, relays `settle()` on-chain, alerts on `HELD` duels overdue for review. |
| `POST /api/scan` | Continuous (4 passes/min) or every 15 min | Refreshes the Top 10 duel-eligible tokens; also keeps the oracle circuit breaker from tripping, which would otherwise pause all new duel creation. |

## Security model

- **No owner withdrawal path anywhere in `BattleEscrow`.** Funds leave only via
  `settle`, `cancel`, `expire`, `voidActive`, `refundStale`, or `withdraw` (a deferred
  payout to its owner only).
- **Settlement is signature-authorized, not submitter-restricted.** `settle()` and
  `voidActive()` accept a transaction from anyone; what authorizes the payout is an
  ECDSA signature from the oracle key snapshotted on that duel at `activate()` time.
  If the platform's own keeper is down, any holder of a validly signed result can
  still push settlement through.
- **Oracle key rotation is timelocked (24h)**; platform treasury and fee-split
  changes are instant but only ever apply to duels activated after the change — a
  duel's terms are locked the moment it starts.
- **Two separate off-chain keys, never shared.** The oracle signer (decides
  outcomes) and the relayer (submits transactions, holds only gas ETH) are enforced
  to be different wallets — `lib/settlementRelayer.ts` throws on startup if they ever
  match.
- **Every client-submitted transaction is independently re-verified** from the real
  on-chain event log (`lib/chainVerify.ts`) — a route never trusts a client's claim
  of what a transaction did.
- **Admin routes are gated by a single shared secret** (`x-admin-secret` /
  cron bearer token via `lib/adminAuth.ts`) — a deliberate stop-gap, not a real
  admin-identity system; see [Known gaps](#known-gaps--open-items).
- **Emergency pause** (factory owner, instant): blocks new/joining duels and every
  oracle-signed outcome, for a leaked oracle key faster than its 24h timelock could
  react. Every exit path (`cancel`, `expire`, `refundStale`, `withdraw`) stays open
  even while paused.

## Getting started

```bash
cd FE
npm install
npm run dev
```

MongoDB is required locally — `npm run dev` starts it automatically via `predev`
(`FE/scripts/mongo.mjs`). See `FE/.env.example` for every environment variable the
app reads and what each one is for.

For the contracts:

```bash
cd Contracts
forge build
anvil                 # local node, in a separate shell
```

Deploying either subsystem (local, testnet, or production) is covered end to end in
[`Deployment.md`](Deployment.md).

## Testing

```bash
cd FE && npm test          # vitest — route/unit/integration tests
cd Contracts && forge test  # Foundry — happy-path + adversarial contract tests
```

## Related documentation

| Doc | Covers |
|---|---|
| [`Points.md`](Points.md) | Every points ledger, formula, and awarding event, including the genesis airdrop |
| [`Referral.md`](Referral.md) | Referral economics, on-chain settlement mechanics, backend pipeline, schema |
| [`Deployment.md`](Deployment.md) | Deploying contracts, FE/backend (Vercel + Cloud Run), crons, secrets, verification |
| [`Contracts/README.md`](Contracts/README.md) | Contract-by-contract reference: functions, trust model, deploy script usage |
| `FE/packages/engine/README.md` | Token discovery gates + oracle integrity pipeline detail |
| `FE/packages/matchmaking/README.md` | Lobby state machine transitions |
| `FE/packages/risk/README.md` | Sybil clustering, geofence, circuit breaker detail |

## Known gaps / open items

- **Migration off the previous factory (`0x65f58fA80dd62460980B14979f062F1E67D35Cff`) is
  incomplete.** It has 5 duels on it (not the usual 0 for a superseded deployment), and as of
  2026-09-22 one of them (`0x35EB4C03C56740364AD6a5767c74F3F625c29b0a`) is `Active`, ~48h past its
  `endTime`, unsettled, and already past its 24h `refundStale()` window. Confirm the backend/cron
  is pointed at the intended factory and either settle or `refundStale()` this duel before
  retiring the old factory from any monitoring. See [`Contracts/README.md`](Contracts/README.md#deployments).
- **On-chain rewards are deliberately deferred.** `CombatRecordNFT`/`RedemptionVault`
  are built and tested but not deployed; points/tiers are DB-only
  (`CombatRecord`) for now — this is a decision, not an oversight, and there is no
  redemption flow wired up yet to un-defer.
- **No genesis airdrop snapshot mechanism.** The airdrop point total re-reads live
  combat points on every request rather than freezing at a token-generation event.
- **Referral sybil signal isn't re-checked for live commissions.** A wallet flagged
  by the pre-launch whitelist's IP-clustering check still earns real on-chain
  referral commissions today.
- **No dedicated referral UI page for per-duel breakdowns yet** beyond the
  `/referrals` dashboard (code, tier, cumulative totals) — duel detail screens show
  the 90/10 split but not a per-duel referral-cut line item.
- **Admin auth is a single shared secret**, not a real identity/role system — fine
  at today's surface area, worth replacing before it grows.
- **`POST /api/scan` has no auth check.** Low severity (re-runs discovery only, no
  funds at risk) but anyone with the Cloud Run URL can trigger it.
- **`User` model is legacy** and unused by the duel flow, which is wallet-keyed
  throughout; kept only for two routes with no confirmed frontend caller.
