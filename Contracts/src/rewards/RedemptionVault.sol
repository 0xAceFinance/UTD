// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ICombatRecordNFT.sol";

/**
 * @title RedemptionVault
 * @dev Spec Section 07: the only path from points to the platform token.
 * Points are converted at a treasury-adjustable rate, vest linearly over
 * 30-90 days rather than landing liquid, and are capped per wallet per epoch
 * by tier — so the vault's outflow stays predictable and one heavily-farmed
 * wallet can't drain it. Draws from whatever reward-token balance this
 * contract holds (the "fixed rewards-pool carve-out" from the spec) rather
 * than minting on demand.
 */
contract RedemptionVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct VestingSchedule {
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 startTime;
        /// @dev Snapshotted from vestingDurationSeconds at redeem() time, not
        /// read live -- otherwise a later owner change to the global duration
        /// would retroactively reprice every existing schedule, and could
        /// make _vestedAmount() dip below claimedAmount for one already
        /// partially-claimed, reverting claim() for that wallet's entire
        /// batch (every other schedule too) until enough time passes to
        /// catch back up.
        uint256 vestingDurationSeconds;
    }

    IERC20 public immutable rewardToken;
    ICombatRecordNFT public immutable combatRecord;

    /// @dev Reward-token wei paid out per point (e.g. 1e15 wei/point == 0.001 token per point,
    /// for an 18-decimal reward token). This is a direct rate, not a fixed-point fraction —
    /// no extra scaling division happens at redemption time.
    uint256 public tokensPerPointWad;
    uint256 public vestingDurationSeconds = 60 days;
    uint256 public constant MIN_VESTING = 30 days;
    uint256 public constant MAX_VESTING = 90 days;
    uint256 public epochLengthSeconds = 1 days;

    mapping(bytes32 => uint256) public tierCapPoints; // keccak256(tier name) -> points redeemable per epoch
    mapping(address => mapping(uint256 => uint256)) public redeemedInEpoch;
    mapping(address => VestingSchedule[]) public schedules;

    event Redeemed(address indexed wallet, uint256 pointsAmount, uint256 tokenAmount, uint256 scheduleIndex);
    event Claimed(address indexed wallet, uint256 amount);
    event RateUpdated(uint256 tokensPerPointWad);
    event VestingDurationUpdated(uint256 duration);
    event TierCapUpdated(string tier, uint256 capPoints);

    constructor(address _rewardToken, address _combatRecord, uint256 _tokensPerPointWad) Ownable(msg.sender) {
        require(_rewardToken != address(0) && _combatRecord != address(0), "bad address");
        rewardToken = IERC20(_rewardToken);
        combatRecord = ICombatRecordNFT(_combatRecord);
        tokensPerPointWad = _tokensPerPointWad;

        tierCapPoints[keccak256(bytes("Bronze"))] = 1_000;
        tierCapPoints[keccak256(bytes("Silver"))] = 3_000;
        tierCapPoints[keccak256(bytes("Gold"))] = 8_000;
        tierCapPoints[keccak256(bytes("Diamond"))] = 20_000;
    }

    function redeem(uint256 pointsAmount) external nonReentrant {
        require(pointsAmount > 0, "zero amount");
        require(combatRecord.availablePoints(msg.sender) >= pointsAmount, "insufficient points");

        uint256 epoch = block.timestamp / epochLengthSeconds;
        string memory tier = combatRecord.tierOf(msg.sender);
        uint256 cap = tierCapPoints[keccak256(bytes(tier))];
        require(redeemedInEpoch[msg.sender][epoch] + pointsAmount <= cap, "exceeds this tier's per-epoch redemption cap");

        uint256 tokenAmount = pointsAmount * tokensPerPointWad;
        require(tokenAmount > 0, "rate too low: this would redeem for zero reward tokens");

        redeemedInEpoch[msg.sender][epoch] += pointsAmount;
        combatRecord.markRedeemed(msg.sender, pointsAmount);

        schedules[msg.sender].push(
            VestingSchedule({
                totalAmount: tokenAmount,
                claimedAmount: 0,
                startTime: block.timestamp,
                vestingDurationSeconds: vestingDurationSeconds
            })
        );

        emit Redeemed(msg.sender, pointsAmount, tokenAmount, schedules[msg.sender].length - 1);
    }

    function claim() external nonReentrant {
        VestingSchedule[] storage userSchedules = schedules[msg.sender];
        uint256 claimable = 0;
        for (uint256 i = 0; i < userSchedules.length; i++) {
            VestingSchedule storage s = userSchedules[i];
            uint256 due = _vestedAmount(s) - s.claimedAmount;
            if (due > 0) {
                s.claimedAmount += due;
                claimable += due;
            }
        }
        require(claimable > 0, "nothing vested to claim");
        rewardToken.safeTransfer(msg.sender, claimable);
        emit Claimed(msg.sender, claimable);
    }

    function claimableAmount(address wallet) external view returns (uint256) {
        VestingSchedule[] storage userSchedules = schedules[wallet];
        uint256 total = 0;
        for (uint256 i = 0; i < userSchedules.length; i++) {
            total += _vestedAmount(userSchedules[i]) - userSchedules[i].claimedAmount;
        }
        return total;
    }

    function schedulesLength(address wallet) external view returns (uint256) {
        return schedules[wallet].length;
    }

    function _vestedAmount(VestingSchedule storage s) internal view returns (uint256) {
        if (block.timestamp >= s.startTime + s.vestingDurationSeconds) return s.totalAmount;
        uint256 elapsed = block.timestamp - s.startTime;
        return (s.totalAmount * elapsed) / s.vestingDurationSeconds;
    }

    function setRate(uint256 _tokensPerPointWad) external onlyOwner {
        tokensPerPointWad = _tokensPerPointWad;
        emit RateUpdated(_tokensPerPointWad);
    }

    function setVestingDuration(uint256 _duration) external onlyOwner {
        require(_duration >= MIN_VESTING && _duration <= MAX_VESTING, "must be within the spec's 30-90 day range");
        vestingDurationSeconds = _duration;
        emit VestingDurationUpdated(_duration);
    }

    function setTierCap(string calldata tier, uint256 capPoints) external onlyOwner {
        tierCapPoints[keccak256(bytes(tier))] = capPoints;
        emit TierCapUpdated(tier, capPoints);
    }
}
