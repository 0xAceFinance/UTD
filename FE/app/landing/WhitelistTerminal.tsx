"use client"

import { useState, useEffect, useCallback } from "react"
import { useAccount, useSignMessage } from "wagmi"
import { ConnectKitButton } from "connectkit"
import { sound } from "./SoundEngine"
import { SectionHeading } from "./SectionHeading"
import { Check, Copy } from "lucide-react"

interface ReferralDashboard {
    passNumber: number
    referralCode: string
    referredCount: number
    points: number
}

import { getStoredRef } from "@/lib/referralClient"

export function WhitelistTerminal() {
    const { address, isConnected } = useAccount()
    const { signMessageAsync } = useSignMessage()

    const [refCode, setRefCode] = useState<string | undefined>(undefined)
    useEffect(() => {
        setRefCode(getStoredRef())
    }, [])

    const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null)
    const [checkingWallet, setCheckingWallet] = useState(false)
    const [signingUp, setSigningUp] = useState(false)
    const [walletError, setWalletError] = useState<string | null>(null)

    // Email fallback -- secondary path for anyone without a wallet handy.
    // No verification, so no referral perks (see app/api/whitelist/route.ts).
    const [showEmailFallback, setShowEmailFallback] = useState(false)
    const [emailInput, setEmailInput] = useState("")
    const [emailReserved, setEmailReserved] = useState<{ passNumber: number; alreadyRegistered: boolean } | null>(null)
    const [emailSubmitting, setEmailSubmitting] = useState(false)
    const [emailError, setEmailError] = useState<string | null>(null)

    const [counts, setCounts] = useState<{ claimed: number; total: number } | null>(null)

    // Real count from the database. Until it arrives the aside stays empty
    // rather than showing a placeholder number. Retried, because a single
    // swallowed failure here (a cold serverless start, a slow first
    // connection) would otherwise hide the count for the rest of the visit.
    useEffect(() => {
        let cancelled = false

        const load = async (attempt = 0): Promise<void> => {
            try {
                const res = await fetch("/api/whitelist")
                const body = await res.json()
                if (cancelled) return
                if (body?.success) {
                    setCounts(body.data)
                    return
                }
                throw new Error("unsuccessful")
            } catch {
                if (cancelled || attempt >= 2) return
                await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
                if (!cancelled) return load(attempt + 1)
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [])

    // A connected wallet might already be a verified entry from a previous
    // visit -- check before showing a "sign to join" prompt, so returning
    // visitors land straight on their referral dashboard.
    useEffect(() => {
        if (!isConnected || !address) {
            setDashboard(null)
            return
        }
        let cancelled = false
        setCheckingWallet(true)
        setWalletError(null)
        ;(async () => {
            try {
                const res = await fetch(`/api/whitelist/me?wallet=${address}`)
                const body = await res.json()
                if (cancelled) return
                setDashboard(body?.success ? body.data : null)
            } catch {
                if (!cancelled) setDashboard(null)
            } finally {
                if (!cancelled) setCheckingWallet(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [isConnected, address])

    const handleSignAndJoin = useCallback(async () => {
        if (!address) return
        setSigningUp(true)
        setWalletError(null)
        sound.playBlip(700)
        try {
            const nonceRes = await fetch(`/api/whitelist/nonce?wallet=${address}`)
            const nonceBody = await nonceRes.json()
            if (!nonceRes.ok || !nonceBody?.success) {
                throw new Error(typeof nonceBody?.error === "string" ? nonceBody.error : "Could not start verification.")
            }

            const signature = await signMessageAsync({ message: nonceBody.data.message })

            const res = await fetch("/api/whitelist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: address, signature, nonce: nonceBody.data.nonce, ref: refCode }),
            })
            const body = await res.json()
            if (!res.ok || !body?.success) {
                throw new Error(typeof body?.error === "string" ? body.error : "Could not reach the server. Try again in a moment.")
            }

            setDashboard({
                passNumber: body.data.passNumber,
                referralCode: body.data.referralCode,
                referredCount: body.data.referredCount ?? 0,
                points: body.data.points ?? 0,
            })
            setCounts({ claimed: body.data.claimed, total: body.data.total })
            sound.playWin()
        } catch (err) {
            // A rejected signature lands here too -- same message either
            // way, since the real reason isn't actionable beyond "try again."
            setWalletError(err instanceof Error ? err.message : "Could not verify your wallet. Try again.")
            sound.playBlip(220)
        } finally {
            setSigningUp(false)
        }
    }, [address, refCode, signMessageAsync])

    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!emailInput.trim() || emailSubmitting || emailReserved) return

        sound.playBlip(700)
        setEmailSubmitting(true)
        setEmailError(null)

        try {
            const res = await fetch("/api/whitelist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: emailInput.trim(), ref: refCode }),
            })
            const body = await res.json()

            if (!res.ok || !body?.success) {
                setEmailError(
                    typeof body?.error === "string" ? body.error : "Could not reach the server. Try again in a moment.",
                )
                sound.playBlip(220)
                return
            }

            setEmailReserved({ passNumber: body.data.passNumber, alreadyRegistered: body.data.alreadyRegistered })
            setCounts({ claimed: body.data.claimed, total: body.data.total })
            sound.playWin()
        } catch {
            setEmailError("Could not reach the server. Try again in a moment.")
            sound.playBlip(220)
        } finally {
            setEmailSubmitting(false)
        }
    }

    const aside = counts
        ? `${(counts.total - counts.claimed).toLocaleString()} of ${counts.total.toLocaleString()} day-one passes left.`
        : undefined

    const referralLink =
        dashboard && typeof window !== "undefined" ? `${window.location.origin}/landing?ref=${dashboard.referralCode}` : undefined

    return (
        <div>
            <SectionHeading title="GET IN" aside={aside} />

            <div className="utd-panel utd-ticks mt-7 p-6 sm:p-8">
                {refCode && !dashboard && (
                    <p className="utd-body mb-5 text-[13px] text-[var(--acid)]">
                        Invited by a friend — connect your wallet to claim your spot and start your own referral chain.
                    </p>
                )}

                {dashboard ? (
                    <ReferralDashboardView dashboard={dashboard} referralLink={referralLink} />
                ) : isConnected ? (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <Check className="h-5 w-5 flex-none text-[var(--acid)]" />
                            <p className="utd-body text-[13px] text-[var(--dim)]">
                                Wallet connected. Sign a free message to prove it's yours and reserve your pass.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleSignAndJoin}
                            disabled={signingUp || checkingWallet}
                            className="utd-btn self-start px-6 py-3.5 text-[10px]"
                        >
                            {checkingWallet ? "CHECKING…" : signingUp ? "AWAITING SIGNATURE…" : "SIGN & RESERVE A PASS"}
                        </button>
                        {walletError && <p className="utd-body text-[13px] text-[var(--hot)]">{walletError}</p>}
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <ConnectKitButton.Custom>
                            {({ show }) => (
                                <button type="button" onClick={show} className="utd-btn self-start px-6 py-3.5 text-[10px]">
                                    CONNECT WALLET
                                </button>
                            )}
                        </ConnectKitButton.Custom>

                        <p className="utd-body text-[13px] text-[var(--faint)]">
                            Connecting lets you earn referral points toward the genesis distribution. No wallet handy?{" "}
                            <button
                                type="button"
                                onClick={() => setShowEmailFallback((v) => !v)}
                                className="text-[var(--acid)] underline underline-offset-2"
                            >
                                use your email instead
                            </button>
                            .
                        </p>

                        {showEmailFallback &&
                            (emailReserved ? (
                                <div className="flex items-center gap-3">
                                    <Check className="h-5 w-5 flex-none text-[var(--acid)]" />
                                    <div>
                                        <div className="utd-pixel text-lg text-white">
                                            Pass #{String(emailReserved.passNumber).padStart(4, "0")}
                                        </div>
                                        <p className="utd-body mt-1.5 text-[13px] text-[var(--dim)]">
                                            {emailReserved.alreadyRegistered
                                                ? "You were already on the list. Same pass, same spot."
                                                : "You're on the list. Connect a wallet later to unlock referral points."}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3 sm:flex-row">
                                        <label className="sr-only" htmlFor="utd-whitelist-email">
                                            Email address
                                        </label>
                                        <input
                                            id="utd-whitelist-email"
                                            type="text"
                                            placeholder="Email address"
                                            value={emailInput}
                                            onChange={(e) => {
                                                setEmailInput(e.target.value)
                                                if (emailError) setEmailError(null)
                                            }}
                                            aria-invalid={Boolean(emailError)}
                                            className="utd-body flex-1 border border-[var(--line-2)] bg-[var(--s0)] px-4 py-3.5 text-[14px] text-white placeholder:text-[var(--faint)] focus:border-[var(--acid)] focus:outline-none"
                                        />
                                        <button
                                            type="submit"
                                            disabled={emailSubmitting || !emailInput.trim()}
                                            className="utd-btn px-6 py-3.5 text-[10px]"
                                        >
                                            {emailSubmitting ? "SAVING…" : "RESERVE A PASS"}
                                        </button>
                                    </form>
                                    {emailError && <p className="utd-body text-[13px] text-[var(--hot)]">{emailError}</p>}
                                </>
                            ))}
                    </div>
                )}
            </div>
        </div>
    )
}

function ReferralDashboardView({ dashboard, referralLink }: { dashboard: ReferralDashboard; referralLink?: string }) {
    const [copied, setCopied] = useState(false)

    const copyLink = async () => {
        if (!referralLink) return
        try {
            await navigator.clipboard.writeText(referralLink)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard API can be unavailable (permissions, insecure context)
            // -- the link is still shown as selectable, read-only text below.
        }
    }

    const shareText = encodeURIComponent(
        "I just locked in my UTD day-one pass. Pick a side, lock a stake, whoever pumps harder wins.",
    )
    const shareUrl = referralLink ? encodeURIComponent(referralLink) : ""

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
                <Check className="h-5 w-5 flex-none text-[var(--acid)]" />
                <div>
                    <div className="utd-pixel text-lg text-white">Pass #{String(dashboard.passNumber).padStart(4, "0")}</div>
                    <p className="utd-body mt-1.5 text-[13px] text-[var(--dim)]">
                        You're verified. Share your link below to earn genesis points.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-px bg-[var(--line)]">
                <div className="bg-[var(--s1)] px-4 py-4">
                    <div className="utd-pixel text-base text-[var(--acid)]">{dashboard.referredCount}</div>
                    <div className="utd-body mt-1.5 text-[12px] text-[var(--dim)]">referred (verified)</div>
                </div>
                <div className="bg-[var(--s1)] px-4 py-4">
                    <div className="utd-pixel text-base text-[var(--acid)]">{dashboard.points}</div>
                    <div className="utd-body mt-1.5 text-[12px] text-[var(--dim)]">genesis points</div>
                </div>
            </div>

            {referralLink && (
                <div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <input
                            readOnly
                            value={referralLink}
                            onFocus={(e) => e.currentTarget.select()}
                            className="utd-body flex-1 border border-[var(--line-2)] bg-[var(--s0)] px-4 py-3.5 text-[13px] text-white focus:border-[var(--acid)] focus:outline-none"
                        />
                        <button
                            type="button"
                            onClick={copyLink}
                            className="utd-btn flex items-center justify-center gap-2 px-6 py-3.5 text-[10px]"
                        >
                            <Copy className="h-3.5 w-3.5" />
                            {copied ? "COPIED" : "COPY LINK"}
                        </button>
                    </div>
                    <a
                        href={`https://x.com/intent/tweet?text=${shareText}&url=${shareUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="utd-body mt-3 inline-block text-[13px] text-[var(--acid)] underline underline-offset-2"
                    >
                        Share on X →
                    </a>
                </div>
            )}
        </div>
    )
}
