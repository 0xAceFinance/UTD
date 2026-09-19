# Deploying UTD: Vercel (frontend) + GCP Cloud Run (backend)

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

## Prerequisites

- A GCP project with billing enabled, and the `gcloud` CLI authenticated
  (`gcloud auth login`) and pointed at it.
- A Vercel account with this repo accessible (via the Vercel CLI or the
  Git integration).
- MongoDB already running somewhere reachable from the internet/GCP (Atlas
  is the path of least resistance).
- The duel contracts already deployed (factory, stake token, oracle signer,
  treasury addresses — see `Contracts/README.md`'s Usage section for the
  deploy script) — this guide assumes you already have those four values.

Deploy the **backend first** — the frontend needs its URL before it can be
configured.

## Part 1 — GCP one-time setup

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

## Part 2 — Backend on Cloud Run

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
var this deployment needs and why) — never from this file, and never paste
a real private key into a chat/AI tool.

```bash
# Builds the Dockerfile in FE/ via Cloud Build, deploys to Cloud Run
gcloud run deploy utd-backend \
  --source . \
  --allow-unauthenticated \
  --set-env-vars "NEXT_PUBLIC_CHAIN_ID=4663,NEXT_PUBLIC_RPC_URL=https://rpc.mainnet.chain.robinhood.com,NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS=0x65f58fA80dd62460980B14979f062F1E67D35Cff,NEXT_PUBLIC_STAKE_TOKEN_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" \
  --set-secrets "ORACLE_SIGNER_PRIVATE_KEY=ORACLE_SIGNER_PRIVATE_KEY:latest,RELAYER_PRIVATE_KEY=RELAYER_PRIVATE_KEY:latest,MONGODB_URI=MONGODB_URI:latest,CRON_SECRET=CRON_SECRET:latest,ADMIN_API_SECRET=ADMIN_API_SECRET:latest"
```

`--allow-unauthenticated` is required — Vercel's proxy and end users both
need to reach this service without a GCP identity token. The route-level
checks already in the code (`x-admin-secret`, the cron bearer token, on-chain
tx verification) are what actually gate access, same as they do today.

Note the **Service URL** the command prints
(`https://utd-backend-xxxxx-uc.a.run.app` or similar) — you need it in both
of the next two parts.

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

## Part 3 — Frontend on Vercel

```bash
cd FE
vercel link       # first time only, links this directory to a Vercel project
```

In the Vercel project's **Settings → Environment Variables**, set every var
from `FE/.env.vercel.example`:

| Var | Value |
|---|---|
| `BACKEND_API_URL` | the Cloud Run Service URL from Part 2 |
| `NEXT_PUBLIC_CHAIN_ID` | `4663` |
| `NEXT_PUBLIC_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` |
| `NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS` | your deployed factory address |
| `NEXT_PUBLIC_STAKE_TOKEN_ADDRESS` | your stake token address (USDG) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | from [cloud.reown.com](https://cloud.reown.com) |

Then deploy:

```bash
vercel --prod
```

(Or connect the repo via the Vercel dashboard's Git integration for
deploy-on-push — same env vars either way.)

## Part 4 — Connecting them

Nothing to do here beyond setting `BACKEND_API_URL` in Part 3 — that's the
whole connection. `next.config.mjs`'s `rewrites()` reads it at request time
and proxies every `/api/:path*` call on the Vercel deployment straight to
`${BACKEND_API_URL}/api/:path*` on Cloud Run. No CORS configuration is
needed because the browser only ever talks to the Vercel origin; the
proxying happens server-side, invisibly to the frontend code.

## Part 5 — Cron (Cloud Scheduler)

Vercel's free tier can't run the per-minute settlement job this app needs
(`vercel.json`'s old `crons` block is gone for that reason), so it's
scheduled directly against Cloud Run instead — bypassing the Vercel proxy
entirely:

```bash
gcloud scheduler jobs create http utd-settle-cron \
  --schedule="* * * * *" \
  --uri="<cloud-run-service-url>/api/cron/settle" \
  --http-method=GET \
  --headers="Authorization=Bearer <CRON_SECRET value>" \
  --location=<your-region>
```

The discovery scan (`POST /api/scan`) needs the same treatment. It's what
populates `OracleHealthSample`, which `lib/duelGuards.ts::checkCanCreateLobby`
reads before allowing any new duel -- if it hasn't run successfully in the
last hour (`riskConfig.ts::ORACLE_CIRCUIT_BREAKER_CONFIG.maxStalenessSeconds`),
or has 3+ consecutive failures, every new duel gets blocked with "New duels
are paused while we recover the price feed." An empty table (never having
run) fails the same way -- `shouldPauseNewLobbies` fails safe and pauses.
15-minute cadence keeps comfortable margin inside that 1-hour staleness
window even if a run or two fails or is delayed:

```bash
gcloud scheduler jobs create http utd-scan-cron \
  --schedule="*/15 * * * *" \
  --uri="<cloud-run-service-url>/api/scan" \
  --http-method=POST \
  --location=<your-region>
```

Unlike `/api/cron/settle`, `POST /api/scan` currently has **no auth check**
(`app/api/scan/route.ts`) -- anyone with the Cloud Run URL can trigger it.
Low severity (it only re-runs discovery and rewrites today's Top 10, no
funds at risk), but worth gating with `isAuthorizedCron` the same way if this
surface grows.

## Verification checklist

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
      detection — `lib/requestSignals.ts::getClientIp`). Temporarily log
      the header in that function and check a real request from a browser.
- [ ] `x-vercel-ip-country` survives the same hop (feeds the geofence check
      — `lib/requestSignals.ts::getClientCountry`). A missing header
      silently **no-ops** the check rather than erroring, so this is easy
      to miss — confirm it's actually present on requests reaching Cloud
      Run, not just on the original Vercel request.
- [ ] Cloud Scheduler's job history shows successful (`200`) invocations
      once a minute.
- [ ] `curl -i -X POST https://<cloud-run-url>/api/scan` → `200`, and
      `curl "https://<cloud-run-url>/api/duels/precheck?wallet=0x..."` →
      `{"canCreate":true}` (confirms the scan cron will keep the oracle
      circuit breaker from tripping).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Frontend pages load but every duel action fails | `BACKEND_API_URL` unset/wrong on Vercel, or Cloud Run service not `--allow-unauthenticated` |
| `ECONNREFUSED`/timeout from any DB-backed route | `MONGODB_URI` wrong, or Cloud Run can't reach MongoDB's network (see Part 2) |
| Cron job in Cloud Scheduler shows failures | `CRON_SECRET` mismatch between the secret and the scheduler job's header, or hitting the Vercel domain instead of the Cloud Run URL directly |
| Settlements never get relayed automatically | `RELAYER_PRIVATE_KEY` unset (documented as optional — falls back to a manual "Trigger escrow payout" button), or that wallet is out of gas |
| Geofence/sybil checks seem to never trigger | One of the two header-forwarding checks above is failing silently — confirm with the verification checklist, not just app behavior |
