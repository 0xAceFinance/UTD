// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "../../src/rewards/CombatRecordNFT.sol";

contract CombatRecordNFTAdversarialTest is Test {
    CombatRecordNFT nft;
    address pointsOracle = address(0xAAA1);
    address vault = address(0xAAA2);
    address player = address(0xB0B);
    address otherPlayer = address(0xB0B2);
    address rando = address(0xC0C);

    function setUp() public {
        nft = new CombatRecordNFT(pointsOracle);
        vm.prank(nft.owner());
        nft.setRedemptionVault(vault);
    }

    // ==================== access control ====================

    function test_onlyOwnerCanSetPointsOracle() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        nft.setPointsOracle(rando);
    }

    function test_onlyOwnerCanSetRedemptionVault() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        nft.setRedemptionVault(rando);
    }

    function test_setPointsOracleRejectsZeroAddress() public {
        vm.expectRevert("bad oracle");
        nft.setPointsOracle(address(0));
    }

    function test_setRedemptionVaultRejectsZeroAddress() public {
        vm.expectRevert("bad vault");
        nft.setRedemptionVault(address(0));
    }

    function test_constructorRejectsZeroPointsOracle() public {
        vm.expectRevert("bad oracle");
        new CombatRecordNFT(address(0));
    }

    // ==================== double-action / boundary ====================

    function test_addPointsRejectsZeroAmount() public {
        vm.prank(pointsOracle);
        vm.expectRevert("zero amount");
        nft.addPoints(player, 0);
    }

    function test_markRedeemed_exactlyAllAvailablePoints_succeeds_leavesZeroAvailable() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 500);

        vm.prank(vault);
        nft.markRedeemed(player, 500); // exact-equal boundary, not one over

        assertEq(nft.availablePoints(player), 0);
        assertEq(nft.totalPoints(player), 500); // lifetime total is untouched -> tier unaffected
    }

    function test_availablePointsNeverGoesNegative_evenAcrossMultipleRedemptions() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 1_000);

        vm.startPrank(vault);
        nft.markRedeemed(player, 400);
        nft.markRedeemed(player, 600); // now exactly zero available
        vm.stopPrank();

        assertEq(nft.availablePoints(player), 0);

        vm.prank(vault);
        vm.expectRevert("insufficient available points");
        nft.markRedeemed(player, 1); // one more than available -> must revert, not underflow
    }

    function test_soulbound_cannotBeSafeTransferred() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 100);
        uint256 tokenId = nft.tokenIdOf(player);

        vm.prank(player);
        vm.expectRevert("Combat Record is soulbound: non-transferable");
        nft.safeTransferFrom(player, otherPlayer, tokenId);
    }

    function test_soulbound_setApprovalForAllReverts() public {
        vm.prank(player);
        vm.expectRevert("Combat Record is soulbound: cannot be approved for transfer");
        nft.setApprovalForAll(otherPlayer, true);
    }

    // ==================== tier boundaries (exact + one below), fresh wallets ====================

    function test_tierBoundary_oneBelowSilver_isBronze() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 4_999);
        assertEq(nft.tierOf(player), "Bronze");
    }

    function test_tierBoundary_exactlySilver() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 5_000);
        assertEq(nft.tierOf(player), "Silver");
    }

    function test_tierBoundary_oneBelowGold_isSilver() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 24_999);
        assertEq(nft.tierOf(player), "Silver");
    }

    function test_tierBoundary_exactlyGold() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 25_000);
        assertEq(nft.tierOf(player), "Gold");
    }

    function test_tierBoundary_oneBelowDiamond_isGold() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 99_999);
        assertEq(nft.tierOf(player), "Gold");
    }

    function test_tierBoundary_exactlyDiamond() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 100_000);
        assertEq(nft.tierOf(player), "Diamond");
    }

    // ==================== invariant ====================

    function test_totalPointsNeverDecreases_regardlessOfRedemption() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 10_000);
        uint256 totalBefore = nft.totalPoints(player);

        vm.prank(vault);
        nft.markRedeemed(player, 7_000);

        assertEq(nft.totalPoints(player), totalBefore); // unaffected -> tier can never regress
        assertEq(nft.tierOf(player), "Silver"); // still >= 5,000 even after "spending" points
    }
}
