// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "../../src/rewards/CombatRecordNFT.sol";
import "../../src/rewards/RedemptionVault.sol";
import "../duel/MockERC20.sol";

contract RedemptionVaultTest is Test {
    CombatRecordNFT nft;
    RedemptionVault vault;
    MockERC20 rewardToken;

    address pointsOracle = address(0xAAA1);
    address player = address(0xB0B);

    uint256 constant RATE = 1e15; // 0.001 reward token per point

    function setUp() public {
        nft = new CombatRecordNFT(pointsOracle);
        rewardToken = new MockERC20();
        vault = new RedemptionVault(address(rewardToken), address(nft), RATE);

        nft.setRedemptionVault(address(vault));
        rewardToken.mint(address(vault), 1_000_000e18); // fund the fixed rewards pool

        vm.prank(pointsOracle);
        nft.addPoints(player, 30_000); // lands player in Gold (>= 25,000; cap: 8,000 pts/epoch)
    }

    function test_redeemCreatesAVestingScheduleAtTheConfiguredRate() public {
        vm.prank(player);
        vault.redeem(1_000);

        assertEq(vault.schedulesLength(player), 1);
        assertEq(nft.availablePoints(player), 29_000);
        // 1,000 points x 0.001 token/point = 1 token
        assertEq(vault.claimableAmount(player), 0); // nothing vested yet, startTime == now
    }

    function test_cannotRedeemMoreThanAvailablePoints() public {
        vm.prank(player);
        vm.expectRevert("insufficient points");
        vault.redeem(30_001);
    }

    function test_cannotExceedTierCapPerEpoch() public {
        // Gold cap is 8,000 points per epoch (1 day).
        vm.prank(player);
        vm.expectRevert("exceeds this tier's per-epoch redemption cap");
        vault.redeem(8_001);
    }

    function test_capResetsInANewEpoch() public {
        vm.startPrank(player);
        vault.redeem(8_000); // hits the Gold cap exactly
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(player);
        vault.redeem(1_000); // new epoch, cap reset
        assertEq(vault.schedulesLength(player), 2);
    }

    function test_vestingReleasesLinearlyOverTime() public {
        vm.prank(player);
        vault.redeem(1_000); // -> 1 token total, vesting over 60 days default

        vm.warp(block.timestamp + 30 days); // halfway
        uint256 halfway = vault.claimableAmount(player);
        assertApproxEqAbs(halfway, 0.5e18, 1e14);

        vm.warp(block.timestamp + 30 days); // fully vested
        uint256 full = vault.claimableAmount(player);
        assertEq(full, 1e18);
    }

    function test_claimTransfersVestedTokensAndUpdatesClaimedAmount() public {
        vm.prank(player);
        vault.redeem(1_000);

        vm.warp(block.timestamp + 60 days); // fully vested

        vm.prank(player);
        vault.claim();

        assertEq(rewardToken.balanceOf(player), 1e18);
        assertEq(vault.claimableAmount(player), 0); // already claimed
    }

    function test_claimingTwiceWithNothingNewVestedReverts() public {
        vm.prank(player);
        vault.redeem(1_000);
        vm.warp(block.timestamp + 60 days);

        vm.prank(player);
        vault.claim();

        vm.prank(player);
        vm.expectRevert("nothing vested to claim");
        vault.claim();
    }

    function test_multipleRedemptionsSumAcrossIndependentSchedules() public {
        vm.startPrank(player);
        vault.redeem(1_000); // schedule 0, starts now
        vm.warp(block.timestamp + 30 days);
        vault.redeem(1_000); // schedule 1, starts 30 days later
        vm.stopPrank();

        vm.warp(block.timestamp + 30 days); // schedule 0 fully vested (60d), schedule 1 halfway (30/60d)
        uint256 claimable = vault.claimableAmount(player);
        assertApproxEqAbs(claimable, 1.5e18, 1e14);
    }

    function test_onlyOwnerCanChangeRateOrVestingOrCaps() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player));
        vault.setRate(2e15);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", player));
        vault.setVestingDuration(45 days);
    }

    function test_vestingDurationMustStayWithinSpecBounds() public {
        vm.expectRevert("must be within the spec's 30-90 day range");
        vault.setVestingDuration(10 days);

        vm.expectRevert("must be within the spec's 30-90 day range");
        vault.setVestingDuration(120 days);

        vault.setVestingDuration(90 days); // boundary, should succeed
        assertEq(vault.vestingDurationSeconds(), 90 days);
    }
}
