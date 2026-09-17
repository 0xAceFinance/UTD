"use client"

import { useState, useEffect } from "react"
import { sound } from "./SoundEngine"
import { SectionHeading } from "./SectionHeading"
import { Check } from "lucide-react"

interface Reserved {
    passNumber: number
    alreadyRegistered: boolean
}

export function WhitelistTerminal() {
    const [input, setInput] = useState("")
    const [reserved, setReserved] = useState<Reserved | null>(null)
    const [counts, setCounts] = useState<{ claimed: number; total: number } | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Real count from the database. Until it arrives the aside stays empty
    // rather than showing a placeholder number -- the previous version shipped
    // a hardcoded 847 that had never corresponded to anything.
    //
    // Retried, because a single swallowed failure here (a cold serverless
    // start, a slow first connection) would otherwise hide the count for the
    // rest of the visit with nothing to show for it.
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || submitting || reserved) return

        sound.playBlip(700)
        setSubmitting(true)
        setError(null)

        try {
            const res = await fetch("/api/whitelist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ identifier: input.trim() }),
            })
            const body = await res.json()

            if (!res.ok || !body?.success) {
                setError(
                    typeof body?.error === "string"
                        ? body.error
                        : "Could not reach the server. Try again in a moment.",
                )
                sound.playBlip(220)
                return
            }

            setReserved({
                passNumber: body.data.passNumber,
                alreadyRegistered: body.data.alreadyRegistered,
            })
            setCounts({ claimed: body.data.claimed, total: body.data.total })
            sound.playWin()
        } catch {
            setError("Could not reach the server. Try again in a moment.")
            sound.playBlip(220)
        } finally {
            setSubmitting(false)
        }
    }

    const aside = counts
        ? `${(counts.total - counts.claimed).toLocaleString()} of ${counts.total.toLocaleString()} day-one passes left.`
        : undefined

    return (
        <div>
            <SectionHeading title="GET IN" aside={aside} />

            <div className="utd-panel utd-ticks mt-7 p-6 sm:p-8">
                {reserved ? (
                    <div className="flex items-center gap-3">
                        <Check className="h-5 w-5 flex-none text-[var(--acid)]" />
                        <div>
                            <div className="utd-pixel text-lg text-white">
                                Pass #{String(reserved.passNumber).padStart(4, "0")}
                            </div>
                            <p className="utd-body mt-1.5 text-[13px] text-[var(--dim)]">
                                {reserved.alreadyRegistered
                                    ? "You were already on the list. Same pass, same spot."
                                    : "You're on the list. We'll message you once the contracts are live."}
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
                            <label className="sr-only" htmlFor="utd-whitelist">
                                Wallet address or email
                            </label>
                            <input
                                id="utd-whitelist"
                                type="text"
                                placeholder="Wallet address or email"
                                value={input}
                                onChange={(e) => {
                                    setInput(e.target.value)
                                    if (error) setError(null)
                                }}
                                aria-invalid={Boolean(error)}
                                className="utd-body flex-1 border border-[var(--line-2)] bg-[var(--s0)] px-4 py-3.5 text-[14px] text-white placeholder:text-[var(--faint)] focus:border-[var(--acid)] focus:outline-none"
                            />
                            <button
                                type="submit"
                                disabled={submitting || !input.trim()}
                                className="utd-btn px-6 py-3.5 text-[10px]"
                            >
                                {submitting ? "SAVING…" : "RESERVE A PASS"}
                            </button>
                        </form>

                        <p
                            className={`utd-body mt-4 text-[13px] ${
                                error ? "text-[var(--hot)]" : "text-[var(--faint)]"
                            }`}
                        >
                            {error ?? "One message when we launch. Nothing else."}
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}
