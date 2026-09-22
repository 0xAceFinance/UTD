# Deploying UTD

End-to-end deployment: the Solidity contracts first, then the Next.js app
(`FE/`) split across two production targets — Vercel (pages) + GCP Cloud Run
(the API surface) — then the crons that keep the game running unattended.
Deploy in this order; each part's output feeds the next.

## Contents

- [1. Prerequisites](#1-prerequisites)
- [2. Deploy the contracts](#2-deploy-the-contracts)
- [3. Backend on Cloud Run](#3-backend-on-cloud-run)
- [4. Frontend on Vercel](#4-frontend-on-vercel)
- [5. Connecting Vercel to Cloud Run](#5-connecting-vercel-to-cloud-run)
- [6. Background jobs (Cloud Scheduler)](#6-background-jobs-cloud-scheduler)
- [7. Secrets reference](#7-secrets-reference)
- [8. Verification checklist](#8-verification-checklist)
- [9. Rotating the oracle signer](#9-rotating-the-oracle-signer)
- [10. Troubleshooting](#10-troubleshooting)

## 1. Prerequisites

- A GCP project with billing enabled, and the `gcloud` CLI authenticated
  (`gcloud auth login`) and pointed at it.
- A Vercel account with this repo accessible (via the Vercel CLI or the Git
  integration).
- MongoDB already running somewhere reachable from the internet/GCP (Atlas is
  the path of least resistance).
- A deployer key, an oracle signer key, and a platform treasury address for
  the contracts (see [`Contracts/README.md`](Contracts/README.md) for what
  each does and the trust model around them). **Never** put a private key in
  a tracked file, a chat/AI tool, or anywhere outside a secrets manager.
- Foundry (`forge`, `anvil`) installed for the contracts step.

## 2. Deploy the contracts

Full function-level reference, trust model, and test coverage:
[`Contracts/README.md`](Contracts/README.md). Summary of the two deploy
scripts:

**Duel escrow** (`BattleEscrow` implementation + `BattleEscrowFactory`):

```shell
cd Contracts
PRIVATE_KEY=<deployer_key> \
ORACLE_SIGNER_ADDRESS=<address whose signature settle() trusts> \
PLATFORM_TREASURY_ADDRESS=<address the platform's cut is sent to> \
STAKE_TOKEN_ADDRESS=<real stablecoin address> \
MIN_BUY_IN=<smallest buy-in, in the stake token's own units> \
  forge script script/DeployDuel.s.sol:DeployDuel --rpc-url <rpc_url> --broadcast
```

- `MIN_BUY_IN` must be at least one whole token in its own decimals (e.g.
  `1000000` = 1 USDC/USDG at 6 decimals) — the script reads the token's
  `decimals()` and refuses a dust floor.
- `FACTORY_OWNER=<multisig>` (optional) hands factory ownership over after
  deployment. The owner can `pause()` all duels, retune `winnerBps`/
  `maxReferrerBps`/buy-in bounds, and propose oracle signer rotations — it
  should not stay on the deployer's hot key for anything beyond local/testnet
  use.
- `RELAYER_ADDRESS=<FE relayer wallet>` (optional) is only checked: the
  script refuses to deploy if it equals the oracle signer, since the relayer
  needs no on-chain authority (see [Security model in `README.md`](README.md#security-model)).
- `DEPLOY_MOCK_STAKE_TOKEN=true` deploys a mint-on-demand mock stake token
  instead — local/testnet only, never for a real deployment.
- The script prints the `NEXT_PUBLIC_*` values to paste into the FE env at
  the end of its run — carry those into Part 4 below.

**Rewards layer** (`CombatRecordNFT` + `RedemptionVault`) — independent of
the duel contracts, and, per current product decision, **deliberately not
deployed yet** (points/tiers stay DB-only for now; see
[`README.md`](README.md#known-gaps--open-items)). If and when it is deployed:

```shell
cd Contracts
PRIVATE_KEY=<deployer_key> \
POINTS_ORACLE_ADDRESS=<the only address allowed to addPoints()> \
REWARD_TOKEN_ADDRESS=<platform token> \
TOKENS_PER_POINT_WAD=<reward-token base units per point, e.g. 1000000000000000> \
REWARDS_OWNER=<multisig> \
VAULT_FUNDING_AMOUNT=<reward tokens the deployer moves into the vault> \
  forge script script/DeployRewards.s.sol:DeployRewards --rpc-url <rpc_url> --broadcast
```

Optional: `VESTING_DURATION_SECONDS` (30–90 days, default 60),
`ORACLE_SIGNER_ADDRESS`/`RELAYER_ADDRESS` (checked so the points oracle never
reuses the duel oracle or relayer key), `DEPLOY_MOCK_REWARD_TOKEN=true` for
local/testnet. An unfunded vault redeems nothing; the script warns if it's
left empty.

**Local node** for testing either script before touching a real chain:

```shell
anvil
```

**After any deploy**, verify on-chain state matches what you configured
before trusting it (`oracleSigner`, `platformTreasury`, `approvedStakeToken`,
`minBuyIn`, `owner`, `paused == false`), and verify source on the chain's
explorer/Sourcify — see the checklist already run for the current mainnet
deployment in [`Contracts/README.md`](Contracts/README.md#deployments).

## 3. Backend on Cloud Run

Same Next.js app (`FE/`), deployed twice against two different targets:

```
Browser
  │
  ▼
Vercel  ──serves──► pages (app/(app)/**, app/landing/**, components/**)
  │
  │  /api/* is rewritten (next.config.mjs -> rewrites()) to:
  ▼
GCP Cloud Run  ──serves──► the real API (app/api/**, lib/**, DB models)
  │
  ▼
MongoDB (Atlas or self-hosted, reachable from Cloud Run)
```

Vercel never runs the API itself in production — every `/api/*` request a
page makes (still just `fetch('/api/...')`, unchanged) gets proxied
server-side to Cloud Run. The browser only ever talks to your Vercel domain.
Local dev (`npm run dev`) is unaffected — one process, no proxy, no split.

Deploy the **backend first** — the frontend needs its URL before it can be
configured.

```bash
gcloud config set project <your-gcp-project-id>
gcloud config set run/region <your-region>   # e.g. us-central1

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com
```

```bash
cd FE

# Secrets (repeat per secret; -n avoids a trailing newline in the value)
echo -n "<value>" | gcloud secrets create ORACLE_SIGNER_PRIVATE_KEY --data-file=-
echo -n "<value>" | gcloud secrets create RELAYER_PRIVATE_KEY --data-file=-
echo -n "<value>" | gcloud secrets create MONGODB_URI --data-file=-
echo -n "<value>" | gcloud secrets create CRON_SECRET --data-file=-
echo -n "<value>" | gcloud secrets create ADMIN_API_SECRET --data-file=-
```

Get the exact secret values from `FE/.env.gcp.example` (which lists every
var this deployment needs and why) — never from this file, and never paste a
real private key into a chat/AI tool.

```bash
# Builds the Dockerfile in FE/ via Cloud Build, deploys to Cloud Run
gcloud run deploy utd-backend \
  --source . \
  --allow-unauthenticated \
  --set-build-env-vars "NEXT_PUBLIC_CHAIN_ID=4663,NEXT_PUBLIC_UTD_X_URL=https://x.com/UTD_RHC,NEXT_PUBLIC_UTD_TELEGRAM_URL=https://t.me/utd_rh" \
  --set-env-vars "NEXT_PUBLIC_CHAIN_ID=4663,NEXT_PUBLIC_UTD_X_URL=https://x.com/UTD_RHC,NEXT_PUBLIC_UTD_TELEGRAM_URL=https://t.me/utd_rh" \
  --set-secrets "ORACLE_SIGNER_PRIVATE_KEY=ORACLE_SIGNER_PRIVATE_KEY:latest,RELAYER_PRIVATE_KEY=RELAYER_PRIVATE_KEY:latest,MONGODB_URI=MONGODB_URI:latest,CRON_SECRET=CRON_SECRET:latest,ADMIN_API_SECRET=ADMIN_API_SECRET:latest"
```

**`--set-build-env-vars` is not optional here, and it's easy to miss.** Next.js inlines every
`NEXT_PUBLIC_*` var into the compiled output at `next build` time — including in server-only code
paths, since shared modules like `config/contracts.ts` are also imported by client components.
`--set-env-vars` only configures the *deployed revision's* runtime environment, which doesn't
exist yet during the build Cloud Build just ran — so without `--set-build-env-vars` (which Cloud
Run forwards into the Dockerfile's build stage as Docker build args, matching the `ARG`s declared
in `FE/Dockerfile`), the backend silently compiles with `config/contracts.ts`'s local-dev fallback
values (chain `31337`) no matter what `--set-env-vars` says.

**Deliberately not set above, and pointless to set: `NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS` /
`NEXT_PUBLIC_STAKE_TOKEN_ADDRESS` / `NEXT_PUBLIC_RPC_URL`.** `config/contracts.ts` hardcodes the
current mainnet (chain `4663`) factory/stake-token addresses and RPC URL in source, keyed by chain
ID, and **ignores these env vars entirely for a listed chain ID** — there is no env var anywhere
that can override them, so every deploy target gets the identical value from the same git commit
with zero possibility of drift. This is what used to break: `lib/chainVerify.ts` functions like
`verifyDuelCreated` compare `event.address` against the backend's own compiled
`CONTRACTS.battleEscrowFactory`, and if that value had drifted stale in only one of the two build
targets (a forgotten `--set-build-env-vars`, or an env var updated in one dashboard but not the
other), it threw `"... event not found"` for a perfectly valid transaction. The same class of bug
hit `NEXT_PUBLIC_RPC_URL`: a stale/missing build-time value compiled in as
`lib/chainClient.ts`/`lib/chainVerify.ts`/`lib/settlementRelayer.ts`/`lib/fundingSource.ts`'s
`'http://127.0.0.1:8545'` fallback, so the backend tried to reach a local Anvil node that doesn't
exist in Cloud Run and every chain read failed with `fetch failed`. These three vars now only
matter for a chain ID with **no** entry in `config/contracts.ts`'s map — local Anvil dev. On a real
factory redeploy or RPC provider change, update that map (and `Contracts/README.md#deployments` for
the addresses), not these flags. `config/contracts.ts`'s `rpcUrl` currently points at a paid
Alchemy endpoint rather than the public `rpc.mainnet.chain.robinhood.com` one — a deliberate choice
for reliability; note this value is also imported by the browser-side wagmi config
(`config/chains.ts`/`config/wagmiConfig.ts`), so the URL (including its API key) ships in the
public JS bundle. Rate-limit/domain-restrict that key on Alchemy's dashboard accordingly.

`--allow-unauthenticated` is required — Vercel's proxy and end users both
need to reach this service without a GCP identity token. The route-level
checks already in the code (`x-admin-secret`, the cron bearer token, on-chain
tx verification) are what actually gate access, same as they do today.

Note the **Service URL** printed by the deploy — you need it in both of the
next two parts.

If the deploy fails with a Secret Manager permission error, grant the Cloud
Run service's runtime service account access explicitly:

```bash
gcloud secrets add-iam-policy-binding ORACLE_SIGNER_PRIVATE_KEY \
  --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
# repeat per secret
```

**MongoDB reachability:** Cloud Run's outbound traffic uses Google's shared
IP ranges by default. For Atlas, either allowlist `0.0.0.0/0` (fine for
early-stage, not for later) or set up a
[Serverless VPC Connector](https://cloud.google.com/run/docs/configuring/connecting-vpc)
with a static egress IP you can allowlist precisely.

## 4. Frontend on Vercel

```bash
cd FE
vercel link       # first time only, links this directory to a Vercel project
```

In the Vercel project's **Settings → Environment Variables**, set every var
from `FE/.env.vercel.example`:

| Var | Value |
|---|---|
| `BACKEND_API_URL` | the Cloud Run Service URL from Part 3 |
| `NEXT_PUBLIC_CHAIN_ID` | `4663` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | from [cloud.reown.com](https://cloud.reown.com) |

Leave `NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS`/`NEXT_PUBLIC_STAKE_TOKEN_ADDRESS`/
`NEXT_PUBLIC_RPC_URL` **unset** — `config/contracts.ts` hardcodes the current mainnet
addresses/RPC for chain `4663` and ignores these env vars entirely for that chain ID, so Vercel and
Cloud Run resolve to the same values automatically with no dashboard entry on either side that
could ever drift (see Part 3's note on the matching Cloud Run flags). Setting one here has no
effect on chain `4663`.

Then deploy:

```bash
vercel --prod
```

(Or connect the repo via the Vercel dashboard's Git integration for
deploy-on-push — same env vars either way.)

## 5. Connecting Vercel to Cloud Run

Nothing to do here beyond setting `BACKEND_API_URL` in Part 4 — that's the
whole connection. `next.config.mjs`'s `rewrites()` reads it at request time
and proxies every `/api/:path*` call on the Vercel deployment straight to
`${BACKEND_API_URL}/api/:path*` on Cloud Run. No CORS configuration is
needed because the browser only ever talks to the Vercel origin; the
proxying happens server-side, invisibly to the frontend code.

## 6. Background jobs (Cloud Scheduler)

Vercel's free tier can't run the per-minute settlement job this app needs
(there is no `crons` block in `FE/vercel.json` for that reason), so both jobs
are scheduled directly against Cloud Run instead — bypassing the Vercel
proxy entirely. Full description of what each job does: [`README.md`
§ Background jobs](README.md#background-jobs).

```bash
# Settle cron (runs every minute to settle ended duels)
gcloud scheduler jobs create http utd-settle-cron \
  --schedule="* * * * *" \
  --uri="<cloud-run-service-url>/api/cron/settle" \
  --http-method=GET \
  --headers="Authorization=Bearer <CRON_SECRET value>" \
  --location=<your-region>

# 15-second discovery scan (runs continuously every 15s across the 1-minute cron window)
gcloud scheduler jobs create http utd-scan-cron \
  --schedule="* * * * *" \
  --time-zone="Etc/UTC" \
  --uri="<cloud-run-service-url>/api/scan?loop=true" \
  --http-method=POST \
  --message-body="{}" \
  --headers="Content-Type=application/json" \
  --attempt-deadline=180s \
  --location=<your-region>
```

The discovery scan (`POST /api/scan`) populates `OracleHealthSample`, which
`lib/duelGuards.ts::checkCanCreateLobby` reads before allowing any new duel —
if it hasn't run successfully in the last hour
(`riskConfig.ts::ORACLE_CIRCUIT_BREAKER_CONFIG.maxStalenessSeconds`), or has
3+ consecutive failures, every new duel gets blocked with "New duels are
paused while we recover the price feed." An empty table (never having run)
fails the same way — `shouldPauseNewLobbies` fails safe and pauses. If the
15-second cadence above isn't needed, a simpler 15-minute schedule keeps
comfortable margin inside that 1-hour staleness window even if a run or two
fails or is delayed:

```bash
gcloud scheduler jobs create http utd-scan-cron \
  --schedule="*/15 * * * *" \
  --uri="<cloud-run-service-url>/api/scan" \
  --http-method=POST \
  --location=<your-region>
```

Unlike `/api/cron/settle`, `POST /api/scan` currently has **no auth check**
(`app/api/scan/route.ts`) — anyone with the Cloud Run URL can trigger it.
Low severity (it only re-runs discovery and rewrites today's Top 10, no
funds at risk), but worth gating with `isAuthorizedCron` the same way if this
surface grows (tracked in [`README.md`'s open items](README.md#known-gaps--open-items)).

## 7. Secrets reference

| Secret | Used by | Never |
|---|---|---|
| `ORACLE_SIGNER_PRIVATE_KEY` (+ `_PREVIOUS` during a rotation window) | Signs `settle()`/`voidActive()` results (`lib/oracleSigner.ts`) | Never the same wallet as `RELAYER_PRIVATE_KEY` — this key decides who wins, it must not also send transactions |
| `RELAYER_PRIVATE_KEY` | Submits signed `settle()` transactions on a keeper's behalf (`lib/settlementRelayer.ts`); holds only gas ETH | Never an oracle signer key — enforced at runtime, throws if it matches |
| `CRON_SECRET` | Bearer token `GET /api/cron/settle` requires (`lib/adminAuth.ts::isAuthorizedCron`) | — |
| `ADMIN_API_SECRET` | `x-admin-secret` header the `/api/admin/**` routes require (`lib/adminAuth.ts::isAuthorizedAdmin`) | Treat as a real operator secret; this is a stop-gap, not a full admin-identity system |
| `MONGODB_URI` | The only datastore; every route connects through `lib/mongoose.ts` | — |

## 8. Verification checklist

Run through these once both sides are live, before trusting it with real
duels:

- [ ] `https://<vercel-domain>/` loads the app and wallet connect works.
- [ ] Creating/joining a duel on the Vercel domain actually reaches the
      backend (check Cloud Run logs for the request).
- [ ] `curl -i https://<cloud-run-url>/api/cron/settle` → `401` (no auth
      header).
- [ ] `curl -i -H "Authorization: Bearer <CRON_SECRET>" https://<cloud-run-url>/api/cron/settle`
      → `200` (confirms the Cloud Scheduler job's secret will work).
- [ ] `x-forwarded-for` survives the Vercel → Cloud Run hop with the real
      client IP first in the chain (feeds `WalletSighting` / sybil
      detection — `lib/requestSignals.ts::getClientIp`). Temporarily log the
      header in that function and check a real request from a browser.
- [ ] `x-vercel-ip-country` survives the same hop (feeds the geofence check —
      `lib/requestSignals.ts::getClientCountry`). A missing header silently
      **no-ops** the check rather than erroring, so this is easy to miss —
      confirm it's actually present on requests reaching Cloud Run, not just
      on the original Vercel request.
- [ ] Cloud Scheduler's job history shows successful (`200`) invocations
      once a minute.
- [ ] `curl -i -X POST https://<cloud-run-url>/api/scan` → `200`, and
      `curl "https://<cloud-run-url>/api/duels/precheck?wallet=0x..."` →
      `{"canCreate":true}` (confirms the scan cron will keep the oracle
      circuit breaker from tripping).
- [ ] On-chain state matches configuration: `oracleSigner`, `platformTreasury`,
      `approvedStakeToken`, `minBuyIn`, `winnerBps`, `maxReferrerBps`, `owner`,
      `paused == false` (see [`Contracts/README.md`](Contracts/README.md)).

## 9. Rotating the oracle signer

`BattleEscrowFactory.oracleSigner()` rotation is timelocked (24h) by design
(see [`README.md` § Security model](README.md#security-model)):

1. `proposeOracleSigner(newAddress)` (factory owner) — starts the 24h delay
   and emits `OracleSignerRotationProposed`.
2. Provision the new key as `ORACLE_SIGNER_PRIVATE_KEY` in Secret Manager,
   and move the *old* key to `ORACLE_SIGNER_PRIVATE_KEY_PREVIOUS` — every
   escrow snapshots its signer at `activate()`, so duels already in flight
   when the timelock elapses still need the old key for up to ~24h after
   rotation (`lib/oracleSigner.ts::signerFor()` tries both, matching each
   duel's own snapshotted signer).
3. Once the timelock elapses, anyone may call `executeOracleSignerRotation()`
   (permissionless by design — the security is the delay and the public
   proposal event, not who flips the switch).
4. After the old key's ~24h in-flight window has fully passed, remove
   `ORACLE_SIGNER_PRIVATE_KEY_PREVIOUS`.

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Frontend pages load but every duel action fails | `BACKEND_API_URL` unset/wrong on Vercel, or Cloud Run service not `--allow-unauthenticated` |
| `ECONNREFUSED`/timeout from any DB-backed route | `MONGODB_URI` wrong, or Cloud Run can't reach MongoDB's network (see Part 3) |
| Cron job in Cloud Scheduler shows failures | `CRON_SECRET` mismatch between the secret and the scheduler job's header, or hitting the Vercel domain instead of the Cloud Run URL directly |
| Settlements never get relayed automatically | `RELAYER_PRIVATE_KEY` unset (documented as optional — falls back to a manual "Trigger escrow payout" button), or that wallet is out of gas |
| Geofence/sybil checks seem to never trigger | One of the two header-forwarding checks in the verification checklist is failing silently — confirm with `curl`, not just app behavior |
| `settle()`/`voidActive()` reverts "invalid oracle signature" right after a signer rotation | The duel being settled was activated under the *old* signer; confirm `ORACLE_SIGNER_PRIVATE_KEY_PREVIOUS` is still set and matches |
| New duel creation blocked with "New duels are paused while we recover the price feed" | The scan cron isn't running/succeeding — check `OracleHealthSample` and the scan job's Cloud Scheduler history |
| Duel creation fails right after wallet confirmation with "DuelCreated event not found for this wallet in that transaction" | The Cloud Run backend's compiled `CONTRACTS.battleEscrowFactory` doesn't match the factory address the transaction actually used. For chain `4663`, `config/contracts.ts` hardcodes the address and ignores the env var entirely, so this means the factory really was redeployed without updating `config/contracts.ts`'s map (and redeploying both targets) — update the map, not an env var. If this happens on a chain ID with *no* entry in that map (local Anvil dev), it's the older class of bug: remember `--set-build-env-vars` on Cloud Run — `--set-env-vars` alone only configures the *deployed revision's* runtime environment, too late for Next.js's build-time inlining of `NEXT_PUBLIC_*`. |
| Any chain-reading request fails with `HTTP request failed. URL: http://127.0.0.1:8545/ ... fetch failed` | The backend compiled with the `'http://127.0.0.1:8545'` fallback instead of a real RPC — there's no Anvil node in Cloud Run/Vercel to answer that. For chain `4663`, `config/contracts.ts` hardcodes `rpcUrl`, so this shouldn't happen unless you're on an older build; redeploy after pulling the fix. On a chain ID with no entry in that map, it's the same `--set-build-env-vars` gap as the row above, for `NEXT_PUBLIC_RPC_URL` instead. |

---

Related: [`README.md`](README.md) · [`Contracts/README.md`](Contracts/README.md) ·
[`Points.md`](Points.md) · [`Referral.md`](Referral.md)
