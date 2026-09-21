"use client"

import { useEffect, useState } from "react"
import { getFactoryState } from "@/lib/duelContract"

/**
 * BattleEscrowFactory's live gates (paused, minBuyIn/maxBuyIn, the current
 * fee split), re-read every 30s so an emergency pause or an owner retuning
 * fees/buy-in bounds shows up without a reload. null until the first read
 * lands; a failed read leaves the last known value (the chain still enforces
 * all of it regardless of what this hook shows).
 */
export function useFactoryState() {
    const [state, setState] = useState<{
        paused: boolean
        minBuyInUsd: number
        maxBuyInUsd: number | null
        winnerBps: number
        maxReferrerBps: number
    } | null>(null)
    useEffect(() => {
        let alive = true
        const load = () =>
            getFactoryState()
                .then((s) => alive && setState(s))
                .catch((err) => console.error("failed to read factory state", err))
        load()
        const id = setInterval(load, 30_000)
        return () => {
            alive = false
            clearInterval(id)
        }
    }, [])
    return state
}
