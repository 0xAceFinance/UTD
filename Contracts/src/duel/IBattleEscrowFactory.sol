// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @dev What a BattleEscrow clone needs to read back from its factory.
interface IBattleEscrowFactory {
    function oracleSigner() external view returns (address);
    function platformTreasury() external view returns (address);
    function paused() external view returns (bool);
    /// @dev Winner's fixed share of the pot, in bps of 10000 -- read live at
    /// settle() time so it can be retuned without redeploying BattleEscrow.
    function winnerBps() external view returns (uint256);
    /// @dev Hard ceiling on either referrer's cut, in bps of one side's buyIn --
    /// read live at settle() time, same reasoning as winnerBps.
    function maxReferrerBps() external view returns (uint256);
}
