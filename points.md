# Points

Every place in this codebase that hands out "points," what triggers it, how much, and whether it can be farmed. Read this alongside `Referral.md` (referral commissions and referral-specific point checkpoints); this doc covers the full picture, including the parts `Referral.md` doesn't: duel points and the separate genesis airdrop system.

There are **two entirely separate points ledgers** that happen to share the word "points." Mixing them up is the easiest way to misread this system, so it gets its own section before anything else.

## 1. Two separate ledgers

| | Combat points | Genesis airdrop points |
|---|---|---|
| Stored where | `CombatRecord.totalPoints` (MongoDB, one doc per wallet) | Nowhere. Computed live on every request by `lib/airdrop.ts::getAirdropProgress()` |
| Lifetime or pre-launch | Lifetime, ongoing after launch | Pre-launch only, for the genesis token distribution |
| Drives | Tier (Bronze/Silver/Gold/Diamond), leaderboard rank, eventual point redemption | Nothing yet except its own display on `/airdrop`; no snapshot/freeze mechanism exists |
| Can go up forever | Yes | Its own task points are capped (9 tasks, each one-time), but it also **folds in** the live `combatPoints` total (see §3.5), so the grand total keeps moving even after every task is done |

If you're asked "how many points does a wallet have," the honest answer is "which ledger": they are not the same number and are not meant to be added together outside of the airdrop total's own math.

## 2. Combat points (`CombatRecord.totalPoints`)

### 2.1 Duel settlement: the main source

Every settled duel awards points to both sides. Formula lives in `packages/points/src/pointsEngine.ts::computeMatchPoints`, config in `packages/points/src/config.ts::POINTS_CONFIG`:

```
POINTS_CONFIG = {
  basePoints: 100,
  loserFlatRate: 0.25,
  stakeMultiplierPer100Usd: 1,
  stakeMultiplierCap: 10,
  marginMultiplierCap: 3,
}
```

- **Winner points** = `basePoints x stakeMultiplier x marginMultiplier`
  - `stakeMultiplier` = `buyInUsd / 100`, clamped to `[1, 10]` (so a $1,000+ duel maxes it out at 10x, a duel under $100 still gets 1x)
  - `marginMultiplier` = `1 + marginGap / 100`, clamped to `[1, 3]`, where `marginGap` is how much further the winner's token ran than the loser's (`max(0, winnerReturnPct - loserReturnPct)`)
- **Loser points** = `basePoints x loserFlatRate` = **25, flat, always**. Losing never scales with stake or margin, it's a fixed participation reward.

Worked examples:

| Buy-in | Winner return | Loser return | Winner points | Loser points |
|---|---|---|---|---|
| $50 | +10% | +10% (tie margin) | 100 x 1 x 1 = **100** | **25** |
| $200 | +40% | +5% | 100 x 2 x 1.35 = **270** | **25** |
| $1,500 (capped at 10x) | +180% | +0% | 100 x 10 x 3 (capped) = **3,000** | **25** |

Triggered from `lib/duelEngine.ts::finalizeSettlement()`, which is called from exactly two places:
- `maybeSettle()` for a **legacy off-chain-only duel** (no `escrowAddress`): points land the instant the duel settles.
- `app/api/duels/[id]/confirm-settlement/route.ts` for a **real on-chain duel**: points only land after the actual `settle()` transaction is confirmed on-chain. Nothing is credited off-chain based on a signed-but-unsubmitted settlement.

Both sides also get their `wins`/`losses`/`currentStreak`/`recentOpponents` updated in the same call (`lib/duelEngine.ts::applyPoints`), regardless of whether the points themselves get blocked by the gate below.

### 2.2 Opponent-diversity anti-farm gate

Before a match's points count, `lib/duelEngine.ts::applyPoints` checks `@mcapduel/points`'s `isPointsEligible()` (`packages/points/src/opponentDiversity.ts`), config in `OPPONENT_DIVERSITY_CONFIG`:

```
maxShareOfWindow: 0.2        // no single opponent > 20% of your points-eligible matches
rollingWindowSize: 50        // ...in your last 50 matches
minWindowSizeToEnforce: 5    // below 5 total matches, everyone is eligible (too small a sample to mean anything)
```

If a wallet's most recent opponent has already shown up in more than 20% of the last 50 points-eligible matches, **this match's points are skipped**, but the duel still settles and pays out funds exactly as normal. This only ever gates points, never money. It exists to stop two wallets from dueling each other on repeat purely to farm points.

### 2.3 Referral checkpoint bonuses: flat, one-time, never gated

Separate from per-match points: settling a duel also bumps both players' own lifetime settled volume (`ReferralAccount.cumulativeSettledVolumeUsd`), and if that volume crosses a fixed checkpoint, a flat point bonus lands straight in `CombatRecord.totalPoints` via `lib/duelEngine.ts::awardFlatPoints` (see `lib/referralAccount.ts::applyReferralSettlement`, full flow in `Referral.md` §4.4). These are **not** gated by opponent-diversity (a milestone about your own cumulative betting, not about who you played), and each one fires **at most once per wallet, ever**, tracked in `ReferralAccount.volumeCheckpointsHit` / `earningsCheckpointsHit`.

**Volume checkpoints** (your own cumulative settled bet volume), `REFERRAL_VOLUME_CHECKPOINTS` in `packages/points/src/config.ts`:

| Your settled volume crosses | Points |
|---|---|
| $50 | +250 |
| $250 | +2,500 |
| $750 | +15,000 |
| $1,500 | +45,000 |
| $3,000 | +150,000 |

**Earnings checkpoints** (your cumulative *referral commissions earned*, real dollars paid via `BattleEscrow.settle()`), `REFERRAL_EARNINGS_CHECKPOINTS`:

| Your referral earnings cross | Points |
|---|---|
| $100 | +10,000 |
| $200 | +40,000 |
| $300 | +90,000 |
| $400 | +160,000 |
| $500 | +250,000 |

Only settled **on-chain** duels credit these (`duel.escrowAddress` must be set); a legacy off-chain duel never actually paid anyone a real commission, so crediting a checkpoint from one would be a phantom number. Same restriction as the referral earnings themselves.

These checkpoint values are why `CombatRecordNFT.sol`'s tier thresholds were raised (see §2.4): a single top checkpoint (250,000) would otherwise blow through the old tier ceiling on its own.

### 2.4 What reads `CombatRecord.totalPoints`

| Consumer | What it does |
|---|---|
| `packages/points/src/pointsEngine.ts::tierForPoints` | Bronze (0) / Silver (15,000) / Gold (100,000) / Diamond (500,000). Mirrored by hand in `Contracts/src/rewards/CombatRecordNFT.sol`'s `tierOf()`; must be kept in sync manually, there's no shared source. |
| `app/api/leaderboard/route.ts` | Ranks every `CombatRecord` by `totalPoints` descending, attaches each wallet's tier. |
| `app/api/combat-record/[wallet]/route.ts` | Powers the Profile page. `availablePoints = totalPoints - redeemedPoints`. |
| `lib/airdrop.ts::getAirdropProgress` | Folds the whole `totalPoints` value into the airdrop grand total as `combatPoints`, see §3.5. |
| `redeemedPoints` field | Exists on the schema and is *read* (above), but **nothing currently increments it**. There is no redemption flow wired up yet, matching `RedemptionVault.sol` being undeployed (see the `points_stays_offchain` decision: DB is the system of record for now, on-chain redemption is a deliberately deferred later step). |

## 3. Genesis airdrop points (pre-launch, separate ledger)

Everything here is computed fresh on every request by `lib/airdrop.ts::getAirdropProgress()`. Nothing about it is stored as a running total (except the one self-reported claim collection below). Task catalogue lives in `lib/airdropConfig.ts::AIRDROP_TASKS`.

### 3.1 Onboarding tasks

| Task | Points | Verified by |
|---|---|---|
| Connect a wallet | 50 | Wallet is connected client-side (`connect-wallet` is `done` the instant a wallet address exists) |
| Verify & claim day-one pass | 250 | A signed message proving wallet ownership (`WhitelistEntry.walletVerified`) |

### 3.2 Social tasks: self-reported, claim-gated

| Task | Points | How it's claimed |
|---|---|---|
| Follow UTD on X | 75 | User clicks "Open," then "Claim," via `POST /api/airdrop/claim` |
| Join the Telegram | 75 | Same |
| Post your invite link on X | 100 | Same |

These can't be verified against a real API, so they're self-reported. The abuse surface is capped two ways: `app/api/airdrop/claim/route.ts` requires `WhitelistEntry.walletVerified` (one real signed wallet per claim), and `AirdropClaim`'s compound unique index on `(wallet, taskId)` makes a repeat claim a no-op instead of double points. Each social task also only shows as claimable once its link is configured (`isSocialTaskEnabled`: `follow-x`/`join-telegram` need `NEXT_PUBLIC_UTD_X_URL`/`NEXT_PUBLIC_UTD_TELEGRAM_URL` set; `post-x` has no such gate).

### 3.3 Arena tasks: derived live from real data, nothing to claim

| Task | Points | Condition |
|---|---|---|
| Fight your first duel | 300 | `wins + losses >= 1` |
| Win a duel | 500 | `wins >= 1` |
| Fight 5 duels | 1,000 | `wins + losses >= 5` (progress bar shows `current/5`) |
| Reach Silver tier | 1,500 | `combatPoints >= 15,000` (progress bar shows `current/15,000`) |

**These are all verified straight from `CombatRecord`**, so they inherit whatever `finalizeSettlement` already wrote. No separate award logic.

> **Fixed:** "Reach Silver tier" previously checked `combatPoints >= 5,000` (`lib/airdropConfig.ts`'s `target: 5000`), stale against the real Silver threshold (`tierForPoints`, §2.4) of **15,000**, which had been raised after this task was written. `airdropConfig.ts`'s `target` (and its description copy) and `lib/airdrop.ts`'s fallback default are now both `15000`, matching `tierForPoints`.

### 3.4 Referral genesis points: decaying, separate from §2.3's checkpoints

A **different** formula from the referral volume/earnings checkpoints in §2.3. This one rewards the pre-launch act of *bringing in a verified signup*, not settled betting volume. Lives in `lib/referralPoints.ts`:

```
REFERRAL_POINTS_CONFIG = { basePoints: 100, decayRate: 0.85, minPoints: 10 }
pointsForReferralIndex(n) = max(round(basePoints * decayRate^(n-1)), minPoints)
```

So a wallet's 1st verified referral is worth 100, 2nd about 85, 3rd about 72, decaying toward a 10-point floor. Diminishing returns per referrer, rewarding organic sharing over mass farming while never dropping to zero. `lib/referralStats.ts::getReferralStats()` sums `pointsForReferralIndex(1..count)` for the total. Only counts a referral that is `walletVerified: true` and not `referralSybilFlagged` (`WhitelistEntry`, `@mcapduel/risk`'s IP-clustering check).

This is the number shown as "Referrals" in the airdrop hero's point breakdown, and in the old "Invite friends" card (now removed from `/airdrop`, see the referral dashboard redesign). The `/referrals` page's commission ladder and checkpoints (§2.3) are unrelated to this number.

### 3.5 The grand total

```
AirdropProgress.totalPoints = taskPoints + referral.points + combatPoints
```

Where `taskPoints` is the sum of every `done` task above (§3.1-3.3), `referral.points` is §3.4's decaying genesis-referral total, and `combatPoints` is simply `CombatRecord.totalPoints` read wholesale (§2). This means the airdrop total is **not a fixed pre-launch pool**: it keeps climbing after every duel settled and every referral checkpoint hit, forever, because it's re-reading the live combat ledger on every request. If the intent is to snapshot genesis allocations at a fixed point (e.g. token generation event), nothing here does that yet; it would need an explicit freeze/snapshot step.

## 4. Every point-awarding event, at a glance

| Event | Ledger | Amount | One-time? | Gated by | Code |
|---|---|---|---|---|---|
| Duel win | Combat | `100 x stakeMult x marginMult` (up to 3,000) | No, every settled win | Opponent-diversity (20%/50) | `pointsEngine.ts::computeMatchPoints`, `duelEngine.ts::finalizeSettlement` |
| Duel loss | Combat | 25 flat | No, every settled loss | Opponent-diversity (20%/50) | Same |
| Own volume checkpoint | Combat | 250 to 150,000 (5 tiers) | Yes, per wallet | On-chain duel only | `referralEngine.ts::crossedVolumeCheckpoints`, `referralAccount.ts::applyReferralSettlement` |
| Referral earnings checkpoint | Combat | 10,000 to 250,000 (5 tiers) | Yes, per wallet | On-chain duel only | `referralEngine.ts::crossedEarningsCheckpoints`, same |
| Connect wallet | Airdrop | 50 | Yes | None | `airdrop.ts::getAirdropProgress` |
| Verify wallet | Airdrop | 250 | Yes | Signed-message verification | Same |
| Follow X / Join Telegram / Post on X | Airdrop | 75 / 75 / 100 | Yes, each | Verified wallet + self-reported claim | `app/api/airdrop/claim/route.ts` |
| First duel / First win / 5 duels / Reach "Silver" | Airdrop | 300 / 500 / 1,000 / 1,500 | Yes, each | Derived from `CombatRecord` | `airdrop.ts::getAirdropProgress` |
| Verified referral (genesis, decaying) | Airdrop | 100 down to a 10 floor, per invite | Yes, per invite | Verified + non-sybil | `referralPoints.ts`, `referralStats.ts` |

## 5. Open items

- **`redeemedPoints` is inert**: read by the Profile API, never written by anything. No redemption flow exists yet (consistent with `RedemptionVault.sol` being undeployed; see the `points_stays_offchain` decision).
- **No airdrop snapshot mechanism** (§3.5): the genesis total keeps moving indefinitely since it re-reads live combat points on every request.
- **Two unrelated "referral points" concepts share the word "points"**: §2.3's checkpoint bonuses (land in `CombatRecord.totalPoints`, triggered by settled on-chain volume/earnings) versus §3.4's decaying genesis points (land only in the airdrop's live total, triggered by verified signups). They use the same referral code/link but are otherwise independent systems with independent formulas.
