#!/bin/bash
# NinetyData RIP — Weekly cron wrapper (run Monday only)
# sync:standings (~42 calls) + sync:week (7 calls) = ~49 calls
# Separated from daily because both re-fetch unconditionally every run.

set -euo pipefail

LOCK="/home/mybrzklx/.locks/rip-weekly.lock"
LOG="/home/mybrzklx/logs/rip-weekly.log"
APP="/home/mybrzklx/apps/rip"
NODE="/home/mybrzklx/nodevenv/apps/rip/24/bin/node"

exec >> "$LOG" 2>&1

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: another weekly run is still active"; exit 0; }

  echo ""
  echo "=== $(date -Is) WEEKLY SYNC START ==="
  cd "$APP"

  echo "[$(date -Is)] sync:standings"
  "$NODE" dist/cli.js sync:standings

  echo "[$(date -Is)] sync:week"
  "$NODE" dist/cli.js sync:week

  echo "=== $(date -Is) WEEKLY SYNC DONE ==="

) 9>"$LOCK"
