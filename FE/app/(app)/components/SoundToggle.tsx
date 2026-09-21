"use client"

import { useState, useEffect } from "react"
import { Volume2, VolumeX } from "lucide-react"
import { arcadeAudio } from "@/lib/sound/arcadeAudio"

export function SoundToggle() {
    const [enabled, setEnabled] = useState(true)
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        setEnabled(arcadeAudio.isEnabled)
    }, [])

    const handleToggle = () => {
        arcadeAudio.ensureContext()

        if (enabled) {
            // Play power-down cue before muting
            arcadeAudio.play("toggleOff")
            setTimeout(() => {
                arcadeAudio.setEnabled(false)
                setEnabled(false)
            }, 120)
        } else {
            // Enable and play bright power-up cue
            arcadeAudio.setEnabled(true)
            setEnabled(true)
            arcadeAudio.play("toggleOn")
        }
    }

    if (!mounted) {
        return (
            <div className="h-9 w-9 border border-[var(--line-2)] bg-[var(--s1)] opacity-50" />
        )
    }

    return (
        <button
            onClick={handleToggle}
            type="button"
            title={enabled ? "Mute Arcade SFX (Plays power-down chime)" : "Unmute Arcade SFX (Plays power-up chime)"}
            aria-label={enabled ? "Mute Arcade Sound Effects" : "Unmute Arcade Sound Effects"}
            className={`flex h-9 items-center gap-1.5 border px-2.5 font-mono text-[11px] transition-all select-none ${
                enabled
                    ? "border-[var(--acid)] bg-[var(--s1)] text-[var(--acid)] shadow-[0_0_8px_rgba(43,232,132,0.25)] hover:bg-[var(--acid)]/10"
                    : "border-[var(--line-2)] bg-[var(--s1)] text-[var(--dim)] hover:border-[var(--line-1)] hover:text-white"
            }`}
        >
            {enabled ? (
                <>
                    <Volume2 className="h-3.5 w-3.5 animate-pulse" />
                    <span className="hidden sm:inline utd-pixel text-[9px]">SFX ON</span>
                </>
            ) : (
                <>
                    <VolumeX className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline utd-pixel text-[9px]">SFX OFF</span>
                </>
            )}
        </button>
    )
}
