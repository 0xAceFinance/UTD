import { parseAbi, parseUnits, formatUnits, formatEther, encodeFunctionData } from 'viem';
import type { PrivateKeyAccount, WalletClient } from 'viem';
import { chain, publicClient, readStakeTokenDecimals } from '@/lib/chainClient';
import { CONTRACTS } from '@/config/contracts';
import { getKeeperConfig } from '@/lib/models/KeeperConfig';
import KeeperConfig from '@/lib/models/KeeperConfig';
import { postAlert } from '@/lib/alerts';
import { DEFAULT_MIN_BALANCE_ETH } from '@/lib/relayerHealth';

/**
 * Keeps the relayer wallet funded with ETH automatically, with no manual
 * transfer, so it never runs out of gas mid-batch. Runs as the last step of
 * every keeper tick (lib/settlementRelayer.ts::runKeeperTick), under the same
 * send lock as the payout/refund batches -- reacting within seconds of the
 * settlement that (indirectly) made the balance low, not on a separate clock.
 *
 * The money path: the platform treasury signs one capped approve() for the
 * relayer (a one-time, manual, on-chain action -- Deployment.md), so the
 * relayer can pull a small slice of USDG (never more than that allowance),
 * swap it for ETH on the real USDG/WETH Uniswap v3 pool, and unwrap it to
 * native ETH for itself. The relayer never holds the treasury's key, and the
 * approve() ceiling bounds the worst case if the relayer's own key ever leaks.
 *
 * How much to pull each time is `KeeperConfig.topUpUsdg` (lib/models/KeeperConfig.ts,
 * default $1) -- admin-adjustable at runtime via GET/PATCH
 * /api/admin/keeper-config as the treasury grows, no redeploy needed.
 */

const erc20Abi = parseAbi([
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
]);

/** Real, on-chain Uniswap v3 QuoterV2/SwapRouter02 interfaces (config/contracts.ts's gasSwap addresses) -- verified against the live contracts before this was written. */
const quoterAbi = parseAbi([
    'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
    'function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
const swapRouterAbi = parseAbi([
    'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
    'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
    'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
    'function multicall(bytes[] data) payable returns (bytes[] results)',
]);

/** Below this, the relayer's balance counts as "low enough to top up" -- same threshold lib/relayerHealth.ts alerts on. */
const DEFAULT_MAX_TOP_UPS_PER_DAY = 3;
/** How far below the live quote the swap's amountOutMinimum is set -- protects against a stale quote or a thin-liquidity price move, not normal slippage tolerance. */
const SLIPPAGE_BPS = 50; // 0.5%
const TX_TIMEOUT_MS = 60_000;

export type TopUpStatus =
    | 'topped_up'
    | 'balance_ok' // nothing to do
    | 'unconfigured' // this chain has no gasSwap config, or RELAYER_PRIVATE_KEY unset
    | 'daily_cap_reached'
    | 'allowance_too_low' // treasury needs to sign a fresh approve()
    | 'failed';

export interface TopUpResult {
    status: TopUpStatus;
    usdgPulled?: string;
    ethReceived?: string;
    txHash?: `0x${string}`;
    error?: string;
}

function utcDateString(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * Tops the relayer up with ETH if it's running low, pulling a small,
 * admin-set slice of USDG from the treasury's pre-approved allowance and
 * swapping it. A no-op (cheap: one balance read) when the balance is fine,
 * so it's safe to call on every tick. Never throws -- a failure here must
 * never abort the payouts/refunds a tick already sent.
 */
export async function maybeTopUpRelayer(account: PrivateKeyAccount, wallet: WalletClient, now = new Date()): Promise<TopUpResult> {
    try {
        const gasSwap = CONTRACTS.gasSwap;
        if (!gasSwap) return { status: 'unconfigured' };

        const balance = await publicClient.getBalance({ address: account.address });
        const min = parseUnits(process.env.KEEPER_MIN_BALANCE_ETH ?? DEFAULT_MIN_BALANCE_ETH, 18);
        if (balance >= min) return { status: 'balance_ok' };

        const config = await getKeeperConfig();
        const today = utcDateString(now);
        const doneToday = config.topUpDay === today ? (config.topUpsToday ?? 0) : 0;
        const maxPerDay = Number(process.env.KEEPER_TOPUP_MAX_PER_DAY ?? DEFAULT_MAX_TOP_UPS_PER_DAY);
        if (doneToday >= maxPerDay) {
            await postAlert(
                `[keeper] relayer ${account.address} is low on gas (${formatEther(balance)} ETH) but today's top-up cap (${maxPerDay}) is already used -- top it up by hand or raise KEEPER_TOPUP_MAX_PER_DAY`
            );
            return { status: 'daily_cap_reached' };
        }

        const decimals = await readStakeTokenDecimals();
        const amountWei = parseUnits(String(config.topUpUsdg), decimals);

        const allowance = (await publicClient.readContract({
            address: CONTRACTS.stakeToken,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [gasSwap.treasury, account.address],
        })) as bigint;
        if (allowance < amountWei) {
            await postAlert(
                `[keeper] treasury's USDG allowance to the relayer is only ${formatUnits(allowance, decimals)}, below the ${config.topUpUsdg} needed for the next gas top-up -- have the treasury sign a fresh approve()`
            );
            return { status: 'allowance_too_low' };
        }

        const [quotedOut] = (await publicClient.readContract({
            address: gasSwap.quoter,
            abi: quoterAbi,
            functionName: 'quoteExactInputSingle',
            args: [{ tokenIn: CONTRACTS.stakeToken, tokenOut: gasSwap.weth, amountIn: amountWei, fee: gasSwap.poolFeeTier, sqrtPriceLimitX96: 0n }],
        })) as [bigint, bigint, number, bigint];
        const minOut = (quotedOut * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;

        // Pull the USDG to the relayer itself first -- the router pulls payment
        // from whoever calls it (the relayer), not from the treasury directly.
        let hash = await wallet.writeContract({
            account,
            chain,
            address: CONTRACTS.stakeToken,
            abi: erc20Abi,
            functionName: 'transferFrom',
            args: [gasSwap.treasury, account.address, amountWei],
        });
        await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT_MS });

        // One-time-ish: only re-approve the router if its allowance from the
        // relayer's own balance has run out (mirrors lib/duelContract.ts's
        // ensureApproval) -- steady state is one fewer transaction per top-up.
        const routerAllowance = (await publicClient.readContract({
            address: CONTRACTS.stakeToken,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [account.address, gasSwap.swapRouter],
        })) as bigint;
        if (routerAllowance < amountWei) {
            hash = await wallet.writeContract({
                account,
                chain,
                address: CONTRACTS.stakeToken,
                abi: erc20Abi,
                functionName: 'approve',
                args: [gasSwap.swapRouter, amountWei],
            });
            await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT_MS });
        }

        // Swap + unwrap to native ETH in one multicall -- the documented
        // Uniswap v3 periphery pattern for an ETH-out swap: the swap step's
        // recipient is the router's own address (it just holds the WETH), then
        // unwrapWETH9 sends the relayer real ETH instead of wrapped WETH.
        const swapCalldata = encodeFunctionData({
            abi: swapRouterAbi,
            functionName: 'exactInputSingle',
            args: [
                {
                    tokenIn: CONTRACTS.stakeToken,
                    tokenOut: gasSwap.weth,
                    fee: gasSwap.poolFeeTier,
                    recipient: gasSwap.swapRouter,
                    amountIn: amountWei,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0n,
                },
            ],
        });
        const unwrapCalldata = encodeFunctionData({
            abi: swapRouterAbi,
            functionName: 'unwrapWETH9',
            args: [minOut, account.address],
        });
        hash = await wallet.writeContract({
            account,
            chain,
            address: gasSwap.swapRouter,
            abi: swapRouterAbi,
            functionName: 'multicall',
            args: [[swapCalldata, unwrapCalldata]],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: TX_TIMEOUT_MS });
        if (receipt.status !== 'success') throw new Error('swap transaction reverted');

        await KeeperConfig.updateOne({ _id: 'relayer' }, { $set: { topUpDay: today, topUpsToday: doneToday + 1 } });

        const ethAfter = await publicClient.getBalance({ address: account.address });
        return {
            status: 'topped_up',
            usdgPulled: String(config.topUpUsdg),
            ethReceived: formatEther(ethAfter - balance > 0n ? ethAfter - balance : 0n),
            txHash: hash,
        };
    } catch (err) {
        const reason = (err as Error)?.message ?? String(err);
        console.error(`[keeper] relayer gas top-up failed: ${reason}`);
        await postAlert(`[keeper] relayer gas top-up failed: ${reason}`).catch(() => {});
        return { status: 'failed', error: reason };
    }
}
