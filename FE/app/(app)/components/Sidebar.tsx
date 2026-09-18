"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Gift, Plus } from "lucide-react"
import { useWallet } from "@/hooks/useWallet"
import { useAirdrop } from "./airdrop/useAirdrop"
import { NAV, isActive } from "./nav"

/**
 * Desktop navigation (lg and up). Below lg the same NAV renders as the bottom
 * tab bar in BottomNav, so there is always exactly one way to navigate.
 */
export default function Sidebar() {
    const pathname = usePathname()
    const creating = pathname.startsWith("/duels/create")
    const { address, connected } = useWallet()
    const { data, available } = useAirdrop(address)
    const onAirdrop = pathname.startsWith("/airdrop")

    return (
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-[var(--line)] bg-[var(--s1)] lg:flex">
            <Link href="/duels" className="flex h-16 items-center gap-3 border-b border-[var(--line)] px-5">
                <img src="/logo-mark.png" alt="" className="utd-mark h-8 w-8" />
                <span className="utd-pixel text-[12px] text-white">UTD</span>
            </Link>

            <div className="p-4">
                <Link
                    href="/duels/create"
                    className={`utd-btn w-full gap-2 py-3 text-[9px] ${creating ? "pointer-events-none opacity-60" : ""}`}
                    aria-current={creating ? "page" : undefined}
                >
                    <Plus className="h-3.5 w-3.5" />
                    NEW DUEL
                </Link>
            </div>

            <nav className="space-y-0.5 px-3" aria-label="Main">
                {NAV.map((item) => {
                    const active = isActive(item, pathname)
                    const Icon = item.icon
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={`app-nav-item ${active ? "is-active" : ""}`}
                        >
                            <Icon className="h-4 w-4 flex-none" />
                            {item.label}
                        </Link>
                    )
                })}
            </nav>

            {/* Airdrop: deliberately not a plain nav row. */}
            <div className="px-4 pt-5">
                <Link
                    href="/airdrop"
                    aria-current={onAirdrop ? "page" : undefined}
                    className={`app-airdrop-card ${onAirdrop ? "is-active" : ""}`}
                >
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                            <Gift className="h-4 w-4 text-[var(--acid)]" />
                            <span className="utd-pixel text-[10px] text-white">AIRDROP</span>
                        </span>
                        {available > 0 && (
                            <span className="utd-pixel bg-[#fbbf24] px-1.5 py-0.5 text-[7px] text-[#1a1203]">
                                {available} NEW
                            </span>
                        )}
                    </div>
                    <div className="mt-2 text-[12px] text-[var(--dim)]">
                        {connected && data ? (
                            <>
                                <span className="font-mono text-[var(--acid)]">{data.totalPoints.toLocaleString()}</span> pts ·{" "}
                                {data.completed}/{data.tasks.length} tasks
                            </>
                        ) : (
                            "Earn genesis points before launch"
                        )}
                    </div>
                </Link>
            </div>

            <div className="flex-1" />

            <div className="border-t border-[var(--line)] px-5 py-4 font-mono text-[11px] text-[var(--faint)]">
                Pre-launch build
            </div>
        </aside>
    )
}
