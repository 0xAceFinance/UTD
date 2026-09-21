"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Activity } from "lucide-react"
import { DuelDTO, formatUsd, pctReturn } from "./types"
import { CHAIN_ID } from "@/lib/dexScreenerSource"
import { arcadeAudio } from "@/lib/sound/arcadeAudio"

interface ChartPoint {
    timeSec: number // seconds since duel start
    gainA: number
    gainB: number
    mcA: number
    mcB: number
}

function formatAxisGain(gain: number): string {
    const sign = gain > 0 ? "+" : ""
    if (Math.abs(gain) >= 10000) {
        return `${sign}${(gain / 1000).toFixed(0)}k%`
    }
    if (Math.abs(gain) >= 100) {
        return `${sign}${gain.toFixed(0)}%`
    }
    return `${sign}${gain.toFixed(1)}%`
}

export function DuelLiveChart({
    duel,
    className = "",
}: {
    duel: DuelDTO
    className?: string
}) {
    const [activeTab, setActiveTab] = useState<"headToHead" | "tokenA" | "tokenB">("headToHead")
    const [hoverPoint, setHoverPoint] = useState<ChartPoint | null>(null)
    const [hoverX, setHoverX] = useState<number | null>(null)
    const [accumulatedTicks, setAccumulatedTicks] = useState<ChartPoint[]>([])
    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
    const svgRef = useRef<SVGSVGElement | null>(null)
    const prevGainsRef = useRef<{ gainA: number; gainB: number } | null>(null)

    // 1-second live heartbeat clock when duel is LIVE
    useEffect(() => {
        if (duel.status !== "LIVE") return
        const timer = setInterval(() => {
            setNowSec(Math.floor(Date.now() / 1000))
        }, 1000)
        return () => clearInterval(timer)
    }, [duel.status])

    const startTimeSec = useMemo(() => {
        if (!duel.startTime) return Math.floor(new Date(duel.createdAt).getTime() / 1000)
        return Math.floor(new Date(duel.startTime).getTime() / 1000)
    }, [duel.startTime, duel.createdAt])

    const duelDuration = duel.durationSeconds || 1200

    const effectiveEndTimeSec = useMemo(() => {
        if (duel.endTime) return Math.floor(new Date(duel.endTime).getTime() / 1000)
        return startTimeSec + duelDuration
    }, [duel.endTime, startTimeSec, duelDuration])

    // Current elapsed match duration in seconds (strictly bounded so finished duels don't run into days)
    const currentElapsedSec = useMemo(() => {
        if (duel.status === "LIVE") {
            return Math.max(0, Math.min(nowSec - startTimeSec, duelDuration))
        }
        return Math.max(0, Math.min(effectiveEndTimeSec - startTimeSec, duelDuration))
    }, [duel.status, nowSec, startTimeSec, duelDuration, effectiveEndTimeSec])

    // Live 1-second interval tick accumulation and sound cue triggers for active battle
    useEffect(() => {
        if (duel.status !== "LIVE") return
        const gainA = pctReturn(duel.tokenA.startMarketCapUsd, duel.tokenA.currentMarketCapUsd)
        const gainB = pctReturn(duel.tokenB.startMarketCapUsd, duel.tokenB.currentMarketCapUsd)

        // Sound trigger: detect significant rally surge or dump impact
        if (prevGainsRef.current) {
            const deltaA = gainA - prevGainsRef.current.gainA
            const deltaB = gainB - prevGainsRef.current.gainB

            if (deltaA >= 2.0 || deltaB >= 2.0) {
                arcadeAudio.play("pump", { pitch: 1.2 })
            } else if (deltaA <= -2.0 || deltaB <= -2.0) {
                arcadeAudio.play("dump")
            }
        }
        prevGainsRef.current = { gainA, gainB }

        setAccumulatedTicks((prev) => {
            if (prev.length === 0) {
                return [
                    { timeSec: 0, gainA: 0, gainB: 0, mcA: duel.tokenA.startMarketCapUsd, mcB: duel.tokenB.startMarketCapUsd },
                    { timeSec: currentElapsedSec, gainA, gainB, mcA: duel.tokenA.currentMarketCapUsd, mcB: duel.tokenB.currentMarketCapUsd },
                ]
            }

            const last = prev[prev.length - 1]
            if (last && last.timeSec === currentElapsedSec) {
                // Update in place for this second
                const updated = [...prev]
                updated[updated.length - 1] = {
                    timeSec: currentElapsedSec,
                    gainA,
                    gainB,
                    mcA: duel.tokenA.currentMarketCapUsd,
                    mcB: duel.tokenB.currentMarketCapUsd,
                }
                return updated
            }

            // Append tick for new second
            return [
                ...prev,
                { timeSec: currentElapsedSec, gainA, gainB, mcA: duel.tokenA.currentMarketCapUsd, mcB: duel.tokenB.currentMarketCapUsd },
            ]
        })
    }, [duel.status, currentElapsedSec, duel.tokenA.currentMarketCapUsd, duel.tokenB.currentMarketCapUsd, duel.tokenA.startMarketCapUsd, duel.tokenB.startMarketCapUsd])

    // Process stored rawSamples into validated price points
    const chartPoints = useMemo<ChartPoint[]>(() => {
        const samplePointsMap = new Map<number, { gainA?: number; gainB?: number; mcA?: number; mcB?: number }>()

        // 1. Add t=0 baseline
        samplePointsMap.set(0, {
            gainA: 0,
            gainB: 0,
            mcA: duel.tokenA.startMarketCapUsd,
            mcB: duel.tokenB.startMarketCapUsd,
        })

        // Helper to extract true market cap from pool samples
        const processSamples = (
            samples?: typeof duel.tokenA.rawSamples,
            totalSupply?: number,
            startMc?: number
        ) => {
            if (!samples || samples.length === 0 || !totalSupply || !startMc) return []
            // Group by timestampSec and pick the pool with the highest quote reserve (highest liquidity)
            const byTimestamp = new Map<number, { liq: number; mc: number; tSec: number }>()

            for (const s of samples) {
                if (s.reserveToken <= 0 || s.reserveQuote <= 0) continue
                const quotePrice = s.quotePriceUsd || 1
                const liq = s.reserveQuote * quotePrice * 2
                const priceUsd = (s.reserveQuote / s.reserveToken) * quotePrice
                const mc = priceUsd * totalSupply
                const tSec = Math.max(0, Math.min(s.timestampSec - startTimeSec, duelDuration))

                const existing = byTimestamp.get(s.timestampSec)
                if (!existing || liq > existing.liq) {
                    byTimestamp.set(s.timestampSec, { liq, mc, tSec })
                }
            }

            return Array.from(byTimestamp.values()).map((p) => ({
                tSec: p.tSec,
                mc: p.mc,
                gain: pctReturn(startMc, p.mc),
            }))
        }

        const ptsA = processSamples(duel.tokenA.rawSamples, duel.tokenA.totalSupply, duel.tokenA.startMarketCapUsd)
        for (const p of ptsA) {
            const cur = samplePointsMap.get(p.tSec) || {}
            samplePointsMap.set(p.tSec, { ...cur, gainA: p.gain, mcA: p.mc })
        }

        const ptsB = processSamples(duel.tokenB.rawSamples, duel.tokenB.totalSupply, duel.tokenB.startMarketCapUsd)
        for (const p of ptsB) {
            const cur = samplePointsMap.get(p.tSec) || {}
            samplePointsMap.set(p.tSec, { ...cur, gainB: p.gain, mcB: p.mc })
        }

        // Merge in accumulated live poll ticks
        for (const tick of accumulatedTicks) {
            const cur = samplePointsMap.get(tick.timeSec) || {}
            samplePointsMap.set(tick.timeSec, {
                ...cur,
                gainA: tick.gainA,
                gainB: tick.gainB,
                mcA: tick.mcA,
                mcB: tick.mcB,
            })
        }

        // Add current/final reading at currentElapsedSec
        const finalGainA = pctReturn(duel.tokenA.startMarketCapUsd, duel.tokenA.currentMarketCapUsd)
        const finalGainB = pctReturn(duel.tokenB.startMarketCapUsd, duel.tokenB.currentMarketCapUsd)
        const curAtElapsed = samplePointsMap.get(currentElapsedSec) || {}
        samplePointsMap.set(currentElapsedSec, {
            ...curAtElapsed,
            gainA: curAtElapsed.gainA ?? finalGainA,
            gainB: curAtElapsed.gainB ?? finalGainB,
            mcA: curAtElapsed.mcA ?? duel.tokenA.currentMarketCapUsd,
            mcB: curAtElapsed.mcB ?? duel.tokenB.currentMarketCapUsd,
        })

        const sortedTimes = Array.from(samplePointsMap.keys()).sort((a, b) => a - b)
        let lastGainA = 0
        let lastGainB = 0
        let lastMcA = duel.tokenA.startMarketCapUsd
        let lastMcB = duel.tokenB.startMarketCapUsd

        return sortedTimes.map((timeSec) => {
            const entry = samplePointsMap.get(timeSec)!
            if (entry.gainA !== undefined) lastGainA = entry.gainA
            if (entry.gainB !== undefined) lastGainB = entry.gainB
            if (entry.mcA !== undefined) lastMcA = entry.mcA
            if (entry.mcB !== undefined) lastMcB = entry.mcB

            return {
                timeSec,
                gainA: lastGainA,
                gainB: lastGainB,
                mcA: lastMcA,
                mcB: lastMcB,
            }
        })
    }, [duel, startTimeSec, duelDuration, accumulatedTicks, currentElapsedSec])

    // Fixed total time domain based on duel duration
    const maxTimeSec = duelDuration

    // Sustained peak gains
    const peakA = pctReturn(duel.tokenA.startMarketCapUsd, duel.tokenA.sustainedPeakMarketCapUsd)
    const peakB = pctReturn(duel.tokenB.startMarketCapUsd, duel.tokenB.sustainedPeakMarketCapUsd)

    // Compute realistic Y-domain
    const allGains = chartPoints.flatMap((p) => [p.gainA, p.gainB]).concat([0])
    if (peakA > 0) allGains.push(peakA)
    if (peakB > 0) allGains.push(peakB)

    const rawMin = Math.min(...allGains)
    const rawMax = Math.max(...allGains)
    const gainSpan = Math.max(10, rawMax - rawMin)
    const yPadding = Math.max(4, gainSpan * 0.2)
    const minY = Math.floor(rawMin - yPadding)
    const maxY = Math.ceil(rawMax + yPadding)
    const yRange = maxY - minY || 1

    // SVG Dimensions & Margins
    const svgWidth = 850
    const svgHeight = 290
    const paddingLeft = 72
    const paddingRight = 35
    const paddingTop = 28
    const paddingBottom = 35

    const plotWidth = svgWidth - paddingLeft - paddingRight
    const plotHeight = svgHeight - paddingTop - paddingBottom

    const getX = (timeSec: number) => paddingLeft + (Math.min(timeSec, maxTimeSec) / maxTimeSec) * plotWidth
    const getY = (gain: number) => paddingTop + plotHeight - ((gain - minY) / yRange) * plotHeight

    const zeroY = getY(0)

    // Generate Path Data
    const pathA = chartPoints.length > 0
        ? chartPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(p.timeSec).toFixed(1)} ${getY(p.gainA).toFixed(1)}`).join(" ")
        : ""
    const pathB = chartPoints.length > 0
        ? chartPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${getX(p.timeSec).toFixed(1)} ${getY(p.gainB).toFixed(1)}`).join(" ")
        : ""

    const lastPoint = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : null

    const areaA = chartPoints.length > 0 && lastPoint
        ? `${pathA} L ${getX(lastPoint.timeSec).toFixed(1)} ${zeroY.toFixed(1)} L ${getX(chartPoints[0].timeSec).toFixed(1)} ${zeroY.toFixed(1)} Z`
        : ""
    const areaB = chartPoints.length > 0 && lastPoint
        ? `${pathB} L ${getX(lastPoint.timeSec).toFixed(1)} ${zeroY.toFixed(1)} L ${getX(chartPoints[0].timeSec).toFixed(1)} ${zeroY.toFixed(1)} Z`
        : ""

    // Hover handler
    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current || chartPoints.length === 0) return
        const rect = svgRef.current.getBoundingClientRect()
        const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth

        if (mouseX < paddingLeft || mouseX > svgWidth - paddingRight) {
            setHoverPoint(null)
            setHoverX(null)
            return
        }

        const hoverTime = ((mouseX - paddingLeft) / plotWidth) * maxTimeSec
        let closest = chartPoints[0]
        let minDiff = Math.abs(closest.timeSec - hoverTime)
        for (let i = 1; i < chartPoints.length; i++) {
            const diff = Math.abs(chartPoints[i].timeSec - hoverTime)
            if (diff < minDiff) {
                minDiff = diff
                closest = chartPoints[i]
            }
        }

        setHoverPoint(closest)
        setHoverX(getX(closest.timeSec))
    }

    const handleMouseLeave = () => {
        setHoverPoint(null)
        setHoverX(null)
    }

    // Clean, spaced X-Axis Ticks (5 ticks)
    const xTicks = [0, 0.25, 0.5, 0.75, 1.0].map((pct) => {
        const sec = Math.round(maxTimeSec * pct)
        const mins = Math.floor(sec / 60)
        const remSec = sec % 60
        const label = remSec > 0 ? `${mins}m${remSec}s` : `${mins}m`
        return { sec, label }
    })

    // Clean Y-Axis Ticks (5 evenly spaced ticks)
    const yTickCount = 5
    const gainTicks: number[] = []
    const gainStep = yRange / (yTickCount - 1)
    for (let i = 0; i < yTickCount; i++) {
        gainTicks.push(Number((minY + i * gainStep).toFixed(1)))
    }

    // Elapsed match clock display
    const elapsedMins = Math.floor(currentElapsedSec / 60)
    const elapsedSecs = currentElapsedSec % 60
    const totalMins = Math.floor(duelDuration / 60)

    const switchTab = (tab: "headToHead" | "tokenA" | "tokenB") => {
        arcadeAudio.play("tab")
        setActiveTab(tab)
    }

    return (
        <div className={`p-4 sm:p-5 bg-[var(--s1)] border border-[var(--line)] space-y-4 ${className}`}>
            {/* Header / Tab Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => switchTab("headToHead")}
                        className={`text-[9px] sm:text-[10px] utd-pixel px-3 py-1.5 transition-all flex items-center gap-1.5 ${
                            activeTab === "headToHead"
                                ? "bg-[var(--s0)] text-[var(--acid)] border border-[var(--acid)] shadow-[0_0_8px_rgba(43,232,132,0.3)]"
                                : "text-[var(--dim)] hover:text-white border border-transparent"
                        }`}
                    >
                        <Activity className="h-3.5 w-3.5" />
                        HEAD-TO-HEAD BATTLE
                    </button>

                    {duel.tokenA.tokenAddress && (
                        <button
                            onClick={() => switchTab("tokenA")}
                            className={`text-[9px] sm:text-[10px] utd-pixel px-3 py-1.5 transition-all ${
                                activeTab === "tokenA"
                                    ? "bg-[var(--s0)] text-[var(--hot)] border border-[var(--hot)] shadow-[0_0_8px_rgba(255,61,113,0.3)]"
                                    : "text-[var(--dim)] hover:text-white border border-transparent"
                            }`}
                        >
                            {duel.tokenA.symbol} DEX
                        </button>
                    )}

                    {duel.tokenB.tokenAddress && (
                        <button
                            onClick={() => switchTab("tokenB")}
                            className={`text-[9px] sm:text-[10px] utd-pixel px-3 py-1.5 transition-all ${
                                activeTab === "tokenB"
                                    ? "bg-[var(--s0)] text-[var(--cool)] border border-[var(--cool)] shadow-[0_0_8px_rgba(53,198,255,0.3)]"
                                    : "text-[var(--dim)] hover:text-white border border-transparent"
                            }`}
                        >
                            {duel.tokenB.symbol} DEX
                        </button>
                    )}
                </div>

                {/* Right stats and Live Indicator */}
                <div className="flex items-center gap-3 font-mono text-[10px]">
                    {duel.status === "LIVE" ? (
                        <div className="flex items-center gap-1.5 bg-[var(--s0)] px-2 py-0.5 border border-[var(--acid)] text-[var(--acid)] text-[9px] utd-pixel">
                            <span className="w-2 h-2 rounded-full bg-[var(--acid)] animate-pulse" />
                            1s LIVE
                        </div>
                    ) : (
                        <div className="text-[var(--faint)] text-[9px] utd-pixel">
                            [{duel.status}]
                        </div>
                    )}

                    <div className="text-[var(--faint)]">
                        {String(elapsedMins).padStart(2, "0")}:{String(elapsedSecs).padStart(2, "0")} / {totalMins}m
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[var(--hot)] shadow-[0_0_6px_#ff3d71]" />
                        <span className="text-[var(--dim)]">{duel.tokenA.symbol}:</span>
                        <span className={lastPoint && lastPoint.gainA >= 0 ? "text-[var(--acid)] font-bold" : "text-[var(--hot)] font-bold"}>
                            {lastPoint ? `${lastPoint.gainA >= 0 ? "+" : ""}${lastPoint.gainA.toFixed(1)}%` : "0.0%"}
                        </span>
                    </div>

                    <div className="text-[var(--faint)]">VS</div>

                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[var(--cool)] shadow-[0_0_6px_#35c6ff]" />
                        <span className="text-[var(--dim)]">{duel.tokenB.symbol}:</span>
                        <span className={lastPoint && lastPoint.gainB >= 0 ? "text-[var(--acid)] font-bold" : "text-[var(--cool)] font-bold"}>
                            {lastPoint ? `${lastPoint.gainB >= 0 ? "+" : ""}${lastPoint.gainB.toFixed(1)}%` : "0.0%"}
                        </span>
                    </div>
                </div>
            </div>

            {/* TAB 1: Head-to-Head Normalized Duel Performance Curve */}
            {activeTab === "headToHead" && (
                <div className="relative w-full overflow-hidden select-none">
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                        className="w-full h-auto bg-[var(--s0)] border border-[var(--line)]" style={{ cursor: "url('data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='14' r='9' fill='none' stroke='%232be884' stroke-width='1.5' stroke-dasharray='5 2'/%3E%3Cline x1='14' y1='1' x2='14' y2='6' stroke='%232be884' stroke-width='2' stroke-linecap='round'/%3E%3Cline x1='14' y1='22' x2='14' y2='27' stroke='%232be884' stroke-width='2' stroke-linecap='round'/%3E%3Cline x1='1' y1='14' x2='6' y2='14' stroke='%232be884' stroke-width='2' stroke-linecap='round'/%3E%3Cline x1='22' y1='14' x2='27' y2='14' stroke='%232be884' stroke-width='2' stroke-linecap='round'/%3E%3Ccircle cx='14' cy='14' r='2.5' fill='%23ff3d71'/%3E%3C/svg%3E') 14 14, crosshair" }}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
                        <defs>
                            {/* Area Gradient A */}
                            <linearGradient id="duelGradA" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--hot)" stopOpacity="0.25" />
                                <stop offset="100%" stopColor="var(--hot)" stopOpacity="0.0" />
                            </linearGradient>

                            {/* Area Gradient B */}
                            <linearGradient id="duelGradB" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--cool)" stopOpacity="0.25" />
                                <stop offset="100%" stopColor="var(--cool)" stopOpacity="0.0" />
                            </linearGradient>

                            {/* Neon Glow Filters */}
                            <filter id="neonGlowA" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                            <filter id="neonGlowB" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        
                            {/* Laser Scanner Glow */}
                            <filter id="laserGlow" x="-30%" y="-30%" width="160%" height="160%">
                                <feGaussianBlur stdDeviation="2" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>

                        {/* Subtle Gridlines & Clean Y-Axis Percentage Labels */}
                        {gainTicks.map((tick) => {
                            const y = getY(tick)
                            return (
                                <g key={tick}>
                                    <line
                                        x1={paddingLeft}
                                        y1={y}
                                        x2={svgWidth - paddingRight}
                                        y2={y}
                                        stroke="var(--line)"
                                        strokeDasharray={tick === 0 ? "none" : "2 3"}
                                        strokeWidth={tick === 0 ? "1.5" : "1"}
                                    />
                                    <text
                                        x={paddingLeft - 8}
                                        y={y + 3.5}
                                        textAnchor="end"
                                        fill={tick === 0 ? "var(--txt)" : "var(--faint)"}
                                        className="font-mono text-[9px]"
                                    >
                                        {formatAxisGain(tick)}
                                    </text>
                                </g>
                            )
                        })}

                        {/* 0.0% Baseline Reference Indicator */}
                        <line
                            x1={paddingLeft}
                            y1={zeroY}
                            x2={svgWidth - paddingRight}
                            y2={zeroY}
                            stroke="rgba(255,255,255,0.4)"
                            strokeWidth="1.2"
                        />
                        <text
                            x={svgWidth - paddingRight + 4}
                            y={zeroY + 3.5}
                            fill="var(--dim)"
                            className="font-mono text-[8px]"
                        >
                            0.0%
                        </text>

                        {/* Sustained Peak Reference Lines */}
                        {peakA >= 0.5 && (
                            <g>
                                <line
                                    x1={paddingLeft}
                                    y1={getY(peakA)}
                                    x2={svgWidth - paddingRight}
                                    y2={getY(peakA)}
                                    stroke="var(--hot)"
                                    strokeDasharray="4 4"
                                    strokeOpacity="0.4"
                                    strokeWidth="1"
                                />
                                <text
                                    x={svgWidth - paddingRight - 6}
                                    y={getY(peakA) - 4}
                                    textAnchor="end"
                                    fill="var(--hot)"
                                    className="font-mono text-[7px]"
                                >
                                    {duel.tokenA.symbol} PEAK: +{peakA.toFixed(1)}%
                                </text>
                            </g>
                        )}

                        {peakB >= 0.5 && (
                            <g>
                                <line
                                    x1={paddingLeft}
                                    y1={getY(peakB)}
                                    x2={svgWidth - paddingRight}
                                    y2={getY(peakB)}
                                    stroke="var(--cool)"
                                    strokeDasharray="4 4"
                                    strokeOpacity="0.4"
                                    strokeWidth="1"
                                />
                                <text
                                    x={svgWidth - paddingRight - 6}
                                    y={getY(peakB) - 4}
                                    textAnchor="end"
                                    fill="var(--cool)"
                                    className="font-mono text-[7px]"
                                >
                                    {duel.tokenB.symbol} PEAK: +{peakB.toFixed(1)}%
                                </text>
                            </g>
                        )}

                        {/* Clean X-Axis Time Ticks */}
                        {xTicks.map(({ sec, label }) => {
                            const x = getX(sec)
                            return (
                                <g key={sec}>
                                    <line
                                        x1={x}
                                        y1={svgHeight - paddingBottom}
                                        x2={x}
                                        y2={svgHeight - paddingBottom + 4}
                                        stroke="var(--line)"
                                        strokeWidth="1"
                                    />
                                    <text
                                        x={x}
                                        y={svgHeight - paddingBottom + 16}
                                        textAnchor="middle"
                                        fill="var(--faint)"
                                        className="font-mono text-[9px]"
                                    >
                                        {label}
                                    </text>
                                </g>
                            )
                        })}

                        {/* Shaded Areas */}
                        {areaA && <path d={areaA} fill="url(#duelGradA)" />}
                        {areaB && <path d={areaB} fill="url(#duelGradB)" />}

                        {/* Performance Lines */}
                        {pathA && (
                            <path
                                d={pathA}
                                fill="none"
                                stroke="var(--hot)"
                                strokeWidth="2.5"
                                filter="url(#neonGlowA)"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        )}
                        {pathB && (
                            <path
                                d={pathB}
                                fill="none"
                                stroke="var(--cool)"
                                strokeWidth="2.5"
                                filter="url(#neonGlowB)"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        )}

                        {/* Live Pulsing Nodes on Latest Ticks (Native SVG pulse, no CSS transform drift) */}
                        {lastPoint && (
                            <g>
                                {/* Token A Lead Pulse */}
                                <circle
                                    cx={getX(lastPoint.timeSec)}
                                    cy={getY(lastPoint.gainA)}
                                    r="4.5"
                                    fill="var(--hot)"
                                    stroke="#ffffff"
                                    strokeWidth="1"
                                    filter="url(#neonGlowA)"
                                />
                                <circle
                                    cx={getX(lastPoint.timeSec)}
                                    cy={getY(lastPoint.gainA)}
                                    r="4.5"
                                    fill="none"
                                    stroke="var(--hot)"
                                    strokeWidth="1.5"
                                >
                                    <animate attributeName="r" values="4.5;13" dur="1.8s" repeatCount="indefinite" />
                                    <animate attributeName="opacity" values="0.8;0" dur="1.8s" repeatCount="indefinite" />
                                </circle>

                                {/* Token B Lead Pulse */}
                                <circle
                                    cx={getX(lastPoint.timeSec)}
                                    cy={getY(lastPoint.gainB)}
                                    r="4.5"
                                    fill="var(--cool)"
                                    stroke="#ffffff"
                                    strokeWidth="1"
                                    filter="url(#neonGlowB)"
                                />
                                <circle
                                    cx={getX(lastPoint.timeSec)}
                                    cy={getY(lastPoint.gainB)}
                                    r="4.5"
                                    fill="none"
                                    stroke="var(--cool)"
                                    strokeWidth="1.5"
                                >
                                    <animate attributeName="r" values="4.5;13" dur="1.8s" repeatCount="indefinite" />
                                    <animate attributeName="opacity" values="0.8;0" dur="1.8s" repeatCount="indefinite" />
                                </circle>
                            </g>
                        )}

                        {/* Fun Cyber Laser Scanner & Dual Lock-On Reticles */}
                        {hoverX !== null && hoverPoint && (
                            <g className="pointer-events-none">
                                {/* Vertical Neon Scanning Laser */}
                                <line
                                    x1={hoverX}
                                    y1={paddingTop}
                                    x2={hoverX}
                                    y2={svgHeight - paddingBottom}
                                    stroke="var(--acid)"
                                    strokeWidth="1.5"
                                    strokeDasharray="4 2"
                                    opacity="0.85"
                                    filter="url(#laserGlow)"
                                />

                                {/* Top HUD Tracking Bead */}
                                <g transform={`translate(${hoverX}, ${paddingTop - 12})`}>
                                    <rect x="-30" y="-8" width="60" height="15" fill="var(--s0)" stroke="var(--acid)" strokeWidth="1" rx="2" />
                                    <text x="0" y="3" textAnchor="middle" fill="var(--acid)" className="font-mono text-[8px] font-bold tracking-wider">
                                        ⌖ LOCK
                                    </text>
                                </g>

                                {/* Token A Lock-on Reticle (Hot Pink) */}
                                <g transform={`translate(${hoverX}, ${getY(hoverPoint.gainA)})`}>
                                    <path
                                        d="M -9 -4 L -9 -9 L -4 -9  M 4 -9 L 9 -9 L 9 -4  M 9 4 L 9 9 L 4 9  M -4 9 L -9 9 L -9 4"
                                        fill="none"
                                        stroke="var(--hot)"
                                        strokeWidth="1.5"
                                        strokeLinecap="square"
                                        filter="url(#neonGlowA)"
                                    />
                                    <circle r="2.5" fill="var(--hot)" stroke="#ffffff" strokeWidth="0.8" />
                                </g>

                                {/* Token B Lock-on Reticle (Cool Cyan) */}
                                <g transform={`translate(${hoverX}, ${getY(hoverPoint.gainB)})`}>
                                    <path
                                        d="M -9 -4 L -9 -9 L -4 -9  M 4 -9 L 9 -9 L 9 -4  M 9 4 L 9 9 L 4 9  M -4 9 L -9 9 L -9 4"
                                        fill="none"
                                        stroke="var(--cool)"
                                        strokeWidth="1.5"
                                        strokeLinecap="square"
                                        filter="url(#neonGlowB)"
                                    />
                                    <circle r="2.5" fill="var(--cool)" stroke="#ffffff" strokeWidth="0.8" />
                                </g>
                            </g>
                        )}
                    </svg>

                    {/* Floating Arcade Tooltip */}
                    {hoverPoint && hoverX !== null && (
                        <div
                            className="absolute top-8 pointer-events-none z-20 p-2.5 bg-[var(--s0)] border border-[var(--line-2)] shadow-[0_4px_16px_rgba(0,0,0,0.8)] font-mono text-[10px] space-y-1 transition-all"
                            style={{
                                left: Math.min(Math.max(hoverX - 70, 75), svgWidth - 180),
                            }}
                        >
                            <div className="text-[var(--faint)] border-b border-[var(--line)] pb-1 flex justify-between gap-4">
                                <span>T+{Math.floor(hoverPoint.timeSec / 60)}m {hoverPoint.timeSec % 60}s</span>
                                <span className="text-[var(--acid)] text-[8px] utd-pixel">⌖ TARGET LOCKED</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 text-[var(--hot)]">
                                <span>{duel.tokenA.symbol}:</span>
                                <span className="font-bold">
                                    {hoverPoint.gainA >= 0 ? "+" : ""}{hoverPoint.gainA.toFixed(2)}% ({formatUsd(hoverPoint.mcA)})
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-4 text-[var(--cool)]">
                                <span>{duel.tokenB.symbol}:</span>
                                <span className="font-bold">
                                    {hoverPoint.gainB >= 0 ? "+" : ""}{hoverPoint.gainB.toFixed(2)}% ({formatUsd(hoverPoint.mcB)})
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: Token A DexScreener Candlestick Frame */}
            {activeTab === "tokenA" && (
                <div className="relative w-full aspect-[16/9] min-h-[380px] bg-[var(--s0)] border border-[var(--line)] overflow-hidden">
                    <iframe
                        src={`https://dexscreener.com/${CHAIN_ID}/${duel.tokenA.tokenAddress}?embed=1&theme=dark&trades=0&info=0`}
                        title={`${duel.tokenA.symbol} DexScreener Chart`}
                        className="w-full h-full border-0"
                        loading="lazy"
                    />
                </div>
            )}

            {/* TAB 3: Token B DexScreener Candlestick Frame */}
            {activeTab === "tokenB" && (
                <div className="relative w-full aspect-[16/9] min-h-[380px] bg-[var(--s0)] border border-[var(--line)] overflow-hidden">
                    <iframe
                        src={`https://dexscreener.com/${CHAIN_ID}/${duel.tokenB.tokenAddress}?embed=1&theme=dark&trades=0&info=0`}
                        title={`${duel.tokenB.symbol} DexScreener Chart`}
                        className="w-full h-full border-0"
                        loading="lazy"
                    />
                </div>
            )}
        </div>
    )
}
