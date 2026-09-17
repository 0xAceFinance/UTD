"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Fades and slides a section up once it scrolls into view, then leaves it
 * alone -- no re-triggering on scroll back up. Respects prefers-reduced-motion
 * by rendering visible immediately instead of animating.
 */
export function Reveal({
    children,
    className,
    delayMs = 0,
}: {
    children: React.ReactNode
    className?: string
    delayMs?: number
}) {
    const ref = useRef<HTMLDivElement>(null)
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setVisible(true)
            return
        }
        const el = ref.current
        if (!el) return
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true)
                    observer.disconnect()
                }
            },
            { threshold: 0.15 }
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    return (
        <div
            ref={ref}
            style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
            className={cn(
                "transition-all duration-700 ease-out",
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8",
                className
            )}
        >
            {children}
        </div>
    )
}
