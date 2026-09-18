// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import "../src/duel/BattleEscrow.sol";
import "../src/duel/BattleEscrowFactory.sol";
import "../test/duel/MockERC20.sol";

/**
 * Deploys the duel implementation + factory (spec Section 03).
 *
 * Required env vars:
 *  PRIVATE_KEY              deployer key
 *  ORACLE_SIGNER_ADDRESS    address whose signature settle() trusts
 *  PLATFORM_TREASURY_ADDRESS address the 20% platform cut is sent to
 *  STAKE_TOKEN_ADDRESS      the one ERC20 createDuel() will accept
 *                           (not required if DEPLOY_MOCK_STAKE_TOKEN=true)
 *  MIN_BUY_IN               smallest buyIn createDuel() accepts, in stake-token
 *                           units (optional with the mock token: defaults to 1e18)
 *
 * Optional:
 *  DEPLOY_MOCK_STAKE_TOKEN=true   also deploys MockERC20 (mUSD), mints
 *  1,000,000 mUSD to the deployer, and uses it as the factory's approved
 *  stake token instead of STAKE_TOKEN_ADDRESS. This is a test-only,
 *  mint-on-demand token -- local/testnet use only, never point production at
 *  it. Production configures a real stablecoin address instead.
 */
contract DeployDuel is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address oracleSigner = vm.envAddress("ORACLE_SIGNER_ADDRESS");
        address platformTreasury = vm.envAddress("PLATFORM_TREASURY_ADDRESS");
        bool deployMockStakeToken = vm.envOr("DEPLOY_MOCK_STAKE_TOKEN", false);

        vm.startBroadcast(deployerPrivateKey);

        BattleEscrow implementation = new BattleEscrow();
        console.log("BattleEscrow implementation:", address(implementation));

        address stakeToken;
        if (deployMockStakeToken) {
            MockERC20 mockStakeToken = new MockERC20();
            address deployer = vm.addr(deployerPrivateKey);
            mockStakeToken.mint(deployer, 1_000_000e18);
            stakeToken = address(mockStakeToken);
            console.log("MockERC20 stake token (mUSD):", stakeToken);
        } else {
            stakeToken = vm.envAddress("STAKE_TOKEN_ADDRESS");
        }

        // Mock mUSD has 18 decimals, so default the floor to 1 mUSD there. For a
        // real stablecoin MIN_BUY_IN is required (e.g. 1000000 = 1 USDC at 6 decimals).
        uint256 minBuyIn = deployMockStakeToken ? vm.envOr("MIN_BUY_IN", uint256(1e18)) : vm.envUint("MIN_BUY_IN");

        BattleEscrowFactory factory =
            new BattleEscrowFactory(address(implementation), oracleSigner, platformTreasury, stakeToken, minBuyIn);
        console.log("BattleEscrowFactory:", address(factory));
        console.log("oracleSigner:", oracleSigner);
        console.log("platformTreasury:", platformTreasury);
        console.log("approvedStakeToken:", stakeToken);
        console.log("minBuyIn:", minBuyIn);

        vm.stopBroadcast();
    }
}
