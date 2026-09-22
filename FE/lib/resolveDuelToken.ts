import DuelToken from '@/lib/models/DuelToken';

/** Bare-minimum shape check for a client-supplied token snapshot -- not a
 * trust boundary, just enough to stop obviously-malformed data from reaching
 * the database. */
export function isValidTokenSnapshot(s: unknown): s is {
    symbol: string;
    name: string;
    tokenAddress: string;
    totalSupply: number;
    marketCapUsd: number;
} {
    if (!s || typeof s !== 'object') return false;
    const t = s as Record<string, unknown>;
    return (
        typeof t.symbol === 'string' &&
        typeof t.name === 'string' &&
        typeof t.tokenAddress === 'string' &&
        typeof t.totalSupply === 'number' &&
        typeof t.marketCapUsd === 'number'
    );
}

export interface ResolvedDuelToken {
    symbol: string;
    name: string;
    tokenAddress: string;
    totalSupply: number;
    marketCapUsd: number;
}

/** Resolve a symbol to full token data, preferring the live DuelToken doc
 * (freshest price data) and falling back to a client-supplied snapshot taken
 * at the moment the user acted -- so a scan rotating this symbol out of
 * today's Top 10 in between doesn't block a transaction that already landed
 * on-chain. Returns null if neither source has usable data. */
export async function resolveDuelToken(symbol: string, snapshot?: unknown): Promise<ResolvedDuelToken | null> {
    const live = await DuelToken.findOne({ symbol });
    if (live) return live;
    return isValidTokenSnapshot(snapshot) ? snapshot : null;
}
