import BattleEscrowFactoryAbi from '@/abis/BattleEscrowFactory.json';
import BattleEscrowAbi from '@/abis/BattleEscrow.json';
import Erc20Abi from '@/abis/MockERC20.json';

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
 * reintroduce the bug above. To change a listed chain's address, edit this
 * map (and Contracts/README.md's deployment table) and redeploy; do not set
 * NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS/NEXT_PUBLIC_STAKE_TOKEN_ADDRESS
 * for it, they're ignored. The env vars only apply to a chain ID with no
 * entry here -- local Anvil dev (chain 31337), whose address is different
 * every time Contracts/script/DeployDuel.s.sol runs.
 */
const KNOWN_DEPLOYMENTS: Record<number, { battleEscrowFactory: `0x${string}`; stakeToken: `0x${string}` }> = {
    4663: {
        // Robinhood Chain mainnet -- BattleEscrowFactory (Contracts/README.md#deployments)
        battleEscrowFactory: '0xE78FE1cDac8D1fcBaE237a98D370946Db6ef1F3E',
        // USDG "Global Dollar" (Paxos), 6 decimals
        stakeToken: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    },
};

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const knownForChain = KNOWN_DEPLOYMENTS[chainId];

export const CONTRACTS = {
    chainId,
    battleEscrowFactory: (knownForChain?.battleEscrowFactory ||
        process.env.NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS ||
        '') as `0x${string}`,
    stakeToken: (knownForChain?.stakeToken || process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS || '') as `0x${string}`,
};

export { BattleEscrowFactoryAbi, BattleEscrowAbi, Erc20Abi };
