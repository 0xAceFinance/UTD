// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "../../script/DeployRewards.s.sol";

/// Exercises script/DeployRewards.s.sol's deploy() end to end: wiring,
/// funding, ownership handoff, and that the result actually redeems.
contract DeployRewardsTest is Test {
    DeployRewards script;

    uint256 constant DEPLOYER_KEY = 0xA11CE;
    address pointsOracle = address(0xAAA1);
    address multisig = address(0x5AFE);
    address player = address(0xB0B);

    function setUp() public {
        script = new DeployRewards();
    }

    function baseConfig() internal view returns (DeployRewards.Config memory c) {
        c.deployerPrivateKey = DEPLOYER_KEY;
        c.pointsOracle = pointsOracle;
        c.tokensPerPointWad = 1e15;
        c.deployMockRewardToken = true;
        c.owner = multisig;
        c.funding = 1_000_000e18;
        c.duelOracleSigner = address(0x0DDC);
        c.relayer = address(0x7E1A);
    }

    function test_deploysWiresFundsAndHandsOffOwnership() public {
        (CombatRecordNFT nft, RedemptionVault vault) = script.deploy(baseConfig());

        assertEq(nft.pointsOracle(), pointsOracle);
        assertEq(nft.redemptionVault(), address(vault));
        assertEq(address(vault.combatRecord()), address(nft));
        assertEq(vault.tokensPerPointWad(), 1e15);
        assertEq(vault.vestingDurationSeconds(), 60 days);
        assertEq(vault.rewardToken().balanceOf(address(vault)), 1_000_000e18);
        assertEq(nft.owner(), multisig);
        assertEq(vault.owner(), multisig);
    }

    function test_deployedSystemRedeemsAndVests() public {
        (CombatRecordNFT nft, RedemptionVault vault) = script.deploy(baseConfig());

        vm.prank(pointsOracle);
        nft.addPoints(player, 2_000);
        vm.prank(player);
        vault.redeem(1_000); // Bronze cap is 1,000/epoch

        vm.warp(block.timestamp + 60 days);
        vm.prank(player);
        vault.claim();
        assertEq(vault.rewardToken().balanceOf(player), 1e18); // 1,000 pts x 0.001
        assertEq(nft.availablePoints(player), 1_000);
    }

    function test_customVestingDuration() public {
        DeployRewards.Config memory c = baseConfig();
        c.vestingDuration = 30 days;
        (, RedemptionVault vault) = script.deploy(c);
        assertEq(vault.vestingDurationSeconds(), 30 days);
    }

    function test_withoutOwnerTheDeployerKeepsOwnership() public {
        DeployRewards.Config memory c = baseConfig();
        c.owner = address(0);
        (CombatRecordNFT nft, RedemptionVault vault) = script.deploy(c);
        assertEq(nft.owner(), vm.addr(DEPLOYER_KEY));
        assertEq(vault.owner(), vm.addr(DEPLOYER_KEY));
    }

    function test_usesAnExistingRewardToken() public {
        MockERC20 token = new MockERC20();
        token.mint(vm.addr(DEPLOYER_KEY), 500e18);
        DeployRewards.Config memory c = baseConfig();
        c.deployMockRewardToken = false;
        c.rewardToken = address(token);
        c.funding = 500e18;
        (, RedemptionVault vault) = script.deploy(c);
        assertEq(address(vault.rewardToken()), address(token));
        assertEq(token.balanceOf(address(vault)), 500e18);
    }

    function test_revertsOnZeroRate() public {
        DeployRewards.Config memory c = baseConfig();
        c.tokensPerPointWad = 0;
        vm.expectRevert("TOKENS_PER_POINT_WAD must be > 0");
        script.deploy(c);
    }

    function test_revertsWhenPointsOracleReusesAnotherRole() public {
        DeployRewards.Config memory c = baseConfig();
        c.pointsOracle = c.duelOracleSigner;
        vm.expectRevert("points oracle must not be the duel oracle signer");
        script.deploy(c);

        c = baseConfig();
        c.pointsOracle = c.relayer;
        vm.expectRevert("points oracle must not be the settlement relayer");
        script.deploy(c);

        c = baseConfig();
        c.pointsOracle = multisig;
        vm.expectRevert("points oracle must not be the owner");
        script.deploy(c);
    }

    function test_revertsWhenDeployerCannotFundTheVault() public {
        MockERC20 token = new MockERC20();
        DeployRewards.Config memory c = baseConfig();
        c.deployMockRewardToken = false;
        c.rewardToken = address(token);
        c.funding = 1e18; // deployer holds none
        vm.expectRevert("deployer lacks VAULT_FUNDING_AMOUNT");
        script.deploy(c);
    }

    function test_revertsOnVestingOutsideTheSpecRange() public {
        DeployRewards.Config memory c = baseConfig();
        c.vestingDuration = 10 days;
        vm.expectRevert("must be within the spec's 30-90 day range");
        script.deploy(c);
    }
}
