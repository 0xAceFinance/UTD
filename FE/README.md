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

## Deployed contracts

Robinhood Chain mainnet (chain id 4663). Full record, deploy transactions and superseded
deployments: [`../Contracts/README.md#deployments`](../Contracts/README.md#deployments).

| Contract | Address |
|---|---|
| `BattleEscrowFactory` | [`0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E`](https://robinhoodchain.blockscout.com/address/0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E) |
| `BattleEscrow` (implementation) | [`0x3028ea8aDA73b722bB271797b0Ca87FC28427a62`](https://robinhoodchain.blockscout.com/address/0x3028ea8aDA73b722bB271797b0Ca87FC28427a62) |
| Stake token (USDG, 6 decimals) | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |

Duels last 5, 10, 15 or 20 minutes; an unmatched lobby stays open for 5 minutes; minimum buy-in 1 USDG.

Public env for this deployment (server secrets are listed in [`.env.example`](./.env.example)):

```
NEXT_PUBLIC_CHAIN_ID=4663
NEXT_PUBLIC_RPC_URL=https://rpc.mainnet.chain.robinhood.com
NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS=0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E
NEXT_PUBLIC_STAKE_TOKEN_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
```

## Getting started

```bash
npm install
npm run dev
```

MongoDB is required locally — `npm run dev` starts it automatically via `predev` (see `scripts/mongo.mjs`).
