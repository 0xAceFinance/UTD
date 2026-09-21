# UTD Contracts (Underground Token Duel / "MCAP DUEL")

Foundry-based Solidity contracts for UTD, a gambling game: two players each
stake a stablecoin on which of two already-trading tokens will pump harder
during a time-boxed, buy-only "duel," backed by an on-chain escrow. Duel
outcomes are attested by an off-chain oracle, settlement pays the winner
directly from the escrow, and cumulative duel performance is tracked on-chain
as soulbound "Combat Record" points that convert into vested platform-token
rewards. This repo contains two independent subsystems: the duel escrow and
the points/rewards layer.

> This is a rewrite of a stale, pre-existing README (old project name
> "TugZone") that described this as a token-launchpad project and cited a
> contract address that is not reproducible from anything in this repo. The
> project is not a launchpad — the bonding-curve token-launch contracts
> (`TokenFactory`/`PumpToken`/`PumpPool`) that earlier existed in this repo
> have been removed as out of scope; tokens duelled here are discovered from
> the open market by the backend's `engine` package, not launched by this
> protocol. The only live deployment is the one listed under
> [Deployments](#deployments) below.

See [`../README.md`](../README.md) for the full product overview and how this
subsystem fits into the rest of the app, and [`../Referral.md`](../Referral.md)
for the referral commission mechanics layered on top of `BattleEscrow.settle()`
described in this doc.

## Deployments

### Robinhood Chain mainnet (chain id 4663)

Duel escrow system, deployed with `script/DeployDuel.s.sol`
(broadcast record: `broadcast/DeployDuel.s.sol/4663/run-latest.json`).
Duels last exactly 5, 10, 15 or 20 minutes; an unmatched lobby stays open for 5 minutes.

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| `BattleEscrowFactory` | [`0x65f58fA80dd62460980B14979f062F1E67D35Cff`](https://robinhoodchain.blockscout.com/address/0x65f58fA80dd62460980B14979f062F1E67D35Cff) | `0x45590d9bd416ca82a6b0ce8663ebef8ad1c945819795e3556e07b295037b5a37` | 67296858 |
| `BattleEscrow` (implementation) | [`0x42839837874979e50f019c5C23154578216fa72D`](https://robinhoodchain.blockscout.com/address/0x42839837874979e50f019c5C23154578216fa72D) | `0xe2cdc7a709af4fd9975a907ff8586a36274c9685f586eefe9aa850f7d72956b1` | 67296825 |

Both contracts are source-verified on Sourcify with an **exact match** (creation and
runtime bytecode, solc 0.8.30), which Blockscout also displays:
[factory](https://repo.sourcify.dev/4663/0x65f58fA80dd62460980B14979f062F1E67D35Cff),
[implementation](https://repo.sourcify.dev/4663/0x42839837874979e50f019c5C23154578216fa72D).
The chain's official explorer is Blockscout at `robinhoodchain.blockscout.com`.

**Superseded, do not use.** Both were replaced before any duel was created on them
(`allDuelsLength() == 0`):

| Deployment | Factory | Implementation | Why replaced |
|---|---|---|---|
| 1st (blocks 67027457-67027489) | `0x32aB0586A99e7b7246225689dD6847a77E1d946D` | `0x0400babC9C034bba510DDe52EB829F87739C5e41` | 15-40 min durations |
| 2nd (blocks 67283755-67283788) | `0xf56eED09448fE1C23009DA6D0f00DE1A927A862f` | `0x3F0F175EDBFb9688dC77ee0c6474030147784bCC` | 60 min open window |

Users interact with the factory only. Each duel is a minimal-proxy clone of the
implementation; the implementation itself is locked (`initialize()` reverts
"already initialized").

Factory configuration at deployment:

| Parameter | Value |
|---|---|
| `approvedStakeToken` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (USDG "Global Dollar", 6 decimals) |
| `minBuyIn` | `1000000` (1 USDG) |
| `oracleSigner` | `0xA5C09C06ED6887598e894b211F6dFE55FD80B4b4` |
| `platformTreasury` | `0x6d0c0Ac0b60B1BE2D60ad4e6AA868D2612fe4f89` |
| `owner` | `0x9b7016Fe0a8e0d97b0FC6C9Be8AB6b9Cc938651B` (deployer) |

The rewards layer (`CombatRecordNFT`, `RedemptionVault`) is not deployed yet.

## Architecture overview

```
Duel escrow (one clone per match, holds only the stake — not the tokens):

  creator --createDuel()--> BattleEscrowFactory --clones (EIP-1167)--> BattleEscrow
  opponent --joinDuel()--------------^                                     |
                                                                            | settle() verifies an
                                                              oracleSigner  | ECDSA signature from
                                                          platformTreasury  | BattleEscrowFactory,
                                                            winnerBps       | folding in each side's
                                                        maxReferrerBps      | referrer + tier rate
                                                                            v
                                        winner gets winnerBps of the pot (default 90%, floored at 80%),
                                     each referred player's referrer gets up to maxReferrerBps of that
                                    player's own stake (default ≤5%, win or lose), platformTreasury gets
                                                    whatever's left (10-20% in the common cases) —
                                                         the loser receives nothing directly.

Points / rewards (fed by the off-chain backend that watches duel settlements):

  backend pointsOracle --addPoints()--> CombatRecordNFT (soulbound ERC-721,
                                          lifetime points -> tier, 1 per wallet)
                                              |
                                              | availablePoints() / tierOf()
                                              v
  wallet --redeem()--> RedemptionVault --markRedeemed()--> CombatRecordNFT
                            |
                            | opens a linear vesting schedule (30-90 days)
                            v
  wallet --claim()--> RedemptionVault --pays out--> wallet (from a pre-funded
                                                       reward-token balance)
```

The two subsystems only touch each other through their own explicit wiring
(`BattleEscrowFactory` → `BattleEscrow`; `CombatRecordNFT` → `RedemptionVault`).
Nothing here reads token prices on-chain — which token "won" a duel is decided
off-chain by the backend/oracle and delivered to `BattleEscrow.settle()` as a
signature.

## Contracts

### `src/duel/IBattleEscrow.sol` / `src/duel/BattleEscrow.sol`

One instance per 1v1 duel, deployed as an EIP-1167 minimal-proxy clone by
`BattleEscrowFactory`. Holds exactly one match's stablecoin stake, isolated
from every other match. States: `Open -> Active -> Settled`, or `Open ->
Refunded` (via `cancel`/`expire`), or `Active -> Refunded` (via
`voidActive`/`refundStale`).

- `initialize(creator, stakeToken, buyIn, creatorSide, durationSeconds,
  tokenASymbol, tokenBSymbol) external` — callable exactly once per clone
  (guarded by `initialized`); asserts the creator's stake already landed in
  the clone (the factory transfers it in the same transaction), then opens a
  `MAX_OPEN_WINDOW = 5 minutes` matchmaking window.
- `joinTerms() external view returns (address stakeToken, uint256 buyIn)` —
  read by the factory so `joinDuel` knows how much to pull from the opponent.
- `activate(address opponent) external` — `onlyFactory`; requires the clone
  is still `Open`, within the open window, that the opponent isn't the
  creator, and that both stakes (`buyIn * 2`) are already in the contract.
  Sets `startTime = now`, `endTime = startTime + durationSeconds`.
- `cancel(address canceller) external` — `onlyFactory`; only the creator, and
  only while still `Open`, refunds the creator's stake in full.
- `expire() external` — **permissionless on purpose**: once the open window
  has passed with no opponent, anyone can trigger the same refund so a dead
  lobby doesn't get stuck waiting on the creator.
- `settle(uint8 winnerSide, address referrerA, uint256 referrerABps, address
  referrerB, uint256 referrerBBps, bytes calldata signature) external` — also
  **permissionless**. Requires `status == Active`, `block.timestamp >=
  endTime`, and the factory not paused; the actual authorization is an ECDSA
  signature over `keccak256(abi.encodePacked(address(this), winnerSide,
  referrerA, referrerABps, referrerB, referrerBBps, block.chainid))` that
  must recover to the signer snapshotted at `activate()` (chain ID is folded
  in so a signature from one chain can never settle a same-address duel on
  another; folding the referrer terms into the same signed message means
  nobody can redirect a referral cut by submitting different arguments than
  what was signed). `referrerA`/`referrerABps` is the **creator's** referrer
  and their current commission tier, `referrerB`/`referrerBBps` the
  **opponent's**; pass `address(0)` for a side with no referrer. Pays the
  winner the duel's snapshotted `winnerBps` of the pot (`buyIn * 2`, default
  90%, floored at 80% — see `BattleEscrowFactory.MIN_WINNER_BPS`), pays each
  referrer up to the snapshotted `maxReferrerBps` (default 5%) of their
  referred player's own stake regardless of who won, and sends whatever's
  left to the platform treasury. Two invariants hold regardless of what the
  signed payload claims: `winnerAmount` is always exactly `winnerBps` of the
  pot, and neither referrer rate can exceed `maxReferrerBps` — bounding what
  a compromised oracle key can do to just the platform/referrer split within
  the remainder. Full economics and worked examples:
  [`../Referral.md`](../Referral.md). This is the "if the keeper bot is down,
  anyone holding the signed result can still push settlement through"
  fallback.
- `voidActive(bytes calldata signature) external` — the HELD-match recovery
  path: refunds both stakes for an `Active` duel instead of settling it (e.g.
  a suspected-collusion flag from the backend's risk check, see
  `../risk/README.md`). Same signature scheme as `settle`, but over a
  sentinel `VOID_MARKER` value outside `settle`'s accepted 0/1 range, so the
  two message spaces never collide.
- `refundStale() external` — the last-resort recovery path, **no signature
  required**: once an `Active` duel has sat unsettled for
  `STALE_REFUND_GRACE_PERIOD` (24h) past `endTime`, anyone can refund both
  stakes. Covers what `settle`/`voidActive` can't: the oracle key is lost, or
  the winner's address is blacklisted by the stake token so `settle`'s
  transfer always reverts.

**Trust model:** the factory owner can rotate `platformTreasury` instantly,
but oracle signer rotation goes through a 24h timelock
(`proposeOracleSigner` → `executeOracleSignerRotation`) — rotating the
signer is real influence over every currently-Active duel's outcome, so a
compromised or malicious owner can't do it instantly and unnoticed. There is
still no owner withdrawal path anywhere in `BattleEscrow`; funds only ever
leave via `settle`, `voidActive`, `refundStale`, `cancel`, or `expire`.
Settlement correctness (short of the `refundStale` fallback) rests entirely
on the oracle signer's key being honest.

### `src/duel/IBattleEscrowFactory.sol` / `src/duel/BattleEscrowFactory.sol`

The single entry point users interact with to create, join, cancel, or expire
a duel; every match is a cheap `Clones.clone()` of one audited `BattleEscrow`
implementation.

- `createDuel(stakeToken, buyIn, creatorSide, durationSeconds, tokenASymbol,
  tokenBSymbol) external returns (address duel)` — validates `stakeToken ==
  approvedStakeToken` (the one stake token this factory accepts — blocks
  farming points with a self-minted worthless token, or a rebasing/fee-taking
  token that could leave payouts stuck), `creatorSide in {0,1}`, and
  `durationSeconds` is one of 5, 10, 15 or 20 minutes (`MIN_DURATION=5min`, `MAX_DURATION=20min`, `DURATION_STEP=5min`), clones the
  implementation, pulls the creator's stake straight into the new clone, then
  calls `initialize` on it. Registers the clone in `isDuel`.
- `joinDuel(address duel)` / `cancelDuel(address duel)` /
  `expireDuel(address duel)` — all require `isDuel[duel]` first (a duel must
  have actually been produced by `createDuel`, not an arbitrary address) —
  `joinDuel` reads `joinTerms()`, pulls the opponent's matching stake into the
  clone, calls `activate(msg.sender)`; the other two are thin pass-throughs to
  the clone plus a factory-level event.
- `proposeOracleSigner(address)` (`onlyOwner`) + `executeOracleSignerRotation()`
  (permissionless, after `ORACLE_SIGNER_TIMELOCK_DELAY = 24h`) — the two-step,
  timelocked oracle signer rotation (see trust model above).
- `setPlatformTreasury` / `setApprovedStakeToken` (`onlyOwner`, instant) — the
  owner can never move user funds directly.
- `setMinBuyIn` / `setMaxBuyIn` (`onlyOwner`, instant) — only ever change what
  future `createDuel()` calls accept; `maxBuyIn == 0` means uncapped (the
  default).
- `setWinnerBps(uint256)` (`onlyOwner`, instant, not timelocked) — the
  winner's share of the pot in bps, floored at `MIN_WINNER_BPS = 8000` (80%)
  and bounded so `winnerBps + maxReferrerBps <= 10000`. Each escrow
  snapshots `winnerBps` at `activate()`, so a retune only ever applies to
  duels activated after it — it can never reprice a duel already in flight.
- `setMaxReferrerBps(uint256)` (`onlyOwner`, instant) — the ceiling on either
  referrer's cut in bps of one player's stake, bounded by
  `MAX_REFERRER_BPS_CEILING = 1000` (10% of a stake = 5% of the pot) and the
  same `winnerBps + maxReferrerBps <= 10000` invariant. Snapshotted at
  `activate()` alongside `winnerBps`.
- `pause()` / `unpause()` (`onlyOwner`, instant) — emergency stop for a
  leaked or misbehaving oracle key, faster than the 24h signer timelock could
  react. While paused, no new duel can be created or joined, and every
  escrow refuses `settle()`/`voidActive()`. Exit paths stay open —
  `cancel`, `expire`, `refundStale`, and `withdraw` keep working, so a pause
  can at worst turn in-flight duels into refunds, never send funds anywhere
  they aren't owed.
- `renounceOwnership()` is overridden to always revert — ownership can be
  *transferred* (to a multisig) but never abandoned, since an ownerless
  factory could never unpause itself or rotate a leaked oracle signer.
- `allDuelsLength()` / `allDuels(i)` — enumeration of every duel ever created.

Defaults on a fresh deploy: `winnerBps = 9000` (90%), `maxReferrerBps = 500`
(5%), `maxBuyIn = 0` (uncapped). Changing any of `winnerBps`, `maxReferrerBps`,
`minBuyIn`, or `maxBuyIn` is a single owner transaction on the already-deployed
factory — no new implementation, no new factory, no migration of in-flight
duels. Full referral economics built on top of these: [`../Referral.md`](../Referral.md).

### `src/rewards/ICombatRecordNFT.sol` / `src/rewards/CombatRecordNFT.sol`

One soulbound ERC-721 per wallet, minted automatically on that wallet's first
points award, tracking lifetime points (which drives tier) separately from
how many of those points have been redeemed.

- `addPoints(address wallet, uint256 amount) external onlyPointsOracle` —
  mints the wallet's token on first call (`tokenIdOf[wallet] == 0`), then
  always adds to `totalPoints[wallet]` (a lifetime counter that never
  decreases).
- `markRedeemed(address wallet, uint256 amount) external onlyRedemptionVault`
  — increases `redeemedPoints[wallet]`; requires `availablePoints(wallet) >=
  amount` first. This only reduces *available* points, not lifetime
  `totalPoints`, so redeeming never demotes a wallet's tier.
- `availablePoints(wallet)` = `totalPoints[wallet] - redeemedPoints[wallet]`.
- `tierOf(wallet)` — Bronze (`<15,000`) / Silver (`>=15,000`) / Gold
  (`>=100,000`) / Diamond (`>=500,000`), based on lifetime `totalPoints`.
  Raised from an original 5,000/25,000/100,000 scale once referral checkpoint
  bonuses (up to 250,000 points in one shot — see
  [`../Referral.md`](../Referral.md)) started landing in this same
  lifetime-points total. The contract's own comment notes this must be kept
  in sync **by hand** with `FE/packages/points/src/pointsEngine.ts`'s
  `tierForPoints` in the backend — there is no shared source of truth between
  the two. Full detail: [`../Points.md`](../Points.md).
- `setPointsOracle` / `setRedemptionVault` (`onlyOwner`) — the two addresses
  that get elevated trust (`onlyPointsOracle`, `onlyRedemptionVault`).
- Soulbound enforcement is structural, not conventional: `_update` reverts on
  any transfer between two non-zero addresses, and `approve` /
  `setApprovalForAll` are both overridden to unconditionally revert.

### `src/rewards/RedemptionVault.sol`

The only path from points to the platform's reward token. Points convert at
an owner-adjustable rate, vest linearly rather than paying out immediately,
and are capped per wallet per epoch by tier, so payout stays predictable and
bounded regardless of how many points a wallet has banked.

- `redeem(uint256 pointsAmount) external nonReentrant` — checks
  `combatRecord.availablePoints(msg.sender) >= pointsAmount`, checks the
  wallet's tier-based cap for the current epoch (`block.timestamp /
  epochLengthSeconds`, default 1-day epochs; caps: Bronze 1,000 / Silver
  3,000 / Gold 8,000 / Diamond 20,000 points per epoch), calls
  `combatRecord.markRedeemed(...)`, then opens a new `VestingSchedule` for
  `pointsAmount * tokensPerPointWad` reward-token wei starting now.
- `claim() external nonReentrant` — sweeps whatever portion of *every* one of
  the caller's vesting schedules has vested so far (linear over
  `vestingDurationSeconds`, default 60 days, owner-adjustable within
  `[MIN_VESTING=30d, MAX_VESTING=90d]`) and transfers it out of the vault's
  own reward-token balance (a fixed, pre-funded pool — the vault never mints).
- `claimableAmount(wallet)` / `schedulesLength(wallet)` — view helpers.
- `setRate` / `setVestingDuration` / `setTierCap` (`onlyOwner`) — the vault
  owner tunes economics but, like `BattleEscrowFactory`, never has a direct
  withdrawal path for user-earned rewards.

## Duel lifecycle (end to end)

1. **Create.** The creator calls `BattleEscrowFactory.createDuel(stakeToken,
   buyIn, creatorSide, durationSeconds, tokenASymbol, tokenBSymbol)`. The
   factory clones the `BattleEscrow` implementation, pulls `buyIn` of
   `stakeToken` from the creator straight into the new clone, and initializes
   it (`status = Open`, a `MAX_OPEN_WINDOW = 5`-minute matchmaking window
   starts).
2. **Join.** An opponent calls `BattleEscrowFactory.joinDuel(duel)`. The
   factory reads `joinTerms()` off the clone, pulls the same `buyIn` from the
   opponent into the clone, then calls `activate(opponent)`, which flips the
   clone to `Active`, fixes `startTime`/`endTime = startTime +
   durationSeconds` (5, 10, 15 or 20 minutes, enforced at creation), and
   snapshots that duel's `settlementSigner`, `winnerBps`, `maxReferrerBps`,
   and `platformTreasury` from the factory's current values.
3. **No-match path.** If nobody joins before the 5-minute open window
   elapses, anyone can call `BattleEscrowFactory.expireDuel(duel)`
   (permissionless) to refund the creator and set `status = Refunded`.
   Before that window closes, only the creator can call
   `BattleEscrowFactory.cancelDuel(duel)` for the same refund.
4. **Live window.** Between `startTime` and `endTime`, the two tokens duel on
   the open market (buy-only; the escrow contract itself has no awareness of
   token prices or trading — it only holds stake, watching an off-chain
   oracle pipeline decide the winner — see [`../README.md`](../README.md#duel-lifecycle-end-to-end)).
5. **Oracle attestation.** After `endTime`, the backend's oracle determines
   the winning side and, resolving each side's current referrer and
   commission tier (if any), signs `keccak256(abi.encodePacked(duelAddress,
   winnerSide, referrerA, referrerABps, referrerB, referrerBBps,
   block.chainid))` with the signer this duel snapshotted at `activate()`.
6. **Settle.** Anyone (typically a backend keeper, but permissionlessly any
   address) calls `BattleEscrow.settle(winnerSide, referrerA, referrerABps,
   referrerB, referrerBBps, signature)` on the clone. The clone verifies the
   signature, pays the winner the duel's snapshotted `winnerBps` of the pot
   (default 90%), pays each referred player's referrer up to the snapshotted
   `maxReferrerBps` of that player's own stake (default ≤5% each, win or
   lose), sends whatever's left to `platformTreasury`, and sets
   `status = Settled`. The loser receives nothing directly. Full economics:
   [`../Referral.md`](../Referral.md).
7. **Points.** The backend's points logic (currently DB-only — see
   [`../Points.md`](../Points.md) — the on-chain path below is built but not
   yet wired up) would call `CombatRecordNFT.addPoints(wallet, amount)` for
   both sides, minting a soulbound Combat Record NFT on a wallet's first
   award and accumulating lifetime points that determine its tier.
8. **Redeem.** Once deployed, a wallet would call
   `RedemptionVault.redeem(pointsAmount)` (bounded by its tier's per-epoch
   cap), which marks those points redeemed on the NFT and opens a new linear
   vesting schedule for the reward-token equivalent.
9. **Claim.** A wallet would call `RedemptionVault.claim()` at any later
   point to collect whatever has vested so far, out of the vault's
   pre-funded reward-token balance.

## Tests

| Test file | Covers |
|---|---|
| `test/duel/BattleEscrow.t.sol` (+ `test/duel/MockERC20.sol` stand-in stake token) | `BattleEscrow` + `BattleEscrowFactory`: full settlement split (winner/referrer/platform, either side winning), creator cancel, permissionless expiry, "cannot duel yourself", oracle-signature validation (including a bad-key rejection), permissionless-but-signature-gated settlement, `onlyFactory` gating, double-initialize guard, duration bounds, `onlyOwner` config setters. |
| `test/duel/BattleEscrow_Adversarial.t.sol` | Hostile-token reentrancy (a stake token whose `transfer` calls back mid-transfer), and that a settlement signed for one set of referrer arguments can't be replayed with different ones (`test_settleRejectsMismatchedReferrerArgs`) — the guarantee referral payouts depend on. |
| `test/duel/BattleEscrow_Blacklist.t.sol` | A USDC-style stake token that can block an address from sending/receiving mid-flow — proves `_pay()`'s owed-balance fallback and `withdraw()` keep a blacklisted recipient from stalling every other party's payout. |
| `test/duel/BattleEscrowFactory_Adversarial.t.sol` | Factory-level trust boundaries: `joinDuel()`/`cancelDuel()`/`expireDuel()` against an address that was never actually produced by `createDuel()`, and similar hostile-input edge cases at the factory layer. |
| `test/duel/EmergencyPause.t.sol` | `pause()`/`unpause()`: blocks new/joining duels and every oracle-signed outcome while paused, while `cancel`/`expire`/`refundStale`/`withdraw` all keep working. |
| `test/rewards/CombatRecordNFT.t.sol` | `CombatRecordNFT`: mint-on-first-award, no duplicate mint on repeat awards, `onlyPointsOracle` gating, tier thresholds, soulbound transfer/approve reverts, `onlyRedemptionVault` gating, `markRedeemed` reducing *available* not *total* points. |
| `test/rewards/CombatRecordNFT_Adversarial.t.sol` | Additional adversarial coverage on the soulbound/access-control boundaries above. |
| `test/rewards/RedemptionVault.t.sol` | `RedemptionVault`: vesting-schedule creation at the configured rate, insufficient-points rejection, per-tier per-epoch cap and its reset on a new epoch, linear vesting math over time, `claim()` transferring and updating claimed amounts, concurrent independent schedules summing correctly, `onlyOwner` config gating, vesting-duration bounds. |
| `test/rewards/RedemptionVault_Adversarial.t.sol` | Additional adversarial coverage on redemption/vesting edge cases. |
| `test/rewards/DeployRewards.t.sol` | Exercises `script/DeployRewards.s.sol` end to end: wiring, funding, ownership handoff, and that the resulting deployment actually redeems. |

## Usage

Build:

```shell
forge build
```

Test:

```shell
forge test
```

Format / gas snapshot:

```shell
forge fmt
forge snapshot
```

Deploy the duel escrow system (`BattleEscrow` implementation +
`BattleEscrowFactory`), optionally with a mint-on-demand mock stake token for
local/testnet use only:

```shell
PRIVATE_KEY=<deployer_key> \
ORACLE_SIGNER_ADDRESS=<address whose signature settle() trusts> \
PLATFORM_TREASURY_ADDRESS=<address the platform's cut (whatever's left after winnerBps and any referrer cuts) is sent to> \
DEPLOY_MOCK_STAKE_TOKEN=true \
  forge script script/DeployDuel.s.sol:DeployDuel --rpc-url <rpc_url> --broadcast
```

(Omit `DEPLOY_MOCK_STAKE_TOKEN` and set `STAKE_TOKEN_ADDRESS=<real stablecoin
address>` instead for anything beyond local/testnet use.)

For a real stablecoin, `MIN_BUY_IN` is required and must be at least one whole
token in its own units (e.g. `1000000` = 1 USDC); the script reads the token's
`decimals()` and refuses a dust floor. Optional:

- `FACTORY_OWNER=<multisig>` hands factory ownership over after deployment. The
  owner can `pause()` all duels and propose oracle signer rotations, so it should
  not stay on the deployer's hot key.
- `RELAYER_ADDRESS=<FE relayer wallet>` is only checked: the script refuses to
  deploy if it equals the oracle signer (the relayer needs no on-chain role).

The script ends by printing the `NEXT_PUBLIC_*` values to paste into the FE env.

Deploy the rewards layer (`CombatRecordNFT` + `RedemptionVault`), independent of
the duel contracts. The script deploys the NFT, deploys the vault pointed at it,
wires `setRedemptionVault`, optionally funds the vault, then hands ownership of
both to `REWARDS_OWNER`:

```shell
PRIVATE_KEY=<deployer_key> \
POINTS_ORACLE_ADDRESS=<the only address allowed to addPoints()> \
REWARD_TOKEN_ADDRESS=<platform token> \
TOKENS_PER_POINT_WAD=<reward-token base units per point, e.g. 1000000000000000> \
REWARDS_OWNER=<multisig> \
VAULT_FUNDING_AMOUNT=<reward tokens the deployer moves into the vault> \
  forge script script/DeployRewards.s.sol:DeployRewards --rpc-url <rpc_url> --broadcast
```

Optional: `VESTING_DURATION_SECONDS` (30-90 days, default 60),
`ORACLE_SIGNER_ADDRESS` / `RELAYER_ADDRESS` (checked so the points oracle never
reuses the duel oracle or relayer key), and `DEPLOY_MOCK_REWARD_TOKEN=true` for
local/testnet runs. The points oracle can mint points to anyone, so it gets its
own key. An unfunded vault redeems nothing; the script warns if it's left empty.
`test/rewards/DeployRewards.t.sol` exercises this script end to end (wiring,
funding, ownership handoff, and a real redemption).

This layer is currently **not deployed on any live chain** by product
decision — points/tiers stay DB-only for now (`FE/lib/models/CombatRecord.ts`
mirrors what `CombatRecordNFT` would track). See
[`../README.md`](../README.md#known-gaps--open-items) and
[`../Points.md`](../Points.md) for the off-chain system currently in place
and what deploying this layer would change.

Local node:

```shell
anvil
```

## Related documentation

- [`../README.md`](../README.md) — full product overview, architecture, and how
  this subsystem fits into the rest of the app
- [`../Referral.md`](../Referral.md) — referral commission economics built on
  top of `BattleEscrow.settle()`
- [`../Points.md`](../Points.md) — every points ledger and formula, including
  the tier thresholds `CombatRecordNFT.tierOf()` mirrors
- [`../Deployment.md`](../Deployment.md) — deploying these contracts alongside
  the rest of the app, end to end
