"use client"

import { useState } from "react"
import { Star } from "lucide-react"

/**
 * Token logo from DexScreener, falling back to the symbol's first letter
 * when there is no image or it fails to load. Pinned tokens get a star.
 */
export function TokenLogo({
    symbol,
    imageUrl,
    pinned = false,
    className = "h-8 w-8",
}: {
    symbol: string
    imageUrl?: string
    pinned?: boolean
    className?: string
}) {
    const [failed, setFailed] = useState(false)

    return (
        <span className={`relative inline-flex flex-none ${className}`}>
            {imageUrl && !failed ? (
                <img
                    src={imageUrl}
                    alt=""
                    loading="lazy"
                    onError={() => setFailed(true)}
                    className="h-full w-full rounded-full border border-[var(--line)] object-cover"
                />
            ) : (
                <span className="utd-pixel flex h-full w-full items-center justify-center rounded-full border border-[var(--line)] bg-[var(--s2)] text-[9px] text-[var(--dim)]">
                    {symbol.charAt(0)}
                </span>
            )}
            {pinned && (
                <Star
                    aria-label="Featured token"
                    className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-[var(--acid)] text-[var(--acid)]"
                />
            )}
        </span>
    )
}
