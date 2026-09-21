"use client"

import { useEffect, useState } from "react"

export interface ReferralCheckpoint {
    thresholdUsd: number
    points: number
    hit: boolean
}

export interface ReferralCommission {
    duelId: string
    matchup: string
    referredWallet: string
    buyInUsd: number
    bps: number
    commissionUsd: number
    settledAt?: string
}

export interface ReferralDashboardData {
    wallet: string
    referralCode: string | null
    referredByWallet: string | null
    referredCount: number
    tier: {
        bps: number
        volumeUsd: number
        nextBps: number | null
        nextThresholdUsd: number | null
        maxBps: number
    }
    earningsUsd: number
    volumeCheckpoints: ReferralCheckpoint[]
    earningsCheckpoints: ReferralCheckpoint[]
    recentReferrals: {
        wallet: string
        verified: boolean
        sybilFlagged: boolean
        joinedAt: string
        volumeUsd: number
    }[]
    recentCommissions: ReferralCommission[]
}

/**
 * Polls /api/referrals/[wallet] every 15s -- the same "re-read on an
 * interval" pattern as useFactoryState, chosen over a websocket since a
 * settlement crediting a new commission is a rare, not-latency-sensitive
 * event. A failed poll keeps the last known value on screen rather than
 * blanking it.
 */
export function useReferralDashboard(wallet: string | undefined) {
    const [data, setData] = useState<ReferralDashboardData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!wallet) {
            setData(null)
            setLoading(false)
            return
        }
        let alive = true
        const load = () =>
            fetch(`/api/referrals/${wallet}`)
                .then((r) => r.json())
                .then((json) => {
                    if (!alive) return
                    if (json.success) {
                        setData(json.data)
                        setError(null)
                    } else {
                        setError(typeof json.error === "string" ? json.error : "Could not load referral data.")
                    }
                })
                .catch(() => alive && setError("Could not load referral data."))
                .finally(() => alive && setLoading(false))

        setLoading(true)
        load()
        const id = setInterval(load, 15_000)
        return () => {
            alive = false
            clearInterval(id)
        }
    }, [wallet])

    return { data, loading, error }
}
