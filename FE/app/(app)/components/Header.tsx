"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ConnectKitButton } from "connectkit"
import { routeTitle } from "./nav"

function WalletButton() {
    return (
        <ConnectKitButton.Custom>
            {({ isConnected, isConnecting, show, address, ensName }) =>
                isConnected ? (
                    <button
                        onClick={show}
                        className="flex h-9 items-center gap-2 border border-[var(--line-2)] bg-[var(--s1)] px-3 font-mono text-[12px] text-[var(--txt)] transition-colors hover:border-[var(--acid)]"
                    >
                        <span className="h-1.5 w-1.5 flex-none bg-[var(--acid)]" />
                        {ensName ?? `${address?.slice(0, 6)}…${address?.slice(-4)}`}
                    </button>
                ) : (
                    <button
                        onClick={show}
                        disabled={isConnecting}
                        className="utd-btn h-9 px-3.5 text-[8px] sm:text-[9px]"
                    >
                        {isConnecting ? "CONNECTING…" : "CONNECT"}
                    </button>
                )
            }
        </ConnectKitButton.Custom>
    )
}

/**
 * Top bar. On phones it carries the brand (the sidebar is hidden there); on
 * desktop the sidebar has the brand, so this shows the current screen's title.
 */
export default function Header() {
    const pathname = usePathname()

    return (
        <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--s0)]/95 pt-[env(safe-area-inset-top)] backdrop-blur">
            <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
                <div className="flex min-w-0 items-center gap-3">
                    <Link href="/duels" className="flex-none lg:hidden" aria-label="UTD home">
                        <img src="/logo-mark.png" alt="" className="utd-mark h-8 w-8" />
                    </Link>
                    <h1 className="utd-pixel truncate text-[11px] text-white sm:text-[12px]">
                        {routeTitle(pathname).toUpperCase()}
                    </h1>
                </div>

                <WalletButton />
            </div>
        </header>
    )
}
