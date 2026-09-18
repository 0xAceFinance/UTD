"use client"

import { useCallback, useEffect, useState } from "react"
import type { AirdropProgress } from "@/lib/airdrop"

const CHANGED = "utd:airdrop-changed"

/** Tell every mounted useAirdrop (sidebar card, top-bar chip) to refetch. */
export function notifyAirdropChanged() {
    window.dispatchEvent(new Event(CHANGED))
}

/**
 * Airdrop progress for the connected wallet (or the locked catalogue when
 * there isn't one). Shared by the page, the sidebar card and the mobile
 * top-bar button.
 */
export function useAirdrop(address?: string) {
    const [data, setData] = useState<AirdropProgress | null>(null)
    const [loading, setLoading] = useState(true)

    const refresh = useCallback(async () => {
        try {
            const qs = address ? `?wallet=${address}` : ""
            const res = await fetch(`/api/airdrop${qs}`)
            const body = await res.json()
            if (body?.success) setData(body.data)
        } catch {
            // Leave the last good state in place; the page shows its own error on actions.
        } finally {
            setLoading(false)
        }
    }, [address])

    useEffect(() => {
        setLoading(true)
        refresh()
    }, [refresh])

    useEffect(() => {
        const onChange = () => refresh()
        window.addEventListener(CHANGED, onChange)
        return () => window.removeEventListener(CHANGED, onChange)
    }, [refresh])

    const available = data?.tasks.filter((t) => t.status === "available").length ?? 0

    return { data, setData, loading, refresh, available }
}
