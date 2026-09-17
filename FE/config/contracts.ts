import BattleEscrowFactoryAbi from '@/abis/BattleEscrowFactory.json';
import BattleEscrowAbi from '@/abis/BattleEscrow.json';
import Erc20Abi from '@/abis/MockERC20.json';

/**
 * On-chain addresses for the duel contracts (Contracts/src/duel/), currently
 * pointed at a local Anvil deployment (Contracts/script/DeployDuel.s.sol) --
 * see .env.local. Swapping to a real deployment is only ever an env change,
 * never a code change: update these three values (and the stake token to a
 * real stablecoin, not MockERC20) once BattleEscrowFactory is deployed for
 * real.
 */
export const CONTRACTS = {
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
    battleEscrowFactory: (process.env.NEXT_PUBLIC_BATTLE_ESCROW_FACTORY_ADDRESS ?? '') as `0x${string}`,
    stakeToken: (process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS ?? '') as `0x${string}`,
};

export { BattleEscrowFactoryAbi, BattleEscrowAbi, Erc20Abi };
