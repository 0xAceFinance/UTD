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
