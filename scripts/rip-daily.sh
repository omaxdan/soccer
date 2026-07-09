#!/bin/bash
set -euo pipefail

LOCK="/home/mybrzklx/.locks/rip-daily.lock"
LOG="/home/mybrzklx/logs/rip-daily.log"
APP="/home/mybrzklx/apps/rip"
NODE="/home/mybrzklx/nodevenv/apps/rip/24/bin/node"

exec >> "$LOG" 2>&1

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: another daily run is still active"; exit 0; }

  echo ""
  echo "=== $(date -Is) DAILY SYNC START ==="
  cd "$APP"

  echo "[$(date -Is)] sync:today"
  "$NODE" dist/cli.js sync:today

  echo "[$(date -Is)] sync:tomorrow"
  "$NODE" dist/cli.js sync:tomorrow

  echo "[$(date -Is)] sync:squads:v2 2"
  "$NODE" dist/cli.js sync:squads:v2 2

  echo "[$(date -Is)] sync:player-stats 2"
  "$NODE" dist/cli.js sync:player-stats 2

  echo "[$(date -Is)] sync:team-stats 2"
  "$NODE" dist/cli.js sync:team-stats 2

  echo "[$(date -Is)] process:all-db"
  "$NODE" dist/cli.js process:all-db

  echo "[$(date -Is)] archive:readiness-snapshot"
  "$NODE" dist/cli.js archive:readiness-snapshot

  echo "[$(date -Is)] archive:link-results"
  "$NODE" dist/cli.js archive:link-results

  echo "[$(date -Is)] analytics:refresh-league-gap"
  "$NODE" dist/cli.js analytics:refresh-league-gap

  echo "=== $(date -Is) DAILY SYNC DONE ==="

) 9>"$LOCK"