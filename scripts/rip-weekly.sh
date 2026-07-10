#!/bin/bash
# ─── RIP (legacy app) — weekly (crontab: 30 4 * * 1, Mondays) ────────────────
# RESTORED ENTIRELY: neither step is in the live crontab — league positions
# (tournament_standings → strength ratings → NBSI) have been aging since the
# last manual run. ~49 API calls, Mondays only, 30min after intelligence so
# they don't race; Tuesday's process pass picks up fresh standings.
set -uo pipefail

APP="/home/mybrzklx/apps/rip"
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

# ─── CRONTAB — these lines REPLACE all four current entries ──────────────────
# Scripts live at /home/mybrzklx/scripts/ (they cd into APP internally, so
# location is free choice). Optionally add at the very top of the crontab:
#    HEALTHCHECK_URL=https://hc-ping.com/YOUR-UUID
#
# 0 */2 * * *  /bin/bash /home/mybrzklx/scripts/rip-2h.sh
# 0 1   * * *  /bin/bash /home/mybrzklx/scripts/rip-fixtures.sh
# 0 3   * * *  /bin/bash /home/mybrzklx/scripts/rip-enrichment.sh
# 0 2   * * 1  /bin/bash /home/mybrzklx/scripts/rip-stats.sh 2     # Mon: Mon-Tue window
# 0 2   * * 3  /bin/bash /home/mybrzklx/scripts/rip-stats.sh 2     # Wed: Wed-Thu window
# 0 2   * * 5  /bin/bash /home/mybrzklx/scripts/rip-stats.sh 3     # Fri: Fri-SUN window (closes the Sunday gap)
# 0 4   * * *  /bin/bash /home/mybrzklx/scripts/rip-intel.sh
# 30 4  * * 1  /bin/bash /home/mybrzklx/scripts/rip-weekly.sh
#
# QUOTA BUDGET (200/day dual-key): daily = fixtures ~4 + squads 30-80.
# MWF adds stats 60-160 (Fri heaviest). Mon adds weekly ~49 — Monday total
# worst-case ~4+80+120+49 ≈ 250: if that ever bites, move rip-weekly to
# Tuesday. 2h + intel scripts: zero API calls.
