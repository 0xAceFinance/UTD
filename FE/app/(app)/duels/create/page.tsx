"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Skeleton } from "@/components/ui/skeleton"
import { Check } from "lucide-react"
import { toast } from "sonner"
import { useWallet } from "@/hooks/useWallet"
import { createDuelOnChain } from "@/lib/duelContract"
import { DuelTokenDTO } from "../../components/duel/types"

const QUICK_BUY_INS = [25, 50, 100, 250]

function StepTitle({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
    return (
        <CardTitle className="flex items-center gap-2.5 text-xs uppercase tracking-wider text-muted-foreground">
            <span
                className={`flex h-5 w-5 flex-none items-center justify-center border-2 text-[10px] ${
                    done ? "border-[hsl(var(--good))] bg-[hsl(var(--good))]/15 text-[hsl(var(--good))]" : "border-border"
                }`}
            >
                {done ? <Check className="h-3 w-3" /> : n}
            </span>
            {children}
        </CardTitle>
    )
}

export default function CreateDuelPage() {
    const router = useRouter()
    const { address, connected } = useWallet()

    const [tokens, setTokens] = useState<DuelTokenDTO[]>([])
    const [tokensLoading, setTokensLoading] = useState(true)
    const [tokenA, setTokenA] = useState<string | null>(null)
    const [tokenB, setTokenB] = useState<string | null>(null)
    const [side, setSide] = useState<0 | 1>(0)
    const [buyIn, setBuyIn] = useState(100)
    const [duration, setDuration] = useState(25)
    const [submitting, setSubmitting] = useState(false)
    const [stage, setStage] = useState<"idle" | "wallet" | "saving">("idle")

    useEffect(() => {
        fetch("/api/duel-tokens")
            .then((r) => r.json())
            .then((json) => {
                if (json.success) setTokens(json.data)
            })
            .finally(() => setTokensLoading(false))
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
    const progress = (tokenA ? 1 : 0) + (tokenB ? 1 : 0) + 1 + 1 // steps 3 & 4 always have a default value
    const canSubmit = connected && bothPicked && buyIn > 0 && !submitting
    const pot = buyIn * 2
    const winAmount = Math.round(pot * 0.8)

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
            const res = await fetch("/api/duels", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    creatorWallet: address,
                    tokenASymbol: tokenA,
                    tokenBSymbol: tokenB,
                    txHash,
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
            toast.error((err as Error).message || "Something went wrong creating the duel.")
        } finally {
            setSubmitting(false)
            setStage("idle")
        }
    }

    return (
        <div className="animate-in fade-in duration-500 mx-auto max-w-3xl space-y-6 pb-16">
            <div className="space-y-4 pt-4 text-center">
                <h1 className="text-2xl text-primary glow-text md:text-3xl">Create Duel</h1>
                <div className="mx-auto flex max-w-xs gap-1.5">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className={`h-1.5 flex-1 ${i < progress ? "bg-primary" : "bg-border"}`} />
                    ))}
                </div>
            </div>

            <Card>
                <CardHeader>
                    <StepTitle n={1} done={bothPicked}>
                        Choose 2 Tokens From Today's Top 10
                    </StepTitle>
                </CardHeader>
                <CardContent>
                    {tokensLoading ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                            {Array.from({ length: 10 }).map((_, i) => (
                                <Skeleton key={i} className="h-[52px] rounded-none" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                            {tokens.map((t) => {
                                const isA = tokenA === t.symbol
                                const isB = tokenB === t.symbol
                                return (
                                    <button
                                        key={t._id}
                                        onClick={() => pickToken(t.symbol)}
                                        className={`pixel-flat border-2 p-3 text-center text-xs font-bold transition-all hover:-translate-y-0.5 ${
                                            isA
                                                ? "border-[hsl(var(--side-a))] bg-[hsl(var(--side-a))]/10 text-[hsl(var(--side-a))]"
                                                : isB
                                                  ? "border-[hsl(var(--side-b))] bg-[hsl(var(--side-b))]/10 text-[hsl(var(--side-b))]"
                                                  : "border-border bg-card hover:border-primary/50"
                                        }`}
                                    >
                                        {t.symbol}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <StepTitle n={2} done={bothPicked}>
                        Pick Your Side
                    </StepTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                    <button
                        disabled={!tokenA}
                        onClick={() => setSide(0)}
                        className={`pixel-flat border-2 p-5 text-center transition-all disabled:opacity-40 ${
                            side === 0 && tokenA ? "border-[hsl(var(--side-a))] bg-[hsl(var(--side-a))]/10" : "border-border"
                        }`}
                    >
                        <div className="text-xs text-[hsl(var(--side-a))]">SIDE A</div>
                        <div className="mt-2 text-lg font-bold">{tokenA ?? "-"}</div>
                        {side === 0 && tokenA && (
                            <div className="mt-2 flex items-center justify-center gap-1 text-xs text-[hsl(var(--good))]">
                                <Check className="h-3.5 w-3.5" /> Selected
                            </div>
                        )}
                    </button>
                    <button
                        disabled={!tokenB}
                        onClick={() => setSide(1)}
                        className={`pixel-flat border-2 p-5 text-center transition-all disabled:opacity-40 ${
                            side === 1 && tokenB ? "border-[hsl(var(--side-b))] bg-[hsl(var(--side-b))]/10" : "border-border"
                        }`}
                    >
                        <div className="text-xs text-[hsl(var(--side-b))]">SIDE B</div>
                        <div className="mt-2 text-lg font-bold">{tokenB ?? "-"}</div>
                        {side === 1 && tokenB && (
                            <div className="mt-2 flex items-center justify-center gap-1 text-xs text-[hsl(var(--good))]">
                                <Check className="h-3.5 w-3.5" /> Selected
                            </div>
                        )}
                    </button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <StepTitle n={3} done={buyIn > 0}>
                        Set Your Buy-In
                    </StepTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <Input
                            type="number"
                            min={1}
                            value={buyIn}
                            onChange={(e) => setBuyIn(Number(e.target.value))}
                            className="tabular w-32 pixel-flat border-2 pl-6"
                        />
                    </div>
                    <div className="flex gap-2">
                        {QUICK_BUY_INS.map((v) => (
                            <Button
                                key={v}
                                variant="outline"
                                className={`h-9 text-xs ${buyIn === v ? "bg-primary/10" : ""}`}
                                onClick={() => setBuyIn(v)}
                            >
                                ${v}
                            </Button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <StepTitle n={4} done>
                        Battle Duration
                    </StepTitle>
                    <span className="tabular text-lg font-bold text-primary">{duration} min</span>
                </CardHeader>
                <CardContent>
                    <Slider min={15} max={40} step={5} value={[duration]} onValueChange={([v]) => setDuration(v)} />
                    <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                        <span>15 min</span>
                        <span>40 min</span>
                    </div>
                </CardContent>
            </Card>

            <Card className="sticky bottom-4">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                    <div className="flex gap-8">
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Pot</div>
                            <div className="tabular text-lg font-bold">${pot}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">If You Win</div>
                            <div className="tabular text-lg font-bold text-[hsl(var(--good))]">${winAmount}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">If You Lose</div>
                            <div className="text-lg font-bold text-muted-foreground">$0 + pts</div>
                        </div>
                    </div>
                    <Button disabled={!canSubmit} onClick={handleSubmit}>
                        {!connected
                            ? "Connect Wallet First"
                            : stage === "wallet"
                              ? "Confirm In Wallet…"
                              : stage === "saving"
                                ? "Finalizing…"
                                : "Lock In Stake →"}
                    </Button>
                </CardContent>
            </Card>
        </div>
    )
}
