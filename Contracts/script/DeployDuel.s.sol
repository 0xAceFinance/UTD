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
 *
 * Optional:
 *  DEPLOY_MOCK_STAKE_TOKEN=true   also deploys MockERC20 (mUSD) as the stake
 *  token and mints 1,000,000 mUSD to the deployer. This is a test-only,
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

        BattleEscrowFactory factory = new BattleEscrowFactory(address(implementation), oracleSigner, platformTreasury);
        console.log("BattleEscrowFactory:", address(factory));
        console.log("oracleSigner:", oracleSigner);
        console.log("platformTreasury:", platformTreasury);

        if (deployMockStakeToken) {
            MockERC20 stakeToken = new MockERC20();
            address deployer = vm.addr(deployerPrivateKey);
            stakeToken.mint(deployer, 1_000_000e18);
            console.log("MockERC20 stake token (mUSD):", address(stakeToken));
        }

        vm.stopBroadcast();
    }
}
