# Missing Information Checklist

What I could not determine from the supplied schema plus the two repositories, and therefore did not assume. Ordered by how much it blocks V2 design.

---

## BLOCKING — V2 design cannot responsibly start without these

### 1. The 13 materialized view definitions

The frontend reads 13 objects that appear in **neither the supplied dump nor any migration in either repository**:

`mv_match_scoring_probabilities` · `mv_module_travel` · `mv_module_home_away` · `mv_module_readiness_tracker` · `mv_module_consistency` · `mv_module_giant_killer` · `mv_module_rest` · `mv_module_league_goals` · `mv_module_form_gap` · `mv_module_btts_fatigue` · `mv_module_confidence` · `mv_module_halftime` · `mv_module_clean_sheet`

`mv_match_scoring_probabilities` and `mv_module_travel` are on the **match page and board hot paths** (`queries.ts:155–156`, `:276`, `:347`).

**Please provide:**
- `SELECT matviewname, definition FROM pg_matviews;` (or `\d+` for each)
- How and when each is refreshed — cron? trigger? manual? `REFRESH ... CONCURRENTLY`?
- Whether they have unique indexes (required for concurrent refresh)
- Row counts and last refresh time for each
- Whether the 11 `mv_module_*` views are used for anything beyond the "firing now" counts in the module directory

### 2. A complete, authoritative schema dump

The supplied file is explicitly marked *"for context only and is not meant to be run"* and demonstrably omits several object classes. Concrete evidence:

- **Composite UNIQUE constraints are absent.** Migration 032 adds five; none appear in the dump.
- **Five upserts have no matching constraint in any migration** — `squad_depth` (`match_id,team_id`), `team_versatility` (`match_id,team_id`), `formation_analysis` (`match_id,team_id`), `position_coverage` (`team_id,position_code`), `position_depth_comparison` (`match_id,position_code`). A comment at `processExtendedIntelligence.ts:3655` claims migration 032 added them; it did not. **Either these constraints were created out-of-band in Supabase, or these five processors fail at runtime.** Which is it?
- **`team_form_history`'s CHECK is truncated** in the supplied file: `CHECK (result = ANY (ARRAY['W','D','L'])) NOT VALI)`. Is the live constraint `NOT VALID` (i.e. not enforced against existing rows)?
- **ARRAY columns have no element type** — `strengths ARRAY`, `positions_played ARRAY`, `key_advantages ARRAY`, etc. `text[]`? `integer[]`? `jsonb[]`?

**Please provide:** `pg_dump --schema-only --no-owner --no-privileges` of the `public` schema, or equivalent — including constraints, indexes, views, materialized views, functions, triggers, sequences, and comments.

### 3. Actual index inventory

The migrations create ~50 indexes, overwhelmingly on raw tables. The 31 match-scoped intelligence tables mostly appear to have only a PK plus one unique constraint. Whether production matches this is unknown.

**Please provide:**
```sql
SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename;
SELECT relname, indexrelname, idx_scan, idx_tup_read FROM pg_stat_user_indexes ORDER BY idx_scan;
SELECT relname, seq_scan, seq_tup_read, n_live_tup FROM pg_stat_user_tables ORDER BY seq_tup_read DESC;
```
The `idx_scan = 0` set and the high-`seq_scan` set together tell us which indexes are dead weight and which tables are being scanned in production.

### 4. Row counts and table sizes

Every scaling statement in these documents is a projection from schema shape, not a measurement.

**Please provide:**
```sql
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total,
       pg_size_pretty(pg_indexes_size(relid)) AS indexes
FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
```
Most valuable: `matches`, `player_season_statistics`, `match_predicted_lineups`, `player_match_impact`, `player_matchup`, `player_match_load`, `team_form_history`, `team_squads_snapshot`, `readiness_history`.

I specifically need to know whether **`player_matchup`** is populated at 11 rows/match or 121 — it is the single largest row-count risk in the schema.

### 5. Orphan and integrity validation results

Before any FK can be proposed, we need to know what would fail. **Please run:**

```sql
-- 5a. season_external_id values with no matching season
SELECT 'player_season_statistics' t, count(*) FROM player_season_statistics s
  LEFT JOIN seasons x ON x.external_id = s.season_external_id WHERE x.id IS NULL
UNION ALL SELECT 'team_season_statistics', count(*) FROM team_season_statistics s
  LEFT JOIN seasons x ON x.external_id = s.season_external_id WHERE x.id IS NULL
UNION ALL SELECT 'tournament_standings', count(*) FROM tournament_standings s
  LEFT JOIN seasons x ON x.external_id = s.season_external_id WHERE x.id IS NULL;

-- 5b. league_name values not resolvable to a tournament
SELECT DISTINCT r.league_name FROM readiness_history r
  LEFT JOIN tournaments t ON t.name = r.league_name WHERE t.id IS NULL;
SELECT DISTINCT league_name FROM league_gap_summary g
  LEFT JOIN tournaments t ON t.name = g.league_name WHERE t.id IS NULL;

-- 5c. duplicate snapshots (would block a unique constraint)
SELECT 'team_squads_snapshot' t, count(*) FROM (
  SELECT team_id, snapshot_date FROM team_squads_snapshot GROUP BY 1,2 HAVING count(*)>1) d
UNION ALL SELECT 'team_fixture_load', count(*) FROM (
  SELECT team_id, snapshot_date FROM team_fixture_load GROUP BY 1,2 HAVING count(*)>1) d
UNION ALL SELECT 'team_travel_load', count(*) FROM (
  SELECT team_id, snapshot_date FROM team_travel_load GROUP BY 1,2 HAVING count(*)>1) d
UNION ALL SELECT 'tournament_standings', count(*) FROM (
  SELECT tournament_id, team_id, season_external_id, standings_type
  FROM tournament_standings GROUP BY 1,2,3,4 HAVING count(*)>1) d
UNION ALL SELECT 'player_match_load', count(*) FROM (
  SELECT player_id, match_id FROM player_match_load GROUP BY 1,2 HAVING count(*)>1) d;

-- 5d. do the duplicated columns actually agree?
SELECT count(*) FILTER (WHERE m.competition IS DISTINCT FROM t.name) AS competition_mismatch,
       count(*) AS total
FROM matches m LEFT JOIN tournaments t ON t.id = m.tournament_id;

SELECT count(*) FILTER (WHERE r.status IS DISTINCT FROM m.status) AS status_mismatch, count(*)
FROM match_results r JOIN matches m ON m.id = r.match_id;

SELECT count(*) FILTER (WHERE p.current_injury <> (i.player_id IS NOT NULL)) AS injury_mismatch, count(*)
FROM players p LEFT JOIN player_injuries i ON i.player_id = p.id AND i.active;

SELECT count(*) FILTER (WHERE ti.congestion_score IS DISTINCT FROM fl.congestion_score) AS congestion_mismatch
FROM team_intelligence ti
JOIN LATERAL (SELECT congestion_score FROM team_fixture_load
              WHERE team_id = ti.team_id ORDER BY snapshot_date DESC LIMIT 1) fl ON true;

-- 5e. do the two competing predictions agree?
SELECT count(*) AS both_present,
       count(*) FILTER (WHERE round(mi.win_probability_home::numeric,2)
                          IS DISTINCT FROM round(pc.home_win_probability::numeric,2)) AS disagree,
       avg(abs(mi.win_probability_home - pc.home_win_probability)) AS mean_abs_diff
FROM match_intelligence mi JOIN match_performance_comparison pc USING (match_id)
WHERE mi.win_probability_home IS NOT NULL AND pc.home_win_probability IS NOT NULL;
```

---

## HIGH PRIORITY

### 6. SQL functions, triggers, and RLS in full

Found in migrations: `handle_new_user`, `touch_last_login`, `is_admin`, `is_owner`, `staff_role`, `role_rank`, `can_access_feature`, `subscriptions_enabled`, `global_search`, `prune_watchlist_entity`, `replace_player_match_load`, `guard_profile_self_update`, `guard_match_intelligence_immutability`, `_rip_countries_match`. Triggers: `on_auth_user_created`, `guard_profile_self_update`, `match_intelligence_immutability`, 3 × `prune_watchlist_*`.

**Please confirm:** is that the complete live set, or are there functions/triggers created outside the migrations? Specifically:
- Is there anything guarding tables **other than** `match_intelligence` and `readiness_history` from post-kickoff rewrite?
- What exactly does migration 043's "immutability lock" on `readiness_history` do — a trigger, a revoke, or something else?
- `SELECT * FROM pg_policies WHERE schemaname='public';` — is **any** football/intelligence table besides `match_half_time_intelligence` RLS-protected, and how does the anon key currently read them?

### 7. Which migration set is authoritative?

There are two migration directories with **overlapping numbering**:
- `beta/backend/supabase/migrations/` — 000–025
- `beta/migrations/` — 023–044

Both contain a `023`, `024`, `025`. Which sequence has actually been applied to production, in what order, and is there a migration-tracking table (`supabase_migrations.schema_migrations`)? **Please provide its contents.**

### 8. Cron schedule and job orchestration

`config.cron.enabled` exists and `docs/sync.ps1` suggests a PowerShell driver, but no scheduler definition is in the repository.

**Please provide:**
- What actually runs, on what schedule, in what order (crontab, GitHub Actions, Supabase scheduled function, Windows Task Scheduler, other)
- Whether `process:all-db` runs in full or a date-scoped variant, and how often
- Whether `archive:readiness-snapshot`, `archive:link-results`, `analytics:refresh-league-gap`, `backtest:signals`, `backtest:bands`, and `process:historical-context` run on a schedule or ad hoc
- Where the materialized-view refresh happens
- Current end-to-end runtime and failure rate

### 9. Sample data

For ~10 representative tables, ~20 rows each, so I can see actual value distributions rather than inferring from column names:

`team_intelligence` · `match_intelligence` (a mix of scheduled and finished) · `match_signals` · `readiness_history` (both linked and unlinked) · `signal_backtests` (all rows) · `league_gap_summary` (all rows) · `match_weather` · `team_betting_intelligence` · `match_opportunity` (including the jsonb columns) · `match_risk_intelligence.risk_factors` · `platform_settings` (all rows) · `feature_permissions` (all rows) · `subscription_plans` (all rows).

I especially need to see: the **jsonb shapes** (`predicted_scorelines`, `risk_factors`, `signals`, `warnings`, `score_components`, `experience_distribution`, `age_profile`, `adaptability_score`), the **ARRAY element types**, and the actual **`market` / `rule_key` / `advantage_type` / `position_code` vocabularies**.

### 10. Product decision — which prediction is authoritative?

`match_intelligence` and `match_performance_comparison` each produce a complete, independent W/D/L probability set, confidence figure, and predicted score, from different processors. Both reach the match page. Nothing in schema or code declares a winner.

**Which is the product's answer?** V2 either consolidates to one or makes the model identity a first-class dimension — that choice is yours, not mine.

### 11. Product decision — synthetic weather

`match_weather` is filled by `processMatchWeather` using seeded-PRNG climate-zone estimation (its own log says `(synthetic)`), and Module 13 "Weather Impact" ships on it at the `pro` tier.

- Is a real weather integration planned?
- Until then, should V2 mark these rows as estimated and surface that in the UI, or should Module 13 be gated off?

### 12. Product decision — the four unbuilt-on tables

`customers`, `notifications`, `notification_preferences`, `match_intelligence_watch` are fully built and referenced by no code. Per Phase 1 rules I have not assumed they are unnecessary.

- Is Stripe billing still planned (`customers`, `user_subscriptions.stripe_*`)?
- Is the notification product still planned? `notification_preferences` names three topics — `friday_briefing`, `consensus_changes`, `module_changes` — the last of which implies module-level change detection that no table currently supports.
- What was `match_intelligence_watch` for? It is the only place `module_consensus` and `evidence_count` appear in the entire schema.

---

## MEDIUM PRIORITY

### 13. External API contracts

- SportsAPI Pro and SofaScore response schemas (or the sample payloads under `backend/docs/api-samples/`, refreshed).
- Actual quota limits and current consumption. `config.sportsapi.key2` doubles it "100 → 200" — 200 what, per what period?
- Does SofaScore's endpoint set have terms that constrain retention or redistribution? This affects whether raw payload archival is an option in V2.
- Confirmation of whether **referee** and **pitch surface** are available (both are recorded as blocked UI gaps in `docs/SCHEMA_GAP_ANALYSIS.md`).
- Is a live/in-play feed in scope for V2? It would change the temporal model substantially.

### 14. Frontend usage evidence

- Which pages and modules actually get traffic? A table read by no one and a table read on every page load warrant very different migration care.
- Query latency distribution — `getMatch()` fires ~30 parallel queries; what is the observed p50/p95?
- Is there caching anywhere (Next.js `revalidate`, CDN, Supabase connection pooling settings)?
- What is `NEXT_PUBLIC_DEFAULT_TIER` set to in production? `tier.ts:currentTier()` reads it and defaults to `"pro"`, which combined with `subscriptions_enabled=false` may mean everything is currently open.

### 15. Backend services beyond the two repositories

- Is anything other than `beta/backend` writing to this database? Supabase Edge Functions, a separate admin service, manual SQL, another repository?
- The repository root contains `backend/`, `frontend/`, `pitch-frontend/`, `scripts/` **outside** `beta/`. Are any of these live against the same database, or are they superseded?
- Are there Supabase Database Webhooks or scheduled Edge Functions?

### 16. Data retention, backup, and environment

- Postgres version and Supabase plan tier (determines partitioning options, `pg_cron` availability, connection limits).
- Backup/PITR configuration and retention window.
- Is there a staging database with production-like volume? Any V2 migration of this size needs a rehearsal environment.
- Current database size and growth rate over the last 90 days.

### 17. Formula and model documentation

- The readiness weight set and its history. `processDbOnly.ts` mentions a "7-component weighted formula from the Team Readiness spec" — **is that spec document available?**
- What `readiness_formula_version = 'v1'` means concretely, and whether any `v2` exists or is planned.
- The provenance of the `"unreplayed"` baselines in `modules.ts` — the code documents an original 1,893-match analysis that "scored finished matches using CURRENT team form and therefore contains lookahead". Which module baselines are still on that cohort?
- Derivation for columns with no visible input in the schema: `team_motivation.external_motivation`, `match_impact_summary.rivalry_score`, `team_betting_intelligence.cards_market_score` (no cards data is ingested anywhere).

### 18. Business rules I should not infer

- Should team intelligence be **per competition** (a team's readiness in the league vs in a cup) or global? The current schema says global; several derived tables carry `season_external_id`, implying otherwise.
- What is the intended historical depth — 10 years of *matches*, or 10 years of *intelligence*? These have very different storage implications (the first is ~760k rows; the second is ~50–100M).
- Which of the 13 modules are considered permanent, and are any planned for retirement? This determines how much of the 31-table match-scoped estate needs carrying forward.
- Is multi-currency market value needed? `players.market_value` is a bare bigint with no currency, while `team_strength_ratings.market_value_eur` names one.

---

## What I did NOT assume

For the record, so you can correct me if any of these should have been assumed:

- That any unreferenced table is unnecessary.
- That absent indexes/constraints in the dump mean they are absent in production.
- That the migrations in the repository have all been applied, or applied in numeric order.
- That the `mv_*` views exist in the shape their names imply.
- That `match_weather`'s synthetic nature is known to the product owner.
- That either competing prediction is the "real" one.
- That the current league coverage (~61 tracked) is the target (the brief says 100+).
- That the pipeline currently completes successfully — no run telemetry exists to confirm it.
