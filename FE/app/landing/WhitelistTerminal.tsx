"use client"

import { useState, useEffect } from "react"
import { sound } from "./SoundEngine"
import { SectionHeading } from "./SectionHeading"
import { Check } from "lucide-react"

const TOTAL_PASSES = 1000

export function WhitelistTerminal() {
    const [input, setInput] = useState("")
    const [reservedPass, setReservedPass] = useState<number | null>(null)
    const [claimedCount, setClaimedCount] = useState(847)
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        try {
            const saved = localStorage.getItem("utd_whitelist_pass")
            if (saved) setReservedPass(Number(saved))
        } catch {}
    }, [])

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim() || submitting || reservedPass) return

        sound.playBlip(700)
        setSubmitting(true)

        setTimeout(() => {
            const passNumber = claimedCount + 1
            setClaimedCount(passNumber)
            setReservedPass(passNumber)
            try {
                localStorage.setItem("utd_whitelist_pass", String(passNumber))
            } catch {}
            sound.playWin()
            setSubmitting(false)
        }, 900)
    }

    const remaining = TOTAL_PASSES - claimedCount

    return (
        <div>
            <SectionHeading
                title="GET IN"
                aside={`${remaining} of ${TOTAL_PASSES.toLocaleString()} day-one passes left.`}
            />

            <div className="utd-panel utd-ticks mt-7 p-6 sm:p-8">
                {reservedPass ? (
                    <div className="flex items-center gap-3">
                        <Check className="h-5 w-5 flex-none text-[var(--acid)]" />
                        <div>
                            <div className="utd-pixel text-lg text-white">
                                Pass #{String(reservedPass).padStart(4, "0")} is yours
                            </div>
                            <p className="utd-body mt-1.5 text-[13px] text-[var(--dim)]">
                                Saved on this device. We&apos;ll message you once the contracts are live.
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
                                onChange={(e) => setInput(e.target.value)}
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

                        <p className="utd-body mt-4 text-[13px] text-[var(--faint)]">
                            One message when we launch. Nothing else.
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}
