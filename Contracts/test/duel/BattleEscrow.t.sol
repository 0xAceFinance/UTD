// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../src/duel/BattleEscrow.sol";
import "../../src/duel/BattleEscrowFactory.sol";
import "./MockERC20.sol";

contract BattleEscrowTest is Test {
    using MessageHashUtils for bytes32;

    BattleEscrow implementation;
    BattleEscrowFactory factory;
    MockERC20 stakeToken;

    uint256 oracleSignerKey = 0xA11CE;
    address oracleSigner;
    address platformTreasury = address(0xFEE);

    address creator = address(0x1001);
    address opponent = address(0x1002);
    address rando = address(0x1003);

    uint256 constant BUY_IN = 100e18;
    uint256 constant DURATION = 20 minutes;

    function setUp() public {
        oracleSigner = vm.addr(oracleSignerKey);

        implementation = new BattleEscrow();
        factory = new BattleEscrowFactory(address(implementation), oracleSigner, platformTreasury);
        stakeToken = new MockERC20();

        stakeToken.mint(creator, 1_000e18);
        stakeToken.mint(opponent, 1_000e18);

        vm.prank(creator);
        stakeToken.approve(address(factory), type(uint256).max);
        vm.prank(opponent);
        stakeToken.approve(address(factory), type(uint256).max);
    }

    function _createDuel() internal returns (address duel) {
        vm.prank(creator);
        duel = factory.createDuel(address(stakeToken), BUY_IN, 0, DURATION, "TOKA", "TOKB");
    }

    function _signSettlement(address duel, uint8 winnerSide) internal returns (bytes memory) {
        bytes32 message = keccak256(abi.encodePacked(duel, winnerSide));
        bytes32 digest = message.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---- happy path ----

    function test_fullDuel_winnerGets80PercentLoserGetsNothingPlatformGets20Percent() public {
        address duel = _createDuel();

        vm.prank(opponent);
        factory.joinDuel(duel);

        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Active));
        assertEq(stakeToken.balanceOf(duel), BUY_IN * 2);

        vm.warp(block.timestamp + DURATION + 1);

        // creatorSide = 0 wins
        bytes memory sig = _signSettlement(duel, 0);
        BattleEscrow(duel).settle(0, sig);

        assertEq(stakeToken.balanceOf(creator), 1_000e18 - BUY_IN + (BUY_IN * 2 * 8000) / 10000);
        assertEq(stakeToken.balanceOf(opponent), 1_000e18 - BUY_IN); // loser: gets nothing back on-chain
        assertEq(stakeToken.balanceOf(platformTreasury), (BUY_IN * 2 * 2000) / 10000);
        assertEq(stakeToken.balanceOf(duel), 0);
    }

    function test_opponentSideWinning_paysOpponent() public {
        address duel = _createDuel(); // creator picked side 0
        vm.prank(opponent);
        factory.joinDuel(duel); // opponent is auto-assigned side 1

        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sig = _signSettlement(duel, 1); // side 1 (opponent) wins
        BattleEscrow(duel).settle(1, sig);

        assertEq(stakeToken.balanceOf(opponent), 1_000e18 - BUY_IN + (BUY_IN * 2 * 8000) / 10000);
        assertEq(stakeToken.balanceOf(creator), 1_000e18 - BUY_IN);
    }

    // ---- cancellation / expiry ----

    function test_creatorCanCancelBeforeMatch_getsFullRefund() public {
        address duel = _createDuel();
        vm.prank(creator);
        factory.cancelDuel(duel);

        assertEq(stakeToken.balanceOf(creator), 1_000e18);
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
    }

    function test_nonCreatorCannotCancel() public {
        address duel = _createDuel();
        vm.prank(rando);
        vm.expectRevert("only creator can cancel");
        factory.cancelDuel(duel);
    }

    function test_expiresAndRefundsAfterOpenWindow_permissionlessly() public {
        address duel = _createDuel();
        vm.warp(block.timestamp + 61 minutes);

        // Anyone can trigger expiry, not just the creator.
        vm.prank(rando);
        factory.expireDuel(duel);

        assertEq(stakeToken.balanceOf(creator), 1_000e18);
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
    }

    function test_cannotExpireBeforeOpenWindowPasses() public {
        address duel = _createDuel();
        vm.expectRevert("open window not passed yet");
        factory.expireDuel(duel);
    }

    // ---- security properties ----

    function test_cannotDuelYourself() public {
        address duel = _createDuel();
        vm.prank(creator);
        vm.expectRevert("cannot duel yourself");
        factory.joinDuel(duel);
    }

    function test_settleRejectsInvalidSignature() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);
        vm.warp(block.timestamp + DURATION + 1);

        uint256 wrongKey = 0xBAD;
        bytes32 message = keccak256(abi.encodePacked(duel, uint8(0)));
        bytes32 digest = message.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert("invalid oracle signature");
        BattleEscrow(duel).settle(0, badSig);
    }

    function test_cannotSettleBeforeBattleEnds() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);

        bytes memory sig = _signSettlement(duel, 0);
        vm.expectRevert("battle still live");
        BattleEscrow(duel).settle(0, sig);
    }

    function test_anyoneCanSubmitAValidSignedSettlement_notJustAKeeper() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);
        vm.warp(block.timestamp + DURATION + 1);

        bytes memory sig = _signSettlement(duel, 0);
        vm.prank(rando); // a third party submits it, not the platform's own keeper
        BattleEscrow(duel).settle(0, sig);

        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Settled));
    }

    function test_cannotCallFactoryOnlyFunctionsDirectly() public {
        address duel = _createDuel();
        vm.prank(rando);
        vm.expectRevert("only factory");
        BattleEscrow(duel).activate(rando);
    }

    function test_cannotDoubleInitialize() public {
        address duel = _createDuel();
        vm.expectRevert("already initialized");
        IBattleEscrow(duel).initialize(rando, address(stakeToken), BUY_IN, 0, DURATION, "A", "B");
    }

    function test_durationOutOfRangeReverts() public {
        vm.prank(creator);
        vm.expectRevert("duration out of range");
        factory.createDuel(address(stakeToken), BUY_IN, 0, 5 minutes, "A", "B");

        vm.prank(creator);
        vm.expectRevert("duration out of range");
        factory.createDuel(address(stakeToken), BUY_IN, 0, 41 minutes, "A", "B");
    }

    function test_onlyOwnerCanUpdateOracleSignerOrTreasury() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.setOracleSigner(rando);
    }
}
