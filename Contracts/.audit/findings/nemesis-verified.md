# N E M E S I S — Verified Findings

## Scope
- Language: Solidity ^0.8.17 (compiled 0.8.30), OpenZeppelin v5.3.0
- Modules: BattleEscrow, BattleEscrowFactory, CombatRecordNFT, RedemptionVault (+ interfaces, DeployDuel.s.sol)
- Off-chain integration traced for cross-feed: FE/lib/chainVerify.ts, FE/lib/duelContract.ts, FE/app/api/duels/**, FE/lib/duelEngine.ts
- Functions analyzed: 27 · Coupled pairs mapped: 7 · Loop iterations: 4 passes (F → S → F → S), converged

## Nemesis Map (key coupled pairs)
| Pair | Writers | Sync |
|---|---|---|
| `vestingDurationSeconds` ↔ per-schedule `claimedAmount` | setVestingDuration (global), claim (per-schedule) | ✗ GAP → NM-001 |
| escrow `status` ↔ escrow token balance | activate/cancel/expire/settle | ✓ (surplus unrecoverable, lead) |
| factory event log ↔ "duel is a real clone" | joinDuel/cancelDuel/expireDuel | ✗ GAP (no registry) → NM-002 |
| backend `Duel.escrowAddress` ↔ real clone | verifyDuelCreated (no log.address check) | ✗ GAP → NM-002 |
| signature digest ↔ (chain, factory, duel) | settle | ✗ chainid missing → NM-003 |
| Active status ↔ exit path | settle only | ✗ no timeout → NM-004 |
| `totalPoints` ↔ `redeemedPoints` | addPoints / markRedeemed | ✓ SYNCED |

## Verification Summary
| ID | Source | Breaking Op | Severity | Verdict |
|----|--------|-------------|----------|---------|
| NM-001 | State P2 → Feynman P3 | setVestingDuration → claim | MEDIUM | TRUE POS (PoC) |
| NM-002 | Cross-feed P1→P4 (contract + backend) | joinDuel(fakeDuel) via official UI | HIGH | TRUE POS (PoC + trace) |
| NM-003 | Feynman P1 | settle (cross-chain replay) | MEDIUM (conditional on multi-chain) | TRUE POS (trace) |
| NM-004 | State P2 | settle is only Active exit | MEDIUM | TRUE POS (trace) |
| NM-005 | Feynman P3 | createDuel any stakeToken | LOW–MEDIUM | TRUE POS (trace) |

---

### NM-001: Raising vesting duration bricks claim() for everyone who has already claimed
**Severity:** MEDIUM · **Verification:** PoC `test_vestingIncreaseBricksClaim` PASS
**Coupled pair:** global `vestingDurationSeconds` ↔ `VestingSchedule.claimedAmount`
**Invariant:** `_vestedAmount(s) >= s.claimedAmount` for all schedules.
**Breaking op:** `RedemptionVault.setVestingDuration` (L589) rewrites the curve of existing schedules; `claim()` L554 / `claimableAmount()` L569 then do `vested - claimed` → panic 0x11.
**Trigger:** duration 30d → redeem 900 pts → claim at day 20 (claimed 2/3) → owner sets 90d (in-range) → day 21 claim reverts. Loop covers every schedule, so new schedules freeze too. Lock lasts up to ~60 days. Reverse direction (decreasing) retroactively accelerates unvested payouts.
**Fix:**
```solidity
struct VestingSchedule { uint256 totalAmount; uint256 claimedAmount; uint256 startTime; uint256 duration; }
// redeem(): duration: vestingDurationSeconds
// _vestedAmount(): use s.duration instead of vestingDurationSeconds
```

### NM-002: Unregistered duel addresses + unfiltered event logs → official UI drains joiner stakes
**Severity:** HIGH · **Discovery:** Cross-feed. Feynman P1 flagged `joinDuel` trusting any `duel` (dismissed alone as self-harm/phishing). State P2 mapped "factory event ↔ real clone" as a coupled pair the backend relies on. Feynman P3 asked *why the backend believes the escrow address* → `parseEventLogs` has no `log.address` filter.
**Verification:** PoC `test_joinDuelFakeAddressDrainsAllowance` PASS (on-chain half); backend trace below.
**Chain:**
1. Attacker deploys `F` emitting a `DuelCreated(duel=F, creator=attacker, buyIn=X, …)`-shaped event.
2. `POST /api/duels {txHash}` → `verifyDuelCreated` (`FE/lib/chainVerify.ts:37`) matches only `eventName` + `creator`, not `log.address == factory` → DB lobby with `escrowAddress = F`.
3. Victim clicks Join in Dashboard → `joinDuelOnChain(F, buyIn)` approves factory for `buyIn` and calls real `factory.joinDuel(F)`.
4. Factory calls `F.joinTerms()` → `(stakeToken, buyIn)`, `safeTransferFrom(victim, F, buyIn)` → funds in attacker contract; `F.activate` no-op; real factory emits genuine `DuelJoined(F, victim)` so `verifyDuelJoined` passes too.
5. Victim's stake is gone; the backend later signs a settlement for `F`, which `F` ignores.
The same missing emitter check lets attacker-only fake duels farm (currently off-chain) points with zero stake (`verifyDuelSettled` trusts `escrowAddress = F`).
**Fix (on-chain):**
```solidity
mapping(address => bool) public isDuel;
// createDuel: isDuel[duel] = true;
// joinDuel/cancelDuel/expireDuel: require(isDuel[duel], "unknown duel");
```
**Fix (off-chain):** in every `verify*` helper, require `e.address === CONTRACTS.battleEscrowFactory` for factory events, check `args.stakeToken === CONTRACTS.stakeToken`, and read `factory.isDuel(escrow)` before trusting an escrow.

### NM-003: Settlement signature has no chain/factory domain
**Severity:** MEDIUM (only if deployed to >1 chain with the same deployer nonce + oracle key) · **Verification:** code trace
`BattleEscrow.sol:157` signs `keccak256(abi.encodePacked(address(this), side))`. `Clones.clone` uses CREATE, so the factory's Nth duel has the same address on every chain where the factory has the same address (DeployDuel uses one PRIVATE_KEY). A signature published on chain A settles duel N on chain B.
**Fix:** EIP-712 digest over `(block.chainid, factory, address(this), creator, opponent, buyIn, startTime, winnerSide)`; the oracle (`FE/lib/oracleSigner.ts`) must sign the same fields.

### NM-004: Active escrow has no exit except an oracle signature
**Severity:** MEDIUM · **Verification:** code trace
Only `settle()` accepts `Status.Active`. If the oracle key is lost or rotated (`setOracleSigner` invalidates unsent signatures), the backend flags the duel (`duelEngine.ts` `isSybilMatch` → `flagForReview` returns *before* signing), or the winner/treasury is USDC-blacklisted (push transfers), then 2×buyIn is locked forever. No draw outcome is supported either.
**Fix:** a permissionless `refundStale()` after `endTime + GRACE` that returns buyIn to each player, and optionally a signed "draw" outcome.

### NM-005: Any ERC20 accepted as stake token
**Severity:** LOW–MEDIUM · **Verification:** code trace
`createDuel` never validates `stakeToken`. The backend never reads `stakeToken` from `DuelCreated` (`route.ts:68-71`), so a real clone staked in a self-minted token is listed and scored as a USD duel. This enables zero-cost point farming even after the NM-002 emitter fix, and lets joiners be tricked into fake-token duels.
**Fix:** factory allowlist `require(allowedStake[stakeToken])`, or one immutable stake token.

## Leads (not promoted)
- `CombatRecordNFT.addPoints` `_safeMint` callback: a contract wallet without a receiver can never be awarded points. Use `_mint`.
- `RedemptionVault.redeem`: liabilities are not checked against the balance. When underfunded it's first-come-first-served and later users' points are burned for nothing.
- `RedemptionVault.setRate(0)` / constructor rate 0: redeem burns points for a 0-token schedule.
- `BattleEscrowFactory.setOracleSigner` reads live: the owner can pick the winner of any Active duel, which contradicts the NatSpec claim that the owner has "no function that moves user funds".
- Escrow surplus (donations or positive rebase) is unrecoverable, and a negative rebase makes settle revert.

## False positives eliminated
- Donating to an escrow to bypass `activate`'s balance check: joinDuel always pulls buyIn first.
- Signature malleability: OZ v5 ECDSA rejects high-s.
- activate/expire boundary: `<=` vs `>`, the windows don't overlap.
- Re-entering through the `_safeMint` callback into redeem: availablePoints is not yet increased.
- ReentrancyGuard on clones: OZ 5.3 treats status 0 as NOT_ENTERED.

## Summary
- Raw: 1 H · 4 M · 6 L/leads. After verification: 5 TRUE POSITIVE (1 H, 3 M, 1 L–M), 5 FP eliminated.
- Feedback-loop discoveries: NM-002 (escalated from a phishing lead to HIGH only via the backend cross-feed), NM-005 (backend ignores stakeToken).
