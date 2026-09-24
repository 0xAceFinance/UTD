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

type OpponentTokenCheck =
    | { ok: true; slot: 'tokenA' | 'tokenB'; token: ResolvedDuelToken | null }
    | { ok: false; error: string };

function sameToken(a: { symbol: string; tokenAddress?: string }, b: { symbol: string; tokenAddress?: string }): boolean {
    if (a.symbol.toLowerCase() === b.symbol.toLowerCase()) return true;
    return !!a.tokenAddress && !!b.tokenAddress && a.tokenAddress.toLowerCase() === b.tokenAddress.toLowerCase();
}

/** Validates the joiner's token pick for `duel`, shared by the join precheck
 * (GET, before the wallet signs) and the join itself (POST). New lobbies have
 * no opponent token yet, so a pick is required; a legacy lobby with a proposed
 * opposing token may keep it (no symbol / the same symbol → `token: null`).
 * Either way the pick must be a real Top-10 token and never the creator's own
 * token -- compared by address too, since two tokens can share a ticker. */
export async function validateOpponentToken(
    duel: { creatorSide: 0 | 1; tokenA: { symbol: string; tokenAddress?: string }; tokenB?: { symbol: string; tokenAddress?: string } },
    symbol: string | undefined,
    snapshot?: unknown
): Promise<OpponentTokenCheck> {
    const slot = duel.creatorSide === 0 ? 'tokenB' : 'tokenA';
    const creatorToken = duel.creatorSide === 0 ? duel.tokenA : duel.tokenB;
    const proposed = duel[slot];
    if (!creatorToken) return { ok: false, error: 'duel has no creator token' };

    if (!symbol || (proposed && symbol === proposed.symbol)) {
        return proposed ? { ok: true, slot, token: null } : { ok: false, error: 'Pick your token to join this duel.' };
    }
    if (sameToken({ symbol }, creatorToken)) {
        return { ok: false, error: "You can't pick the same token as your opponent." };
    }
    const resolved = await resolveDuelToken(symbol, snapshot);
    if (!resolved) return { ok: false, error: "Token must be from today's Top 10." };
    if (sameToken(resolved, creatorToken)) {
        return { ok: false, error: "You can't pick the same token as your opponent." };
    }
    return { ok: true, slot, token: resolved };
}
