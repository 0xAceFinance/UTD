// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IBattleEscrow.sol";

/**
 * @title BattleEscrowFactory
 * @dev The single entry point users interact with to create, join, cancel,
 * or expire a duel (spec Section 02/03). Every match is a cheap minimal-proxy
 * clone of one audited BattleEscrow implementation, so funds are isolated
 * per match and auditing the implementation once covers every match.
 *
 * The owner here can only tune two config addresses (oracleSigner,
 * platformTreasury) — it has no function that moves user funds. That
 * property lives on BattleEscrow itself, not here.
 */
contract BattleEscrowFactory is Ownable {
    using SafeERC20 for IERC20;
    using Clones for address;

    uint256 public constant MIN_DURATION = 15 minutes;
    uint256 public constant MAX_DURATION = 40 minutes;

    address public immutable escrowImplementation;
    address public oracleSigner;
    address public platformTreasury;

    address[] public allDuels;

    event DuelCreated(
        address indexed duel,
        address indexed creator,
        address stakeToken,
        uint256 buyIn,
        uint8 creatorSide,
        uint256 durationSeconds,
        string tokenASymbol,
        string tokenBSymbol
    );
    event DuelJoined(address indexed duel, address indexed opponent);
    event DuelCancelled(address indexed duel, address indexed canceller);
    event DuelExpired(address indexed duel);
    event OracleSignerUpdated(address indexed signer);
    event PlatformTreasuryUpdated(address indexed treasury);

    constructor(address _escrowImplementation, address _oracleSigner, address _platformTreasury) Ownable(msg.sender) {
        require(_escrowImplementation != address(0), "bad implementation");
        require(_oracleSigner != address(0), "bad signer");
        require(_platformTreasury != address(0), "bad treasury");
        escrowImplementation = _escrowImplementation;
        oracleSigner = _oracleSigner;
        platformTreasury = _platformTreasury;
    }

    function createDuel(
        address stakeToken,
        uint256 buyIn,
        uint8 creatorSide,
        uint256 durationSeconds,
        string calldata tokenASymbol,
        string calldata tokenBSymbol
    ) external returns (address duel) {
        require(creatorSide == 0 || creatorSide == 1, "bad side");
        require(durationSeconds >= MIN_DURATION && durationSeconds <= MAX_DURATION, "duration out of range");
        require(buyIn > 0, "bad buyIn");

        duel = escrowImplementation.clone();

        // Pull the creator's stake straight to the new clone before initializing it,
        // so initialize() can assert the funds actually arrived.
        IERC20(stakeToken).safeTransferFrom(msg.sender, duel, buyIn);

        IBattleEscrow(duel).initialize(msg.sender, stakeToken, buyIn, creatorSide, durationSeconds, tokenASymbol, tokenBSymbol);

        allDuels.push(duel);
        emit DuelCreated(duel, msg.sender, stakeToken, buyIn, creatorSide, durationSeconds, tokenASymbol, tokenBSymbol);
    }

    function joinDuel(address duel) external {
        (address stakeToken, uint256 buyIn) = IBattleEscrow(duel).joinTerms();
        IERC20(stakeToken).safeTransferFrom(msg.sender, duel, buyIn);
        IBattleEscrow(duel).activate(msg.sender);
        emit DuelJoined(duel, msg.sender);
    }

    function cancelDuel(address duel) external {
        IBattleEscrow(duel).cancel(msg.sender);
        emit DuelCancelled(duel, msg.sender);
    }

    function expireDuel(address duel) external {
        IBattleEscrow(duel).expire();
        emit DuelExpired(duel);
    }

    function setOracleSigner(address _signer) external onlyOwner {
        require(_signer != address(0), "bad signer");
        oracleSigner = _signer;
        emit OracleSignerUpdated(_signer);
    }

    function setPlatformTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "bad treasury");
        platformTreasury = _treasury;
        emit PlatformTreasuryUpdated(_treasury);
    }

    function allDuelsLength() external view returns (uint256) {
        return allDuels.length;
    }
}
