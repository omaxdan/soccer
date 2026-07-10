#!/bin/bash
# ─── RIP BETA — intelligence (crontab: 0 4 * * *) ────────────────────────────
# Zero API calls — pure DB computation, so it ALWAYS runs regardless of what
# happened at 01:00/03:00 (stale inputs beat no outputs; the tier design
# exists precisely so a flaky enrichment 500 can't starve this).
#
#   process:all-db              full pass (kept full, matching your live cron:
#                               it self-heals gaps daily and the read sweep
#                               made its row coverage complete — expect it
#                               slower than the old capped runs, that's the
#                               363 extra teams and 600+ extra matches)
#   archive:readiness-snapshot  RESTORED — the pre-match accuracy archive was
#                               not being written by live cron at all.
#   analytics:refresh-league-gap RESTORED — league gap analytics rebuild.
#
# Lock renamed rip-intel (was rip-weekly.lock guarding a daily job).
set -uo pipefail

APP="/home/mybrzklx/apps/rip-beta"
NODE="/opt/alt/alt-nodejs24/root/usr/bin/node"
LOG="/home/mybrzklx/logs/rip-intel.log"
LOCK="/home/mybrzklx/.locks/rip-intel.lock"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

exec >> "$LOG" 2>&1
OK=0; FAILED=0; CRITICAL_FAILED=0

run() { # run <critical|best-effort> <cli-command...>
  local tier="$1"; shift
  echo "[$(date -Is)] $*"
  "$NODE" --max-old-space-size=1024 dist/cli.js "$@"
  local rc=$?
  if [ "$rc" -eq 0 ]; then OK=$((OK+1)); return 0; fi
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
