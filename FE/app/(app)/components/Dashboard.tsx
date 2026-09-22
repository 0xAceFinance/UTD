"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ArrowUpDown, ExternalLink, Plus, User } from "lucide-react"
import Link from "next/link"
import { useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useWallet } from "@/hooks/useWallet"
import { joinDuelOnChain } from "@/lib/duelContract"
import { getFriendlyErrorMessage } from "@/lib/walletErrors"
import { getStoredRef } from "@/lib/referralClient"
import { useFactoryState } from "@/hooks/useFactoryState"
import { PausedBanner } from "./duel/PausedBanner"
import { SideTag, StatusTag, TierBadge } from "./duel/SideTag"
import { gmgnTokenUrl } from "@/lib/tokenLinks"
import { arcadeAudio } from "@/lib/sound/arcadeAudio"
import { DuelDTO, DuelStatus, DuelTokenDTO, formatRelativeTime, formatUsd, pctReturn } from "./duel/types"

const STATUS_TABS: { label: string; value: DuelStatus | "ALL" }[] = [
    { label: "Open", value: "OPEN" },
    { label: "Live", value: "LIVE" },
    { label: "Settled", value: "SETTLED" },
    { label: "All", value: "ALL" },
]

/** Shared column template for the desktop lobby table (header + rows). */
const LOBBY_COLS = "md:grid-cols-[96px_minmax(0,1fr)_64px_64px_56px_184px]"

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`

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
    // The token the joiner picked in place of the creator's proposed opposing
    // token, if any -- null means "use the default". Reset whenever a new
    // join dialog opens (see openJoinConfirm).
    const [opponentTokenSymbol, setOpponentTokenSymbol] = useState<string | null>(null)
    const paused = useFactoryState()?.paused ?? false

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

    // The "Mine" toggle is hidden without a wallet, so don't leave it stuck on.
    useEffect(() => {
        if (!connected) setMineOnly(false)
    }, [connected])

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
        if (paused && lobby.escrowAddress) {
            toast.error("Duels are paused right now. Try again later.")
            return
        }
        setOpponentTokenSymbol(null)
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

            const opponentToken = opponentTokenSymbol ? tokens.find((t) => t.symbol === opponentTokenSymbol) : undefined
            const res = await fetch(`/api/duels/${duelId}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    opponentWallet: address,
                    txHash,
                    refCode: getStoredRef(),
                    opponentTokenSymbol: opponentTokenSymbol ?? undefined,
                    opponentTokenSnapshot: opponentToken,
                }),
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
            toast.error(getFriendlyErrorMessage(err, "Something went wrong joining the duel."))
        } finally {
            setJoiningId(null)
        }
    }

    const me = address?.toLowerCase()

    return (
        <div className="space-y-6 lg:space-y-8">
            {paused && <PausedBanner />}
            {/* Stats */}
            <dl className="grid grid-cols-3 gap-px border border-[var(--line)] bg-[var(--line)]">
                <Stat label="Live now" value={loading ? "–" : String(liveCount)} accent live={liveCount > 0} />
                <Stat label="Open" value={loading ? "–" : String(openCount)} />
                <Stat
                    label="Your points"
                    value={!connected ? "–" : combatRecord ? combatRecord.totalPoints.toLocaleString() : "0"}
                    badge={connected && combatRecord ? <TierBadge tier={combatRecord.tier as any} /> : undefined}
                />
            </dl>

            {/* Fighters strip. Horizontal at every size so the lobby list always
                gets the full width for its columns. */}
            <section>
                <div className="mb-2.5 flex items-center justify-between">
                    <h2 className="app-section-label">Top fighters</h2>
                    <Link href="/tokens" className="text-[13px] font-semibold text-[var(--dim)] hover:text-[var(--acid)]">
                        See all
                    </Link>
                </div>
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:px-0">
                    {loading
                        ? Array.from({ length: 4 }).map((_, i) => (
                              <div key={i} className="app-card h-[76px] w-36 flex-none animate-pulse" />
                          ))
                        : tokens.slice(0, 8).map((t) => (
                              // Each card opens the token on GMGN.
                              <a
                                  key={t._id}
                                  href={gmgnTokenUrl(t.tokenAddress)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`${t.symbol} on GMGN (opens in a new tab)`}
                                  className="app-card group w-36 flex-none snap-start p-3 transition-colors hover:border-[var(--line-2)] lg:w-auto lg:min-w-[132px] lg:flex-1"
                              >
                                  <div className="flex items-baseline justify-between gap-2">
                                      <span className="utd-pixel truncate text-[10px] text-white">{t.symbol}</span>
                                      <ExternalLink className="h-3 w-3 flex-none text-[var(--faint)] transition-colors group-hover:text-[var(--acid)]" />
                                  </div>
                                  <div className="mt-2.5 flex items-baseline justify-between gap-2 font-mono text-[12px]">
                                      <Change pct={t.change24hPct} />
                                      <span className="text-[var(--dim)]">{formatUsd(t.marketCapUsd)}</span>
                                  </div>
                              </a>
                          ))}
                </div>
            </section>

            {/* Lobbies */}
            <section>
                <div className="mb-3 flex items-stretch gap-2">
                    <div className="app-seg min-w-0 flex-1 sm:flex-none" role="group" aria-label="Filter by status">
                        {STATUS_TABS.map((tab) => (
                            <button
                                key={tab.value}
                                aria-pressed={statusFilter === tab.value}
                                onClick={() => { arcadeAudio.play("tab"); setStatusFilter(tab.value); }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* "Mine" only exists once there is a wallet to filter by,
                        rather than sitting there disabled. */}
                    {connected && (
                        <button
                            onClick={() => { arcadeAudio.play("click"); setMineOnly((v) => !v); }}
                            aria-pressed={mineOnly}
                            aria-label="Only my duels"
                            title="Only my duels"
                            className="app-chip justify-center px-3 sm:ml-auto"
                        >
                            <User className="h-4 w-4" />
                            <span className="hidden sm:inline">Mine</span>
                        </button>
                    )}
                    <button
                        onClick={() => { arcadeAudio.play("click"); setSortOrder((s) => (s === "newest" ? "oldest" : "newest")); }}
                        aria-label={sortOrder === "newest" ? "Sorted newest first" : "Sorted oldest first"}
                        title={sortOrder === "newest" ? "Newest first" : "Oldest first"}
                        className={`app-chip justify-center px-3 ${connected ? "" : "sm:ml-auto"}`}
                    >
                        <ArrowUpDown className="h-4 w-4" />
                        <span className="hidden sm:inline">{sortOrder === "newest" ? "Newest" : "Oldest"}</span>
                    </button>
                </div>

                {/* Column headings, desktop only; rows are self-labelling on phones. */}
                {!lobbiesLoading && browseLobbies.length > 0 && (
                    <div
                        className={`hidden gap-4 px-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)] md:grid ${LOBBY_COLS}`}
                    >
                        <span>Status</span>
                        <span>Match</span>
                        <span>Stake</span>
                        <span>Pot</span>
                        <span>Round</span>
                        <span />
                    </div>
                )}

                {lobbiesLoading ? (
                    <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="app-card h-[132px] animate-pulse md:h-[68px]" />
                        ))}
                    </div>
                ) : browseLobbies.length === 0 ? (
                    <div className="app-card flex flex-col items-center px-6 py-12 text-center">
                        <p className="max-w-xs text-[14px] text-[var(--dim)]">
                            {mineOnly
                                ? "You haven't created or joined a duel yet."
                                : statusFilter === "OPEN"
                                  ? "No open challenges right now."
                                  : "Nothing matches this filter."}
                        </p>
                        <Link href="/duels/create" className="utd-btn mt-5 gap-2 px-4 py-3 text-[9px]">
                            <Plus className="h-3.5 w-3.5" />
                            NEW DUEL
                        </Link>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {browseLobbies.map((l) => (
                            <LobbyRow
                                key={l._id}
                                lobby={l}
                                me={me}
                                joining={joiningId === l._id}
                                paused={paused && !!l.escrowAddress}
                                onJoin={() => openJoinConfirm(l)}
                            />
                        ))}
                    </ul>
                )}
            </section>

            {/* Join confirmation */}
            <Dialog open={pendingJoin !== null} onOpenChange={(open) => !open && setPendingJoin(null)}>
                <DialogContent className="app-root w-[calc(100vw-2rem)] max-w-md rounded-none border border-[var(--line-2)] bg-[var(--s1)] p-5 text-[var(--txt)] sm:p-6">
                    {pendingJoin &&
                        (() => {
                            const mySide: 0 | 1 = pendingJoin.creatorSide === 0 ? 1 : 0
                            const proposedToken = mySide === 0 ? pendingJoin.tokenA : pendingJoin.tokenB
                            const theirToken = mySide === 0 ? pendingJoin.tokenB : pendingJoin.tokenA
                            const myTokenSymbol = opponentTokenSymbol ?? proposedToken.symbol
                            // Any other Top 10 token the joiner could swap in for the
                            // creator's proposed pick -- excludes both sides already in play.
                            const tokenOptions = tokens.filter(
                                (t) => t.symbol !== theirToken.symbol && t.symbol !== proposedToken.symbol
                            )
                            const pot = pendingJoin.buyInUsd * 2
                            const winAmount = Math.round(pot * 0.9)
                            const busy = joiningId === pendingJoin._id

                            return (
                                <>
                                    <DialogHeader className="text-left">
                                        <DialogTitle className="utd-pixel text-[12px] text-white">JOIN DUEL</DialogTitle>
                                        <DialogDescription className="text-[13px] text-[var(--dim)]">
                                            Your ${pendingJoin.buyInUsd} stake goes into this match&apos;s escrow.
                                        </DialogDescription>
                                    </DialogHeader>

                                    <div className="mt-2 grid grid-cols-2 gap-px bg-[var(--line)]">
                                        <div className="bg-[var(--s2)] p-3.5">
                                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
                                                You play
                                            </div>
                                            <div className="mt-2">
                                                <SideTag side={mySide === 0 ? "A" : "B"} label={myTokenSymbol} />
                                            </div>
                                        </div>
                                        <div className="bg-[var(--s2)] p-3.5">
                                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
                                                Against
                                            </div>
                                            <div className="mt-2">
                                                <SideTag side={mySide === 0 ? "B" : "A"} label={theirToken.symbol} />
                                            </div>
                                        </div>
                                    </div>

                                    {tokenOptions.length > 0 && (
                                        <div className="mt-3">
                                            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">
                                                Change your token
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => setOpponentTokenSymbol(null)}
                                                    className={`app-chip h-8 px-2.5 text-[11px] ${
                                                        !opponentTokenSymbol ? "border-[var(--acid)] text-[var(--acid)]" : ""
                                                    }`}
                                                >
                                                    {proposedToken.symbol} (proposed)
                                                </button>
                                                {tokenOptions.map((t) => (
                                                    <button
                                                        key={t.symbol}
                                                        type="button"
                                                        onClick={() => setOpponentTokenSymbol(t.symbol)}
                                                        className={`app-chip h-8 px-2.5 text-[11px] ${
                                                            opponentTokenSymbol === t.symbol ? "border-[var(--acid)] text-[var(--acid)]" : ""
                                                        }`}
                                                    >
                                                        {t.symbol}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <dl className="mt-3 space-y-2 font-mono text-[13px]">
                                        <Row k="Stake" v={`$${pendingJoin.buyInUsd}`} />
                                        <Row k="Pot" v={`$${pot}`} />
                                        <Row k="Round" v={`${Math.round(pendingJoin.durationSeconds / 60)} min`} />
                                        <Row k="If you win (90%)" v={`$${winAmount}`} accent />
                                    </dl>

                                    <div className="mt-5 grid grid-cols-2 gap-2.5">
                                        <button onClick={() => setPendingJoin(null)} className="app-chip h-11 justify-center">
                                            Cancel
                                        </button>
                                        <button disabled={busy || paused} onClick={() => handleJoin()} className="utd-btn h-11 text-[9px]">
                                            {busy ? "JOINING…" : "CONFIRM"}
                                        </button>
                                    </div>
                                </>
                            )
                        })()}
                </DialogContent>
            </Dialog>
        </div>
    )
}

function Stat({
    label,
    value,
    accent,
    live,
    badge,
}: {
    label: string
    value: string
    accent?: boolean
    live?: boolean
    badge?: ReactNode
}) {
    return (
        <div className="min-w-0 bg-[var(--s1)] px-3 py-3.5 sm:px-5 sm:py-4">
            <dt className="flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--faint)] sm:text-[12px]">
                {live && <span className="utd-live h-1.5 w-1.5" />}
                {label}
            </dt>
            <dd className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`utd-pixel truncate text-[14px] sm:text-[18px] ${accent ? "text-[var(--acid)]" : "text-white"}`}>
                    {value}
                </span>
                {badge}
            </dd>
        </div>
    )
}

function Change({ pct }: { pct: number }) {
    return <span className={pct >= 0 ? "text-[var(--acid)]" : "text-[var(--hot)]"}>{fmtPct(pct)}</span>
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
    return (
        <div className="flex justify-between">
            <dt className={accent ? "text-[var(--acid)]" : "text-[var(--faint)]"}>{k}</dt>
            <dd className={accent ? "text-[var(--acid)]" : "text-[var(--txt)]"}>{v}</dd>
        </div>
    )
}

/**
 * One lobby. Phones get a stacked card with full-width, 44px actions; from md
 * up the same markup becomes a table row via `md:grid` + `md:contents`.
 */
function LobbyRow({
    lobby: l,
    me,
    joining,
    paused,
    onJoin,
}: {
    lobby: DuelDTO
    me?: string
    joining: boolean
    paused: boolean
    onJoin: () => void
}) {
    const isMine = Boolean(me) && (l.creatorWallet === me || l.opponentWallet === me)
    const isMyOpenLobby = l.status === "OPEN" && l.creatorWallet === me
    const canJoin = l.status === "OPEN" && !isMyOpenLobby
    const started = l.status !== "OPEN" && l.status !== "EXPIRED" && l.status !== "CANCELLED"

    const side = (idx: 0 | 1) => {
        const t = idx === 0 ? l.tokenA : l.tokenB
        let note: ReactNode = null
        if (started) {
            const pct = pctReturn(t.startMarketCapUsd, t.currentMarketCapUsd)
            note = (
                <>
                    <Change pct={Number.isFinite(pct) ? pct : 0} />
                    {l.status === "SETTLED" && l.winnerSide === idx && <span className="ml-1.5 text-[var(--acid)]">won</span>}
                </>
            )
        } else if (l.status === "OPEN") {
            note =
                l.creatorSide === idx ? (
                    <span className="text-[var(--dim)]">
                        {l.creatorWallet === me ? "You" : `${l.creatorWallet.slice(0, 6)}…`}
                    </span>
                ) : (
                    <span className="text-[var(--acid)]">Open slot</span>
                )
        }
        return (
            <div className="min-w-0">
                <SideTag side={idx === 0 ? "A" : "B"} label={t.symbol} />
                <div className="mt-1 font-mono text-[12px]">{note}</div>
            </div>
        )
    }

    return (
        <li
            className={`app-card flex flex-col gap-3.5 p-4 md:grid md:items-center md:gap-4 md:py-3 ${LOBBY_COLS} ${
                isMine ? "border-l-2 border-l-[var(--acid)]" : ""
            }`}
        >
            <div className="flex items-center justify-between md:flex-col md:items-start md:gap-1">
                <StatusTag status={l.status} />
                <span className="font-mono text-[11px] text-[var(--faint)]">{formatRelativeTime(l.createdAt)}</span>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 md:grid-cols-[minmax(0,120px)_auto_minmax(0,120px)] md:gap-4">
                {side(0)}
                <span className="font-mono text-[11px] text-[var(--faint)]">vs</span>
                <div className="text-right md:text-left">{side(1)}</div>
            </div>

            <dl className="grid grid-cols-3 gap-px bg-[var(--line)] font-mono text-[13px] md:contents">
                <Meta k="Stake" v={`$${l.buyInUsd}`} />
                <Meta k="Pot" v={`$${l.buyInUsd * 2}`} accent />
                <Meta k="Round" v={`${Math.round(l.durationSeconds / 60)}m`} />
            </dl>

            <div className={`grid gap-2 ${canJoin ? "grid-cols-[1fr_1.4fr]" : "grid-cols-1"} md:flex md:justify-end`}>
                <Link href={`/duels/${l._id}`} className="app-chip h-11 justify-center md:h-9">
                    {started ? "Watch" : "View"}
                </Link>
                {canJoin && (
                    <button disabled={joining || paused} onClick={onJoin} className="utd-btn h-11 px-4 text-[9px] md:h-9">
                        {joining ? "JOINING…" : paused ? "PAUSED" : "JOIN"}
                    </button>
                )}
                {isMyOpenLobby && (
                    <span className="hidden items-center text-[12px] text-[var(--faint)] md:flex">Your lobby</span>
                )}
            </div>
        </li>
    )
}

function Meta({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
    return (
        <div className="bg-[var(--s1)] py-2 text-center md:bg-transparent md:py-0 md:text-left">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--faint)] md:hidden">{k}</dt>
            <dd className={`mt-0.5 md:mt-0 ${accent ? "text-[var(--acid)]" : "text-[var(--txt)]"}`}>{v}</dd>
        </div>
    )
}
