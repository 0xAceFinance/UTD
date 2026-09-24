import { formatEther, parseEther } from 'viem';
import { publicClient } from '@/lib/chainClient';
import { relayerAccount } from '@/lib/settlementRelayer';
import { postAlert } from '@/lib/alerts';

/** Below this, alert: the keeper stops paying out once it can't afford gas. Override with KEEPER_MIN_BALANCE_ETH.
 * Also the threshold lib/relayerTopUp.ts tops up at -- exported so the two never drift apart. */
export const DEFAULT_MIN_BALANCE_ETH = '0.002';
/** Per-instance throttle so a per-minute cron doesn't page every minute. */
const ALERT_EVERY_MS = 30 * 60_000;
let lastAlertAt = 0;

export interface RelayerHealth {
    address: string;
    balanceEth: string;
    low: boolean;
}

/**
 * The relayer wallet pays gas for every automatic payout/refund. Players pay
 * no fee for it: the gas comes out of the platform's own cut of each pot, and
 * the wallet is topped up with ETH by hand from platform revenue. This alerts
 * (ALERT_WEBHOOK_URL) when the balance runs low, before payouts stall.
 */
export async function checkRelayerHealth(): Promise<RelayerHealth | null> {
    const account = relayerAccount();
    if (!account) return null;

    const balance = await publicClient.getBalance({ address: account.address });
    const min = parseEther(process.env.KEEPER_MIN_BALANCE_ETH ?? DEFAULT_MIN_BALANCE_ETH);
    const health: RelayerHealth = {
        address: account.address,
        balanceEth: formatEther(balance),
        low: balance < min,
    };

    // The automatic top-up (lib/relayerTopUp.ts) handles this on its own most of
    // the time; this alert is for when it can't (no gasSwap config, daily cap
    // hit, allowance too low, or the swap itself failed -- those cases post
    // their own more specific alert from relayerTopUp.ts).
    if (health.low && Date.now() - lastAlertAt > ALERT_EVERY_MS) {
        lastAlertAt = Date.now();
        await postAlert(`[keeper] relayer ${health.address} balance ${health.balanceEth} ETH is below ${formatEther(min)} ETH -- top it up or payouts will stall`);
    }
    return health;
}
