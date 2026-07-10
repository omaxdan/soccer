#!/bin/bash
# ─── RIP DAILY PIPELINE v2 ────────────────────────────────────────────────────
# Replaces rip-daily.sh. Changes from v1 (audit Phase 4):
#
#   1. Criticality tiers. v1's `set -e` made every step load-bearing: one
#      transient 500 in squad sync aborted process:all-db:today — which needs
#      ZERO API calls — and the site served stale intelligence all day.
#      Now: CRITICAL steps abort the run; BEST-EFFORT steps log and continue.
#
#   2. Dead-man's-switch alerting. v1's only failure observer was this log
#      file. Now: on full success we ping $HEALTHCHECK_URL (healthchecks.io
#      or any cron monitor — free tier is fine). If the ping stops arriving,
#      YOU get emailed. No ping URL configured = behaves like v1.
#
#   3. End-of-run summary line — one greppable line per day:
#      RESULT ok=8 failed=0 critical_failed=0
#
# Point the beta backend's dist path here at cutover; the old backend's cron
# entry is removed the same day (single-writer rule).

set -uo pipefail   # deliberately NOT -e; failure handling is per-step

LOCK="/home/mybrzklx/.locks/rip-daily.lock"
LOG="/home/mybrzklx/logs/rip-daily.log"
APP="/home/mybrzklx/apps/rip-beta"                      # ← beta backend
NODE="/home/mybrzklx/nodevenv/apps/rip-beta/24/bin/node"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"   # e.g. https://hc-ping.com/<uuid>

exec >> "$LOG" 2>&1

OK=0; FAILED=0; CRITICAL_FAILED=0

run() {  # run <critical|best-effort> <cli-command...>
  local tier="$1"; shift
  echo "[$(date -Is)] $*"
  if "$NODE" dist/cli.js "$@"; then
    OK=$((OK+1))
  else
    local rc=$?
    echo "[$(date -Is)] STEP FAILED (rc=$rc, tier=$tier): $*"
    FAILED=$((FAILED+1))
    if [ "$tier" = "critical" ]; then
      CRITICAL_FAILED=$((CRITICAL_FAILED+1))
      return 1
    fi
  fi
  return 0
}

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: another daily run is still active"; exit 0; }

  echo ""
  echo "=== $(date -Is) DAILY SYNC v2 START ==="
  cd "$APP"

  # ── TIER 1: fixtures are load-bearing — abort if they fail ────────────────
  run critical sync:today    || exit 1
  run critical sync:tomorrow || exit 1

  # ── TIER 2: enrichment — degrade gracefully, never block intelligence ─────
  run best-effort sync:squads:v2 2
  run best-effort sync:player-stats 2
  run best-effort sync:team-stats 2

  # ── TIER 3: DB-only intelligence — zero API calls, always runs ────────────
  run critical process:all-db:today || exit 1
  run best-effort archive:readiness-snapshot
  run best-effort archive:link-results
  run best-effort analytics:refresh-league-gap

  echo "=== $(date -Is) DAILY SYNC v2 DONE ==="
  echo "RESULT ok=$OK failed=$FAILED critical_failed=$CRITICAL_FAILED"

  # Dead-man's switch: ping only on a run with no critical failures.
  # (Best-effort failures still ping — check the RESULT line for those —
  #  so the alert fires only when the product-facing pipeline is broken.)
  if [ "$CRITICAL_FAILED" -eq 0 ] && [ -n "$HEALTHCHECK_URL" ]; then
    curl -fsS -m 10 --retry 3 "$HEALTHCHECK_URL" > /dev/null || true
  fi

) 9>"$LOCK"
