export type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Diamond';

export interface ComputeMatchPointsInput {
  buyInUsd: number;
  winnerReturnPct: number;
  loserReturnPct: number;
}

export interface MatchPointsResult {
  winnerPoints: number;
  loserPoints: number;
}

/**
 * Calculates tier from lifetime totalPoints.
 * Mirrors CombatRecordNFT.sol tierOf().
 * Bronze: < 5,000
 * Silver: 5,000 - 24,999
 * Gold: 25,000 - 99,999
 * Diamond: >= 100,000
 */
export function tierForPoints(totalPoints: number): Tier {
  if (totalPoints >= 100_000) return 'Diamond';
  if (totalPoints >= 25_000) return 'Gold';
  if (totalPoints >= 5_000) return 'Silver';
  return 'Bronze';
}

/**
 * Computes points awarded to winner and loser.
 * Both receive > 0 points (participation/consolation), with winner strictly receiving more.
 */
export function computeMatchPoints(input: ComputeMatchPointsInput): MatchPointsResult {
  const buyIn = Math.max(1, input.buyInUsd || 10);
  const winBonus = Math.max(0, input.winnerReturnPct || 0);
  const loseBonus = Math.max(0, input.loserReturnPct || 0);

  const winnerPoints = Math.max(10, Math.round(buyIn * 1.5 + winBonus * 2));
  const loserPoints = Math.max(1, Math.round(buyIn * 0.5 + loseBonus * 0.5));

  return {
    winnerPoints: winnerPoints > loserPoints ? winnerPoints : loserPoints + 1,
    loserPoints,
  };
}

/**
 * Opponent diversity gate.
 * Prevents farming by capping repeats of the same opponent in recent matches (last 50).
 */
export function isPointsEligible(recentOpponents: string[], opponent: string): boolean {
  if (!recentOpponents || recentOpponents.length === 0) return true;
  const target = opponent.toLowerCase();
  // In the last 50 opponents, reject if 5 or more matches are against this same opponent
  const matches = recentOpponents.filter((o) => o.toLowerCase() === target).length;
  return matches < 5;
}
