"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ConnectKitButton } from "connectkit"
import { Gift, Share2 } from "lucide-react"
import { useWallet } from "@/hooks/useWallet"
import { useAirdrop } from "./airdrop/useAirdrop"
import { routeTitle } from "./nav"
import { SoundToggle } from "./SoundToggle"

function WalletButton() {
    return (
        <ConnectKitButton.Custom>
            {({ isConnected, isConnecting, show, address, ensName, unsupported }) => {
                // unsupported = wallet is connected but on a chain outside
                // config/wagmiConfig.ts's `chains` list (i.e. not Robinhood
                // Chain, foundry, or the other configured chains). show()
                // opens ConnectKit's own network-switch screen, which calls
                // wagmi's switchChain -- for an injected wallet that hasn't
                // added Robinhood Chain yet, that falls back to
                // wallet_addEthereumChain automatically using the metadata
                // on config/chains.ts's robinhoodChain.
                if (isConnected && unsupported) {
                    return (
                        <button
                            onClick={show}
                            className="flex h-9 items-center gap-2 border border-[var(--warn,#e8b71a)] bg-[var(--s1)] px-3 font-mono text-[12px] text-[var(--warn,#e8b71a)] transition-colors hover:border-[var(--warn,#e8b71a)]"
                        >
                            <span className="h-1.5 w-1.5 flex-none bg-[var(--warn,#e8b71a)]" />
                            WRONG NETWORK
                        </button>
                    )
                }
                return isConnected ? (
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
            }}
        </ConnectKitButton.Custom>
    )
}

/**
 * Top bar. On phones it carries the brand (the sidebar is hidden there); on
 * desktop the sidebar has the brand, so this shows the current screen's title.
 */
/**
 * Phones only: the bottom tab bar is full, so the airdrop lives up here as a
 * glowing chip with a dot while there are tasks left to do.
 */
function AirdropButton({ active }: { active: boolean }) {
    const { address } = useWallet()
    const { available } = useAirdrop(address)
    return (
        <Link
            href="/airdrop"
            aria-label={available > 0 ? `Airdrop, ${available} tasks ready` : "Airdrop"}
            aria-current={active ? "page" : undefined}
            className={`app-airdrop-btn flex lg:hidden ${active ? "is-active" : ""}`}
        >
            <Gift className="h-4 w-4" />
            <span className="utd-pixel hidden text-[8px] sm:inline">AIRDROP</span>
            {available > 0 && !active && <span className="app-airdrop-dot" />}
        </Link>
    )
}

/** Phones only: same reasoning as AirdropButton -- Referrals isn't in NAV,
 * since BottomNav's grid is fixed to NAV's length, so it needs its own way
 * in on small screens. */
function ReferralButton({ active }: { active: boolean }) {
    return (
        <Link
            href="/referrals"
            aria-label="Referrals"
            aria-current={active ? "page" : undefined}
            className={`flex h-9 items-center gap-1.5 border px-2.5 font-mono text-[11px] transition-colors lg:hidden ${
                active
                    ? "border-[var(--acid)] text-[var(--acid)]"
                    : "border-[var(--line-2)] bg-[var(--s1)] text-[var(--dim)] hover:border-[var(--acid)]"
            }`}
        >
            <Share2 className="h-3.5 w-3.5" />
        </Link>
    )
}

export default function Header() {
    const pathname = usePathname()

    // will-change-transform forces this onto its own compositor layer -- without
    // it, some browsers (notably Chromium on Android) fail to recompose this
    // sticky header's backdrop-blur during scroll, leaving a stale blurred
    // "ghost" smeared over content that has already scrolled past. Worse with
    // continuous nearby CSS animation (the LIVE dot pulse, the battle-bar
    // transitions).
    return (
        <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--s0)]/95 pt-[env(safe-area-inset-top)] backdrop-blur will-change-transform">
            <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:h-16 lg:px-8">
                <div className="flex min-w-0 items-center gap-3">
                    <Link href="/duels" className="flex-none lg:hidden" aria-label="UTD home">
                        <img src="/logo-mark.png" alt="" className="utd-mark h-8 w-8" />
                    </Link>
                    <h1 className="utd-pixel truncate text-[11px] text-white sm:text-[12px]">
                        {routeTitle(pathname).toUpperCase()}
                    </h1>
                </div>

                <div className="flex flex-none items-center gap-2">
                    <SoundToggle />
                    <AirdropButton active={pathname.startsWith("/airdrop")} />
                    <ReferralButton active={pathname.startsWith("/referrals")} />
                    <WalletButton />
                </div>
            </div>
        </header>
    )
}
