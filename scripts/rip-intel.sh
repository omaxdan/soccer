#!/bin/bash
# ─── RIP (legacy app) — intelligence (crontab: 0 4 * * *) ────────────────────
# Zero API calls, so it ALWAYS runs regardless of the 01:00/03:00 outcomes
# (stale inputs beat no outputs). Replaces the 04:00 entry that ran
# process:all-db under the misleading rip-weekly.lock, and RESTORES
# archive:readiness-snapshot + analytics:refresh-league-gap — without them
# the accuracy layer wasn't accumulating pre-match snapshots at all.
set -uo pipefail

APP="/home/mybrzklx/apps/rip"
NODE="/opt/alt/alt-nodejs24/root/usr/bin/node"
LOG="/home/mybrzklx/logs/rip-intel.log"
LOCK="/home/mybrzklx/.locks/rip-intel.lock"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

exec >> "$LOG" 2>&1
OK=0; FAILED=0; CRITICAL_FAILED=0

run() { # run <critical|best-effort> <cli-command...>
  local tier="$1"; shift
  echo "[$(date -Is)] $*"
  if "$NODE" --max-old-space-size=1024 dist/cli.js "$@"; then OK=$((OK+1)); return 0; fi
  local rc=$?
  echo "[$(date -Is)] STEP FAILED (rc=$rc, tier=$tier): $*"
  FAILED=$((FAILED+1))
  [ "$tier" = "critical" ] && CRITICAL_FAILED=$((CRITICAL_FAILED+1))
  return 0
}

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: previous intelligence run still active"; exit 0; }
  echo "=== $(date -Is) INTELLIGENCE START ==="
  cd "$APP"
  run critical    process:all-db
  run best-effort archive:readiness-snapshot
  run best-effort analytics:refresh-league-gap
  echo "RESULT ok=$OK failed=$FAILED critical_failed=$CRITICAL_FAILED"
  if [ "$CRITICAL_FAILED" -eq 0 ] && [ -n "$HEALTHCHECK_URL" ]; then
    curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" > /dev/null || true
  fi
) 9>"$LOCK"
