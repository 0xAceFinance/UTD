"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ListChecks } from "lucide-react"
import { DuelTokenDTO, formatUsd } from "../components/duel/types"

export default function TokensPage() {
    const [tokens, setTokens] = useState<DuelTokenDTO[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch("/api/duel-tokens")
            .then((r) => r.json())
            .then((json) => {
                if (json.success) setTokens(json.data)
            })
            .finally(() => setLoading(false))
    }, [])

    return (
        <div className="animate-in fade-in duration-500 mx-auto max-w-4xl space-y-6 pt-4">
            <div className="text-center">
                <h1 className="text-2xl text-primary glow-text md:text-3xl">Today's Gladiators</h1>
                <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    We interview every gladiator in the arena every 24 hours, just for you.
                </p>
            </div>

            <Card className="p-0">
                <CardHeader>
                    <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Eligible for today's duels</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <Skeleton key={i} className="h-11 w-full rounded-none" />
                            ))}
                        </div>
                    ) : tokens.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 py-10 text-center">
                            <ListChecks className="h-8 w-8 text-muted-foreground/50" />
                            <p className="text-muted-foreground">
                                No gladiators scanned yet. Run <code className="text-primary">POST /api/scan</code>.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b-2 border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                                        <th className="py-2">Rank</th>
                                        <th className="py-2">Token</th>
                                        <th className="py-2">Market Cap</th>
                                        <th className="py-2">Liquidity</th>
                                        <th className="py-2">24h Volume</th>
                                        <th className="py-2">24h Change</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tokens.map((t) => (
                                        <tr key={t._id} className="border-b border-border/60 transition-colors hover:bg-secondary/40">
                                            <td className="tabular py-3 text-muted-foreground">#{t.rank}</td>
                                            <td className="py-3">
                                                <div className="font-semibold">{t.symbol}</div>
                                                <div className="text-[10px] text-muted-foreground">{t.name}</div>
                                            </td>
                                            <td className="tabular py-3">{formatUsd(t.marketCapUsd)}</td>
                                            <td className="tabular py-3">{formatUsd(t.liquidityUsd)}</td>
                                            <td className="tabular py-3">{formatUsd(t.volume24hUsd)}</td>
                                            <td
                                                className={`tabular py-3 font-semibold ${t.change24hPct >= 0 ? "text-[hsl(var(--good))]" : "text-destructive"}`}
                                            >
                                                {t.change24hPct >= 0 ? "+" : ""}
                                                {t.change24hPct}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="text-center">
                <Link href="/duels/create">
                    <Button>Create a Duel →</Button>
                </Link>
            </div>
        </div>
    )
}
