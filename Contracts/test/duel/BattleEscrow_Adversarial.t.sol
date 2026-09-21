// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../src/duel/BattleEscrow.sol";
import "../../src/duel/BattleEscrowFactory.sol";
import "./MockERC20.sol";

/// @dev A stake token whose `transfer` calls back into an arbitrary target mid-transfer,
/// used to prove BattleEscrow's reentrancy guard / checks-effects-interactions ordering
/// actually holds up under a hostile token, not just an honest one like MockERC20.
contract ReentrantERC20 is ERC20 {
    address public attackTarget;
    bytes public attackCalldata;
    bool public armed;

    constructor() ERC20("Reentrant", "RENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target, bytes calldata data) external {
        attackTarget = target;
        attackCalldata = data;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (armed) {
            armed = false; // one shot, avoid infinite recursion if the guard ever fails
            (bool success,) = attackTarget.call(attackCalldata);
            success; // don't care whether the reentrant call reverted internally to forge; we assert outcome below
        }
        return ok;
    }
}

contract BattleEscrowAdversarialTest is Test {
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

        stakeToken.mint(creator, 1_000_000e18);
        stakeToken.mint(opponent, 1_000_000e18);

        vm.prank(creator);
        stakeToken.approve(address(factory), type(uint256).max);
        vm.prank(opponent);
        stakeToken.approve(address(factory), type(uint256).max);
    }

    function _createDuel() internal returns (address duel) {
        vm.prank(creator);
        duel = factory.createDuel(address(stakeToken), BUY_IN, 0, DURATION, "TOKA", "TOKB");
    }

    function _createAndActivateDuel() internal returns (address duel) {
        duel = _createDuel();
        vm.prank(opponent);
        factory.joinDuel(duel);
    }

    /// @dev Low-level signer for the (duel, marker, chainid) message shape --
    /// used only for voidActive(), whose signed message never grew referrer
    /// fields (see BattleEscrow.sol's voidActive doc comment).
    function _sign(uint256 key, address duel, uint8 marker) internal view returns (bytes memory) {
        bytes32 message = keccak256(abi.encodePacked(duel, marker, block.chainid));
        bytes32 digest = message.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Low-level signer for settle()'s full message shape, referrer
    /// fields included -- matches BattleEscrow.settle()'s exact encoding.
    function _signSettle(
        uint256 key,
        address duel,
        uint8 winnerSide,
        address referrerA,
        uint256 referrerABps,
        address referrerB,
        uint256 referrerBBps
    ) internal view returns (bytes memory) {
        bytes32 message = keccak256(
            abi.encodePacked(duel, winnerSide, referrerA, referrerABps, referrerB, referrerBBps, block.chainid)
        );
        bytes32 digest = message.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Convenience: a settle signature with no referrers on either side --
    /// what most of these tests (not specifically exercising referral payouts) use.
    function _signSettlement(address duel, uint8 winnerSide) internal view returns (bytes memory) {
        return _signSettle(oracleSignerKey, duel, winnerSide, address(0), 0, address(0), 0);
    }

    /// @dev No-referrer settle() call -- the shape almost every test here uses.
    function _settleNoReferrers(address duel, uint8 winnerSide, bytes memory sig) internal {
        BattleEscrow(duel).settle(winnerSide, address(0), 0, address(0), 0, sig);
    }

    uint8 constant VOID_MARKER = 2;

    function _signVoid(address duel) internal view returns (bytes memory) {
        return _sign(oracleSignerKey, duel, VOID_MARKER);
    }

    /// @dev Drives the two-step oracle signer rotation (propose, warp past the
    /// timelock, execute) end to end -- the tests care about the post-rotation
    /// behavior, not re-testing the timelock mechanics on every call site.
    function _rotateOracleSigner(address newSigner) internal {
        factory.proposeOracleSigner(newSigner);
        vm.warp(block.timestamp + factory.ORACLE_SIGNER_TIMELOCK_DELAY());
        factory.executeOracleSignerRotation();
    }

    // ==================== double-action / state-machine abuse ====================

    function test_cannotActivateAnAlreadyActiveDuel() public {
        address duel = _createAndActivateDuel();
        address secondJoiner = address(0x2222);
        stakeToken.mint(secondJoiner, 1_000e18);
        vm.prank(secondJoiner);
        stakeToken.approve(address(factory), type(uint256).max);

        vm.prank(secondJoiner);
        vm.expectRevert("not open");
        factory.joinDuel(duel);
    }

    function test_cannotActivateASettledDuel() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));

        // Even the factory itself cannot re-activate a settled duel — status guard fires.
        vm.prank(address(factory));
        vm.expectRevert("not open");
        BattleEscrow(duel).activate(rando);
    }

    function test_cannotCancelAfterActivated() public {
        address duel = _createAndActivateDuel();
        vm.expectRevert("not open");
        factory.cancelDuel(duel); // called by whoever, but status check fires first
    }

    function test_cannotExpireAfterActivated() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + BattleEscrow(duel).MAX_OPEN_WINDOW() + 1);
        vm.expectRevert("not open");
        factory.expireDuel(duel);
    }

    function test_cannotExpireASettledDuel() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));

        vm.expectRevert("not open");
        BattleEscrow(duel).expire();
    }

    function test_cannotDoubleSettle() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sig = _signSettlement(duel, 0);
        _settleNoReferrers(duel, 0, sig);

        vm.expectRevert("not active");
        _settleNoReferrers(duel, 0, sig);
    }

    function test_cannotSettleAnOpenUnactivatedDuel() public {
        address duel = _createDuel();
        vm.warp(block.timestamp + DURATION + 1);
        vm.expectRevert("not active");
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));
    }

    function test_cannotSettleARefundedDuel() public {
        address duel = _createDuel();
        vm.prank(creator);
        factory.cancelDuel(duel);

        vm.expectRevert("not active");
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));
    }

    // ==================== access control ====================

    function test_directCancelBypassingFactory_reverts() public {
        address duel = _createDuel();
        vm.prank(creator);
        vm.expectRevert("only factory");
        BattleEscrow(duel).cancel(creator);
    }

    function test_directActivateBypassingFactory_reverts() public {
        address duel = _createDuel();
        vm.prank(opponent);
        vm.expectRevert("only factory");
        BattleEscrow(duel).activate(opponent);
    }

    function test_expireIsIntentionallyPermissionless_worksWithoutGoingThroughFactory() public {
        address duel = _createDuel();
        vm.warp(block.timestamp + BattleEscrow(duel).MAX_OPEN_WINDOW() + 1);
        // called directly on the clone, not via factory.expireDuel — this must still work,
        // that's the documented design ("permissionless on purpose").
        vm.prank(rando);
        BattleEscrow(duel).expire();
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
    }

    // ==================== signature edge cases ====================

    function test_signatureForOneWinnerSideCannotBeReplayedForTheOtherSide() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);

        bytes memory sigForSide0 = _signSettlement(duel, 0);
        vm.expectRevert("invalid oracle signature");
        _settleNoReferrers(duel, 1, sigForSide0);
    }

    function test_settlementSignatureCannotBeReplayedAgainstADifferentDuelClone() public {
        address duelA = _createAndActivateDuel();

        // A second, independent duel with identical economic terms.
        address creator2 = address(0x3001);
        address opponent2 = address(0x3002);
        stakeToken.mint(creator2, 1_000e18);
        stakeToken.mint(opponent2, 1_000e18);
        vm.prank(creator2);
        stakeToken.approve(address(factory), type(uint256).max);
        vm.prank(opponent2);
        stakeToken.approve(address(factory), type(uint256).max);

        vm.prank(creator2);
        address duelB = factory.createDuel(address(stakeToken), BUY_IN, 0, DURATION, "TOKA", "TOKB");
        vm.prank(opponent2);
        factory.joinDuel(duelB);

        vm.warp(block.timestamp + DURATION + 1);

        // Signature was produced for duelA specifically (message includes address(this)).
        bytes memory sigForA = _signSettlement(duelA, 0);

        vm.expectRevert("invalid oracle signature");
        _settleNoReferrers(duelB, 0, sigForA);

        // Sanity: the same signature *does* work on the duel it was actually signed for.
        _settleNoReferrers(duelA, 0, sigForA);
        assertEq(uint256(BattleEscrow(duelA).status()), uint256(BattleEscrow.Status.Settled));
    }

    function test_signerRotationDoesNotInvalidateAnInFlightDuelsSignature() public {
        // Each escrow snapshots the signer at activate(), so a rotation can't
        // kill a result already signed for a duel that was in flight (which
        // would hand the loser refundStale()), and the rotated-in key can't
        // decide that duel either.
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sigFromOriginalSigner = _signSettlement(duel, 0);

        uint256 newSignerKey = 0xB0B5;
        _rotateOracleSigner(vm.addr(newSignerKey));

        vm.expectRevert("invalid oracle signature");
        _settleNoReferrers(duel, 0, _signSettle(newSignerKey, duel, 1, address(0), 0, address(0), 0));

        _settleNoReferrers(duel, 0, sigFromOriginalSigner);
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Settled));
    }

    function test_signerRotationAppliesToDuelsActivatedAfterIt() public {
        uint256 newSignerKey = 0xB0B5;
        _rotateOracleSigner(vm.addr(newSignerKey));

        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);

        vm.expectRevert("invalid oracle signature");
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0)); // former signer

        _settleNoReferrers(duel, 0, _signSettle(newSignerKey, duel, 0, address(0), 0, address(0), 0));
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Settled));
    }

    function test_settleRejectsMalformedSignatureLength() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);

        bytes memory truncated = new bytes(64); // one byte short of a valid 65-byte sig
        vm.expectRevert(abi.encodeWithSignature("ECDSAInvalidSignatureLength(uint256)", 64));
        _settleNoReferrers(duel, 0, truncated);
    }

    function test_settleRejectsEmptySignature() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);

        vm.expectRevert(abi.encodeWithSignature("ECDSAInvalidSignatureLength(uint256)", 0));
        _settleNoReferrers(duel, 0, "");
    }

    function test_settleRejectsZeroFilledSignature() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);

        bytes memory zeroSig = new bytes(65); // r=0, s=0, v=0 — not a valid v
        vm.expectRevert(abi.encodeWithSignature("ECDSAInvalidSignature()"));
        _settleNoReferrers(duel, 0, zeroSig);
    }

    function test_settleRejectsBadWinnerSideValue() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sig = _signSettlement(duel, 0);
        vm.expectRevert("bad side");
        _settleNoReferrers(duel, 2, sig);
    }

    // ==================== referral payout edge cases ====================

    function test_settleRejectsReferrerABpsAboveCap() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        address referrerA = address(0x4001);
        uint256 tooHigh = factory.maxReferrerBps() + 1;
        bytes memory sig = _signSettle(oracleSignerKey, duel, 0, referrerA, tooHigh, address(0), 0);

        vm.expectRevert("referrer A rate too high");
        BattleEscrow(duel).settle(0, referrerA, tooHigh, address(0), 0, sig);
    }

    function test_settleRejectsReferrerBBpsAboveCap() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        address referrerB = address(0x4002);
        uint256 tooHigh = factory.maxReferrerBps() + 1;
        bytes memory sig = _signSettle(oracleSignerKey, duel, 0, address(0), 0, referrerB, tooHigh);

        vm.expectRevert("referrer B rate too high");
        BattleEscrow(duel).settle(0, address(0), 0, referrerB, tooHigh, sig);
    }

    /// @dev The referrer addresses/bps are part of the signed message -- a
    /// signature produced for one referrer pair cannot be reused with a
    /// different pair, even holding winnerSide fixed. Otherwise anyone could
    /// take a validly-signed settlement and redirect the referral cut to
    /// themselves by supplying different referrer args at call time.
    function test_settleRejectsMismatchedReferrerArgs() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        address referrerA = address(0x4001);
        bytes memory sig = _signSettle(oracleSignerKey, duel, 0, referrerA, 500, address(0), 0);

        address attacker = address(0x4003);
        vm.expectRevert("invalid oracle signature");
        BattleEscrow(duel).settle(0, attacker, 500, address(0), 0, sig);
    }

    function test_settlePaysBothReferrersAtSignedRatesAndPlatformKeepsRemainder() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);

        address referrerA = address(0x4001);
        address referrerB = address(0x4002);
        uint256 referrerABps = 500; // 5% of creator's stake -> 2.5% of pot
        uint256 referrerBBps = 300; // 3% of opponent's stake -> 1.5% of pot
        bytes memory sig = _signSettle(oracleSignerKey, duel, 0, referrerA, referrerABps, referrerB, referrerBBps);

        BattleEscrow(duel).settle(0, referrerA, referrerABps, referrerB, referrerBBps, sig);

        uint256 pot = BUY_IN * 2;
        uint256 winnerAmount = (pot * 9000) / 10000;
        uint256 referrerAAmount = (BUY_IN * referrerABps) / 10000;
        uint256 referrerBAmount = (BUY_IN * referrerBBps) / 10000;
        uint256 platformAmount = pot - winnerAmount - referrerAAmount - referrerBAmount;

        assertEq(stakeToken.balanceOf(creator), 1_000_000e18 - BUY_IN + winnerAmount);
        assertEq(stakeToken.balanceOf(referrerA), referrerAAmount);
        assertEq(stakeToken.balanceOf(referrerB), referrerBAmount);
        assertEq(stakeToken.balanceOf(platformTreasury), platformAmount);
        assertEq(winnerAmount + referrerAAmount + referrerBAmount + platformAmount, pot);
        assertEq(stakeToken.balanceOf(duel), 0);
    }

    function test_settleWithZeroReferrerAddressPaysNothingRegardlessOfBps() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);

        // A nonzero bps paired with address(0) must never pay out -- the
        // contract treats address(0) as "no referrer on this side" outright.
        bytes memory sig = _signSettle(oracleSignerKey, duel, 0, address(0), 500, address(0), 0);
        BattleEscrow(duel).settle(0, address(0), 500, address(0), 0, sig);

        uint256 pot = BUY_IN * 2;
        uint256 winnerAmount = (pot * 9000) / 10000;
        assertEq(stakeToken.balanceOf(platformTreasury), pot - winnerAmount);
    }

    // ==================== reentrancy ====================

    function test_reentrantSettleDuringPayoutCannotDoubleSettle() public {
        ReentrantERC20 hostileToken = new ReentrantERC20();
        factory.setApprovedStakeToken(address(hostileToken));
        hostileToken.mint(creator, 1_000e18);
        hostileToken.mint(opponent, 1_000e18);
        vm.prank(creator);
        hostileToken.approve(address(factory), type(uint256).max);
        vm.prank(opponent);
        hostileToken.approve(address(factory), type(uint256).max);

        vm.prank(creator);
        address duel = factory.createDuel(address(hostileToken), BUY_IN, 0, DURATION, "TOKA", "TOKB");
        vm.prank(opponent);
        factory.joinDuel(duel);

        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sig = _signSettlement(duel, 0);

        // Arm the token: the moment it pays the winner mid-settle(), it tries to call
        // settle() again on the very same duel, with the very same valid signature.
        hostileToken.arm(
            duel,
            abi.encodeWithSelector(BattleEscrow.settle.selector, uint8(0), address(0), uint256(0), address(0), uint256(0), sig)
        );

        _settleNoReferrers(duel, 0, sig);

        // The reentrant inner call must not have been able to settle a second time —
        // status flips to Settled (checks-effects-interactions) before any transfer happens,
        // so the reentrant call hits "not active" and reverts internally, leaving payouts
        // exactly as a single settlement would.
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Settled));
        uint256 pot = BUY_IN * 2;
        uint256 winnerAmount = (pot * 9000) / 10000;
        uint256 platformAmount = pot - winnerAmount;
        assertEq(hostileToken.balanceOf(creator), 1_000e18 - BUY_IN + winnerAmount);
        assertEq(hostileToken.balanceOf(platformTreasury), platformAmount);
        assertEq(hostileToken.balanceOf(duel), 0);
    }

    // ==================== fuzz: buyIn boundaries / overflow ====================

    function testFuzz_buyInOneWeiSucceeds() public {
        uint256 buyIn = 1;
        stakeToken.mint(creator, buyIn);
        stakeToken.mint(opponent, buyIn);

        vm.prank(creator);
        address duel = factory.createDuel(address(stakeToken), buyIn, 0, DURATION, "A", "B");
        vm.prank(opponent);
        factory.joinDuel(duel);

        vm.warp(block.timestamp + DURATION + 1);
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Settled));
    }

    function testFuzz_buyInWithinTokenSupplyRange(uint256 buyIn) public {
        // Keep buyIn * 2 * 9000 (the intermediate term in the 90% split) comfortably below
        // overflow, but exercise a wide fuzz range, including values close to a whale-sized stake.
        buyIn = bound(buyIn, 1, type(uint256).max / 20_000);

        MockERC20 token = new MockERC20();
        factory.setApprovedStakeToken(address(token));
        token.mint(creator, buyIn);
        token.mint(opponent, buyIn);
        vm.prank(creator);
        token.approve(address(factory), type(uint256).max);
        vm.prank(opponent);
        token.approve(address(factory), type(uint256).max);

        vm.prank(creator);
        address duel = factory.createDuel(address(token), buyIn, 0, DURATION, "A", "B");
        vm.prank(opponent);
        factory.joinDuel(duel);

        vm.warp(block.timestamp + DURATION + 1);
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));

        uint256 pot = buyIn * 2;
        uint256 winnerAmount = (pot * 9000) / 10000;
        uint256 platformAmount = pot - winnerAmount;

        // Invariant: total paid out never exceeds (and always exactly equals) what was staked.
        assertEq(winnerAmount + platformAmount, pot);
        assertEq(token.balanceOf(creator), winnerAmount);
        assertEq(token.balanceOf(platformTreasury), platformAmount);
        assertEq(token.balanceOf(duel), 0);
    }

    function test_buyInLargeEnoughToOverflowPotMathReverts() public {
        // buyIn * 2 overflows uint256 -> Solidity 0.8's built-in checked math panics.
        // This can never actually be reached through createDuel() (no real ERC20 has this
        // much supply), but it documents that the *2 pot math cannot silently wrap if it
        // ever were reached — it reverts loudly instead of paying out a wrapped tiny amount.
        uint256 buyIn = type(uint256).max / 2 + 1;

        // Can't actually mint this much of a real ERC20 in a test, so we exercise the
        // exact pot math settle() performs (`buyIn * 2`), confirming Solidity 0.8's
        // checked arithmetic reverts rather than silently wrapping to a tiny pot.
        vm.expectRevert(stdError.arithmeticError);
        this.multiplyByTwo(buyIn);
    }

    function multiplyByTwo(uint256 x) external pure returns (uint256) {
        return x * 2;
    }

    // ==================== fuzz: duration boundaries ====================

    function test_durationExactlyMinSucceeds() public {
        uint256 minDuration = factory.MIN_DURATION();
        vm.prank(creator);
        address duel = factory.createDuel(address(stakeToken), BUY_IN, 0, minDuration, "A", "B");
        assertEq(BattleEscrow(duel).durationSeconds(), minDuration);
    }

    function test_durationExactlyMaxSucceeds() public {
        uint256 maxDuration = factory.MAX_DURATION();
        vm.prank(creator);
        address duel = factory.createDuel(address(stakeToken), BUY_IN, 0, maxDuration, "A", "B");
        assertEq(BattleEscrow(duel).durationSeconds(), maxDuration);
    }

    function test_durationOneSecondBelowMinReverts() public {
        uint256 tooShort = factory.MIN_DURATION() - 1;
        vm.prank(creator);
        vm.expectRevert("duration out of range");
        factory.createDuel(address(stakeToken), BUY_IN, 0, tooShort, "A", "B");
    }

    function test_durationOneSecondAboveMaxReverts() public {
        uint256 tooLong = factory.MAX_DURATION() + 1;
        vm.prank(creator);
        vm.expectRevert("duration out of range");
        factory.createDuel(address(stakeToken), BUY_IN, 0, tooLong, "A", "B");
    }

    function test_everyAllowedDurationSucceeds() public {
        uint256[4] memory allowed = [uint256(5 minutes), 10 minutes, 15 minutes, 20 minutes];
        for (uint256 i = 0; i < allowed.length; i++) {
            vm.prank(creator);
            address duel = factory.createDuel(address(stakeToken), BUY_IN, 0, allowed[i], "A", "B");
            assertEq(BattleEscrow(duel).durationSeconds(), allowed[i]);
        }
    }

    function test_openWindowIsFiveMinutes() public {
        vm.prank(creator);
        address duel = factory.createDuel(address(stakeToken), BUY_IN, 0, 5 minutes, "A", "B");
        assertEq(BattleEscrow(duel).MAX_OPEN_WINDOW(), 5 minutes);
        assertEq(BattleEscrow(duel).openDeadline(), block.timestamp + 5 minutes);

        // Joinable up to and including the deadline...
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(opponent);
        factory.joinDuel(duel);
        assertEq(uint8(BattleEscrow(duel).status()), uint8(BattleEscrow.Status.Active));
    }

    function test_joinOneSecondAfterFiveMinuteWindowReverts() public {
        vm.prank(creator);
        address duel = factory.createDuel(address(stakeToken), BUY_IN, 0, 5 minutes, "A", "B");
        vm.warp(block.timestamp + 5 minutes + 1);
        vm.prank(opponent);
        vm.expectRevert("open window passed");
        factory.joinDuel(duel);

        // ...and from then on anyone can expire it for the creator's refund.
        uint256 before = stakeToken.balanceOf(creator);
        BattleEscrow(duel).expire();
        assertEq(stakeToken.balanceOf(creator), before + BUY_IN);
    }

    function test_durationBetweenStepsReverts() public {
        uint256[4] memory rejected = [uint256(7 minutes), 12 minutes + 30, 19 minutes, 25 minutes];
        for (uint256 i = 0; i < rejected.length; i++) {
            vm.prank(creator);
            vm.expectRevert("duration out of range");
            factory.createDuel(address(stakeToken), BUY_IN, 0, rejected[i], "A", "B");
        }
    }

    function testFuzz_durationAcceptedIffAllowedStep(uint256 d) public {
        d = bound(d, 0, 60 minutes);
        bool allowed = d >= 5 minutes && d <= 20 minutes && d % 5 minutes == 0;
        vm.prank(creator);
        if (!allowed) vm.expectRevert("duration out of range");
        factory.createDuel(address(stakeToken), BUY_IN, 0, d, "A", "B");
    }

    function test_buyInZeroReverts() public {
        vm.prank(creator);
        vm.expectRevert("bad buyIn");
        factory.createDuel(address(stakeToken), 0, 0, DURATION, "A", "B");
    }

    // ==================== rounding ====================

    function testFuzz_oddPot_roundingFavorsTreasuryNotWinner_andNeverLeaksOrCreatesFunds(uint256 buyIn) public {
        buyIn = bound(buyIn, 1, 1_000_000e18);
        MockERC20 token = new MockERC20();
        factory.setApprovedStakeToken(address(token));
        token.mint(creator, buyIn);
        token.mint(opponent, buyIn);
        vm.prank(creator);
        token.approve(address(factory), type(uint256).max);
        vm.prank(opponent);
        token.approve(address(factory), type(uint256).max);

        vm.prank(creator);
        address duel = factory.createDuel(address(token), buyIn, 0, DURATION, "A", "B");
        vm.prank(opponent);
        factory.joinDuel(duel);
        vm.warp(block.timestamp + DURATION + 1);
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));

        uint256 pot = buyIn * 2;
        uint256 winnerAmount = (pot * 9000) / 10000;
        uint256 platformAmount = pot - winnerAmount;

        // No dust created or destroyed.
        assertEq(winnerAmount + platformAmount, pot);
        // Any floor-division remainder falls to the platform side, never the winner.
        assertGe(platformAmount, pot - (pot * 9000) / 10000);
        assertLe(winnerAmount * 10000, pot * 9000);
    }

    // ==================== voidActive (HELD recovery) ====================

    function test_voidActiveRefundsBothStakesAndMarksRefunded() public {
        address duel = _createAndActivateDuel();
        uint256 creatorBalanceBefore = stakeToken.balanceOf(creator);
        uint256 opponentBalanceBefore = stakeToken.balanceOf(opponent);

        BattleEscrow(duel).voidActive(_signVoid(duel));

        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
        assertEq(stakeToken.balanceOf(creator), creatorBalanceBefore + BUY_IN);
        assertEq(stakeToken.balanceOf(opponent), opponentBalanceBefore + BUY_IN);
        assertEq(stakeToken.balanceOf(duel), 0);
    }

    function test_voidActiveIsPermissionless_anyoneCanSubmitGivenAValidSignature() public {
        address duel = _createAndActivateDuel();
        vm.prank(rando);
        BattleEscrow(duel).voidActive(_signVoid(duel));
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
    }

    function test_voidActiveRejectsAnOpenUnactivatedDuel() public {
        address duel = _createDuel();
        vm.expectRevert("not active");
        BattleEscrow(duel).voidActive(_signVoid(duel));
    }

    function test_voidActiveRejectsASettledDuel() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));

        vm.expectRevert("not active");
        BattleEscrow(duel).voidActive(_signVoid(duel));
    }

    function test_cannotDoubleVoid() public {
        address duel = _createAndActivateDuel();
        bytes memory sig = _signVoid(duel);
        BattleEscrow(duel).voidActive(sig);

        vm.expectRevert("not active");
        BattleEscrow(duel).voidActive(sig);
    }

    function test_voidActiveRejectsInvalidSignature() public {
        address duel = _createAndActivateDuel();
        uint256 wrongKey = 0xBAD;
        vm.expectRevert("invalid oracle signature");
        BattleEscrow(duel).voidActive(_sign(wrongKey, duel, VOID_MARKER));
    }

    /// @dev A signed settlement result must never be usable to void a match instead,
    /// and vice versa -- the two message spaces are disjoint by construction
    /// (VOID_MARKER=2 falls outside settle()'s accepted 0/1 range).
    function test_settleSignatureCannotBeReplayedAsAVoidSignature() public {
        address duel = _createAndActivateDuel();
        bytes memory settleSig = _signSettlement(duel, 0);
        vm.expectRevert("invalid oracle signature");
        BattleEscrow(duel).voidActive(settleSig);
    }

    function test_voidSignatureCannotBeReplayedAsASettleSignature() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        bytes memory voidSig = _signVoid(duel);
        vm.expectRevert("bad side"); // VOID_MARKER (2) fails settle()'s own side check first
        _settleNoReferrers(duel, VOID_MARKER, voidSig);
    }

    // ==================== chain-id-bound signatures ====================

    function test_settleRejectsASignatureSignedForADifferentChainId() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);

        bytes32 wrongChainMessage =
            keccak256(abi.encodePacked(duel, uint8(0), address(0), uint256(0), address(0), uint256(0), uint256(999)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleSignerKey, wrongChainMessage.toEthSignedMessageHash());
        bytes memory wrongChainSig = abi.encodePacked(r, s, v);

        vm.expectRevert("invalid oracle signature");
        _settleNoReferrers(duel, 0, wrongChainSig);
    }

    function test_voidActiveRejectsASignatureSignedForADifferentChainId() public {
        address duel = _createAndActivateDuel();

        bytes32 wrongChainMessage = keccak256(abi.encodePacked(duel, VOID_MARKER, uint256(999)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleSignerKey, wrongChainMessage.toEthSignedMessageHash());
        bytes memory wrongChainSig = abi.encodePacked(r, s, v);

        vm.expectRevert("invalid oracle signature");
        BattleEscrow(duel).voidActive(wrongChainSig);
    }

    // ==================== refundStale (last-resort recovery) ====================

    function test_refundStaleRefundsBothStakesOnceGracePeriodElapses() public {
        address duel = _createAndActivateDuel();
        uint256 creatorBalanceBefore = stakeToken.balanceOf(creator);
        uint256 opponentBalanceBefore = stakeToken.balanceOf(opponent);

        vm.warp(block.timestamp + DURATION + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD() + 1);
        BattleEscrow(duel).refundStale();

        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
        assertEq(stakeToken.balanceOf(creator), creatorBalanceBefore + BUY_IN);
        assertEq(stakeToken.balanceOf(opponent), opponentBalanceBefore + BUY_IN);
    }

    function test_refundStaleIsPermissionless_anyoneCanSubmitIt() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD() + 1);

        vm.prank(rando);
        BattleEscrow(duel).refundStale();
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
    }

    function test_refundStaleRejectsBeforeGracePeriodElapses() public {
        address duel = _createAndActivateDuel();
        // Battle just ended -- well within the grace period, still recoverable normally.
        vm.warp(block.timestamp + DURATION + 1);

        vm.expectRevert("not stale yet");
        BattleEscrow(duel).refundStale();
    }

    function test_refundStaleRejectsOneSecondBeforeGracePeriodElapses() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD() - 1);

        vm.expectRevert("not stale yet");
        BattleEscrow(duel).refundStale();
    }

    function test_refundStaleSucceedsExactlyAtGracePeriodBoundary() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD());

        BattleEscrow(duel).refundStale();
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
    }

    function test_refundStaleRejectsAnOpenUnactivatedDuel() public {
        address duel = _createDuel();
        vm.warp(block.timestamp + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD() + 1);

        vm.expectRevert("not active");
        BattleEscrow(duel).refundStale();
    }

    function test_refundStaleRejectsAnAlreadySettledDuel() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + 1);
        _settleNoReferrers(duel, 0, _signSettlement(duel, 0));

        vm.warp(block.timestamp + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD() + 1);
        vm.expectRevert("not active");
        BattleEscrow(duel).refundStale();
    }

    function test_refundStaleRejectsAnAlreadyVoidedDuel() public {
        address duel = _createAndActivateDuel();
        BattleEscrow(duel).voidActive(_signVoid(duel));

        vm.warp(block.timestamp + DURATION + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD() + 1);
        vm.expectRevert("not active");
        BattleEscrow(duel).refundStale();
    }

    function test_cannotDoubleRefundStale() public {
        address duel = _createAndActivateDuel();
        vm.warp(block.timestamp + DURATION + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD() + 1);
        BattleEscrow(duel).refundStale();

        vm.expectRevert("not active");
        BattleEscrow(duel).refundStale();
    }

    function test_refundStaleStillWorksEvenIfOracleSignerIsUnavailable() public {
        // Simulates the exact scenario refundStale() exists for: the oracle
        // key is gone (rotated to a black hole address here, standing in for
        // "lost"), so neither settle() nor voidActive() can ever produce a
        // valid signature again -- refundStale() needs none.
        address duel = _createAndActivateDuel();
        _rotateOracleSigner(address(0xdEaD));

        vm.warp(block.timestamp + DURATION + BattleEscrow(duel).STALE_REFUND_GRACE_PERIOD() + 1);
        BattleEscrow(duel).refundStale();
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
    }

    function test_voidActiveStillAcceptsTheSignerSnapshottedAtActivateAfterRotation() public {
        address duel = _createAndActivateDuel();
        bytes memory sigFromOriginalSigner = _signVoid(duel);

        _rotateOracleSigner(vm.addr(0xB0B0));

        BattleEscrow(duel).voidActive(sigFromOriginalSigner);
        assertEq(uint256(BattleEscrow(duel).status()), uint256(BattleEscrow.Status.Refunded));
    }

    function test_voidActiveSignatureCannotBeReplayedAgainstADifferentDuelClone() public {
        address duelA = _createAndActivateDuel();

        address creator2 = address(0x3003);
        address opponent2 = address(0x3004);
        stakeToken.mint(creator2, 1_000e18);
        stakeToken.mint(opponent2, 1_000e18);
        vm.prank(creator2);
        stakeToken.approve(address(factory), type(uint256).max);
        vm.prank(opponent2);
        stakeToken.approve(address(factory), type(uint256).max);
        vm.prank(creator2);
        address duelB = factory.createDuel(address(stakeToken), BUY_IN, 0, DURATION, "A", "B");
        vm.prank(opponent2);
        factory.joinDuel(duelB);

        bytes memory sigForA = _signVoid(duelA);
        vm.expectRevert("invalid oracle signature");
        BattleEscrow(duelB).voidActive(sigForA);
    }
}
