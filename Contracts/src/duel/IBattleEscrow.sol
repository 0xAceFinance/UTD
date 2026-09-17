// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @dev Interface the factory calls on each per-match clone. Kept minimal —
/// everything else on BattleEscrow is either a view or callable directly by users.
interface IBattleEscrow {
    function initialize(
        address creator,
        address stakeToken,
        uint256 buyIn,
        uint8 creatorSide,
        uint256 durationSeconds,
        string calldata tokenASymbol,
        string calldata tokenBSymbol
    ) external;

    function activate(address opponent) external;

    function cancel(address canceller) external;

    function expire() external;

    function joinTerms() external view returns (address stakeToken, uint256 buyIn);
}
