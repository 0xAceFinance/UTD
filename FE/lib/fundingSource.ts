import { createPublicClient, http, parseAbiItem } from 'viem';
import { foundry } from 'viem/chains';
import { CONTRACTS } from '@/config/contracts';

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/**
 * How far back to search for a wallet's earliest inbound stake-token
 * transfer. Bounded because there is no chain indexer yet (see
 * engine/src/chain/dexReader.ts's own documented limitation -- its
 * listCandidates()/samplePools() throw for the same reason), so this is a
 * single eth_getLogs call over a fixed recent window, not a full history
 * scan. Good enough for the current testnet stage to catch a same-source
 * funding pattern; revisit once a real indexer exists, since most public RPC
 * providers cap how large a single getLogs range can be on a live chain.
 */
const LOOKBACK_BLOCKS = BigInt(process.env.FUNDING_SOURCE_LOOKBACK_BLOCKS ?? '50000');

const publicClient = createPublicClient({
    chain: { ...foundry, id: CONTRACTS.chainId },
    // Short timeout, no retries: this signal is best-effort and additive to
    // every create/join request's latency, so an unreachable/slow RPC should
    // fail fast (falling back to relying on shared-IP alone for that pair)
    // rather than stacking viem's default retry-with-backoff behavior onto
    // every single duel action.
    transport: http(CONTRACTS.rpcUrl, { timeout: 2_000, retryCount: 0 }),
});

/**
 * Best-effort second signal for @mcapduel/risk's wallet-clustering sybil
 * check (Section 05), alongside shared-IP (lib/requestSignals.ts). Two
 * wallets funded from the same source address are linked even if they never
 * share a network -- the gap the shared-IP-only signal has (see
 * risk/README.md). Returns undefined (never throws) on any RPC failure or if
 * no inbound transfer is found in the lookback window: this is
 * defense-in-depth, not a required check, so a miss here just means relying
 * on the shared-IP signal alone for that pair, same as before this existed.
 */
export async function getFundingSource(wallet: string): Promise<string | undefined> {
    try {
        const latestBlock = await publicClient.getBlockNumber();
        const fromBlock = latestBlock > LOOKBACK_BLOCKS ? latestBlock - LOOKBACK_BLOCKS : 0n;

        const logs = await publicClient.getLogs({
            address: CONTRACTS.stakeToken,
            event: TRANSFER_EVENT,
            args: { to: wallet as `0x${string}` },
            fromBlock,
            toBlock: 'latest',
        });
        if (logs.length === 0) return undefined;

        const earliest = logs.reduce((a, b) => ((a.blockNumber ?? 0n) < (b.blockNumber ?? 0n) ? a : b));
        return earliest.args.from?.toLowerCase();
    } catch {
        return undefined;
    }
}
