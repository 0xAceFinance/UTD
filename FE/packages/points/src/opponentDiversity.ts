import { OPPONENT_DIVERSITY_CONFIG } from "./config.js";

/**
 * Section 07's hard anti-farm rule: no single opponent may account for more
 * than 20% of a wallet's points-eligible matches in a rolling 50-match
 * window. This is the direct closer for the "wallet pair duels itself
 * repeatedly to farm points" abuse vector from Section 05 — the match still
 * settles funds exactly as normal either way; this only ever gates whether
 * *points* are awarded for it.
 *
 * `priorOpponents` is the wallet's last (windowSize - 1) points-eligible
 * opponents, oldest first. The match currently being evaluated is treated as
 * the newest entry.
 */
export function isPointsEligible(priorOpponents: string[], candidateOpponent: string): boolean {
  const windowSize = OPPONENT_DIVERSITY_CONFIG.rollingWindowSize;
  const window = [...priorOpponents.slice(-(windowSize - 1)), candidateOpponent];

  if (window.length < OPPONENT_DIVERSITY_CONFIG.minWindowSizeToEnforce) return true;

  const occurrences = window.filter((o) => o === candidateOpponent).length;
  const share = occurrences / window.length;
  return share <= OPPONENT_DIVERSITY_CONFIG.maxShareOfWindow;
}
