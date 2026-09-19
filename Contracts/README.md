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

## Deployments

### Robinhood Chain mainnet (chain id 4663)

Duel escrow system, deployed 2026-09-19 with `script/DeployDuel.s.sol`
(broadcast record: `broadcast/DeployDuel.s.sol/4663/run-latest.json`).

| Contract | Address | Deploy tx | Block |
|---|---|---|---|
| `BattleEscrowFactory` | [`0x32aB0586A99e7b7246225689dD6847a77E1d946D`](https://robinscan.io/address/0x32aB0586A99e7b7246225689dD6847a77E1d946D) | `0xd1d471b516fab114f62d0a0be9fc3fbbec5b8bd29cbb0945f9b3266eb96b0dab` | 67027489 |
| `BattleEscrow` (implementation) | [`0x0400babC9C034bba510DDe52EB829F87739C5e41`](https://robinscan.io/address/0x0400babC9C034bba510DDe52EB829F87739C5e41) | `0x6e62771756a53d1e77503a56821c7058cebca7deed10b6324ceff8a5ee6fc1f7` | 67027457 |

Both contracts are source-verified on Sourcify with an **exact match** (creation and
runtime bytecode, solc 0.8.30), which Blockscout also displays:
[factory](https://repo.sourcify.dev/4663/0x32aB0586A99e7b7246225689dD6847a77E1d946D),
[implementation](https://repo.sourcify.dev/4663/0x0400babC9C034bba510DDe52EB829F87739C5e41).
The chain's official explorer is Blockscout at `robinhoodchain.blockscout.com`.

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
                                                          platformTreasury  | BattleEscrowFactory
                                                                            v
                                                          winner gets 80% of pot,
                                                          platformTreasury gets 20%,
                                                          loser gets nothing on-chain

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
  `MAX_OPEN_WINDOW = 60 minutes` matchmaking window.
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
- `settle(uint8 winnerSide, bytes calldata signature) external` — also
  **permissionless**. Requires `status == Active` and `block.timestamp >=
  endTime`; the actual authorization is an ECDSA signature over
  `keccak256(abi.encodePacked(address(this), winnerSide, block.chainid))`
  that must recover to `BattleEscrowFactory.oracleSigner()` (chain ID is
  folded in so a signature from one chain can never settle a same-address
  duel on another). Pays the winner 80% of the pot (`buyIn * 2`) and the
  platform treasury the remaining 20%; the loser receives nothing on-chain.
  This is the "if the keeper bot is down, anyone holding the signed result
  can still push settlement through" fallback.
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
- `allDuelsLength()` / `allDuels(i)` — enumeration of every duel ever created.

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
- `tierOf(wallet)` — Bronze (`<5,000`) / Silver (`>=5,000`) / Gold
  (`>=25,000`) / Diamond (`>=100,000`), based on lifetime `totalPoints`. The
  contract's own comment notes this must be kept in sync **by hand** with
  `points/src/pointsEngine.ts`'s `tierForPoints` in the backend — there is no
  shared source of truth between the two.
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
   it (`status = Open`, a 60-minute matchmaking window starts).
2. **Join.** An opponent calls `BattleEscrowFactory.joinDuel(duel)`. The
   factory reads `joinTerms()` off the clone, pulls the same `buyIn` from the
   opponent into the clone, then calls `activate(opponent)`, which flips the
   clone to `Active` and fixes `startTime`/`endTime = startTime +
   durationSeconds` (5, 10, 15 or 20 minutes, enforced at creation).
3. **No-match path.** If nobody joins before the 60-minute open window
   elapses, anyone can call `BattleEscrowFactory.expireDuel(duel)`
   (permissionless) to refund the creator and set `status = Refunded`.
   Before that window closes, only the creator can call
   `BattleEscrowFactory.cancelDuel(duel)` for the same refund.
4. **Live window.** Between `startTime` and `endTime`, the two tokens duel
   off-chain/via the bonding-curve pools (buy-only; the escrow contract
   itself has no awareness of token prices or trading — it only holds stake).
5. **Oracle attestation.** After `endTime`, the backend's oracle determines
   the winning side and signs `keccak256(abi.encodePacked(duelAddress,
   winnerSide, block.chainid))` with the `oracleSigner` key registered on the
   factory.
6. **Settle.** Anyone (typically a backend keeper, but permissionlessly any
   address) calls `BattleEscrow.settle(winnerSide, signature)` on the clone.
   The clone verifies the signature against `factory.oracleSigner()`, pays
   80% of the pot to the winner and 20% to `factory.platformTreasury()`, and
   sets `status = Settled`. The loser receives nothing on-chain.
7. **Points.** The backend's points oracle calls
   `CombatRecordNFT.addPoints(winnerWallet, amount)`, minting a soulbound
   Combat Record NFT on that wallet's first award and accumulating lifetime
   points that determine its tier.
8. **Redeem.** The wallet calls `RedemptionVault.redeem(pointsAmount)`
   (bounded by its tier's per-epoch cap), which marks those points redeemed
   on the NFT and opens a new linear vesting schedule for the reward-token
   equivalent.
9. **Claim.** The wallet calls `RedemptionVault.claim()` at any later point to
   collect whatever has vested so far, out of the vault's pre-funded
   reward-token balance.

## Tests

| Test file | Covers |
|---|---|
| `test/duel/BattleEscrow.t.sol` (+ `test/duel/MockERC20.sol` stand-in stake token) | `BattleEscrow` + `BattleEscrowFactory`: full settlement split (80/20, either side winning), creator cancel, permissionless expiry, "cannot duel yourself", oracle-signature validation (including a bad-key rejection), permissionless-but-signature-gated settlement, `onlyFactory` gating, double-initialize guard, duration bounds, `onlyOwner` config setters. |
| `test/rewards/CombatRecordNFT.t.sol` | `CombatRecordNFT`: mint-on-first-award, no duplicate mint on repeat awards, `onlyPointsOracle` gating, tier thresholds, soulbound transfer/approve reverts, `onlyRedemptionVault` gating, `markRedeemed` reducing *available* not *total* points. |
| `test/rewards/RedemptionVault.t.sol` | `RedemptionVault`: vesting-schedule creation at the configured rate, insufficient-points rejection, per-tier per-epoch cap and its reset on a new epoch, linear vesting math over time, `claim()` transferring and updating claimed amounts, concurrent independent schedules summing correctly, `onlyOwner` config gating, vesting-duration bounds. |

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
PLATFORM_TREASURY_ADDRESS=<address the 20% platform cut is sent to> \
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

There is no `Deploy.s.sol`/`DeployDuel.s.sol` equivalent yet for
`CombatRecordNFT`/`RedemptionVault` — deploy those manually (via `forge
create` or a cast script) with their constructor arguments
(`pointsOracle`; then `rewardToken`, `combatRecord`, `tokensPerPointWad`),
then wire `CombatRecordNFT.setRedemptionVault(...)`.

Local node:

```shell
anvil
```
