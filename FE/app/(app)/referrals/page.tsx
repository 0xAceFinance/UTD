"use client";

import { useState } from "react";
import { useModal } from "connectkit";
import { toast } from "sonner";
import { Check, Copy, Lock, TrendingUp, Users } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import {
  useReferralDashboard,
  type ReferralCheckpoint,
} from "@/hooks/useReferralDashboard";

function short(w: string) {
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function usd(v: number) {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
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
        <div className="h-40 bg-[var(--s1)] animate-pulse" />
        <div className="h-48 bg-[var(--s1)] animate-pulse" />
        <div className="h-48 bg-[var(--s1)] animate-pulse" />
      </div>
    );
  }

  const tier = data?.tier;
  const pct = tier?.bps != null ? tier.bps / 100 : 0;
  const nextPct = tier?.nextBps != null ? tier.nextBps / 100 : null;
  const progressToNext =
    tier?.nextThresholdUsd != null && tier.nextThresholdUsd > 0
      ? Math.min(100, (tier.volumeUsd / tier.nextThresholdUsd) * 100)
      : 100;

  return (
    <div className="space-y-6 lg:space-y-8">
      <p className="max-w-lg text-[14px] text-[var(--dim)]">
        Share your link. Every duel your referrals settle pays you a live
        commission, at a rate that climbs as your own betting volume grows.
      </p>

      {error && (
        <div className="border border-[var(--hot)]/40 bg-[var(--hot)]/5 px-4 py-3 text-[12px] text-[var(--hot)]">
          {error}
        </div>
      )}

      {/* Hero: code / link / current rate */}
      <section className="app-card relative overflow-hidden border-[var(--line-2)]">
        <div className="grid gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <div className="utd-label text-[var(--acid)]">
              Your commission rate
            </div>
            <div className="mt-4 flex items-end gap-3">
              <span className="utd-pixel text-[34px] leading-none text-white sm:text-[46px]">
                {pct}%
              </span>
              <span className="utd-pixel mb-1 text-[10px] text-[var(--acid)] sm:text-[11px]">
                OF EVERY REFERRED BET
              </span>
            </div>
            <p className="mt-3 max-w-md text-[14px] text-[var(--dim)]">
              {nextPct != null && tier?.nextThresholdUsd != null
                ? `Settle over ${usd(tier.nextThresholdUsd)} of your own duel volume to climb to ${nextPct}%.`
                : "You're at the top commission tier."}
            </p>

            {nextPct != null && tier?.nextThresholdUsd != null && (
              <div className="mt-4 max-w-md">
                <div className="h-1.5 w-full bg-[var(--s2)]">
                  <div
                    className="h-full bg-[var(--acid)] transition-all duration-700"
                    style={{ width: `${progressToNext}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-[11px] text-[var(--dim)]">
                  <span>{usd(tier?.volumeUsd ?? 0)} settled</span>
                  <span>{usd(tier.nextThresholdUsd)}</span>
                </div>
              </div>
            )}

            {data?.referredByWallet && (
              <p className="mt-4 text-[12px] text-[var(--faint)]">
                You were referred by{" "}
                <span className="font-mono text-[var(--dim)]">
                  {short(data.referredByWallet)}
                </span>
              </p>
            )}
          </div>

          <div className="flex flex-col justify-center gap-3">
            {data?.referralCode && referralLink ? (
              <>
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
        </div>
      </section>

      {/* Stats */}
      <dl className="grid grid-cols-2 gap-px border border-[var(--line)] bg-[var(--line)] lg:grid-cols-4">
        <Stat
          label="Referred wallets"
          value={(data?.referredCount ?? 0).toLocaleString()}
          icon={Users}
        />
        <Stat
          label="Lifetime earnings"
          value={usd(data?.earningsUsd ?? 0)}
          icon={TrendingUp}
          accent
        />
        <Stat
          label="Your settled volume"
          value={usd(data?.tier.volumeUsd ?? 0)}
        />
        <Stat label="Current rate" value={`${pct}%`} />
      </dl>

      {/* Checkpoints */}
      <div className="grid gap-6 lg:grid-cols-2">
        <CheckpointCard
          title="Volume milestones"
          hint="One-time point bonuses as your own settled volume grows."
          checkpoints={data?.volumeCheckpoints ?? []}
          formatThreshold={usd}
        />
        <CheckpointCard
          title="Earnings milestones"
          hint="One-time point bonuses as your referral earnings grow."
          checkpoints={data?.earningsCheckpoints ?? []}
          formatThreshold={usd}
        />
      </div>

      {/* Recent commissions */}
      <div className="space-y-4">
        <h2 className="app-section-label">Recent commissions</h2>
        {!data || data.recentCommissions.length === 0 ? (
          <div className="py-12 text-center border border-[var(--line)] bg-[var(--s1)]">
            <p className="utd-body text-sm text-[var(--dim)]">
              No referred bets have settled yet. Commissions show up here the
              moment they do.
            </p>
          </div>
        ) : (
          <div className="border border-[var(--line)] bg-[var(--s1)] overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-[11px] text-[var(--faint)]">
                  <th className="py-3 px-4">MATCHUP</th>
                  <th className="py-3 px-4">REFERRED WALLET</th>
                  <th className="py-3 px-4 text-right">BUY-IN</th>
                  <th className="py-3 px-4 text-right">RATE</th>
                  <th className="py-3 px-4 text-right">EARNED</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {data.recentCommissions.map((c, i) => (
                  <tr
                    key={`${c.duelId}-${i}`}
                    className="hover:bg-[var(--s2)]/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 text-white">{c.matchup}</td>
                    <td className="py-3.5 px-4 text-[var(--dim)]">
                      {short(c.referredWallet)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-[var(--dim)]">
                      {usd(c.buyInUsd)}
                    </td>
                    <td className="py-3.5 px-4 text-right text-[var(--dim)]">
                      {c.bps / 100}%
                    </td>
                    <td className="py-3.5 px-4 text-right text-[var(--acid)]">
                      +{usd(c.commissionUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent referrals */}
      <div className="space-y-4">
        <h2 className="app-section-label">Your referrals</h2>
        {!data || data.recentReferrals.length === 0 ? (
          <div className="py-12 text-center border border-[var(--line)] bg-[var(--s1)]">
            <p className="utd-body text-sm text-[var(--dim)]">
              Nobody has used your link yet. Share it to start earning.
            </p>
          </div>
        ) : (
          <div className="border border-[var(--line)] bg-[var(--s1)] overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-[11px] text-[var(--faint)]">
                  <th className="py-3 px-4">WALLET</th>
                  <th className="py-3 px-4">JOINED</th>
                  <th className="py-3 px-4">STATUS</th>
                  <th className="py-3 px-4 text-right">THEIR VOLUME</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {data.recentReferrals.map((r) => (
                  <tr
                    key={r.wallet}
                    className="hover:bg-[var(--s2)]/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 text-white">
                      {short(r.wallet)}
                    </td>
                    <td className="py-3.5 px-4 text-[var(--dim)]">
                      {new Date(r.joinedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3.5 px-4">
                      {r.sybilFlagged ? (
                        <span className="utd-pixel text-[8px] px-2 py-0.5 text-[var(--hot)] bg-[var(--hot)]/10">
                          FLAGGED
                        </span>
                      ) : r.verified ? (
                        <span className="utd-pixel text-[8px] px-2 py-0.5 text-[var(--acid)] bg-[var(--acid)]/10">
                          VERIFIED
                        </span>
                      ) : (
                        <span className="utd-pixel text-[8px] px-2 py-0.5 text-[var(--faint)] bg-[var(--s2)]">
                          PENDING
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right text-[var(--dim)]">
                      {usd(r.volumeUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon?: typeof Users;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 bg-[var(--s1)] p-5">
      <dt className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--faint)]">
        {Icon && <Icon className="h-3 w-3" />}
        {label.toUpperCase()}
      </dt>
      <dd
        className={`utd-pixel text-lg sm:text-xl mt-1.5 truncate ${accent ? "text-[var(--acid)]" : "text-white"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function CheckpointCard({
  title,
  hint,
  checkpoints,
  formatThreshold,
}: {
  title: string;
  hint: string;
  checkpoints: ReferralCheckpoint[];
  formatThreshold: (v: number) => string;
}) {
  return (
    <div className="app-card p-5">
      <h3 className="text-[14px] font-semibold text-white">{title}</h3>
      <p className="mt-0.5 text-[12px] text-[var(--faint)]">{hint}</p>
      <ul className="mt-4 space-y-2">
        {checkpoints.map((c) => (
          <li
            key={c.thresholdUsd}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex items-center gap-2 text-[13px]">
              <span
                className={`flex h-5 w-5 flex-none items-center justify-center border ${
                  c.hit
                    ? "border-[var(--acid)] bg-[var(--acid)] text-[var(--acid-ink)]"
                    : "border-[var(--line-2)] text-[var(--faint)]"
                }`}
              >
                {c.hit && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span
                className={c.hit ? "text-[var(--dim)]" : "text-[var(--txt)]"}
              >
                {formatThreshold(c.thresholdUsd)}
              </span>
            </span>
            <span
              className={`utd-pixel text-[8px] ${c.hit ? "text-[var(--faint)]" : "text-[var(--acid)]"}`}
            >
              +{c.points.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
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
