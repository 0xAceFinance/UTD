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

    /// @dev Previously _vestedAmount() read the *current* global
    /// vestingDurationSeconds at claim time, not the value in effect when the
    /// schedule was created -- so lengthening the global duration after a
    /// wallet had already partially claimed could make the recomputed vested
    /// amount dip below what they'd already claimed, underflowing and
    /// reverting claim() for their entire batch (every schedule, not just the
    /// affected one) until enough real time passed to catch back up. Fixed by
    /// snapshotting the duration into each schedule at redeem() time.
    function test_changingGlobalVestingDurationDoesNotAffectAlreadyCreatedSchedules() public {
        vm.prank(player);
        vault.redeem(1_000); // 1 token total, vesting over the default 60 days

        vm.warp(block.timestamp + 30 days); // halfway through the original 60-day schedule
        uint256 halfwayBefore = vault.claimableAmount(player);
        assertApproxEqAbs(halfwayBefore, 0.5e18, 1e14);

        vm.prank(player);
        vault.claim(); // claims the ~halfway amount

        // Admin lengthens the global vesting duration -- must not retroactively
        // reprice this already-created, already-partially-claimed schedule.
        vault.setVestingDuration(90 days);

        // Immediately after the change, at the same point in time, claimable
        // must be unaffected (still ~0 further vested, not an underflow revert).
        assertEq(vault.claimableAmount(player), 0);
        vm.prank(player);
        vm.expectRevert("nothing vested to claim");
        vault.claim();

        // The schedule still resolves fully at its *original* 60-day mark,
        // unaffected by the new 90-day global default.
        vm.warp(block.timestamp + 30 days); // 60 days total elapsed
        assertEq(vault.claimableAmount(player), 0.5e18); // the remaining half
    }

    function test_newSchedulesUseWhicheverDurationWasCurrentWhenCreated() public {
        vault.setVestingDuration(90 days);
        vm.prank(player);
        vault.redeem(1_000);

        vm.warp(block.timestamp + 60 days); // would be fully vested under the OLD 60-day default
        assertApproxEqAbs(vault.claimableAmount(player), 0.667e18, 1e15); // ~2/3 through a 90-day schedule

        vm.warp(block.timestamp + 30 days); // 90 days total elapsed
        assertEq(vault.claimableAmount(player), 1e18); // fully vested at the schedule's own duration
    }
}
