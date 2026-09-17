"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Zap, Swords, Trophy, Plus, User, ArrowUpDown } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useWallet } from "@/hooks/useWallet"
import { joinDuelOnChain } from "@/lib/duelContract"
import { SideTag, StatusTag, TierBadge } from "./duel/SideTag"
import { DuelDTO, DuelStatus, DuelTokenDTO, formatRelativeTime, formatUsd } from "./duel/types"

const STATUS_TABS: { label: string; value: DuelStatus | "ALL" }[] = [
    { label: "All", value: "ALL" },
    { label: "Open", value: "OPEN" },
    { label: "Live", value: "LIVE" },
    { label: "Settled", value: "SETTLED" },
]

export default function Dashboard() {
    const router = useRouter()
    const { address, connected } = useWallet()

    const [tokens, setTokens] = useState<DuelTokenDTO[]>([])
    const [openCount, setOpenCount] = useState(0)
    const [liveCount, setLiveCount] = useState(0)
    const [combatRecord, setCombatRecord] = useState<{ tier: string; totalPoints: number } | null>(null)
    const [loading, setLoading] = useState(true)
    const [joiningId, setJoiningId] = useState<string | null>(null)
    const [pendingJoin, setPendingJoin] = useState<DuelDTO | null>(null)

    const [browseLobbies, setBrowseLobbies] = useState<DuelDTO[]>([])
    const [lobbiesLoading, setLobbiesLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState<DuelStatus | "ALL">("OPEN")
    const [mineOnly, setMineOnly] = useState(false)
    const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest")

    useEffect(() => {
        async function load() {
            try {
                const [tokensRes, openRes, liveRes] = await Promise.all([
                    fetch("/api/duel-tokens"),
                    fetch("/api/duels?status=OPEN"),
                    fetch("/api/duels?status=LIVE"),
                ])
                const tokensJson = await tokensRes.json()
                const openJson = await openRes.json()
                const liveJson = await liveRes.json()
                if (tokensJson.success) setTokens(tokensJson.data)
                if (openJson.success) setOpenCount(openJson.data.length)
                if (liveJson.success) setLiveCount(liveJson.data.length)
            } catch (err) {
                console.error("failed to load dashboard data", err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [])

    useEffect(() => {
        if (mineOnly && !address) {
            setBrowseLobbies([])
            setLobbiesLoading(false)
            return
        }
        setLobbiesLoading(true)
        const params = new URLSearchParams()
        if (statusFilter !== "ALL") params.set("status", statusFilter)
        if (mineOnly && address) params.set("wallet", address)
        params.set("sort", sortOrder)
        fetch(`/api/duels?${params.toString()}`)
            .then((r) => r.json())
            .then((json) => {
                if (json.success) setBrowseLobbies(json.data)
            })
            .catch((err) => console.error("failed to load lobbies", err))
            .finally(() => setLobbiesLoading(false))
    }, [statusFilter, mineOnly, sortOrder, address])

    useEffect(() => {
        if (!address) {
            setCombatRecord(null)
            return
        }
        fetch(`/api/combat-record/${address}`)
            .then((r) => r.json())
            .then((json) => {
                if (json.success) setCombatRecord({ tier: json.data.tier, totalPoints: json.data.totalPoints })
            })
            .catch(() => {})
    }, [address])

    function openJoinConfirm(lobby: DuelDTO) {
        if (!connected || !address) {
            toast.error("Connect your wallet to join a duel.")
            return
        }
        setPendingJoin(lobby)
    }

    async function handleJoin() {
        if (!connected || !address || !pendingJoin) {
            toast.error("Connect your wallet to join a duel.")
            return
        }
        const duelId = pendingJoin._id
        setJoiningId(duelId)
        try {
            let txHash: string | undefined
            if (pendingJoin.escrowAddress) {
                toast.info("Confirm the approval and join transactions in your wallet.")
                txHash = await joinDuelOnChain(
                    address as `0x${string}`,
                    pendingJoin.escrowAddress as `0x${string}`,
                    pendingJoin.buyInUsd
                )
            }

            const res = await fetch(`/api/duels/${duelId}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ opponentWallet: address, txHash }),
            })
            const json = await res.json()
            if (!json.success) {
                toast.error(json.error ?? "Could not join this duel.")
                return
            }
            setPendingJoin(null)
            toast.success("Joined. The duel is live.")
            router.push(`/duels/${duelId}`)
        } catch (err) {
            toast.error((err as Error).message || "Something went wrong joining the duel.")
        } finally {
            setJoiningId(null)
        }
    }

    return (
        <div className="animate-in fade-in duration-500 space-y-10">
            <header className="flex justify-center pt-4">
                <div className="text-center">
                    <h1 className="text-3xl md:text-5xl text-primary glow-text">Underground Token Duel</h1>
                    <p className="mt-4 text-base md:text-lg text-muted-foreground">
                        Pick a side. Lock a stake. Whoever pumps harder wins.
                    </p>
                </div>
            </header>

            <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <Card className="p-6 text-center">
                    <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center border-2 border-primary/30 bg-primary/10">
                        <Swords className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-primary">Live Duels</CardTitle>
                    <CardDescription className="mb-6 mt-2">Battles in progress right now</CardDescription>
                    {loading ? (
                        <Skeleton className="mx-auto h-10 w-16 rounded-none" />
                    ) : (
                        <div className="tabular text-5xl font-extrabold text-primary glow-text">{liveCount}</div>
                    )}
                </Card>

                <Card className="p-6 text-center">
                    <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center border-2 border-primary/30 bg-primary/10">
                        <Zap className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-primary">Open Lobbies</CardTitle>
                    <CardDescription className="mb-6 mt-2">Waiting for an opponent</CardDescription>
                    {loading ? (
                        <Skeleton className="mx-auto h-10 w-16 rounded-none" />
                    ) : (
                        <div className="tabular text-5xl font-extrabold text-primary glow-text">{openCount}</div>
                    )}
                </Card>

                <Card className="p-6 text-center">
                    <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center border-2 border-primary/30 bg-primary/10">
                        <Trophy className="h-5 w-5 text-primary" />
                    </div>
                    <CardTitle className="text-primary">Your Combat Record</CardTitle>
                    <CardDescription className="mb-6 mt-2">Lifetime points and tier</CardDescription>
                    {!connected ? (
                        <p className="text-sm text-muted-foreground">Connect your wallet to see your record.</p>
                    ) : combatRecord ? (
                        <div className="flex items-center justify-center gap-3">
                            <TierBadge tier={combatRecord.tier as any} />
                            <span className="tabular text-xl font-extrabold text-primary">{combatRecord.totalPoints.toLocaleString()} PTS</span>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No duels fought yet.</p>
                    )}
                </Card>
            </section>

            <section>
                <h2 className="font-pixel mb-4 text-xs uppercase tracking-wider text-muted-foreground">Today's Top 10</h2>
                <div className="flex gap-3 overflow-x-auto pb-3">
                    {loading
                        ? Array.from({ length: 6 }).map((_, i) => (
                              <Skeleton key={i} className="h-[84px] min-w-[120px] flex-none rounded-none" />
                          ))
                        : tokens.map((t) => (
                              <Card key={t._id} className="interactive min-w-[120px] flex-none cursor-default p-3 text-center">
                                  <div className="text-sm font-bold text-primary">{t.symbol}</div>
                                  <div
                                      className={`tabular mt-1 text-xs font-semibold ${t.change24hPct >= 0 ? "text-[hsl(var(--good))]" : "text-destructive"}`}
                                  >
                                      {t.change24hPct >= 0 ? "+" : ""}
                                      {t.change24hPct}%
                                  </div>
                                  <div className="mt-1 text-[11px] text-muted-foreground">{formatUsd(t.marketCapUsd)} MC</div>
                              </Card>
                          ))}
                </div>
            </section>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <div>
                        <CardTitle className="text-primary">Lobbies</CardTitle>
                        <CardDescription className="mt-2">Pick a side and lock in your stake, or watch any battle</CardDescription>
                    </div>
                    <Link href="/duels/create">
                        <Button className="gap-2">
                            <Plus className="h-4 w-4" />
                            Create Duel
                        </Button>
                    </Link>
                </CardHeader>
                <CardContent>
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                        <div className="flex flex-wrap gap-2">
                            {STATUS_TABS.map((tab) => (
                                <Button
                                    key={tab.value}
                                    size="sm"
                                    variant={statusFilter === tab.value ? "default" : "outline"}
                                    onClick={() => setStatusFilter(tab.value)}
                                >
                                    {tab.label}
                                </Button>
                            ))}
                        </div>
                        <div className="ml-auto flex flex-wrap gap-2">
                            <Button
                                size="sm"
                                variant={mineOnly ? "default" : "outline"}
                                disabled={!connected}
                                onClick={() => setMineOnly((v) => !v)}
                                className="gap-1.5"
                                title={connected ? "Show only lobbies you created or joined" : "Connect your wallet to filter by your lobbies"}
                            >
                                <User className="h-3.5 w-3.5" />
                                My Lobbies
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))}
                                className="gap-1.5"
                            >
                                <ArrowUpDown className="h-3.5 w-3.5" />
                                {sortOrder === "newest" ? "Newest" : "Oldest"}
                            </Button>
                        </div>
                    </div>

                    {lobbiesLoading ? (
                        <div className="space-y-4">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <Skeleton key={i} className="h-[68px] w-full rounded-none" />
                            ))}
                        </div>
                    ) : browseLobbies.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <Swords className="h-8 w-8 text-muted-foreground/50" />
                            <p className="text-muted-foreground">
                                {mineOnly && !connected
                                    ? "Connect your wallet to see your lobbies."
                                    : mineOnly
                                      ? "You haven't created or joined a lobby yet."
                                      : statusFilter === "OPEN"
                                        ? "No open lobbies right now. Be the first to create one."
                                        : "No lobbies match this filter."}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {browseLobbies.map((l) => {
                                const isMyOpenLobby = l.status === "OPEN" && l.creatorWallet === address?.toLowerCase()
                                return (
                                    <div
                                        key={l._id}
                                        className="flex flex-wrap items-center justify-between gap-4 border-2 border-primary/15 bg-secondary/40 p-4 transition-colors hover:border-primary/40 hover:bg-secondary/60"
                                    >
                                        <div className="flex items-center gap-3">
                                            <StatusTag status={l.status} />
                                            <SideTag side="A" label={l.tokenA.symbol} />
                                            <span className="text-sm text-muted-foreground">vs</span>
                                            <SideTag side="B" label={l.tokenB.symbol} />
                                        </div>
                                        <div className="flex items-center gap-6">
                                            <div className="text-center">
                                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Buy-in</div>
                                                <div className="tabular text-sm font-semibold">${l.buyInUsd}</div>
                                            </div>
                                            <div className="text-center">
                                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Duration</div>
                                                <div className="tabular text-sm font-semibold">{Math.round(l.durationSeconds / 60)} min</div>
                                            </div>
                                            <div className="text-center">
                                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Created</div>
                                                <div className="tabular text-sm font-semibold">{formatRelativeTime(l.createdAt)}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Link href={`/duels/${l._id}`}>
                                                    <Button variant="outline" size="sm">
                                                        View
                                                    </Button>
                                                </Link>
                                                {l.status === "OPEN" && !isMyOpenLobby && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={joiningId === l._id}
                                                        onClick={() => openJoinConfirm(l)}
                                                    >
                                                        {joiningId === l._id ? "Joining…" : "Join Duel"}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={pendingJoin !== null} onOpenChange={(open) => !open && setPendingJoin(null)}>
                <DialogContent>
                    {pendingJoin && (() => {
                        const opponentSide: 0 | 1 = pendingJoin.creatorSide === 0 ? 1 : 0
                        const mySymbol = opponentSide === 0 ? pendingJoin.tokenA.symbol : pendingJoin.tokenB.symbol
                        const pot = pendingJoin.buyInUsd * 2
                        const winAmount = Math.round(pot * 0.8)
                        return (
                            <>
                                <DialogHeader>
                                    <DialogTitle>Join Duel</DialogTitle>
                                </DialogHeader>

                                <div className="flex items-center justify-center gap-3 border-2 border-border/40 bg-secondary/40 p-4">
                                    <SideTag side="A" label={pendingJoin.tokenA.symbol} />
                                    <Swords className="h-4 w-4 flex-none text-primary/60" />
                                    <SideTag side="B" label={pendingJoin.tokenB.symbol} />
                                </div>

                                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                                    You will be placed on{" "}
                                    <strong className={opponentSide === 0 ? "text-[hsl(var(--side-a))]" : "text-[hsl(var(--side-b))]"}>
                                        Side {opponentSide === 0 ? "A" : "B"} &middot; {mySymbol}
                                    </strong>
                                    . Stake locks immediately, no selling until the duel ends.
                                </p>

                                <div className="mt-4 flex gap-2">
                                    <div className="flex-1 border-2 border-border/35 py-2.5 text-center">
                                        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">Total Pot</div>
                                        <div className="tabular text-base font-bold">${pot}</div>
                                    </div>
                                    <div className="flex-1 border-2 border-border/35 py-2.5 text-center">
                                        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">If You Win</div>
                                        <div className="tabular text-base font-bold text-[hsl(var(--good))]">${winAmount}</div>
                                    </div>
                                    <div className="flex-1 border-2 border-border/35 py-2.5 text-center">
                                        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">If You Lose</div>
                                        <div className="text-base font-bold text-muted-foreground">$0+pts</div>
                                    </div>
                                </div>

                                <DialogFooter>
                                    <Button variant="ghost" onClick={() => setPendingJoin(null)}>
                                        Cancel
                                    </Button>
                                    <Button
                                        variant={opponentSide === 0 ? "sideA" : "sideB"}
                                        disabled={joiningId === pendingJoin._id}
                                        onClick={() => handleJoin()}
                                    >
                                        {joiningId === pendingJoin._id ? "Joining…" : "Confirm & Join"}
                                    </Button>
                                </DialogFooter>
                            </>
                        )
                    })()}
                </DialogContent>
            </Dialog>
        </div>
    )
}
