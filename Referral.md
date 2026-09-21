# UTD Referral System

This document explains the referral/commission system end to end: the economics, the on-chain
mechanics, the backend pipeline that drives it, and everything it writes to the database. It
assumes familiarity with the base duel flow ([`README.md`](README.md),
[`Contracts/README.md`](Contracts/README.md)) — this system is layered on top of
`BattleEscrow.settle()`, not a separate product. See also [`Points.md`](Points.md) for the point
checkpoints this system feeds into, and duel points that live entirely outside it.

## Contents

- [1. What it is, in one paragraph](#1-what-it-is-in-one-paragraph)
- [2. Economics](#2-economics)
- [3. On-chain layer](#3-on-chain-layer)
- [4. Backend flow](#4-backend-flow)
- [5. Database schema](#5-database-schema)
- [6. Configuration — where to change each number](#6-configuration--where-to-change-each-number)
- [7. Open items / not yet built](#7-open-items--not-yet-built)

## 1. What it is, in one paragraph

Every wallet can refer other wallets. A referrer's commission rate is driven entirely by their
**own** cumulative settled duel volume (never their referrals' volume) — the more a referrer
personally plays, the higher a cut they earn on every bet their referrals settle. That commission
is paid **on-chain, atomically, in the same `settle()` transaction** that pays the winner — there
is no separate claim step and no custodial holding period. Two point ladders run alongside this,
both feeding the existing `CombatRecord`/`CombatRecordNFT` points ledger: one for a referred
player's own cumulative volume, one for a referrer's cumulative referral earnings.

## 2. Economics

### 2.1 Payout split (per duel)

The winner's share is **fixed at 90%** of the pot regardless of referrals. The remaining 10% is
where referrals live:

- Each player's own referrer (if any) earns a commission on **that player's stake**, at a rate
  determined by the referrer's own tier (see 2.2). This applies **win or lose** — a referrer earns
  the same cut whether their referral won or lost the duel.
- The referrer's cut is capped at **5% of their referred player's stake**, which — since both
  players stake the same amount — is exactly **2.5% of the total pot**. Two referred players, both
  referrers at the top tier, take **5% of the pot combined** (the "worst case" from the original
  spec).
- The platform gets whatever's left: **5% of the pot** in the worst case (both sides referred, both
  referrers maxed), up to **10%** when neither player has a referrer.

Worked example, $200 pot ($100 each):

| Referral situation | Winner | Referrer A | Referrer B | Platform |
|---|---|---|---|---|
| No referrers | $180 | — | — | $20 |
| Only side A referred, top tier (5%) | $180 | $5 | — | $15 |
| Both sides referred, both top tier (5%) | $180 | $5 | $5 | $10 |

### 2.2 Referral commission tiers

A referrer's rate is looked up from their own cumulative settled volume **at the moment their
referral's bet settles** — crossing a threshold takes effect on the *next* settled bet, never
retroactively:

| Referrer's own cumulative volume | Commission rate |
|---|---|
| $0 – $100 | 1% |
| >$100 – $500 | 2% |
| >$500 – $1,000 | 3% |
| >$1,000 – $2,000 | 4% |
| >$2,000 (extends past the spec's stated $5,000 top bracket) | 5% |

Boundaries are **exclusive on the low end** — a referrer sitting at exactly $100 stays at 1%; only
volume *strictly above* $100 promotes them to 2%. This matches the source spec verbatim ("at
exactly $100 they remain at 1%").

Source of truth: `FE/packages/points/src/config.ts` (`REFERRAL_TIER_CONFIG`) and
`referralTierBpsForVolume()` in `FE/packages/points/src/referralEngine.ts`.

### 2.3 Point checkpoints (one-time, per wallet, ever)

Two independent ladders, both landing in the same `CombatRecord.totalPoints` lifetime total that
drives `CombatRecordNFT`'s tier (full detail, including duel-settlement points that are unrelated
to referrals, in [`Points.md`](Points.md)):

**Referred player's own cumulative bet volume** (rewards playing, regardless of referring anyone):

| Cumulative volume | Points (one-time) |
|---|---|
| $50 | 250 |
| $250 | 2,500 |
| $750 | 15,000 |
| $1,500 | 45,000 |
| $3,000 | 150,000 |

**Referrer's cumulative referral earnings** (real dollars actually paid out to them as commission):

| Cumulative earnings | Points (one-time) |
|---|---|
| $100 | 10,000 |
| $200 | 40,000 |
| $300 | 90,000 |
| $400 | 160,000 |
| $500 | 250,000 |

Each checkpoint fires **exactly once per wallet, ever** — crossing it twice (e.g. volume dips
conceptually can't happen since volume only ever increases, but the guard exists regardless) never
double-pays. Source of truth: `REFERRAL_VOLUME_CHECKPOINTS` / `REFERRAL_EARNINGS_CHECKPOINTS` in
`FE/packages/points/src/config.ts`; the crossing logic is `crossedVolumeCheckpoints()` /
`crossedEarningsCheckpoints()` in `referralEngine.ts`.

**Why the `CombatRecordNFT` tier thresholds changed:** a single top-tier referral-earnings
checkpoint (250,000 points) dwarfs the original Diamond threshold (100,000 lifetime points), so
thresholds moved to Bronze 0 / Silver 15,000 / Gold 100,000 / Diamond 500,000
(`FE/packages/points/src/pointsEngine.ts`'s `TIER_THRESHOLDS`, mirrored by hand in
`Contracts/src/rewards/CombatRecordNFT.sol`'s `tierOf()`). This is a first-pass number, easy to
retune later — it's just those two places plus `RedemptionVault`'s owner-settable
`setTierCap` (already configurable, no code change needed there).

## 3. On-chain layer

### 3.1 `BattleEscrow.settle()` — the signature

```solidity
function settle(
    uint8 _winnerSide,
    address _referrerA,      // creator's referrer, or address(0) if none
    uint256 _referrerABps,   // creator's referrer's current tier rate, in bps
    address _referrerB,      // opponent's referrer, or address(0) if none
    uint256 _referrerBBps,   // opponent's referrer's current tier rate, in bps
    bytes calldata signature
) external
```

`_referrerA`/`_referrerABps` always correspond to the **creator's side**, `_referrerB`/`_referrerBBps`
to the **opponent's side** — regardless of who actually won. This is the same convention the
backend uses when it resolves referrers (§4).

**Signed message** (what the oracle signs and what `settle()` verifies):

```
keccak256(abi.encodePacked(
    address(this),   // this escrow clone
    _winnerSide,
    _referrerA, _referrerABps, _referrerB, _referrerBBps,
    block.chainid
))
```

Because the referrer terms are folded into the signed message itself, nobody can take a validly
signed settlement and redirect the referral cut by supplying different referrer arguments when
they submit the transaction — a mismatch just fails signature verification
(`test_settleRejectsMismatchedReferrerArgs` in `Contracts/test/duel/BattleEscrow_Adversarial.t.sol`).

**On-chain payout math** (`_computeSettlementAmounts` in `BattleEscrow.sol`):

```
pot              = buyIn * 2
winnerAmount     = pot * winnerBps / 10000              // winnerBps read live from the factory
referrerAAmount  = _referrerA == 0 ? 0 : buyIn * _referrerABps / 10000
referrerBAmount  = _referrerB == 0 ? 0 : buyIn * _referrerBBps / 10000
platformAmount   = pot - winnerAmount - referrerAAmount - referrerBAmount
```

Two on-chain invariants are enforced **regardless of what the signed payload claims**, so a
compromised or malicious oracle key is bounded by these no matter what:

- `_referrerABps`/`_referrerBBps` can never exceed `factory.maxReferrerBps()` (reverts
  `"referrer A/B rate too high"` otherwise).
- `winnerAmount` is always exactly `pot * factory.winnerBps() / 10000` — the winner's cut is never
  something the oracle can shortchange; only the platform-vs-referrer split within the remainder
  is trust-dependent.

The `Settled` event carries the full breakdown: `Settled(winnerSide, winner, winnerAmount,
platformAmount, referrerA, referrerAAmount, referrerB, referrerBAmount)`.

### 3.2 Fee/bounds configuration — no redeploy needed

`winnerBps`, `maxReferrerBps`, `minBuyIn`, and `maxBuyIn` all live as **owner-settable state on
`BattleEscrowFactory`**, not as constants baked into `BattleEscrow`. `BattleEscrow.settle()` reads
`winnerBps`/`maxReferrerBps` live from the factory (`IBattleEscrowFactory(factory).winnerBps()`)
at the moment each duel settles — the same pattern already used for `platformTreasury()` and
`paused()`. This means:

- Changing the platform's fee split, or the buy-in bounds, is **one owner transaction** on the
  already-deployed factory — no new `BattleEscrow` implementation, no new factory, no migration of
  in-flight duels.
- A duel that's already `Active` when the owner calls `setWinnerBps` picks up the **new** rate at
  its own settlement time (there's no per-duel snapshot of the fee split — only the referral terms
  are snapshotted, see §4).

| Setter | Bounds enforced | Notes |
|---|---|---|
| `setWinnerBps(uint256)` | `>= MIN_WINNER_BPS` (8000 = 80%) and `winnerBps + maxReferrerBps <= 10000` | Floored so a malicious owner can never zero out the winner's payout |
| `setMaxReferrerBps(uint256)` | `<= MAX_REFERRER_BPS_CEILING` (1000 = 10%, i.e. 5% of the pot) and `winnerBps + maxReferrerBps <= 10000` | Prevents settle()'s pot subtraction from ever underflowing |
| `setMinBuyIn(uint256)` | `> 0` and `<= maxBuyIn` (if a max is set) | Already existed before the referral system |
| `setMaxBuyIn(uint256)` | `== 0` (uncapped) or `>= minBuyIn` | `0` is the default (uncapped) |

All four are **instant**, not timelocked — same trust-model reasoning the contract already applies
to `platformTreasury`: these retune the fee split's *economics*, they never redirect who wins a
specific duel or move a specific player's funds (unlike `oracleSigner`, which *is* timelocked,
because rotating it changes who can produce a valid settlement signature for every future duel).

Defaults on a fresh deploy: `winnerBps = 9000` (90%), `maxReferrerBps = 500` (5%), `maxBuyIn = 0`
(uncapped).

### 3.3 What still requires a redeploy

The referral system **changed `settle()`'s function signature and its signed-message shape**, and
`BattleEscrowFactory.escrowImplementation` is `immutable` (set once at construction). So getting
this live on a chain that already has an older 2-argument `settle()` deployed requires:

1. Deploy a new `BattleEscrow` implementation (this code).
2. Deploy a new `BattleEscrowFactory` pointed at it.
3. Update `NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS` in the FE environment.
4. All three steps happen together — the FE's ABI (`FE/abis/BattleEscrow.json`,
   `FE/abis/BattleEscrowFactory.json`) must never be pointed at the *old* deployed factory, or every
   call encodes arguments the live contract doesn't expect.

The currently-deployed factory (see [`Contracts/README.md`](Contracts/README.md#deployments))
already runs this referral-aware `settle()`. Duels settled or in-flight against any superseded
factory are unaffected and keep working under whatever rules they were activated under until that
factory is retired.

## 4. Backend flow

### 4.1 Referral link creation and attribution

There's no separate "referral system" database table for links — the system reuses
`WhitelistEntry` (`FE/lib/models/WhitelistEntry.ts`), originally built for the pre-launch
whitelist signup, extended to also serve as the live attribution source:

- Every wallet gets a `referralCode` (7-character, ambiguity-free alphabet — see
  `FE/lib/referralCode.ts`) once it has one of these entries.
- `referredBy` stores the **referrer's `referralCode`** (not their wallet address) — permanent,
  first-touch: once set, it is never overwritten, even by a different code on a later visit.
- The client persists whichever `?ref=CODE` it last saw in `localStorage`/a cookie
  (`FE/lib/referralClient.ts`'s `getStoredRef()`/`saveRefToStorage()`), for up to 30 days. A global
  `<ReferralTracker/>` component (`FE/components/ReferralTracker.tsx`) fires `getStoredRef()` once
  on mount so the code is captured the moment someone lands on the site, before any wallet connects.

`FE/lib/referralAttribution.ts`'s `attributeReferral(wallet, refCode)` is called from
`POST /api/duels` (create) and `POST /api/duels/[id]/join` (join) — the two places a wallet does
something real for the first time. It:

1. Looks up an existing `WhitelistEntry` for the wallet.
2. If none exists, creates one (`kind: 'wallet'`, `walletVerified: true` — this wallet already
   signed a real on-chain transaction to get here, so no separate signature-nonce flow is needed),
   generates it a `referralCode`, and sets `referredBy` from the client's stored ref code if it
   resolves to a real, non-self referrer.
3. If an entry exists but has no `referredBy` yet, attaches one from the current request's ref
   code (same validity checks). If it already has one, nothing changes.

This never blocks or throws into the caller — attribution is a best-effort side effect, logged on
failure, never a reason a duel creation/join fails.

### 4.2 Resolving a referrer and their current tier

`FE/lib/referralAccount.ts`:

- `getReferrerWallet(wallet)` — follows `WhitelistEntry.referredBy` (a code) back to the entry that
  owns it, returns that entry's wallet. Returns `undefined` if never referred, or if the code
  doesn't resolve to anyone (stale/deleted).
- `currentReferrerBps(referrerWallet)` — reads (or lazily creates) that wallet's `ReferralAccount`
  and runs its `cumulativeSettledVolumeUsd` through `referralTierBpsForVolume()`. A referrer with no
  `ReferralAccount` yet still resolves to the bottom tier (1%), matching "$0–$100 → 1%".
- `computeReferralSnapshot(creatorWallet, opponentWallet)` — resolves both sides in one call,
  returning `{ creatorReferrerWallet?, creatorReferrerBps, opponentReferrerWallet?, opponentReferrerBps }`.

### 4.3 Settlement — where the snapshot gets locked in

This is the critical sequencing point, in `FE/lib/duelEngine.ts`:

1. **`maybeSettle()`** (fires once a `LIVE` duel's timer has elapsed, and the sybil check has
   cleared): for an on-chain duel, calls `computeReferralSnapshot()` **before** signing, stores the
   result onto the `Duel` document (`creatorReferrerWallet`, `creatorReferrerBps`,
   `opponentReferrerWallet`, `opponentReferrerBps`), then calls `signSettlement()` with those exact
   terms. The signature, the snapshot, and what eventually gets paid on-chain are now all
   guaranteed to agree — nothing downstream ever recomputes a referrer's tier and assumes it still
   matches what was signed.
2. **`retrySettlementSigning()`** (repairs a duel stuck at `SETTLING` with no signature, e.g. after
   a transient signer failure): recomputes the snapshot fresh, since nothing was persisted from the
   failed attempt. This is safe — no signature was ever successfully produced against a stale
   snapshot, so there's nothing to be inconsistent with.
3. **`settlementRelayer.ts`** (the backend keeper that submits the actual `settle()` transaction)
   and the frontend's manual "claim" button (`duels/[id]/page.tsx`) both read the **already
   persisted** `creatorReferrerWallet`/`creatorReferrerBps`/`opponentReferrerWallet`/
   `opponentReferrerBps` off the `Duel` document and pass them as `settle()`'s arguments — never
   recomputed at this point.
4. Once the transaction is confirmed (`confirmOnChainSettlement`, via either the relayer or
   `POST /api/duels/[id]/confirm-settlement`), **`finalizeSettlement()`** runs. After the existing
   win/loss points logic, if the duel has an `escrowAddress` (i.e. it's a real on-chain duel — see
   why this gate matters below), it calls `applyReferralSettlement()`.

### 4.4 `applyReferralSettlement()` — the off-chain bookkeeping

`FE/lib/referralAccount.ts`. For **each side** (creator, opponent) independently:

1. **Bump that player's own volume.** `ReferralAccount.cumulativeSettledVolumeUsd += buyInUsd` —
   this happens whether they won or lost, and is what determines *their own* tier the next time
   *they* refer someone.
2. **Award volume checkpoints.** Any `REFERRAL_VOLUME_CHECKPOINTS` newly crossed by that bump get
   added to `CombatRecord.totalPoints` (via `awardFlatPoints`, a flat lifetime-total addition — not
   gated by the opponent-diversity anti-farm rule that normal win/loss points use, since a
   checkpoint can only ever fire once per wallet regardless of opponent).
3. **If that side had a referrer and a nonzero `referrerBps` was actually paid on-chain**: credit
   `commissionUsd = buyInUsd * referrerBps / 10000` to the referrer's
   `cumulativeReferralEarningsUsd`, and award any newly-crossed `REFERRAL_EARNINGS_CHECKPOINTS`.

**Why this is gated behind `escrowAddress`:** a legacy off-chain-only duel (predating on-chain
integration) never actually pays a referrer anything real — there's no `settle()` transaction to
pay it. Crediting referral earnings for one would be a phantom, unbacked number. Volume/points for
the players themselves are similarly scoped to on-chain duels only, for consistency (in practice
essentially all duels are on-chain going forward).

Idempotency: `finalizeSettlement()` is only ever reached once per duel (the `SETTLING → SETTLED`
transition is an atomic compare-and-swap — see `confirmOnChainSettlement`'s own doc comment), so
`applyReferralSettlement` never double-runs for the same settlement.

## 5. Database schema

### 5.1 `ReferralAccount` (`FE/lib/models/ReferralAccount.ts`)

One document per wallet that has ever settled a duel, whether or not it has ever referred anyone
(volume tracking has to start somewhere).

| Field | Type | Meaning |
|---|---|---|
| `wallet` | string, unique, lowercase | The account's own wallet |
| `cumulativeSettledVolumeUsd` | number | This wallet's own lifetime settled duel volume (its buyIn on every settled duel, win or lose). Drives `referralTierBpsForVolume` for this wallet **as a referrer**. |
| `cumulativeReferralEarningsUsd` | number | Real dollars this wallet has been credited as a **referrer**, via `BattleEscrow.settle()`'s `referrerA`/`referrerB` payout |
| `volumeCheckpointsHit` | string[] | Checkpoint ids already awarded from `REFERRAL_VOLUME_CHECKPOINTS`, e.g. `"volume:50"` — permanent, never re-awarded |
| `earningsCheckpointsHit` | string[] | Same, for `REFERRAL_EARNINGS_CHECKPOINTS`, e.g. `"earnings:100"` |

### 5.2 `WhitelistEntry` (`FE/lib/models/WhitelistEntry.ts` — existing model, extended role)

No schema change. Its role changed: `referredBy`/`referralCode` are no longer pre-launch-only —
`FE/lib/referralAttribution.ts` now also writes to this collection for any wallet that creates or
joins a live duel. Relevant fields:

| Field | Meaning |
|---|---|
| `identifier` | Lowercased wallet address (or email, for pre-launch-only entries) |
| `walletVerified` | True once the wallet has proven ownership — always true for entries created via `attributeReferral`, since that only ever runs after a real on-chain transaction |
| `referralCode` | This entry's own shareable code |
| `referredBy` | The `referralCode` of whoever referred this entry — permanent, first-touch |
| `referralSybilFlagged` | Pre-launch IP-clustering signal — **not currently re-checked by the live-duel referral path**; see §7 open items |

### 5.3 `Duel` (`FE/lib/models/Duel.ts` — existing model, referral-specific fields)

Snapshotted once, at signing time (`maybeSettle`/`retrySettlementSigning`), and reused verbatim
everywhere downstream — never recomputed after signing.

| Field | Type | Meaning |
|---|---|---|
| `creatorReferrerWallet` | string? | Creator's referrer wallet, if any, at the moment this duel was signed |
| `creatorReferrerBps` | number? | That referrer's tier rate at signing time |
| `opponentReferrerWallet` | string? | Opponent's referrer wallet, if any |
| `opponentReferrerBps` | number? | That referrer's tier rate at signing time |

### 5.4 `CombatRecord` (existing model, no schema change)

`totalPoints` also accumulates referral volume/earnings checkpoint bonuses (via `awardFlatPoints`
in `duelEngine.ts`), on top of the existing win/loss points. Nothing distinguishes a checkpoint
bonus from a match-result award in this ledger — they're the same number, by design (see the
tier-threshold discussion in §2.3, and full duel-points detail in [`Points.md`](Points.md)).

## 6. Configuration — where to change each number

| What | File | Notes |
|---|---|---|
| Referral tier bps table | `FE/packages/points/src/config.ts` → `REFERRAL_TIER_CONFIG` | `maxBps` **must** match `BattleEscrowFactory.maxReferrerBps()` — kept in sync by hand, same pattern as the tier-threshold duplication below |
| Volume/earnings checkpoint values | `FE/packages/points/src/config.ts` → `REFERRAL_VOLUME_CHECKPOINTS` / `REFERRAL_EARNINGS_CHECKPOINTS` | Off-chain only, no redeploy needed to change |
| `CombatRecordNFT` tier thresholds | `Contracts/src/rewards/CombatRecordNFT.sol`'s `tierOf()` **and** `FE/packages/points/src/pointsEngine.ts`'s `TIER_THRESHOLDS` | Two places, kept in sync by hand — must move together |
| `RedemptionVault` per-tier epoch caps | On-chain, owner-settable via `setTierCap` | No code change needed |
| Winner's fee split (`winnerBps`) | On-chain, owner-settable via `BattleEscrowFactory.setWinnerBps` | No redeploy — see §3.2 |
| Referral ceiling (`maxReferrerBps`) | On-chain, owner-settable via `BattleEscrowFactory.setMaxReferrerBps` | Must also update `REFERRAL_TIER_CONFIG.maxBps` off-chain to match, or the backend could sign a rate the contract then rejects |
| Buy-in bounds (`minBuyIn`/`maxBuyIn`) | On-chain, owner-settable via `BattleEscrowFactory.setMinBuyIn`/`setMaxBuyIn` | No redeploy |

## 7. Open items / not yet built

- **No dedicated per-duel referral breakdown in the UI.** The `/referrals` dashboard surfaces
  tier/volume/earnings/checkpoint progress (`ReferralAccount`, `WhitelistEntry` via
  `GET /api/referrals/[wallet]`), and duel screens show the correct 90%/10% split, but no screen
  yet shows a per-duel referral-cut line item.
- **`referralSybilFlagged` isn't re-checked for live commissions.** It's a pre-launch-specific
  IP-clustering signal (`FE/lib/whitelistSybil.ts`) computed at signup time; a wallet flagged there
  still earns real on-chain referral commissions today. Worth deciding whether that signal (or the
  main duel-settlement sybil check in `@mcapduel/risk`) should also gate referral payouts before
  this handles meaningful volume.
- **Tier thresholds are first-pass numbers.** Both the `CombatRecordNFT`/`pointsEngine.ts` tier
  scale and the exact checkpoint values came from the original spec verbatim; the *thresholds*
  were a judgment call made to keep the numbers coherent and are worth revisiting once real
  referral activity exists.

---

Related: [`README.md`](README.md) · [`Points.md`](Points.md) ·
[`Contracts/README.md`](Contracts/README.md)
