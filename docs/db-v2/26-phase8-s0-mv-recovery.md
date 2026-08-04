# PitchTerminal V2 — Phase 8 S-0: `mv_*` Recovery — Cannot Be Performed From This Repository

**0 of 13 view definitions recovered. Recovery stopped at the search stage.**

The task instructs: *"If any definition cannot be recovered exactly, stop and report precisely what is missing and why it cannot be reconstructed."* Not one of the thirteen definitions exists anywhere I can reach. The authoritative copy is in the production Supabase database, and this session has no host, no credential and no dump of it.

Nothing was rewritten, modernised, replaced with TypeScript, or inferred. No SQL was authored. No file under `src/v2/module/` exists.

---

## 1. What was searched, and what each search returned

Five independent searches, each exhaustive within its own scope.

| # | Scope | Method | Result |
|---|---|---|---|
| 1 | Working tree, every file type | `grep -rl` for each of the thirteen names, `node_modules` and `.git` excluded | 7 files. **All are TypeScript or documentation; none is a definition.** |
| 2 | **Every git object ever written** — all branches, all history, unreachable objects included | Enumerated 832 blobs via `git cat-file --batch-all-objects`, read each, matched `(create\|refresh\|drop)…mv_(module\|match_scoring)` | 60 blobs mention a name; **4 contain a `CREATE`, and all four are V2's `product.mv_module_directory`** — a different object in a different schema. **Zero blobs in the entire object database have ever contained a definition of any of the thirteen.** |
| 3 | The three schema snapshots in the repository | `grep -ic 'materialized view'` on `Schema.sql`, `beta/backend/DB Schema.sql`, `beta/backend/docs/schema_reference.sql`, `000_Full DB Schema sql file.sql` | **0 in every one.** These exports carry tables only; they omit views, matviews, functions and triggers as an object class. Each is headed *"for context only and is not meant to be run."* |
| 4 | Every `.sql` file — 60 files across `beta/migrations/` (023–044), `beta/backend/supabase/migrations/` (001–025), `backend/supabase/migrations/`, `scripts/`, `warehouse/` | Covered by search 2, which reads their blobs and every prior revision of them | **No migration in either repository has ever created any of the thirteen.** |
| 5 | Production access | `env` for `PT_V2_*`/`SUPABASE_*`/`PG*`; every `.env*` file; `supabase/config.toml`; `~/.supabase`; a repository-wide scan for a `<ref>.supabase.co` host | **No host, no project reference, no credential, no linked CLI project.** The `.env` files present are `.example` templates with empty values — correctly so. The only reachable database is the local `ptv2`, which is the V2 migration rebuild and contains no V1 object. |

The negative is therefore not "I did not find it in the obvious places". It is: **the definitions have never been in this repository, in any commit, on any branch.**

---

## 2. Why it cannot be reconstructed

Three distinct reasons, each sufficient on its own.

**The definition is the only place the rule exists.** A materialised view's `WHERE`, its join grain, its window frames, its `COALESCE` choices and its null handling are not implied by its output columns. Two views can present identical columns and disagree on which fixtures qualify. Reconstructing from anything less than `pg_matviews.definition` produces a *different object wearing the same name* — which is precisely what this programme has refused to do at S-5 (document 22) and S-6 (document 25).

**The consumers cannot supply it.** For eleven of the thirteen, the application never reads a single column (§4). There is no consumption evidence to work backwards from because there is no consumption.

**The one prior attempt to obtain them was never answered.** Phase 1 recorded this as missing-information item 1 ([document 05](./05-missing-information-checklist.md) §1) and asked for `SELECT matviewname, definition FROM pg_matviews;` along with refresh strategy, unique indexes, row counts and last-refresh time. Phase 7 re-raised it as **AC-05**. Phase 8 [document 15](./15-phase8-application-migration-specification.md) registered it as open risk B-1, owner Platform, and made it step one of §6.4. It is still open. Document 05 §"assumptions I did not make" also lists, explicitly: *"That the `mv_*` views exist in the shape their names imply."* That caution stands unresolved and it now bites.

---

## 3. Per-view status

The seven required deliverables, for every view. The answer is the same in every row of the first five columns, and it is the honest one.

| View | 1. SQL definition | 2. Source tables | 3. Computed columns | 4. Dependencies | 5. V1 assumptions |
|---|---|---|---|---|---|
| `mv_module_home_away` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_readiness_tracker` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_consistency` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_giant_killer` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_rest` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_league_goals` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_form_gap` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_confidence` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_clean_sheet` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_halftime` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| `mv_module_btts_fatigue` | **unrecoverable** | **unknown** | **unknown** | **unknown** | not read by any evaluator |
| **`mv_module_travel`** | **unrecoverable** | **unknown** | **unknown** | **unknown** | **read** — 14 columns, §5 |
| **`mv_match_scoring_probabilities`** | **unrecoverable** | **unknown** | **unknown** | **unknown** | **read** — 18 columns, §5 |

**6. Missing dependencies or objects** — cannot be determined. Identifying a view's missing dependencies requires its definition; the dependency direction runs from the definition outward, and there is no definition to start from.

**7. Ambiguities and inconsistencies** — four are recorded in §4 and §6. All were found in the *consumers*, which are readable; none is an ambiguity within a definition, because no definition is available to be ambiguous.

---

## 4. What the search did establish — three findings

These are observations about the V1 application, verified by counting. They do not recover anything, and they change how much recovery is worth.

### S0-1 — Eleven of the thirteen views are never queried

Reference counts across all `*.ts`, `*.tsx`, `*.js` and `*.sql` in both frontends and both backends:

```
mv_module_home_away          code_refs=1   query_sites=0
mv_module_readiness_tracker  code_refs=1   query_sites=0
mv_module_consistency        code_refs=1   query_sites=0
mv_module_giant_killer       code_refs=1   query_sites=0
mv_module_rest               code_refs=1   query_sites=0
mv_module_league_goals       code_refs=1   query_sites=0
mv_module_form_gap           code_refs=1   query_sites=0
mv_module_confidence         code_refs=1   query_sites=0
mv_module_clean_sheet        code_refs=1   query_sites=0
mv_module_halftime           code_refs=1   query_sites=0
mv_module_btts_fatigue       code_refs=1   query_sites=0
mv_module_travel             code_refs=5   query_sites=2
mv_match_scoring_probabilities  code_refs=8   query_sites=3
```

For eleven views the single reference is the `source:` string literal in the module registry — a **display label**, shown in the module directory and counted for the "firing now" figure. Nothing selects from them.

### S0-2 — The registry says so itself, and warns that the two disagree

`beta/live-frontend/src/lib/modules.ts`, on the `source` field:

> **NOTE: the in-page evaluators in this file do NOT read these views** — they read the base tables directly (`match_intelligence`, `team_form_quality`, `team_venue_performance`, `mv_match_scoring_probabilities`). So a view's row count and the number of fixtures the evaluators actually light up for can differ, because **the view's `WHERE` clause and the evaluator's null-checks are not the same rule.** See `MODULE_COUNT_CAVEAT` in the directory page.

So V1 already carries two definitions of "this module fires" — the view's and the evaluator's — and already knows they disagree. **Whichever S-6 ports, it is choosing between them.** That is a governance decision, not an implementation detail, and it belongs in the S-6 decision record.

### S0-3 — It is not established that these are materialised views

Every statement that they are rests on the `mv_` prefix. Nothing in the repository confirms whether each is a materialised view, a plain view, or a table; nor how it is refreshed, nor whether it carries the unique index `REFRESH … CONCURRENTLY` requires. Document 05 flagged this as an assumption not made. It still is not established.

---

## 5. Observable output contracts — the two views that are read

**Consumption evidence, not definitions.** These are the columns V1 selects and the value domains its own types declare. They constrain a recovered definition; they do not constitute one, and they say nothing about source tables, joins, filters or derivations.

**`mv_module_travel`** — `beta/live-frontend/src/lib/types.ts:117`, commented *"Columns confirmed against production"*. Read at `queries.ts:156` (board, `.in("match_id", ids)`) and `:276` (match page, `.eq("match_id", id).maybeSingle()`); consumed by `evalTravel` via `ctx.travel`.

`match_id` · `away_trip_km` · `trip_band` ∈ {MINIMAL, SHORT, MODERATE, LONG} · `away_km_7d` · `home_km_7d` · `away_km_14d` · `home_km_14d` · `away_trips_7d` · `home_trips_7d` · `away_fatigue_score` (0–100, higher worse) · `home_fatigue_score` · `travel_gap_7d` (away cumulative − home cumulative, 7d) · `travel_profile` ∈ {HOME_FRESH_ADVANTAGE, AWAY_FRESH_ADVANTAGE, BOTH_TRAVEL_HEAVY, AWAY_TRAVEL_FATIGUE, HOME_TRAVEL_FATIGUE, NO_TRAVEL_EDGE}. Every column but `match_id` is nullable, and the row type carries an open index signature — so the true column list may be **wider than this**.

**`mv_match_scoring_probabilities`** — `types.ts:738`. Read at `queries.ts:155`, `:347` (live-frontend) and `:214` (pitch-frontend); consumed by `evalBttsFatigue`, `evalCleanSheet` and `evalLeagueGoals` via `ctx.scoring`.

`match_id` · `home_team` · `away_team` · `home_scores_pct` · `home_sample` · `away_concedes_pct` · `away_concede_sample` · `home_to_score_pct` · `away_scores_pct` · `away_sample` · `home_concedes_pct` · `home_concede_sample` · `away_to_score_pct` · `btts_pct` · `historical_btts_pct` · `league_btts_pct` · `btts_verdict` · `components_available`.

Percentages arrive as **strings**, not numbers — numeric columns serialised over PostgREST — and are parsed on read. The `_sample` columns and `components_available` are the view's own evidence counts; what `components_available` counts is not stated anywhere readable.

---

## 6. Dependency graph

**The view → base-table graph cannot be drawn.** It is derived from the definitions.

What *can* be drawn is the observed application graph — which module reads what today. This is the graph S-6 would actually have to reproduce, and eleven views are not in it.

```
mv_match_scoring_probabilities ─┬─→ evalBttsFatigue     (btts_pct)
                                ├─→ evalCleanSheet      (home/away_concedes_pct + samples)
                                └─→ evalLeagueGoals

mv_module_travel ──────────────────→ evalTravel         (away_trip_km, travel_profile)
                                       ↑ falls back to match_intelligence.away_travel_distance_km

match_intelligence ─────────────┬─→ evalFormGap         (home/away form_index)
                                ├─→ evalConfidence      (confidence_band, confidence_score, readiness_gap)
                                ├─→ evalRest            (home/away_rest_days)
                                ├─→ evalBttsFatigue     (home/away_rest_days)
                                └─→ evalLeagueGoals     (predicted_home/away_goals)
signal_backtests ──────────────────→ evalConfidence     (measured band rates)
match_half_time_intelligence ──────→ evalHalftime
match_weather ─────────────────────→ evalWeather
team_venue_performance ────────────→ evalHomeAway
team_momentum ─────────────────────→ evalReadinessTracker
team_form_quality ─────────────────┬→ evalConsistency
                                   └→ evalGiantKiller
team_intelligence ─────────────────→ evalReadinessMatch (last_5_points, last_10_points)

NOT IN THE GRAPH — label only, zero reads:
  mv_module_home_away · mv_module_readiness_tracker · mv_module_consistency
  mv_module_giant_killer · mv_module_rest · mv_module_league_goals
  mv_module_form_gap · mv_module_confidence · mv_module_clean_sheet
  mv_module_halftime · mv_module_btts_fatigue
```

---

## 7. Unresolved gaps

| # | Gap | Blocks |
|---|---|---|
| G-1 | Thirteen definitions — `pg_matviews.definition` or `\d+` | Everything below |
| G-2 | Object class of each: matview, view or table | Refresh design, S-9 |
| G-3 | Refresh mechanism and cadence — cron, trigger, manual, `CONCURRENTLY` | Refresh path, staleness semantics |
| G-4 | Unique index presence per object | Whether concurrent refresh is even available |
| G-5 | Row counts and last refresh time | Whether any is live, and whether any is already abandoned |
| G-6 | Which rule is authoritative where a view and its evaluator disagree (S0-2) | The S-6 decision record |
| G-7 | What `components_available` counts | Sampling semantics for scoring-derived modules |
| G-8 | Whether `mv_module_travel`'s true column list exceeds the 14 observed | Faithful port of `evalTravel` |

**What is needed, exactly.** Run against production and commit the output to `beta/migrations/`:

```sql
SELECT schemaname, matviewname, definition FROM pg_matviews  ORDER BY matviewname;
SELECT schemaname, viewname,    definition FROM pg_views
 WHERE viewname LIKE 'mv\_%'                                 ORDER BY viewname;
SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
 WHERE tablename LIKE 'mv\_%'                                ORDER BY tablename, indexname;
SELECT c.relname, c.relkind, c.relispopulated, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relname LIKE 'mv\_%' AND n.nspname = 'public'       ORDER BY c.relname;
```

`relkind` answers G-2 (`m` matview, `v` view, `r` table) and `relispopulated` shows whether a matview has ever been refreshed. The refresh mechanism (G-3) is not in the catalogue: it must come from whoever operates the pipeline — `pg_cron`, an external scheduler, or a manual step.

---

## 8. Can S-6 now be specified?

**No.** S-0 delivered nothing, so nothing S-0 was blocking has moved.

Against the five blockers in [document 25](./25-phase8-s6-not-specified.md):

| Blocker | Effect of this exercise |
|---|---|
| **B-1** — no S-6 architecture, specification or decision record | **Unchanged.** Those are authoring tasks; no amount of view recovery writes them. |
| **B-2** — S-0 unfinished | **Unchanged, and now bounded.** The definitions are not in the repository and cannot be reconstructed from it. This is a production-access task, not an engineering one, and it is the same request Phase 1 made and never received. |
| **B-3** — `module_version` 1.0.0 asserts "the V1 logic unchanged" | **Sharper, and worse.** S0-2 shows V1 holds *two* rules per module — the view's and the evaluator's — which already disagree by the registry's own admission. "Unchanged" does not name one of them. |
| **B-4** — subject-kind mismatch between modules and S-5 features | **Unchanged.** Independent of the views. |
| **B-5** — nothing declares module inputs | **Unchanged.** §6's graph is what the code *does*, observed; it is not a declaration, and S-6 must not treat it as one. |

**One thing did improve.** S0-1 bounds the recovery: eleven of the thirteen carry no consumed behaviour at all, so if the schema owner rules that the *evaluator* is authoritative (G-6), then only **two** definitions sit on the critical path — `mv_module_travel` and `mv_match_scoring_probabilities` — and the other eleven become a documentation and decommissioning question rather than a porting one. **That ruling has not been made, and I am not making it.**

---

## 9. What I did not do

- **Did not reconstruct, approximate or draft any SQL.** Not for the two views whose output columns are known either — a column list is not a definition, and a plausible query carrying a real view's name is the most dangerous artefact this exercise could produce.
- **Did not infer source tables** from column names. `away_km_14d` does not tell me which relation it was summed from, over what fixture set, or under what status filter.
- **Did not treat the evaluators as the views.** They are a *different* rule by V1's own documentation (S0-2).
- **Did not modernise, rewrite, or move anything to TypeScript.**
- **Did not begin S-6**, and did not create `src/v2/module/`.
- **Did not modify V1, V2, any migration or any test.** This exercise is read-only; the only change is this document.
