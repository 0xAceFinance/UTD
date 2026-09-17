import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Reveal } from "./Reveal"
import { SideTag, TierBadge } from "../(app)/components/duel/SideTag"

const STEPS = [
    {
        title: "Today's gladiators",
        body: "Every 24 hours we scan the chain and filter down to today's roster: only tokens clearing hard gates on market cap, liquidity, volume, age, and rug-check.",
    },
    {
        title: "Create or join",
        body: "Pick two gladiators, pick your side, set a buy-in and a battle duration from 15 to 40 minutes.",
    },
    {
        title: "The clock runs",
        body: "Whoever's token posts the higher validated market-cap gain when time runs out wins the duel.",
    },
    {
        title: "Winner takes 80%",
        body: "The pot splits automatically on-chain: 80% to the winner, 20% to the platform. The loser still earns participation points.",
    },
]

const TRUST = [
    {
        title: "No house edge on price",
        body: "Market caps run through a real oracle: a liquidity-weighted median across every real pool, a 60-second time-weighted average, and a sustained-peak check that only counts a new high if it holds for 30 seconds. A single manipulated trade or a one-block wick can't decide a duel.",
        icon: (
            <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2 L20 6 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V6 Z" />
                <path d="M9 12 L11 14 L15 9" />
            </svg>
        ),
    },
    {
        title: "Funds never touch a company wallet",
        body: "Every duel's stake sits in its own isolated on-chain escrow from the moment you lock in. The contract has no owner-withdrawal path of any kind, funds only ever move to the winner, back to you if nobody joins, or split 80/20 at settlement.",
        icon: (
            <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="9" />
                <path d="M8 11 V7 a4 4 0 0 1 8 0 V11" />
            </svg>
        ),
    },
    {
        title: "Settlement is permissionless",
        body: "Anyone can trigger a duel's payout the moment it's due, not just us. A duel can always be settled, even if our own servers are down.",
        icon: (
            <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="9" />
                <path d="M8 11 V7 a4 4 0 0 1 7.5 -2" />
            </svg>
        ),
    },
]

const GLADIATORS = [
    { symbol: "PEPI", change: 18.2, mc: "$1.2M" },
    { symbol: "WOJK", change: -4.6, mc: "$2.1M" },
    { symbol: "BASD", change: 22.4, mc: "$1.1M" },
    { symbol: "FRGO", change: 9.7, mc: "$900K" },
    { symbol: "DGEN", change: -11.3, mc: "$780K" },
    { symbol: "MOOR", change: 31.5, mc: "$650K" },
]

const TIERS: { tier: "Bronze" | "Silver" | "Gold" | "Diamond"; pts: string }[] = [
    { tier: "Bronze", pts: "0+ pts" },
    { tier: "Silver", pts: "5,000+ pts" },
    { tier: "Gold", pts: "25,000+ pts" },
    { tier: "Diamond", pts: "100,000+ pts" },
]

function GladiatorTile({ symbol, change, mc }: { symbol: string; change: number; mc: string }) {
    return (
        <Card className="min-w-[126px] flex-none cursor-default p-4 text-center">
            <div className="text-sm font-bold text-primary">{symbol}</div>
            <div className={`tabular mt-1.5 text-xs font-semibold ${change >= 0 ? "text-[hsl(var(--good))]" : "text-destructive"}`}>
                {change >= 0 ? "+" : ""}
                {change}%
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">{mc} MC</div>
        </Card>
    )
}

export default function LandingPage() {
    return (
        <div className="min-h-screen">
            <nav className="sticky top-0 z-20 border-b border-border/50 bg-card/85 backdrop-blur">
                <div className="mx-auto flex h-[72px] max-w-[1180px] items-center justify-between gap-6 px-6">
                    <img src="/logo.png" alt="UTD emblem" className="h-10 w-auto object-contain" />
                    <span className="font-pixel text-[10px] uppercase tracking-wide text-primary/80">Launching Soon</span>
                </div>
            </nav>

            <main className="mx-auto max-w-[1180px] px-6">
                <header className="animate-in fade-in duration-700 py-16 text-center sm:py-24">
                    <img src="/logo.png" alt="UTD emblem" className="float-bob mx-auto h-28 w-auto object-contain sm:h-36" />
                    <h1 className="glow-text mt-8 text-3xl text-primary sm:text-5xl">Underground Token Duel</h1>
                    <p className="mx-auto mt-5 max-w-xl text-base text-foreground/85 sm:text-lg">
                        Pick a side. Lock a stake. Whoever pumps harder wins.
                    </p>
                    <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
                        <Button size="lg" disabled variant="secondary">
                            Launching Soon
                        </Button>
                        <a href="#how-it-works">
                            <Button size="lg" variant="outline">
                                See How It Works
                            </Button>
                        </a>
                    </div>
                    <div className="mx-auto mt-14 grid max-w-xl grid-cols-3 gap-4">
                        <Card className="p-5 text-center">
                            <div className="font-pixel text-xl text-primary">[LIVE]</div>
                            <div className="mt-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Live Duels</div>
                        </Card>
                        <Card className="p-5 text-center">
                            <div className="font-pixel text-xl text-primary">[OPEN]</div>
                            <div className="mt-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Open Lobbies</div>
                        </Card>
                        <Card className="p-5 text-center">
                            <div className="font-pixel text-xl text-primary">[TOTAL]</div>
                            <div className="mt-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">Duels Fought</div>
                        </Card>
                    </div>
                </header>

                <section id="how-it-works" className="py-16 sm:py-20">
                    <Reveal className="text-center">
                        <div className="font-pixel mb-3 text-[10px] uppercase tracking-[0.12em] text-primary">The Loop</div>
                        <h2 className="text-xl sm:text-2xl">Four steps. Fifteen to forty minutes.</h2>
                        <p className="mx-auto mt-3 mb-10 max-w-md text-sm text-muted-foreground">
                            Every duel runs the same real pipeline, start to finish.
                        </p>
                    </Reveal>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                        {STEPS.map((step, i) => (
                            <Reveal key={step.title} delayMs={i * 100}>
                                <div>
                                    <div className="font-pixel flex h-8 w-8 items-center justify-center border-2 border-primary text-xs text-primary">
                                        {i + 1}
                                    </div>
                                    <h3 className="mt-4 text-sm">{step.title}</h3>
                                    <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">{step.body}</p>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                </section>

                <section className="py-16 sm:py-20">
                    <Reveal className="text-center">
                        <div className="font-pixel mb-3 text-[10px] uppercase tracking-[0.12em] text-primary">Why Trust It</div>
                        <h2 className="text-xl sm:text-2xl">Built so nobody has to take our word for it</h2>
                        <p className="mx-auto mt-3 mb-10 max-w-md text-sm text-muted-foreground">
                            Three guarantees that come from the mechanics, not a promise.
                        </p>
                    </Reveal>
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                        {TRUST.map((item, i) => (
                            <Reveal key={item.title} delayMs={i * 100}>
                                <Card className="h-full p-7">
                                    <div className="mb-4 flex h-11 w-11 items-center justify-center border-2 border-primary/40 bg-primary/10 text-primary">
                                        {item.icon}
                                    </div>
                                    <h3 className="text-sm">{item.title}</h3>
                                    <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">{item.body}</p>
                                </Card>
                            </Reveal>
                        ))}
                    </div>
                </section>

                <section className="py-16 sm:py-20">
                    <Reveal className="text-center">
                        <div className="font-pixel mb-3 text-[10px] uppercase tracking-[0.12em] text-primary">Today's Roster</div>
                        <h2 className="text-xl sm:text-2xl">Today's Gladiators</h2>
                        <p className="mt-3 mb-8 text-[11px] uppercase tracking-wide text-muted-foreground">Preview only, not live data</p>
                    </Reveal>
                    <Reveal>
                        <Card className="overflow-hidden p-5">
                            <div className="flex w-max gap-3.5 overflow-hidden">
                                <div className="marquee-track flex flex-none gap-3.5">
                                    {[...GLADIATORS, ...GLADIATORS].map((g, i) => (
                                        <GladiatorTile key={`${g.symbol}-${i}`} {...g} />
                                    ))}
                                </div>
                            </div>
                        </Card>
                    </Reveal>
                </section>

                <section className="py-16 sm:py-20">
                    <Reveal className="text-center">
                        <div className="font-pixel mb-3 text-[10px] uppercase tracking-[0.12em] text-primary">Inside The Arena</div>
                        <h2 className="text-xl sm:text-2xl">This is what a duel looks like</h2>
                        <p className="mt-3 mb-8 text-[11px] uppercase tracking-wide text-muted-foreground">Illustrative matchup, not a real duel</p>
                    </Reveal>
                    <Reveal>
                        <Card className="p-6 sm:p-9">
                            <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
                                <div
                                    className="border-2 p-5 text-center"
                                    style={{ borderColor: "hsl(var(--side-a))", background: "hsl(var(--side-a)/0.08)" }}
                                >
                                    <SideTag side="A" label="PEPI" />
                                    <div className="mt-3.5 text-[11px] text-muted-foreground">Starting MC: $1.2M</div>
                                    <div className="font-pixel mt-1 text-xl text-[hsl(var(--good))]">+14.2%</div>
                                </div>
                                <div className="flex flex-col items-center gap-1 py-2">
                                    <div className="font-pixel text-2xl text-primary">VS</div>
                                    <div className="font-pixel mt-2 text-xl text-primary">07:42</div>
                                    <div className="mt-1.5 text-[11px] uppercase text-muted-foreground">Pot: $200</div>
                                </div>
                                <div
                                    className="border-2 p-5 text-center"
                                    style={{ borderColor: "hsl(var(--side-b))", background: "hsl(var(--side-b)/0.08)" }}
                                >
                                    <SideTag side="B" label="WOJK" />
                                    <div className="mt-3.5 text-[11px] text-muted-foreground">Starting MC: $2.1M</div>
                                    <div className="font-pixel mt-1 text-xl text-destructive">-3.8%</div>
                                </div>
                            </div>
                            <div className="mt-7 text-center text-sm font-semibold text-[hsl(var(--good))]">
                                80% of the pot to whoever's ahead when the clock hits zero
                            </div>
                        </Card>
                    </Reveal>
                </section>

                <section className="py-16 sm:py-20">
                    <Reveal className="text-center">
                        <div className="font-pixel mb-3 text-[10px] uppercase tracking-[0.12em] text-primary">Progression</div>
                        <h2 className="text-xl sm:text-2xl">Every duel earns points</h2>
                        <p className="mx-auto mt-3 mb-10 max-w-md text-sm text-muted-foreground">
                            Winners earn far more than losers, but nobody walks away empty-handed. Lifetime points build toward four tiers.
                        </p>
                    </Reveal>
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        {TIERS.map((t, i) => (
                            <Reveal key={t.tier} delayMs={i * 80}>
                                <Card className="flex flex-col items-center gap-3 p-6 text-center">
                                    <TierBadge tier={t.tier} />
                                    <div className="text-xs text-muted-foreground">{t.pts}</div>
                                </Card>
                            </Reveal>
                        ))}
                    </div>
                </section>

                <Reveal>
                    <section className="py-20 text-center sm:py-24">
                        <h2 className="glow-text text-2xl text-primary sm:text-3xl">Pick a side.</h2>
                        <p className="mt-4 text-sm text-muted-foreground sm:text-base">
                            Be first in when the arena opens.
                        </p>
                        <Button size="lg" disabled variant="secondary" className="mt-8">
                            Launching Soon
                        </Button>
                    </section>
                </Reveal>
            </main>

            <footer className="border-t border-border/50 py-10">
                <div className="mx-auto max-w-[1180px] px-6 text-center text-xs text-muted-foreground">
                    Underground Token Duel
                </div>
            </footer>
        </div>
    )
}
