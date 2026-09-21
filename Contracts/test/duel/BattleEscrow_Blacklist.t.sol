// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../src/duel/BattleEscrow.sol";
import "../../src/duel/BattleEscrowFactory.sol";

/// @dev USDC-style stake token: the issuer can block an address from sending or receiving.
contract BlacklistableERC20 is ERC20 {
    mapping(address => bool) public blocked;

    constructor() ERC20("Blacklistable USD", "bUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool isBlocked) external {
        blocked[who] = isBlocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!blocked[from] && !blocked[to], "blacklisted");
        super._update(from, to, value);
    }
}

/// @dev One stake-token-blacklisted party must never lock anyone else's funds:
/// every exit from Active pushes each payout independently, crediting owed[]
/// instead of reverting when a push fails.
contract BattleEscrowBlacklistTest is Test {
    BlacklistableERC20 usd;
    BattleEscrowFactory factory;
    BattleEscrow duel;

    uint256 oracleKey = 0xA11CE;
    address treasury = address(0x7EA);
    address creator = address(0xC1); // side 0
    address opponent = address(0xC2); // side 1

    uint256 constant BUY_IN = 100e18;
    uint256 constant DURATION = 15 minutes;

    function setUp() public {
        usd = new BlacklistableERC20();
        factory = new BattleEscrowFactory(address(new BattleEscrow()), vm.addr(oracleKey), treasury, address(usd), 1);
        usd.mint(creator, BUY_IN);
        usd.mint(opponent, BUY_IN);

        vm.startPrank(creator);
        usd.approve(address(factory), BUY_IN);
        duel = BattleEscrow(factory.createDuel(address(usd), BUY_IN, 0, DURATION, "A", "B"));
        vm.stopPrank();

        vm.startPrank(opponent);
        usd.approve(address(factory), BUY_IN);
        factory.joinDuel(address(duel));
        vm.stopPrank();
    }

    /// @dev Void-only signer -- voidActive()'s message shape never grew referrer fields.
    function _sign(uint8 marker) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(address(duel), marker, block.chainid)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev No-referrer settle signer -- these tests exercise blacklist/deferred-payout
    /// behavior, not referral payouts, so both referrer slots are always empty.
    function _signSettle(uint8 winnerSide) internal view returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(address(duel), winnerSide, address(0), uint256(0), address(0), uint256(0), block.chainid))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_settleWithBlacklistedWinnerDefersWinnerAndStillPaysTreasury() public {
        usd.setBlocked(creator, true);
        vm.warp(block.timestamp + DURATION);

        duel.settle(0, address(0), 0, address(0), 0, _signSettle(0));

        assertEq(uint8(duel.status()), uint8(BattleEscrow.Status.Settled));
        assertEq(usd.balanceOf(treasury), 20e18);
        assertEq(duel.owed(creator), 180e18);
        assertEq(usd.balanceOf(address(duel)), 180e18);
    }

    function test_refundStaleWithBlacklistedPlayerStillRefundsTheOtherPlayer() public {
        usd.setBlocked(creator, true);
        vm.warp(block.timestamp + DURATION + duel.STALE_REFUND_GRACE_PERIOD());

        duel.refundStale();

        assertEq(usd.balanceOf(opponent), BUY_IN);
        assertEq(duel.owed(creator), BUY_IN);
    }

    function test_voidActiveWithBlacklistedPlayerStillRefundsTheOtherPlayer() public {
        usd.setBlocked(opponent, true);

        duel.voidActive(_sign(2));

        assertEq(usd.balanceOf(creator), BUY_IN);
        assertEq(duel.owed(opponent), BUY_IN);
    }

    function test_deferredPayoutIsWithdrawableOnceUnblocked() public {
        usd.setBlocked(creator, true);
        vm.warp(block.timestamp + DURATION);
        duel.settle(0, address(0), 0, address(0), 0, _signSettle(0));

        vm.prank(creator);
        vm.expectRevert("blacklisted");
        duel.withdraw(); // still blocked: stays owed, nothing lost

        usd.setBlocked(creator, false);
        vm.prank(creator);
        duel.withdraw();

        assertEq(usd.balanceOf(creator), 180e18);
        assertEq(duel.owed(creator), 0);
        assertEq(usd.balanceOf(address(duel)), 0);
    }

    function test_withdrawRevertsWhenNothingOwed() public {
        vm.prank(opponent);
        vm.expectRevert("nothing owed");
        duel.withdraw();
    }

    function test_withdrawCannotBeUsedTwice() public {
        usd.setBlocked(creator, true);
        vm.warp(block.timestamp + DURATION);
        duel.settle(0, address(0), 0, address(0), 0, _signSettle(0));
        usd.setBlocked(creator, false);

        vm.startPrank(creator);
        duel.withdraw();
        vm.expectRevert("nothing owed");
        duel.withdraw();
        vm.stopPrank();
    }

    function test_normalSettlePushesDirectlyAndOwesNothing() public {
        vm.warp(block.timestamp + DURATION);
        duel.settle(1, address(0), 0, address(0), 0, _signSettle(1));

        assertEq(usd.balanceOf(opponent), 180e18);
        assertEq(usd.balanceOf(treasury), 20e18);
        assertEq(duel.owed(opponent), 0);
    }

    function test_refundStaleNotAvailableBeforeGracePeriod() public {
        vm.warp(block.timestamp + DURATION + duel.STALE_REFUND_GRACE_PERIOD() - 1);
        vm.expectRevert("not stale yet");
        duel.refundStale();
    }

    function test_expireWithBlacklistedCreatorCreditsOwedInsteadOfLocking() public {
        usd.mint(creator, BUY_IN);
        vm.startPrank(creator);
        usd.approve(address(factory), BUY_IN);
        BattleEscrow lobby = BattleEscrow(factory.createDuel(address(usd), BUY_IN, 0, DURATION, "A", "B"));
        vm.stopPrank();

        usd.setBlocked(creator, true);
        vm.warp(block.timestamp + lobby.MAX_OPEN_WINDOW() + 1);
        lobby.expire();

        assertEq(uint8(lobby.status()), uint8(BattleEscrow.Status.Refunded));
        assertEq(lobby.owed(creator), BUY_IN);
    }

    function test_cancelWithBlacklistedCreatorCreditsOwedInsteadOfLocking() public {
        usd.mint(creator, BUY_IN);
        vm.startPrank(creator);
        usd.approve(address(factory), BUY_IN);
        address lobby = factory.createDuel(address(usd), BUY_IN, 0, DURATION, "A", "B");
        vm.stopPrank();

        usd.setBlocked(creator, true);
        vm.prank(creator);
        factory.cancelDuel(lobby);

        assertEq(BattleEscrow(lobby).owed(creator), BUY_IN);
    }
}
