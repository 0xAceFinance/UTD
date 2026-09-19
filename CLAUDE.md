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

### Duel contracts: CURRENT deployment (DeployDuel.s.sol, deployer nonces 8-9)
Durations exactly 5, 10, 15 or 20 min (MIN_DURATION 300, MAX_DURATION 1200, DURATION_STEP 300).
| Contract | Address | Tx | Block |
|---|---|---|---|
| BattleEscrow (implementation) | `0x3F0F175EDBFb9688dC77ee0c6474030147784bCC` | `0xb6e72fd31262cb9f2891f9d61ca20896d2abcbca8b537cf811851868da5f8c4c` | 67283755 |
| BattleEscrowFactory | `0xf56eED09448fE1C23009DA6D0f00DE1A927A862f` | `0x4cba9dc16e038b7781229727e5596718815012bbbbd61ac3f7c11eed72d28497` | 67283788 |

SUPERSEDED (15-40 min rule, 0 duels, do not use): factory `0x32aB0586A99e7b7246225689dD6847a77E1d946D`,
implementation `0x0400babC9C034bba510DDe52EB829F87739C5e41` (nonces 6-7, blocks 67027457-67027489).

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
NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS=0xf56eED09448fE1C23009DA6D0f00DE1A927A862f
NEXT_PUBLIC_STAKE_TOKEN_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
```

### Rewards contracts (CombatRecordNFT, RedemptionVault): NOT deployed (deliberately deferred)
