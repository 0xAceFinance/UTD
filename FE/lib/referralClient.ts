/**
 * Client-side referral management.
 * Persists the referral code across page navigation and reloads using
 * localStorage and cookies so attribution is never lost.
 */

const REF_STORAGE_KEY = 'utd_ref';

export function saveRefToStorage(refCode?: string | null): void {
    if (typeof window === 'undefined') return;
    if (!refCode) return;
    const clean = refCode.trim().toUpperCase();
    if (!clean || clean.length > 30) return;
    try {
        localStorage.setItem(REF_STORAGE_KEY, clean);
        // Persist for 30 days in cookie as well
        document.cookie = `${REF_STORAGE_KEY}=${clean}; path=/; max-age=${30 * 24 * 60 * 60}; SameSite=Lax`;
    } catch {
        // Storage access might fail in strict private browsing
    }
}

export function getStoredRef(): string | undefined {
    if (typeof window === 'undefined') return undefined;

    // 1. Check URL query string first
    try {
        const urlRef = new URLSearchParams(window.location.search).get('ref');
        if (urlRef) {
            const clean = urlRef.trim().toUpperCase();
            saveRefToStorage(clean);
            return clean;
        }
    } catch {}

    // 2. Check localStorage
    try {
        const stored = localStorage.getItem(REF_STORAGE_KEY);
        if (stored) return stored.trim().toUpperCase();
    } catch {}

    // 3. Check Cookie
    try {
        const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${REF_STORAGE_KEY}=([^;]+)`));
        if (match && match[1]) return match[1].trim().toUpperCase();
    } catch {}

    return undefined;
}
