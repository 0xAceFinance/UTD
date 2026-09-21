"use client"

// UTD Retro-Arcade Synthesized Sound Engine
// High-energy 8-bit / 16-bit procedural synthesis using Web Audio API.
// Zero external audio files -- 0ms latency, zero bandwidth, zero CORS issues.

export type SoundType =
    | "toggleOn"     // Sound enabled (ascending 3-tone power-up chime)
    | "toggleOff"    // Sound disabled (descending 3-tone power-down chime)
    | "click"        // Tactile mechanical microswitch click
    | "tab"          // High-tech UI blip/chirp
    | "coin"         // Classic arcade coin insert credit chime
    | "fightStart"   // Heavy combat arena gong & sub-bass punch
    | "pump"         // Price rally / laser surge
    | "dump"         // Price dump / crunchy 8-bit impact
    | "whoosh"       // Tug-of-war momentum swing
    | "peakWarning"  // 30s Sustained Peak radar / sonar ping
    | "victory"      // Triumphant 4-note victory fanfare
    | "defeat"       // Game over / defeat slide

class ArcadeAudioEngine {
    private ctx: AudioContext | null = null
    private _enabled: boolean = true
    private masterGain: GainNode | null = null
    private compressor: DynamicsCompressorNode | null = null

    constructor() {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("utd_sfx_enabled")
            this._enabled = saved !== null ? saved === "true" : true
        }
    }

    public get isEnabled(): boolean {
        return this._enabled
    }

    public setEnabled(val: boolean) {
        this._enabled = val
        if (typeof window !== "undefined") {
            localStorage.setItem("utd_sfx_enabled", String(val))
        }
    }

    /**
     * Initializes or resumes the AudioContext synchronously within a user gesture.
     */
    public ensureContext(): AudioContext | null {
        if (typeof window === "undefined") return null

        if (!this.ctx) {
            const AudioContextClass =
                window.AudioContext ||
                (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext

            if (AudioContextClass) {
                this.ctx = new AudioContextClass()

                // Master Dynamics Compressor to prevent harsh digital clipping
                this.compressor = this.ctx.createDynamicsCompressor()
                this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime)
                this.compressor.knee.setValueAtTime(8, this.ctx.currentTime)
                this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime)
                this.compressor.attack.setValueAtTime(0.005, this.ctx.currentTime)
                this.compressor.release.setValueAtTime(0.05, this.ctx.currentTime)

                // Master Gain Node (healthy, audible 0.5 level)
                this.masterGain = this.ctx.createGain()
                this.masterGain.gain.setValueAtTime(0.5, this.ctx.currentTime)

                this.compressor.connect(this.masterGain)
                this.masterGain.connect(this.ctx.destination)
            }
        }

        if (this.ctx && this.ctx.state === "suspended") {
            this.ctx.resume().catch(() => {})
        }

        return this.ctx
    }

    /**
     * Synthesizes and plays a designated arcade sound effect.
     */
    public play(type: SoundType, options?: { pitch?: number; volume?: number }) {
        if (!this._enabled && type !== "toggleOff") return

        const ctx = this.ensureContext()
        if (!ctx || !this.compressor) return

        try {
            // Always schedule with a tiny 4ms safety margin to avoid past-time drops
            const now = ctx.currentTime + 0.004
            const vol = Math.min(1.0, (options?.volume ?? 1) * 0.7)

            switch (type) {
                case "toggleOn": {
                    // Bright ascending 3-tone arcade power-up chime (C5 -> G5 -> C6)
                    const notes = [523.25, 783.99, 1046.5]
                    notes.forEach((freq, i) => {
                        const osc = ctx.createOscillator()
                        const gain = ctx.createGain()
                        osc.type = "square"

                        const start = now + i * 0.065
                        const dur = i === 2 ? 0.18 : 0.08

                        osc.frequency.setValueAtTime(freq, start)

                        gain.gain.setValueAtTime(0.001, start)
                        gain.gain.linearRampToValueAtTime(vol * 0.6, start + 0.01)
                        gain.gain.exponentialRampToValueAtTime(0.001, start + dur)

                        osc.connect(gain)
                        gain.connect(this.compressor!)

                        osc.start(start)
                        osc.stop(start + dur)
                    })
                    break
                }

                case "toggleOff": {
                    // Soft descending 3-tone arcade power-down chime (A5 -> E5 -> A4)
                    const notes = [880.0, 659.25, 440.0]
                    notes.forEach((freq, i) => {
                        const osc = ctx.createOscillator()
                        const gain = ctx.createGain()
                        osc.type = "triangle"

                        const start = now + i * 0.065
                        const dur = i === 2 ? 0.16 : 0.08

                        osc.frequency.setValueAtTime(freq, start)

                        gain.gain.setValueAtTime(0.001, start)
                        gain.gain.linearRampToValueAtTime(vol * 0.5, start + 0.01)
                        gain.gain.exponentialRampToValueAtTime(0.001, start + dur)

                        osc.connect(gain)
                        gain.connect(this.compressor!)

                        osc.start(start)
                        osc.stop(start + dur)
                    })
                    break
                }

                case "click": {
                    // Snappy tactile mechanical arcade microswitch
                    const osc = ctx.createOscillator()
                    const gain = ctx.createGain()
                    osc.type = "square"
                    osc.frequency.setValueAtTime(1200, now)
                    osc.frequency.exponentialRampToValueAtTime(300, now + 0.04)

                    gain.gain.setValueAtTime(vol * 0.45, now)
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)

                    osc.connect(gain)
                    gain.connect(this.compressor)
                    osc.start(now)
                    osc.stop(now + 0.04)
                    break
                }

                case "tab": {
                    // High-tech UI chirp (ascending short blip)
                    const osc = ctx.createOscillator()
                    const gain = ctx.createGain()
                    osc.type = "triangle"
                    osc.frequency.setValueAtTime(650, now)
                    osc.frequency.exponentialRampToValueAtTime(1300, now + 0.055)

                    gain.gain.setValueAtTime(0.001, now)
                    gain.gain.linearRampToValueAtTime(vol * 0.45, now + 0.01)
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055)

                    osc.connect(gain)
                    gain.connect(this.compressor)
                    osc.start(now)
                    osc.stop(now + 0.055)
                    break
                }

                case "coin": {
                    // Authentic dual-tone arcade credit insert (B5 -> E6)
                    const osc1 = ctx.createOscillator()
                    const osc2 = ctx.createOscillator()
                    const gain1 = ctx.createGain()
                    const gain2 = ctx.createGain()

                    osc1.type = "square"
                    osc2.type = "square"

                    // Tone 1: 987.77Hz (B5) for 75ms
                    osc1.frequency.setValueAtTime(987.77, now)
                    gain1.gain.setValueAtTime(vol * 0.6, now)
                    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.075)

                    // Tone 2: 1318.51Hz (E6) for 280ms
                    const start2 = now + 0.075
                    osc2.frequency.setValueAtTime(1318.51, start2)
                    gain2.gain.setValueAtTime(vol * 0.65, start2)
                    gain2.gain.exponentialRampToValueAtTime(0.001, start2 + 0.28)

                    osc1.connect(gain1)
                    gain1.connect(this.compressor)
                    osc2.connect(gain2)
                    gain2.connect(this.compressor)

                    osc1.start(now)
                    osc1.stop(now + 0.075)
                    osc2.start(start2)
                    osc2.stop(start2 + 0.28)
                    break
                }

                case "fightStart": {
                    // Deep combat arena gong + metallic sub-bass punch
                    const sub = ctx.createOscillator()
                    const subGain = ctx.createGain()
                    sub.type = "sawtooth"
                    sub.frequency.setValueAtTime(150, now)
                    sub.frequency.exponentialRampToValueAtTime(45, now + 0.45)

                    subGain.gain.setValueAtTime(vol * 0.9, now)
                    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)

                    // Metallic dissonant bell ring
                    const gong = ctx.createOscillator()
                    const gongGain = ctx.createGain()
                    gong.type = "triangle"
                    gong.frequency.setValueAtTime(440, now)
                    gong.frequency.exponentialRampToValueAtTime(220, now + 0.7)
                    gongGain.gain.setValueAtTime(vol * 0.45, now)
                    gongGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7)

                    sub.connect(subGain)
                    subGain.connect(this.compressor)
                    gong.connect(gongGain)
                    gongGain.connect(this.compressor)

                    sub.start(now)
                    sub.stop(now + 0.6)
                    gong.start(now)
                    gong.stop(now + 0.7)
                    break
                }

                case "pump": {
                    // Ascending high-voltage sawtooth laser surge
                    const osc = ctx.createOscillator()
                    const gain = ctx.createGain()
                    osc.type = "sawtooth"
                    const baseFreq = 260 * (options?.pitch ?? 1)
                    osc.frequency.setValueAtTime(baseFreq, now)
                    osc.frequency.exponentialRampToValueAtTime(baseFreq * 3.2, now + 0.2)

                    gain.gain.setValueAtTime(vol * 0.6, now)
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)

                    osc.connect(gain)
                    gain.connect(this.compressor)
                    osc.start(now)
                    osc.stop(now + 0.2)
                    break
                }

                case "dump": {
                    // 8-bit noise crunch / impact punch
                    const bufferSize = Math.floor(ctx.sampleRate * 0.16)
                    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
                    const data = buffer.getChannelData(0)
                    for (let i = 0; i < bufferSize; i++) {
                        data[i] = Math.random() * 2 - 1
                    }
                    const noise = ctx.createBufferSource()
                    noise.buffer = buffer

                    const filter = ctx.createBiquadFilter()
                    filter.type = "lowpass"
                    filter.frequency.setValueAtTime(600, now)
                    filter.frequency.exponentialRampToValueAtTime(80, now + 0.16)

                    const gain = ctx.createGain()
                    gain.gain.setValueAtTime(vol * 0.7, now)
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16)

                    noise.connect(filter)
                    filter.connect(gain)
                    gain.connect(this.compressor)
                    noise.start(now)
                    break
                }

                case "whoosh": {
                    // Resonant bandpass momentum sweep across 50/50
                    const osc = ctx.createOscillator()
                    const gain = ctx.createGain()
                    osc.type = "sine"
                    osc.frequency.setValueAtTime(220, now)
                    osc.frequency.exponentialRampToValueAtTime(660, now + 0.1)
                    osc.frequency.exponentialRampToValueAtTime(140, now + 0.24)

                    gain.gain.setValueAtTime(0.01, now)
                    gain.gain.linearRampToValueAtTime(vol * 0.5, now + 0.08)
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24)

                    osc.connect(gain)
                    gain.connect(this.compressor)
                    osc.start(now)
                    osc.stop(now + 0.24)
                    break
                }

                case "peakWarning": {
                    // High-tension sonar / radar ping for 30s sustained peak dwell
                    const osc = ctx.createOscillator()
                    const gain = ctx.createGain()
                    osc.type = "sine"
                    osc.frequency.setValueAtTime(960, now)
                    osc.frequency.exponentialRampToValueAtTime(910, now + 0.12)

                    gain.gain.setValueAtTime(vol * 0.55, now)
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

                    osc.connect(gain)
                    gain.connect(this.compressor)
                    osc.start(now)
                    osc.stop(now + 0.12)
                    break
                }

                case "victory": {
                    // Triumphant 4-note major arpeggio fanfare (C5 -> E5 -> G5 -> C6)
                    const notes = [523.25, 659.25, 783.99, 1046.5]
                    notes.forEach((freq, idx) => {
                        const osc = ctx.createOscillator()
                        const gain = ctx.createGain()
                        osc.type = "square"
                        const noteStart = now + idx * 0.09
                        const dur = idx === 3 ? 0.35 : 0.12

                        osc.frequency.setValueAtTime(freq, noteStart)

                        gain.gain.setValueAtTime(vol * 0.55, noteStart)
                        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + dur)

                        osc.connect(gain)
                        gain.connect(this.compressor!)
                        osc.start(noteStart)
                        osc.stop(noteStart + dur)
                    })
                    break
                }

                case "defeat": {
                    // Melancholic descending game-over slide
                    const notes = [440, 392, 330, 220]
                    notes.forEach((freq, idx) => {
                        const osc = ctx.createOscillator()
                        const gain = ctx.createGain()
                        osc.type = "sawtooth"
                        const noteStart = now + idx * 0.11
                        const dur = 0.16

                        osc.frequency.setValueAtTime(freq, noteStart)
                        osc.frequency.exponentialRampToValueAtTime(freq * 0.8, noteStart + dur)

                        gain.gain.setValueAtTime(vol * 0.45, noteStart)
                        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + dur)

                        osc.connect(gain)
                        gain.connect(this.compressor!)
                        osc.start(noteStart)
                        osc.stop(noteStart + dur)
                    })
                    break
                }
            }
        } catch {}
    }
}

export const arcadeAudio = new ArcadeAudioEngine()
