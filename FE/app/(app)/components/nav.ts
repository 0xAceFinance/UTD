import { BookOpen, Swords, Trophy, User, type LucideIcon } from "lucide-react"

export interface NavItem {
    href: string
    label: string
    icon: LucideIcon
    /** Custom active test; defaults to a prefix match on href. */
    match?: (pathname: string) => boolean
}

/** One nav definition shared by the desktop sidebar and the mobile tab bar. */
export const NAV: NavItem[] = [
    {
        href: "/duels",
        label: "Duels",
        icon: Swords,
        match: (p) => p === "/" || (p.startsWith("/duels") && !p.startsWith("/duels/create")),
    },
    { href: "/tokens", label: "Fighters", icon: Trophy },
    { href: "/profile", label: "Record", icon: User },
    { href: "/landing#rules", label: "Rules", icon: BookOpen, match: () => false },
]

export function isActive(item: NavItem, pathname: string) {
    return item.match ? item.match(pathname) : pathname.startsWith(item.href)
}

/** Title shown in the top bar for the current route. */
export function routeTitle(pathname: string): string {
    if (pathname.startsWith("/duels/create")) return "New duel"
    if (/^\/duels\/[^/]+/.test(pathname)) return "Duel"
    if (pathname.startsWith("/tokens")) return "Fighters"
    if (pathname.startsWith("/profile")) return "Record"
    if (pathname.startsWith("/airdrop")) return "Airdrop"
    if (pathname.startsWith("/referrals")) return "Referrals"
    return "Duels"
}
