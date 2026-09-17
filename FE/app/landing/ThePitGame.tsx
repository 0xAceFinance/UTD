"use client"

import { useState, useEffect } from "react"
import { sound } from "./SoundEngine"
import { RotateCcw } from "lucide-react"

interface Token {
    symbol: string
    name: string
    mc: string
    lp: string
    vol: string
    holders: string
    rugScore: string
}

interface Matchup {
    tokenA: Token
    tokenB: Token
}

const MATCHUPS: Matchup[] = [
    {
        tokenA: { symbol: "PEPI", name: "Pepi the Frog", mc: "$1.4M", lp: "$310K", vol: "$512K", holders: "2,420", rugScore: "8/8 passed" },
        tokenB: { symbol: "WOJK", name: "Feels Guy", mc: "$2.1M", lp: "$480K", vol: "$780K", holders: "3,890", rugScore: "8/8 passed" },
    },
    {
        tokenA: { symbol: "BASD", name: "Based Chad", mc: "$1.2M", lp: "$290K", vol: "$430K", holders: "1,950", rugScore: "7/8 passed" },
        tokenB: { symbol: "MOOR", name: "Moon Rat", mc: "$890K", lp: "$210K", vol: "$340K", holders: "1,420", rugScore: "7/8 passed" },
    },
    {
        tokenA: { symbol: "CHAD", name: "Giga Chad", mc: "$3.4M", lp: "$640K", vol: "$920K", holders: "5,120", rugScore: "8/8 passed" },
        tokenB: { symbol: "DGEN", name: "Degen Spartan", mc: "$780K", lp: "$180K", vol: "$190K", holders: "1,210", rugScore: "6/8 passed" },
    },
]

const BET_AMOUNTS = [50, 100, 250, 500]

const SIDE_A = "#ff3d71"
const SIDE_B = "#35c6ff"

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`

export function ThePitGame() {
    const [matchIndex, setMatchIndex] = useState(0)
    const [timeLeft, setTimeLeft] = useState(30)
    const [status, setStatus] = useState<"LIVE" | "SETTLED" | "COUNTDOWN">("LIVE")
    const [gainA, setGainA] = useState(0)
    const [gainB, setGainB] = useState(0)
    const [historyA, setHistoryA] = useState<number[]>([0])
    const [historyB, setHistoryB] = useState<number[]>([0])
    const [userBet, setUserBet] = useState<{ side: "A" | "B"; amount: number } | null>(null)
    const [selectedBetAmount, setSelectedBetAmount] = useState<number>(100)
    const [cred, setCred] = useState<number>(1000)
    const [streak, setStreak] = useState<number>(0)
    const [winner, setWinner] = useState<"A" | "B" | null>(null)
    const [inspectSide, setInspectSide] = useState<"A" | "B" | null>(null)
    const [floatingHit, setFloatingHit] = useState<{ side: "A" | "B"; text: string } | null>(null)
    const [orderLogs, setOrderLogs] = useState<string[]>([
        "Practice rounds cycle every 30 seconds.",
        "Credits are local to this browser.",
    ])

    const currentMatch = MATCHUPS[matchIndex % MATCHUPS.length]

    useEffect(() => {
        try {
            const savedCred = localStorage.getItem("utd_pit_cred")
            const savedStreak = localStorage.getItem("utd_pit_streak")
            if (savedCred) setCred(Number(savedCred))
            if (savedStreak) setStreak(Number(savedStreak))
        } catch {}
    }, [])

    const updateCred = (newCred: number) => {
        setCred(newCred)
        try {
            localStorage.setItem("utd_pit_cred", String(newCred))
        } catch {}
    }

    const updateStreak = (newStreak: number) => {
        setStreak(newStreak)
        try {
            localStorage.setItem("utd_pit_streak", String(newStreak))
        } catch {}
    }

    useEffect(() => {
        const timer = setInterval(() => {
            if (status === "LIVE") {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        setStatus("SETTLED")
                        const winSide = gainA >= gainB ? "A" : "B"
                        setWinner(winSide)
                        const winSym = winSide === "A" ? currentMatch.tokenA.symbol : currentMatch.tokenB.symbol

                        if (userBet) {
                            if (userBet.side === winSide) {
                                const won = Math.round(userBet.amount * 1.8)
                                updateCred(cred + won)
                                updateStreak(streak + 1)
                                sound.playWin()
                                setOrderLogs((l) => [
                                    `Round won. +${won} credits at 1.8x.`,
                                    `${winSym} held the higher peak.`,
                                    ...l.slice(0, 3),
                                ])
                            } else {
                                updateStreak(0)
                                sound.playDefeat()
                                setOrderLogs((l) => [
                                    `Round lost. -${userBet.amount} credits.`,
                                    `${winSym} pumped harder.`,
                                    ...l.slice(0, 3),
                                ])
                            }
                        } else {
                            sound.playBlip(500)
                            setOrderLogs((l) => [
                                `${winSym} took the round at ${(gainA >= gainB ? gainA : gainB).toFixed(1)}%.`,
                                ...l.slice(0, 3),
                            ])
                        }
                        return 0
                    }

                    const deltaA = (Math.random() - 0.44) * 1.6
                    const deltaB = (Math.random() - 0.44) * 1.6
                    const nextA = Math.max(-12, +(gainA + deltaA).toFixed(1))
                    const nextB = Math.max(-12, +(gainB + deltaB).toFixed(1))

                    setGainA(nextA)
                    setGainB(nextB)
                    setHistoryA((h) => [...h.slice(-24), nextA])
                    setHistoryB((h) => [...h.slice(-24), nextB])

                    if (Math.random() > 0.68) {
                        const side = Math.random() > 0.5 ? "A" : "B"
                        const sym = side === "A" ? currentMatch.tokenA.symbol : currentMatch.tokenB.symbol
                        const amt = Math.floor(Math.random() * 800) + 150
                        const move = (Math.random() * 2.2 + 0.5).toFixed(1)
                        setOrderLogs((l) => [
                            `0x${Math.random().toString(16).slice(2, 6)} bought $${amt} of ${sym} (+${move}%)`,
                            ...l.slice(0, 3),
                        ])
                    }

                    return prev - 1
                })
            } else if (status === "SETTLED") {
                const timeout = setTimeout(() => {
                    setStatus("COUNTDOWN")
                    setTimeLeft(5)
                }, 4000)
                return () => clearTimeout(timeout)
            } else if (status === "COUNTDOWN") {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        setMatchIndex((m) => m + 1)
                        setGainA(0)
                        setGainB(0)
                        setHistoryA([0])
                        setHistoryB([0])
                        setUserBet(null)
                        setWinner(null)
                        setStatus("LIVE")
                        sound.playBlip(680)
                        setOrderLogs(["New round open. 30 seconds on the clock."])
                        return 30
                    }
                    sound.playBlip(380)
                    return prev - 1
                })
            }
        }, 1000)

        return () => clearInterval(timer)
    }, [status, gainA, gainB, userBet, cred, streak, currentMatch])

    const handlePump = (side: "A" | "B") => {
        if (status !== "LIVE") return
        sound.playPump(side === "A" ? 1 : 2)

        const boost = +(Math.random() * 1.8 + 0.8).toFixed(1)
        setFloatingHit({ side, text: `+${boost}%` })
        setTimeout(() => setFloatingHit(null), 700)

        const sym = side === "A" ? currentMatch.tokenA.symbol : currentMatch.tokenB.symbol
        if (side === "A") {
            const val = +(gainA + boost).toFixed(1)
            setGainA(val)
            setHistoryA((h) => [...h.slice(-24), val])
        } else {
            const val = +(gainB + boost).toFixed(1)
            setGainB(val)
            setHistoryB((h) => [...h.slice(-24), val])
        }
        setOrderLogs((l) => [`You bought ${sym} (+${boost}%)`, ...l.slice(0, 3)])
    }

    const handlePlaceBet = (side: "A" | "B") => {
        if (userBet || status !== "LIVE" || cred < selectedBetAmount) return
        sound.playBlip(620)
        updateCred(cred - selectedBetAmount)
        setUserBet({ side, amount: selectedBetAmount })
        setOrderLogs((l) => [
            `Staked ${selectedBetAmount} on ${side === "A" ? currentMatch.tokenA.symbol : currentMatch.tokenB.symbol}.`,
            ...l.slice(0, 3),
        ])
    }

    const resetCred = () => {
        sound.playBlip(440)
        updateCred(1000)
        updateStreak(0)
        setUserBet(null)
    }

    /* The chart domain used to be hard-coded to -15..30, so a typical round
       (both lines inside a few percent) drew as two flat overlapping lines.
       It now fits the data actually on screen. */
    const allPoints = [...historyA, ...historyB]
    const lo = Math.min(-1, ...allPoints)
    const hi = Math.max(1, ...allPoints)
    const pad = (hi - lo) * 0.15 || 1
    const minVal = lo - pad
    const maxVal = hi + pad

    const renderSvgLine = (data: number[], color: string) => {
        if (data.length < 2) return null
        const width = 300
        const height = 64
        const range = maxVal - minVal

        const points = data.map((val, idx) => {
            const x = (idx / (data.length - 1)) * width
            const y = height - ((val - minVal) / range) * height
            return `${x},${y}`
        })

        return (
            <polyline
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points.join(" ")}
            />
        )
    }

    const zeroY = 64 - ((0 - minVal) / (maxVal - minVal)) * 64
    const leadShare = Math.min(85, Math.max(15, 50 + (gainA - gainB) * 3.5))

    const sides = [
        { key: "A" as const, token: currentMatch.tokenA, gain: gainA, color: SIDE_A, label: "Side A" },
        { key: "B" as const, token: currentMatch.tokenB, gain: gainB, color: SIDE_B, label: "Side B" },
    ]

    return (
        <div className="utd-panel utd-screen">
            {/* Status row */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                    {status === "LIVE" && <span className="utd-live" />}
                    <span className="utd-label text-[var(--txt)]">
                        {status === "LIVE" ? "Round live" : status === "SETTLED" ? "Settled" : "Next round"}
                    </span>
                    <span className="font-mono text-[13px] tabular-nums text-[var(--dim)]">
                        {String(timeLeft).padStart(2, "0")}s
                    </span>
                </div>

                <div className="flex items-center gap-5 font-mono text-[12px]">
                    <span className="text-[var(--faint)]">
                        Credits <span className="tabular-nums text-[var(--acid)]">{cred}</span>
                    </span>
                    <span className="text-[var(--faint)]">
                        Streak <span className="tabular-nums text-[var(--txt)]">{streak}</span>
                    </span>
                    {cred <= 0 && (
                        <button
                            onClick={resetCred}
                            title="Reset to 1,000 credits"
                            className="flex items-center gap-1.5 text-[var(--dim)] transition-colors hover:text-[var(--txt)]"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reset
                        </button>
                    )}
                </div>
            </div>

            <div className="p-5">
                {/* Trajectory */}
                <div className="flex items-center justify-between font-mono text-[12px]">
                    {sides.map((s) => (
                        <span key={s.key} className="flex items-center gap-2">
                            <span className="h-2 w-2" style={{ background: s.color }} />
                            <span className="text-[var(--dim)]">{s.token.symbol}</span>
                            <span className="tabular-nums text-[var(--txt)]">{pct(s.gain)}</span>
                        </span>
                    ))}
                </div>

                <svg viewBox="0 0 300 64" preserveAspectRatio="none" className="mt-3 h-20 w-full" aria-hidden>
                    <line x1="0" y1={zeroY} x2="300" y2={zeroY} stroke="var(--line-2)" strokeDasharray="3 4" />
                    {renderSvgLine(historyA, SIDE_A)}
                    {renderSvgLine(historyB, SIDE_B)}
                </svg>

                {/* Lead bar. The old version put a pinging amber "CLASH POINT"
                    badge and a glowing lightning marker on top of this; the bar
                    already shows who is ahead. */}
                <div className="mt-4 flex h-1.5 w-full overflow-hidden bg-[var(--s2)]">
                    <div
                        className="transition-all duration-500"
                        style={{ width: `${leadShare}%`, background: SIDE_A }}
                    />
                    <div className="flex-1 transition-all duration-500" style={{ background: SIDE_B }} />
                </div>

                {/* Combatants */}
                <div className="mt-5 grid grid-cols-1 gap-px bg-[var(--line)] sm:grid-cols-2">
                    {sides.map((s) => {
                        const isStaked = userBet?.side === s.key
                        return (
                            <div
                                key={s.key}
                                className="relative bg-[var(--s2)] p-4"
                                style={{ borderTop: `2px solid ${s.color}` }}
                            >
                                {floatingHit?.side === s.key && (
                                    <div
                                        className="absolute right-4 top-4 font-mono text-[12px] tabular-nums"
                                        style={{ color: s.color }}
                                    >
                                        {floatingHit.text}
                                    </div>
                                )}

                                <div className="utd-label" style={{ color: s.color }}>
                                    {s.label}
                                </div>

                                <div className="mt-2.5 flex items-end justify-between gap-3">
                                    <div>
                                        <div className="utd-pixel text-xl text-white">{s.token.symbol}</div>
                                        <div className="utd-body mt-1 text-[12px] text-[var(--faint)]">
                                            {s.token.name}
                                        </div>
                                    </div>
                                    <div
                                        className={`font-mono text-xl tabular-nums ${
                                            s.gain >= 0 ? "text-[var(--acid)]" : "text-rose-400"
                                        }`}
                                    >
                                        {pct(s.gain)}
                                    </div>
                                </div>

                                <div className="mt-4 flex gap-px bg-[var(--line)]">
                                    <button
                                        disabled={Boolean(userBet) || status !== "LIVE" || cred < selectedBetAmount}
                                        onClick={() => handlePlaceBet(s.key)}
                                        className={`flex-1 py-2.5 utd-pixel text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                                            isStaked
                                                ? "bg-[var(--acid)] text-[var(--acid-ink)]"
                                                : "bg-[var(--s1)] text-[var(--dim)] hover:text-[var(--txt)]"
                                        }`}
                                    >
                                        {isStaked ? `STAKED ${userBet.amount}` : `STAKE ${selectedBetAmount}`}
                                    </button>

                                    <button
                                        disabled={status !== "LIVE"}
                                        onClick={() => handlePump(s.key)}
                                        className="utd-pixel px-5 py-2.5 text-[9px] text-[var(--acid-ink)] transition-transform active:translate-y-px disabled:cursor-not-allowed disabled:opacity-35"
                                        style={{ background: s.color }}
                                    >
                                        PUMP
                                    </button>
                                </div>

                                <button
                                    onClick={() => setInspectSide(inspectSide === s.key ? null : s.key)}
                                    className="utd-body mt-3 text-[12px] text-[var(--faint)] underline decoration-[var(--line-2)] underline-offset-4 transition-colors hover:text-[var(--dim)]"
                                >
                                    {inspectSide === s.key ? "Hide details" : "Details"}
                                </button>

                                {inspectSide === s.key && (
                                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--line)] pt-3 font-mono text-[11px]">
                                        {[
                                            ["Market cap", s.token.mc],
                                            ["Liquidity", s.token.lp],
                                            ["24h volume", s.token.vol],
                                            ["Safety", s.token.rugScore],
                                        ].map(([k, v]) => (
                                            <div key={k}>
                                                <dt className="text-[var(--faint)]">{k}</dt>
                                                <dd className="mt-0.5 text-[var(--txt)]">{v}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                )}
                            </div>
                        )
                    })}
                </div>

                {status === "SETTLED" && winner && (
                    <div className="mt-5 border-l-2 border-[var(--acid)] bg-[var(--s2)] px-4 py-3.5">
                        <div className="utd-pixel text-[15px] text-white">
                            {winner === "A" ? currentMatch.tokenA.symbol : currentMatch.tokenB.symbol} takes the
                            round
                        </div>
                        <p className="utd-body mt-1 text-[13px] text-[var(--dim)]">
                            {userBet
                                ? userBet.side === winner
                                    ? `You called it. ${Math.round(userBet.amount * 1.8)} credits added.`
                                    : "Your side fell behind. Next round in a moment."
                                : "No stake this round. Next one starts shortly."}
                        </p>
                    </div>
                )}

                {/* Stake size */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
                    <div className="flex items-center gap-3">
                        <span className="utd-label text-[var(--faint)]">Stake</span>
                        <div className="flex gap-px bg-[var(--line)]">
                            {BET_AMOUNTS.map((amt) => (
                                <button
                                    key={amt}
                                    disabled={Boolean(userBet) || cred < amt}
                                    onClick={() => {
                                        sound.playBlip(550)
                                        setSelectedBetAmount(amt)
                                    }}
                                    className={`px-3 py-1.5 font-mono text-[12px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                                        selectedBetAmount === amt
                                            ? "bg-[var(--acid)] text-[var(--acid-ink)]"
                                            : "bg-[var(--s2)] text-[var(--dim)] hover:text-[var(--txt)]"
                                    }`}
                                >
                                    {amt}
                                </button>
                            ))}
                        </div>
                    </div>

                    <span className="font-mono text-[12px] text-[var(--faint)]">Pays 1.8×</span>
                </div>

                {/* Feed */}
                <div className="mt-4 space-y-1 border-t border-[var(--line)] pt-4 font-mono text-[11px]">
                    {orderLogs.map((log, idx) => (
                        <div
                            key={`${idx}-${log}`}
                            className={`truncate ${idx === 0 ? "text-[var(--dim)]" : "text-[var(--faint)]"}`}
                        >
                            {log}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
