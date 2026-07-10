#!/bin/bash
# ─── RIP BETA — enrichment (crontab: 0 3 * * *) ──────────────────────────────
# Best-effort API enrichment for teams playing in the next 48h. Any step can
# fail without blocking the others or the 04:00 intelligence run.
#
#   sync:squads:v2 2      ~1 call/team playing in 48h  (~30-80 typical)
#   sync:player-stats 2   ~1 call/team in 48h          (~30-80) — RESTORED:
#                         absent from live cron; season stats (and therefore
#                         predicted lineups + player importance) were going
#                         stale.
#   sync:team-stats 2     ~1 call/team in 48h          (~30-80) — RESTORED.
#
# Budget worst case: ~240 calls on a maximal weekend — ABOVE the 200 cap, so
# order matters: squads first (feeds injuries/availability, the core product),
# stats after. If quota exhausts mid-run, the dual-key client 429s cleanly,
# the step fails as best-effort, and stats catch up the next quiet day.
# Typical weekday total: 60-120 calls, comfortable headroom.
set -uo pipefail

APP="/home/mybrzklx/apps/rip-beta"
NODE="/opt/alt/alt-nodejs24/root/usr/bin/node"
LOG="/home/mybrzklx/logs/rip-squads.log"
LOCK="/home/mybrzklx/.locks/rip-squads.lock"

exec >> "$LOG" 2>&1
OK=0; FAILED=0

run() {
  echo "[$(date -Is)] $*"
  if "$NODE" --max-old-space-size=768 dist/cli.js "$@"; then OK=$((OK+1));
  else local rc=$?; echo "[$(date -Is)] STEP FAILED (rc=$rc): $*"; FAILED=$((FAILED+1)); fi
}

(
  flock -n 9 || { echo "[$(date -Is)] SKIP: previous enrichment run still active"; exit 0; }
  echo "=== $(date -Is) ENRICHMENT START ==="
  cd "$APP"
  run sync:squads:v2 2
  run sync:player-stats 2
  run sync:team-stats 2
  echo "RESULT ok=$OK failed=$FAILED"
) 9>"$LOCK"
