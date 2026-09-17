"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ShieldCheck, Trophy, Swords, Twitter } from "lucide-react"
import { toast } from "sonner"
import { useWallet } from "@/hooks/useWallet"
import { cancelDuelOnChain, expireDuelOnChain, settleDuelOnChain } from "@/lib/duelContract"
import { SideTag } from "../../components/duel/SideTag"
import { DuelDTO, formatUsd, pctReturn } from "../../components/duel/types"

function buildShareIntent(duel: DuelDTO, myResult: "won" | "lost" | null): string {
    const winnerSymbol = duel.winnerSide === 0 ? duel.tokenA.symbol : duel.tokenB.symbol
    const loserSymbol = duel.winnerSide === 0 ? duel.tokenB.symbol : duel.tokenA.symbol
    const text =
        myResult === "won"
            ? `I just won a duel on Underground Token Duel. ${winnerSymbol} beat ${loserSymbol} and earned me ${duel.winnerPoints} pts.`
            : myResult === "lost"
              ? `Just battled it out on Underground Token Duel. ${winnerSymbol} beat ${loserSymbol} in my duel.`
              : `${winnerSymbol} beat ${loserSymbol} in today's Underground Token Duel arena.`
    const url = typeof window !== "undefined" ? `${window.location.origin}/duels/${duel._id}` : ""
    return `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url }).toString()}`
}

function useCountdown(target?: string) {
    const [remaining, setRemaining] = useState(0)
    useEffect(() => {
        if (!target) return
        const tick = () => setRemaining(Math.max(0, new Date(target).getTime() - Date.now()))
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [target])
    const totalSec = Math.floor(remaining / 1000)
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0")
    const ss = String(totalSec % 60).padStart(2, "0")
    return { label: `${mm}:${ss}`, totalSec }
}

export default function DuelDetailPage() {
    const params = useParams<{ id: string }>()
    const { address } = useWallet()
    const [duel, setDuel] = useState<DuelDTO | null>(null)
    const [cancelling, setCancelling] = useState(false)
    const [reclaiming, setReclaiming] = useState(false)
    const [claiming, setClaiming] = useState(false)

    const load = useCallback(async () => {
        const res = await fetch(`/api/duels/${params.id}`)
        const json = await res.json()
        if (json.success) setDuel(json.data)
    }, [params.id])

    useEffect(() => {
        load()
        const id = setInterval(load, 3000)
        return () => clearInterval(id)
    }, [load])

    async function handleCancel() {
        if (!duel || !address) return
        setCancelling(true)
        try {
            let txHash: string | undefined
            if (duel.escrowAddress) {
                txHash = await cancelDuelOnChain(duel.escrowAddress as `0x${string}`)
            }
            const res = await fetch(`/api/duels/${duel._id}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ wallet: address, txHash }),
            })
            const json = await res.json()
            if (!json.success) toast.error(json.error)
            else {
                toast.success("Lobby cancelled. Your stake was refunded.")
                setDuel(json.data)
            }
        } catch (err) {
            toast.error((err as Error).message || "Something went wrong cancelling the lobby.")
        } finally {
            setCancelling(false)
        }
    }

    /** Permissionless on the real contract -- anyone can trigger reclaiming the creator's stake once the open window passes. */
    async function handleReclaim() {
        if (!duel) return
        setReclaiming(true)
        try {
            let txHash: string | undefined
            if (duel.escrowAddress) {
                txHash = await expireDuelOnChain(duel.escrowAddress as `0x${string}`)
            }
            const res = await fetch(`/api/duels/${duel._id}/expire`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ txHash }),
            })
            const json = await res.json()
            if (!json.success) toast.error(json.error)
            else {
                toast.success("Lobby expired. The creator's stake was refunded.")
                setDuel(json.data)
            }
        } catch (err) {
            toast.error((err as Error).message || "Something went wrong reclaiming the stake.")
        } finally {
            setReclaiming(false)
        }
    }

    /** Permissionless on the real contract -- anyone holding the oracle's signature can submit it. */
    async function handleClaimSettlement() {
        if (!duel || duel.winnerSide === undefined || !duel.oracleSignature) return
        setClaiming(true)
        try {
            const txHash = await settleDuelOnChain(
                duel.escrowAddress as `0x${string}`,
                duel.winnerSide,
                duel.oracleSignature as `0x${string}`
            )
            const res = await fetch(`/api/duels/${duel._id}/confirm-settlement`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ txHash }),
            })
            const json = await res.json()
            if (!json.success) toast.error(json.error)
            else {
                toast.success("Settled. Funds have moved.")
                setDuel(json.data)
            }
        } catch (err) {
            toast.error((err as Error).message || "Something went wrong settling the duel.")
        } finally {
            setClaiming(false)
        }
    }

    const openCountdown = useCountdown(duel?.status === "OPEN" ? duel.openDeadline : undefined)
    const liveCountdown = useCountdown(duel?.status === "LIVE" ? duel.endTime : undefined)

    if (!duel) {
        return (
            <div className="mx-auto max-w-4xl space-y-6">
                <Skeleton className="mx-auto h-12 w-40 rounded-none" />
                <div className="grid gap-6 md:grid-cols-2">
                    <Skeleton className="h-64 rounded-none" />
                    <Skeleton className="h-64 rounded-none" />
                </div>
            </div>
        )
    }

    const isCreator = address?.toLowerCase() === duel.creatorWallet.toLowerCase()
    const isOpponent = address?.toLowerCase() === duel.opponentWallet?.toLowerCase()
    const myWallet = isCreator || isOpponent

    if (duel.status === "OPEN") {
        const urgent = openCountdown.totalSec < 300
        const deadlinePassed = openCountdown.totalSec <= 0
        return (
            <div className="animate-in fade-in duration-500 mx-auto max-w-xl pt-6">
                <Card className="text-center">
                    <CardContent className="space-y-6 pt-8">
                        <div className="flex items-center justify-center gap-3">
                            <SideTag side="A" label={duel.tokenA.symbol} />
                            <span className="text-muted-foreground">vs</span>
                            <SideTag side="B" label={duel.tokenB.symbol} />
                        </div>
                        <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                {deadlinePassed ? "Lobby expired" : "Waiting for an opponent"}
                            </div>
                            <div className={`tabular mt-2 text-4xl font-extrabold glow-text ${urgent ? "text-destructive" : "text-primary"}`}>
                                {openCountdown.label}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                {deadlinePassed ? "no one joined in time" : "lobby expires if no one joins"}
                            </div>
                        </div>
                        <div className="flex justify-center gap-6 text-sm">
                            <div>
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Buy-in</div>
                                <div className="tabular font-semibold">${duel.buyInUsd}</div>
                            </div>
                            <div>
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Duration</div>
                                <div className="tabular font-semibold">{Math.round(duel.durationSeconds / 60)} min</div>
                            </div>
                        </div>
                        {deadlinePassed ? (
                            <Button variant="outline" disabled={reclaiming} onClick={handleReclaim}>
                                {reclaiming ? "Reclaiming…" : "Reclaim Stake"}
                            </Button>
                        ) : isCreator ? (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="outline" disabled={cancelling}>
                                        {cancelling ? "Cancelling…" : "Cancel Lobby"}
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Cancel Lobby?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Your stake will be fully refunded. This cannot be undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Never Mind</AlertDialogCancel>
                                        <AlertDialogAction onClick={handleCancel}>Cancel Lobby</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        ) : (
                            <p className="text-xs text-muted-foreground">Head to the home page to join this lobby.</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (duel.status === "EXPIRED" || duel.status === "CANCELLED") {
        return (
            <div className="animate-in fade-in duration-500 mx-auto max-w-xl pt-6 text-center">
                <Card>
                    <CardContent className="space-y-2 pt-8">
                        <p className="text-lg font-bold">{duel.status === "EXPIRED" ? "This lobby expired" : "This lobby was cancelled"}</p>
                        <p className="text-sm text-muted-foreground">The creator's stake was fully refunded.</p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    // LIVE, SETTLING, HELD, or SETTLED -- all share the battle view, frozen at final numbers once settled.
    const gainA = pctReturn(duel.tokenA.startMarketCapUsd, duel.tokenA.sustainedPeakMarketCapUsd)
    const gainB = pctReturn(duel.tokenB.startMarketCapUsd, duel.tokenB.sustainedPeakMarketCapUsd)
    const leading = gainA >= gainB ? "A" : "B"
    const settled = duel.status === "SETTLED"
    const settling = duel.status === "SETTLING"
    const held = duel.status === "HELD"
    const mySide: 0 | 1 | undefined = isCreator ? duel.creatorSide : isOpponent ? (duel.creatorSide === 0 ? 1 : 0) : undefined
    const myResult = (settled || settling) && mySide !== undefined ? (duel.winnerSide === mySide ? "won" : "lost") : null

    return (
        <div className="animate-in fade-in duration-500 mx-auto max-w-4xl space-y-6 pt-4">
            <div className="text-center">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {settled || settling ? "Final Result" : held ? "Under Review" : "Time Remaining"}
                </div>
                <div className="tabular mt-1 text-5xl font-extrabold tracking-wider text-primary glow-text">
                    {settled || settling ? "DONE" : held ? "HELD" : liveCountdown.label}
                </div>
            </div>

            {held && (
                <Card className="text-center">
                    <CardContent className="space-y-2 pt-6">
                        <div className="flex items-center justify-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-destructive" />
                            <p className="text-lg font-bold text-destructive">Match flagged for review</p>
                        </div>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            Both wallets in this duel were seen from the same network, a possible sign of one person
                            controlling both sides. Settlement is paused until a human reviews it.
                        </p>
                    </CardContent>
                </Card>
            )}

            {settling && (
                <Card className="text-center">
                    <CardContent className="space-y-2 pt-6">
                        <div className="flex items-center justify-center gap-2">
                            <Trophy className="h-5 w-5 text-[hsl(var(--good))]" />
                            <p className="text-lg font-bold text-[hsl(var(--good))]">
                                {duel.winnerSide === 0 ? duel.tokenA.symbol : duel.tokenB.symbol} wins. Ready to claim.
                            </p>
                        </div>
                        <p className="mx-auto max-w-md text-sm text-muted-foreground">
                            The result is final. Anyone can submit it on-chain to release the pot, no fee, no advantage
                            to going first.
                        </p>
                        <Button disabled={claiming} onClick={handleClaimSettlement} className="mt-2">
                            {claiming ? "Confirm In Wallet…" : "Claim Result"}
                        </Button>
                    </CardContent>
                </Card>
            )}

            <div className="grid items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
                <BattlePanel
                    side="A"
                    symbol={duel.tokenA.symbol}
                    startMc={duel.tokenA.startMarketCapUsd}
                    gainPct={gainA}
                    leading={leading === "A"}
                    peak={duel.tokenA.sustainedPeakMarketCapUsd}
                    won={(settled || settling) && duel.winnerSide === 0}
                    isYours={myWallet && (isCreator ? duel.creatorSide === 0 : duel.creatorSide === 1)}
                />
                <div className="flex flex-col items-center gap-1 py-4 md:py-0">
                    <Swords className="h-5 w-5 text-primary/60" />
                    <div className="text-3xl font-extrabold text-primary" style={{ textShadow: "3px 3px 0 hsl(var(--primary) / 0.25)" }}>
                        VS
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Pot</div>
                    <div className="tabular text-sm font-bold">${duel.buyInUsd * 2}</div>
                </div>
                <BattlePanel
                    side="B"
                    symbol={duel.tokenB.symbol}
                    startMc={duel.tokenB.startMarketCapUsd}
                    gainPct={gainB}
                    leading={leading === "B"}
                    peak={duel.tokenB.sustainedPeakMarketCapUsd}
                    won={(settled || settling) && duel.winnerSide === 1}
                    isYours={myWallet && (isCreator ? duel.creatorSide === 1 : duel.creatorSide === 0)}
                />
            </div>

            {settled && (
                <Card className="text-center">
                    <CardContent className="space-y-2 pt-6">
                        <div className="flex items-center justify-center gap-2">
                            <Trophy className="h-5 w-5 text-[hsl(var(--good))]" />
                            <p className="text-lg font-bold text-[hsl(var(--good))]">
                                {duel.winnerSide === 0 ? duel.tokenA.symbol : duel.tokenB.symbol} wins the duel
                            </p>
                        </div>
                        {myResult && (
                            <p className={`text-sm font-semibold ${myResult === "won" ? "text-[hsl(var(--good))]" : "text-muted-foreground"}`}>
                                You {myResult} this duel
                            </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                            Winner earned {duel.winnerPoints} pts · Loser earned {duel.loserPoints} pts
                        </p>
                        <a href={buildShareIntent(duel, myResult)} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="mt-2 gap-1.5">
                                <Twitter className="h-3.5 w-3.5" />
                                Share on X
                            </Button>
                        </a>
                    </CardContent>
                </Card>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Market caps tracked live from Robinhood Chain, validated through the liquidity-weighted median, liquidity-depth gate, TWAP, and sustained-peak oracle pipeline.
            </div>
        </div>
    )
}

function BattlePanel({
    side,
    symbol,
    startMc,
    gainPct,
    leading,
    peak,
    won,
    isYours,
}: {
    side: "A" | "B"
    symbol: string
    startMc: number
    gainPct: number
    leading: boolean
    peak: number
    won: boolean
    isYours?: boolean
}) {
    const barPct = Math.max(4, Math.min(100, 50 + gainPct))
    const sideColor = side === "A" ? "var(--side-a)" : "var(--side-b)"
    return (
        <Card
            className={`cyber-gradient side-${side.toLowerCase()} relative overflow-hidden ${won ? "glow-pulse" : ""}`}
            style={won ? { color: `hsl(${sideColor})` } : undefined}
        >
            {isYours && (
                <div className="absolute right-0 top-0 border-b-2 border-l-2 border-border bg-background px-2 py-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                    Your side
                </div>
            )}
            <CardContent className="space-y-4 pt-6">
                <div className="flex items-center justify-between">
                    <SideTag side={side} label={symbol} />
                    {won ? (
                        <span className="flex items-center gap-1 text-xs font-bold text-[hsl(var(--good))]">
                            <Trophy className="h-3.5 w-3.5" /> Winner
                        </span>
                    ) : leading ? (
                        <span className="text-xs text-[hsl(var(--good))]">● leading</span>
                    ) : (
                        <span className="text-xs text-muted-foreground">trailing</span>
                    )}
                </div>
                <div className="flex items-end gap-4">
                    <div className="relative h-40 w-10 flex-none border-2 border-foreground/60 bg-background/40">
                        <div
                            className="absolute bottom-0 left-0 right-0 transition-all duration-700 ease-out"
                            style={{ height: `${barPct}%`, backgroundColor: `hsl(${sideColor})` }}
                        />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Starting MC</div>
                        <div className="tabular text-sm font-semibold">{formatUsd(startMc)}</div>
                        <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">Validated Gain</div>
                        <div className={`tabular text-2xl font-extrabold ${gainPct >= 0 ? "text-[hsl(var(--good))]" : "text-destructive"}`}>
                            {gainPct >= 0 ? "+" : ""}
                            {gainPct.toFixed(1)}%
                        </div>
                    </div>
                </div>
                <div className="pixel-flat border-2 border-border bg-background/40 px-2 py-1.5 text-[10px] text-muted-foreground">
                    Sustained peak: <span className="tabular">{formatUsd(peak)}</span>
                </div>
            </CardContent>
        </Card>
    )
}
