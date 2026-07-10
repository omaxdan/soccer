# Beta Implementation Batch 1 — Audit Phases 2–4 Fixes

Cutover model (agreed): single writer. Beta backend becomes the sole
pipeline the day its cron entry replaces the old one; old backend stays
in-repo, idle, as rollback. Shared Supabase warehouse throughout.

## Contents

| File | What it is | Applies to |
|---|---|---|
| `migrations/023_catchup_and_integrity.sql` | Captures live-only constraints into the migration chain; player_injuries uniqueness; CHECK constraints (NOT VALID); matches→tournaments/seasons FKs + backfill; `team_intelligence.last_5_results`; index reshaping | Shared warehouse — run now, safe for old backend |
| `migrations/024_player_match_load_atomic.sql` | Single-transaction replace RPC, service_role-only | Shared warehouse — run now; old backend keeps using its two-call path harmlessly until retired |
| `backend/src/db/fetchAllRows.ts` | Pagination helper v2 — always ordered | Beta backend |
| `backend/PATCH-SPEC-processors.md` | **P0 finding**: 61 raw reads bypass pagination; 4 confirmed corrupting stored intelligence (form, active_competitions, congestion windows, Poisson inputs). Systemic rule + exact patches | Beta backend |
| `frontend/src/lib/queries/teams.ts` | `getTeamIntelligenceList` v2 — truncation-proof, 5 queries → 3 bounded | Beta frontend |
| `scripts/rip-daily-v2.sh` | Criticality tiers + dead-man's-switch alerting | Beta cron |

## Order of operations

1. **Now:** run 023 then 024 in Supabase SQL editor (or via supabase CLI).
   Both are additive/idempotent; the live site is unaffected.
2. Check the four VALIDATE queries at the bottom of 023; run the VALIDATE
   statements if counts are 0.
3. Adopt `supabase db dump` as the canonical schema command; delete root
   `Schema.sql` and `backend/docs/schema_reference.sql` in the beta tree.
4. **Beta backend build-out:** port processors under the PATCH-SPEC read
   rule (every multi-row select via `fetchAllRows`). The four confirmed-
   corrupt reads (lines 253, 1123, 1165, 3761 in the old file) are the
   priority ports.
5. First beta processor run, then verification (below).
6. Cutover day: swap cron to `rip-daily-v2.sh` pointing at the beta dist;
   delete the old cron entry the same moment. Never both.

## Verification after first beta run

```sql
-- last_5_results populated wherever form exists
SELECT count(*) FROM team_intelligence
WHERE last_5_points IS NOT NULL AND last_5_results IS NULL;   -- expect 0

-- truncation recovery: previously-nulled teams now have form
SELECT count(*) FROM team_intelligence WHERE form_index IS NULL;
-- compare against the same count taken before the beta run — should drop

-- FK backfill coverage (tracked leagues should be ~100%)
SELECT count(*) FILTER (WHERE tournament_id IS NULL) AS unlinked,
       count(*) AS total
FROM matches;
```

Expect measurable score changes after the first beta run — form_index,
active_competitions, congestion, and scoreline predictions were computed
from truncated inputs, so **differences from the old backend's numbers are
the fix working**, not a regression. Archive one day of old-backend scores
first if you want a before/after comparison table.

## Open items feeding later phases

- Probability CHECK is [0,100]; tighten to [0,1] once scale confirmed.
- ESLint/CI rule from PATCH-SPEC to make raw reads unmergeable.
- Quota accounting into `platform_daily_summary` (Phase 4 medium).
- Auth/entitlements schema — the Phase 1 critical — is Batch 2; nothing
  here blocks it.
