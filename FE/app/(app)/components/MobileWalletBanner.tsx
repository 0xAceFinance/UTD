"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { useWallet } from "@/hooks/useWallet"

const DISMISS_KEY = "utd-dismissed-mobile-wallet-banner"

function isMobileUserAgent(): boolean {
    if (typeof navigator === "undefined") return false
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/**
 * WalletConnect's same-device "app switch" flow (tap Connect in a mobile
 * browser -> MetaMask opens -> nothing to approve) is a known WalletConnect
 * v2 + mobile-browser gap, not something fixable in this app's config: the
 * originating browser tab has to stay alive on the relay's websocket long
 * enough to hand the pairing off to the wallet app after the OS switches
 * apps, and Android suspends a backgrounded tab right as that handoff needs
 * to happen, cutting the handshake off mid-flight. Confirmed via a QR-code
 * pairing (a *separate* device completing the handshake) working fine on
 * the exact same phone/wallet where the direct in-browser link did not.
 *
 * The reliable path is the wallet's own in-app browser, where the site gets
 * window.ethereum injected directly -- the same connector desktop already
 * uses via the extension, just running inside the wallet app instead of
 * Chrome/Safari. This banner routes mobile visitors without an injected
 * wallet there proactively, instead of after they hit the broken flow.
 */
export function MobileWalletBanner() {
    const { connected } = useWallet()
    const [show, setShow] = useState(false)
    const [dismissed, setDismissed] = useState(false)

    useEffect(() => {
        const hasInjectedWallet = typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum)
        setShow(isMobileUserAgent() && !hasInjectedWallet)
        try {
            setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1")
        } catch {
            // private browsing / storage blocked -- just show the banner
        }
    }, [])

    if (connected || !show || dismissed) return null

    function openInMetaMask() {
        const target = `${window.location.host}${window.location.pathname}`
        window.location.href = `https://metamask.app.link/dapp/${target}`
    }

    function dismiss() {
        try {
            sessionStorage.setItem(DISMISS_KEY, "1")
        } catch {
            // ignore -- worst case the banner reappears next load
        }
        setDismissed(true)
    }

    return (
        <div
            role="status"
            className="flex items-center justify-between gap-3 border-b border-[var(--line-2)] bg-[var(--s1)] px-4 py-2.5 text-[12px] text-[var(--dim)] sm:px-6 lg:px-8"
        >
            <span>On mobile, wallet connect is most reliable inside your wallet app&apos;s own browser.</span>
            <div className="flex flex-none items-center gap-3">
                <button
                    onClick={openInMetaMask}
                    className="whitespace-nowrap border border-[var(--acid)] px-2.5 py-1 font-mono text-[11px] text-[var(--acid)] transition-colors hover:bg-[var(--acid)]/10"
                >
                    OPEN IN METAMASK
                </button>
                <button onClick={dismiss} aria-label="Dismiss" className="text-[var(--faint)] hover:text-white">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    )
}
