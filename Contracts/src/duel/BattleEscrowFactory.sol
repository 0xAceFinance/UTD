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
 * platformTreasury rotation only redirects the platform's own cut, not any
 * player's funds, so it stays instant -- same for winnerBps/maxReferrerBps
 * (Section-below setters): they retune the fee split's economics, not who
 * wins a given duel, and winnerBps is bounded at MIN_WINNER_BPS so they can
 * never be tuned toward zero. minBuyIn/maxBuyIn are likewise instant and
 * only ever change what future createDuel() calls accept, never anything
 * about a duel already in flight.
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

    /// @dev A duel runs for exactly 5, 10, 15 or 20 minutes.
    uint256 public constant MIN_DURATION = 5 minutes;
    uint256 public constant MAX_DURATION = 20 minutes;
    uint256 public constant DURATION_STEP = 5 minutes;
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
    /// @dev Largest buyIn createDuel() accepts, in stake-token units. 0 means
    /// uncapped (the default, matching behavior before this field existed).
    uint256 public maxBuyIn;

    /// @dev Winner's fixed share of the pot at settlement, in bps of 10000 --
    /// read live by BattleEscrow.settle() (Contracts/src/duel/BattleEscrow.sol)
    /// rather than baked in as a constant, so the platform's take can be
    /// retuned without redeploying the escrow implementation or the factory.
    /// Floored at MIN_WINNER_BPS (see setWinnerBps) so a compromised or
    /// malicious owner can tune fees within a real range but can never zero
    /// out the winner's payout -- the instant-vs-timelocked distinction this
    /// contract already draws for platformTreasury vs oracleSigner applies
    /// here too: this is an economic parameter, not a redirection of a live
    /// duel's outcome, so it stays instant like platformTreasury.
    uint256 public winnerBps = 9000;
    /// @dev Hard ceiling on either referrer's cut in BattleEscrow.settle(), in
    /// bps of one side's buyIn -- same live-read, retunable-without-redeploy
    /// reasoning as winnerBps. Must always leave winnerBps + 2x this value
    /// at or under 10000 (see setWinnerBps/setMaxReferrerBps), or a duel with
    /// two maxed-out referrers would make settle()'s pot arithmetic underflow
    /// and revert.
    uint256 public maxReferrerBps = 500;

    /// @dev winnerBps can never be set below this -- keeps a compromised or
    /// malicious owner from tuning the winner's payout down toward zero via
    /// this instant (non-timelocked) setter. 5000 = 50%, comfortably below
    /// the 9000 (90%) product default but still a real floor.
    uint256 public constant MIN_WINNER_BPS = 5_000;

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
    event MaxBuyInUpdated(uint256 maxBuyIn);
    event WinnerBpsUpdated(uint256 winnerBps);
    event MaxReferrerBpsUpdated(uint256 maxReferrerBps);

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
        require(
            durationSeconds >= MIN_DURATION && durationSeconds <= MAX_DURATION && durationSeconds % DURATION_STEP == 0,
            "duration out of range"
        );
        require(buyIn >= minBuyIn, "bad buyIn");
        require(maxBuyIn == 0 || buyIn <= maxBuyIn, "buyIn above maximum");

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
        require(maxBuyIn == 0 || _minBuyIn <= maxBuyIn, "min buyIn above current max");
        minBuyIn = _minBuyIn;
        emit MinBuyInUpdated(_minBuyIn);
    }

    /// @dev 0 removes the cap entirely (uncapped, the default).
    function setMaxBuyIn(uint256 _maxBuyIn) external onlyOwner {
        require(_maxBuyIn == 0 || _maxBuyIn >= minBuyIn, "max buyIn below current min");
        maxBuyIn = _maxBuyIn;
        emit MaxBuyInUpdated(_maxBuyIn);
    }

    /// @dev Instant, not timelocked (see winnerBps's own doc comment for why).
    /// Bounded to [MIN_WINNER_BPS, 10000 - maxReferrerBps] so it can never
    /// underflow settle()'s pot math nor be tuned toward zero.
    function setWinnerBps(uint256 _winnerBps) external onlyOwner {
        require(_winnerBps >= MIN_WINNER_BPS, "winnerBps below floor");
        require(_winnerBps + maxReferrerBps <= 10_000, "winnerBps leaves no room for maxReferrerBps");
        winnerBps = _winnerBps;
        emit WinnerBpsUpdated(_winnerBps);
    }

    /// @dev Bounded so winnerBps + maxReferrerBps never exceeds 10000 -- see
    /// winnerBps's doc comment for what that protects against.
    function setMaxReferrerBps(uint256 _maxReferrerBps) external onlyOwner {
        require(winnerBps + _maxReferrerBps <= 10_000, "maxReferrerBps leaves winnerBps no room");
        maxReferrerBps = _maxReferrerBps;
        emit MaxReferrerBpsUpdated(_maxReferrerBps);
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
