// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "../../src/rewards/CombatRecordNFT.sol";

contract CombatRecordNFTTest is Test {
    CombatRecordNFT nft;
    address pointsOracle = address(0xAAA1);
    address vault = address(0xAAA2);
    address player = address(0xB0B);
    address otherPlayer = address(0xB0B2);

    function setUp() public {
        nft = new CombatRecordNFT(pointsOracle);
        vm.prank(nft.owner());
        nft.setRedemptionVault(vault);
    }

    function test_mintsOnFirstPointsAward() public {
        assertEq(nft.tokenIdOf(player), 0);
        vm.prank(pointsOracle);
        nft.addPoints(player, 100);

        assertGt(nft.tokenIdOf(player), 0);
        assertEq(nft.ownerOf(nft.tokenIdOf(player)), player);
        assertEq(nft.totalPoints(player), 100);
    }

    function test_doesNotMintASecondTokenOnRepeatAwards() public {
        vm.startPrank(pointsOracle);
        nft.addPoints(player, 100);
        uint256 firstTokenId = nft.tokenIdOf(player);
        nft.addPoints(player, 50);
        vm.stopPrank();

        assertEq(nft.tokenIdOf(player), firstTokenId);
        assertEq(nft.totalPoints(player), 150);
    }

    function test_onlyPointsOracleCanAddPoints() public {
        vm.prank(player);
        vm.expectRevert("only points oracle");
        nft.addPoints(player, 100);
    }

    function test_tiersMatchTheSpecThresholds() public {
        vm.startPrank(pointsOracle);
        nft.addPoints(player, 4_999);
        assertEq(nft.tierOf(player), "Bronze");
        nft.addPoints(player, 1); // crosses to 5,000
        assertEq(nft.tierOf(player), "Silver");
        nft.addPoints(player, 20_000); // 25,000
        assertEq(nft.tierOf(player), "Gold");
        nft.addPoints(player, 75_000); // 100,000
        assertEq(nft.tierOf(player), "Diamond");
        vm.stopPrank();
    }

    function test_soulbound_cannotBeTransferred() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 100);
        uint256 tokenId = nft.tokenIdOf(player);

        vm.prank(player);
        vm.expectRevert("Combat Record is soulbound: non-transferable");
        nft.transferFrom(player, otherPlayer, tokenId);
    }

    function test_soulbound_cannotBeApproved() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 100);
        uint256 tokenId = nft.tokenIdOf(player);

        vm.prank(player);
        vm.expectRevert("Combat Record is soulbound: cannot be approved for transfer");
        nft.approve(otherPlayer, tokenId);
    }

    function test_vaultCanMarkPointsRedeemed_reducingAvailableNotTotal() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 1_000);

        vm.prank(vault);
        nft.markRedeemed(player, 400);

        assertEq(nft.totalPoints(player), 1_000); // lifetime total unaffected -> tier stays put
        assertEq(nft.availablePoints(player), 600);
    }

    function test_cannotRedeemMoreThanAvailable() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 100);

        vm.prank(vault);
        vm.expectRevert("insufficient available points");
        nft.markRedeemed(player, 101);
    }

    function test_onlyVaultCanMarkRedeemed() public {
        vm.prank(pointsOracle);
        nft.addPoints(player, 100);

        vm.prank(player);
        vm.expectRevert("only redemption vault");
        nft.markRedeemed(player, 10);
    }
}
