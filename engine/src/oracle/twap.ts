export interface TimePoint {
  timestampSec: number;
  priceUsd: number;
}

/**
 * Trailing time-weighted average price ending at `atTimestampSec`, over the
 * given window. Section 04, mechanism 2: blunts single-block spikes — a
 * one-block wick barely moves a 60-second trapezoidal average.
 */
export function twapAt(points: TimePoint[], atTimestampSec: number, windowSeconds: number): number {
  const windowStart = atTimestampSec - windowSeconds;
  const inWindow = points
    .filter((p) => p.timestampSec <= atTimestampSec && p.timestampSec >= windowStart)
    .sort((a, b) => a.timestampSec - b.timestampSec);

  if (inWindow.length === 0) return 0;
  if (inWindow.length === 1) return inWindow[0].priceUsd;

  let weightedSum = 0;
  let totalTime = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const dt = inWindow[i].timestampSec - inWindow[i - 1].timestampSec;
    const avgPrice = (inWindow[i].priceUsd + inWindow[i - 1].priceUsd) / 2;
    weightedSum += avgPrice * dt;
    totalTime += dt;
  }
  return totalTime === 0 ? inWindow[inWindow.length - 1].priceUsd : weightedSum / totalTime;
}

/** Maps a raw price series onto its trailing-TWAP series, point for point. */
export function computeTwapSeries(points: TimePoint[], windowSeconds: number): TimePoint[] {
  return points.map((p) => ({ timestampSec: p.timestampSec, priceUsd: twapAt(points, p.timestampSec, windowSeconds) }));
}
