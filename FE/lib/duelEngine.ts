import { computeMatchPoints, isPointsEligible } from '@mcapduel/points';
import { priceSample, liquidityWeightedMedianPrice, runOraclePipeline } from '@mcapduel/engine';
import { closeBattleWindow, flagForReview, settle, refundStale } from '@mcapduel/matchmaking';
import { after } from 'next/server';
import { WalletClusterGraph, isSuspectedSybilMatch } from '@mcapduel/risk';
import { getLivePoolSamples } from '@/lib/dexScreenerSource';
import { signSettlement } from '@/lib/oracleSigner';
import { submitSettlement } from '@/lib/settlementRelayer';
import { toLobbySnapshot, applyLobby } from '@/lib/lobbyAdapter';
import CombatRecord from '@/lib/models/CombatRecord';
import WalletSighting from '@/lib/models/WalletSighting';
import Duel from '@/lib/models/Duel';
import type { IDuel, TokenSide, DeferredPayout } from '@/lib/models/Duel';

/**
 * Minimum time between real pool fetches for one duel side. The live battle
 * page polls GET /api/duels/[id] every 3s (see app/duels/[id]/page.tsx); at
 * that cadence, fetching fresh multi-pool data from DexScreener on every
 * single poll would hammer a public, keyless API for no benefit -- the
 * pipeline's TWAP window (60s) and sustained-peak dwell (30s) don't need
 * samples that dense. Every poll still re-runs the oracle pipeline over
 * whatever's already stored (cheap, no network call); only the underlying
 * data refreshes on this cadence.
 */
const MIN_SAMPLE_INTERVAL_SEC = 15;

/** Safety cap on stored raw samples per side, so a long battle with many real
 * pools can't grow the Duel document without bound. Trimming old samples is
 * safe because sustainedPeakMarketCapUsd only ever increases (see below) --
 * a peak validated from since-trimmed samples is already locked in. */
const MAX_SAMPLES_PER_SIDE = 4000;

/**
 * Refreshes one side of a LIVE duel by running the real Section 04 oracle
 * pipeline (engine/src/oracle/aggregator.ts -- liquidity-weighted median
 * across every real pool, a liquidity-depth gate against the battle's
 * starting liquidity, 60s TWAP smoothing, and a dwell-time-validated
 * sustained peak) over every raw sample taken so far, fetching a fresh
 * multi-pool sample first if enough time has passed. currentMarketCapUsd is
 * the latest raw median read (for the live animated bar); sustainedPeakMarketCapUsd
 * is the oracle-validated peak and only ever increases, so trimming old raw
 * samples can't un-validate an already-locked-in peak. A side missing
 * tokenAddress/totalSupply (a duel created before those fields existed) is
 * left untouched rather than reset to anything fake.
 */
async function refreshSide(side: TokenSide): Promise<void> {
  if (!side.tokenAddress || !side.totalSupply) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const lastSampleSec = side.rawSamples.length > 0 ? side.rawSamples[side.rawSamples.length - 1].timestampSec : 0;

  if (nowSec - lastSampleSec >= MIN_SAMPLE_INTERVAL_SEC) {
    const fresh = await getLivePoolSamples(side.tokenAddress).catch(() => []);
    if (fresh.length > 0) {
      side.rawSamples.push(...fresh);
      if (side.rawSamples.length > MAX_SAMPLES_PER_SIDE) {
        side.rawSamples.splice(0, side.rawSamples.length - MAX_SAMPLES_PER_SIDE);
      }
      const priced = fresh.map(priceSample);
      const medianPriceUsd = liquidityWeightedMedianPrice(priced);
      if (medianPriceUsd > 0) side.currentMarketCapUsd = medianPriceUsd * side.totalSupply;
    }
  }

  if (side.rawSamples.length === 0) return;

  const result = runOraclePipeline({
    tokenAddress: side.tokenAddress,
    totalSupply: side.totalSupply,
    rawSamples: side.rawSamples,
    startLiquidityUsd: side.startLiquidityUsd ?? 0,
  });

  side.oracleVerified = result.sampleLogVerified;
  if (result.validatedPeakMarketCapUsd !== null) {
    side.sustainedPeakMarketCapUsd = Math.max(side.sustainedPeakMarketCapUsd, result.validatedPeakMarketCapUsd);
  }
}

/** Refreshes a LIVE duel's market caps in place through the real oracle pipeline. No-op for any other status. */
export async function simulateTick(duel: IDuel): Promise<void> {
  if (duel.status !== 'LIVE' || !duel.startTime) return;
  await Promise.all([refreshSide(duel.tokenA), refreshSide(duel.tokenB)]);
}

/**
 * Groups a wallet-sighting field's non-empty values and unions every wallet
 * that shares one into the same cluster -- e.g. every wallet seen from IP X,
 * or every wallet first funded by address Y.
 */
interface SightingLike {
  wallet: string;
  ip?: string;
  fundedBy?: string;
}

function unionSharedValues(graph: WalletClusterGraph, sightings: SightingLike[], keyOf: (s: SightingLike) => string | undefined) {
  const walletsByKey = new Map<string, Set<string>>();
  for (const s of sightings) {
    const key = keyOf(s);
    if (!key) continue;
    const wallets = walletsByKey.get(key) ?? new Set<string>();
    wallets.add(s.wallet);
    walletsByKey.set(key, wallets);
  }
  for (const wallets of walletsByKey.values()) {
    const [first, ...rest] = [...wallets];
    for (const wallet of rest) graph.union(first, wallet);
  }
}

/**
 * Real signals for @mcapduel/risk's wallet-clustering sybil check (Section
 * 05): true if the creator and opponent were ever seen from the same
 * request IP, or were ever first funded by the same address
 * (lib/models/WalletSighting.ts, recorded on create/join). Both have real
 * false positives (NAT/shared wifi/VPN; a shared exchange withdrawal), which
 * is exactly why a hit routes the match to HELD for human review rather
 * than voiding it.
 */
async function isSybilMatch(duel: IDuel): Promise<boolean> {
  if (!duel.opponentWallet) return false;

  const sightings = await WalletSighting.find({
    wallet: { $in: [duel.creatorWallet, duel.opponentWallet] },
  }).lean();
  if (sightings.length === 0) return false;

  const graph = new WalletClusterGraph();
  const typedSightings = sightings as unknown as SightingLike[];
  unionSharedValues(graph, typedSightings, (s) => s.ip);
  unionSharedValues(graph, typedSightings, (s) => s.fundedBy);

  return isSuspectedSybilMatch(graph, duel.creatorWallet, duel.opponentWallet);
}

export function computeWinnerSide(duel: IDuel): 0 | 1 {
  const returnPctA =
    ((duel.tokenA.sustainedPeakMarketCapUsd - duel.tokenA.startMarketCapUsd) / duel.tokenA.startMarketCapUsd) * 100;
  const returnPctB =
    ((duel.tokenB.sustainedPeakMarketCapUsd - duel.tokenB.startMarketCapUsd) / duel.tokenB.startMarketCapUsd) * 100;
  return returnPctA >= returnPctB ? 0 : 1;
}

/**
 * If a LIVE duel's timer has elapsed, determines the real winner from the
 * oracle-validated peaks and either:
 *
 *  - flags it HELD if @mcapduel/risk's wallet-clustering check suspects a
 *    sybil match -- checked BEFORE any oracle signature is produced, because
 *    once signed, BattleEscrow.settle() lets anyone submit it permissionlessly
 *    (Contracts/src/duel/BattleEscrow.sol); a flag after signing would do
 *    nothing to stop the payout.
 *  - for a real on-chain duel (escrowAddress set): signs the result
 *    (lib/oracleSigner.ts) and moves to SETTLING, then stops. Points and
 *    CombatRecord updates wait for app/api/duels/[id]/confirm-settlement to
 *    verify the real settle() transaction -- they never get ahead of what
 *    actually happened on-chain.
 *  - for a legacy off-chain-only duel (created before on-chain integration
 *    existed): settles immediately in the database, same as before.
 *
 * With `relay` (the default), a freshly-signed on-chain result is handed to
 * lib/settlementRelayer.ts in the background; the cron passes false because
 * it relays every SETTLING duel itself right after.
 *
 * Mutates `duel` and persists it. Safe to call repeatedly -- and safe to call
 * concurrently for the same duel: the LIVE -> SETTLING claim below is an
 * atomic compare-and-swap, so at most one concurrent caller (multiple
 * frontend polls, browser tabs, or serverless instances racing the same
 * duel right at its end time) ever proceeds past it. Without this, two
 * concurrent callers could both pass the `duel.status !== 'LIVE'` check
 * above before either saved, and both go on to award points twice.
 */
export async function maybeSettle(duel: IDuel, { relay = true }: { relay?: boolean } = {}): Promise<void> {
  if (duel.status !== 'LIVE' || !duel.startTime || !duel.endTime) return;
  if (Date.now() < duel.endTime.getTime()) return;

  const claimed = await Duel.findOneAndUpdate({ _id: duel._id, status: 'LIVE' }, { $set: { status: 'SETTLING' } });
  if (!claimed) return;

  // One last real read (bypassing the sample-interval throttle isn't needed --
  // refreshSide already fetches if the last sample is stale, which it will be
  // for a duel that's just crossed its end time) to catch any move in the
  // final seconds before locking in the result.
  await Promise.all([refreshSide(duel.tokenA), refreshSide(duel.tokenB)]);

  const winnerSide = computeWinnerSide(duel);
  const nowSec = Math.floor(Date.now() / 1000);
  let lobby = closeBattleWindow(toLobbySnapshot(duel), nowSec);

  if (await isSybilMatch(duel)) {
    applyLobby(duel, flagForReview(lobby));
    duel.flaggedSybil = true;
    await duel.save();
    return;
  }

  if (duel.escrowAddress) {
    duel.status = 'SETTLING';
    duel.winnerSide = winnerSide;
    duel.oracleSignature = await signSettlement(duel.escrowAddress as `0x${string}`, winnerSide);
    await duel.save();
    if (relay) scheduleRelay(duel);
    return;
  }

  lobby = settle(lobby, winnerSide);
  applyLobby(duel, lobby);
  await finalizeSettlement(duel, winnerSide);
}

/**
 * Pushes the freshly-signed result on-chain without making the caller wait
 * for it, so the winner's payout doesn't depend on anyone clicking "Claim"
 * before BattleEscrow.refundStale() opens at endTime + 24h (at which point
 * the loser could refund their lost stake). next/server's after() is
 * Vercel's waitUntil under the hood: the response goes out immediately and
 * the function stays alive for the relay. Outside a request (a unit test, a
 * script) there's no request scope to hang it on -- the cron
 * (app/api/cron/settle) picks the duel up on its next run instead.
 */
function scheduleRelay(duel: IDuel): void {
  try {
    after(() => submitSettlement(duel));
  } catch {
    // no request scope -- left to the cron
  }
}

/**
 * The single place an on-chain settlement becomes SETTLED in the database,
 * once the caller has established the real winnerSide from the chain (a
 * verified Settled event, or a direct read of an already-Settled escrow).
 * Used by app/api/duels/[id]/confirm-settlement and lib/settlementRelayer.ts.
 * The SETTLING -> SETTLED claim is an atomic compare-and-swap, so a user's
 * confirm call racing the relayer can't both reach finalizeSettlement and
 * double-credit points. Returns false if someone else already finalized it.
 */
export async function confirmOnChainSettlement(
  duel: IDuel,
  winnerSide: 0 | 1,
  deferredPayouts: DeferredPayout[] = []
): Promise<boolean> {
  const claimed = await Duel.findOneAndUpdate(
    { _id: duel._id, status: 'SETTLING' },
    { $set: { status: 'SETTLED', winnerSide, deferredPayouts } }
  );
  if (!claimed) return false;

  applyLobby(duel, settle(toLobbySnapshot(duel), winnerSide));
  duel.deferredPayouts = deferredPayouts;
  await finalizeSettlement(duel, winnerSide);
  return true;
}

/** DB-side consequence of the escrow already being Refunded on-chain (refundStale()
 * landed first) -- no winner, no points. Same compare-and-swap. */
export async function confirmOnChainRefund(duel: IDuel): Promise<boolean> {
  if (duel.status !== 'LIVE' && duel.status !== 'SETTLING' && duel.status !== 'HELD') return false;
  const claimed = await Duel.findOneAndUpdate(
    { _id: duel._id, status: duel.status },
    { $set: { status: refundStale(toLobbySnapshot(duel)).status } }
  );
  return Boolean(claimed);
}

/**
 * Awards points (Section 07, gated by opponent diversity) and updates both
 * wallets' CombatRecord for a settlement that's now confirmed real -- either
 * a legacy off-chain duel settling immediately (maybeSettle above), or an
 * on-chain duel after its real settle() transaction has been verified
 * (app/api/duels/[id]/confirm-settlement/route.ts). Callers set
 * duel.status/winnerSide themselves before calling this; it only persists
 * the points fields and the CombatRecord side effects.
 */
export async function finalizeSettlement(duel: IDuel, winnerSide: 0 | 1): Promise<void> {
  const returnPctA =
    ((duel.tokenA.sustainedPeakMarketCapUsd - duel.tokenA.startMarketCapUsd) / duel.tokenA.startMarketCapUsd) * 100;
  const returnPctB =
    ((duel.tokenB.sustainedPeakMarketCapUsd - duel.tokenB.startMarketCapUsd) / duel.tokenB.startMarketCapUsd) * 100;
  const winnerReturnPct = winnerSide === 0 ? returnPctA : returnPctB;
  const loserReturnPct = winnerSide === 0 ? returnPctB : returnPctA;

  const winnerWallet = winnerSide === duel.creatorSide ? duel.creatorWallet : duel.opponentWallet!;
  const loserWallet = winnerSide === duel.creatorSide ? duel.opponentWallet! : duel.creatorWallet;

  const { winnerPoints, loserPoints } = computeMatchPoints({
    buyInUsd: duel.buyInUsd,
    winnerReturnPct,
    loserReturnPct,
  });

  duel.winnerSide = winnerSide;
  duel.winnerPoints = Math.round(winnerPoints);
  duel.loserPoints = Math.round(loserPoints);
  await duel.save();

  await applyPoints(winnerWallet, loserWallet, Math.round(winnerPoints), true);
  await applyPoints(loserWallet, winnerWallet, Math.round(loserPoints), false);
}

async function applyPoints(wallet: string, opponent: string, points: number, won: boolean): Promise<void> {
  const record =
    (await CombatRecord.findOne({ wallet: wallet.toLowerCase() })) ??
    new CombatRecord({ wallet: wallet.toLowerCase() });

  const eligible = isPointsEligible(record.recentOpponents, opponent.toLowerCase());
  if (eligible) record.totalPoints += points;

  record.wins += won ? 1 : 0;
  record.losses += won ? 0 : 1;
  record.currentStreak = won ? Math.max(1, record.currentStreak + 1) : 0;
  record.recentOpponents = [...record.recentOpponents, opponent.toLowerCase()].slice(-50);

  await record.save();
}
