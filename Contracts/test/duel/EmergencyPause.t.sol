// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../src/duel/BattleEscrow.sol";
import "../../src/duel/BattleEscrowFactory.sol";
import "./MockERC20.sol";

/// @dev Emergency pause: blocks new duels and every oracle-signed outcome, while
/// every exit (cancel, expire, refundStale, withdraw) stays open.
contract EmergencyPauseTest is Test {
    MockERC20 usd;
    BattleEscrowFactory factory;

    uint256 oracleKey = 0xA11CE;
    address creator = address(0xC1);
    address opponent = address(0xC2);
    address rando = address(0xBAD);

    uint256 constant BUY_IN = 100e18;
    uint256 constant DURATION = 15 minutes;

    function setUp() public {
        usd = new MockERC20();
        factory = new BattleEscrowFactory(address(new BattleEscrow()), vm.addr(oracleKey), address(0x7EA), address(usd), 1);
        usd.mint(creator, 1_000e18);
        usd.mint(opponent, 1_000e18);
        vm.prank(creator);
        usd.approve(address(factory), type(uint256).max);
        vm.prank(opponent);
        usd.approve(address(factory), type(uint256).max);
    }

    function _create() internal returns (BattleEscrow) {
        vm.prank(creator);
        return BattleEscrow(factory.createDuel(address(usd), BUY_IN, 0, DURATION, "A", "B"));
    }

    function _createAndJoin() internal returns (BattleEscrow duel) {
        duel = _create();
        vm.prank(opponent);
        factory.joinDuel(address(duel));
    }

    function _sign(BattleEscrow duel, uint8 marker) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(address(duel), marker, block.chainid)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_onlyOwnerCanPauseAndUnpause() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.pause();

        factory.pause();

        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.unpause();
    }

    function test_pauseBlocksCreateAndJoin() public {
        BattleEscrow lobby = _create();
        factory.pause();

        vm.prank(creator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        factory.createDuel(address(usd), BUY_IN, 0, DURATION, "A", "B");

        vm.prank(opponent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        factory.joinDuel(address(lobby));
    }

    function test_pauseBlocksSettleAndVoidSoALeakedKeyCantPickWinners() public {
        BattleEscrow duel = _createAndJoin();
        vm.warp(block.timestamp + DURATION);
        factory.pause();

        vm.expectRevert("paused");
        duel.settle(0, _sign(duel, 0));

        vm.expectRevert("paused");
        duel.voidActive(_sign(duel, 2));
    }

    function test_refundStaleStillWorksWhilePaused() public {
        BattleEscrow duel = _createAndJoin();
        factory.pause();
        vm.warp(block.timestamp + DURATION + duel.STALE_REFUND_GRACE_PERIOD());

        duel.refundStale();

        assertEq(usd.balanceOf(creator), 1_000e18);
        assertEq(usd.balanceOf(opponent), 1_000e18);
    }

    function test_cancelAndExpireStillWorkWhilePaused() public {
        BattleEscrow toCancel = _create();
        BattleEscrow toExpire = _create();
        factory.pause();

        vm.prank(creator);
        factory.cancelDuel(address(toCancel));
        assertEq(uint8(toCancel.status()), uint8(BattleEscrow.Status.Refunded));

        vm.warp(block.timestamp + toExpire.MAX_OPEN_WINDOW() + 1);
        factory.expireDuel(address(toExpire));
        assertEq(uint8(toExpire.status()), uint8(BattleEscrow.Status.Refunded));
        assertEq(usd.balanceOf(creator), 1_000e18);
    }

    function test_unpauseRestoresSettlement() public {
        BattleEscrow duel = _createAndJoin();
        vm.warp(block.timestamp + DURATION);
        bytes memory sig = _sign(duel, 1);

        factory.pause();
        factory.unpause();

        duel.settle(1, sig);
        assertEq(uint8(duel.status()), uint8(BattleEscrow.Status.Settled));
    }
}
