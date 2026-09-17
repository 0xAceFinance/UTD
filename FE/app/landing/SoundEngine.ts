"use client"

// Pure Web Audio API synthesized retro 8-bit sound engine - zero audio file dependencies
class SoundEngine {
    private ctx: AudioContext | null = null
    public enabled: boolean = false

    private getContext(): AudioContext | null {
        if (typeof window === "undefined") return null
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            if (AudioCtx) {
                this.ctx = new AudioCtx()
            }
        }
        if (this.ctx && this.ctx.state === "suspended") {
            this.ctx.resume().catch(() => {})
        }
        return this.ctx
    }

    public toggleSound(): boolean {
        this.enabled = !this.enabled
        if (this.enabled) {
            this.playBlip(600)
        }
        return this.enabled
    }

    public playBlip(freq: number = 440) {
        if (!this.enabled) return
        const ctx = this.getContext()
        if (!ctx) return

        try {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "square"
            osc.frequency.setValueAtTime(freq, ctx.currentTime)
            osc.frequency.exponentialRampToValueAtTime(freq * 0.5, ctx.currentTime + 0.05)

            gain.gain.setValueAtTime(0.08, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.start()
            osc.stop(ctx.currentTime + 0.05)
        } catch {}
    }

    public playPump(boostLevel: number = 1) {
        if (!this.enabled) return
        const ctx = this.getContext()
        if (!ctx) return

        try {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = "sawtooth"
            const startFreq = 220 + boostLevel * 40
            osc.frequency.setValueAtTime(startFreq, ctx.currentTime)
            osc.frequency.exponentialRampToValueAtTime(startFreq * 2.2, ctx.currentTime + 0.12)

            gain.gain.setValueAtTime(0.12, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.start()
            osc.stop(ctx.currentTime + 0.12)
        } catch {}
    }

    public playWin() {
        if (!this.enabled) return
        const ctx = this.getContext()
        if (!ctx) return

        try {
            const notes = [440, 554, 659, 880]
            notes.forEach((note, i) => {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = "triangle"
                osc.frequency.setValueAtTime(note, ctx.currentTime + i * 0.08)

                gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.08)
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (i + 1) * 0.08 + 0.1)

                osc.connect(gain)
                gain.connect(ctx.destination)

                osc.start(ctx.currentTime + i * 0.08)
                osc.stop(ctx.currentTime + (i + 1) * 0.08 + 0.1)
            })
        } catch {}
    }

    public playDefeat() {
        if (!this.enabled) return
        const ctx = this.getContext()
        if (!ctx) return

        try {
            const notes = [330, 290, 220]
            notes.forEach((note, i) => {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = "sawtooth"
                osc.frequency.setValueAtTime(note, ctx.currentTime + i * 0.1)

                gain.gain.setValueAtTime(0.09, ctx.currentTime + i * 0.1)
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (i + 1) * 0.1 + 0.05)

                osc.connect(gain)
                gain.connect(ctx.destination)

                osc.start(ctx.currentTime + i * 0.1)
                osc.stop(ctx.currentTime + (i + 1) * 0.1 + 0.05)
            })
        } catch {}
    }
}

export const sound = new SoundEngine()
