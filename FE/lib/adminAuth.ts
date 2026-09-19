import { timingSafeEqual } from 'crypto';

/**
 * Minimal shared-secret gate for the internal HELD-duel resolution routes
 * (app/api/admin/**). There's no session/user-auth system anywhere else in
 * this app yet, so this is a deliberate stop-gap -- a single operator secret
 * checked against the x-admin-secret header, not a real admin identity
 * system. Fine for "doesn't need to be public-facing"; replace with real
 * admin auth before this surface grows beyond a couple of endpoints.
 */
export function isAuthorizedAdmin(req: Request): boolean {
    return secretMatches(process.env.ADMIN_API_SECRET, req.headers.get('x-admin-secret'));
}

/** Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` (app/api/cron/**). Unset secret = always denied. */
export function isAuthorizedCron(req: Request): boolean {
    const header = req.headers.get('authorization');
    return secretMatches(process.env.CRON_SECRET, header?.startsWith('Bearer ') ? header.slice(7) : null);
}

function secretMatches(configured: string | undefined, provided: string | null): boolean {
    if (!configured || !provided) return false;

    const a = Buffer.from(configured);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}
