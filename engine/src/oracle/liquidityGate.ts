import { ORACLE_CONFIG } from "../config.js";

/**
 * Section 04, mechanism 4: reject a price read if pool liquidity has dropped
 * too far from what it was at battle start — catches both a rug pull and
 * a "drain the pool to fake a price move" attack.
 */
export function passesLiquidityGate(
  currentLiquidityUsd: number,
  startLiquidityUsd: number,
  minRatio: number = ORACLE_CONFIG.liquidityGateMinRatio
): boolean {
  if (startLiquidityUsd <= 0) return false;
  return currentLiquidityUsd / startLiquidityUsd >= minRatio;
}
