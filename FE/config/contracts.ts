import BattleEscrowFactoryAbi from "@/abis/BattleEscrowFactory.json";
import BattleEscrowAbi from "@/abis/BattleEscrow.json";
import Erc20Abi from "@/abis/MockERC20.json";

/**
 * Known-good deployed addresses per chain -- the ONLY source of truth for
 * any chain ID listed here, checked into source rather than living in env
 * vars. This app is deployed twice in production -- pages on Vercel, the API
 * on Cloud Run (see Deployment.md) -- and Next.js inlines NEXT_PUBLIC_* vars
 * at BUILD time, not read at runtime. A factory redeploy used to mean
 * updating the address in Vercel's dashboard AND Cloud Run's
 * --set-build-env-vars (easy to miss -- --set-env-vars alone only touches
 * the built image's runtime env, too late for inlining) AND --set-env-vars,
 * three separately-maintained places that can silently drift out of sync.
 * When Cloud Run's compiled CONTRACTS.battleEscrowFactory falls behind the
 * address a transaction actually used, lib/chainVerify.ts's address-filtered
 * event lookup finds nothing and throws "DuelCreated event not found for
 * this wallet in that transaction" -- see Deployment.md's troubleshooting
 * table for that exact failure mode.
 *
 * Deliberately NOT env-overridable for a listed chain ID -- every deploy
 * target gets the identical value from the same git commit, full stop, with
 * no env var anywhere that could hold a stale leftover value and
 * reintroduce the bug above. To change a listed chain's config, edit this
 * map (and Contracts/README.md's deployment table) and redeploy; do not set
 * NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS/NEXT_PUBLIC_STAKE_TOKEN_ADDRESS/
 * NEXT_PUBLIC_RPC_URL for it, they're ignored. The env vars only apply to a
 * chain ID with no entry here -- local Anvil dev (chain 31337), whose
 * address/RPC are different every time Contracts/script/DeployDuel.s.sol runs.
 *
 * rpcUrl is here for the same reason as the addresses: lib/chainClient.ts,
 * lib/chainVerify.ts, and lib/settlementRelayer.ts each independently read
 * process.env.NEXT_PUBLIC_RPC_URL with a 'http://127.0.0.1:8545' fallback --
 * if a build target's NEXT_PUBLIC_RPC_URL was ever missing from
 * --set-build-env-vars, they'd silently compile with that localhost
 * fallback and fail with "fetch failed ... URL: http://127.0.0.1:8545/" in
 * production (Cloud Run has no Anvil to fetch from). One hardcoded value
 * here, imported by all three, makes that failure mode structurally
 * impossible for a listed chain ID.
 */
const KNOWN_DEPLOYMENTS: Record<
  number,
  {
    battleEscrowFactory: `0x${string}`;
    stakeToken: `0x${string}`;
    rpcUrl: string;
    /** Multicall3 -- the keeper batches settle()/expire()/refundStale() for
     * many escrows into one transaction through it (lib/keeper.ts). */
    multicall3?: `0x${string}`;
    /** Gas auto-top-up (lib/relayerTopUp.ts): swaps a little of the platform's
     * treasury revenue from stakeToken to native ETH for the relayer, on a
     * Uniswap v3 pool, so no one has to manually send it gas. All four
     * addresses below, and the pool's fee tier, were read from this chain's
     * real Uniswap v3 deployment and the real stakeToken/WETH pool, not
     * assumed -- see Deployment.md's "Automatic relayer gas top-up" section. */
    gasSwap?: {
      /** Native-wrapped token the stake token is quoted/swapped against. */
      weth: `0x${string}`;
      /** Uniswap V3 SwapRouter02 -- exactInputSingle + unwrapWETH9 via multicall. */
      swapRouter: `0x${string}`;
      /** Uniswap V3 QuoterV2 -- read-only quote, used to set the swap's slippage floor. */
      quoter: `0x${string}`;
      /** The stakeToken/weth pool's fee tier in hundredths of a bip (e.g. 100 = 0.01%). */
      poolFeeTier: number;
      /** Platform treasury (CLAUDE.md) -- source of the USDG the top-up pulls via a
       * capped, treasury-signed approve() to the relayer. Never the treasury's own key. */
      treasury: `0x${string}`;
    };
  }
> = {
  4663: {
    // Robinhood Chain mainnet -- BattleEscrowFactory (Contracts/README.md#deployments)
    battleEscrowFactory: "0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E",
    // USDG "Global Dollar" (Paxos), 6 decimals
    stakeToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    rpcUrl: "https://robinhood-mainnet.g.alchemy.com/v2/T_E1VT8027czrtVr41hsQ",
    // Canonical Multicall3 (same address on every chain it's deployed to);
    // bytecode confirmed present on chain 4663.
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    // Confirmed on-chain: SwapRouter02.WETH9() reads this address; the
    // 0.01%-fee USDG/WETH pool (below) holds ~9.9M USDG / ~3,371 WETH.
    gasSwap: {
      weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      // Uniswap's official Robinhood Chain deployment (developers.uniswap.org).
      swapRouter: "0xcaf681a66d020601342297493863e78c959e5cb2",
      quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
      poolFeeTier: 100,
      treasury: "0x6d0c0Ac0b60B1BE2D60ad4e6AA868D2612fe4f89",
    },
  },
};

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const knownForChain = KNOWN_DEPLOYMENTS[chainId];

export const CONTRACTS = {
  chainId,
  battleEscrowFactory: (knownForChain?.battleEscrowFactory ||
    process.env.NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS ||
    "") as `0x${string}`,
  stakeToken: (knownForChain?.stakeToken ||
    process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS ||
    "") as `0x${string}`,
  multicall3: (knownForChain?.multicall3 || process.env.NEXT_PUBLIC_MULTICALL3_ADDRESS || undefined) as
    | `0x${string}`
    | undefined,
  // Not env-overridable for a listed chain, same reasoning as the rest of this
  // file -- a wrong swap-path address is a fund-safety issue, not a cosmetic one.
  gasSwap: knownForChain?.gasSwap,
  rpcUrl:
    knownForChain?.rpcUrl ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    "http://127.0.0.1:8545",
};

/** Robinhood Chain mainnet's RPC, independent of whatever chain
 * NEXT_PUBLIC_CHAIN_ID/CONTRACTS currently target (local dev commonly
 * targets foundry/31337 while the browser's wagmi config still lists
 * robinhoodChain as a connectable chain) -- see config/chains.ts and
 * config/wagmiConfig.ts, the two other places this URL is needed. */
export const ROBINHOOD_CHAIN_RPC_URL = KNOWN_DEPLOYMENTS[4663].rpcUrl;

export { BattleEscrowFactoryAbi, BattleEscrowAbi, Erc20Abi };
