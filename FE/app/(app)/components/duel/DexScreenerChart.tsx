"use client"

import { dexScreenerEmbedUrl } from "@/lib/tokenLinks"

/** DexScreener's embedded candlestick chart for one token. */
export function DexScreenerChart({
    tokenAddress,
    symbol,
    className = "aspect-[16/9] min-h-[380px]",
}: {
    tokenAddress: string
    symbol: string
    /** Sizing; defaults to a 16:9 frame. */
    className?: string
}) {
    return (
        <div className={`relative w-full bg-[var(--s0)] border border-[var(--line)] overflow-hidden ${className}`}>
            <iframe
                src={dexScreenerEmbedUrl(tokenAddress)}
                title={`${symbol} DexScreener Chart`}
                className="w-full h-full border-0"
                loading="lazy"
            />
        </div>
    )
}

const SIDE_COLOR = { A: "var(--hot)", B: "var(--cool)" } as const

export interface ChartSide {
    side: "A" | "B"
    /** Absent until that side is picked (create page). */
    symbol?: string
    /** Absent on legacy duels; that side then shows a placeholder. */
    tokenAddress?: string
}

/**
 * Side A and Side B DexScreener charts next to each other (stacked on
 * phones), so a player compares both tokens at once before committing
 * (create page, open-duel join screen). Each chart swaps as soon as its side's
 * pick changes. Renders nothing if neither side has a token yet. Pass a
 * single side for a one-token view (create page, an unjoined lobby).
 */
export function SideBySideCharts({ sides, className = "" }: { sides: ChartSide[]; className?: string }) {
    if (!sides.some((s) => s.tokenAddress)) return null

    return (
        <div className={`grid gap-3 ${sides.length > 1 ? "md:grid-cols-2" : ""} ${className}`}>
            {sides.map((s) => (
                <div key={s.side} className="min-w-0 space-y-2">
                    <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-1 flex-none" style={{ background: SIDE_COLOR[s.side] }} />
                        <span className="utd-pixel truncate text-[10px]" style={{ color: SIDE_COLOR[s.side] }}>
                            SIDE {s.side}
                            {s.symbol ? ` · ${s.symbol}` : ""}
                        </span>
                    </div>
                    {s.tokenAddress && s.symbol ? (
                        <DexScreenerChart
                            key={s.tokenAddress}
                            tokenAddress={s.tokenAddress}
                            symbol={s.symbol}
                            className="h-[420px]"
                        />
                    ) : (
                        <div className="flex h-[420px] items-center justify-center border border-dashed border-[var(--line)] bg-[var(--s0)] px-4 text-center font-mono text-xs text-[var(--faint)]">
                            {s.symbol ? "No chart for this token" : `Pick a Side ${s.side} token to see its chart`}
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}
