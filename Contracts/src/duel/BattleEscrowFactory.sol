// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./IBattleEscrow.sol";

/**
 * @title BattleEscrowFactory
 * @dev The single entry point users interact with to create, join, cancel,
 * or expire a duel (spec Section 02/03). Every match is a cheap minimal-proxy
 * clone of one audited BattleEscrow implementation, so funds are isolated
 * per match and auditing the implementation once covers every match.
 *
 * The owner has no function that directly moves user funds — that property
 * still lives on BattleEscrow itself, not here. But be clear-eyed about what
 * the owner *can* do indirectly: rotating oracleSigner changes who is able to
 * produce a valid settlement/void signature for every duel activated after the
 * rotation (each escrow snapshots the signer at activate(), so duels already in
 * flight keep the signer they started with), which is real influence over match
 * outcomes, not nothing. That rotation
 * goes through a timelock (see proposeOracleSigner/executeOracleSignerRotation
 * below) specifically so a compromised or malicious owner can't redirect a
 * live duel's payout instantly and unnoticed — anyone watching
 * OracleSignerRotationProposed has ORACLE_SIGNER_TIMELOCK_DELAY to react.
 * platformTreasury rotation only redirects the platform's own 20% cut, not
 * any player's funds, so it stays instant.
 */
/// @dev Emergency pause (owner-only, instant): for a leaked or misbehaving
/// oracle key, which the 24h signer timelock can't stop in time. While paused,
/// no new duel can be created or joined, and every escrow refuses settle() and
/// voidActive() -- so a leaked key can't pick winners. Exits stay open: cancel,
/// expire, refundStale and withdraw still work, so a pause can at worst turn
/// in-flight duels into refunds, never send funds anywhere they aren't owed.
contract BattleEscrowFactory is Ownable, Pausable {
    using SafeERC20 for IERC20;
    using Clones for address;

    uint256 public constant MIN_DURATION = 15 minutes;
    uint256 public constant MAX_DURATION = 40 minutes;
    uint256 public constant ORACLE_SIGNER_TIMELOCK_DELAY = 24 hours;

    address public immutable escrowImplementation;
    address public oracleSigner;
    address public platformTreasury;
    /// @dev The one stake token createDuel() accepts (spec Section 02: a single
    /// dollar-value duel product, not a generic multi-token market). Blocks
    /// creating a duel with a self-minted worthless token (free points farming)
    /// or a rebasing/fee-charging token (can leave payouts permanently stuck).
    address public approvedStakeToken;
    /// @dev Smallest buyIn createDuel() accepts, in stake-token units. Points are
    /// awarded per duel with a floor that ignores stake size, so without this a
    /// pair of sybil wallets could farm points with near-zero-value (e.g. 1 wei) duels.
    uint256 public minBuyIn;

    address public pendingOracleSigner;
    uint256 public pendingOracleSignerEffectiveAt;

    address[] public allDuels;
    mapping(address => bool) public isDuel;

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
    event OracleSignerRotationProposed(address indexed signer, uint256 effectiveAt);
    event OracleSignerUpdated(address indexed signer);
    event PlatformTreasuryUpdated(address indexed treasury);
    event ApprovedStakeTokenUpdated(address indexed stakeToken);
    event MinBuyInUpdated(uint256 minBuyIn);

    constructor(address _escrowImplementation, address _oracleSigner, address _platformTreasury, address _approvedStakeToken, uint256 _minBuyIn)
        Ownable(msg.sender)
    {
        require(_escrowImplementation != address(0), "bad implementation");
        require(_oracleSigner != address(0), "bad signer");
        require(_platformTreasury != address(0), "bad treasury");
        require(_approvedStakeToken != address(0), "bad stake token");
        escrowImplementation = _escrowImplementation;
        oracleSigner = _oracleSigner;
        platformTreasury = _platformTreasury;
        approvedStakeToken = _approvedStakeToken;
        require(_minBuyIn > 0, "bad min buyIn");
        minBuyIn = _minBuyIn;
    }

    function createDuel(
        address stakeToken,
        uint256 buyIn,
        uint8 creatorSide,
        uint256 durationSeconds,
        string calldata tokenASymbol,
        string calldata tokenBSymbol
    ) external whenNotPaused returns (address duel) {
        require(stakeToken == approvedStakeToken, "stake token not approved");
        require(creatorSide == 0 || creatorSide == 1, "bad side");
        require(durationSeconds >= MIN_DURATION && durationSeconds <= MAX_DURATION, "duration out of range");
        require(buyIn >= minBuyIn, "bad buyIn");

        duel = escrowImplementation.clone();

        // Pull the creator's stake straight to the new clone before initializing it,
        // so initialize() can assert the funds actually arrived.
        IERC20(stakeToken).safeTransferFrom(msg.sender, duel, buyIn);

        IBattleEscrow(duel).initialize(msg.sender, stakeToken, buyIn, creatorSide, durationSeconds, tokenASymbol, tokenBSymbol);

        allDuels.push(duel);
        isDuel[duel] = true;
        emit DuelCreated(duel, msg.sender, stakeToken, buyIn, creatorSide, durationSeconds, tokenASymbol, tokenBSymbol);
    }

    function joinDuel(address duel) external whenNotPaused {
        require(isDuel[duel], "unknown duel");
        (address stakeToken, uint256 buyIn) = IBattleEscrow(duel).joinTerms();
        IERC20(stakeToken).safeTransferFrom(msg.sender, duel, buyIn);
        IBattleEscrow(duel).activate(msg.sender);
        emit DuelJoined(duel, msg.sender);
    }

    function cancelDuel(address duel) external {
        require(isDuel[duel], "unknown duel");
        IBattleEscrow(duel).cancel(msg.sender);
        emit DuelCancelled(duel, msg.sender);
    }

    function expireDuel(address duel) external {
        require(isDuel[duel], "unknown duel");
        IBattleEscrow(duel).expire();
        emit DuelExpired(duel);
    }

    /// @dev Step 1 of 2: propose a new oracle signer. Takes effect no sooner
    /// than ORACLE_SIGNER_TIMELOCK_DELAY later, via executeOracleSignerRotation.
    /// Overwrites any not-yet-executed pending proposal.
    function proposeOracleSigner(address _signer) external onlyOwner {
        require(_signer != address(0), "bad signer");
        pendingOracleSigner = _signer;
        pendingOracleSignerEffectiveAt = block.timestamp + ORACLE_SIGNER_TIMELOCK_DELAY;
        emit OracleSignerRotationProposed(_signer, pendingOracleSignerEffectiveAt);
    }

    /// @dev Step 2 of 2: applies a previously-proposed oracle signer once its
    /// timelock has elapsed. Permissionless on purpose -- the security here
    /// comes from the delay and the public proposal event being observable,
    /// not from restricting who can flip the switch once it's due.
    function executeOracleSignerRotation() external {
        require(pendingOracleSigner != address(0), "no pending rotation");
        require(block.timestamp >= pendingOracleSignerEffectiveAt, "timelock not elapsed");

        oracleSigner = pendingOracleSigner;
        emit OracleSignerUpdated(oracleSigner);

        pendingOracleSigner = address(0);
        pendingOracleSignerEffectiveAt = 0;
    }

    function setPlatformTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "bad treasury");
        platformTreasury = _treasury;
        emit PlatformTreasuryUpdated(_treasury);
    }

    function setApprovedStakeToken(address _stakeToken) external onlyOwner {
        require(_stakeToken != address(0), "bad stake token");
        approvedStakeToken = _stakeToken;
        emit ApprovedStakeTokenUpdated(_stakeToken);
    }

    function setMinBuyIn(uint256 _minBuyIn) external onlyOwner {
        require(_minBuyIn > 0, "bad min buyIn");
        minBuyIn = _minBuyIn;
        emit MinBuyInUpdated(_minBuyIn);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function allDuelsLength() external view returns (uint256) {
        return allDuels.length;
    }
}
