"use client"

import { useState, useRef } from "react"
import { sound } from "./SoundEngine"
import { SectionHeading } from "./SectionHeading"
import { Shield } from "lucide-react"

type Tier = "Bronze" | "Silver" | "Gold" | "Diamond"

/**
 * Tier names are just the tier. They previously carried a second rank title
 * each -- "BRONZE OPERATOR", "SILVER GLADIATOR", "GOLD WARLORD",
 * "DIAMOND OVERLORD" -- which said nothing the tier name did not.
 */
const TIERS: Record<
    Tier,
    { pts: string; color: string; border: string; multiplier: string; vaultCap: string; desc: string }
> = {
    Bronze: {
        pts: "0 – 4,999",
        color: "text-amber-600",
        border: "border-amber-800/70",
        multiplier: "1.0×",
        vaultCap: "1,000 / epoch",
        desc: "Minted when your first duel settles. Opens public lobbies.",
    },
    Silver: {
        pts: "5,000 – 24,999",
        color: "text-slate-300",
        border: "border-slate-600/70",
        multiplier: "1.25×",
        vaultCap: "3,000 / epoch",
        desc: "Opens the higher staking tiers.",
    },
    Gold: {
        pts: "25,000 – 99,999",
        color: "text-yellow-400",
        border: "border-yellow-600/70",
        multiplier: "1.5×",
        vaultCap: "8,000 / epoch",
        desc: "Shortens the vesting schedule on rewards.",
    },
    Diamond: {
        pts: "100,000+",
        color: "text-cyan-400",
        border: "border-cyan-600/70",
        multiplier: "2.0×",
        vaultCap: "20,000 / epoch",
        desc: "Largest share of protocol fee revenue.",
    },
}

export function CombatCard3D() {
    const [tier, setTier] = useState<Tier>("Gold")
    const cardRef = useRef<HTMLDivElement>(null)
    const [tilt, setTilt] = useState({ x: 0, y: 0 })
    const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 })

    const active = TIERS[tier]

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current) return
        const rect = cardRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top

        setTilt({
            x: -((y - rect.height / 2) / (rect.height / 2)) * 7,
            y: ((x - rect.width / 2) / (rect.width / 2)) * 7,
        })
        setGlare({ x: (x / rect.width) * 100, y: (y / rect.height) * 100, opacity: 0.1 })
    }

    const resetTilt = () => {
        setTilt({ x: 0, y: 0 })
        setGlare({ x: 50, y: 50, opacity: 0 })
    }

    return (
        <div>
            <SectionHeading
                title="YOUR RECORD"
                aside="A soulbound ERC-721, minted the first time one of your duels settles."
            />

            <div className="mt-7 grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
                <div>
                    <p className="utd-body max-w-md text-[14px] text-[var(--dim)]">
                        Your lifetime score sits on-chain and cannot be traded away. It sets how much you
                        can draw from the vault each epoch, and how big a slice of protocol fees you see.
                    </p>

                    <div className="mt-6 flex flex-wrap gap-px bg-[var(--line)]">
                        {(Object.keys(TIERS) as Tier[]).map((t) => (
                            <button
                                key={t}
                                onClick={() => {
                                    sound.playBlip(520)
                                    setTier(t)
                                }}
                                aria-pressed={tier === t}
                                className={`flex-1 px-4 py-2.5 utd-pixel text-[9px] transition-colors ${
                                    tier === t
                                        ? "bg-[var(--acid)] text-[var(--acid-ink)]"
                                        : "bg-[var(--s1)] text-[var(--dim)] hover:bg-[var(--s2)] hover:text-[var(--txt)]"
                                }`}
                            >
                                {t.toUpperCase()}
                            </button>
                        ))}
                    </div>

                    <dl className="utd-panel utd-ticks mt-5 space-y-2.5 p-5 font-mono text-[12px]">
                        {[
                            ["Points", active.pts],
                            ["Reward multiplier", active.multiplier],
                            ["Vault cap", active.vaultCap],
                        ].map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                                <dt className="text-[var(--faint)]">{k}</dt>
                                <dd className="tabular-nums text-[var(--txt)]">{v}</dd>
                            </div>
                        ))}
                        <p className="utd-body border-t border-[var(--line)] pt-3 text-[13px] text-[var(--dim)]">
                            {active.desc}
                        </p>
                    </dl>
                </div>

                {/* Card preview */}
                <div className="flex justify-center">
                    <div
                        ref={cardRef}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={resetTilt}
                        style={{
                            transform: `perspective(1200px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                            transition: "transform 0.15s ease-out",
                        }}
                        className={`relative flex aspect-[1/1.42] w-full max-w-[320px] select-none flex-col justify-between overflow-hidden border-2 ${active.border} bg-[var(--s1)] p-6`}
                    >
                        <div
                            className="pointer-events-none absolute inset-0 transition-opacity duration-300"
                            style={{
                                background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,${glare.opacity}) 0%, transparent 55%)`,
                            }}
                        />

                        <div className="flex items-start justify-between">
                            <div className={`border ${active.border} p-2`}>
                                <Shield className={`h-5 w-5 ${active.color}`} />
                            </div>
                            <div className="text-right font-mono text-[10px] text-[var(--faint)]">
                                <div>#0429</div>
                                <div className="mt-0.5">SOULBOUND</div>
                            </div>
                        </div>

                        <div className="flex flex-col items-center">
                            <img src="/logo-mark.png" alt="" className="utd-mark h-20 w-20" />
                            <div className={`utd-label mt-4 ${active.color}`}>{tier}</div>
                            <div className="mt-2 font-mono text-[2rem] leading-none tabular-nums text-white">
                                28,450
                            </div>
                            <div className="utd-label mt-2 text-[var(--faint)]">points</div>
                        </div>

                        <dl className="space-y-1.5 border-t border-[var(--line)] pt-4 font-mono text-[10px]">
                            {[
                                ["Record", "18W / 10L"],
                                ["Owner", "0x71a4…99be"],
                                ["Vesting", "Linear, 60 days"],
                            ].map(([k, v]) => (
                                <div key={k} className="flex justify-between">
                                    <dt className="text-[var(--faint)]">{k}</dt>
                                    <dd className="text-[var(--dim)]">{v}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                </div>
            </div>
        </div>
    )
}
