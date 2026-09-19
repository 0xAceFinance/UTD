"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useSignMessage } from "wagmi"
import { useModal } from "connectkit"
import { toast } from "sonner"
import {
    BadgeCheck,
    Check,
    Copy,
    Crown,
    ExternalLink,
    Flame,
    Lock,
    Megaphone,
    Send,
    Swords,
    Trophy,
    Wallet,
    type LucideIcon,
} from "lucide-react"
import { useWallet } from "@/hooks/useWallet"
import { pointsForReferralIndex } from "@/lib/referralPoints"
import type { AirdropTaskState } from "@/lib/airdrop"
import { notifyAirdropChanged, useAirdrop } from "../components/airdrop/useAirdrop"
import { getStoredRef } from "@/lib/referralClient"

const TASK_ICON: Record<string, LucideIcon> = {
    "connect-wallet": Wallet,
    "verify-wallet": BadgeCheck,
    "follow-x": XLogoIcon as unknown as LucideIcon,
    "join-telegram": Send,
    "post-x": Megaphone,
    "first-duel": Swords,
    "first-win": Trophy,
    "five-duels": Flame,
    "reach-silver": Crown,
}

const SECTIONS: { id: AirdropTaskState["category"]; title: string }[] = [
    { id: "onboarding", title: "Get started" },
    { id: "social", title: "Spread the word" },
    { id: "arena", title: "In the arena" },
]

export default function AirdropPage() {
    const { address, connected } = useWallet()
    const { data, setData, loading, refresh } = useAirdrop(address)
    const { setOpen: openConnect } = useModal()
    const { signMessageAsync } = useSignMessage()

    const [busyTask, setBusyTask] = useState<string | null>(null)
    const [opened, setOpened] = useState<Set<string>>(new Set())
    const [burst, setBurst] = useState<{ id: string; points: number } | null>(null)

    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const referralLink = data?.referralCode ? `${origin}/airdrop?ref=${data.referralCode}` : null

    const celebrate = (id: string, points: number) => {
        notifyAirdropChanged()
        setBurst({ id, points })
        setTimeout(() => setBurst(null), 1400)
    }

    async function verifyWallet() {
        if (!address) return openConnect(true)
        setBusyTask("verify-wallet")
        try {
            const nonceRes = await fetch(`/api/whitelist/nonce?wallet=${address}`)
            const nonceBody = await nonceRes.json()
            if (!nonceBody?.success) throw new Error(nonceBody?.error ?? "Could not start verification.")

            const signature = await signMessageAsync({ message: nonceBody.data.message })
            const res = await fetch("/api/whitelist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: address, signature, nonce: nonceBody.data.nonce, ref: getStoredRef() }),
            })
            const body = await res.json()
            if (!body?.success) throw new Error(typeof body?.error === "string" ? body.error : "Verification failed.")

            await refresh()
            celebrate("verify-wallet", 250)
            toast.success(`Verified. Day-one pass #${String(body.data.passNumber).padStart(4, "0")} is yours.`)
        } catch (err) {
            const msg = (err as Error).message ?? ""
            toast.error(/rejected|denied/i.test(msg) ? "Signature cancelled." : msg || "Verification failed.")
        } finally {
            setBusyTask(null)
        }
    }

    async function claim(task: AirdropTaskState) {
        if (!address) return
        setBusyTask(task.id)
        try {
            const res = await fetch("/api/airdrop/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet: address, taskId: task.id }),
            })
            const body = await res.json()
            if (!body?.success) throw new Error(body?.error ?? "Could not claim that task.")
            setData(body.data)
            celebrate(task.id, task.points)
        } catch (err) {
            toast.error((err as Error).message)
        } finally {
            setBusyTask(null)
        }
    }

    function socialHref(task: AirdropTaskState): string | null {
        if (task.id === "follow-x") return data?.socialLinks.x ?? null
        if (task.id === "join-telegram") return data?.socialLinks.telegram ?? null
        if (task.id === "post-x") {
            const text = encodeURIComponent("I'm lining up for the UTD genesis airdrop. Two tokens, one timer, whoever pumps harder wins.")
            return `https://x.com/intent/tweet?text=${text}${referralLink ? `&url=${encodeURIComponent(referralLink)}` : ""}`
        }
        return null
    }

    function action(task: AirdropTaskState): ReactNode {
        const busy = busyTask === task.id

        // Non-actionable states render as a tag in the card's title row instead.
        if (task.status !== "available") return null

        switch (task.id) {
            case "connect-wallet":
                return (
                    <button onClick={() => openConnect(true)} className="utd-btn h-10 px-4 text-[9px]">
                        CONNECT
                    </button>
                )
            case "verify-wallet":
                return (
                    <button onClick={verifyWallet} disabled={busy} className="utd-btn h-10 px-4 text-[9px]">
                        {busy ? "SIGNING…" : "VERIFY"}
                    </button>
                )
            case "follow-x":
            case "join-telegram":
            case "post-x": {
                const href = socialHref(task)
                if (opened.has(task.id)) {
                    return (
                        <button onClick={() => claim(task)} disabled={busy} className="utd-btn h-10 px-4 text-[9px]">
                            {busy ? "…" : "CLAIM"}
                        </button>
                    )
                }
                return (
                    <a
                        href={href ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpened((s) => new Set(s).add(task.id))}
                        className="app-chip h-10 justify-center gap-1.5"
                    >
                        {task.id === "post-x" ? "Post" : "Open"}
                        <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                )
            }
            default:
                return (
                    <Link href="/duels" className="app-chip h-10 justify-center">
                        Find a duel
                    </Link>
                )
        }
    }

    const total = data?.tasks.length ?? 9
    const completed = data?.completed ?? 0

    return (
        <div className="space-y-6 lg:space-y-8">
            {/* Hero */}
            <section className="airdrop-hero relative overflow-hidden border border-[var(--line-2)]">
                <div className="relative grid items-center gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="order-2 md:order-1">
                        <div className="utd-label text-[var(--acid)]">Genesis airdrop</div>

                        <div className="mt-4 flex items-end gap-3">
                            <CountUp
                                value={data?.totalPoints ?? 0}
                                className="utd-pixel text-[34px] leading-none text-white sm:text-[46px]"
                            />
                            <span className="utd-pixel mb-1 text-[10px] text-[var(--acid)] sm:text-[11px]">PTS</span>
                        </div>
                        <p className="mt-3 max-w-md text-[14px] text-[var(--dim)]">
                            {connected
                                ? "Your airdrop points, counted from verified tasks, referrals and duels. They decide your share of the genesis distribution."
                                : "Points from verified tasks, referrals and duels decide your share of the genesis distribution. Connect a wallet to start counting."}
                        </p>

                        <dl className="mt-5 grid max-w-md grid-cols-3 gap-px border border-[var(--line)] bg-[var(--line)]">
                            <Breakdown label="Tasks" value={data?.taskPoints ?? 0} />
                            <Breakdown label="Referrals" value={data?.referral.points ?? 0} />
                            <Breakdown label="Duels" value={data?.combatPoints ?? 0} />
                        </dl>

                        {!connected && (
                            <button onClick={() => openConnect(true)} className="utd-btn mt-5 h-11 px-5 text-[10px]">
                                CONNECT WALLET
                            </button>
                        )}
                    </div>

                    <div className="order-1 flex justify-center md:order-2">
                        <CoinOrbit />
                    </div>
                </div>

                {/* Progress, as a segmented arcade bar */}
                <div className="relative border-t border-[var(--line)] bg-[var(--s0)]/60 px-5 py-4 sm:px-8">
                    <div className="mb-2 flex items-center justify-between text-[12px] font-semibold">
                        <span className="uppercase tracking-[0.12em] text-[var(--dim)]">Progress</span>
                        <span className="font-mono text-[var(--txt)]">
                            {completed}/{total} tasks
                        </span>
                    </div>
                    <div className="flex gap-1" aria-hidden>
                        {Array.from({ length: total }).map((_, i) => (
                            <span
                                key={i}
                                className={`h-2.5 flex-1 transition-colors duration-500 ${
                                    i < completed ? "bg-[var(--acid)] shadow-[0_0_8px_rgba(43,232,132,0.55)]" : "bg-[var(--s2)]"
                                }`}
                                style={{ transitionDelay: `${i * 60}ms` }}
                            />
                        ))}
                    </div>
                </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-8">
                {/* Tasks */}
                <div className="min-w-0 space-y-6">
                    {SECTIONS.map((section) => {
                        const tasks = data?.tasks.filter((t) => t.category === section.id) ?? []
                        return (
                            <section key={section.id}>
                                <h2 className="app-section-label mb-2.5">{section.title}</h2>
                                {loading && !data ? (
                                    <div className="space-y-2">
                                        {Array.from({ length: section.id === "onboarding" ? 2 : 3 }).map((_, i) => (
                                            <div key={i} className="app-card h-[76px] animate-pulse" />
                                        ))}
                                    </div>
                                ) : (
                                    <ul className="space-y-2">
                                        {tasks.map((task) => (
                                            <TaskCard
                                                key={task.id}
                                                task={task}
                                                icon={TASK_ICON[task.id] ?? Check}
                                                action={action(task)}
                                                lockReason={!connected ? "Connect first" : "Verify first"}
                                                burst={burst?.id === task.id ? burst.points : null}
                                            />
                                        ))}
                                    </ul>
                                )}
                            </section>
                        )
                    })}

                    <p className="text-[12px] text-[var(--faint)]">
                        Wallet, referral and duel tasks are checked against live data. Social tasks can&apos;t be
                        verified yet, so they&apos;re self-reported and capped at one claim per verified wallet.
                    </p>
                </div>

                {/* Referrals */}
                <aside className="lg:sticky lg:top-24">
                    <h2 className="app-section-label mb-2.5">Invite friends</h2>
                    <div className="app-card p-5">
                        <div className="grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)]">
                            <Breakdown label="Invited" value={data?.referral.count ?? 0} />
                            <Breakdown label="Earned" value={data?.referral.points ?? 0} accent />
                        </div>

                        {data?.verified && referralLink ? (
                            <>
                                <p className="mt-4 text-[13px] text-[var(--dim)]">
                                    Your next verified invite is worth{" "}
                                    <span className="font-semibold text-[var(--acid)]">
                                        {pointsForReferralIndex((data.referral.count ?? 0) + 1)} pts
                                    </span>
                                    . Each one after is worth a little less.
                                </p>
                                <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-[var(--dim)]">
                                    <span>CODE: <strong className="text-[var(--acid)] font-bold tracking-wider">{data.referralCode}</strong></span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (data.referralCode) {
                                                navigator.clipboard.writeText(data.referralCode)
                                                toast.success("Referral code copied!")
                                            }
                                        }}
                                        className="text-[var(--acid)] hover:underline"
                                    >
                                        Copy Code
                                    </button>
                                </div>
                                <div className="mt-2 flex gap-2">
                                    <input
                                        readOnly
                                        value={referralLink}
                                        aria-label="Your referral link"
                                        onFocus={(e) => e.currentTarget.select()}
                                        className="min-w-0 flex-1 border border-[var(--line-2)] bg-[var(--s0)] px-3 font-mono text-[12px] text-[var(--txt)] focus:border-[var(--acid)] focus:outline-none"
                                    />
                                    <CopyButton text={referralLink} />
                                </div>
                                <p className="mt-3 text-[12px] text-[var(--faint)]">
                                    Invites count once your friend verifies their wallet.
                                </p>
                            </>
                        ) : (
                            <div className="mt-4 flex items-start gap-2.5 text-[13px] text-[var(--dim)]">
                                <Lock className="mt-0.5 h-4 w-4 flex-none text-[var(--faint)]" />
                                <span>
                                    {connected
                                        ? "Verify your wallet to get your invite link. First invite: 100 pts."
                                        : "Connect and verify a wallet to get your invite link. First invite: 100 pts."}
                                </span>
                            </div>
                        )}
                    </div>
                </aside>
            </div>
        </div>
    )
}

/* ---------------------------------------------------------------------- */

function TaskCard({
    task,
    icon: Icon,
    action,
    lockReason,
    burst,
}: {
    task: AirdropTaskState
    icon: LucideIcon
    action: ReactNode
    lockReason: string
    burst: number | null
}) {
    const done = task.status === "done"
    const muted = task.status === "locked" || task.status === "soon"
    const pct = task.progress ? Math.round((task.progress.current / task.progress.target) * 100) : null

    return (
        <li
            className={`app-card relative flex items-center gap-3.5 p-3.5 transition-colors sm:gap-4 sm:p-4 ${
                done ? "border-[var(--acid)]/35 bg-[var(--acid)]/[0.04]" : ""
            } ${muted ? "opacity-60" : ""}`}
        >
            <span
                className={`flex h-10 w-10 flex-none items-center justify-center border ${
                    done
                        ? "border-[var(--acid)] bg-[var(--acid)] text-[var(--acid-ink)]"
                        : "border-[var(--line-2)] bg-[var(--s2)] text-[var(--dim)]"
                }`}
            >
                {done ? <Check className="h-5 w-5" strokeWidth={3} /> : <Icon className="h-[18px] w-[18px]" />}
            </span>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h3 className={`text-[14px] font-semibold ${done ? "text-[var(--dim)]" : "text-[var(--txt)]"}`}>
                        {task.title}
                    </h3>
                    <span
                        className={`utd-pixel text-[8px] ${done ? "text-[var(--faint)]" : "text-[var(--acid)]"}`}
                    >
                        +{task.points.toLocaleString()}
                    </span>
                    {done && (
                        <span className="flex items-center gap-1 text-[12px] font-semibold text-[var(--acid)]">
                            <Check className="h-3.5 w-3.5" strokeWidth={3} /> Done
                        </span>
                    )}
                    {task.status === "locked" && (
                        <span className="flex items-center gap-1 text-[12px] font-semibold text-[var(--faint)]">
                            <Lock className="h-3 w-3" /> {lockReason}
                        </span>
                    )}
                    {task.status === "soon" && (
                        <span className="text-[12px] font-semibold text-[var(--faint)]">Coming soon</span>
                    )}
                </div>
                <p className="mt-0.5 text-[13px] text-[var(--faint)]">{task.description}</p>

                {task.progress && !done && (
                    <div className="mt-2 flex items-center gap-2.5">
                        <div className="h-1.5 flex-1 bg-[var(--s2)]">
                            <div className="h-full bg-[var(--acid)] transition-all duration-700" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono text-[11px] text-[var(--dim)]">
                            {task.progress.current.toLocaleString()}/{task.progress.target.toLocaleString()}
                        </span>
                    </div>
                )}
            </div>

            {action && <div className="flex-none">{action}</div>}

            {burst !== null && (
                <span className="airdrop-burst utd-pixel pointer-events-none absolute right-6 top-1 text-[12px] text-[var(--acid)]">
                    +{burst}
                </span>
            )}
        </li>
    )
}

function Breakdown({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
    return (
        <div className="min-w-0 bg-[var(--s1)] px-3 py-2.5">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">{label}</dt>
            <dd className={`mt-1 truncate font-mono text-[14px] ${accent ? "text-[var(--acid)]" : "text-[var(--txt)]"}`}>
                {value.toLocaleString()}
            </dd>
        </div>
    )
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text)
                    setCopied(true)
                    toast.success("Referral link copied!")
                    setTimeout(() => setCopied(false), 1500)
                } catch {
                    toast.error("Couldn't copy. Select the link and copy it manually.")
                }
            }}
            aria-label="Copy referral link"
            className="app-chip h-10 w-10 flex-none justify-center px-0"
        >
            {copied ? <Check className="h-4 w-4 text-[var(--acid)]" /> : <Copy className="h-4 w-4" />}
        </button>
    )
}

/** Animates from the previous value to the new one; jumps straight there with reduced motion. */
function CountUp({ value, className }: { value: number; className?: string }) {
    const [shown, setShown] = useState(0)
    const from = useRef(0)

    useEffect(() => {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        if (reduce) {
            setShown(value)
            from.current = value
            return
        }
        const start = performance.now()
        const startVal = from.current
        const dur = 900
        let raf = 0
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / dur)
            const eased = 1 - Math.pow(1 - t, 3)
            setShown(Math.round(startVal + (value - startVal) * eased))
            if (t < 1) raf = requestAnimationFrame(tick)
            else from.current = value
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [value])

    return <span className={`tabular-nums ${className ?? ""}`}>{shown.toLocaleString()}</span>
}

/** Mascot on a glowing pad with pixel coins orbiting it. Purely decorative. */
function CoinOrbit() {
    return (
        <div className="airdrop-orbit relative h-[150px] w-[150px] sm:h-[190px] sm:w-[190px]" aria-hidden>
            <div className="airdrop-orbit-ring absolute inset-0">
                {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className="airdrop-coin" style={{ ["--i" as string]: i }} />
                ))}
            </div>
            <div className="absolute inset-[22%] rounded-full bg-[var(--acid)]/20 blur-2xl" />
            <img
                src="/logo-mark.png"
                alt=""
                className="utd-mark airdrop-mascot absolute inset-[20%] h-[60%] w-[60%]"
            />
        </div>
    )
}

/** X's logo; lucide's "Twitter" icon is the retired bird. */
function XLogoIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    )
}
