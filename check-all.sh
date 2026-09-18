#!/usr/bin/env bash
# Runs every automated check across every MCAP DUEL package built so far
# (Phases 1-4) and prints a pass/fail summary. Safe to re-run any time.
set -uo pipefail
cd "$(dirname "$0")"

pass=0
fail=0
failed_names=()

run_check() {
  local name="$1"
  local dir="$2"
  local cmd="$3"
  echo ""
  echo "=== $name ($dir) ==="
  if (cd "$dir" && eval "$cmd"); then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    failed_names+=("$name")
  fi
}

# FE/packages/* are one-time-vendored copies of the top-level engine/
# matchmaking/points/risk packages (see FE/package.json's `file:./packages/*`
# deps), needed because FE is what actually gets deployed. Nothing keeps them
# in sync automatically, so this check fails loudly the moment a source
# package changes without FE/packages/* being re-copied -- exactly the drift
# that let FE run a stale, uncapped points formula for a while.
run_check_vendored_package_in_sync() {
  local name="$1"
  echo ""
  echo "=== vendored package in sync: $name ==="
  if diff -rq "$name/src" "FE/packages/$name/src" >/tmp/vendor-drift-$name.diff 2>&1; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    failed_names+=("vendored package in sync: $name")
    echo "FE/packages/$name/src has drifted from $name/src:"
    cat /tmp/vendor-drift-$name.diff
    echo "Fix: copy $name/src's current content into FE/packages/$name/src."
  fi
}

run_check_vendored_package_in_sync "engine"
run_check_vendored_package_in_sync "matchmaking"
run_check_vendored_package_in_sync "points"
run_check_vendored_package_in_sync "risk"

run_check "tier thresholds in sync" .            "node scripts/check-tier-thresholds.mjs"

run_check "engine: typecheck"       engine       "npm run typecheck"
run_check "engine: tests"           engine       "npm test"
run_check "matchmaking: typecheck"  matchmaking  "npm run typecheck"
run_check "matchmaking: tests"      matchmaking  "npm test"
run_check "points: typecheck"       points       "npm run typecheck"
run_check "points: tests"           points       "npm test"
run_check "risk: typecheck"         risk         "npm run typecheck"
run_check "risk: tests"             risk         "npm test"
run_check "Contracts: build"        Contracts    "forge build"
run_check "Contracts: tests"        Contracts    "forge test"

echo ""
echo "============================================"
echo "  $pass check(s) passed, $fail failed"
if [ "$fail" -gt 0 ]; then
  echo "  Failed: ${failed_names[*]}"
fi
echo "============================================"

exit $fail
