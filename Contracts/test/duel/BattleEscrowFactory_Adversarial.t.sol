// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "../../src/duel/BattleEscrow.sol";
import "../../src/duel/BattleEscrowFactory.sol";
import "./MockERC20.sol";

/// @dev Not a real BattleEscrow clone at all — never deployed by the factory, never
/// pushed onto `allDuels`. It only implements the two functions BattleEscrowFactory.joinDuel()
/// actually calls. Used to demonstrate that joinDuel() trusts whatever address it's given.
contract FakeDuel {
    address public token;
    uint256 public amount;

    constructor(address _token, uint256 _amount) {
        token = _token;
        amount = _amount;
    }

    function joinTerms() external view returns (address, uint256) {
        return (token, amount);
    }

    function activate(address) external {
        // no-op: always "succeeds", unlike a real BattleEscrow this has no state machine at all
    }
}

contract BattleEscrowFactoryAdversarialTest is Test {
    BattleEscrow implementation;
    BattleEscrowFactory factory;
    MockERC20 stakeToken;

    address oracleSigner = address(0xACE);
    address platformTreasury = address(0xFEE);
    address creator = address(0x1001);
    address victim = address(0x1002);
    address rando = address(0x1003);

    uint256 constant BUY_IN = 100e18;
    uint256 constant DURATION = 20 minutes;

    function setUp() public {
        implementation = new BattleEscrow();
        stakeToken = new MockERC20();
        factory = new BattleEscrowFactory(address(implementation), oracleSigner, platformTreasury, address(stakeToken), 1);
    }

    // ==================== access control ====================

    function test_onlyOwnerCanProposeOracleSigner() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.proposeOracleSigner(rando);
    }

    function test_onlyOwnerCanSetPlatformTreasury() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.setPlatformTreasury(rando);
    }

    function test_onlyOwnerCanSetApprovedStakeToken() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.setApprovedStakeToken(rando);
    }

    function test_proposeOracleSignerRejectsZeroAddress() public {
        vm.expectRevert("bad signer");
        factory.proposeOracleSigner(address(0));
    }

    function test_setPlatformTreasuryRejectsZeroAddress() public {
        vm.expectRevert("bad treasury");
        factory.setPlatformTreasury(address(0));
    }

    function test_setApprovedStakeTokenRejectsZeroAddress() public {
        vm.expectRevert("bad stake token");
        factory.setApprovedStakeToken(address(0));
    }

    function test_constructorRejectsZeroImplementation() public {
        vm.expectRevert("bad implementation");
        new BattleEscrowFactory(address(0), oracleSigner, platformTreasury, address(stakeToken), 1);
    }

    function test_constructorRejectsZeroOracleSigner() public {
        vm.expectRevert("bad signer");
        new BattleEscrowFactory(address(implementation), address(0), platformTreasury, address(stakeToken), 1);
    }

    function test_constructorRejectsZeroTreasury() public {
        vm.expectRevert("bad treasury");
        new BattleEscrowFactory(address(implementation), oracleSigner, address(0), address(stakeToken), 1);
    }

    function test_constructorRejectsZeroStakeToken() public {
        vm.expectRevert("bad stake token");
        new BattleEscrowFactory(address(implementation), oracleSigner, platformTreasury, address(0), 1);
    }

    // ==================== oracle signer timelock ====================

    function test_proposeOracleSignerEmitsWithCorrectEffectiveTime() public {
        address newSigner = address(0xB0B);
        vm.expectEmit(true, false, false, true);
        emit BattleEscrowFactory.OracleSignerRotationProposed(newSigner, block.timestamp + factory.ORACLE_SIGNER_TIMELOCK_DELAY());
        factory.proposeOracleSigner(newSigner);

        assertEq(factory.pendingOracleSigner(), newSigner);
        assertEq(factory.pendingOracleSignerEffectiveAt(), block.timestamp + factory.ORACLE_SIGNER_TIMELOCK_DELAY());
    }

    function test_executeOracleSignerRotationRejectsBeforeTimelockElapses() public {
        address newSigner = address(0xB0B);
        factory.proposeOracleSigner(newSigner);

        vm.warp(block.timestamp + factory.ORACLE_SIGNER_TIMELOCK_DELAY() - 1);
        vm.expectRevert("timelock not elapsed");
        factory.executeOracleSignerRotation();

        assertEq(factory.oracleSigner(), oracleSigner); // unchanged
    }

    function test_executeOracleSignerRotationSucceedsExactlyAtTimelockBoundary() public {
        address newSigner = address(0xB0B);
        factory.proposeOracleSigner(newSigner);

        vm.warp(block.timestamp + factory.ORACLE_SIGNER_TIMELOCK_DELAY());
        factory.executeOracleSignerRotation();

        assertEq(factory.oracleSigner(), newSigner);
        assertEq(factory.pendingOracleSigner(), address(0)); // cleared
    }

    function test_executeOracleSignerRotationRejectsWithNoPendingProposal() public {
        vm.expectRevert("no pending rotation");
        factory.executeOracleSignerRotation();
    }

    function test_executeOracleSignerRotationIsPermissionless() public {
        address newSigner = address(0xB0B);
        factory.proposeOracleSigner(newSigner);
        vm.warp(block.timestamp + factory.ORACLE_SIGNER_TIMELOCK_DELAY());

        vm.prank(rando);
        factory.executeOracleSignerRotation();
        assertEq(factory.oracleSigner(), newSigner);
    }

    function test_cannotExecuteTheSameRotationTwice() public {
        address newSigner = address(0xB0B);
        factory.proposeOracleSigner(newSigner);
        vm.warp(block.timestamp + factory.ORACLE_SIGNER_TIMELOCK_DELAY());
        factory.executeOracleSignerRotation();

        vm.expectRevert("no pending rotation");
        factory.executeOracleSignerRotation();
    }

    function test_proposingAgainOverwritesAnUnexecutedPendingProposal() public {
        factory.proposeOracleSigner(address(0xB0B));
        uint256 firstEffectiveAt = factory.pendingOracleSignerEffectiveAt();

        vm.warp(block.timestamp + 1 hours);
        address secondSigner = address(0xF00D);
        factory.proposeOracleSigner(secondSigner);

        assertEq(factory.pendingOracleSigner(), secondSigner);
        assertTrue(factory.pendingOracleSignerEffectiveAt() > firstEffectiveAt);

        vm.warp(block.timestamp + factory.ORACLE_SIGNER_TIMELOCK_DELAY());
        factory.executeOracleSignerRotation();
        assertEq(factory.oracleSigner(), secondSigner);
    }

    // ==================== approved stake token ====================

    function test_createDuelRejectsAnUnapprovedStakeToken() public {
        MockERC20 otherToken = new MockERC20();
        otherToken.mint(creator, BUY_IN);
        vm.prank(creator);
        otherToken.approve(address(factory), type(uint256).max);

        vm.prank(creator);
        vm.expectRevert("stake token not approved");
        factory.createDuel(address(otherToken), BUY_IN, 0, DURATION, "A", "B");
    }

    function test_createDuelSucceedsOnceStakeTokenIsReapproved() public {
        MockERC20 otherToken = new MockERC20();
        otherToken.mint(creator, BUY_IN);
        vm.prank(creator);
        otherToken.approve(address(factory), type(uint256).max);

        factory.setApprovedStakeToken(address(otherToken));

        vm.prank(creator);
        address duel = factory.createDuel(address(otherToken), BUY_IN, 0, DURATION, "A", "B");
        assertTrue(factory.isDuel(duel));
    }

    function test_createDuelRejectsBadCreatorSide() public {
        stakeToken.mint(creator, BUY_IN);
        vm.prank(creator);
        stakeToken.approve(address(factory), type(uint256).max);

        vm.prank(creator);
        vm.expectRevert("bad side");
        factory.createDuel(address(stakeToken), BUY_IN, 2, DURATION, "A", "B");
    }

    // ==================== fund-drain fix regression ====================

    /// @dev Previously BattleEscrowFactory.joinDuel(address duel) never checked that `duel`
    /// was actually one of its own clones (e.g. against `allDuels`) — it blindly called
    /// `joinTerms()` on whatever address it was handed, then `safeTransferFrom(msg.sender,
    /// duel, buyIn)` for whatever (token, amount) that address claimed. Because the whole
    /// point of joinDuel/createDuel's UX is a one-time large/infinite ERC20 approval to the
    /// factory (this exact test suite's own setUp() pattern uses
    /// `approve(address(factory), type(uint256).max)`), an attacker could deploy a trivial
    /// contract reporting an arbitrary (stakeToken, buyIn) from joinTerms() and a no-op
    /// activate(), then get a victim (e.g. via a malicious frontend/link calling
    /// `factory.joinDuel(attackerAddress)` instead of a real duel) to have their entire
    /// approved allowance pulled straight into the attacker's contract.
    ///
    /// Fixed via an `isDuel[address] => bool` mapping set in createDuel() and checked in
    /// joinDuel/cancelDuel/expireDuel. This test now asserts the exploit is blocked.
    function test_joinDuelRejectsAnUnregisteredFakeDuelAddress() public {
        uint256 approvedAllowance = 500e18;
        stakeToken.mint(victim, approvedAllowance);

        vm.prank(victim);
        stakeToken.approve(address(factory), approvedAllowance);

        // Attacker's contract was never created via factory.createDuel() and never
        // appears in factory.allDuels().
        FakeDuel fake = new FakeDuel(address(stakeToken), approvedAllowance);
        assertEq(factory.allDuelsLength(), 0);

        uint256 victimBalanceBefore = stakeToken.balanceOf(victim);

        vm.prank(victim);
        vm.expectRevert("unknown duel");
        factory.joinDuel(address(fake));

        // Nothing moved, and the fake address is still not a recognized duel.
        assertEq(stakeToken.balanceOf(address(fake)), 0);
        assertEq(stakeToken.balanceOf(victim), victimBalanceBefore);
        assertEq(factory.allDuelsLength(), 0);
    }

    function test_cancelDuelRejectsAnUnregisteredFakeDuelAddress() public {
        FakeDuel fake = new FakeDuel(address(stakeToken), BUY_IN);

        vm.prank(creator);
        vm.expectRevert("unknown duel");
        factory.cancelDuel(address(fake));
    }

    function test_expireDuelRejectsAnUnregisteredFakeDuelAddress() public {
        FakeDuel fake = new FakeDuel(address(stakeToken), BUY_IN);

        vm.prank(rando);
        vm.expectRevert("unknown duel");
        factory.expireDuel(address(fake));
    }

    function test_joinDuelAcceptsARealCloneRegisteredByCreateDuel() public {
        stakeToken.mint(creator, BUY_IN);
        stakeToken.mint(victim, BUY_IN);

        vm.prank(creator);
        stakeToken.approve(address(factory), BUY_IN);
        vm.prank(creator);
        address duel = factory.createDuel(address(stakeToken), BUY_IN, 0, DURATION, "A", "B");

        assertTrue(factory.isDuel(duel));

        vm.prank(victim);
        stakeToken.approve(address(factory), BUY_IN);
        vm.prank(victim);
        factory.joinDuel(duel);

        assertEq(stakeToken.balanceOf(duel), BUY_IN * 2);
    }

    // ==================== minBuyIn (dust-stake points farming) ====================

    function test_createDuelRejectsBuyInBelowMinimum() public {
        factory.setMinBuyIn(1e18);
        vm.expectRevert("bad buyIn");
        factory.createDuel(address(stakeToken), 1e18 - 1, 0, 15 minutes, "A", "B");
    }

    function test_constructorRejectsZeroMinBuyIn() public {
        vm.expectRevert("bad min buyIn");
        new BattleEscrowFactory(address(implementation), oracleSigner, platformTreasury, address(stakeToken), 0);
    }

    function test_setMinBuyInRejectsZeroAndNonOwner() public {
        vm.expectRevert("bad min buyIn");
        factory.setMinBuyIn(0);

        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.setMinBuyIn(1e18);
    }
}
