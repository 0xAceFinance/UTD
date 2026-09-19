// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../src/rewards/CombatRecordNFT.sol";
import "../src/rewards/RedemptionVault.sol";
import "../test/duel/MockERC20.sol";

/**
 * Deploys the points/rewards layer (spec Section 07): CombatRecordNFT, then
 * RedemptionVault pointed at it, then wires the NFT to the vault. Independent
 * of DeployDuel -- the duel contracts never call these.
 *
 * Required env vars:
 *  PRIVATE_KEY              deployer key
 *  POINTS_ORACLE_ADDRESS    the only address allowed to addPoints(). It can mint
 *                           points to anyone, so it must be its own key -- not the
 *                           duel oracle signer, the settlement relayer, or the owner.
 *  REWARD_TOKEN_ADDRESS     the platform token redeemed points pay out in
 *                           (not required if DEPLOY_MOCK_REWARD_TOKEN=true)
 *  TOKENS_PER_POINT_WAD     reward-token base units paid per point (e.g. 1e15 =
 *                           0.001 token/point for an 18-decimal token). Must be > 0:
 *                           at 0 every redeem() reverts.
 *
 * Optional:
 *  REWARDS_OWNER            hand ownership of both contracts to this address (a
 *                           multisig) once wired. The owner can swap the points
 *                           oracle and change the rate, vesting and tier caps.
 *  VESTING_DURATION_SECONDS override the 60-day default (must be 30-90 days)
 *  VAULT_FUNDING_AMOUNT     reward tokens (base units) to transfer from the
 *                           deployer into the vault. redeem() never promises more
 *                           than the vault holds, so an unfunded vault redeems nothing.
 *  ORACLE_SIGNER_ADDRESS    the duel oracle signer / FE settlement relayer. Only
 *  RELAYER_ADDRESS          checked: the script refuses to reuse either as the
 *                           points oracle.
 *  DEPLOY_MOCK_REWARD_TOKEN=true  deploys MockERC20 as the reward token and
 *                           mints VAULT_FUNDING_AMOUNT (default 1,000,000e18) to
 *                           the deployer for funding. Local/testnet only.
 */
contract DeployRewards is Script {
    using SafeERC20 for IERC20;

    struct Config {
        uint256 deployerPrivateKey;
        address pointsOracle;
        address rewardToken; // ignored when deployMockRewardToken
        uint256 tokensPerPointWad;
        bool deployMockRewardToken;
        address owner; // 0 = keep the deployer
        uint256 vestingDuration; // 0 = contract default (60 days)
        uint256 funding; // reward-token base units moved into the vault
        address duelOracleSigner; // 0 = not checked
        address relayer; // 0 = not checked
    }

    function run() external returns (CombatRecordNFT, RedemptionVault) {
        bool mock = vm.envOr("DEPLOY_MOCK_REWARD_TOKEN", false);
        return deploy(
            Config({
                deployerPrivateKey: vm.envUint("PRIVATE_KEY"),
                pointsOracle: vm.envAddress("POINTS_ORACLE_ADDRESS"),
                rewardToken: mock ? address(0) : vm.envAddress("REWARD_TOKEN_ADDRESS"),
                tokensPerPointWad: vm.envUint("TOKENS_PER_POINT_WAD"),
                deployMockRewardToken: mock,
                owner: vm.envOr("REWARDS_OWNER", address(0)),
                vestingDuration: vm.envOr("VESTING_DURATION_SECONDS", uint256(0)),
                funding: vm.envOr("VAULT_FUNDING_AMOUNT", mock ? uint256(1_000_000e18) : 0),
                duelOracleSigner: vm.envOr("ORACLE_SIGNER_ADDRESS", address(0)),
                relayer: vm.envOr("RELAYER_ADDRESS", address(0))
            })
        );
    }

    function deploy(Config memory c) public returns (CombatRecordNFT combatRecord, RedemptionVault vault) {
        address deployer = vm.addr(c.deployerPrivateKey);
        require(c.tokensPerPointWad > 0, "TOKENS_PER_POINT_WAD must be > 0");
        require(c.pointsOracle != c.duelOracleSigner, "points oracle must not be the duel oracle signer");
        require(c.pointsOracle != c.relayer, "points oracle must not be the settlement relayer");
        require(c.owner == address(0) || c.pointsOracle != c.owner, "points oracle must not be the owner");

        vm.startBroadcast(c.deployerPrivateKey);

        address rewardToken = c.rewardToken;
        if (c.deployMockRewardToken) {
            MockERC20 mock = new MockERC20();
            mock.mint(deployer, c.funding);
            rewardToken = address(mock);
            console.log("MockERC20 reward token:", rewardToken);
        }
        uint8 decimals = IERC20Metadata(rewardToken).decimals();

        combatRecord = new CombatRecordNFT(c.pointsOracle);
        vault = new RedemptionVault(rewardToken, address(combatRecord), c.tokensPerPointWad);
        // Owner-only, so this must happen before ownership moves.
        combatRecord.setRedemptionVault(address(vault));
        if (c.vestingDuration != 0) vault.setVestingDuration(c.vestingDuration);

        if (c.funding > 0) {
            require(IERC20(rewardToken).balanceOf(deployer) >= c.funding, "deployer lacks VAULT_FUNDING_AMOUNT");
            IERC20(rewardToken).safeTransfer(address(vault), c.funding);
        }

        if (c.owner != address(0)) {
            combatRecord.transferOwnership(c.owner);
            vault.transferOwnership(c.owner);
        }

        vm.stopBroadcast();

        console.log("CombatRecordNFT:", address(combatRecord));
        console.log("RedemptionVault:", address(vault));
        console.log("pointsOracle:", c.pointsOracle);
        console.log("rewardToken:", rewardToken);
        console.log("reward token decimals:", decimals);
        console.log("tokensPerPointWad:", c.tokensPerPointWad);
        console.log("vestingDurationSeconds:", vault.vestingDurationSeconds());
        console.log("vault balance:", IERC20(rewardToken).balanceOf(address(vault)));
        console.log("owner:", combatRecord.owner());
        if (c.funding == 0) console.log("WARNING: vault is unfunded -- every redeem() reverts until reward tokens are sent to it");
    }
}
