"use client";

import { useState } from "react";
import { useModal } from "connectkit";
import { toast } from "sonner";
import {
  Check,
  Coins,
  Copy,
  Lock,
  Share2,
  Swords,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { REFERRAL_TIER_CONFIG } from "@mcapduel/points";
import { useWallet } from "@/hooks/useWallet";
import {
  useReferralDashboard,
  type ReferralCheckpoint,
  type ReferralCommission,
} from "@/hooks/useReferralDashboard";

const RANK_NAMES = ["RECRUIT", "HUSTLER", "OPERATOR", "KINGPIN", "CARTEL"];
const RANK_NUMERALS = ["I", "II", "III", "IV", "V"];

const RANKS = REFERRAL_TIER_CONFIG.tiers.map((t, i) => ({
  bps: t.bps,
  name: RANK_NAMES[i] ?? `RANK ${i + 1}`,
  numeral: RANK_NUMERALS[i] ?? String(i + 1),
  thresholdLabel:
    t.minVolumeUsd === 0 ? "$0" : `>$${t.minVolumeUsd.toLocaleString()}`,
}));

const OCTAGON_CLIP =
  "polygon(18% 0,82% 0,100% 18%,100% 82%,82% 100%,18% 100%,0 82%,0 18%)";

function rankIndexForBps(bps: number) {
  const i = RANKS.findIndex((r) => r.bps === bps);
  return i >= 0 ? i : 0;
}

function short(w: string) {
  return `${w.slice(0, 6)}...${w.slice(-4)}`;
}

function usd(v: number) {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function timeAgo(iso: string) {
  const sec = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

type ActivityItem =
  | {
      kind: "commission";
      at: string;
      wallet: string;
      matchup: string;
      commissionUsd: number;
    }
  | {
      kind: "referral";
      at: string;
      wallet: string;
      verified: boolean;
      sybilFlagged: boolean;
    };

function buildActivity(
  commissions: ReferralCommission[],
  referrals: {
    wallet: string;
    verified: boolean;
    sybilFlagged: boolean;
    joinedAt: string;
  }[],
): ActivityItem[] {
  const fromCommissions: ActivityItem[] = commissions
    .filter((c) => c.settledAt)
    .map((c) => ({
      kind: "commission",
      at: c.settledAt!,
      wallet: c.referredWallet,
      matchup: c.matchup,
      commissionUsd: c.commissionUsd,
    }));
  const fromReferrals: ActivityItem[] = referrals.map((r) => ({
    kind: "referral",
    at: r.joinedAt,
    wallet: r.wallet,
    verified: r.verified,
    sybilFlagged: r.sybilFlagged,
  }));
  return [...fromCommissions, ...fromReferrals]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 15);
}

export default function ReferralsPage() {
  const { address, connected, ready } = useWallet();
  const { setOpen: openConnect } = useModal();
  const { data, loading, error } = useReferralDashboard(address);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const referralLink = data?.referralCode
    ? `${origin}/duels?ref=${data.referralCode}`
    : null;

  if (ready && !connected) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <div className="p-8 border border-[var(--line)] bg-[var(--s1)]">
          <h2 className="utd-pixel text-sm text-white">WALLET NOT CONNECTED</h2>
          <p className="utd-body text-xs text-[var(--dim)] mt-2">
            Connect your wallet to get your referral link and see your
            commissions in realtime.
          </p>
          <button
            onClick={() => openConnect(true)}
            className="utd-btn mt-5 h-10 px-5 text-[9px]"
          >
            CONNECT WALLET
          </button>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-6 pt-4">
        <div className="h-52 bg-[var(--s1)] animate-pulse" />
        <div className="h-60 bg-[var(--s1)] animate-pulse" />
        <div className="h-32 bg-[var(--s1)] animate-pulse" />
      </div>
    );
  }

  const tier = data?.tier ?? {
    bps: 100,
    volumeUsd: 0,
    nextBps: 200,
    nextThresholdUsd: 100,
    maxBps: 500,
  };
  const pct = tier.bps / 100;
  const currentIndex = rankIndexForBps(tier.bps);
  const currentRank = RANKS[currentIndex];
  const nextRank =
    tier.nextBps != null ? RANKS[rankIndexForBps(tier.nextBps)] : null;
  const gapUsd =
    nextRank && tier.nextThresholdUsd != null
      ? Math.max(0, tier.nextThresholdUsd - tier.volumeUsd)
      : 0;
  const ladderFillPct = (currentIndex / (RANKS.length - 1)) * 100;
  const meterPct = tier.nextThresholdUsd
    ? Math.min(100, (tier.volumeUsd / tier.nextThresholdUsd) * 100)
    : 100;

  const activity = buildActivity(
    data?.recentCommissions ?? [],
    data?.recentReferrals ?? [],
  );

  return (
    <div className="space-y-6 lg:space-y-8">
      <p className="max-w-xl text-[14px] text-[var(--dim)]">
        Share your link. Every duel your referral settles pays you a live
        commission, and the rate climbs as your own settled volume grows.
      </p>

      {error && (
        <div className="border border-[var(--hot)]/40 bg-[var(--hot)]/5 px-4 py-3 text-[12px] text-[var(--hot)]">
          {error}
        </div>
      )}

      {/* ===== Hero: rank + link ===== */}
      <section className="relative grid grid-cols-1 border border-[var(--line-2)] bg-[var(--s1)] md:grid-cols-[1fr_380px]">
        <span className="pointer-events-none absolute left-[6px] top-[6px] h-[9px] w-[9px] border-l border-t border-[var(--acid)] opacity-60" />
        <span className="pointer-events-none absolute bottom-[6px] right-[6px] h-[9px] w-[9px] border-b border-r border-[var(--acid)] opacity-60" />

        <div className="p-7 sm:p-9">
          <div className="utd-label text-[var(--acid)]">Your rank</div>
          <div className="mt-4 flex items-center gap-5">
            <div
              className="utd-rank-glow relative flex h-[84px] w-[84px] flex-none flex-col items-center justify-center gap-0.5 border-2 border-[var(--acid)] bg-[var(--s2)]"
              style={{ clipPath: OCTAGON_CLIP }}
            >
              <span className="utd-pixel text-[7px] text-[var(--dim)]">
                {currentRank.numeral}
              </span>
              <span className="utd-pixel text-[18px] text-[var(--acid)]">
                {pct}%
              </span>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="utd-pixel text-[17px] text-white">
                  {currentRank.name}
                </span>
                <span className="border border-[var(--line-2)] px-2 py-1 text-[11px] font-semibold text-[var(--dim)]">
                  RANK {currentIndex + 1} / {RANKS.length}
                </span>
              </div>
              <p className="mt-2.5 max-w-md text-[13.5px] leading-relaxed text-[var(--dim)]">
                You earn <strong className="text-[var(--txt)]">{pct}%</strong>{" "}
                of every stake your referrals settle.{" "}
                {nextRank ? (
                  <>
                    Settle{" "}
                    <strong className="text-[var(--acid)]">
                      {usd(gapUsd)}
                    </strong>{" "}
                    more of your own volume to unlock{" "}
                    <strong className="text-[var(--txt)]">
                      {nextRank.name}
                    </strong>{" "}
                    ({nextRank.bps / 100}%).
                  </>
                ) : (
                  "You're at the top rate."
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center gap-3.5 border-t border-[var(--line)] p-7 sm:p-8 md:border-l md:border-t-0">
          {data?.referralCode && referralLink ? (
            <>
              <div className="utd-label text-[var(--dim)]">Your link</div>
              <div className="flex items-center justify-between font-mono text-[11px] text-[var(--dim)]">
                <span>
                  CODE:{" "}
                  <strong className="text-[var(--acid)] font-bold tracking-wider">
                    {data.referralCode}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(data.referralCode!);
                    toast.success("Referral code copied!");
                  }}
                  className="text-[var(--acid)] hover:underline"
                >
                  Copy
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={referralLink}
                  aria-label="Your referral link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 border border-[var(--line-2)] bg-[var(--s0)] px-3 py-2 font-mono text-[11px] text-[var(--txt)] focus:border-[var(--acid)] focus:outline-none"
                />
                <CopyButton text={referralLink} />
              </div>
              <p className="text-[11.5px] text-[var(--faint)]">
                Invites count the moment a referred wallet settles its first
                duel.
              </p>
            </>
          ) : (
            <div className="flex items-start gap-2.5 text-[13px] text-[var(--dim)]">
              <Lock className="mt-0.5 h-4 w-4 flex-none text-[var(--faint)]" />
              <span>
                Verify your wallet on the Airdrop page to get your referral
                link.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ===== Commission ladder ===== */}
      <section className="border border-[var(--line)] bg-[var(--s1)] px-7 py-8 sm:px-9">
        <div className="flex items-baseline justify-between">
          <div className="utd-label text-[var(--dim)]">Commission ladder</div>
          <div className="font-mono text-[11px] text-[var(--faint)]">
            5 ranks
          </div>
        </div>

        <div className="relative mt-11 px-5">
          <div className="absolute left-5 right-5 top-8 h-[3px] bg-[var(--line)]" />
          <div
            className="absolute left-5 top-8 h-[3px] bg-[var(--acid)] shadow-[0_0_10px_rgba(43,232,132,0.6)] transition-all duration-700"
            style={{ width: `calc((100% - 40px) * ${ladderFillPct / 100})` }}
          />

          <div className="relative flex justify-between">
            {RANKS.map((rank, i) => {
              const state =
                i < currentIndex
                  ? "past"
                  : i === currentIndex
                    ? "current"
                    : "locked";
              return (
                <div
                  key={rank.bps}
                  className="flex w-[110px] flex-col items-center sm:w-[120px]"
                >
                  <div
                    className={`utd-pixel h-4 text-[7px] text-[var(--acid)] ${state === "current" ? "utd-soft-pulse" : "invisible"}`}
                  >
                    ▲ YOU
                  </div>
                  <div
                    className={`relative flex flex-col items-center justify-center border-2 ${
                      state === "locked"
                        ? "border-[var(--line-2)] bg-[var(--s1)] opacity-60"
                        : "border-[var(--acid)] bg-[var(--s2)]"
                    } ${state === "current" ? "h-[70px] w-[70px] utd-rank-glow" : "h-16 w-16"}`}
                    style={{ clipPath: OCTAGON_CLIP }}
                  >
                    <span
                      className={`utd-pixel text-[6px] ${state === "locked" ? "text-[var(--faint)]" : "text-[var(--dim)]"}`}
                    >
                      {rank.numeral}
                    </span>
                    <span
                      className={`utd-pixel text-[13px] ${state === "locked" ? "text-[var(--faint)]" : "text-[var(--acid)]"}`}
                    >
                      {rank.bps / 100}%
                    </span>
                    {state === "past" && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--acid)]">
                        <Check
                          className="h-2.5 w-2.5 text-[var(--acid-ink)]"
                          strokeWidth={3.5}
                        />
                      </span>
                    )}
                    {state === "locked" && (
                      <span className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--line-2)] bg-[var(--s2)]">
                        <Lock className="h-2.5 w-2.5 text-[var(--faint)]" />
                      </span>
                    )}
                  </div>
                  <div
                    className={`mt-2.5 text-[11px] font-bold tracking-wide ${state === "locked" ? "text-[var(--faint)]" : "text-white"}`}
                  >
                    {rank.name}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--faint)]">
                    {rank.thresholdLabel}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8 flex items-center gap-4 border-t border-[var(--line)] pt-5">
          {nextRank && tier.nextThresholdUsd != null ? (
            <>
              <span className="flex-none text-[12.5px] text-[var(--dim)]">
                {usd(tier.volumeUsd)} of {usd(tier.nextThresholdUsd)} toward{" "}
                {nextRank.name}
              </span>
              <div className="relative h-1.5 flex-1 bg-[var(--s2)]">
                <div
                  className="absolute inset-y-0 left-0 bg-[var(--acid)] shadow-[0_0_8px_rgba(43,232,132,0.55)] transition-all duration-700"
                  style={{ width: `${meterPct}%` }}
                />
              </div>
              <span className="flex-none font-mono text-[12px] text-[var(--faint)]">
                {Math.round(meterPct)}%
              </span>
            </>
          ) : (
            <span className="text-[12.5px] text-[var(--dim)]">
              You're at the top rate. No higher rank to chase.
            </span>
          )}
        </div>
      </section>

      {/* ===== Stats HUD ===== */}
      <div className="grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)] lg:grid-cols-4">
        <HudStat
          icon={Users}
          label="Referred wallets"
          value={(data?.referredCount ?? 0).toLocaleString()}
          topColor="var(--cool)"
        />
        <HudStat
          icon={TrendingUp}
          label="Lifetime earnings"
          value={usd(data?.earningsUsd ?? 0)}
          topColor="var(--acid)"
          accent
        />
        <HudStat
          icon={Coins}
          label="Your settled volume"
          value={usd(tier.volumeUsd)}
          topColor="var(--line-2)"
        />
        <HudStat
          icon={Swords}
          label="Current rate"
          value={`${pct}%`}
          topColor="var(--acid)"
        />
      </div>

      {/* ===== How it works ===== */}
      <div>
        <div className="utd-label mb-3.5 text-[var(--dim)]">How it works</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <HowStep
            step="01"
            icon={Share2}
            title="Share"
            body="Send your code or link to a friend. No sign-up wall, no extra step."
          />
          <HowStep
            step="02"
            icon={Swords}
            title="They duel"
            body="They connect a wallet and settle any duel using your link or code."
          />
          <HowStep
            step="03"
            icon={Coins}
            title="You earn"
            body="Your cut lands the moment their duel settles, automatically, on-chain."
          />
        </div>
      </div>

      {/* ===== Milestones ===== */}
      <div>
        <div className="utd-label text-[var(--dim)]">Milestones</div>
        <p className="mt-1 mb-4 text-[12.5px] text-[var(--faint)]">
          One-time point bonuses as volume and earnings grow.
        </p>
        <div className="grid gap-5 lg:grid-cols-2">
          <MilestoneCard
            title="Volume"
            unit="settled"
            checkpoints={data?.volumeCheckpoints ?? []}
            formatThreshold={usd}
          />
          <MilestoneCard
            title="Earnings"
            unit="earned"
            checkpoints={data?.earningsCheckpoints ?? []}
            formatThreshold={usd}
          />
        </div>
      </div>

      {/* ===== Activity feed ===== */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <div className="utd-label text-[var(--dim)]">Recent activity</div>
        </div>
        {activity.length === 0 ? (
          <div className="border border-[var(--line)] bg-[var(--s1)] py-12 text-center">
            <p className="utd-body text-sm text-[var(--dim)]">
              No referral activity yet. Commissions and new referrals show up
              here the moment they happen.
            </p>
          </div>
        ) : (
          <div className="border border-[var(--line)] bg-[var(--s1)]">
            {activity.map((item, i) => (
              <ActivityRow
                key={`${item.kind}-${item.wallet}-${item.at}-${i}`}
                item={item}
                last={i === activity.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HudStat({
  icon: Icon,
  label,
  value,
  topColor,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  topColor: string;
  accent?: boolean;
}) {
  return (
    <div className="relative min-w-0 bg-[var(--s1)] p-5">
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{ backgroundColor: topColor }}
      />
      <dt className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--faint)]">
        <Icon className="h-3 w-3" />
        {label.toUpperCase()}
      </dt>
      <dd
        className={`utd-pixel mt-2.5 truncate text-lg sm:text-xl ${accent ? "text-[var(--acid)]" : "text-white"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function HowStep({
  step,
  icon: Icon,
  title,
  body,
}: {
  step: string;
  icon: typeof Users;
  title: string;
  body: string;
}) {
  return (
    <div className="relative overflow-hidden border border-[var(--line)] bg-[var(--s1)] p-5">
      <span className="utd-pixel pointer-events-none absolute -top-1.5 right-2 text-[38px] text-[var(--s2)]">
        {step}
      </span>
      <div className="relative flex items-center gap-2.5">
        <span className="flex h-8 w-8 flex-none items-center justify-center border border-[var(--line-2)] bg-[var(--s2)]">
          <Icon className="h-3.5 w-3.5 text-[var(--acid)]" />
        </span>
        <span className="text-[14px] font-bold text-white">{title}</span>
      </div>
      <p className="relative mt-3 text-[12.5px] leading-relaxed text-[var(--dim)]">
        {body}
      </p>
    </div>
  );
}

function MilestoneCard({
  title,
  unit,
  checkpoints,
  formatThreshold,
}: {
  title: string;
  unit: string;
  checkpoints: ReferralCheckpoint[];
  formatThreshold: (v: number) => string;
}) {
  return (
    <div className="border border-[var(--line)] bg-[var(--s1)] p-6">
      <div className="text-[13px] font-bold text-white">{title}</div>
      <div className="mt-3.5 flex flex-col gap-px bg-[var(--line)]">
        {checkpoints.map((c) => (
          <div
            key={c.thresholdUsd}
            className={`flex items-center gap-3 bg-[var(--s1)] py-2.5 ${c.hit ? "opacity-100" : "opacity-55"}`}
          >
            <span
              className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${
                c.hit
                  ? "bg-[var(--acid)]"
                  : "border border-[var(--line-2)] bg-[var(--s2)]"
              }`}
            >
              {c.hit ? (
                <Check
                  className="h-3.5 w-3.5 text-[var(--acid-ink)]"
                  strokeWidth={3}
                />
              ) : (
                <Lock className="h-3 w-3 text-[var(--faint)]" />
              )}
            </span>
            <span
              className={`flex-1 font-mono text-[12.5px] ${c.hit ? "text-[var(--dim)]" : "text-[var(--faint)]"}`}
            >
              {formatThreshold(c.thresholdUsd)} {unit}
            </span>
            <span
              className={`utd-pixel text-[10px] ${c.hit ? "text-[var(--faint)]" : "text-[var(--acid)]"}`}
            >
              +{c.points.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ item, last }: { item: ActivityItem; last: boolean }) {
  const border = last ? "" : "border-b border-[var(--line)]";
  if (item.kind === "commission") {
    return (
      <div className={`flex items-center gap-3.5 px-5 py-3.5 ${border}`}>
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--acid)] bg-[var(--acid)]/10">
          <Coins className="h-4 w-4 text-[var(--acid)]" />
        </span>
        <span className="flex-1 text-[13px] text-[var(--txt)]">
          <strong className="font-mono">{short(item.wallet)}</strong> settled a
          duel you referred
        </span>
        <span className="utd-pixel flex-none text-[11px] text-[var(--acid)]">
          +{usd(item.commissionUsd)}
        </span>
        <span className="w-[74px] flex-none text-right text-[11.5px] text-[var(--faint)]">
          {timeAgo(item.at)}
        </span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-3.5 px-5 py-3.5 ${border}`}>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[var(--cool)] bg-[var(--cool)]/10">
        <UserPlus className="h-4 w-4 text-[var(--cool)]" />
      </span>
      <span className="flex-1 text-[13px] text-[var(--txt)]">
        <strong className="font-mono">{short(item.wallet)}</strong> joined using
        your link
      </span>
      {item.sybilFlagged ? (
        <span className="flex-none bg-[var(--hot)]/10 px-2 py-1 text-[10.5px] font-bold text-[var(--hot)]">
          FLAGGED
        </span>
      ) : item.verified ? (
        <span className="flex-none bg-[var(--acid)]/10 px-2 py-1 text-[10.5px] font-bold text-[var(--acid)]">
          VERIFIED
        </span>
      ) : (
        <span className="flex-none bg-[var(--s2)] px-2 py-1 text-[10.5px] font-bold text-[var(--faint)]">
          PENDING
        </span>
      )}
      <span className="w-[74px] flex-none text-right text-[11.5px] text-[var(--faint)]">
        {timeAgo(item.at)}
      </span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success("Referral link copied!");
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy. Select the link and copy it manually.");
        }
      }}
      aria-label="Copy referral link"
      className="app-chip h-10 w-10 flex-none justify-center px-0"
    >
      {copied ? (
        <Check className="h-4 w-4 text-[var(--acid)]" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}
