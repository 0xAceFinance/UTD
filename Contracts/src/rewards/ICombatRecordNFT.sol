// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface ICombatRecordNFT {
    function availablePoints(address wallet) external view returns (uint256);
    function totalPoints(address wallet) external view returns (uint256);
    function tierOf(address wallet) external view returns (string memory);
    function markRedeemed(address wallet, uint256 amount) external;
}
