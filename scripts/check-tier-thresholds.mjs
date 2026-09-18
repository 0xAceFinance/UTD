#!/usr/bin/env node
// Cross-checks the points-tier thresholds that live in two places with no
// shared source of truth (Contracts/src/rewards/CombatRecordNFT.sol's
// tierOf() manually mirrors points/src/pointsEngine.ts's TIER_THRESHOLDS --
// see the comment on tierOf() and check-all.sh's vendored-package check for
// the same class of drift risk). Fails loudly if they ever disagree instead
// of silently letting on-chain tiers/redemption caps diverge from the
// points/leaderboard tiers players actually see.
//
// Regex-based, not a real parser, because both source layouts are simple and
// stable today -- if either file's structure changes meaningfully, update
// the patterns below rather than trusting a false pass.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readThresholdsFromPointsEngine() {
  const src = readFileSync(join(repoRoot, 'points/src/pointsEngine.ts'), 'utf-8');
  const match = src.match(/TIER_THRESHOLDS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!match) throw new Error('Could not find TIER_THRESHOLDS in points/src/pointsEngine.ts');

  const thresholds = {};
  const entryPattern = /\{\s*tier:\s*"(\w+)",\s*min:\s*([\d_]+)\s*\}/g;
  let entry;
  while ((entry = entryPattern.exec(match[1]))) {
    thresholds[entry[1]] = Number(entry[2].replace(/_/g, ''));
  }
  if (Object.keys(thresholds).length === 0) {
    throw new Error('Parsed zero tier entries from points/src/pointsEngine.ts -- pattern is stale');
  }
  return thresholds;
}

function readThresholdsFromCombatRecordNFT() {
  const src = readFileSync(join(repoRoot, 'Contracts/src/rewards/CombatRecordNFT.sol'), 'utf-8');
  const match = src.match(/function tierOf\([\s\S]*?\{([\s\S]*?)\n    \}/);
  if (!match) throw new Error('Could not find tierOf() in Contracts/src/rewards/CombatRecordNFT.sol');

  const thresholds = {};
  const linePattern = /if\s*\([^)]*>=\s*([\d_]+)\)\s*return\s*"(\w+)"/g;
  let line;
  while ((line = linePattern.exec(match[1]))) {
    thresholds[line[2]] = Number(line[1].replace(/_/g, ''));
  }
  const bottomMatch = match[1].match(/return\s*"(\w+)"\s*;\s*$/);
  if (bottomMatch) thresholds[bottomMatch[1]] = thresholds[bottomMatch[1]] ?? 0;
  if (Object.keys(thresholds).length === 0) {
    throw new Error('Parsed zero tier entries from CombatRecordNFT.sol -- pattern is stale');
  }
  return thresholds;
}

const tsThresholds = readThresholdsFromPointsEngine();
const solThresholds = readThresholdsFromCombatRecordNFT();

const allTiers = new Set([...Object.keys(tsThresholds), ...Object.keys(solThresholds)]);
const mismatches = [];
for (const tier of allTiers) {
  if (tsThresholds[tier] !== solThresholds[tier]) {
    mismatches.push(`  ${tier}: points/src/pointsEngine.ts=${tsThresholds[tier]} vs CombatRecordNFT.sol=${solThresholds[tier]}`);
  }
}

if (mismatches.length > 0) {
  console.error('Tier thresholds have drifted between points/src/pointsEngine.ts and CombatRecordNFT.sol:');
  console.error(mismatches.join('\n'));
  console.error('\nFix: update whichever side is stale so both list the exact same thresholds.');
  process.exit(1);
}

console.log(`Tier thresholds match across both sources: ${JSON.stringify(tsThresholds)}`);
