UTD (Underground Token Duel) is a gambling game: pick a side, lock a stake, and whoever pumps harder wins the duel. Two already-trading tokens are pitted against each other in a time-boxed, buy-only "war" — no selling during the war, only strategy and hype. The winning side's stake is settled from an on-chain escrow, and wins earn soulbound Combat Record points redeemable for vested rewards.

This is a full-stack Next.js app: the UI and API routes live together here. See:

- [`FRONTEND_README.md`](./FRONTEND_README.md) — routes, components, wallet flow, styling
- [`BACKEND_README.md`](./BACKEND_README.md) — API reference, DB schema, duel lifecycle trace
- [`../Contracts/README.md`](../Contracts/README.md) — on-chain escrow, rewards, and duel lifecycle
- [`../engine/README.md`](../engine/README.md), [`../matchmaking/README.md`](../matchmaking/README.md), [`../points/README.md`](../points/README.md), [`../risk/README.md`](../risk/README.md) — the four backend logic packages

## Tech stack

- **Frontend**: Next.js 15, React 18, TypeScript, Tailwind CSS, Radix/shadcn primitives, wagmi + viem + ConnectKit
- **Backend**: Next.js API routes, MongoDB/Mongoose, four internal packages (`@mcapduel/engine`, `matchmaking`, `points`, `risk`)
- **Contracts**: Foundry/Solidity — `BattleEscrow`/`BattleEscrowFactory` (duel escrow), `CombatRecordNFT`/`RedemptionVault` (rewards)

## Getting started

```bash
npm install
npm run dev
```

MongoDB is required locally — `npm run dev` starts it automatically via `predev` (see `scripts/mongo.mjs`).
