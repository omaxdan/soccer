#!/bin/bash
# ─── RIP (legacy app) — season stats (crontab: Mon/Wed/Fri 2 AM) ─────────────
# Split out of the daily enrichment run to spread API quota across the week.
#
# Usage: rip-stats.sh [daysAhead]   (default 2)
#
# SCHEDULING NOTE — the Sunday gap: with a 2-day window, Mon covers Mon-Tue,
# Wed covers Wed-Thu, Fri covers Fri-Sat... and SUNDAY — the busiest matchday
# in the tracked lower-tier leagues — is never covered. Fix: Friday's entry
# passes 3, extending its window through Sunday.
#
# Budget per run: player-stats ~1 call/team in window + team-stats same —
# typically 60-160 calls on the Friday(3) run, well under 200 with squads
# (~30-80) now the only other API consumer that day.
set -uo pipefail

DAYS="${1:-2}"
APP="/home/mybrzklx/apps/rip"
NODE="/opt/alt/alt-nodejs24/root/usr/bin/node"
LOG="/home/mybrzklx/logs/rip-stats.log"
LOCK="/home/mybrzklx/.locks/rip-stats.lock"

exec >> "$LOG" 2>&1
OK=0; FAILED=0

run() {
  echo "[$(date -Is)] $*"
  if "$NODE" --max-old-space-size=768 dist/cli.js "$@"; then OK=$((OK+1));
  else local rc=$?; echo "[$(date -Is)] STEP FAILED (rc=$rc): $*"; FAILED=$((FAILED+1)); fi
}

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: previous stats run still active"; exit 0; }
  echo "=== $(date -Is) STATS START (window: ${DAYS}d) ==="
  cd "$APP"
  run sync:player-stats "$DAYS"
  run sync:team-stats "$DAYS"
  echo "RESULT ok=$OK failed=$FAILED"
) 9>"$LOCK"
