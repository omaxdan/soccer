#!/bin/bash
# ─── check-raw-reads.sh — CI guard for the beta read-integrity rule ──────────
# Rule (PATCH-SPEC-processors.md): every multi-row .select() read goes
# through fetchAllRows. PostgREST silently caps raw reads at 1000 rows —
# the audit found 61 raw reads in the old backend, 4 confirmed corrupting
# stored intelligence.
#
# Allowed raw patterns: .single() / .maybeSingle() (one row), explicit
# .limit(n) (bounded by design), and writes (insert/upsert/update/delete/rpc).
#
# BASELINE: the old backend's remaining raw reads are grandfathered at the
# count below and burn down as processors are ported. Any INCREASE fails CI.

set -uo pipefail
cd "$(dirname "$0")/.."

BASELINE=94   # measured 2026-07-10 across all of src/ — decrease only

# A "raw read": `await db` (same or next line `.from(`) ... reaching .select(
# without fetchAllRows / single / maybeSingle / limit in the statement.
count=$(node -e "
const fs = require('fs');
const glob = require('path');
let total = 0;
function scan(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + f.name;
    if (f.isDirectory()) { scan(p); continue; }
    if (!p.endsWith('.ts')) continue;
    const src = fs.readFileSync(p, 'utf8');
    // Split into await-statements; crude but effective for this codebase's style
    const stmts = src.split(/await\s/).slice(1);
    for (const s of stmts) {
      const head = s.slice(0, 400);
      if (!/^db[\s\S]{0,80}?\.from\(/.test(head)) continue;
      if (!head.includes('.select(')) continue;               // writes are fine
      if (/\.single\(|\.maybeSingle\(|\.limit\(/.test(head)) continue;
      total++;
    }
  }
}
scan('src');
console.log(total);
")

echo "raw multi-row reads: $count (baseline: $BASELINE)"
if [ "$count" -gt "$BASELINE" ]; then
  echo "FAIL: new raw multi-row read introduced — use fetchAllRows (see PATCH-SPEC-processors.md)"
  exit 1
fi
if [ "$count" -lt "$BASELINE" ]; then
  echo "NOTE: baseline can be lowered to $count in scripts/check-raw-reads.sh"
fi
echo "OK"
