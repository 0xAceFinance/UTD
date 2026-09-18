const SIDE_COLOR = { A: "var(--hot)", B: "var(--cool)" } as const

/** Token symbol in its side's colour, with a solid side marker. No glow. */
export function SideTag({ side, label }: { side: "A" | "B"; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 select-none">
            <span className="h-2.5 w-1 flex-none" style={{ background: SIDE_COLOR[side] }} />
            <span className="utd-pixel text-[10px]" style={{ color: SIDE_COLOR[side] }}>
                {label}
            </span>
        </span>
    )
}

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
    OPEN: { color: "var(--acid)", label: "Open" },
    MATCHED: { color: "var(--cool)", label: "Matched" },
    LIVE: { color: "var(--acid)", label: "Live" },
    SETTLING: { color: "#f59e0b", label: "Settling" },
    HELD: { color: "var(--hot)", label: "Held for review" },
    SETTLED: { color: "var(--dim)", label: "Settled" },
    EXPIRED: { color: "var(--faint)", label: "Expired" },
    CANCELLED: { color: "var(--faint)", label: "Cancelled" },
}

/** Status as a coloured square + word. LIVE breathes; nothing else moves. */
export function StatusTag({ status }: { status: string }) {
    const style = STATUS_STYLE[status] ?? { color: "var(--dim)", label: status }
    return (
        <span
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold select-none"
            style={{ color: style.color }}
        >
            {status === "LIVE" ? (
                <span className="utd-live h-1.5 w-1.5" />
            ) : (
                <span className="h-1.5 w-1.5 flex-none" style={{ background: style.color }} />
            )}
            {style.label}
        </span>
    )
}

const TIER_COLORS: Record<string, string> = {
    Bronze: "#e8a35b",
    Silver: "#c4d1e6",
    Gold: "#fbbf24",
    Diamond: "#7dd3fc",
}

export function TierBadge({ tier }: { tier: "Bronze" | "Silver" | "Gold" | "Diamond" }) {
    const color = TIER_COLORS[tier] ?? TIER_COLORS.Bronze
    return (
        <span
            className="utd-pixel inline-flex items-center px-1.5 py-0.5 text-[7px] uppercase select-none"
            style={{ border: `1px solid ${color}`, color }}
        >
            {tier}
        </span>
    )
}
