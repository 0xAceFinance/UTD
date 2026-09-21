"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Slider } from "@/components/ui/slider"
import { toast } from "sonner"
import { useWallet } from "@/hooks/useWallet"
import { createDuelOnChain } from "@/lib/duelContract"
import { getFriendlyErrorMessage } from "@/lib/walletErrors"
import { getStoredRef } from "@/lib/referralClient"
import { useFactoryState } from "@/hooks/useFactoryState"
import { DuelTokenDTO } from "../../components/duel/types"
import { PausedBanner } from "../../components/duel/PausedBanner"

const QUICK_BUY_INS = [25, 50, 100, 250]

export default function CreateDuelPage() {
    const router = useRouter()
    const { address, connected } = useWallet()

    const [tokens, setTokens] = useState<DuelTokenDTO[]>([])
    const [tokensLoading, setTokensLoading] = useState(true)
    const [tokenA, setTokenA] = useState<string | null>(null)
    const [tokenB, setTokenB] = useState<string | null>(null)
    const [side, setSide] = useState<0 | 1>(0)
    const [buyIn, setBuyIn] = useState(100)
    const [duration, setDuration] = useState(10)
    const [submitting, setSubmitting] = useState(false)
    const [stage, setStage] = useState<"idle" | "wallet" | "saving">("idle")
    const factory = useFactoryState()

    useEffect(() => {
        const load = () =>
            fetch("/api/duel-tokens")
                .then((r) => r.json())
                .then((json) => {
                    if (json.success) setTokens(json.data)
                })
                .finally(() => setTokensLoading(false))

        load()
        // Re-prices server-side every ~20s; poll so the picker's ranks/#s stay
        // current without disturbing tokenA/tokenB (keyed by symbol, not index).
        const id = setInterval(load, 20_000)
        return () => clearInterval(id)
    }, [])

    function pickToken(symbol: string) {
        if (tokenA === symbol) {
            setTokenA(null)
            return
        }
        if (tokenB === symbol) {
            setTokenB(null)
            return
        }
        if (!tokenA) setTokenA(symbol)
        else if (!tokenB) setTokenB(symbol)
        else toast.info("Deselect a token first to swap it out.")
    }

    const bothPicked = Boolean(tokenA && tokenB)
    const paused = factory?.paused ?? false
    const belowMin = factory !== null && buyIn < factory.minBuyInUsd
    const aboveMax = factory !== null && factory.maxBuyInUsd !== null && buyIn > factory.maxBuyInUsd
    const canSubmit = connected && bothPicked && buyIn > 0 && !belowMin && !aboveMax && !paused && factory !== null && !submitting
    const pot = buyIn * 2
    const winAmount = Math.round(pot * 0.9)

    async function handleSubmit() {
        if (!address || !tokenA || !tokenB) return
        setSubmitting(true)
        try {
            const precheck = await fetch(`/api/duels/precheck?wallet=${address}`).then((r) => r.json())
            if (!precheck.success) {
                toast.error(precheck.error ?? "Could not create a duel right now.")
                return
            }

            setStage("wallet")
            toast.info("Confirm the approval and creation transactions in your wallet.")
            const txHash = await createDuelOnChain({
                creator: address as `0x${string}`,
                buyInUsd: buyIn,
                creatorSide: side,
                durationSeconds: duration * 60,
                tokenASymbol: tokenA,
                tokenBSymbol: tokenB,
            })

            setStage("saving")
            // Snapshot the exact token data the picker showed for this pair --
            // the on-chain tx above already locked funds against tokenA/tokenB
            // as strings, so registration below must not depend on the Top 10
            // list still looking the same by the time this request lands (a
            // scan can rotate it out from under an in-flight tx). See
            // app/api/duels/route.ts for how this snapshot is used as a
            // fallback when the live lookup misses.
            const tokenASnapshot = tokens.find((t) => t.symbol === tokenA)
            const tokenBSnapshot = tokens.find((t) => t.symbol === tokenB)
            const res = await fetch("/api/duels", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    creatorWallet: address,
                    tokenASymbol: tokenA,
                    tokenBSymbol: tokenB,
                    tokenASnapshot,
                    tokenBSnapshot,
                    txHash,
                    refCode: getStoredRef(),
                }),
            })
            const json = await res.json()
            if (!json.success) {
                toast.error(json.error ?? "Could not create the duel.")
                return
            }
            toast.success("Lobby created. Waiting for an opponent.")
            router.push(`/duels/${json.data._id}`)
        } catch (err) {
            toast.error(getFriendlyErrorMessage(err, "Something went wrong creating the duel."))
        } finally {
            setSubmitting(false)
            setStage("idle")
        }
    }

    return (
        <div className="mx-auto max-w-2xl space-y-7">
            {/* The top bar already says NEW DUEL; this is just the one-line brief. */}
            {paused && <PausedBanner />}
            <p className="text-[14px] text-[var(--dim)]">
                Pick two tokens, set a stake and a round length. It goes live once someone accepts.
            </p>

            {/* Step 1: Pick Tokens */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="app-section-label">1 · Tokens</h2>
                    <span className="font-mono text-xs text-[var(--faint)]">
                        {tokenA && tokenB ? "Both selected" : tokenA ? "Select 1 more" : "Select 2"}
                    </span>
                </div>

                {tokensLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-[var(--line)]">
                        {Array.from({ length: 10 }).map((_, i) => (
                            <div key={i} className="h-16 bg-[var(--s1)] animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-[var(--line)]">
                        {tokens.map((t) => {
                            const isA = tokenA === t.symbol
                            const isB = tokenB === t.symbol

                            return (
                                <button
                                    key={t._id}
                                    onClick={() => pickToken(t.symbol)}
                                    className={`p-3 text-left transition-colors ${
                                        isA
                                            ? "bg-[var(--s2)] ring-1 ring-inset ring-[var(--hot)]"
                                            : isB
                                              ? "bg-[var(--s2)] ring-1 ring-inset ring-[var(--cool)]"
                                              : "bg-[var(--s1)] hover:bg-[var(--s2)]"
                                    }`}
                                >
                                    <div className="utd-pixel text-xs text-white">{t.symbol}</div>
                                    <div className="utd-body text-[11px] text-[var(--faint)] truncate mt-0.5">
                                        {t.name}
                                    </div>
                                    <div className="mt-2 font-mono text-[10px]">
                                        {isA && <span className="text-[var(--hot)] font-semibold">Side A</span>}
                                        {isB && <span className="text-[var(--cool)] font-semibold">Side B</span>}
                                        {!isA && !isB && <span className="text-[var(--faint)]">#{t.rank}</span>}
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Step 2: Choose Side */}
            <div className="space-y-3">
                <h2 className="app-section-label">2 · Your side</h2>

                <div className="grid grid-cols-2 gap-2 sm:gap-4">
                    <button
                        disabled={!tokenA}
                        onClick={() => setSide(0)}
                        className={`p-4 sm:p-5 text-left border transition-all ${
                            side === 0 && tokenA
                                ? "border-[var(--hot)] bg-[var(--s1)]"
                                : "border-[var(--line)] bg-[var(--s1)] opacity-70 hover:opacity-100"
                        }`}
                    >
                        <div className="font-mono text-xs text-[var(--hot)]">SIDE A</div>
                        <div className="utd-pixel text-lg text-white mt-2">{tokenA ?? "—"}</div>
                        <div className="utd-body text-xs text-[var(--faint)] mt-1">You win if Token A climbs higher</div>
                    </button>

                    <button
                        disabled={!tokenB}
                        onClick={() => setSide(1)}
                        className={`p-4 sm:p-5 text-left border transition-all ${
                            side === 1 && tokenB
                                ? "border-[var(--cool)] bg-[var(--s1)]"
                                : "border-[var(--line)] bg-[var(--s1)] opacity-70 hover:opacity-100"
                        }`}
                    >
                        <div className="font-mono text-xs text-[var(--cool)]">SIDE B</div>
                        <div className="utd-pixel text-lg text-white mt-2">{tokenB ?? "—"}</div>
                        <div className="utd-body text-xs text-[var(--faint)] mt-1">You win if Token B climbs higher</div>
                    </button>
                </div>
            </div>

            {/* Step 3: Stake */}
            <div className="space-y-3">
                <h2 className="app-section-label">3 · Stake</h2>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-[var(--faint)]">$</span>
                        <input
                            type="number"
                            min={factory?.minBuyInUsd ?? 1}
                            max={factory?.maxBuyInUsd ?? undefined}
                            value={buyIn}
                            onChange={(e) => setBuyIn(Number(e.target.value))}
                            inputMode="numeric"
                            className="h-11 w-32 bg-[var(--s1)] border border-[var(--line)] pl-7 pr-3 text-base font-mono text-white focus:border-[var(--acid)] focus:outline-none"
                        />
                    </div>

                    <div className="flex gap-px bg-[var(--line)]">
                        {QUICK_BUY_INS.filter(
                            (v) => (!factory || v >= factory.minBuyInUsd) && (!factory?.maxBuyInUsd || v <= factory.maxBuyInUsd)
                        ).map((v) => (
                            <button
                                key={v}
                                onClick={() => setBuyIn(v)}
                                className={`h-11 px-3.5 font-mono text-[13px] transition-colors ${
                                    buyIn === v
                                        ? "bg-[var(--acid)] text-[var(--acid-ink)]"
                                        : "bg-[var(--s1)] text-[var(--dim)] hover:bg-[var(--s2)] hover:text-white"
                                }`}
                            >
                                ${v}
                            </button>
                        ))}
                    </div>
                </div>
                {factory && (
                    <p className={`font-mono text-xs ${belowMin || aboveMax ? "text-[var(--hot)]" : "text-[var(--faint)]"}`}>
                        Buy-in range: ${factory.minBuyInUsd}
                        {factory.maxBuyInUsd !== null ? ` – $${factory.maxBuyInUsd}` : "+"}
                    </p>
                )}
            </div>

            {/* Step 4: Duration */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="app-section-label">4 · Round length</h2>
                    <span className="font-mono text-sm text-[var(--acid)]">{duration} min</span>
                </div>

                <div className="border border-[var(--line)] bg-[var(--s1)] p-5 space-y-4">
                    <Slider
                        min={5}
                        max={20}
                        step={5}
                        value={[duration]}
                        onValueChange={([v]) => setDuration(v)}
                    />
                    <div className="flex justify-between font-mono text-xs text-[var(--faint)]">
                        <span>5m (fast)</span>
                        <span>10m (standard)</span>
                        <span>20m (extended)</span>
                    </div>
                </div>
            </div>

            {/* Summary & submit. Sticky so the action is always in reach on a
                phone; it parks just above the bottom tab bar there. */}
            <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 border border-[var(--line-2)] bg-[var(--s1)]/95 backdrop-blur p-4 flex items-center justify-between gap-4 lg:bottom-4 sm:p-5">
                <div className="flex items-center gap-5 font-mono text-xs sm:gap-8">
                    <div>
                        <div className="text-[var(--faint)]">Total Pot</div>
                        <div className="text-white text-base font-semibold mt-0.5">${pot}</div>
                    </div>
                    <div>
                        <div className="text-[var(--acid)]">Winner (90%)</div>
                        <div className="text-[var(--acid)] text-base font-semibold mt-0.5">${winAmount}</div>
                    </div>
                </div>

                <button
                    disabled={!canSubmit}
                    onClick={handleSubmit}
                    className="utd-btn h-11 flex-none px-4 text-[9px] sm:px-6"
                >
                    {!connected
                        ? "CONNECT FIRST"
                        : paused
                          ? "PAUSED"
                          : stage === "wallet"
                          ? "CONFIRM IN WALLET…"
                          : stage === "saving"
                            ? "CREATING…"
                            : "CREATE"}
                </button>
            </div>
        </div>
    )
}
