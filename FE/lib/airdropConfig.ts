/**
 * Genesis airdrop task catalogue -- the one place to tune rewards, same
 * pattern as referralPoints.ts's REFERRAL_POINTS_CONFIG.
 *
 * Point scale is deliberately on the same footing as the rest of the system
 * so one "airdrop points" total can add them up honestly: a $100 duel win is
 * ~150 combat points (points/src/pointsEngine.ts) and a first verified
 * referral is 100 (referralPoints.ts).
 *
 * Every task except `social` is verified server-side against real data
 * (wallet signature, whitelist entry, CombatRecord). Social tasks cannot be
 * checked without the X/Telegram APIs, so they are self-reported: small
 * rewards, and only claimable by a signature-verified wallet.
 */

export type AirdropCategory = "onboarding" | "social" | "arena"

export interface AirdropTaskDef {
    id: string
    category: AirdropCategory
    title: string
    description: string
    points: number
    /** For count-based tasks: how many are needed. */
    target?: number
}

/**
 * Official social links. Not hardcoded because the project has none yet --
 * set NEXT_PUBLIC_UTD_X_URL / NEXT_PUBLIC_UTD_TELEGRAM_URL and the matching
 * tasks switch on. Until then they render as "coming soon" and can't be
 * claimed.
 */
export const SOCIAL_LINKS = {
    x: process.env.NEXT_PUBLIC_UTD_X_URL || "https://x.com/UTD_RHC",
    telegram: process.env.NEXT_PUBLIC_UTD_TELEGRAM_URL || "https://t.me/utd_rh",
}

export const AIRDROP_TASKS: AirdropTaskDef[] = [
    {
        id: "connect-wallet",
        category: "onboarding",
        title: "Connect a wallet",
        description: "Plug in the wallet you'll duel with.",
        points: 50,
    },
    {
        id: "verify-wallet",
        category: "onboarding",
        title: "Verify & claim your day-one pass",
        description: "Sign one message to prove the wallet is yours. Free, no gas.",
        points: 250,
    },
    {
        id: "follow-x",
        category: "social",
        title: "Follow UTD on X",
        description: "Launch dates and new fighters land there first.",
        points: 75,
    },
    {
        id: "join-telegram",
        category: "social",
        title: "Join the Telegram",
        description: "Where duels get called out.",
        points: 75,
    },
    {
        id: "post-x",
        category: "social",
        title: "Post your invite link on X",
        description: "Share your referral link so friends land on your code.",
        points: 100,
    },
    {
        id: "first-duel",
        category: "arena",
        title: "Fight your first duel",
        description: "Create or join any duel and see it through to settlement.",
        points: 300,
    },
    {
        id: "first-win",
        category: "arena",
        title: "Win a duel",
        description: "Back the token that climbs harder.",
        points: 500,
    },
    {
        id: "five-duels",
        category: "arena",
        title: "Fight 5 duels",
        description: "Wins and losses both count.",
        points: 1000,
        target: 5,
    },
    {
        id: "reach-silver",
        category: "arena",
        title: "Reach Silver tier",
        description: "5,000 lifetime combat points.",
        points: 1500,
        target: 5000,
    },
]

export const SOCIAL_TASK_IDS = new Set(AIRDROP_TASKS.filter((t) => t.category === "social").map((t) => t.id))

/** Social tasks whose link is configured (post-x needs no official handle). */
export function isSocialTaskEnabled(id: string): boolean {
    if (id === "follow-x") return Boolean(SOCIAL_LINKS.x)
    if (id === "join-telegram") return Boolean(SOCIAL_LINKS.telegram)
    return SOCIAL_TASK_IDS.has(id)
}
