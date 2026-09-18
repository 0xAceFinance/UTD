"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Plus } from "lucide-react"
import { NAV, isActive } from "./nav"

/**
 * Phone / tablet navigation (below lg). Thumb-reachable, 64px-tall targets,
 * padded for the home indicator via safe-area-inset-bottom. "New duel" sits in
 * the middle as the one raised action.
 */
export default function BottomNav() {
    const pathname = usePathname()
    const [first, second, ...rest] = NAV
    const creating = pathname.startsWith("/duels/create")

    const tab = (item: (typeof NAV)[number]) => {
        const active = isActive(item, pathname)
        const Icon = item.icon
        return (
            <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`app-tab ${active ? "is-active" : ""}`}
            >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
            </Link>
        )
    }

    return (
        <nav
            aria-label="Main"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--s1)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
            <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-stretch">
                {tab(first)}
                {tab(second)}

                <Link
                    href="/duels/create"
                    aria-current={creating ? "page" : undefined}
                    aria-label="New duel"
                    className="flex items-center justify-center"
                >
                    <span className={`app-fab ${creating ? "is-active" : ""}`}>
                        <Plus className="h-5 w-5" strokeWidth={2.5} />
                    </span>
                </Link>

                {rest.map(tab)}
            </div>
        </nav>
    )
}
