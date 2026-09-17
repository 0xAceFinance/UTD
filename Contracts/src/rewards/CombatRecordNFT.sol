// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CombatRecordNFT
 * @dev Spec Section 07: one soulbound NFT per wallet, minted automatically on
 * a wallet's first points award, tracking lifetime points (drives tier) and
 * how many of those points have been redeemed for the platform token.
 *
 * Soulbound is enforced at the token-mechanics level, not by convention:
 * `_update` reverts on any transfer between two non-zero addresses, and
 * `approve`/`setApprovalForAll` are disabled outright so a wallet can't even
 * list it somewhere that would silently fail. Letting this trade would let
 * people buy reputation and tier perks instead of earning them.
 */
contract CombatRecordNFT is ERC721, Ownable {
    address public pointsOracle;
    address public redemptionVault;

    uint256 private nextTokenId = 1;
    mapping(address => uint256) public tokenIdOf; // 0 == not minted yet
    mapping(address => uint256) public totalPoints; // lifetime, never decreases -> drives tier
    mapping(address => uint256) public redeemedPoints;

    event PointsAdded(address indexed wallet, uint256 amount, uint256 newTotal);
    event PointsRedeemed(address indexed wallet, uint256 amount, uint256 newRedeemed);
    event PointsOracleUpdated(address indexed oracle);
    event RedemptionVaultUpdated(address indexed vault);

    modifier onlyPointsOracle() {
        require(msg.sender == pointsOracle, "only points oracle");
        _;
    }

    modifier onlyRedemptionVault() {
        require(msg.sender == redemptionVault, "only redemption vault");
        _;
    }

    constructor(address _pointsOracle) ERC721("MCAP DUEL Combat Record", "DUELREC") Ownable(msg.sender) {
        require(_pointsOracle != address(0), "bad oracle");
        pointsOracle = _pointsOracle;
    }

    function setPointsOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "bad oracle");
        pointsOracle = _oracle;
        emit PointsOracleUpdated(_oracle);
    }

    function setRedemptionVault(address _vault) external onlyOwner {
        require(_vault != address(0), "bad vault");
        redemptionVault = _vault;
        emit RedemptionVaultUpdated(_vault);
    }

    /// @dev Mints the wallet's Combat Record on its first-ever points award.
    function addPoints(address wallet, uint256 amount) external onlyPointsOracle {
        require(amount > 0, "zero amount");
        if (tokenIdOf[wallet] == 0) {
            uint256 tokenId = nextTokenId++;
            tokenIdOf[wallet] = tokenId;
            _safeMint(wallet, tokenId);
        }
        totalPoints[wallet] += amount;
        emit PointsAdded(wallet, amount, totalPoints[wallet]);
    }

    function markRedeemed(address wallet, uint256 amount) external onlyRedemptionVault {
        require(availablePoints(wallet) >= amount, "insufficient available points");
        redeemedPoints[wallet] += amount;
        emit PointsRedeemed(wallet, amount, redeemedPoints[wallet]);
    }

    function availablePoints(address wallet) public view returns (uint256) {
        return totalPoints[wallet] - redeemedPoints[wallet];
    }

    /// @dev Mirrors points/src/pointsEngine.ts's tierForPoints — keep the two in sync by hand for now.
    function tierOf(address wallet) public view returns (string memory) {
        uint256 pts = totalPoints[wallet];
        if (pts >= 100_000) return "Diamond";
        if (pts >= 25_000) return "Gold";
        if (pts >= 5_000) return "Silver";
        return "Bronze";
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert("Combat Record is soulbound: non-transferable");
        }
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert("Combat Record is soulbound: cannot be approved for transfer");
    }

    function setApprovalForAll(address, bool) public pure override {
        revert("Combat Record is soulbound: cannot be approved for transfer");
    }
}
