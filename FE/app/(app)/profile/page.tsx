"use client";

import { useEffect, useState, useRef } from "react";
import { Shield, Flame } from "lucide-react";
import Link from "next/link";
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

const TIERS = {
  Bronze: { border: "border-amber-800/70", color: "text-amber-600", multiplier: "1.0×", vaultCap: "1,000 / epoch" },
  Silver: { border: "border-slate-600/70", color: "text-slate-300", multiplier: "1.25×", vaultCap: "3,000 / epoch" },
  Gold: { border: "border-yellow-600/70", color: "text-yellow-400", multiplier: "1.5×", vaultCap: "8,000 / epoch" },
  Diamond: { border: "border-cyan-600/70", color: "text-cyan-400", multiplier: "2.0×", vaultCap: "20,000 / epoch" },
};

export default function ProfilePage() {
  const { address, connected, ready } = useWallet();
  const [record, setRecord] = useState<CombatRecordDTO | null>(null);
  const [loading, setLoading] = useState(true);

  // 3D Card tilt state matching the landing page
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setTilt({
      x: -((y - rect.height / 2) / (rect.height / 2)) * 7,
      y: ((x - rect.width / 2) / (rect.width / 2)) * 7,
    });
    setGlare({ x: (x / rect.width) * 100, y: (y / rect.height) * 100, opacity: 0.12 });
  };

  const resetTilt = () => {
    setTilt({ x: 0, y: 0 });
    setGlare({ x: 50, y: 50, opacity: 0 });
  };

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
      <div className="mx-auto max-w-md pt-16 text-center">
        <div className="p-8 border border-[var(--line)] bg-[var(--s1)]">
          <h2 className="utd-pixel text-sm text-white">WALLET NOT CONNECTED</h2>
          <p className="utd-body text-xs text-[var(--dim)] mt-2">
            Connect your wallet using the top bar to see your Combat Record and past duels.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 pt-4">
        <div className="h-64 bg-[var(--s1)] animate-pulse" />
        <div className="h-48 bg-[var(--s1)] animate-pulse" />
      </div>
    );
  }

  const tier = record?.tier ?? "Bronze";
  const activeTier = TIERS[tier];
  const totalPoints = record?.totalPoints ?? 0;
  const wins = record?.wins ?? 0;
  const losses = record?.losses ?? 0;
  const currentStreak = record?.currentStreak ?? 0;

  return (
    <div className="space-y-8">
      {/* The top bar already says RECORD; this is just the one-line brief. */}
      <p className="max-w-lg text-[14px] text-[var(--dim)]">
        A soulbound record minted when your first duel settles. It tracks your lifetime points, win rate and fee share.
      </p>

      {/* Main Row: 3D Combat Card + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Interactive 3D Card (Same as Landing Page) */}
        <div className="lg:col-span-5 flex justify-center">
          <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={resetTilt}
            style={{
              transform: `perspective(1200px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
              transition: "transform 0.15s ease-out",
            }}
            className={`relative flex aspect-[1/1.42] w-full max-w-[300px] select-none flex-col justify-between overflow-hidden border-2 ${activeTier.border} bg-[var(--s1)] p-6 shadow-2xl`}
          >
            <div
              className="pointer-events-none absolute inset-0 transition-opacity duration-300"
              style={{
                background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,${glare.opacity}) 0%, transparent 55%)`,
              }}
            />

            <div className="flex items-start justify-between">
              <div className={`border ${activeTier.border} p-2`}>
                <Shield className={`h-5 w-5 ${activeTier.color}`} />
              </div>
              <div className="text-right font-mono text-[10px] text-[var(--faint)]">
                <div>SOULBOUND</div>
                <div className="mt-0.5">{tier.toUpperCase()}</div>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <img src="/logo-mark.png" alt="" className="utd-mark h-16 w-16" />
              <div className="utd-pixel mt-4 text-center text-sm text-white">
                {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "ANON"}
              </div>
            </div>

            <div className="border-t border-[var(--line)] pt-3 text-center">
              <div className="utd-pixel text-[13px] text-[var(--acid)]">
                {totalPoints.toLocaleString()} PTS
              </div>
            </div>
          </div>
        </div>

        {/* Right: Clean Stat Matrix */}
        <div className="lg:col-span-7 space-y-6">
          <dl className="grid grid-cols-2 gap-px bg-[var(--line)]">
            <div className="bg-[var(--s1)] p-5">
              <dt className="font-mono text-[11px] text-[var(--faint)]">LIFETIME POINTS</dt>
              <dd className="utd-pixel text-xl sm:text-2xl text-[var(--acid)] mt-1.5">
                {totalPoints.toLocaleString()}
              </dd>
            </div>
            <div className="bg-[var(--s1)] p-5">
              <dt className="font-mono text-[11px] text-[var(--faint)]">RECORD</dt>
              <dd className="utd-pixel text-xl sm:text-2xl text-white mt-1.5">
                {wins}W &ndash; {losses}L
              </dd>
            </div>
            <div className="bg-[var(--s1)] p-5">
              <dt className="font-mono text-[11px] text-[var(--faint)]">CURRENT STREAK</dt>
              <dd className="utd-pixel text-base text-white mt-1.5 flex items-center gap-1.5">
                {currentStreak > 0 && <Flame className="h-4 w-4 text-[#ff793f]" />}
                {currentStreak} matches
              </dd>
            </div>
            <div className="bg-[var(--s1)] p-5">
              <dt className="font-mono text-[11px] text-[var(--faint)]">REWARD MULTIPLIER</dt>
              <dd className="utd-pixel text-base text-[var(--txt)] mt-1.5">
                {activeTier.multiplier}
              </dd>
            </div>
          </dl>

          <div className="border border-[var(--line)] bg-[var(--s1)] p-5 font-mono text-xs space-y-2">
            <div className="flex justify-between text-[var(--dim)]">
              <span>Vault Cap</span>
              <span className="text-white">{activeTier.vaultCap}</span>
            </div>
            <div className="flex justify-between text-[var(--dim)]">
              <span>Redemption Status</span>
              <span className="text-[var(--acid)]">Vesting active</span>
            </div>
          </div>
        </div>
      </div>

      {/* Match History */}
      <div className="space-y-4">
        <h2 className="app-section-label">
          Match history
        </h2>

        {!record || record.matches.length === 0 ? (
          <div className="py-12 text-center border border-[var(--line)] bg-[var(--s1)]">
            <p className="utd-body text-sm text-[var(--dim)]">No duels fought yet with this wallet.</p>
            <div className="mt-4">
              <Link href="/duels">
                <button className="utd-btn text-[9px] px-4 py-2">
                  FIND A DUEL
                </button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="border border-[var(--line)] bg-[var(--s1)] overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-[11px] text-[var(--faint)]">
                  <th className="py-3 px-4">MATCHUP</th>
                  <th className="py-3 px-4">RESULT</th>
                  <th className="py-3 px-4 text-right">PRICE DELTA</th>
                  <th className="py-3 px-4 text-right">POINTS</th>
                  <th className="py-3 px-4 text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {record.matches.map((m) => {
                  const isCreator = m.creatorWallet.toLowerCase() === address?.toLowerCase();
                  const mySide = isCreator ? m.creatorSide : m.creatorSide === 0 ? 1 : 0;
                  const won = m.winnerSide === mySide;
                  const gainA = pctReturn(m.tokenA.startMarketCapUsd, m.tokenA.sustainedPeakMarketCapUsd);
                  const gainB = m.tokenB ? pctReturn(m.tokenB.startMarketCapUsd, m.tokenB.sustainedPeakMarketCapUsd) : 0;

                  return (
                    <tr key={m._id} className="hover:bg-[var(--s2)]/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <span className="text-white font-semibold">{m.tokenA.symbol}</span>
                        <span className="text-[var(--faint)] mx-1.5">vs</span>
                        <span className="text-white font-semibold">{m.tokenB?.symbol ?? "?"}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`utd-pixel text-[8px] px-2 py-0.5 ${
                          won ? "text-[var(--acid)] bg-[var(--acid)]/10" : "text-[var(--hot)] bg-[var(--hot)]/10"
                        }`}>
                          {won ? "WIN" : "LOSS"}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right text-[var(--dim)]">
                        {gainA >= 0 ? "+" : ""}{gainA.toFixed(1)}% / {gainB >= 0 ? "+" : ""}{gainB.toFixed(1)}%
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <span className={won ? "text-[var(--acid)]" : "text-[var(--dim)]"}>
                          +{won ? m.winnerPoints : m.loserPoints}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <Link href={`/duels/${m._id}`}>
                          <button className="utd-btn-outline text-[8px] py-1 px-2.5">
                            VIEW &rarr;
                          </button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
