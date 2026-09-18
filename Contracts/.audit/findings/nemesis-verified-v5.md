# N E M E S I S — v5 (2026-09-19)

Scope: v4 + emergency pause (Factory Pausable; settle/voidActive check paused). Suite 168/168.
Result: 0 findings (every "finding" needs a compromised trusted key). The pause introduced no new bugs.

## Project-fit triage
| Item | Verdict | Why |
|---|---|---|
| Leaked key still valid for pre-rotation duels once unpaused (6 agents) | FIX (small, optional) | The pause is only safe to lift after someone refunds every old-key duel, which is easy to get wrong. A `revokeSigner(addr)` checked in settle/void makes unpause safe. Otherwise the runbook must be followed exactly. |
| Backend: void-then-confirm double signature | FIX (backend) | Still open. |
| Backend: no keeper / refund button on SETTLING | FIX (backend) | Still open. |
| Backend: price manipulation on thin-liquidity tokens | CHECK (backend) | The engine has a TWAP, a liquidity-weighted median and a depth gate. Confirm the Top-10 liquidity floor is high enough. |
| Rewards: no global cap / pause if the points-oracle key leaks (agents 8, 11) | LATER (before wiring rewards) | Rewards aren't deployed. Add a global per-epoch cap + Pausable on the vault then. |
| Rewards: claim loop, min redeem, minTokenAmount, role timelocks, sweep | LATER | Same. |
| renounceOwnership / 1-step Ownable while paused | SKIP → make the owner a Safe multisig | Operational. |
| Pause > 24h lets losers refund | SKIP | Intended: during a leak a refund is the safe outcome. Keep pauses short. |
| _pay non-standard return data | SKIP | USDC only. |
| minBuyIn dust rounding, epoch doubling, stranded donations, direct-clone events, symbol strings, mock flag, EIP-712 | SKIP | Design, dust, or handled off-chain. |
