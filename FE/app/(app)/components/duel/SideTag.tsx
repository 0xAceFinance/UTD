export function SideTag({ side, label }: { side: 'A' | 'B'; label: string }) {
    const color = side === 'A' ? 'hsl(var(--side-a))' : 'hsl(var(--side-b))'
    return (
        <span
            className="pixel-flat inline-flex items-center gap-1.5 border-2 px-2.5 py-1 text-xs font-bold"
            style={{ borderColor: color, color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
        >
            SIDE {side} · {label}
        </span>
    )
}

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
    OPEN: { color: 'hsl(var(--primary))', label: 'Open' },
    MATCHED: { color: 'hsl(var(--primary))', label: 'Matched' },
    LIVE: { color: 'hsl(var(--good))', label: 'Live' },
    SETTLING: { color: 'hsl(var(--good))', label: 'Settling' },
    HELD: { color: 'hsl(var(--destructive))', label: 'Held' },
    SETTLED: { color: 'hsl(var(--muted-foreground))', label: 'Settled' },
    EXPIRED: { color: 'hsl(var(--muted-foreground))', label: 'Expired' },
    CANCELLED: { color: 'hsl(var(--muted-foreground))', label: 'Cancelled' },
}

export function StatusTag({ status }: { status: string }) {
    const style = STATUS_STYLE[status] ?? { color: 'hsl(var(--muted-foreground))', label: status }
    return (
        <span
            className="pixel-flat inline-flex items-center gap-1.5 border-2 px-2 py-0.5 text-[10px] font-bold uppercase"
            style={{ borderColor: style.color, color: style.color, backgroundColor: `color-mix(in srgb, ${style.color} 12%, transparent)` }}
        >
            {status === 'LIVE' && <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full" style={{ backgroundColor: style.color }} />}
            {style.label}
        </span>
    )
}

export function TierBadge({ tier }: { tier: 'Bronze' | 'Silver' | 'Gold' | 'Diamond' }) {
    const varName =
        tier === 'Diamond' ? '--tier-diamond' : tier === 'Gold' ? '--tier-gold' : tier === 'Silver' ? '--tier-silver' : '--tier-bronze'
    return (
        <span
            className="pixel-flat inline-flex items-center border-2 px-2.5 py-1 text-xs font-bold uppercase"
            style={{ borderColor: `hsl(var(${varName}))`, backgroundColor: `hsl(var(${varName}) / 0.18)`, color: `hsl(var(${varName}))` }}
        >
            {tier}
        </span>
    )
}
