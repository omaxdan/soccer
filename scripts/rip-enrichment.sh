#!/bin/bash
# ─── RIP (legacy app) — enrichment (crontab: 0 3 * * *) ──────────────────────
# Best-effort API enrichment for teams playing in the next 48h. Replaces the
# bare 'sync:squads:v2' entry (no-arg = today only) with the 48h window, and
# RESTORES the stats syncs (absent from live cron — season stats, and with
# them predicted lineups + player importance, were going stale).
#
# Budget: squads ~30-80 + player-stats ~30-80 + team-stats ~30-80.
# Typical weekday 60-120 calls; maximal weekend can brush the 200 cap —
# squads run FIRST so the core availability product wins if quota exhausts;
# stats steps fail best-effort and catch up the next quiet day.
#
# NOTE (legacy known-issue): this app's stats sync has a capped team read
# (fixed in beta) — it may skip some teams beyond the first 1000. Restoring
# it is still strictly better than not running it at all.
set -uo pipefail

APP="/home/mybrzklx/apps/rip"
NODE="/opt/alt/alt-nodejs24/root/usr/bin/node"
LOG="/home/mybrzklx/logs/rip-squads.log"
LOCK="/home/mybrzklx/.locks/rip-squads.lock"

exec >> "$LOG" 2>&1
OK=0; FAILED=0

run() {
  echo "[$(date -Is)] $*"
  if "$NODE" --max-old-space-size=768 dist/cli.js "$@"; then OK=$((OK+1));
  else echo "[$(date -Is)] STEP FAILED (rc=$?): $*"; FAILED=$((FAILED+1)); fi
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
