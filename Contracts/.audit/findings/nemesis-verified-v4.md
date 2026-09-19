# N E M E S I S — v4 (2026-09-19)

Scope: v3 fixes (settlementSigner snapshot, minBuyIn, _pay in cancel/expire, _mint). Suite 162/162.
Result: 0 findings. No new bugs from the v3 fixes.

## Project-fit triage of every lead
| Lead | Verdict | Why |
|---|---|---|
| Admin void-then-confirm → two valid signatures (backend resolve route) | FIX (backend) | Real path: a loser can front-run with the void. One-line filter. |
| No keeper / refund button on SETTLING (loser escapes after 24h) | FIX (backend) | Grace capped at 24h, so off-chain must settle in time. |
| Leaked oracle key (no emergency pause) | FIXED (added on request) | Factory `pause()`/`unpause()` (owner-only, instant) blocks createDuel/joinDuel, and escrows refuse settle/voidActive while paused. cancel/expire/refundStale/withdraw stay open. |
| claim() unbounded schedules | LATER (when rewards are wired) | Self-harm only. Stranded tokens = the griefer's own allocation. |
| redeem no minTokenAmount | LATER (when rewards are wired) | Only an owner action; the owner is trusted. |
| Instant setPointsOracle / setRedemptionVault | LATER | Admin trust; rewards not deployed yet. |
| Pending rotation has no cancel/expiry | SKIP | The owner can re-propose the current signer. |
| owed[treasury] stuck if treasury can't call withdraw | SKIP → use a Safe/EOA treasury | Operational. |
| joinDuel no nonReentrant | SKIP | The approved token is a plain stablecoin; a reentrant join reverts anyway. |
| Epoch cap doubling, stranded donations, no sweep, direct-clone events, symbol strings, rounding at tiny minBuyIn, MockERC20 flag, EIP-712 | SKIP | Design, dust, self-harm, or already handled off-chain. |

## Oracle-key-leak runbook
1. `factory.pause()` immediately.
2. `proposeOracleSigner(newKey)`, then execute after 24h.
3. `unpause()`. Duels activated before the rotation still use the old key (snapshot): re-sign them with the old key if it is safe, otherwise stay paused past endTime+24h so `refundStale` refunds them.
