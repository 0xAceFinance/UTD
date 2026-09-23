"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { DuelTokenDTO, formatUsd } from "../components/duel/types"
import { GmgnLink } from "../components/duel/GmgnLink"
import { TokenLogo } from "../components/duel/TokenLogo"
import { DexScreenerChart } from "../components/duel/DexScreenerChart"

/** Shared column template for the desktop table (header + rows). */
const COLS = "md:grid-cols-[40px_minmax(0,1fr)_96px_96px_96px_80px_290px]"

export default function TokensPage() {
    const [tokens, setTokens] = useState<DuelTokenDTO[]>([])
    const [loading, setLoading] = useState(true)
    /** Token whose DexScreener chart is expanded; one at a time. */
    const [openChart, setOpenChart] = useState<string | null>(null)

    useEffect(() => {
        const load = () =>
            fetch("/api/duel-tokens")
                .then((r) => r.json())
                .then((json) => {
                    if (json.success) setTokens(json.data)
                })
                .finally(() => setLoading(false))

        load()
        // Market caps re-price server-side every ~20s (GET /api/duel-tokens);
        // polling here is what actually surfaces that movement in the list.
        const id = setInterval(load, 20_000)
        return () => clearInterval(id)
    }, [])

    return (
        <div className="space-y-5">
            <p className="max-w-lg text-[14px] text-[var(--dim)]">
                Tokens you can duel with today, screened on liquidity depth before they&apos;re listed.
            </p>

            {loading ? (
                <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="app-card h-[92px] animate-pulse md:h-14" />
                    ))}
                </div>
            ) : tokens.length === 0 ? (
                <div className="app-card py-14 text-center text-[14px] text-[var(--dim)]">
                    No tokens scanned yet today.
                </div>
            ) : (
                <div>
                    {/* Column headings, desktop only. On phones each row is a
                        self-labelled card instead of a sideways-scrolling table. */}
                    <div
                        className={`hidden gap-4 px-4 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)] md:grid ${COLS}`}
                    >
                        <span>#</span>
                        <span>Token</span>
                        <span className="text-right">Mkt cap</span>
                        <span className="text-right">Liquidity</span>
                        <span className="text-right">24h vol</span>
                        <span className="text-right">24h</span>
                        <span />
                    </div>

                    <ul className="space-y-2">
                        {tokens.map((t) => {
                            const up = t.change24hPct >= 0
                            const change = `${up ? "+" : ""}${t.change24hPct.toFixed(1)}%`
                            const chartOpen = openChart === t._id
                            return (
                                <li
                                    key={t._id}
                                    className={`app-card grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 p-4 md:gap-4 md:py-3 ${COLS} ${
                                        t.pinned ? "ring-1 ring-inset ring-[var(--acid)]" : ""
                                    }`}
                                >
                                    <span className="hidden font-mono text-[12px] text-[var(--faint)] md:block">
                                        {t.pinned ? (
                                            <span className="text-[var(--acid)]" aria-label="Featured">★</span>
                                        ) : (
                                            String(t.rank).padStart(2, "0")
                                        )}
                                    </span>

                                    <div className="flex min-w-0 items-center gap-3">
                                        <TokenLogo symbol={t.symbol} imageUrl={t.imageUrl} pinned={t.pinned} />
                                        <div className="min-w-0">
                                            <div className="flex items-baseline gap-2">
                                                <span className="font-mono text-[11px] text-[var(--faint)] md:hidden">
                                                    {t.pinned ? <span className="text-[var(--acid)]">★</span> : `#${t.rank}`}
                                                </span>
                                                <span className="utd-pixel truncate text-[11px] text-white">{t.symbol}</span>
                                                {t.pinned && (
                                                    <span className="utd-pixel text-[7px] text-[var(--acid)]">FEATURED</span>
                                                )}
                                            </div>
                                            <div className="mt-1 truncate text-[13px] text-[var(--faint)]">{t.name}</div>
                                            <div className="mt-1 truncate font-mono text-[12px] text-[var(--faint)] md:hidden">
                                                Liq {formatUsd(t.liquidityUsd)} · Vol {formatUsd(t.volume24hUsd)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Phone: change + mcap stacked beside the name. */}
                                    <div className="text-right font-mono text-[13px] md:hidden">
                                        <div className={up ? "text-[var(--acid)]" : "text-[var(--hot)]"}>{change}</div>
                                        <div className="mt-0.5 text-[var(--dim)]">{formatUsd(t.marketCapUsd)}</div>
                                    </div>

                                    <span className="hidden text-right font-mono text-[13px] text-[var(--txt)] md:block">
                                        {formatUsd(t.marketCapUsd)}
                                    </span>
                                    <span className="hidden text-right font-mono text-[13px] text-[var(--dim)] md:block">
                                        {formatUsd(t.liquidityUsd)}
                                    </span>
                                    <span className="hidden text-right font-mono text-[13px] text-[var(--dim)] md:block">
                                        {formatUsd(t.volume24hUsd)}
                                    </span>
                                    <span
                                        className={`hidden text-right font-mono text-[13px] md:block ${
                                            up ? "text-[var(--acid)]" : "text-[var(--hot)]"
                                        }`}
                                    >
                                        {change}
                                    </span>

                                    {/* Actions: a full-width pair on phones, right-aligned on desktop. */}
                                    <div className="col-span-2 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-3 md:col-span-1 md:flex md:justify-end md:border-0 md:pt-0">
                                        <button
                                            type="button"
                                            onClick={() => setOpenChart(chartOpen ? null : t._id)}
                                            aria-expanded={chartOpen}
                                            className={`app-chip h-10 justify-center md:h-9 ${chartOpen ? "text-[var(--acid)]" : ""}`}
                                        >
                                            Chart
                                        </button>
                                        <GmgnLink tokenAddress={t.tokenAddress} symbol={t.symbol} className="h-10 md:h-9" />
                                        <Link
                                            href={`/duels/create?tokenA=${t.symbol}`}
                                            className="app-chip h-10 justify-center md:h-9"
                                        >
                                            Challenge
                                        </Link>
                                    </div>

                                    {chartOpen && (
                                        <div className="col-span-full">
                                            <DexScreenerChart tokenAddress={t.tokenAddress} symbol={t.symbol} />
                                        </div>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                </div>
            )}
        </div>
    )
}
