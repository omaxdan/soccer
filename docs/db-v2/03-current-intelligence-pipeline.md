# PitchTerminal — Current Intelligence Pipeline

Covers Phase 1 objectives 4 (Intelligence Engine Audit), 5 (Module Architecture Audit), and 6 (Match Page Data Flow).

---

## 1. The pipeline end to end

```
┌─────────────────────────────────────────────────────────────────────────┐
│ EXTERNAL SOURCES                                                        │
│                                                                         │
│  SportsAPI Pro                          SofaScore public API            │
│  fixtures · results · tournaments       squads · players · injuries     │
│  seasons · teams · venues               season stats · standings        │
│  (quota-limited, 2 keys = 200/day)      transfers · images              │
└───────────────┬─────────────────────────────────┬───────────────────────┘
                │                                 │
                ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ INGESTION — beta/backend  `sync:*`   (the ONLY writer of raw tables)     │
│                                                                         │
│  syncDiscovery        → seasons                                         │
│  syncDateMasterFeed   → countries, tournaments, seasons, teams,         │
│                         stadiums, matches, match_results                │
│  syncSquadSofaScore   → players, player_transfers, player_injuries,     │
│                         team_squads_snapshot, team_position_depth       │
│  syncSeasonStatistics → player_season_statistics, team_season_statistics│
│  syncStandings        → tournament_standings                            │
│  syncTransfersV2      → player_transfers                                │
│  syncTeamImages       → teams.crest_storage_path, tournaments.logo_*    │
│                                                                         │
│  Coverage gate: config/trackedLeagues.ts — ~61 leagues, HARDCODED,      │
│  matched by name fragment (feed) and slug string (squads).              │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ RAW WAREHOUSE — Supabase Postgres, 16 tables                            │
│ Single-writer discipline holds: no process:* job writes here.           │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CALCULATION — `process:all-db`   ZERO API CALLS · IDEMPOTENT            │
│ Dependency order enforced by cli.ts:663–892, NOT by the schema.         │
│                                                                         │
│  L1   form history · player match load · momentum · fixture load ·      │
│       team locations                                                    │
│  L2   travel load · match travel · strength ratings · fixture           │
│       difficulty · venue performance                                    │
│  L3   TEAM INTELLIGENCE (readiness) · player intelligence               │
│  L3.5 league intelligence                                               │
│  L4   MATCH INTELLIGENCE (readiness gap, context)                       │
│  L4.5 match signals                                                     │
│  L5   predicted lineups           L5.5 scoreline predictions (Poisson)  │
│  L5.6 net battle index            L5.7 starting XI strength             │
│  L5.8 extended suite (14 processors)                                    │
│  L5.9 match page suite (6 processors)                                   │
│  L5.10 previously-empty tables (13 processors)                          │
│  L6   dashboard summary                                                 │
│                                                                         │
│  ~54 processors · 30–120s at current scale · full rebuild every run     │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ STORED INTELLIGENCE — 58 tables                                         │
│  17 team singletons (overwritten) · 6 snapshots · 31 match-scoped       │
│  + 13 materialized views (mv_module_*) — DEFINITION UNKNOWN             │
└──────────┬──────────────────────────────────┬───────────────────────────┘
           │                                  │
           ▼                                  ▼
┌────────────────────────────┐   ┌────────────────────────────────────────┐
│ CALIBRATION (offline)      │   │ FRONTEND — Next.js 15, READ-ONLY       │
│                            │   │                                        │
│ archiveReadinessHistory    │   │ lib/queries.ts (1,490 lines) is the    │
│   → readiness_history      │   │ single query layer                     │
│ archive:link-results       │   │            ↓                           │
│   → final scores, correct  │   │ lib/modules.ts (1,587 lines) evaluates │
│ analytics:refresh-league   │   │ 13 modules AT RENDER TIME from base    │
│   → league_gap_*           │   │ tables — module outputs are NOT stored │
│ backtestSignals /          │   │            ↓                           │
│ backtestConfidenceBands    │   │ lib/access.ts gates by feature_        │
│   → signal_backtests       │   │ permissions (or opens everything when  │
│ processHistoricalContext   │   │ subscriptions_enabled = false)         │
│   → team_match_snapshots,  │   │            ↓                           │
│     match_opponent_context │   │ Server components render               │
└────────────────────────────┘   └────────────────────────────────────────┘
```

**Architectural claim vs reality.** The stated principle — "zero runtime calculations, everything precomputed" — holds for the football maths. It does **not** hold for modules: the 13 module readings that are the product's headline abstraction are computed in `modules.ts` on every page render from base tables. `AUDIT_2026-07-03.md` acknowledges the matches page still calls `computeMatchSignals` per row as a fallback layer.

---

## 2. Intelligence engine audit

### 2.1 Where intelligence lives

| Concept | Primary store | Also stored in |
|---|---|---|
| Team readiness | `team_intelligence.readiness_score` | `team_intelligence_history`, `match_intelligence.home/away_readiness`, `readiness_history`, `team_match_snapshots.readiness_before` |
| Player readiness | `player_intelligence.readiness_score` | `player_match_impact.readiness_score` |
| Confidence | `match_intelligence.confidence_score`/`_band` | `match_performance_comparison`, `match_half_time_intelligence`, `match_intelligence_watch`, `readiness_history.confidence_pct` |
| Risk | `match_risk_intelligence` | `team_betting_intelligence.volatility_score`/`predictability_score`, `team_form_quality.volatility` |
| Predictions | `match_intelligence` (goals, scorelines, W/D/L) | `match_performance_comparison` (**independent competing set**), `match_half_time_intelligence` (HT/FT) |
| Module results | **nowhere** | computed at render time in `modules.ts` |
| Historical analysis | `readiness_history`, `league_gap_*`, `signal_backtests`, `team_match_snapshots`, `match_opponent_context` | — |

### 2.2 Are calculations stored correctly?

**Partly.** Precomputing into dedicated tables rather than computing per request is the right call and is executed consistently for the football maths.

Three defects:

1. **Inputs and outputs share rows.** `match_intelligence` carries 28 copied input columns and 14 output columns. The immutability trigger freezes only outputs, so a historical row's inputs drift away from the outputs they produced.
2. **The same output exists in multiple tables with no reconciliation.** Two full W/D/L probability triples (`match_intelligence` and `match_performance_comparison`) are computed by different processors and both rendered.
3. **Narrative and metrics are mixed.** `recommended_approach`, `executive_brief`, `matchup_description`, `battle_outcome_prediction`, `tactical_notes`, `resilience_notes`, `impact_notes`, `depth_notes`, `flexibility_notes`, `formation_notes` are generated prose living in scores tables.

### 2.3 Are raw data and calculated data mixed?

**At the table level, no — and this is a real strength.** No `sync:*` job writes an intelligence table; no `process:*` job writes a raw table.

**Three violations at the column level:**
- `players` carries 10 injury columns duplicating the `player_injuries` table.
- `player_season_statistics.played_enough` is a computed gate on a raw table.
- `player_transfers` mixes provider-confirmed rows with squad-diff *inferences*, distinguished only by a nullable text `source`.

### 2.4 Can calculations be regenerated?

| Scenario | Answer |
|---|---|
| Rebuild all current intelligence from raw tables | **Yes.** `process:all-db` is idempotent, zero-API, and dependency-ordered. Genuinely strong. |
| Rebuild intelligence *as of a past date* | **No.** 17 team singletons are overwritten in place. `processHistoricalContext` exists solely to reconstruct 6 metrics of point-in-time state from `matches` + `match_results`. |
| Re-run a corrected formula over finished matches | **No.** Migration 042's trigger raises an exception on any change to a finished match's `match_intelligence` outputs. Correct for integrity, but there is no versioned-row escape hatch, so a formula fix cannot be applied retroactively at all. |
| Reproduce a specific published number | **No.** No table records which formula version, weight set, or code revision produced it (except `readiness_history`). |

### 2.5 Is versioning supported?

**One column in 92 tables:** `readiness_history.readiness_formula_version text NOT NULL DEFAULT 'v1'`.

This matters more here than in most systems. `lib/confidenceBand.ts` opens with: *"the thing being measured must be byte-identical to the thing being published… which is how a backtest ends up measuring a rule the product does not ship."* The codebase understands the problem; the schema does not enforce it. Change a weight in `processDbOnly.ts` and every existing row silently becomes a mixture of two models, with nothing recording where the boundary is.

### 2.6 Are historical results preserved?

| Asset | Preserved | Protected |
|---|---|---|
| `readiness_history` (pick, confidence, outcome, correctness) | Yes — 1 row per match | Yes (migration 043) |
| `match_intelligence` outputs | Yes | Partly (13 of 42 columns) |
| `team_match_snapshots`, `match_opponent_context` | Yes | **No** |
| `signal_backtests`, `league_gap_*` | Latest evaluation only | No |
| `team_intelligence_history` | 7 of 26 metrics, daily | No |
| The other 29 match-scoped tables | Overwritten by any re-run | **No** |
| The other 19 `team_intelligence` metrics | Lost on every run | — |
| Predictions from `match_performance_comparison` and HT/FT | **Not archived at all** | — |

**The core asymmetry:** the readiness model is rigorously archived and calibrated; every other model the product ships is not archived at all and therefore cannot be evaluated.

---

## 3. Module architecture audit

### 3.1 How modules are currently represented

**Entirely in frontend TypeScript.** `beta/live-frontend/src/lib/modules.ts` (1,587 lines) holds a `MODULES` array of 13 `ModuleDef` objects with a `ModuleKey` string-literal union, and a pure evaluator function per module that takes already-fetched rows and returns a `ModuleReading` (status, headline, rows, baseline, verdict).

The 13 modules and their declared backing objects:

| # | Key | Name | Scope | Tier | `source` |
|---|---|---|---|---|---|
| 1 | `home_away` | Home/Away Split | team | starter | `mv_module_home_away` |
| 2 | `readiness` | Readiness Tracker | team | pro | `mv_module_readiness_tracker` |
| 3 | `consistency` | Consistency Index | team | pro | `mv_module_consistency` |
| 4 | `giant_killer` | Giant Killer Index | team | pro | `mv_module_giant_killer` |
| 5 | `travel` | Travel Impact | match | starter | `mv_module_travel` |
| 6 | `rest` | Rest Advantage | match | pro | `mv_module_rest` |
| 7 | `league_goals` | League Goal Profile | league | starter | `mv_module_league_goals` |
| 8 | `form_gap` | Form Gap Accuracy | match | starter | `mv_module_form_gap` |
| 9 | `btts_fatigue` | BTTS by Fatigue | match | pro | `mv_module_btts_fatigue` |
| 10 | `confidence` | Confidence Calibration | match | starter | `mv_module_confidence` |
| 11 | `halftime` | Half-Time Trends | match | pro | `mv_module_halftime` |
| 12 | `clean_sheet` | Clean Sheet Probability | match | pro | `mv_module_clean_sheet` |
| 13 | `weather` | Weather Impact | match | pro | `match_weather` |

A code comment in `modules.ts` states plainly that the evaluators **do not read these views** — they read base tables — so a view's row count and the number of fixtures a module actually fires on differ, and the UI carries a `MODULE_COUNT_CAVEAT` to explain the discrepancy to users.

### 3.2 Are modules hardcoded?

**Yes, in five separate places that must be kept manually consistent:**

1. `modules.ts` — `ModuleKey` union, `ModuleDef`, evaluator function, baselines
2. `access.ts` — `FeatureKey` union (13 literals) + `FEATURE_BY_MODULE` mapping object
3. `feature_permissions` table — one row per feature key, `required_plan`
4. `tier.ts` — `PLANS` array duplicating plan names, prices, and module counts already in `subscription_plans`
5. The materialized view (undefined in the repo)

There is **no `modules` table, no `module_results` table, and no `module_versions` table.** The database has no concept that modules exist.

### 3.3 Can new modules be added easily?

**No.** Module #14 requires ~11 coordinated changes across two repositories and one out-of-band database object:

| Change | Location |
|---|---|
| Table for its outputs (if it needs one) | migration |
| Composite unique constraint | migration |
| Processor function | `processExtendedIntelligence.ts` |
| CLI case | `cli.ts` |
| Insertion into `process:all-db` at the right layer | `cli.ts` |
| Query helper | `queries.ts` |
| Row type | `types.ts` |
| `ModuleKey` + `ModuleDef` + evaluator | `modules.ts` |
| `FeatureKey` + `FEATURE_BY_MODULE` entry | `access.ts` |
| `feature_permissions` row | DB (admin) |
| Materialized view + refresh | DB (out-of-band) |

Baselines — the historical rate and sample size behind each module's claim — are **hardcoded numeric literals in `modules.ts`** (e.g. the travel bands `{ max: 100, away: 28.6, home: 48.1, n: 77 }`). They are not read from `signal_backtests` or `league_gap_analytics`. When a backtest re-runs and the measured rate moves, the shipped number does not. The `Baseline.provenance` field distinguishes `"measured"` from `"unreplayed"` (the latter documented as containing lookahead bias), which is admirable honesty — but it is honesty maintained by hand in source code.

### 3.4 Is there a scalable module-result structure?

**No.** Three distinct, unconnected taxonomies describe "a thing the system noticed about a match":

| Representation | Where | Key | Storage |
|---|---|---|---|
| Module readings | `modules.ts` | `ModuleKey` (13 values) | **not stored** — recomputed per render |
| Match signals | `match_signals` | `(match_id, market)` + `rule_key` | relational, one row per market |
| Risk factors / opportunity signals | `match_risk_intelligence.risk_factors`, `match_opportunity.signals`/`warnings` | none | jsonb blobs |
| Backtests | `signal_backtests` | `(rule_key, market)` | relational |

Nothing maps `ModuleKey` → `rule_key`, so a module cannot reliably display its own measured hit rate. `match_intelligence_watch.module_consensus`/`evidence_count` — the columns that would express "what did the modules collectively say" — sit in a table nothing writes.

The nearest thing to a correct generic structure already exists in the schema: `match_tactical_advantages` (`match_id`, typed `advantage_type`, scores, narrative, many rows per match) and `team_strengths`/`team_weaknesses` (`team_id`, typed key, score, description). **V2's module-result design should generalize those two shapes.**

---

## 4. Match page data flow

### 4.1 Input data

Resolved by `getMatchBySlug(slug)` → `getMatch(id)` in `queries.ts`, which issues **one base query plus ~30 parallel queries**:

**Base entity query** (`queries.ts:227`) — `matches` with nested PostgREST joins to `home_team:teams`, `away_team:teams`, `stadium:stadiums`, `tournament:tournaments(country:countries)`.

**Parallel fan-out** (`queries.ts:249–284`):

| Group | Tables |
|---|---|
| Match intelligence | `match_intelligence`, `match_opportunity`, `match_risk_intelligence`, `match_signals`, `match_weather`, `match_results`, `match_half_time_intelligence` |
| Impact & comparison | `team_match_impact` (×2, one per team), `match_impact_advantage`, `match_key_battles` (+ nested player joins), `match_positional_matchups` (+ nested joins), `match_tactical_advantages`, `match_performance_comparison`, `substitution_impact`, `match_squad_depth_comparison` |
| Team context | `team_betting_intelligence` ×2, `team_intelligence` ×2, `team_season_statistics` ×2, `team_form_quality` ×2, `team_venue_performance` ×2, `team_injury_impact` ×2 |
| Players | `players` ×2 (squad), `mv_module_travel` |

**Additional page-level calls** (`app/match/[slug]/page.tsx:58–96`):
`getLineups()` → `match_predicted_lineups` + `players` · `getBettingCard()` · `getMatchScoringProbs()` → `mv_match_scoring_probabilities` · `getReadinessSnapshot()` → `readiness_history` · `getBandBacktests()` → `signal_backtests` · `getMatchPlayerImpact()` → `player_match_impact` · `getPlayerVersatility()` → `player_versatility` · `getAccessContext()` → `platform_settings` + `feature_permissions` + `subscription_plans` + `user_profiles` + `user_subscriptions` · `isWatched()` → `watchlists`.

### 4.2 Flow

```
URL /match/[slug]
      │
      ▼  idFromParam(slug) → external_match_id → matches.id
┌──────────────────────────────────────────────────────────────────┐
│  matches ──┬── home_team:teams ──┬── crest, slug, country        │
│            ├── away_team:teams ──┘                               │
│            ├── stadium:stadiums (name, city)                     │
│            └── tournament:tournaments ── country:countries       │
└──────────────────────────────────────────────────────────────────┘
      │
      ├──────────────► ~30 PARALLEL QUERIES (no view, no RPC) ─────┐
      │                                                            │
      ▼                                                            ▼
┌─────────────────────────┐    ┌───────────────────────────────────────┐
│ PRECOMPUTED INTELLIGENCE│    │ ACCESS CONTEXT                        │
│ readiness · confidence  │    │ platform_settings.subscriptions_      │
│ predictions · risk      │    │   enabled → if false, open everything │
│ signals · lineups       │    │ feature_permissions × user_sub → gate │
│ impact · matchups       │    └──────────────┬────────────────────────┘
│ depth · formations      │                   │
└──────────┬──────────────┘                   │
           ▼                                  │
┌──────────────────────────────────────────┐  │
│ MODULE EVALUATION — AT RENDER TIME       │  │
│ modules.ts: 13 pure evaluators over the  │  │
│ rows above → ModuleReading[]             │  │
│ (status · headline · rows · baseline ·   │  │
│  verdict · code)                         │  │
│ Baselines are HARDCODED LITERALS         │  │
└──────────┬───────────────────────────────┘  │
           │                                  │
           ▼                                  ▼
       redactReadings(readings, access) → locked cards keep their question
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ RENDERED OUTPUT                                                  │
│  Match overview   ← matches + teams + tournament + stadium       │
│  Readiness        ← match_intelligence.home/away_readiness, gap  │
│  Confidence       ← match_intelligence.confidence_score/_band    │
│                     + signal_backtests (band hit rate + CI)      │
│  Predictions      ← match_intelligence (goals, scorelines, W/D/L)│
│                     ⚠ AND match_performance_comparison's         │
│                       independent competing prediction           │
│  Modules          ← modules.ts readings, tier-redacted           │
│  Predicted XI     ← match_predicted_lineups (x/y, role, captain) │
│  Key battles      ← match_key_battles + match_positional_matchups│
│  Team matchup     ← team_match_impact ×2 + match_impact_advantage│
│  Injuries         ← team_injury_impact ×2 + players              │
│  Signals ledger   ← match_signals (1 row per market)             │
│  Report           ← match_opportunity.executive_brief (jsonb)    │
│  Historical proof ← readiness_history + league_gap_summary       │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 What this flow reveals

1. **No read model.** ~30 round trips for one page, with no view, RPC, or denormalized match row. The `match_intelligence_watch` table looks like an abandoned attempt at one.
2. **Two predictions on one page.** `match_intelligence` and `match_performance_comparison` each supply a full W/D/L probability set and a predicted score, from different processors, with nothing declaring which is authoritative.
3. **Modules are the product abstraction and the only layer with no persistence.** Every other artefact on the page is precomputed; the module readings — the thing the user buys — are recomputed per request from hardcoded baselines.
4. **Entitlement is resolved per request across 5 tables** (`platform_settings`, `feature_permissions`, `subscription_plans`, `user_profiles`, `user_subscriptions`) with no caching layer.
5. **Two hot-path materialized views are undefined in the repository** (`mv_match_scoring_probabilities`, `mv_module_travel`). The match page cannot be fully understood, reproduced, or migrated until their definitions and refresh cadence are supplied.
6. **Graceful degradation is built in.** Every query falls back to `lib/mock.ts` demo intelligence when Supabase is unreachable, so the page renders regardless. Useful for demos; also means a silently-empty table looks identical to healthy data.
