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

### Duel contracts: CURRENT deployment (DeployDuel.s.sol, deployer nonces 10-11)
Durations exactly 5, 10, 15 or 20 min (MIN_DURATION 300, MAX_DURATION 1200, DURATION_STEP 300);
open window 5 min (BattleEscrow.MAX_OPEN_WINDOW 300).
| Contract | Address | Tx | Block |
|---|---|---|---|
| BattleEscrow (implementation) | `0x42839837874979e50f019c5C23154578216fa72D` | `0xe2cdc7a709af4fd9975a907ff8586a36274c9685f586eefe9aa850f7d72956b1` | 67296825 |
| BattleEscrowFactory | `0x65f58fA80dd62460980B14979f062F1E67D35Cff` | `0x45590d9bd416ca82a6b0ce8663ebef8ad1c945819795e3556e07b295037b5a37` | 67296858 |

SUPERSEDED (0 duels each, do not use):
- 1st: factory `0x32aB0586A99e7b7246225689dD6847a77E1d946D`, impl `0x0400babC9C034bba510DDe52EB829F87739C5e41` (15-40 min durations)
- 2nd: factory `0xf56eED09448fE1C23009DA6D0f00DE1A927A862f`, impl `0x3F0F175EDBFb9688dC77ee0c6474030147784bCC` (60 min open window)

Verified on-chain after deploy: oracleSigner, platformTreasury, approvedStakeToken (USDG),
minBuyIn=1000000 all as configured; owner = deployer; paused=false; implementation's
initialize() reverts "already initialized".
Source verified on Sourcify: exact_match (creation + runtime) for both current contracts, solc 0.8.30
(`forge verify-contract <addr> <path:Name> --verifier sourcify --chain 4663`; factory needs
`--constructor-args` = abi-encoded (impl, oracle, treasury, stakeToken, minBuyIn)).
Official explorer: https://robinhoodchain.blockscout.com (Cloudflare blocks scripted API access).

FE env:
```
NEXT_PUBLIC_CHAIN_ID=4663
NEXT_PUBLIC_RPC_URL=https://rpc.mainnet.chain.robinhood.com
NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS=0x65f58fA80dd62460980B14979f062F1E67D35Cff
NEXT_PUBLIC_STAKE_TOKEN_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
```

### Rewards contracts (CombatRecordNFT, RedemptionVault): NOT deployed (deliberately deferred)
