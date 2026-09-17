"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Flame } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { TierBadge } from "../components/duel/SideTag";
import { DuelDTO, pctReturn } from "../components/duel/types";

interface CombatRecordDTO {
  wallet: string;
  totalPoints: number;
  availablePoints: number;
  tier: "Bronze" | "Silver" | "Gold" | "Diamond";
  wins: number;
  losses: number;
  currentStreak: number;
  matches: DuelDTO[];
}

const TIER_THRESHOLDS: Record<CombatRecordDTO["tier"], number> = {
  Bronze: 0,
  Silver: 5000,
  Gold: 25000,
  Diamond: 100000,
};
const NEXT_TIER: Record<
  CombatRecordDTO["tier"],
  CombatRecordDTO["tier"] | null
> = {
  Bronze: "Silver",
  Silver: "Gold",
  Gold: "Diamond",
  Diamond: null,
};

export default function ProfilePage() {
  const { address, connected, ready } = useWallet();
  const [record, setRecord] = useState<CombatRecordDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    fetch(`/api/combat-record/${address}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setRecord(json.data);
      })
      .finally(() => setLoading(false));
  }, [address]);

  if (ready && !connected) {
    return (
      <div className="animate-in fade-in duration-500 mx-auto max-w-md pt-10 text-center">
        <Card>
          <CardContent className="space-y-2 pt-8">
            <Lock className="mx-auto mb-2 h-8 w-8 text-primary" />
            <p className="font-semibold">
              Connect your wallet to see your Combat Record.
            </p>
            <p className="text-sm text-muted-foreground">
              Your points, tier, and match history live here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="grid gap-6 md:grid-cols-[380px_1fr]">
          <Skeleton className="h-72 rounded-none" />
          <Skeleton className="h-72 rounded-none" />
        </div>
        <Skeleton className="h-48 rounded-none" />
      </div>
    );
  }

  const totalPoints = record?.totalPoints ?? 0;
  const availablePoints = record?.availablePoints ?? 0;
  const tier = record?.tier ?? "Bronze";
  const wins = record?.wins ?? 0;
  const losses = record?.losses ?? 0;
  const nextTier = NEXT_TIER[tier];
  const tierFloor = TIER_THRESHOLDS[tier];
  const tierCeiling = nextTier ? TIER_THRESHOLDS[nextTier] : null;
  const tierProgressPct = tierCeiling
    ? Math.min(
        100,
        ((totalPoints - tierFloor) / (tierCeiling - tierFloor)) * 100,
      )
    : 100;

  return (
    <div className="animate-in fade-in duration-500 mx-auto max-w-5xl space-y-6 pb-10 pt-4">
      <div className="grid gap-6 md:grid-cols-[380px_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between bg-primary/10 px-5 py-4">
            <TierBadge tier={tier} />
            <div
              className="flex items-center gap-1 text-muted-foreground"
              title="Soulbound, non-transferable"
            >
              <Lock className="h-4 w-4" />
            </div>
          </div>
          <CardContent className="space-y-5 pt-5">
            <div
              className="h-16 w-16 border-2 border-foreground/60"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--side-a)), hsl(var(--side-b)))",
              }}
            />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Wallet
              </div>
              <div className="font-mono text-sm font-semibold">
                {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "-"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Lifetime Points
              </div>
              <div className="tabular text-3xl font-extrabold text-primary glow-text">
                {totalPoints.toLocaleString()}
              </div>
              {nextTier && (
                <div className="mt-2">
                  <div className="h-1.5 w-full bg-border">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${tierProgressPct}%` }}
                    />
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {(tierCeiling! - totalPoints).toLocaleString()} pts to{" "}
                    {nextTier}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-6">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Record
                </div>
                <div className="tabular text-sm font-semibold">
                  {wins}W – {losses}L
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Streak
                </div>
                <div className="tabular flex items-center gap-1 text-sm font-semibold text-[hsl(var(--good))]">
                  {(record?.currentStreak ?? 0) > 0 && (
                    <Flame className="h-3.5 w-3.5" />
                  )}
                  {record?.currentStreak ?? 0}
                </div>
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-[10px] tracking-wide text-muted-foreground">
              <Lock className="h-3 w-3" /> SOULBOUND · NON-TRANSFERABLE
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Redeem Points for $UTD
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="pixel-flat min-w-[140px] flex-1 border-2 border-border bg-background/40 p-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Available
                </div>
                <div className="tabular text-lg font-bold">
                  {availablePoints.toLocaleString()} pts
                </div>
              </div>
              <div className="pixel-flat min-w-[140px] flex-1 border-2 border-border bg-background/40 p-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Tier
                </div>
                <div className="text-lg font-bold">{tier}</div>
              </div>
            </div>

            <Button
              disabled
              variant="secondary"
              className="w-full cursor-not-allowed opacity-50"
            >
              Redeem (Coming Soon)
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="p-0">
        <CardHeader>
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
            Match History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!record || record.matches.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No settled duels yet. Go start one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2">Matchup</th>
                    <th className="py-2">Result</th>
                    <th className="py-2">Margin</th>
                    <th className="py-2">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {record.matches.map((m) => {
                    const isCreator =
                      m.creatorWallet.toLowerCase() === address?.toLowerCase();
                    const mySide = isCreator
                      ? m.creatorSide
                      : m.creatorSide === 0
                        ? 1
                        : 0;
                    const won = m.winnerSide === mySide;
                    const gainA = pctReturn(
                      m.tokenA.startMarketCapUsd,
                      m.tokenA.sustainedPeakMarketCapUsd,
                    );
                    const gainB = pctReturn(
                      m.tokenB.startMarketCapUsd,
                      m.tokenB.sustainedPeakMarketCapUsd,
                    );
                    return (
                      <tr
                        key={m._id}
                        className="border-b border-border/60 transition-colors hover:bg-secondary/40"
                      >
                        <td className="py-3 font-medium">
                          {m.tokenA.symbol} vs {m.tokenB.symbol}
                        </td>
                        <td
                          className={`py-3 font-semibold ${won ? "text-[hsl(var(--good))]" : "text-destructive"}`}
                        >
                          {won ? "WIN" : "LOSS"}
                        </td>
                        <td className="tabular py-3 text-muted-foreground">
                          {gainA.toFixed(0)}% / {gainB.toFixed(0)}%
                        </td>
                        <td className="tabular py-3">
                          +{won ? m.winnerPoints : m.loserPoints}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
