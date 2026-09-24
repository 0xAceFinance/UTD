// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../src/duel/BattleEscrow.sol";
import "../../src/duel/BattleEscrowFactory.sol";
import "./MockERC20.sol";

interface IMulticall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData);
}

/// @dev What the backend keeper (FE/lib/settlementRelayer.ts) does on-chain: many
/// settle()/expire() calls in ONE Multicall3.aggregate3 transaction from a relayer
/// with no special authority. Runs against the real Multicall3 runtime bytecode
/// deployed on Robinhood Chain (test/duel/fixtures/multicall3.runtime.hex).
contract KeeperBatchTest is Test {
    using MessageHashUtils for bytes32;

    IMulticall3 constant MULTICALL3 = IMulticall3(0xcA11bde05977b3631167028862bE2a173976CA11);

    BattleEscrowFactory factory;
    MockERC20 stakeToken;
    uint256 oracleKey = 0xA11CE;
    address platformTreasury = address(0xFEE);
    address relayer = address(0xBEEF);

    uint256 constant BUY_IN = 100e18;
    uint256 constant DURATION = 5 minutes;

    function setUp() public {
        vm.etch(address(MULTICALL3), vm.parseBytes(vm.trim(vm.readFile("test/duel/fixtures/multicall3.runtime.hex"))));
        stakeToken = new MockERC20();
        factory = new BattleEscrowFactory(address(new BattleEscrow()), vm.addr(oracleKey), platformTreasury, address(stakeToken), 1);
    }

    function _player(uint256 i) internal returns (address p) {
        p = address(uint160(0x10000 + i));
        stakeToken.mint(p, BUY_IN);
        vm.prank(p);
        stakeToken.approve(address(factory), BUY_IN);
    }

    function _lobby(uint256 i) internal returns (address duel) {
        address creator = _player(i * 2);
        vm.prank(creator);
        duel = factory.createDuel(address(stakeToken), BUY_IN, 0, DURATION, "TOKA", "");
    }

    function _liveDuel(uint256 i) internal returns (address duel) {
        duel = _lobby(i);
        address opponent = _player(i * 2 + 1);
        vm.prank(opponent);
        factory.joinDuel(duel);
    }

    function _sign(address duel, uint8 winnerSide) internal view returns (bytes memory) {
        bytes32 message =
            keccak256(abi.encodePacked(duel, winnerSide, address(0), uint256(0), address(0), uint256(0), block.chainid));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, message.toEthSignedMessageHash());
        return abi.encodePacked(r, s, v);
    }

    function _settleCall(address duel, bytes memory sig) internal pure returns (IMulticall3.Call3 memory) {
        return IMulticall3.Call3(
            duel, true, abi.encodeCall(BattleEscrow.settle, (uint8(1), address(0), 0, address(0), 0, sig))
        );
    }

    function test_oneTransaction_paysOut30DuelsAndRefunds5Lobbies_oneBadCallDoesNotBlockTheRest() public {
        uint256 settles = 30;
        uint256 lobbies = 5;
        address[] memory live = new address[](settles);
        address[] memory open = new address[](lobbies);
        for (uint256 i = 0; i < settles; i++) live[i] = _liveDuel(i);
        for (uint256 i = 0; i < lobbies; i++) open[i] = _lobby(1000 + i);

        vm.warp(block.timestamp + DURATION + 1); // past every duel's end and every lobby's open window

        IMulticall3.Call3[] memory calls = new IMulticall3.Call3[](settles + lobbies);
        for (uint256 i = 0; i < settles; i++) {
            // duel 7 carries a signature for the wrong side: that call alone must fail
            calls[i] = _settleCall(live[i], i == 7 ? _sign(live[i], 0) : _sign(live[i], 1));
        }
        for (uint256 i = 0; i < lobbies; i++) {
            calls[settles + i] = IMulticall3.Call3(open[i], true, abi.encodeCall(BattleEscrow.expire, ()));
        }

        uint256 gasBefore = gasleft();
        vm.prank(relayer);
        IMulticall3.Result[] memory results = MULTICALL3.aggregate3(calls);
        uint256 gasUsed = gasBefore - gasleft();
        console.log("gas for 35-call batch:", gasUsed);
        console.log("avg gas per call:", gasUsed / calls.length);

        for (uint256 i = 0; i < settles; i++) {
            BattleEscrow e = BattleEscrow(live[i]);
            if (i == 7) {
                assertFalse(results[i].success);
                assertEq(uint8(e.status()), uint8(BattleEscrow.Status.Active));
            } else {
                assertTrue(results[i].success);
                assertEq(uint8(e.status()), uint8(BattleEscrow.Status.Settled));
                // winner (side 1 = opponent) got 90% of the 2x pot
                assertEq(stakeToken.balanceOf(address(uint160(0x10000 + i * 2 + 1))), (2 * BUY_IN * 9000) / 10000);
            }
        }
        for (uint256 i = 0; i < lobbies; i++) {
            assertTrue(results[settles + i].success);
            assertEq(uint8(BattleEscrow(open[i]).status()), uint8(BattleEscrow.Status.Refunded));
            assertEq(stakeToken.balanceOf(address(uint160(0x10000 + (1000 + i) * 2))), BUY_IN);
        }
        // the relayer never touches the money
        assertEq(stakeToken.balanceOf(relayer), 0);
    }

    function test_singleSettle_gas() public {
        address duel = _liveDuel(0);
        vm.warp(block.timestamp + DURATION + 1);
        bytes memory sig = _sign(duel, 1);
        uint256 gasBefore = gasleft();
        vm.prank(relayer);
        BattleEscrow(duel).settle(1, address(0), 0, address(0), 0, sig);
        console.log("gas for one settle():", gasBefore - gasleft());
    }
}
