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
        stakeToken = new MockERC20();
        factory = new BattleEscrowFactory(address(implementation), oracleSigner, platformTreasury, address(stakeToken), 1);

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
        return _signSettlementWithReferrers(duel, winnerSide, address(0), 0, address(0), 0);
    }

    function _signSettlementWithReferrers(
        address duel,
        uint8 winnerSide,
        address referrerA,
        uint256 referrerABps,
        address referrerB,
        uint256 referrerBBps
    ) internal returns (bytes memory) {
        bytes32 message = keccak256(
            abi.encodePacked(duel, winnerSide, referrerA, referrerABps, referrerB, referrerBBps, block.chainid)
        );
        bytes32 digest = message.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleSignerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---- happy path ----

    function test_fullDuel_winnerGets90PercentLoserGetsNothingPlatformGets10PercentWithNoReferrers() public {
        address duel = _createDuel();

        vm.prank(opponent);
        factory.joinDuel(duel);

        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Active));
        assertEq(stakeToken.balanceOf(duel), BUY_IN * 2);

        vm.warp(block.timestamp + DURATION + 1);

        // creatorSide = 0 wins, no referrer on either side
        bytes memory sig = _signSettlement(duel, 0);
        BattleEscrow(duel).settle(0, address(0), 0, address(0), 0, sig);

        assertEq(stakeToken.balanceOf(creator), 1_000e18 - BUY_IN + (BUY_IN * 2 * 9000) / 10000);
        assertEq(stakeToken.balanceOf(opponent), 1_000e18 - BUY_IN); // loser: gets nothing back on-chain
        assertEq(stakeToken.balanceOf(platformTreasury), (BUY_IN * 2 * 1000) / 10000);
        assertEq(stakeToken.balanceOf(duel), 0);
    }

    function test_opponentSideWinning_paysOpponent() public {
        address duel = _createDuel(); // creator picked side 0
        vm.prank(opponent);
        factory.joinDuel(duel); // opponent is auto-assigned side 1

        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sig = _signSettlement(duel, 1); // side 1 (opponent) wins
        BattleEscrow(duel).settle(1, address(0), 0, address(0), 0, sig);

        assertEq(stakeToken.balanceOf(opponent), 1_000e18 - BUY_IN + (BUY_IN * 2 * 9000) / 10000);
        assertEq(stakeToken.balanceOf(creator), 1_000e18 - BUY_IN);
    }

    /// @dev creator's referrer (referrerA) is at the top 5% tier, opponent's
    /// referrer (referrerB) is at the 2% tier -- both get paid on their own
    /// referred player's stake regardless of who won, and the platform keeps
    /// whatever's left of the 10% that isn't the winner's fixed 90%.
    function test_fullDuel_paysBothReferrersAtTheirOwnRatesRegardlessOfWinner() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);
        vm.warp(block.timestamp + DURATION + 1);

        address referrerA = address(0x5001); // creator's referrer, top tier
        address referrerB = address(0x5002); // opponent's (the winner's) referrer, 2% tier
        uint256 referrerABps = 500;
        uint256 referrerBBps = 200;

        bytes memory sig = _signSettlementWithReferrers(duel, 1, referrerA, referrerABps, referrerB, referrerBBps);
        BattleEscrow(duel).settle(1, referrerA, referrerABps, referrerB, referrerBBps, sig);

        uint256 pot = BUY_IN * 2;
        uint256 winnerAmount = (pot * 9000) / 10000;
        uint256 referrerAAmount = (BUY_IN * referrerABps) / 10000;
        uint256 referrerBAmount = (BUY_IN * referrerBBps) / 10000;
        uint256 platformAmount = pot - winnerAmount - referrerAAmount - referrerBAmount;

        assertEq(stakeToken.balanceOf(opponent), 1_000e18 - BUY_IN + winnerAmount);
        assertEq(stakeToken.balanceOf(referrerA), referrerAAmount);
        assertEq(stakeToken.balanceOf(referrerB), referrerBAmount);
        assertEq(stakeToken.balanceOf(platformTreasury), platformAmount);
        assertEq(winnerAmount + referrerAAmount + referrerBAmount + platformAmount, pot);
    }

    /// @dev The whole point of reading winnerBps/maxReferrerBps live from the
    /// factory instead of baking them into BattleEscrow as constants: the
    /// owner can retune the fee split for FUTURE duels on the existing,
    /// already-deployed factory and implementation -- but a duel already
    /// activated keeps the terms it started under (snapshotted at activate()),
    /// so neither player's locked stake can be repriced underneath them.
    function test_settleUsesTheWinnerBpsSnapshottedWhenTheDuelWasActivated() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);
        assertEq(BattleEscrow(duel).winnerBps(), 9_000);

        // Retuned *after* the duel was created and joined: must not apply here.
        factory.setWinnerBps(9_500);

        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sig = _signSettlement(duel, 0);
        BattleEscrow(duel).settle(0, address(0), 0, address(0), 0, sig);

        uint256 pot = BUY_IN * 2;
        assertEq(stakeToken.balanceOf(creator), 1_000e18 - BUY_IN + (pot * 9_000) / 10000);
        assertEq(stakeToken.balanceOf(platformTreasury), pot - (pot * 9_000) / 10000);
    }

    /// @dev MONEY SAFETY: the owner key alone (no oracle key) must not be able
    /// to take a cut of a pot that is already staked. Before the snapshot,
    /// setWinnerBps(floor) + setPlatformTreasury(attacker) during a live duel
    /// diverted 40% of the pot from the winner on an honest, already-signed
    /// settlement.
    function test_ownerCannotRepriceOrRedirectAnAlreadyActiveDuel() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);

        address attacker = address(0xBAD);
        factory.setWinnerBps(factory.MIN_WINNER_BPS());
        factory.setPlatformTreasury(attacker);

        vm.warp(block.timestamp + DURATION + 1);
        BattleEscrow(duel).settle(0, address(0), 0, address(0), 0, _signSettlement(duel, 0));

        uint256 pot = BUY_IN * 2;
        assertEq(stakeToken.balanceOf(creator), 1_000e18 - BUY_IN + (pot * 9_000) / 10000);
        assertEq(stakeToken.balanceOf(attacker), 0);
        assertEq(stakeToken.balanceOf(platformTreasury), pot - (pot * 9_000) / 10000);
    }

    /// @dev The platform's own cut can never exceed 20% of the pot: winnerBps
    /// is floored at 80%, and whatever referrers take comes out of the
    /// remaining 20%, never out of the winner's share.
    function test_platformCutCanNeverExceedTwentyPercentOfThePot() public {
        factory.setWinnerBps(factory.MIN_WINNER_BPS());
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);

        vm.warp(block.timestamp + DURATION + 1);
        BattleEscrow(duel).settle(0, address(0), 0, address(0), 0, _signSettlement(duel, 0));

        uint256 pot = BUY_IN * 2;
        assertEq(stakeToken.balanceOf(platformTreasury), (pot * 2_000) / 10000);
        // ...and the winner still clears their own stake by a real margin.
        assertGt((pot * 8_000) / 10000, BUY_IN);
    }

    function test_winnerBpsCannotBeSetBelowEightyPercent() public {
        assertEq(factory.MIN_WINNER_BPS(), 8_000);
        vm.expectRevert("winnerBps below floor");
        factory.setWinnerBps(7_999);
    }

    /// @dev A referrer's cut is charged on one player's stake (half the pot),
    /// and the ceiling is absolute -- independent of how low winnerBps goes --
    /// so the referral channel can never be widened into a pot drain.
    function test_maxReferrerBpsHasAnAbsoluteCeiling() public {
        assertEq(factory.MAX_REFERRER_BPS_CEILING(), 1_000);
        vm.expectRevert("maxReferrerBps above ceiling");
        factory.setMaxReferrerBps(1_001);

        factory.setMaxReferrerBps(1_000); // the ceiling itself is fine
        assertEq(factory.maxReferrerBps(), 1_000);
    }

    /// @dev Mirrors the winnerBps snapshot for the other retunable knob: a
    /// referrer rate that was within cap when the oracle signed it stays
    /// valid, so tightening the cap can no longer strand an already-signed
    /// settlement (which used to leave the duel to expire into refundStale).
    function test_settleEnforcesTheMaxReferrerBpsSnapshottedAtActivation() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);
        assertEq(BattleEscrow(duel).maxReferrerBps(), 500);

        address referrerA = address(0x5001);
        uint256 referrerABps = 500; // == maxReferrerBps at activation
        bytes memory sig = _signSettlementWithReferrers(duel, 0, referrerA, referrerABps, address(0), 0);

        // Tightened *after* activation: the in-flight duel keeps its own cap.
        factory.setMaxReferrerBps(200);

        vm.warp(block.timestamp + DURATION + 1);
        BattleEscrow(duel).settle(0, referrerA, referrerABps, address(0), 0, sig);
        assertEq(stakeToken.balanceOf(referrerA), (BUY_IN * 500) / 10000);
    }

    /// @dev The signed payload still can't exceed the duel's own cap.
    function test_settleRejectsAReferrerRateAboveTheSnapshottedCap() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);

        address referrerA = address(0x5001);
        bytes memory sig = _signSettlementWithReferrers(duel, 0, referrerA, 501, address(0), 0);
        vm.warp(block.timestamp + DURATION + 1);
        vm.expectRevert("referrer A rate too high");
        BattleEscrow(duel).settle(0, referrerA, 501, address(0), 0, sig);
    }

    function test_ownershipCannotBeRenounced() public {
        vm.expectRevert("ownership cannot be renounced");
        factory.renounceOwnership();
        assertEq(factory.owner(), address(this));
    }

    /// @dev minBuyIn/maxBuyIn only gate createDuel -- settle() never checks
    /// them, so a duel already created (and joined) under the old bounds
    /// keeps settling normally even after the owner tightens those bounds
    /// out from under it. Retuning buy-in limits is forward-looking only;
    /// it can never strand money already locked in an existing escrow.
    function test_inFlightDuelSettlesNormallyAfterMaxBuyInIsTightenedOutFromUnderIt() public {
        address duel = _createDuel(); // BUY_IN = 100e18, within the original [1, uncapped] bounds
        vm.prank(opponent);
        factory.joinDuel(duel);

        // Tightened so BUY_IN would no longer be createDuel-able at all
        // (BattleEscrowFactory_Adversarial.t.sol's test_createDuelRejectsBuyInAboveMaximum
        // covers that createDuel-time rejection directly).
        factory.setMaxBuyIn(50e18);

        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sig = _signSettlement(duel, 0);
        BattleEscrow(duel).settle(0, address(0), 0, address(0), 0, sig);

        uint256 pot = BUY_IN * 2;
        assertEq(stakeToken.balanceOf(creator), 1_000e18 - BUY_IN + (pot * 9000) / 10000);
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
        vm.warp(block.timestamp + BattleEscrow(duel).MAX_OPEN_WINDOW() + 1);

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
        bytes32 message =
            keccak256(abi.encodePacked(duel, uint8(0), address(0), uint256(0), address(0), uint256(0), block.chainid));
        bytes32 digest = message.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert("invalid oracle signature");
        BattleEscrow(duel).settle(0, address(0), 0, address(0), 0, badSig);
    }

    function test_cannotSettleBeforeBattleEnds() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);

        bytes memory sig = _signSettlement(duel, 0);
        vm.expectRevert("battle still live");
        BattleEscrow(duel).settle(0, address(0), 0, address(0), 0, sig);
    }

    function test_anyoneCanSubmitAValidSignedSettlement_notJustAKeeper() public {
        address duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);
        vm.warp(block.timestamp + DURATION + 1);

        bytes memory sig = _signSettlement(duel, 0);
        vm.prank(rando); // a third party submits it, not the platform's own keeper
        BattleEscrow(duel).settle(0, address(0), 0, address(0), 0, sig);

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
        // Computed before expectRevert -- expectRevert applies to the very
        // next call, and factory.MIN_DURATION()/MAX_DURATION() are external
        // staticcalls that would otherwise consume it themselves.
        uint256 tooShort = factory.MIN_DURATION() - 1;
        uint256 tooLong = factory.MAX_DURATION() + 1;

        vm.prank(creator);
        vm.expectRevert("duration out of range");
        factory.createDuel(address(stakeToken), BUY_IN, 0, tooShort, "A", "B");

        vm.prank(creator);
        vm.expectRevert("duration out of range");
        factory.createDuel(address(stakeToken), BUY_IN, 0, tooLong, "A", "B");
    }

    function test_onlyOwnerCanUpdateOracleSignerOrTreasury() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.proposeOracleSigner(rando);
    }
}
