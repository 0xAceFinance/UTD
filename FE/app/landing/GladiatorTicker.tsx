"use client"

import { useState } from "react"
import { sound } from "./SoundEngine"

export interface Gladiator {
    symbol: string
    name: string
    change: number
    mc: string
    volume24h: string
    liquidity: string
    holders: number
    /** Passed count out of the 8 pre-match contract safety checks. */
    checksPassed: number
}

/**
 * Sample roster. The previous version also carried pumpPower / shieldRating /
 * volatility (rendered as 0-100 RPG gauges) and a signatureMove string
 * ("Green Candle Hyper-Beam"). None of it maps to anything the protocol
 * measures, so the dossier now shows only figures a player can act on.
 */
const GLADIATORS: Gladiator[] = [
    { symbol: "PEPI", name: "Pepi the Frog", change: 34.8, mc: "$1.42M", volume24h: "$512K", liquidity: "$310K", holders: 2420, checksPassed: 8 },
    { symbol: "WOJK", name: "Feels Guy", change: 18.5, mc: "$2.10M", volume24h: "$780K", liquidity: "$480K", holders: 3890, checksPassed: 8 },
    { symbol: "BASD", name: "Based Chad", change: 22.4, mc: "$1.15M", volume24h: "$430K", liquidity: "$290K", holders: 1950, checksPassed: 7 },
    { symbol: "MOOR", name: "Moon Rat", change: 41.2, mc: "$890K", volume24h: "$340K", liquidity: "$210K", holders: 1420, checksPassed: 7 },
    { symbol: "FRGO", name: "Froggo", change: 9.7, mc: "$950K", volume24h: "$260K", liquidity: "$230K", holders: 1680, checksPassed: 8 },
    { symbol: "DGEN", name: "Degen Spartan", change: -11.3, mc: "$780K", volume24h: "$190K", liquidity: "$180K", holders: 1210, checksPassed: 6 },
    { symbol: "CHAD", name: "Giga Chad", change: 15.6, mc: "$3.40M", volume24h: "$920K", liquidity: "$640K", holders: 5120, checksPassed: 8 },
    { symbol: "SHBA", name: "Cyber Shiba", change: -4.2, mc: "$1.80M", volume24h: "$410K", liquidity: "$350K", holders: 2840, checksPassed: 8 },
]

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`

export function GladiatorTicker() {
    const [selected, setSelected] = useState<Gladiator>(GLADIATORS[0])

    const select = (g: Gladiator) => {
        sound.playBlip(720)
        setSelected(g)
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                {/* Token grid. auto-rows-fr so the two tile rows stretch to the
                    height of the detail panel beside them instead of leaving a
                    gap under the grid. */}
                <div className="lg:col-span-7">
                    <div className="grid h-full auto-rows-fr grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-4">
                        {GLADIATORS.map((g) => {
                            const isSelected = selected.symbol === g.symbol
                            return (
                                <button
                                    key={g.symbol}
                                    onClick={() => select(g)}
                                    aria-pressed={isSelected}
                                    className={`p-3.5 text-left transition-colors ${
                                        isSelected
                                            ? "bg-[var(--s2)] ring-1 ring-inset ring-[var(--acid)]"
                                            : "bg-[var(--s1)] hover:bg-[var(--s2)]"
                                    }`}
                                >
                                    <div className="utd-pixel text-[11px] text-white">{g.symbol}</div>
                                    <div className="utd-body mt-1.5 truncate text-[12px] text-[var(--faint)]">
                                        {g.name}
                                    </div>
                                    <div
                                        className={`mt-2.5 font-mono text-[12px] tabular-nums ${
                                            g.change >= 0 ? "text-[var(--acid)]" : "text-rose-400"
                                        }`}
                                    >
                                        {pct(g.change)}
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Detail panel for the selected token */}
                <div className="utd-panel utd-ticks p-5 lg:col-span-5">
                    <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
                        <div>
                            <div className="utd-pixel text-2xl text-white">{selected.symbol}</div>
                            <div className="utd-body mt-1 text-[13px] text-[var(--dim)]">{selected.name}</div>
                        </div>

                        <div className="text-right">
                            <div className="utd-label text-[var(--faint)]">24h</div>
                            <div
                                className={`mt-1 font-mono text-xl tabular-nums ${
                                    selected.change >= 0 ? "text-[var(--acid)]" : "text-rose-400"
                                }`}
                            >
                                {pct(selected.change)}
                            </div>
                        </div>
                    </div>

                    <dl className="mt-4 space-y-2.5 font-mono text-[12px]">
                        {[
                            ["Market cap", selected.mc],
                            ["24h volume", selected.volume24h],
                            ["Liquidity", selected.liquidity],
                            ["Holders", selected.holders.toLocaleString()],
                        ].map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                                <dt className="text-[var(--faint)]">{k}</dt>
                                <dd className="tabular-nums text-[var(--txt)]">{v}</dd>
                            </div>
                        ))}
                        <div className="flex justify-between border-t border-[var(--line)] pt-2.5">
                            <dt className="text-[var(--faint)]">Safety checks</dt>
                            <dd
                                className={`tabular-nums ${
                                    selected.checksPassed === 8 ? "text-[var(--acid)]" : "text-amber-400"
                                }`}
                            >
                                {selected.checksPassed}/8 passed
                            </dd>
                        </div>
                    </dl>
                </div>
            </div>

            {/* Marquee of the full roster */}
            <div className="relative overflow-hidden border-y border-[var(--line)] py-3">
                <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-20 bg-gradient-to-r from-[var(--s0)] to-transparent" />
                <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-20 bg-gradient-to-l from-[var(--s0)] to-transparent" />

                <div className="flex w-max">
                    <div className="marquee-track flex flex-none">
                        {[...GLADIATORS, ...GLADIATORS].map((g, i) => (
                            <div
                                key={`${g.symbol}-${i}`}
                                className="flex items-center gap-2.5 px-5 font-mono text-[12px]"
                            >
                                <span className="text-[var(--txt)]">{g.symbol}</span>
                                <span
                                    className={`tabular-nums ${
                                        g.change >= 0 ? "text-[var(--acid)]" : "text-rose-400"
                                    }`}
                                >
                                    {pct(g.change)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
