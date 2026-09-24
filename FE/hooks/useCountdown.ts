"use client"

import { useEffect, useState } from "react"

/** Ticks once a second toward `target` (ISO date); `totalSec` clamps at 0. No target → 00:00. */
export function useCountdown(target?: string) {
    const [remaining, setRemaining] = useState(0)
    useEffect(() => {
        if (!target) {
            setRemaining(0)
            return
        }
        const tick = () => setRemaining(Math.max(0, new Date(target).getTime() - Date.now()))
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [target])
    const totalSec = Math.floor(remaining / 1000)
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0")
    const ss = String(totalSec % 60).padStart(2, "0")
    return { label: `${mm}:${ss}`, totalSec }
}
