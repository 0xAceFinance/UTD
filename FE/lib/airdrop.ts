import AirdropClaim from './models/AirdropClaim';
import CombatRecord from './models/CombatRecord';
import WhitelistEntry from './models/WhitelistEntry';
import { getReferralStats } from './referralStats';
import { AIRDROP_TASKS, SOCIAL_LINKS, isSocialTaskEnabled, type AirdropCategory } from './airdropConfig';

/**
 * done       -- completed (verified, or claimed for social tasks)
 * available  -- can be done now
 * locked     -- needs an earlier step first (wallet, or a verified wallet)
 * soon       -- not switched on yet (social link not configured)
 */
export type AirdropTaskStatus = 'done' | 'available' | 'locked' | 'soon';

export interface AirdropTaskState {
    id: string;
    category: AirdropCategory;
    title: string;
    description: string;
    points: number;
    status: AirdropTaskStatus;
    progress?: { current: number; target: number };
}

export interface AirdropProgress {
    wallet: string | null;
    verified: boolean;
    passNumber: number | null;
    referralCode: string | null;
    referral: { count: number; points: number };
    combatPoints: number;
    taskPoints: number;
    /** taskPoints + referral.points + combatPoints */
    totalPoints: number;
    completed: number;
    tasks: AirdropTaskState[];
    socialLinks: { x: string | null; telegram: string | null };
}

/**
 * Everything is derived live from source data rather than stored, so the
 * page can never drift from the whitelist, referral and combat records it
 * summarises. Only self-reported social claims have their own collection.
 */
export async function getAirdropProgress(rawWallet: string | null): Promise<AirdropProgress> {
    const wallet = rawWallet ? rawWallet.toLowerCase() : null;

    const [entry, record, claims] = wallet
        ? await Promise.all([
              WhitelistEntry.findOne({ identifier: wallet }),
              CombatRecord.findOne({ wallet }),
              AirdropClaim.find({ wallet }).select('taskId'),
          ])
        : [null, null, []];

    const verified = Boolean(entry?.walletVerified);
    const referralCode = verified && entry?.referralCode ? entry.referralCode : null;
    const referral = referralCode ? await getReferralStats(referralCode) : { referredCount: 0, points: 0 };

    const combatPoints = record?.totalPoints ?? 0;
    const wins = record?.wins ?? 0;
    const duelsPlayed = wins + (record?.losses ?? 0);
    const claimed = new Set<string>(claims.map((c: { taskId: string }) => c.taskId));

    const tasks: AirdropTaskState[] = AIRDROP_TASKS.map((def) => {
        const base = {
            id: def.id,
            category: def.category,
            title: def.title,
            description: def.description,
            points: def.points,
        };

        if (def.category === 'social') {
            if (!isSocialTaskEnabled(def.id)) return { ...base, status: 'soon' };
            if (claimed.has(def.id)) return { ...base, status: 'done' };
            return { ...base, status: verified ? 'available' : 'locked' };
        }

        if (!wallet) return { ...base, status: def.id === 'connect-wallet' ? 'available' : 'locked' };

        switch (def.id) {
            case 'connect-wallet':
                return { ...base, status: 'done' };
            case 'verify-wallet':
                return { ...base, status: verified ? 'done' : 'available' };
            case 'first-duel':
                return { ...base, status: duelsPlayed >= 1 ? 'done' : 'available' };
            case 'first-win':
                return { ...base, status: wins >= 1 ? 'done' : 'available' };
            case 'five-duels': {
                const target = def.target ?? 5;
                return {
                    ...base,
                    status: duelsPlayed >= target ? 'done' : 'available',
                    progress: { current: Math.min(duelsPlayed, target), target },
                };
            }
            case 'reach-silver': {
                const target = def.target ?? 5000;
                return {
                    ...base,
                    status: combatPoints >= target ? 'done' : 'available',
                    progress: { current: Math.min(combatPoints, target), target },
                };
            }
            default:
                return { ...base, status: 'locked' };
        }
    });

    const taskPoints = tasks.filter((t) => t.status === 'done').reduce((sum, t) => sum + t.points, 0);

    return {
        wallet,
        verified,
        passNumber: entry?.passNumber ?? null,
        referralCode,
        referral: { count: referral.referredCount, points: referral.points },
        combatPoints,
        taskPoints,
        totalPoints: taskPoints + referral.points + combatPoints,
        completed: tasks.filter((t) => t.status === 'done').length,
        tasks,
        socialLinks: SOCIAL_LINKS,
    };
}
