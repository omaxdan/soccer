#!/bin/bash
# ─── RIP (legacy app) — enrichment (crontab: 0 3 * * *) ──────────────────────
# Best-effort squad sync for teams playing in the next 48h — injuries and
# availability, the core product data. Replaces the bare 'sync:squads:v2'
# entry (no-arg = today only) with the 48h window.
# Season stats moved to rip-stats.sh on a Mon/Wed/Fri cadence (quota spread).
# Budget: ~30-80 calls/day.
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
  echo "RESULT ok=$OK failed=$FAILED"
) 9>"$LOCK"
