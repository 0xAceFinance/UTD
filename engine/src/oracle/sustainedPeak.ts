import type { TimePoint } from "./twap.js";
import type { SustainedPeakResult } from "../types.js";
import { ORACLE_CONFIG } from "../config.js";

/**
 * Section 04, mechanism 3 — the one that matters most.
 *
 * Every sample is a candidate "new high." A candidate only counts as the
 * battle's validated peak if price stays within `toleranceRatio` of it for
 * the full `dwellSeconds` that follow. The validated peak is the highest
 * candidate that clears that bar.
 *
 * A pump-and-immediately-dump wick fails the moment price drops out of its
 * tolerance band before the dwell window closes, so it never becomes the
 * reported peak. A genuine rally that holds near its high passes, and does.
 */
export function computeSustainedPeak(
  points: TimePoint[],
  opts: { dwellSeconds?: number; toleranceRatio?: number } = {}
): SustainedPeakResult | null {
  const dwellSeconds = opts.dwellSeconds ?? ORACLE_CONFIG.sustainedPeakDwellSeconds;
  const toleranceRatio = opts.toleranceRatio ?? ORACLE_CONFIG.sustainedPeakToleranceRatio;
  const sorted = [...points].sort((a, b) => a.timestampSec - b.timestampSec);
  if (sorted.length === 0) return null;

  let best: SustainedPeakResult | null = null;

  for (const candidate of sorted) {
    const windowEnd = candidate.timestampSec + dwellSeconds;

    // Only count a candidate once we've actually observed the full dwell
    // window — otherwise we'd be crediting a peak that hasn't held yet.
    const hasFullCoverage = sorted.some((p) => p.timestampSec >= windowEnd);
    if (!hasFullCoverage) continue;

    const windowPoints = sorted.filter(
      (p) => p.timestampSec >= candidate.timestampSec && p.timestampSec <= windowEnd
    );
    const floor = candidate.priceUsd * (1 - toleranceRatio);
    const held = windowPoints.every((p) => p.priceUsd >= floor);

    if (held && (!best || candidate.priceUsd > best.peakPriceUsd)) {
      best = { peakPriceUsd: candidate.priceUsd, windowStartSec: candidate.timestampSec, dwellSeconds };
    }
  }

  return best;
}
