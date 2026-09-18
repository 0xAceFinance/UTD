export const POINTS_CONFIG = {
  basePoints: 100,
  loserFlatRate: 0.25, // Section 07: loser earns a flat ~25% of the winner's base rate
  // Stake multiplier: linear in buy-in size, capped so one huge stake can't
  // dominate the points economy on its own.
  stakeMultiplierPer100Usd: 1,
  stakeMultiplierCap: 10,
  // Margin multiplier: rewards a bigger performance gap between the two sides.
  marginMultiplierCap: 3,
};

export const OPPONENT_DIVERSITY_CONFIG = {
  // Section 07 hard rule: no single opponent may account for more than this
  // share of a wallet's points-eligible matches in the rolling window below.
  maxShareOfWindow: 0.2,
  rollingWindowSize: 50,
  // Below this many matches, the sample is too small for a share to mean
  // anything (a brand-new player's 1st match is trivially "100% vs one
  // opponent"). Below the threshold, everyone is eligible.
  minWindowSizeToEnforce: 5,
};
