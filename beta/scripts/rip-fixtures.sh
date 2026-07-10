#!/bin/bash
# ─── RIP BETA — fixtures (crontab: 0 1 * * *) ────────────────────────────────
# The load-bearing sync. Everything downstream depends on fresh fixtures.
#   sync:today     ~1-2 API calls (master feed populates 8 tables)
#   sync:tomorrow  ~1-2 API calls — RESTORED: absent from live cron, so
#                  early-kickoff matches had no pre-match coverage window.
# Budget: ~4 calls of the 200/day quota.
set -uo pipefail

APP="/home/mybrzklx/apps/rip-beta"
NODE="/opt/alt/alt-nodejs24/root/usr/bin/node"
LOG="/home/mybrzklx/logs/rip-daily.log"
LOCK="/home/mybrzklx/.locks/rip-daily.lock"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"   # optional dead-man's switch ping

exec >> "$LOG" 2>&1
CRITICAL_FAILED=0

runc() { # critical: mark failure, keep going so the sibling still runs
  echo "[$(date -Is)] $*"
  if ! "$NODE" --max-old-space-size=768 dist/cli.js "$@"; then
    local rc=$?
    echo "[$(date -Is)] CRITICAL STEP FAILED (rc=$rc): $*"
    CRITICAL_FAILED=$((CRITICAL_FAILED+1))
  fi
}

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: previous fixtures run still active"; exit 0; }
  echo "=== $(date -Is) FIXTURES START ==="
  cd "$APP"
  runc sync:today
  runc sync:tomorrow
  echo "RESULT critical_failed=$CRITICAL_FAILED"
  if [ "$CRITICAL_FAILED" -eq 0 ] && [ -n "$HEALTHCHECK_URL" ]; then
    curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" > /dev/null || true
  fi
) 9>"$LOCK"
