# FM-Style UI — Schema Gap Analysis

Every panel below was checked against the actual schema in `schema_reference.sql`,
not assumed. Three categories: **buildable now** (data exists, just needs a
query + UI), **needs new column/table** (data doesn't exist but is derivable
from what we already sync), and **needs external data** (blocked on an
integration we don't have, e.g. odds).

---

## Image 1 — Match Details

| Panel | Status | Source |
|---|---|---|
| Readiness comparison (gauges, gap, predicted edge) | ✅ Buildable now | `match_intelligence` |
| Key Insight text + confidence bar | ✅ Buildable now | Already wired — `lib/insights.ts` |
| Readiness Breakdown (7 components) | ✅ Buildable now | Already wired this session |
| Recent Form (5 pills per team) | ✅ Buildable now | `team_form_history` |
| Head to Head (last 5 meetings) | ✅ Buildable now | Query `match_results` + `matches` filtered to both team IDs in either order — no new table |
| Next 5 Fixtures (both teams) | ✅ Buildable now | Query `matches` per team, `date > now()`, limit 5 |
| Match Quick Facts: Competition/Matchweek/Date/Time/Venue/Capacity | ✅ Buildable now | `matches` + `stadiums` |
| Match Quick Facts: **Referee** | ❌ Needs new column | No `referee` field anywhere in schema. Needs `matches.referee_name text` — **and confirming SportsAPI Pro's schedule/fixture endpoint actually returns a referee field before adding the column** |
| Match Quick Facts: **Surface** | ❌ Needs new column | `stadiums.surface text` — same caveat, needs API confirmation |
| Match Quick Facts: **Weather** | ⚠️ Table exists, unpopulated | `match_weather` has the right columns already (`temperature_c`, `weather_condition`, `wind_speed_kmh`) but **0 rows** — no sync job currently writes to it. Needs a new `syncMatchWeather.ts` job wired to a weather API (SportsAPI Pro doesn't provide this) |
| Travel Map (route visualization) | ✅ Buildable now | `team_locations` + `stadiums` lat/long already exist — needs a map library (Leaflet), not new data |

---

## Image 2 — Team Detail (Liverpool)

| Panel | Status | Source |
|---|---|---|
| Team Readiness gauge + 7-component breakdown | ✅ Buildable now | `team_intelligence` — same components as match page |
| Key Intelligence sidebar (Form/Fatigue/Squad Stability/Rotation/Active Comps/Rest/Travel/Congestion) | ✅ Buildable now | All columns already exist in `team_intelligence` |
| Squad Overview (players/age/foreign%/value) | ✅ Buildable now | `team_squads_snapshot` |
| Squad Composition donut (GK/DEF/MID/FWD split) | ✅ Buildable now | `team_position_depth` grouped by position_code |
| Key Players table with **per-player READINESS column** | ❌ Needs new column | `player_intelligence` has `fatigue_score` and `load_index` but no composite `readiness_score`. Mockup shows a single 0-100 number per player. Needs `player_intelligence.readiness_score numeric` — computed similarly to team readiness (some blend of fatigue, load, minutes played recently) |
| Trend (Last 14 Days) line chart | ❌ Needs new table | `team_intelligence` stores only the CURRENT snapshot (one row per team, overwritten on every `process:team-intelligence` run). There's no history to chart. Needs a new `team_intelligence_history` table, snapshotted daily (same pattern as `team_squads_snapshot`/`team_fixture_load`, which already use `snapshot_date`) |
| Next Match card | ✅ Buildable now | `matches` + `match_intelligence` |
| Fixture Congestion (next 14 days) | ✅ Buildable now | `team_fixture_load` already has `matches_next_14_days` |
| Recent Form (opponent, W/D/L, score) | ✅ Buildable now | `team_form_history` joined to `matches` for opponent name |
| Upcoming Fixtures list | ✅ Buildable now | `matches` |
| Travel Analysis (distance, map, fatigue score) | ✅ Buildable now | `team_travel_load` + `team_locations` |

---

## Image 3 — League Detail (Premier League)

| Panel | Status | Source |
|---|---|---|
| KPI strip (avg readiness/form/rest/congestion/travel/active comps) | ✅ Buildable now | Aggregate `team_intelligence` for teams in this tournament (join via `tournament_standings`) |
| League Table (readiness/form/congestion/rest ranked) | ✅ Buildable now | `tournament_standings` (for team list + position) joined to `team_intelligence` |
| Readiness Distribution donut | ✅ Buildable now | Same aggregation, bucketed |
| League Insights (auto-generated text) | ✅ Buildable now | Same rule-based pattern as `generateMatchInsight()`, new `generateLeagueInsight()` function — no new data needed |
| Trend Over Time (30-day multi-line chart) | ❌ Same gap as Image 2 | Needs `team_intelligence_history` |
| Key League Stats (goals/match, home win%, clean sheets) | ✅ Buildable now | `team_season_statistics` already has `goals_scored`, `goals_conceded`, `clean_sheets` — aggregate by tournament |
| Upcoming Fixture Congestion (per team, next 14 days) | ✅ Buildable now | `team_fixture_load` |
| Top 3 by Category (best form / most rest / least congestion) | ✅ Buildable now | Same aggregation, sorted 3 ways |

---

## Image 4 — Leagues Overview (list of all leagues)

| Panel | Status | Source |
|---|---|---|
| KPI strip (37 leagues, 1248 teams, avg readiness, etc.) | ✅ Buildable now | Aggregate across all tracked tournaments |
| Ranked league table (readiness/form/congestion/travel/rest/active comps/trend) | ✅ Buildable now | Same `tournament_standings` → `team_intelligence` join per tournament, one row per league |
| "Trend" sparkline column | ❌ Same history gap as Images 2/3 | Needs `team_intelligence_history` (aggregated to league level) |
| League Congestion / Travel Load donuts | ✅ Buildable now | Bucket the same aggregated data |
| Active Competitions Distribution bar chart | ✅ Buildable now | `team_intelligence.active_competitions` grouped |
| League Insights callouts | ✅ Buildable now | Rule-based text, same pattern |

---

## Image 5 — Betting Intelligence (Match Picks & Value Opportunities)

| Panel | Status | Source |
|---|---|---|
| Readiness Gap column, Confidence (HIGH/MEDIUM) | ✅ Buildable now | Already exists — this is literally what `/matches/picks` already does |
| Pick (1/X/2), direction | ✅ Buildable now | Derivable from readiness gap direction, already in `lib/signals.ts` |
| **Odds column** | ❌ Needs external data | No odds provider integrated anywhere in this codebase. Cannot be built from anything currently synced. |
| **Value %** (edge between our confidence and market odds) | ❌ Needs external data | By definition requires real odds to compare against — this is the entire point of a "value bet," it can't be computed without a market price |
| **Best Value / Highest Edge KPI cards** | ❌ Needs external data | Same — derived from odds |
| **Odds Movement (Last 24h)** | ❌ Needs external data + new table | Requires both an odds feed AND a new table to track odds over time (`match_odds_history` or similar) |
| **Best Bet Builder** (combined odds parlay) | ❌ Needs external data | Combines multiple markets' odds — impossible without odds |
| Picks by Confidence donut | ✅ Buildable now | Can build from readiness-gap-derived confidence alone, no odds needed |
| Value Distribution histogram | ❌ Needs external data | By definition needs Value % |
| Top Markets bar chart | ⚠️ Partial | Market *names* (1X2, Over/Under, BTTS) already exist in `lib/signals.ts`. Percentage-of-picks-per-market is buildable. But this being framed as "betting" implies real market data context that isn't there |

**Bottom line on Image 5**: roughly 60% of this page is fundamentally an odds-comparison product. Without integrating a real odds provider (Odds API, Betfair Exchange API, or similar), the best honest version of this page is what `/matches/picks` already is — readiness-and-signal-driven picks with confidence, NOT true "value betting" against a market price. I'd rather build an honest version of this than fake numbers that look like Image 5 but aren't real.

---

## Recommended new schema additions (ranked by build value)

1. **`team_intelligence_history`** — highest value, unblocks Trend charts on 3 of 5 pages (Team, League Detail, Leagues Overview). Daily snapshot, same pattern as existing snapshot tables.
2. **`player_intelligence.readiness_score numeric`** — unblocks the Key Players readiness column on Team Detail. Small, single-column addition.
3. **`matches.referee_name text`** — needs API confirmation first (does SportsAPI Pro's schedule/fixture endpoint actually return this?). Low effort if yes.
4. **`stadiums.surface text`** — same, needs API confirmation.
5. **Weather sync job** — `match_weather` table already has the right shape, just needs a job to populate it. Requires picking a weather API (OpenWeatherMap, etc.) — new external dependency.
6. **Odds provider integration** — largest scope, entirely new subsystem (new tables, new sync job, new signal logic). Recommend treating as a separate phase, not bundled into this UI redesign.

I'm proposing to build #1 and #2 now (both cheap, both unlock real mockup panels), and leave #3-6 as a documented backlog since they need either API confirmation or a new paid integration before I'd write code against them.
