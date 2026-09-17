import type { NextRequest } from 'next/server';

/**
 * The request IP behind a wallet action -- the real signal for
 * @mcapduel/risk's wallet-clustering `shared_ip` edge (see
 * lib/models/WalletSighting.ts). Standard reverse-proxy headers; falls back
 * to 'unknown' when neither is present (e.g. plain `next dev` with no proxy
 * in front of it), which never links two wallets together since it's never
 * treated as a real shared IP.
 */
export function getClientIp(req: NextRequest | Request): string {
    const headers = req.headers;
    const forwardedFor = headers.get('x-forwarded-for');
    if (forwardedFor) return forwardedFor.split(',')[0].trim();
    return headers.get('x-real-ip') ?? 'unknown';
}

/**
 * ISO country code for the request, when the hosting platform provides one
 * for free -- Vercel sets `x-vercel-ip-country` on every request with no
 * extra API call. This is the real input to @mcapduel/risk's geofence check
 * (see lib/riskConfig.ts). Off Vercel (local dev, another host), this is
 * absent and the geofence check is skipped rather than guessed at.
 */
export function getClientCountry(req: NextRequest | Request): string | undefined {
    return req.headers.get('x-vercel-ip-country') ?? undefined;
}
