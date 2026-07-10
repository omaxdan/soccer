#!/bin/bash
# ─── RIP BETA — weekly (crontab: 30 4 * * 1, Mondays) ────────────────────────
# RESTORED ENTIRELY: neither step exists in the live crontab, meaning league
# positions (tournament_standings → team_strength_ratings.league_position →
# strength/NBSI) have been aging since the last manual run, and the 7-day
# fixture horizon wasn't refreshed as a block.
#
#   sync:standings  ~42 calls (one per tracked tournament)
#   sync:week       ~7 calls  (one master feed per day)
# Budget: ~49 calls, Mondays only — sequenced 30min after intelligence so
# Monday's process pass at 04:00 isn't racing it; Tuesday's pass picks up
# the fresh standings.
set -uo pipefail

APP="/home/mybrzklx/apps/rip-beta"
NODE="/opt/alt/alt-nodejs24/root/usr/bin/node"
LOG="/home/mybrzklx/logs/rip-weekly.log"
LOCK="/home/mybrzklx/.locks/rip-weekly.lock"

exec >> "$LOG" 2>&1
OK=0; FAILED=0

run() {
  echo "[$(date -Is)] $*"
  if "$NODE" --max-old-space-size=768 dist/cli.js "$@"; then OK=$((OK+1));
  else echo "[$(date -Is)] STEP FAILED (rc=$?): $*"; FAILED=$((FAILED+1)); fi
}

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: previous weekly run still active"; exit 0; }
  echo "=== $(date -Is) WEEKLY START ==="
  cd "$APP"
  run sync:standings
  run sync:week
  echo "RESULT ok=$OK failed=$FAILED"
) 9>"$LOCK"

# ─── CRONTAB (cutover: these five lines REPLACE all four current entries) ────
# Scripts own their locks/logs/node flags; crontab stays one-liner-simple.
# Optionally export HEALTHCHECK_URL=... at the top of the crontab.
#
# 0 */2 * * *  /bin/bash /home/mybrzklx/apps/rip-beta/scripts/rip-2h.sh
# 0 1   * * *  /bin/bash /home/mybrzklx/apps/rip-beta/scripts/rip-fixtures.sh
# 0 3   * * *  /bin/bash /home/mybrzklx/apps/rip-beta/scripts/rip-enrichment.sh
# 0 4   * * *  /bin/bash /home/mybrzklx/apps/rip-beta/scripts/rip-intel.sh
# 30 4  * * 1  /bin/bash /home/mybrzklx/apps/rip-beta/scripts/rip-weekly.sh
#
# QUOTA BUDGET (200/day dual-key):
#   fixtures ~4 + enrichment 60-120 typical (240 worst-case weekend, ordered
#   so squads win if quota exhausts) + Mondays +49 = typical day 65-125,
#   worst Monday ~175-200. Intelligence + 2h scripts: zero API calls.
