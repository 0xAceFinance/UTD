# UTD project notes for Claude

## Secrets
- Never open, print or `cat` `Contracts/.env` (holds the deployer PRIVATE_KEY). To get
  the deployer address, derive it in the shell without echoing the key:
  `cd Contracts && (set -a; source ./.env; cast wallet address --private-key "$PRIVATE_KEY")`
- Never write private keys into any tracked file, memory, or chat output.

## Robinhood Chain mainnet (chain ID 4663): public addresses
- RPC: `https://rpc.mainnet.chain.robinhood.com` (official; supports eth_call/getLogs).
  The Tatum gateway's free plan blocks eth_call, so it can't be used.
- Explorer: https://robinscan.io

| Role | Address | Notes |
|---|---|---|
| Deployer | `0x9b7016Fe0a8e0d97b0FC6C9Be8AB6b9Cc938651B` | EOA. Stays factory owner (FACTORY_OWNER unset). |
| Oracle signer | `0xA5C09C06ED6887598e894b211F6dFE55FD80B4b4` | EOA; signs settle/void results off-chain, needs no ETH |
| Platform treasury | `0x6d0c0Ac0b60B1BE2D60ad4e6AA868D2612fe4f89` | EOA; gets 20% of each pot. Multisig recommended. |
| Stake token | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | USDG "Global Dollar" (Paxos), 6 decimals, upgradeable proxy, freezable |
| MIN_BUY_IN | `1000000` | $1.00 at 6 decimals |

Two tokens using the "USDC" ticker on this chain are fakes, never use them:
`0x0453dCF836Dc35DA9F8523ea2BB928268f16F073` ("Upsidedowncat"),
`0x7eCca74AB958900EBBeD1b258cAb50Ae69409550` ("FatCatBatRatWifHat").

### Duel contracts: CURRENT deployment (DeployDuel.s.sol)
Durations exactly 5, 10, 15 or 20 min (MIN_DURATION 300, MAX_DURATION 1200, DURATION_STEP 300);
open window 5 min (BattleEscrow.MAX_OPEN_WINDOW 300). Referral-aware `settle()` (winnerBps 9000,
maxReferrerBps 500, MIN_WINNER_BPS 8000) with payout terms (`winnerBps`/`maxReferrerBps`/
`platformTreasury`/`settlementSigner`) snapshotted per-duel at `activate()` — see the "why replaced"
note on the superseded deployment below.
| Contract | Address |
|---|---|
| BattleEscrow (implementation) | `0x3028ea8aDA73b722bB271797b0Ca87FC28427a62` |
| BattleEscrowFactory | `0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E` |

Deploy tx/block not recorded here (the RPC is not an archive node; if you have the
`forge script ... --broadcast` output, add them). Source verified on Sourcify: `exact_match`
(creation + runtime) for both, verified 2026-09-21T20:57Z.

SUPERSEDED, do not use:
- 3rd: factory `0x65f58fA80dd62460980B14979f062F1E67D35Cff`, impl `0x42839837874979e50f019c5C23154578216fa72D`
  (tx `0x45590d9bd416ca82a6b0ce8663ebef8ad1c945819795e3556e07b295037b5a37` / block 67296858).
  **Replaced for a security fix, not routine tuning**: this deployment reads `winnerBps`/
  `maxReferrerBps`/`platformTreasury` *live* from the factory at `settle()` time, so the factory
  owner could reprice or redirect an already-staked pot after activation (audit finding, fixed in
  commit `a422da1`). **Has 5 duels on it, not 0** — as of 2026-09-22, duel index 3
  (`0x35EB4C03C56740364AD6a5767c74F3F625c29b0a`) is `Active` with `endTime` ~48h in the past and
  still unsettled (past its 24h `refundStale()` window) — needs investigation, see chat log.
  Do not delete/ignore this factory's data until that duel is resolved.
- 2nd: factory `0xf56eED09448fE1C23009DA6D0f00DE1A927A862f`, impl `0x3F0F175EDBFb9688dC77ee0c6474030147784bCC` (60 min open window, 0 duels)
- 1st: factory `0x32aB0586A99e7b7246225689dD6847a77E1d946D`, impl `0x0400babC9C034bba510DDe52EB829F87739C5e41` (15-40 min durations, 0 duels)

Verified on-chain after deploy: oracleSigner, platformTreasury, approvedStakeToken (USDG),
minBuyIn=1000000, winnerBps=9000, maxReferrerBps=500 all as configured; owner = deployer;
paused=false; allDuelsLength=0; implementation's initialize() reverts "already initialized".
Re-verify anytime with (no key needed, all read-only):
`cast call 0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E 'oracleSigner()(address)' --rpc-url https://rpc.mainnet.chain.robinhood.com`.
`forge verify-contract <addr> <path:Name> --verifier sourcify --chain 4663`; factory needs
`--constructor-args` = abi-encoded (impl, oracle, treasury, stakeToken, minBuyIn).
Official explorer: https://robinhoodchain.blockscout.com (Cloudflare blocks scripted API access).
This RPC has no historical/archive state — `eth_getCode`/`eth_call` at a past block errors, so
deploy tx/block can't be recovered after the fact; capture broadcast output at deploy time.

FE env:
```
NEXT_PUBLIC_CHAIN_ID=4663
NEXT_PUBLIC_RPC_URL=https://rpc.mainnet.chain.robinhood.com
NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS=0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E
NEXT_PUBLIC_STAKE_TOKEN_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
```

### Rewards contracts (CombatRecordNFT, RedemptionVault): NOT deployed (deliberately deferred)
