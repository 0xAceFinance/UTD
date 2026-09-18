"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
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
import { ShieldCheck, Trophy, Twitter, AlertTriangle, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { useWallet } from "@/hooks/useWallet"
import {
    cancelDuelOnChain,
    expireDuelOnChain,
    settleDuelOnChain,
    refundStaleDuelOnChain,
    readOwed,
    withdrawOwedOnChain,
} from "@/lib/duelContract"
import { SideTag } from "../../components/duel/SideTag"
import { DuelDTO, canForceRefund, formatUsd, pctReturn } from "../../components/duel/types"

function buildShareIntent(duel: DuelDTO, myResult: "won" | "lost" | null): string {
    const winnerSymbol = duel.winnerSide === 0 ? duel.tokenA.symbol : duel.tokenB.symbol
    const loserSymbol = duel.winnerSide === 0 ? duel.tokenB.symbol : duel.tokenA.symbol
    const text =
        myResult === "won"
            ? `I won my duel on @mcapduel. ${winnerSymbol} outperformed ${loserSymbol}.`
            : myResult === "lost"
              ? `Battled on @mcapduel. ${winnerSymbol} vs ${loserSymbol}.`
              : `${winnerSymbol} defeated ${loserSymbol} in today's @mcapduel.`
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
    const [forceRefunding, setForceRefunding] = useState(false)

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
                toast.success("Duel cancelled. Your stake was refunded.")
                setDuel(json.data)
            }
        } catch (err) {
            toast.error((err as Error).message || "Something went wrong cancelling the duel.")
        } finally {
            setCancelling(false)
        }
    }

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
                toast.success("Duel expired. The creator's stake was refunded.")
                setDuel(json.data)
            }
        } catch (err) {
            toast.error((err as Error).message || "Something went wrong reclaiming the stake.")
        } finally {
            setReclaiming(false)
        }
    }

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
                toast.success("Settled. Escrow distributed.")
                setDuel(json.data)
            }
        } catch (err) {
            toast.error((err as Error).message || "Something went wrong settling the duel.")
        } finally {
            setClaiming(false)
        }
    }

    async function handleForceRefund() {
        if (!duel) return
        setForceRefunding(true)
        try {
            let txHash: string | undefined
            if (duel.escrowAddress) {
                txHash = await refundStaleDuelOnChain(duel.escrowAddress as `0x${string}`)
            }
            const res = await fetch(`/api/duels/${duel._id}/refund-stale`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ txHash }),
            })
            const json = await res.json()
            if (!json.success) toast.error(json.error)
            else {
                toast.success("Duel refunded. Both stakes were returned.")
                setDuel(json.data)
            }
        } catch (err) {
            toast.error((err as Error).message || "Something went wrong refunding the duel.")
        } finally {
            setForceRefunding(false)
        }
    }

    const openCountdown = useCountdown(duel?.status === "OPEN" ? duel.openDeadline : undefined)
    const liveCountdown = useCountdown(duel?.status === "LIVE" ? duel.endTime : undefined)

    if (!duel) {
        return (
            <div className="space-y-6 pt-10 text-center">
                <div className="h-8 w-48 bg-[var(--s1)] mx-auto animate-pulse" />
                <div className="grid gap-6 md:grid-cols-2">
                    <div className="h-64 bg-[var(--s1)] border border-[var(--line)] animate-pulse" />
                    <div className="h-64 bg-[var(--s1)] border border-[var(--line)] animate-pulse" />
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
            <div className="mx-auto max-w-xl space-y-4">
                <Link href="/duels" className="inline-flex items-center gap-1.5 font-mono text-xs text-[var(--dim)] hover:text-white transition-colors mb-2">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to Duels
                </Link>

                <div className="p-8 text-center bg-[var(--s1)] border border-[var(--line)]">
                    <div className="flex items-center justify-center gap-3">
                        <SideTag side="A" label={duel.tokenA.symbol} />
                        <span className="font-mono text-xs text-[var(--faint)]">VS</span>
                        <SideTag side="B" label={duel.tokenB.symbol} />
                    </div>

                    <div className="mt-8">
                        <div className="font-mono text-[11px] text-[var(--faint)] uppercase tracking-wider">
                            {deadlinePassed ? "Duel Expired" : "Awaiting Opponent"}
                        </div>
                        <div className={`utd-pixel mt-3 text-4xl sm:text-5xl ${urgent ? "text-[var(--hot)]" : "text-[var(--acid)]"}`}>
                            {openCountdown.label}
                        </div>
                        <div className="mt-2 utd-body text-xs text-[var(--dim)]">
                            {deadlinePassed ? "No opponent joined before deadline." : "Stakes auto-refund if unmatched before expiration."}
                        </div>
                    </div>

                    <div className="mt-8 grid grid-cols-3 gap-px bg-[var(--line)]">
                        <div className="bg-[var(--s0)] p-4">
                            <div className="font-mono text-[10px] text-[var(--faint)]">BUY-IN</div>
                            <div className="utd-pixel text-sm text-white mt-1.5">${duel.buyInUsd}</div>
                        </div>
                        <div className="bg-[var(--s0)] p-4">
                            <div className="font-mono text-[10px] text-[var(--faint)]">TOTAL POT</div>
                            <div className="utd-pixel text-sm text-[var(--acid)] mt-1.5">${duel.buyInUsd * 2}</div>
                        </div>
                        <div className="bg-[var(--s0)] p-4">
                            <div className="font-mono text-[10px] text-[var(--faint)]">ROUND</div>
                            <div className="font-mono text-sm text-white mt-1.5">{Math.round(duel.durationSeconds / 60)}m</div>
                        </div>
                    </div>

                    <div className="mt-8 flex justify-center gap-3">
                        {deadlinePassed ? (
                            <button
                                disabled={reclaiming}
                                onClick={handleReclaim}
                                className="utd-btn text-[9px] py-2.5 px-6"
                            >
                                {reclaiming ? "RECLAIMING…" : "RECLAIM STAKE"}
                            </button>
                        ) : isCreator ? (
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <button
                                        disabled={cancelling}
                                        className="utd-btn-outline text-[9px] py-2 px-5 hover:border-[var(--hot)] hover:text-[var(--hot)]"
                                    >
                                        {cancelling ? "CANCELLING…" : "CANCEL DUEL"}
                                    </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="bg-[var(--s0)] border border-[var(--line)] text-white">
                                    <AlertDialogHeader>
                                        <AlertDialogTitle className="utd-pixel text-sm text-white">Cancel Duel?</AlertDialogTitle>
                                        <AlertDialogDescription className="utd-body text-xs text-[var(--dim)]">
                                            Your stake will be fully refunded from the escrow contract.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter className="mt-4 flex gap-2">
                                        <AlertDialogCancel className="utd-btn-outline text-[9px]">Keep Waiting</AlertDialogCancel>
                                        <AlertDialogAction onClick={handleCancel} className="utd-btn-hot text-[9px]">
                                            Confirm Cancel
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        ) : (
                            <p className="utd-body text-xs text-[var(--dim)]">
                                Return to Duels list to accept this challenge.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    if (duel.status === "EXPIRED" || duel.status === "CANCELLED") {
        return (
            <div className="mx-auto max-w-md pt-12 text-center">
                <div className="p-8 bg-[var(--s1)] border border-[var(--line)]">
                    <p className="utd-pixel text-sm text-white">
                        {duel.status === "EXPIRED" ? "DUEL EXPIRED" : "DUEL CANCELLED"}
                    </p>
                    <p className="utd-body text-xs text-[var(--dim)] mt-2">
                        {duel.opponentWallet
                            ? "Both players' stakes have been refunded."
                            : "The creator's stake has been refunded."}
                    </p>
                    {duel.escrowAddress && <OwedWithdraw escrowAddress={duel.escrowAddress} wallet={address} />}
                    <div className="mt-6">
                        <Link href="/duels">
                            <button className="utd-btn text-[9px] py-2 px-5">
                                &larr; BACK TO DUELS
                            </button>
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    // LIVE, SETTLING, HELD, or SETTLED
    const gainA = pctReturn(duel.tokenA.startMarketCapUsd, duel.tokenA.sustainedPeakMarketCapUsd)
    const gainB = pctReturn(duel.tokenB.startMarketCapUsd, duel.tokenB.sustainedPeakMarketCapUsd)
    const leading = gainA >= gainB ? "A" : "B"
    const settled = duel.status === "SETTLED"
    const settling = duel.status === "SETTLING"
    const held = duel.status === "HELD"
    const mySide: 0 | 1 | undefined = isCreator ? duel.creatorSide : isOpponent ? (duel.creatorSide === 0 ? 1 : 0) : undefined
    const myResult = (settled || settling) && mySide !== undefined ? (duel.winnerSide === mySide ? "won" : "lost") : null
    // The last-resort recovery path -- only for a duel with no result yet
    // (LIVE never signed, or HELD never resolved). Never on SETTLING: a winner
    // is signed and refunding would let the loser escape (see canForceRefund).
    const isStale = canForceRefund(duel)

    return (
        <div className="space-y-6">
            {/* Top Bar Navigation */}
            <div className="flex items-center justify-between pb-4 border-b border-[var(--line)]">
                <Link href="/duels" className="inline-flex items-center gap-1.5 font-mono text-xs text-[var(--dim)] hover:text-white transition-colors">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to Duels
                </Link>
                <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[var(--dim)] uppercase px-2 py-0.5 border border-[var(--line)] bg-[var(--s1)]">
                        {settled ? "SETTLED" : settling ? "SETTLING" : "LIVE ROUND"}
                    </span>
                </div>
            </div>

            {/* Battle Status Clock */}
            <div className="p-6 text-center bg-[var(--s1)] border border-[var(--line)]">
                <div className="font-mono text-[10px] text-[var(--faint)] uppercase tracking-wider">
                    {settled || settling ? "RESULT" : held ? "ORACLE REVIEW" : "TIME REMAINING"}
                </div>
                <div className="utd-pixel mt-2 text-4xl sm:text-5xl text-white">
                    {settled || settling ? "MATCH FINISHED" : held ? "HELD" : liveCountdown.label}
                </div>
                <div className="mt-2 utd-body text-xs text-[var(--dim)]">
                    {settled || settling
                        ? "80% of pot paid out to winner · 20% protocol burn"
                        : "Buy-only round. Sustained peaks hold after 30s dwell time."}
                </div>
            </div>

            {/* Held Alert */}
            {held && (
                <div className="p-5 bg-[var(--s1)] border border-[var(--hot)] text-center">
                    <div className="flex items-center justify-center gap-2 text-[var(--hot)] mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="utd-pixel text-xs">FLAGGED FOR ORACLE REVIEW</span>
                    </div>
                    <p className="utd-body text-xs text-[var(--dim)] max-w-lg mx-auto">
                        Both participating wallets were flagged by risk filters. Settlement is held until oracle validation concludes.
                    </p>
                </div>
            )}

            {/* Ready to Claim Alert */}
            {settling && (
                <div className="p-6 bg-[var(--s1)] border border-[var(--acid)] text-center">
                    <div className="flex items-center justify-center gap-2 text-[var(--acid)] mb-2">
                        <Trophy className="h-4 w-4" />
                        <span className="utd-pixel text-xs">
                            {duel.winnerSide === 0 ? duel.tokenA.symbol : duel.tokenB.symbol} WINS THE MATCH
                        </span>
                    </div>
                    <p className="utd-body text-xs text-[var(--dim)] max-w-md mx-auto mb-4">
                        Oracle signature verified. Payout is submitted automatically; anyone can also trigger it now.
                    </p>
                    <button
                        disabled={claiming}
                        onClick={handleClaimSettlement}
                        className="utd-btn py-2.5 px-6 text-[10px]"
                    >
                        {claiming ? "CONFIRMING ON-CHAIN…" : "TRIGGER ESCROW PAYOUT →"}
                    </button>
                </div>
            )}

            {/* Stuck Duel: Last-Resort Refund */}
            {isStale && (
                <div className="p-6 bg-[var(--s1)] border border-[var(--hot)] text-center">
                    <div className="flex items-center justify-center gap-2 text-[var(--hot)] mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="utd-pixel text-xs">DUEL STUCK — REFUND AVAILABLE</span>
                    </div>
                    <p className="utd-body text-xs text-[var(--dim)] max-w-md mx-auto mb-4">
                        This duel never settled, well past its normal window. Either player can reclaim both stakes now.
                    </p>
                    <button
                        disabled={forceRefunding}
                        onClick={handleForceRefund}
                        className="utd-btn-outline py-2.5 px-6 text-[10px] hover:border-[var(--hot)] hover:text-[var(--hot)]"
                    >
                        {forceRefunding ? "REFUNDING…" : "FORCE REFUND BOTH STAKES"}
                    </button>
                </div>
            )}

            {/* Combat Arena: Side A vs Side B */}
            <div className="grid items-stretch gap-6 md:grid-cols-[1fr_auto_1fr]">
                {/* Fighter A */}
                <BattlePanel
                    side="A"
                    symbol={duel.tokenA.symbol}
                    name={duel.tokenA.name}
                    startMc={duel.tokenA.startMarketCapUsd}
                    gainPct={gainA}
                    leading={leading === "A"}
                    peak={duel.tokenA.sustainedPeakMarketCapUsd}
                    won={(settled || settling) && duel.winnerSide === 0}
                    isYours={myWallet && (isCreator ? duel.creatorSide === 0 : duel.creatorSide === 1)}
                />

                {/* Center Pot Details */}
                <div className="flex flex-col items-center justify-center gap-2 py-4 md:py-0">
                    <span className="font-mono text-xs text-[var(--faint)]">VS</span>
                    <div className="mt-1 font-mono text-[9px] text-[var(--faint)] uppercase">TOTAL POT</div>
                    <div className="utd-pixel text-base text-[var(--acid)]">${duel.buyInUsd * 2}</div>
                </div>

                {/* Fighter B */}
                <BattlePanel
                    side="B"
                    symbol={duel.tokenB.symbol}
                    name={duel.tokenB.name}
                    startMc={duel.tokenB.startMarketCapUsd}
                    gainPct={gainB}
                    leading={leading === "B"}
                    peak={duel.tokenB.sustainedPeakMarketCapUsd}
                    won={(settled || settling) && duel.winnerSide === 1}
                    isYours={myWallet && (isCreator ? duel.creatorSide === 1 : duel.creatorSide === 0)}
                />
            </div>

            {/* Settled Victory Callout */}
            {settled && (
                <div className="p-6 bg-[var(--s1)] border border-[var(--line)] text-center">
                    <div className="flex items-center justify-center gap-2 text-[var(--acid)] mb-2">
                        <Trophy className="h-4 w-4" />
                        <span className="utd-pixel text-xs">
                            {duel.winnerSide === 0 ? duel.tokenA.symbol : duel.tokenB.symbol} VICTORIOUS
                        </span>
                    </div>
                    {myResult && (
                        <p className={`utd-pixel text-[10px] mt-1 ${myResult === "won" ? "text-[var(--acid)]" : "text-[var(--hot)]"}`}>
                            YOU {myResult.toUpperCase()} THIS DUEL
                        </p>
                    )}
                    <p className="utd-body text-xs text-[var(--dim)] mt-2">
                        Winner earned <strong className="text-white font-mono">+{duel.winnerPoints} PTS</strong> &middot; Loser earned <strong className="text-white font-mono">+{duel.loserPoints} PTS</strong>
                    </p>
                    <div className="mt-5">
                        <a href={buildShareIntent(duel, myResult)} target="_blank" rel="noopener noreferrer">
                            <button className="utd-btn-outline inline-flex items-center gap-2 py-2 px-4 text-[9px] hover:border-[var(--acid)]">
                                <Twitter className="h-3.5 w-3.5" />
                                SHARE ON X
                            </button>
                        </a>
                    </div>
                </div>
            )}

            {duel.deferredPayouts && duel.deferredPayouts.length > 0 && (
                <div className="p-4 bg-[var(--s1)] border border-[var(--hot)] text-xs utd-body text-[var(--dim)]">
                    <div className="flex items-center gap-2 text-[var(--hot)] mb-1">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="utd-pixel text-[10px]">PAYOUT HELD IN ESCROW</span>
                    </div>
                    The stake token refused a transfer during settlement, so the escrow is holding it for{" "}
                    {duel.deferredPayouts.map((p) => `${p.to.slice(0, 6)}…${p.to.slice(-4)}`).join(", ")}.
                    That wallet can withdraw it here once the token allows the transfer.
                </div>
            )}

            {duel.escrowAddress && <OwedWithdraw escrowAddress={duel.escrowAddress} wallet={address} />}

            {/* Integrity note */}
            <div className="p-4 bg-[var(--s1)] border border-[var(--line)] flex items-center justify-center gap-2 text-xs utd-body text-[var(--dim)]">
                <ShieldCheck className="h-4 w-4 text-[var(--acid)] shrink-0" />
                <span>
                    Oracle feeds validated with 60s TWAP, 30s dwell peak check, and autonomous escrow.
                </span>
            </div>
        </div>
    )
}

/**
 * BattleEscrow credits owed[wallet] instead of paying when the stake token
 * blocks a transfer (e.g. a USDC blacklist). Reads the connected wallet's
 * balance straight from the escrow and offers withdraw() -- which only ever
 * pays msg.sender. Renders nothing when nothing is owed.
 */
function OwedWithdraw({ escrowAddress, wallet }: { escrowAddress: string; wallet?: string }) {
    const [owed, setOwed] = useState<bigint>(0n)
    const [withdrawing, setWithdrawing] = useState(false)

    const refresh = useCallback(async () => {
        if (!wallet) return setOwed(0n)
        try {
            setOwed(await readOwed(escrowAddress as `0x${string}`, wallet as `0x${string}`))
        } catch {
            // Older escrow without owed(), or RPC hiccup -- nothing to offer.
        }
    }, [escrowAddress, wallet])

    useEffect(() => {
        refresh()
        const id = setInterval(refresh, 15_000)
        return () => clearInterval(id)
    }, [refresh])

    if (owed === 0n) return null

    async function handleWithdraw() {
        setWithdrawing(true)
        try {
            await withdrawOwedOnChain(escrowAddress as `0x${string}`)
            toast.success("Withdrawn to your wallet.")
            await refresh()
        } catch (err) {
            toast.error((err as Error).message || "Withdraw failed. The token may still be blocking this transfer.")
        } finally {
            setWithdrawing(false)
        }
    }

    return (
        <div className="p-5 bg-[var(--s1)] border border-[var(--acid)] text-center">
            <p className="utd-body text-xs text-[var(--dim)] mb-3">
                This escrow is holding a payout for your wallet that couldn&apos;t be sent automatically.
            </p>
            <button disabled={withdrawing} onClick={handleWithdraw} className="utd-btn py-2.5 px-6 text-[10px]">
                {withdrawing ? "WITHDRAWING…" : "WITHDRAW"}
            </button>
        </div>
    )
}

function BattlePanel({
    side,
    symbol,
    name,
    startMc,
    gainPct,
    leading,
    peak,
    won,
    isYours,
}: {
    side: "A" | "B"
    symbol: string
    name?: string
    startMc: number
    gainPct: number
    leading: boolean
    peak: number
    won: boolean
    isYours?: boolean
}) {
    const isSideA = side === "A"
    const color = isSideA ? "var(--hot)" : "var(--cool)"
    const barPct = Math.max(5, Math.min(100, 50 + gainPct))

    return (
        <div
            className={`p-6 bg-[var(--s1)] border relative transition-all ${
                won
                    ? "border-[var(--acid)]"
                    : isSideA
                      ? "border-[var(--hot)]/50"
                      : "border-[var(--cool)]/50"
            }`}
        >
            {isYours && (
                <div className="absolute right-0 top-0 bg-[var(--s2)] border-b border-l border-[var(--line)] px-2.5 py-1 font-mono text-[9px] text-[var(--acid)]">
                    YOUR SIDE
                </div>
            )}

            <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                <div className="flex items-center gap-2">
                    <SideTag side={side} label={symbol} />
                    {name && <span className="utd-body text-xs text-[var(--dim)] truncate max-w-[120px]">{name}</span>}
                </div>
                {won ? (
                    <span className="utd-pixel text-[9px] text-[var(--acid)] flex items-center gap-1">
                        <Trophy className="h-3 w-3" /> WINNER
                    </span>
                ) : leading ? (
                    <span className="utd-pixel text-[8px] text-[var(--acid)]">
                        LEADING
                    </span>
                ) : (
                    <span className="font-mono text-[10px] text-[var(--faint)]">TRAILING</span>
                )}
            </div>

            <div className="mt-6 space-y-4">
                {/* Horizontal Progress Bar */}
                <div>
                    <div className="flex justify-between items-center text-xs mb-1.5 font-mono">
                        <span className="text-[var(--faint)]">Validated Gain</span>
                        <span
                            className={`font-semibold ${
                                gainPct >= 0 ? "text-[var(--acid)]" : "text-[var(--hot)]"
                            }`}
                        >
                            {gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%
                        </span>
                    </div>
                    <div className="h-2 w-full bg-[var(--s0)] border border-[var(--line)] overflow-hidden">
                        <div
                            className="h-full transition-all duration-500"
                            style={{
                                width: `${barPct}%`,
                                backgroundColor: color,
                            }}
                        />
                    </div>
                </div>

                {/* Metrics Matrix */}
                <div className="grid grid-cols-2 gap-px bg-[var(--line)] pt-2">
                    <div className="bg-[var(--s0)] p-3">
                        <div className="font-mono text-[10px] text-[var(--faint)]">STARTING MC</div>
                        <div className="font-mono text-xs text-white mt-1">{formatUsd(startMc)}</div>
                    </div>
                    <div className="bg-[var(--s0)] p-3">
                        <div className="font-mono text-[10px] text-[var(--faint)]">SUSTAINED PEAK</div>
                        <div className="font-mono text-xs text-[var(--acid)] mt-1">{formatUsd(peak)}</div>
                    </div>
                </div>
            </div>
        </div>
    )
}
