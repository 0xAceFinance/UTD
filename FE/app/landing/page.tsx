"use client"

import { useState } from "react"
import "./theme.css"
import { ThePitGame } from "./ThePitGame"
import { CombatCard3D } from "./CombatCard3D"
import { WhitelistTerminal } from "./WhitelistTerminal"
import { GladiatorTicker } from "./GladiatorTicker"
import { FaqSection } from "./FaqSection"
import { SectionHeading } from "./SectionHeading"
import { sound } from "./SoundEngine"
import { Volume2, VolumeX } from "lucide-react"

const RULES = [
    {
        num: "01",
        title: "BUY ONLY",
        body: "Two tokens, 15 to 40 minutes, no selling until the clock runs out. Whoever climbs further takes the match.",
        note: "15–40 min rounds",
    },
    {
        num: "02",
        title: "PEAKS HOLD",
        body: "A price has to stay up for 30 seconds against a 60-second average before it counts. Single-block spikes get thrown out.",
        note: "30s dwell · 60s TWAP",
    },
    {
        num: "03",
        title: "NO CUSTODY",
        body: "Every match gets its own escrow contract. No company wallet sits in the path. There is no admin withdrawal function to call.",
        note: "80/20 on settle",
    },
]

const STATS = [
    { value: "80%", label: "to the winner" },
    { value: "15–40", label: "minutes a round" },
    { value: "30s", label: "peak must hold" },
    { value: "0", label: "admin withdrawals" },
]

const NAV = [
    { href: "#pit", label: "THE PIT" },
    { href: "#rules", label: "RULES" },
    { href: "#roster", label: "FIGHTERS" },
    { href: "#faq", label: "FAQ" },
]

export default function LandingPage() {
    const [soundOn, setSoundOn] = useState(false)

    return (
        <div className="utd min-h-screen selection:bg-[var(--acid)]/25">
            <nav className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--s0)]/95 backdrop-blur">
                <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
                    <a href="#top" className="flex items-center gap-3">
                        <img src="/logo-mark.png" alt="" className="utd-mark h-9 w-9" />
                        <span className="utd-pixel text-[13px] text-white">UTD</span>
                    </a>

                    <div className="hidden items-center gap-6 md:flex">
                        {NAV.map((item) => (
                            <a
                                key={item.href}
                                href={item.href}
                                className="utd-pixel text-[9px] text-[var(--dim)] transition-colors hover:text-[var(--acid)]"
                            >
                                {item.label}
                            </a>
                        ))}
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setSoundOn(sound.toggleSound())}
                            aria-pressed={soundOn}
                            aria-label={soundOn ? "Mute sound" : "Unmute sound"}
                            className={`transition-colors ${
                                soundOn
                                    ? "text-[var(--acid)]"
                                    : "text-[var(--faint)] hover:text-[var(--dim)]"
                            }`}
                        >
                            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                        </button>

                        <span className="utd-btn-static px-4 py-2.5 text-[9px]">
                            <i />
                            LAUNCHING SOON
                        </span>
                    </div>
                </div>
            </nav>

            <main id="top" className="mx-auto max-w-5xl px-6 pb-24">
                {/* Hero. Pixel type with hard-coded line breaks so it never wraps
                    mid-clause the way the old auto-wrapping 48px headline did. */}
                <header className="pt-16 pb-14 sm:pt-24 sm:pb-20">
                    <div className="flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:gap-10">
                        <img
                            src="/logo-mark.png"
                            alt=""
                            className="utd-mark h-24 w-24 flex-none sm:h-32 sm:w-32"
                        />

                        <div>
                            <h1 className="utd-pixel text-[clamp(0.95rem,2.7vw,1.6rem)] text-white">
                                TWO TOKENS.
                                <br />
                                ONE TIMER.
                                <br />
                                <span className="text-[var(--acid)]">
                                    WHOEVER PUMPS
                                    <br />
                                    HARDER WINS.
                                </span>
                            </h1>
                        </div>
                    </div>

                    <p className="utd-body mt-9 max-w-xl text-[15px] text-[var(--dim)]">
                        Pick a side and lock an equal stake. The winner is whichever token gained more
                        by the time the clock hits zero, counting only price that actually held. The
                        pot pays out of an escrow contract nobody can reach into.
                    </p>

                    <div className="mt-8">
                        <span className="utd-btn-static px-7 py-4 text-[11px]">
                            <i />
                            LAUNCHING SOON
                        </span>
                    </div>

                    <dl className="mt-14 grid grid-cols-2 gap-px bg-[var(--line)] sm:grid-cols-4">
                        {STATS.map((s) => (
                            <div key={s.label} className="bg-[var(--s1)] px-4 py-5">
                                <dt className="utd-pixel text-base text-[var(--acid)] sm:text-lg">
                                    {s.value}
                                </dt>
                                <dd className="utd-body mt-2.5 text-[13px] text-[var(--dim)]">
                                    {s.label}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </header>

                <section id="pit" className="scroll-mt-24 py-14">
                    <SectionHeading
                        title="THE PIT"
                        aside="A 30-second duel on loop. Fake credits, no wallet, nothing at stake."
                    />
                    <div className="mt-7">
                        <ThePitGame />
                    </div>
                </section>

                <section id="rules" className="scroll-mt-24 border-t border-[var(--line)] py-14">
                    <SectionHeading title="THE RULES" aside="The contract enforces all three." />

                    <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-3">
                        {RULES.map((rule) => (
                            <div key={rule.num} className="utd-panel utd-ticks flex flex-col p-6">
                                <div className="utd-pixel text-[13px] text-[var(--acid)]">{rule.num}</div>
                                <h3 className="utd-pixel mt-4 text-[11px] text-white">{rule.title}</h3>
                                <p className="utd-body mt-3.5 flex-1 text-[14px] text-[var(--dim)]">
                                    {rule.body}
                                </p>
                                <div className="mt-6 font-mono text-[11px] text-[var(--faint)]">
                                    {rule.note}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section id="nft" className="scroll-mt-24 border-t border-[var(--line)] py-14">
                    <CombatCard3D />
                </section>

                <section id="roster" className="scroll-mt-24 border-t border-[var(--line)] py-14">
                    <SectionHeading
                        title="FIGHTERS"
                        aside="Screened daily on liquidity depth, volume and contract safety."
                    />
                    <div className="mt-7">
                        <GladiatorTicker />
                    </div>
                </section>

                <section id="whitelist" className="scroll-mt-24 border-t border-[var(--line)] py-14">
                    <WhitelistTerminal />
                </section>

                <section id="faq" className="scroll-mt-24 border-t border-[var(--line)] py-14">
                    <SectionHeading title="FAQ" />
                    <div className="mt-7">
                        <FaqSection />
                    </div>
                </section>
            </main>

            <footer className="border-t border-[var(--line)]">
                <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-5 px-6 py-8 sm:flex-row">
                    <div className="flex items-center gap-3">
                        <img src="/logo-mark.png" alt="" className="utd-mark h-7 w-7" />
                        <span className="utd-pixel text-[9px] text-[var(--dim)]">UTD</span>
                    </div>

                    <div className="flex items-center gap-5">
                        {NAV.map((item) => (
                            <a
                                key={item.href}
                                href={item.href}
                                className="utd-pixel text-[8px] text-[var(--faint)] transition-colors hover:text-[var(--acid)]"
                            >
                                {item.label}
                            </a>
                        ))}
                    </div>

                    <div className="font-mono text-[11px] text-[var(--faint)]">© 2026 UTD</div>
                </div>
            </footer>
        </div>
    )
}
