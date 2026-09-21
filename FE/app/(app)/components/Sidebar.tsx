"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Gift, Plus, Share2 } from "lucide-react"
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

                {/* Not in NAV: BottomNav's mobile grid is a fixed 5 columns built
                    from NAV's length, so this lives here plus Header's mobile
                    chip instead of growing that grid. */}
                <Link
                    href="/referrals"
                    aria-current={pathname.startsWith("/referrals") ? "page" : undefined}
                    className={`app-nav-item ${pathname.startsWith("/referrals") ? "is-active" : ""}`}
                >
                    <Share2 className="h-4 w-4 flex-none" />
                    Referrals
                </Link>
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

            <div className="border-t border-[var(--line)] px-5 py-3.5">
                <div className="flex items-center gap-3">
                    <a
                        href="https://x.com/UTD_RHC"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--dim)] transition-colors hover:text-[var(--acid)]"
                        title="Follow on X (@UTD_RHC)"
                    >
                        <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                        </svg>
                        <span>X</span>
                    </a>
                    <span className="text-[var(--line-2)]">·</span>
                    <a
                        href="https://t.me/utd_rh"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--dim)] transition-colors hover:text-[var(--acid)]"
                        title="Join Telegram (@utd_rh)"
                    >
                        <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                        </svg>
                        <span>Telegram</span>
                    </a>
                </div>
            </div>
        </aside>
    )
}
