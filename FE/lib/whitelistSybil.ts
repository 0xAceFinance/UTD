import { WalletClusterGraph, isSuspectedSybilMatch } from '@mcapduel/risk';
import WhitelistEntry from './models/WhitelistEntry';

/**
 * Same shared-IP clustering @mcapduel/risk already uses to catch sybil
 * duels (see lib/duelEngine.ts::isSybilMatch), reused here for the same
 * reason: a referral between two wallets that have ever signed up from the
 * same IP -- directly or transitively through a chain of other entries --
 * is exactly what a one-person referral farm looks like. A hit doesn't
 * block the signup; it only excludes that referral from the referrer's
 * points (see referredBy/referralSybilFlagged on WhitelistEntry).
 */
export async function isSuspectedSelfReferral(
    referrerWallet: string,
    newWallet: string,
    newWalletIp: string | undefined
): Promise<boolean> {
    if (referrerWallet === newWallet) return true;
    if (!newWalletIp) return false; // no IP signal to cluster on

    const entries = await WhitelistEntry.find({ ip: { $exists: true, $ne: null } }, { identifier: 1, ip: 1 }).lean();

    const walletsByIp = new Map<string, Set<string>>();
    const addEdge = (ip: string, wallet: string) => {
        const set = walletsByIp.get(ip) ?? new Set<string>();
        set.add(wallet);
        walletsByIp.set(ip, set);
    };
    for (const e of entries) addEdge(e.ip!, e.identifier);
    addEdge(newWalletIp, newWallet); // the in-flight signup, not yet persisted

    const graph = new WalletClusterGraph();
    for (const wallets of walletsByIp.values()) {
        const [first, ...rest] = [...wallets];
        for (const w of rest) graph.union(first, w);
    }

    return isSuspectedSybilMatch(graph, referrerWallet, newWallet);
}
