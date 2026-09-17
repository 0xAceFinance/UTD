// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./IBattleEscrowFactory.sol";

/**
 * @title BattleEscrow
 * @dev One instance per 1v1 duel, deployed as a minimal-proxy clone by
 * BattleEscrowFactory (spec Section 03). Holds exactly one match's funds,
 * isolated from every other match.
 *
 * Non-negotiable properties this contract is built around:
 *  - No owner withdrawal path. Funds leave only via settle(), cancel(), or expire().
 *  - Settlement is authorized by an oracle signature, not by whoever submits the
 *    transaction — so settlement stays permissionless (spec Section 03: "if the
 *    keeper is unavailable, anyone can trigger the same call").
 *  - Reentrancy-guarded on every path that moves funds.
 */
contract BattleEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    enum Status {
        Open,
        Active,
        Settled,
        Refunded
    }

    uint256 public constant MAX_OPEN_WINDOW = 60 minutes;

    address public factory;
    address public stakeToken;
    address public creator;
    address public opponent;
    uint8 public creatorSide; // 0 or 1 — opponent is auto-assigned the other side
    uint256 public buyIn;
    uint256 public durationSeconds;
    string public tokenASymbol;
    string public tokenBSymbol;

    Status public status;
    uint256 public openDeadline; // creator must be matched before this or the lobby expires
    uint256 public startTime;
    uint256 public endTime;
    uint8 public winnerSide;

    bool private initialized;

    event Activated(address indexed opponent, uint256 startTime, uint256 endTime);
    event Cancelled(address indexed by);
    event Expired();
    event Settled(uint8 winnerSide, address indexed winner, uint256 winnerAmount, uint256 platformAmount);

    modifier onlyFactory() {
        require(msg.sender == factory, "only factory");
        _;
    }

    constructor() {
        // The implementation contract itself is never initialized or used directly —
        // only clones of it are. This just blocks anyone from calling initialize()
        // on the implementation and confusing it for a real match.
        initialized = true;
    }

    function initialize(
        address _creator,
        address _stakeToken,
        uint256 _buyIn,
        uint8 _creatorSide,
        uint256 _durationSeconds,
        string calldata _tokenASymbol,
        string calldata _tokenBSymbol
    ) external {
        require(!initialized, "already initialized");
        initialized = true;

        factory = msg.sender;
        creator = _creator;
        stakeToken = _stakeToken;
        buyIn = _buyIn;
        creatorSide = _creatorSide;
        durationSeconds = _durationSeconds;
        tokenASymbol = _tokenASymbol;
        tokenBSymbol = _tokenBSymbol;

        // The factory transfers the creator's stake to this contract in the
        // same transaction as initialize() — this just asserts it actually happened.
        require(IERC20(_stakeToken).balanceOf(address(this)) >= _buyIn, "stake not received");

        status = Status.Open;
        openDeadline = block.timestamp + MAX_OPEN_WINDOW;
    }

    function joinTerms() external view returns (address, uint256) {
        return (stakeToken, buyIn);
    }

    function activate(address _opponent) external onlyFactory {
        require(status == Status.Open, "not open");
        require(block.timestamp <= openDeadline, "open window passed");
        require(_opponent != creator, "cannot duel yourself");
        require(IERC20(stakeToken).balanceOf(address(this)) >= buyIn * 2, "opponent stake not received");

        opponent = _opponent;
        status = Status.Active;
        startTime = block.timestamp;
        endTime = startTime + durationSeconds;

        emit Activated(_opponent, startTime, endTime);
    }

    function cancel(address canceller) external onlyFactory nonReentrant {
        require(status == Status.Open, "not open");
        require(canceller == creator, "only creator can cancel");

        status = Status.Refunded;
        IERC20(stakeToken).safeTransfer(creator, buyIn);

        emit Cancelled(canceller);
    }

    /// @dev Permissionless on purpose — a lobby that never found an opponent
    /// refunds itself without needing anyone's cooperation.
    function expire() external nonReentrant {
        require(status == Status.Open, "not open");
        require(block.timestamp > openDeadline, "open window not passed yet");

        status = Status.Refunded;
        IERC20(stakeToken).safeTransfer(creator, buyIn);

        emit Expired();
    }

    /**
     * @dev Settles the match 80% to the winner / 20% to the platform. Anyone
     * may submit this transaction — what authorizes it is `signature`, an
     * ECDSA signature from the factory's oracleSigner over
     * (this contract, _winnerSide). That is the "permissionless fallback":
     * if the platform's own keeper bot is down, any player (or anyone else
     * holding the signed result) can still push settlement through.
     */
    function settle(uint8 _winnerSide, bytes calldata signature) external nonReentrant {
        require(status == Status.Active, "not active");
        require(block.timestamp >= endTime, "battle still live");
        require(_winnerSide == 0 || _winnerSide == 1, "bad side");

        bytes32 message = keccak256(abi.encodePacked(address(this), _winnerSide));
        address recovered = message.toEthSignedMessageHash().recover(signature);
        require(recovered == IBattleEscrowFactory(factory).oracleSigner(), "invalid oracle signature");

        status = Status.Settled;
        winnerSide = _winnerSide;

        address winner = (_winnerSide == creatorSide) ? creator : opponent;
        address treasury = IBattleEscrowFactory(factory).platformTreasury();

        uint256 pot = buyIn * 2;
        uint256 winnerAmount = (pot * 8000) / 10000; // 80%
        uint256 platformAmount = pot - winnerAmount; // 20%; loser receives nothing on-chain (Section 06)

        IERC20(stakeToken).safeTransfer(winner, winnerAmount);
        IERC20(stakeToken).safeTransfer(treasury, platformAmount);

        emit Settled(_winnerSide, winner, winnerAmount, platformAmount);
    }
}
