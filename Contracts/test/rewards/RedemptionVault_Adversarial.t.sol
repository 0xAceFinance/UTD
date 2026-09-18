// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "../../src/rewards/CombatRecordNFT.sol";
import "../../src/rewards/RedemptionVault.sol";
import "../duel/MockERC20.sol";

contract RedemptionVaultAdversarialTest is Test {
    CombatRecordNFT nft;
    RedemptionVault vault;
    MockERC20 rewardToken;

    address pointsOracle = address(0xAAA1);
    address player = address(0xB0B);
    address player2 = address(0xB0B2);
    address rando = address(0xC0C);

    uint256 constant RATE = 1e15; // 0.001 reward token per point

    function setUp() public {
        nft = new CombatRecordNFT(pointsOracle);
        rewardToken = new MockERC20();
        vault = new RedemptionVault(address(rewardToken), address(nft), RATE);

        nft.setRedemptionVault(address(vault));
        rewardToken.mint(address(vault), 10_000_000e18);

        vm.prank(pointsOracle);
        nft.addPoints(player, 30_000); // Gold tier, cap 8,000 pts/epoch

        vm.prank(pointsOracle);
        nft.addPoints(player2, 30_000);
    }

    // ==================== access control ====================

    function test_onlyOwnerCanSetTierCap() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        vault.setTierCap("Gold", 99_999);
    }

    function test_constructorRejectsZeroRewardToken() public {
        vm.expectRevert("bad address");
        new RedemptionVault(address(0), address(nft), RATE);
    }

    function test_constructorRejectsZeroCombatRecord() public {
        vm.expectRevert("bad address");
        new RedemptionVault(address(rewardToken), address(0), RATE);
    }

    // ==================== double-action / boundary ====================

    function test_redeemZeroAmountReverts() public {
        vm.prank(player);
        vm.expectRevert("zero amount");
        vault.redeem(0);
    }

    function test_redeemExactlyAtTierCap_thenOneMoreInSameEpochReverts() public {
        vm.startPrank(player);
        vault.redeem(8_000); // exactly the Gold cap
        vm.expectRevert("exceeds this tier's per-epoch redemption cap");
        vault.redeem(1); // one more point, same epoch -> must revert
        vm.stopPrank();
    }

    function test_epochCapExactTransitionBoundary() public {
        uint256 epochLen = vault.epochLengthSeconds();
        uint256 currentEpoch = block.timestamp / epochLen;
        uint256 nextEpochStart = (currentEpoch + 1) * epochLen;

        vm.startPrank(player);
        vault.redeem(8_000); // fills the cap in the current epoch

        // Warp to the exact first second of the next epoch (not "+1 extra second" slack).
        vm.warp(nextEpochStart);
        vault.redeem(8_000); // must succeed: brand-new epoch, cap reset
        vm.stopPrank();

        assertEq(vault.schedulesLength(player), 2);
    }

    function test_epochCapOneSecondBeforeTransition_stillOldEpoch() public {
        uint256 epochLen = vault.epochLengthSeconds();
        uint256 currentEpoch = block.timestamp / epochLen;
        uint256 nextEpochStart = (currentEpoch + 1) * epochLen;

        vm.startPrank(player);
        vault.redeem(8_000);

        vm.warp(nextEpochStart - 1); // last second of the *current* epoch
        vm.expectRevert("exceeds this tier's per-epoch redemption cap");
        vault.redeem(1);
        vm.stopPrank();
    }

    function test_setTierCapToZero_blocksAllRedemptionForThatTier() public {
        vault.setTierCap("Gold", 0);
        vm.prank(player);
        vm.expectRevert("exceeds this tier's per-epoch redemption cap");
        vault.redeem(1);
    }

    /// @dev Previously a zero (or misconfigured near-zero) rate let redeem()
    /// silently burn the wallet's points for a zero-value vesting schedule --
    /// markRedeemed() ran regardless of what tokenAmount worked out to. Fixed
    /// by rejecting the redemption outright before any points are spent.
    function test_rateZero_redeemRevertsInsteadOfBurningPointsForNothing() public {
        vault.setRate(0);
        uint256 availableBefore = nft.availablePoints(player);

        vm.prank(player);
        vm.expectRevert("rate too low: this would redeem for zero reward tokens");
        vault.redeem(1_000);

        assertEq(nft.availablePoints(player), availableBefore); // points untouched
        assertEq(vault.schedulesLength(player), 0); // no zero-value schedule created
    }

    // ==================== vesting math boundaries ====================

    function test_vesting_atTimeZero_isZero() public {
        vm.prank(player);
        vault.redeem(1_000); // 1e18 total
        assertEq(vault.claimableAmount(player), 0);
    }

    function test_vesting_oneSecondBeforeFullDuration_isLessThanTotal() public {
        vm.prank(player);
        vault.redeem(1_000);
        uint256 duration = vault.vestingDurationSeconds();

        vm.warp(block.timestamp + duration - 1);
        uint256 claimable = vault.claimableAmount(player);
        assertLt(claimable, 1e18);
        assertEq(claimable, (1e18 * (duration - 1)) / duration);
    }

    function test_vesting_atExactFullDuration_equalsTotalExactly() public {
        vm.prank(player);
        vault.redeem(1_000);
        uint256 duration = vault.vestingDurationSeconds();

        vm.warp(block.timestamp + duration);
        assertEq(vault.claimableAmount(player), 1e18);
    }

    function test_vesting_longAfterDuration_neverExceedsTotal() public {
        vm.prank(player);
        vault.redeem(1_000);
        uint256 duration = vault.vestingDurationSeconds();

        vm.warp(block.timestamp + duration * 50);
        assertEq(vault.claimableAmount(player), 1e18); // never more than 100%
    }

    function testFuzz_vestingNeverExceedsTotalAmount(uint256 points, uint256 warpTime) public {
        points = bound(points, 1, 8_000); // stay within Gold's per-epoch cap
        warpTime = bound(warpTime, 0, 3650 days);

        vm.prank(player);
        vault.redeem(points);
        vm.warp(block.timestamp + warpTime);

        uint256 expectedTotal = points * RATE;
        assertLe(vault.claimableAmount(player), expectedTotal);
    }

    // ==================== claim invariants: never pays more than vested ====================

    function test_claimNeverPaysMoreThanVested_acrossMultiplePartialClaims() public {
        vm.prank(player);
        vault.redeem(1_000); // 1e18 total, 60-day default vesting

        uint256 totalPaidOut = 0;

        vm.warp(block.timestamp + 20 days);
        uint256 before1 = rewardToken.balanceOf(player);
        vm.prank(player);
        vault.claim();
        totalPaidOut += rewardToken.balanceOf(player) - before1;
        assertLe(totalPaidOut, 1e18);

        vm.warp(block.timestamp + 20 days); // day 40
        uint256 before2 = rewardToken.balanceOf(player);
        vm.prank(player);
        vault.claim();
        totalPaidOut += rewardToken.balanceOf(player) - before2;
        assertLe(totalPaidOut, 1e18);

        vm.warp(block.timestamp + 30 days); // well past day 60, fully vested
        uint256 before3 = rewardToken.balanceOf(player);
        vm.prank(player);
        vault.claim();
        totalPaidOut += rewardToken.balanceOf(player) - before3;

        // Sum of every partial claim must equal exactly the scheduled total —
        // no dust created, and (thanks to the `>= startTime + duration` snap-to-total)
        // no dust permanently stuck either.
        assertEq(totalPaidOut, 1e18);
    }

    function test_claimAcrossOverlappingSchedulesNeverExceedsSumOfTotals() public {
        vm.startPrank(player);
        vault.redeem(1_000); // schedule 0: starts now, 1e18 total
        vm.warp(block.timestamp + 10 days);
        vault.redeem(2_000); // schedule 1: starts +10d, 2e18 total
        vm.warp(block.timestamp + 15 days);
        vault.redeem(1_500); // schedule 2: starts +25d, 1.5e18 total
        vm.stopPrank();

        uint256 sumOfTotals = 1e18 + 2e18 + 1.5e18;

        // Partial claim mid-flight.
        vm.warp(block.timestamp + 10 days);
        uint256 before = rewardToken.balanceOf(player);
        vm.prank(player);
        vault.claim();
        uint256 claimedSoFar = rewardToken.balanceOf(player) - before;
        assertLe(claimedSoFar, sumOfTotals);

        // Fast-forward well past every schedule's vesting window and claim the rest.
        vm.warp(block.timestamp + 200 days);
        vm.prank(player);
        vault.claim();

        assertEq(rewardToken.balanceOf(player), sumOfTotals); // exact — no leakage, no overpay
        assertEq(vault.claimableAmount(player), 0);
    }

    function test_claimRevertsWithNothingVested_freshSchedule() public {
        vm.prank(player);
        vault.redeem(1_000);

        vm.prank(player);
        vm.expectRevert("nothing vested to claim");
        vault.claim(); // startTime == now, nothing vested yet
    }

    function test_claimWithNoSchedulesAtAllReverts() public {
        vm.prank(rando);
        vm.expectRevert("nothing vested to claim");
        vault.claim();
    }

    // ==================== independence between wallets ====================

    function test_oneWalletsRedemptionDoesNotAffectAnothersEpochCap() public {
        vm.prank(player);
        vault.redeem(8_000); // player hits Gold cap

        // player2 is a completely independent wallet/epoch-cap bucket.
        vm.prank(player2);
        vault.redeem(8_000); // must succeed independently
        assertEq(vault.schedulesLength(player2), 1);
    }

    // ==================== solvency (pool can't be over-promised) ====================

    function test_redeemRejectsWhenThePoolCantCoverTheNewSchedule() public {
        RedemptionVault small = new RedemptionVault(address(rewardToken), address(nft), RATE);
        nft.setRedemptionVault(address(small));
        rewardToken.mint(address(small), 5e18); // covers 5,000 points at RATE

        vm.prank(player);
        small.redeem(5_000);
        assertEq(small.totalCommitted(), 5e18);

        vm.prank(player2);
        vm.expectRevert("rewards pool exhausted");
        small.redeem(1); // would promise tokens the pool doesn't hold
        assertEq(nft.availablePoints(player2), 30_000); // points not burned
    }

    function test_claimReleasesCommittedTokens() public {
        vm.prank(player);
        vault.redeem(1_000);
        vm.warp(block.timestamp + vault.vestingDurationSeconds());
        vm.prank(player);
        vault.claim();
        assertEq(vault.totalCommitted(), 0);
    }
}
