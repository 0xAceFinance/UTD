import { ExternalLink } from "lucide-react"
import { gmgnTokenUrl } from "@/lib/tokenLinks"

/**
 * Opens the token's GMGN page in a new tab. Renders nothing without an
 * address (legacy duels predate stored addresses), so callers can drop it in
 * unconditionally.
 */
export function GmgnLink({
    tokenAddress,
    symbol,
    label = "GMGN",
    className = "",
}: {
    tokenAddress?: string
    symbol: string
    /** Visible text; defaults to "GMGN". Use the symbol when two sit side by side. */
    label?: string
    className?: string
}) {
    if (!tokenAddress) return null

    return (
        <a
            href={gmgnTokenUrl(tokenAddress)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${symbol} on GMGN (opens in a new tab)`}
            className={`app-chip justify-center gap-1.5 ${className}`}
        >
            {label}
            <ExternalLink className="h-3.5 w-3.5" />
        </a>
    )
}
