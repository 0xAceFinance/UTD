// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @dev What a BattleEscrow clone needs to read back from its factory.
interface IBattleEscrowFactory {
    function oracleSigner() external view returns (address);
    function platformTreasury() external view returns (address);
}
