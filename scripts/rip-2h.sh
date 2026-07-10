#!/bin/bash
# ─── RIP (legacy app) — 2-hourly (crontab: 0 */2 * * *) ──────────────────────
# DB-only, zero API calls. Matches your current 2h cron (process:form:recent)
# and ADDS archive:link-results so finished matches get their results joined
# into readiness_history within 2h instead of waiting for the daily run.
set -uo pipefail

APP="/home/mybrzklx/apps/rip"
NODE="/opt/alt/alt-nodejs24/root/usr/bin/node"
LOG="/home/mybrzklx/logs/rip-2h.log"
LOCK="/home/mybrzklx/.locks/rip-2h.lock"

exec >> "$LOG" 2>&1
OK=0; FAILED=0

run() { # best-effort: log and continue
  echo "[$(date -Is)] $*"
  if "$NODE" --max-old-space-size=768 dist/cli.js "$@"; then OK=$((OK+1));
  else echo "[$(date -Is)] STEP FAILED (rc=$?): $*"; FAILED=$((FAILED+1)); fi
}

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: previous 2h run still active"; exit 0; }
  echo "=== $(date -Is) 2H START ==="
  cd "$APP"
  run process:form:recent
  run archive:link-results
  echo "RESULT ok=$OK failed=$FAILED"
) 9>"$LOCK"
