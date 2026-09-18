# N E M E S I S — Verified Findings (v3, 2026-09-19)

## Scope
Changed since v2: `BattleEscrow` (`_pay` push-with-fallback, `owed`, `withdraw`, grace 24h kept), `RedemptionVault` (`totalCommitted`).
Passes: F → S → F, converged. Suite: 155/155.

## v2 findings, status
| ID | Issue | Status |
|---|---|---|
| NM2-001 | Loser escapes through refundStale after grace | ACCEPTED RISK (grace capped at 24h by product). Needs the off-chain relayer + cron, the refund button hidden on SETTLING, and HELD SLA < 24h |
| NM2-002 | Blacklisted player locks both stakes | FIXED (`_pay` credits `owed` on failure; `withdraw()` to msg.sender only) |
| NM2-003 | Backend void leaves HELD, double signature | OPEN (off-chain, out of contract scope) |
| NM2-004 | Vault over-promises | FIXED (`totalCommitted` + "rewards pool exhausted") |

## Checks on the new code
- **_pay OOG griefing:** not feasible. With a failed inner call, the 1/64 gas remainder must cover the SSTORE (~22k) plus the remaining work, which needs ≥ ~1.6M forwarded gas. The inner transfer then has enough gas to succeed.
- **_pay return handling:** handles both a revert and a `false` return. Tokens that return no data (USDT-style) are handled. `abi.decode` on non-32-byte data would revert, but only the approved token is ever used.
- **Escrow solvency:** after a terminal status, `balance == Σ owed + 0` holds (pushed amounts left the contract, deferred amounts stayed). `withdraw` zeroes the balance before transferring and is `nonReentrant`.
- **Blacklist bypass:** none. `withdraw` pays only `msg.sender`.
- **totalCommitted:** the `claim` decrement is ≤ Σ(total − claimed) = totalCommitted, so it can't underflow. There is no owner sweep, so commitments stay backed.

## Remaining leads (unchanged)
`_safeMint` DoS · no emergency revoke for the oracle key · instant `setRedemptionVault` · per-epoch cap doubling at the boundary / no minOut · stranded donations · factory events missing on direct clone calls.

## Cross-feed additions from the solidity-auditor run (v3)
- **Dust-stake points farming (verified):** `createDuel` only checks `buyIn > 0`. `FE/packages/points/src/pointsEngine.ts` clamps `stakeMultiplier` to a minimum of 1, so a 1-wei duel still pays ≥100 winner points. Fix: `minBuyIn` in the factory.
- **Signer rotation invalidates in-flight signatures:** settle/void read the live `oracleSigner`, and `executeOracleSignerRotation` is permissionless, so the loser can pick the moment the winner's signature stops working. Fix: snapshot the signer per escrow at `activate`.
- **cancel/expire bypass `_pay`:** low severity, only the creator's own funds.
