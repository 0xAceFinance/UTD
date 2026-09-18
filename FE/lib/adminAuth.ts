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
    const configured = process.env.ADMIN_API_SECRET;
    const provided = req.headers.get('x-admin-secret');
    if (!configured || !provided) return false;

    const a = Buffer.from(configured);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}
