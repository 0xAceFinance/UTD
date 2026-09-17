/**
 * Referral points for the pre-launch whitelist's genesis-distribution
 * mechanism -- a tokenomics decision, not a technical one, so it lives here
 * as the one place to tune it later (same pattern as riskConfig.ts's
 * BLOCKED_COUNTRY_CODES).
 *
 * Diminishing returns: the Nth verified referral from one wallet is worth
 * basePoints * decayRate^(N-1), floored at minPoints -- rewards organic
 * sharing over mass farming, while still giving continued sharing *some*
 * value rather than dropping to zero.
 */
export const REFERRAL_POINTS_CONFIG = {
    basePoints: 100,
    decayRate: 0.85,
    minPoints: 10,
};

/** Points for the `index`-th (1-based) verified referral from one wallet. */
export function pointsForReferralIndex(index: number): number {
    if (index < 1) throw new Error('referral index is 1-based');
    const { basePoints, decayRate, minPoints } = REFERRAL_POINTS_CONFIG;
    return Math.max(Math.round(basePoints * decayRate ** (index - 1)), minPoints);
}

/** Total points across `count` verified referrals -- the sum only depends on the count, not which one happened first. */
export function totalReferralPoints(count: number): number {
    let total = 0;
    for (let i = 1; i <= count; i++) total += pointsForReferralIndex(i);
    return total;
}
