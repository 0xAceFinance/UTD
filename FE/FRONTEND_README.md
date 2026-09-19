# UTD Frontend (Underground Token Duel)

## Overview

This is the frontend/UI layer of **UTD ("Underground Token Duel", internal codename "MCAP DUEL")**, a gambling game where players pit two already-trading tokens against each other in time-boxed "duels": pick a side, lock a buy-in stake, buy-only for 5, 10, 15 or 20 minutes (no selling), and whichever token posts the bigger validated market-cap gain wins. The pot splits 80% winner / 20% platform, on-chain via an escrow contract, settled from an oracle-fed backend pipeline (liquidity-weighted median, TWAP, sustained-peak checks). Despite living in a directory called `backend/`, this package is a full Next.js 15 App Router app containing both the UI (what this doc covers) and the API routes it calls (owned by a different agent/scope).

> A separate bonding-curve token-launch mechanic (`/create`, `TokenFactory`/`PumpPool`) previously existed alongside the duel game but has been removed — it's not part of this product, which is a duel/gambling game only. Tokens duelled here are discovered from the open market, not launched by this app.

## Tech stack

Pulled directly from `package.json`:

- **Next.js 15.2.4** (App Router), **React 18.2.0** / **react-dom 18.2.0**
  - Note: `@types/react`/`@types/react-dom` are pinned to `^19` while the runtime is React 18 — a version mismatch worth being aware of (type defs may describe APIs the installed React doesn't have).
- **TypeScript ^5**, **Tailwind CSS ^3.4.17** (+ `tailwindcss-animate`), **PostCSS/Autoprefixer**
- **Radix UI** primitives (accordion, dialog, dropdown, tooltip, etc. — only a handful are actually used, see Gotchas) + **shadcn/ui**-style wrappers in `components/ui/`
- **class-variance-authority**, **clsx**, **tailwind-merge** for the `cn()` styling helper
- Wallet/chain stack: **wagmi ^2.15.2**, **viem ^2.28.3**, **connectkit ^1.9.0** (wallet connect UI/modal — NOT Privy, NOT the `@coinbase/onchainkit` package which is a dependency but is not imported anywhere in the app)
- **@tanstack/react-query ^5.75.1** (wired up as a provider but not currently used for data fetching — pages use plain `fetch` + `useState`/`useEffect`)
- **sonner ^1.7.1** for toast notifications (the app's actual toast system — see Gotchas)
- **recharts** ("latest") — was used only by `TokenChart.tsx`, which has been removed along with the token-launch pages; now an unused dependency (flagged, not pruned from `package.json`)
- **geist** (Geist Sans, default body font) + `next/font/google` **Press Start 2P** (pixel display font for headings/buttons)
- **next-themes** is a dependency but no `ThemeProvider` is mounted anywhere (see Gotchas)

## Directory structure (frontend scope)

```
app/
  layout.tsx              Root layout: loads fonts, wraps everything in <Providers> (wallet/query) + <Toaster/>
  globals.css             The ACTUAL global stylesheet (imported by app/layout.tsx) — brand tokens, cyber-* utility classes
  icon.png                Next.js file-convention favicon/app icon
  landing/
    page.tsx              Public marketing page ("/landing") — not wrapped in the app shell
    Reveal.tsx             Scroll-triggered fade/slide-up wrapper used throughout the landing page
  (app)/                   Route group for the "logged in" app shell (sidebar + header)
    layout.tsx             Mounts <Sidebar/> + <Header/> around all pages in this group
    page.tsx                "/" — renders <Dashboard/>
    duels/create/page.tsx   "/duels/create" — 4-step duel creation wizard
    duels/[id]/page.tsx     "/duels/[id]" — duel detail/battle view (lobby countdown, live battle, settlement)
    profile/page.tsx        "/profile" — Combat Record (points/tier/match history)
    tokens/page.tsx         "/tokens" — today's eligible/scanned token roster
    components/
      Dashboard.tsx          Home page: stat cards, today's top 10 tokens, lobby browser + join flow
      Header.tsx             Top bar: search box, notification icon, wallet connect button (ConnectKit)
      Sidebar.tsx             Left nav: duels / tokens / profile, active-route highlighting
      Logo.tsx                LogoMark (image) + Logo (wrapper) — brand mark
      duel/SideTag.tsx        SideTag, StatusTag, TierBadge — small colored pill components for duel UI
      duel/types.ts           Shared duel/token DTO types + formatUsd/pctReturn/formatRelativeTime helpers
components/
  ui/                       shadcn/radix primitive components (only ~9 of the original ~50 are actually used
                             after this cleanup pass — see git history for what was removed)
  theme-provider.tsx        next-themes wrapper — exists but is never mounted (out of this task's scope to fix)
hooks/
  providers.tsx             <Providers> — WagmiProvider + QueryClientProvider + ConnectKitProvider (theme-matched)
  useWallet.ts               Thin wrapper over wagmi's useAccount() → { ready, connected, address }
styles/                     (now empty — see Gotchas)
config/
  wagmiConfig.ts            wagmi + ConnectKit chain/transport config (foundry/mainnet/sepolia/base/baseSepolia)
  contracts.ts               On-chain addresses (BattleEscrowFactory, stake token) + ABI re-exports
public/
  logo.png                  Used everywhere the brand mark appears
```

## Routing map

| Route | File | Renders |
|---|---|---|
| `/landing` | `app/landing/page.tsx` | Public marketing/landing page (outside the app shell — no sidebar/header) |
| `/` | `app/(app)/page.tsx` | `<Dashboard/>` — stats, top tokens, lobby browser |
| `/duels/create` | `app/(app)/duels/create/page.tsx` | 4-step duel creation wizard |
| `/duels/[id]` | `app/(app)/duels/[id]/page.tsx` | Duel lobby countdown → live battle → settlement/result view |
| `/tokens` | `app/(app)/tokens/page.tsx` | Today's scanned/eligible token roster |
| `/profile` | `app/(app)/profile/page.tsx` | Combat Record: points, tier, win/loss, match history |

All `(app)` routes are wrapped by `app/(app)/layout.tsx` (Sidebar + Header). `landing` and the root layout's fonts/providers apply everywhere.

## Data flow / wallet connection

- **Wallet connection**: `hooks/providers.tsx` wraps the app in `WagmiProvider` (config from `config/wagmiConfig.ts`, built with ConnectKit's `getDefaultConfig`) + `ConnectKitProvider` (custom dark/neon theme matching `app/globals.css`) + a React Query `QueryClientProvider`. `Header.tsx` renders `<ConnectKitButton.Custom>` to open the connect modal and show the connected address/ENS. `hooks/useWallet.ts` is the single read path every page uses (`{ ready, connected, address }`) — it's a thin wrapper over wagmi's `useAccount()`.
- **On-chain writes**: `lib/duelContract.ts` (backend-owned, read-only from this scope) exposes plain async functions (`createDuelOnChain`, `joinDuelOnChain`, `cancelDuelOnChain`, `expireDuelOnChain`, `settleDuelOnChain`) built on `wagmi/actions` rather than hooks, so a multi-step flow (approve → write → wait for receipt) can run top-to-bottom inside a single event handler. Pages call these, then POST the resulting tx hash to a matching `/api/duels/...` route, which re-derives the outcome from the real event log server-side rather than trusting the client.
- **Data fetching**: no react-query usage despite the provider being present — every page does plain `fetch()` to `/api/...` JSON endpoints inside `useEffect`, storing results in `useState`. Duel detail polls its own endpoint every 3s (`setInterval`) for live status; countdowns are client-side `setInterval` ticking against a target ISO timestamp from the API.
- **Toasts**: `sonner`'s `toast()` (imported directly from the `"sonner"` package) is what pages actually call; `<Toaster/>` from `components/ui/sonner.tsx` is mounted once in `app/layout.tsx`.

## Key components

- **`Dashboard.tsx`** — home page. Loads token roster + open/live duel counts + the user's combat record, plus a filterable/sortable lobby browser with a join-confirmation dialog that shows pot/win/lose amounts before locking in a stake.
- **`Header.tsx` / `Sidebar.tsx`** — persistent app chrome for every `(app)` route; Sidebar highlights the active nav item based on `usePathname()`.
- **`duel/SideTag.tsx`** — `SideTag` (A/B colored token pill), `StatusTag` (duel lifecycle badge: OPEN/LIVE/SETTLED/etc.), `TierBadge` (Bronze/Silver/Gold/Diamond). Reused across Dashboard, duel detail, profile, and the landing page.
- **`duel/types.ts`** — the shared contract between UI and API responses (`DuelDTO`, `DuelTokenDTO`, `DuelStatus`) plus formatting helpers (`formatUsd`, `pctReturn`, `formatRelativeTime`). Any change to the API's duel/token JSON shape should be reflected here first.
- **`duels/[id]/page.tsx`** — the most stateful page: renders a different view per `DuelStatus` (OPEN countdown/cancel, EXPIRED/CANCELLED, LIVE/SETTLING/HELD/SETTLED battle view with animated bar chart, share-to-X intent builder for settled results).
- **`Reveal.tsx`** — IntersectionObserver-based scroll reveal used throughout the landing page; respects `prefers-reduced-motion`.

## Notable conventions / gotchas

- **Two globals.css files, only one is live.** `app/globals.css` is the real stylesheet (imported by `app/layout.tsx`) and defines the actual black/neon-green brand tokens, `.cyber-*` utility classes, and duel-specific CSS vars (`--side-a`, `--side-b`, `--tier-*`). A second `styles/globals.css` existed with a completely different (light/shadcn-default) theme and was never imported anywhere — it was removed during this cleanup pass.
- **Root layout is deliberately bare.** `app/layout.tsx` only provides fonts + wallet/query providers + toaster; the sidebar/header shell lives in `app/(app)/layout.tsx` specifically so `app/landing/page.tsx` (outside the `(app)` group) doesn't inherit the logged-in app chrome.
- **The token-launch mechanic and its pages are gone.** `/create` (bonding-curve token creation), `/listings` and `/listings/[id]` (a light-themed, pre-`/tokens` token browser, partly using hardcoded dummy data), and `TokenChart.tsx` (only used by `listings/[id]`) were removed — this app is a duel/gambling game, not a launchpad. The remaining pages all use the one dark "cyber" pixel-art theme consistently (`.font-pixel`, `.cyber-button`, `.cyber-gradient`, Press Start 2P headings).
- **`sonner` is the real toast system**; `components/ui/toast.tsx` + a shadcn `useToast` hook + `<Toaster/>` (Radix-based) formed a second, fully-unwired toast implementation that was never rendered anywhere — removed during this cleanup (see report).
- **`next-themes`/`ThemeProvider`** is a dependency and `components/theme-provider.tsx` exists, but nothing mounts it — `components/ui/sonner.tsx` calls `useTheme()` without a provider in the tree, so it silently falls back to system/default theme. Left as-is (out of this cleanup's scope).
- **React Query is provisioned but idle.** `QueryClientProvider` wraps the app, but no page currently uses `useQuery`/`useMutation` — all data fetching is manual `fetch` + `useState`. Worth knowing if you're about to add a new data-fetching page: there's no established react-query pattern to follow yet, despite the dependency being there.
- **Duel status machine**: `OPEN → (MATCHED/LIVE) → SETTLING → SETTLED`, with `EXPIRED`/`CANCELLED` as terminal non-happy-paths and `HELD` as a manual-review hold (e.g. suspected same-wallet sybil on both sides). `duels/[id]/page.tsx` is the canonical place this is all branched on.
