# N E M E S I S — Verified Findings (re-audit, 2026-09-19)

## Scope
- Changed: BattleEscrow (+voidActive, refundStale, chainid), BattleEscrowFactory (+isDuel, approvedStakeToken, oracle-signer timelock), RedemptionVault (per-schedule duration, zero-token guard), DeployDuel
- Cross-feed traced: FE/lib/oracleSigner.ts, FE/lib/chainVerify.ts, FE/app/api/admin/duels/[id]/resolve/route.ts, FE/app/(app)/duels/[id]/page.tsx
- Passes: F → S → F → S, converged. Test suite: 147/147 pass.

## Previous findings — status
| Prior ID | Issue | Status |
|---|---|---|
| NM-001 | Vesting duration change bricks claim | ✅ FIXED (per-schedule `vestingDurationSeconds`) |
| NM-002 | Fake duel drain / unfiltered events | ✅ FIXED (`isDuel` on join/cancel/expire + `e.address` check in chainVerify) |
| NM-003 | Cross-chain signature replay | ✅ FIXED (`block.chainid` in digest, backend matches) |
| NM-004 | Active escrow has no exit | ⚠️ PARTIAL (voidActive + refundStale added, see NM2-001/002) |
| NM-005 | Any stake token | ✅ FIXED (`approvedStakeToken`) |
| lead | Owner picks winners instantly | ✅ MITIGATED (24h timelock) |
| lead | rate 0 burns points | ✅ FIXED (`tokenAmount > 0`) |

## New verified findings

### NM2-001: The loser can escape by calling refundStale when settlement is late (MEDIUM, PoC `test_loserEscapesViaRefundStale` PASS)
**Coupled pair:** `endTime + STALE_REFUND_GRACE_PERIOD` ↔ "has the oracle result been submitted"
`refundStale()` needs no signature and `settle()` has no priority over it. Nothing on-chain submits settlement: the winner must click "Claim" in the UI (`handleClaimSettlement`). HELD (sybil-review) duels wait on an admin. Once 24h pass, the losing player calls `refundStale()` and gets their full stake back. The winner loses 80% of the pot and the platform loses its 20% cut. The loser can also front-run a winner's late `settle` transaction.
**Fix options:** (a) a backend keeper that submits `settle` itself right after signing. (b) Let `refundStale` pay out a signed result when one exists, i.e. accept an optional signature. (c) Use a much longer grace period (e.g. 7d) plus an SLA for admin review of HELD duels.

### NM2-002: A blacklisted player still locks both stakes forever (MEDIUM, PoC `test_blacklistedPlayerLocksBothStakesForever` PASS)
The NatSpec says refundStale covers "the winner's address is blacklisted by the stake token (e.g. USDC)". It doesn't: `refundStale` and `voidActive` push to **both** players in one tx. If either player is blacklisted, every exit (`settle` when that player won, `voidActive`, `refundStale`) reverts, and the honest player's stake is locked permanently.
**Fix:** pull payments. Credit `owed[creator]` and `owed[opponent]` (and the winner and treasury in settle), and add a `withdraw()` so each party collects independently.

### NM2-003 (cross-layer, backend): the admin `void` action leaves the duel HELD, so a second, conflicting signature can be issued (MEDIUM)
`resolve/route.ts` `void` sets `oracleSignature` but keeps `status: 'HELD'`. A later `confirm` (a second admin, or the same admin changing their mind) passes the `status === 'HELD'` guard and signs a settlement. Both signatures are now valid on-chain: the loser submits the void (refund) and the winner submits settle, and whoever is first wins. The API also returns the void signature to players.
**Fix:** on void, move to a terminal state such as `status: 'VOIDING'` in the same atomic update, and refuse to re-sign once any signature exists.

### NM2-004: RedemptionVault promises tokens it may not hold (MEDIUM-LOW, 5 of 12 solidity-auditor agents raised it as a finding)
`redeem()` burns points (`markRedeemed`) and creates a schedule without checking the balance or keeping a `totalCommitted` total. `claim()` is all-or-nothing. Once the carve-out is oversubscribed, early claimers drain it and later claimers revert with their points already gone.
**Fix:** track `totalCommitted` and require `balanceOf(this) >= totalCommitted + tokenAmount` in redeem.

## Leads
- `executeOracleSignerRotation` invalidates every signed-but-unsubmitted settle/void signature. Combined with NM2-001, this pushes duels into refundStale.
- RedemptionVault still has no solvency check and no `minTokens` on redeem (a rate change while a redeem is pending).
- `CombatRecordNFT.addPoints` still uses `_safeMint` (DoS for contract wallets that can't receive NFTs).
- `DeployDuel` still has no deploy script for the rewards contracts. The MockERC20 import remains, but it's only used behind the flag.

## False positives checked
- Void vs settle signature collision: `VOID_MARKER=2`, and settle rejects any side other than 0/1. Safe (the existing test also covers it).
- `encodePacked(address,uint8,uint256)`: all fixed width, no collision.
- Timelock bypass: `proposeOracleSigner` resets `effectiveAt` on every call, so it can't be shortened.
- Changing `setApprovedStakeToken` mid-flight: each escrow stores its own stakeToken. Safe.
