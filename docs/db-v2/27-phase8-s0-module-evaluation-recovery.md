# PitchTerminal V2 — Phase 8 S-0 (Revised): V1 Module Evaluation Logic — Recovery Report

**Read-only investigation. No TypeScript, SQL, migration, schema, test or other document was modified. `src/v2/module/` was not created.**

Every rule below was read out of source. Nothing was reconstructed, and where a rule could not be determined it is marked as such rather than filled in.

## Evidence classes

Every claim in this report carries one of three marks.

| Mark | Meaning |
|---|---|
| **[S]** | **Recovered from source.** Read directly out of a file at a known line. Reproducible by reading it. |
| **[C]** | **Inferred from surrounding code.** The rule is not stated; it follows from a type declaration, a comment, a call site, or a query. Treat as strong evidence, not as the rule. |
| **[U]** | **Cannot be determined.** Neither stated nor derivable from anything in the repository. |

---

## 0. Where the evaluation engine is, and what it consists of

**[S]** One file: `beta/live-frontend/src/lib/modules.ts`, 1,587 lines. There is **no backend module engine** — no job, no service, nothing under `beta/backend/src`. Readings are computed **at request time, in the frontend, per page render**, and never stored.

**[S]** It contains **seventeen** evaluator functions, not thirteen:

| Group | Functions | Called by |
|---|---|---|
| Match-scope | `evalFormGap`, `evalConfidence`, `evalTravel`, `evalRest`, `evalBttsFatigue`, `evalCleanSheet`, `evalHalftime`, `evalWeather`, `evalLeagueGoals` — **9** | `evaluateMatchModules` |
| Team-scope, **single-team** | `evalHomeAway`, `evalReadinessTracker`, `evalConsistency`, `evalGiantKiller` — **4** | `evaluateTeamModules` |
| Team-scope, **two-sided** | `evalHomeAwayMatch`, `evalReadinessMatch`, `evalConsistencyMatch`, `evalGiantKillerMatch` — **4** | `evaluateTeamModulesForMatch` |

### Finding S0-4 — the four single-team evaluators never run

**[S]** A repository-wide search for callers, excluding `modules.ts` itself:

```
evaluateAllMatchModules      → ModuleFeed.tsx:111, ModuleReport.tsx:55
evaluateMatchModules         → (none — internal only)
evaluateTeamModulesForMatch  → (none — internal only)
evaluateTeamModules          → (none at all)
```

`evaluateAllMatchModules` is the **only** entry point the application uses, and it calls `evaluateMatchModules` (9) plus `evaluateTeamModulesForMatch` (4). **`evaluateTeamModules` — and with it `evalHomeAway`, `evalReadinessTracker`, `evalConsistency`, `evalGiantKiller` — is exported and never invoked.**

**This is the single most consequential finding in this report.** For all four team-scope modules there are **two implementations with different inputs, different thresholds and different status rules**, and the one that runs is not the one whose name matches the module. Any port that reads "the `eval*` function" for modules 1–4 and takes the obvious one ports dead code.

**[S]** The header comment on `evaluateAllMatchModules` says *"All twelve modules for a fixture: eight match-scope plus four team-scope."* The actual counts are **thirteen**, nine and four. The comment is stale and must not be used as a specification.

---

## 1. Per-module evaluation flow

Notation: `intel` = `match_intelligence` row; `homeIntel`/`awayIntel` = `team_intelligence` rows; `tv` = `mv_module_travel` row; `s` = `mv_match_scoring_probabilities` row; `q` = `team_form_quality`; `v` = `team_venue_performance`; `m` = `team_momentum`.

`pickSide` is defined once, in `derivePickSide` **[S]**:

```
gap = match.intel.readiness_gap
gap == null OR gap == 0  →  null
gap > 0                  →  "home"
otherwise                →  "away"
```

`pickSide` is consumed by **seven** of the thirteen live evaluators. Where it is `null`, every one of those seven collapses toward `neutral` or treats the module as automatically agreeing. It is the pivot of the entire status model.

---

### Module 1 — Home/Away Split (`home_away`, TEAM, starter)

**The version that runs: `evalHomeAwayMatch`** **[S]**

```
hHome = s.home.venue.home_win_pct        away side is NOT used here
aAway = s.away.venue.away_win_pct
if hHome == null OR aAway == null → INACTIVE "No home/away split recorded for one or both teams"

edge = classifyFixtureVenue(hHome, aAway):
    hHome >= 60 AND aAway <= 20  → HOME_VENUE_EDGE
    aAway >= 60 AND hHome <= 20  → AWAY_VENUE_EDGE
    hHome >= 50 AND aAway <= 25  → HOME_VENUE_LEAN
    aAway >= 50 AND hHome <= 25  → AWAY_VENUE_LEAN
    otherwise                    → NO_VENUE_EDGE
    (evaluated top to bottom; first match wins)

favours = HOME_VENUE_EDGE|HOME_VENUE_LEAN → "home"
          AWAY_VENUE_EDGE|AWAY_VENUE_LEAN → "away"
          NO_VENUE_EDGE                   → null

status  = favours == null OR pickSide == null → neutral
          favours == pickSide               → supports
          otherwise                         → contradicts

code    = edge                     ← the only module besides #2 that sets `code`
baseline= favours == "away" ? {rate: aAway, sample: away.venue.away_matches}
                            : {rate: hHome, sample: home.venue.home_matches}
          — note the null-favours case falls into the HOME branch
rows    = [home at home %(n), away away %(n), Edge]
verdict = one of five fixed strings keyed by `edge`
```

**The dead version: `evalHomeAway`** **[S]** — reads one team's `home_win_pct` and `away_win_pct`, classifies with **different thresholds** (`classifyVenue`: `hw>=66 && aw<=20` → "Home reliant"; `aw>=66 && hw<=20` → "Road warrior"; `hw>=60 && aw>=40` → "All weather"; else "Neutral"), and derives status from `|disparity| >= 40` where `disparity = round((hw−aw)*10)/10`. It never consults `pickSide`. **Different question, different thresholds, different answer.**

---

### Module 2 — Readiness Tracker (`readiness`, TEAM, pro)

**The version that runs: `evalReadinessMatch`** **[S]**

```
h5     = s.home.intel.last_5_points            ← team_intelligence, NOT team_momentum
a5     = s.away.intel.last_5_points
hPrior = priorFiveFrom(h5, s.home.intel.last_10_points)
aPrior = priorFiveFrom(a5, s.away.intel.last_10_points)

priorFiveFrom(last5, last10):
    last5 == null OR last10 == null → null
    prior = last10 − last5
    prior >= 0 ? prior : null       ← a negative prior is discarded, not clamped

if any of h5,a5,hPrior,aPrior is null → INACTIVE "Not enough matches to compare two five-game windows"

hc = classifyTrend(h5, hPrior);  ac = classifyTrend(a5, aPrior)

classifyTrend(last5, prior5):
    change = last5 − prior5
    change >=  10 → base "SURGING"
    change <= -10 → base "CRASHING"
    change >=   3 → base "IMPROVING"
    change <=  -3 → base "DECLINING"
    otherwise     → base "STABLE"
    trend = base == "STABLE" ? "STABLE (no change)" : "<BASE> (<+/-change>)"

status = sideStatus(pickSide,
                    hc.change >= 3 AND hc.change > ac.change,
                    ac.change >= 3 AND ac.change > hc.change)
code   = pickSide == "away" ? ac.base : hc.base
baseline = null
```

`sideStatus(pickSide, homeFavourable, awayFavourable)` **[S]**:
```
pickSide == null            → neutral
pickOk AND NOT oppOk        → supports
oppOk  AND NOT pickOk       → contradicts
otherwise                   → neutral
```

**The dead version: `evalReadinessTracker`** **[S]** reads `team_momentum.last_5_points` and `team_momentum.prior_5_points` — **a different source for the same quantity**. The match-page version derives the prior window as `last_10 − last_5` from `team_intelligence`; the team-page version reads a stored `prior_5_points`. **[U]** Whether those two agree in production cannot be determined from the repository.

#### Finding S0-5 — the dead version also contains an unreachable comparison

**[S]** `evalReadinessTracker` branches on:

```ts
const { trend, change } = classifyTrend(last5, prior5);
const status = trend === "Surging" ? "supports"
             : trend === "Crashing" ? "contradicts"
             : "neutral";
```

`classifyTrend` returns `trend` as `"SURGING (+12)"`, `"CRASHING (-11)"` or `"STABLE (no change)"` — **uppercase, with the delta appended**. `"Surging"` and `"Crashing"` can never match. **`status` is unconditionally `neutral` and the verdict is unconditionally the third branch** ("Form is holding roughly level across the two windows"), for every team, at every delta.

The same dead comparison appears in the verdict expression immediately below it.

This is a defect in code the registry describes as the thing being carried forward unchanged. **[U]** Whether "unchanged" means *reproduce the defect* or *reproduce the evident intent* is a governance question this report cannot answer. It is moot only if S-6 ports the two-sided version, which does not contain it — and that is itself the decision recorded as blocker B-3.

---

### Module 3 — Consistency Index (`consistency`, TEAM, pro)

**Runs: `evalConsistencyMatch`** **[S]**

```
hv = home.formQuality.volatility ;  av = away.formQuality.volatility
if hv == null OR av == null → INACTIVE "Volatility not yet computed for one or both teams"

hp = classifyConsistency(hv, home.formQuality.opponent_adjusted_form)
ap = classifyConsistency(av, away.formQuality.opponent_adjusted_form)

classifyConsistency(vol, oaf):
    vol <= 0.6 AND (oaf ?? 0)   >= 70 → "Reliable strong"
    vol <= 0.6 AND (oaf ?? 100) <  40 → "Reliable weak"
    vol <= 0.6                        → "Predictable"
    vol >= 1.5                        → "Erratic"
    otherwise                         → "Moderate"
    (note the two different null substitutes: 0 on the first test, 100 on the
     second, so a null oaf reaches neither branch and falls to "Predictable")

status   = sideStatus(pickSide, hv <= 0.6, av <= 0.6)   ← profile is NOT consulted
baseline = null
rows     = [home volatility (n=window_matches), away volatility (n), home profile, away profile]
verdict  = three fixed strings keyed by status, naming the pick side
```

**Dead version: `evalConsistency`** **[S]** — same `classifyConsistency`, but `status = profile == "Erratic" ? contradicts : vol <= 0.6 ? supports : neutral`, ignoring `pickSide` entirely, and rows carry `strength_of_schedule` which the two-sided version never shows.

---

### Module 4 — Giant Killer Index (`giant_killer`, TEAM, pro)

**Runs: `evalGiantKillerMatch`** **[S]**

```
hgk = home.formQuality.giant_killer_score ; agk = away.formQuality.giant_killer_score
if hgk == null AND agk == null → INACTIVE "Fewer than three fixtures against top-tier opposition"
   ← AND, not OR: one side having a score is enough to fire

hp = classifyGiantKiller(hgk, home.formQuality.flat_track_bully_score, home.formQuality.ppg_vs_top)
ap = classifyGiantKiller(agk, away.formQuality.flat_track_bully_score, away.formQuality.ppg_vs_top)

classifyGiantKiller(gk, ftb, ppgTop):
    (gk  ?? 0) >= 80  → "Strong vs top"
    (ftb ?? 0) >= 70  → "Flat-track bully"
    (ppgTop ?? 9) <= 0.5 → "Struggles vs top"
    otherwise         → "Neutral"
    (9 is a sentinel chosen so a null ppg cannot trigger "Struggles")

status   = sideStatus(pickSide, hp == "Strong vs top", ap == "Strong vs top")
baseline = null
rows     = [home ppg vs top (n=matches_vs_top), away ppg vs top (n), home profile, away profile]
```

**[C]** The INACTIVE message asserts a three-fixture minimum. Nothing in `modules.ts` enforces it; it describes a condition under which the **producer** of `giant_killer_score` leaves the column null. **[U]** That producer is a backend job outside this file and its threshold is not verifiable here.

**Dead version: `evalGiantKiller`** **[S]** — same classifier, status `Strong vs top → supports`, `Flat-track bully | Struggles vs top → contradicts`, else neutral; no `pickSide`.

---

### Module 5 — Travel Impact (`travel`, FIXTURE, starter)

**[S]** The only module that reads `mv_module_travel`.

```
tv      = ctx.travel                                   (mv_module_travel row, or null)
km      = num(tv.away_trip_km) ?? intel.away_travel_distance_km ?? null   ← FALLBACK
profile = tv.travel_profile ?? null
if km == null AND profile == null → INACTIVE "No travel distance recorded for this fixture"

BANDS (first whose max exceeds km):
    km < 100  → "Minimal (<100km)"     home 48.1  away 28.6  n  77
    km < 300  → "Short (100–300km)"    home 44.9  away 26.3  n 167
    km < 600  → "Moderate (300–600km)" home 44.4  away 26.0  n 169
    else      → "Long (600km+)"        home 42.3  away 28.8  n 222
    band = km != null ? (first match ?? BANDS[3]) : null

PROFILES (from tv.travel_profile):
    HOME_FRESH_ADVANTAGE  → supports    "Home fresher"
    AWAY_FRESH_ADVANTAGE  → contradicts "Away fresher"
    AWAY_TRAVEL_FATIGUE   → supports    "Away travel-fatigued"
    HOME_TRAVEL_FATIGUE   → contradicts "Home travel-fatigued"
    BOTH_TRAVEL_HEAVY     → neutral     "Both travel-heavy"
    NO_TRAVEL_EDGE        → neutral     "No travel edge"

status = hit?.status ?? neutral
if hit AND pickSide == "away": supports ↔ contradicts     ← inversion
    (the profile is written from the home team's point of view)

baseline = band ? {rate: band.home, sample: band.n, provenance: "unreplayed"} : null
           ← the HOME rate, not the away rate, whichever side is picked
rows     = away trip km · away 7d load (km · trips · fatigue · 14d) ·
           home "0 km" (hard-coded) · home 7d load · 7d gap · Profile · Trip band
verdict  = hit?.verdict ?? "Away win rate moves under three points across every
                            distance band — single-trip distance alone does not predict."
```

**[S]** The default verdict states, in the module's own words, that the band table it publishes a baseline from **does not predict**. The status is driven entirely by `travel_profile`, a column of the view.

---

### Module 6 — Rest Advantage (`rest`, FIXTURE, pro)

**[S]**

```
hr = intel.home_rest_days ; ar = intel.away_rest_days
if hr == null OR ar == null → INACTIVE "Rest days not recorded for one or both teams"
gap = hr − ar

gap >=  7 → "Home well rested"  homeRate 62.5
gap >=  4 → "Home rest edge"    homeRate 52.6
gap >=  1 → "Home slight edge"  homeRate 42.0
gap ==  0 → "Equal rest"        homeRate 43.3
gap >= -3 → "Away slight edge"  homeRate 42.0
otherwise → "Away rest edge"    homeRate 42.0

favours = gap >=  4 → "home"
          gap <= -4 → "away"
          otherwise → null
status  = favours == null                              → neutral
          pickSide == null OR pickSide == favours       → supports
          otherwise                                     → contradicts
          ← note: a null pickSide yields SUPPORTS here, unlike modules 1–4
baseline = {rate: homeRate, sample: 1179, pooled: true, provenance: "unreplayed"}
```

**[S]** `pooled: true` with `sample: 1179` on every branch: 1,179 is the total across all scenarios, not the count for the branch. The type comment states a pooled n suppresses the confidence interval rather than drawing a falsely narrow one.

---

### Module 7 — League Goal Profile (`league_goals`, COMPETITION_EDITION, starter)

**[S]**

```
leagueBtts = num(s.league_btts_pct)                    (mv_match_scoring_probabilities)
predTotal  = (intel.predicted_home_goals ?? 0) + (intel.predicted_away_goals ?? 0)
if leagueBtts == null AND NOT predTotal → INACTIVE "No scoring profile published for this competition"
   ← `NOT predTotal`, so an exact 0.0 predicted total counts as absent

profile = leagueBtts == null → "Unclassified"
          leagueBtts >= 60   → "Goal heavy"
          leagueBtts <= 40   → "Goal light"
          otherwise          → "Moderate"

status  = profile ∈ {Moderate, Unclassified} → neutral
          otherwise                          → supports
          ← "Goal light" also returns SUPPORTS; the axis is "league has a tilt",
            not "the tilt favours the pick". pickSide is never read.
baseline = leagueBtts != null ? {rate: leagueBtts, sample: null} : null
           ← sample null renders as "unverified" by design
headline = "<match.competition> · <profile>"
```

**[S]** `ctx.leagueGap` is declared on `MatchModuleContext` (line 452) and **read by nothing**. The match page passes `null` for it explicitly (`ModuleReport.tsx`: `buildMatchReadings(m, scoringProbs, null, bandBacktests)`). It is a dead context field.

**[C]** The module is scoped `league` but is evaluated per fixture, from a fixture-scoped view row. Its "competition" identity comes from `match.competition`, a text column on `matches`, not from a competition key.

---

### Module 8 — Form Gap Accuracy (`form_gap`, FIXTURE, starter)

**[S]**

```
h = match.homeIntel.form_index ; a = match.awayIntel.form_index   (team_intelligence)
if h == null OR a == null → INACTIVE "No form index recorded for one or both teams"
gap = round((h − a) * 10) / 10 ;  abs = |gap|

abs >  30 → "Banker"     rate 75.7  n  366  pooled false
abs >= 15 → "Strong"     rate 72.6  n 1893  pooled true
abs >=  5 → "Lean"       rate 41.1  n 1893  pooled true
otherwise → "Coin flip"  rate 14.5  n 1893  pooled true

favours = gap >= 0 ? "home" : "away"          ← gap exactly 0 favours HOME
agrees  = pickSide == null OR pickSide == favours
status  = abs < 5   → neutral
          NOT agrees → contradicts
          abs >= 15  → supports
          otherwise  → neutral
baseline = {rate, sample, pooled, provenance: "unreplayed"}
```

**[S]** In-code comment: *"Zone thresholds and rates are the published form-gap figures … these rates should be replaced by `signal_backtests` values once they clear the gate."* They are constants awaiting calibration.

---

### Module 9 — BTTS by Fatigue (`btts_fatigue`, FIXTURE, pro) — **RETIRED, not registered in V2** (S0-6)

**[S]**

```
hr = intel.home_rest_days ; ar = intel.away_rest_days
if hr == null OR ar == null → INACTIVE "Rest days not recorded — fatigue split cannot be set"

ar >= 7 AND hr <  7 → "Away rested only" rate 60.0
hr >= 7 AND ar >= 7 → "Both rested"      rate 53.9
hr <  7 AND ar <  7 → "Both fatigued"    rate 52.7
otherwise           → "Home rested only" rate 51.3

live   = num(s.btts_pct)                    ← displayed only, never affects status
status = rate >= 58 ? supports : neutral    ← pickSide never read; no contradicts branch
baseline = {rate, sample: 1179, pooled: true, provenance: "unreplayed"}
```

**[S]** Only "Away rested only" (60.0) clears 58. **`supports` is reachable through exactly one branch, and `contradicts` is unreachable.** The verdict says so: *"Spread across fatigue scenarios is under 3 points — weak on its own."*

---

### Module 10 — Confidence Calibration (`confidence`, FIXTURE, starter)

**[S]**

```
band = intel.confidence_band
if NOT band → INACTIVE "Confidence band not yet computed for this fixture"

row   = ctx.bandBacktests[band] ?? null      ← measured, from signal_backtests
score = intel.confidence_score               ← normProb-normalised on read
gap   = intel.readiness_gap

status = band ∈ {"Elite","Strong"} → supports
         band == "Moderate"        → neutral
         otherwise                 → contradicts
         ← any unrecognised band string falls to CONTRADICTS

baseline = row ? {rate: row.rate, sample: row.sample, provenance: "measured"} : null
rows     = [Band, Readiness gap (signed, rounded, or "—"),
            "Evidence streams" = score != null ? "≥ 4" : "—"]
verdict  = no row            → "No pre-kickoff measurement exists for the <band> band yet…"
           row.isCalibrated  → "Measured at X% over N pre-kickoff matches, above the publication gate."
           otherwise         → "Measured at X% over N pre-kickoff matches — below the sample gate, so treat it as provisional."
```

**[S]** This is the **only** module whose baseline is measured rather than hard-coded. `getBandBacktests` reads `signal_backtests` where `market = 'PICK_STRICT'`, matches `rule_key ~ /^CBAND_(.+)$/`, title-cases the capture (`CBAND_ELITE` → `Elite`), and **skips any band with `sample_size <= 0`** — *"Publishing 0.0% on n=0 would read as 'never happens' rather than 'never measured'."*

**[S]** `"Evidence streams": "≥ 4"` is a literal. It is not counted from anything.

---

### Module 11 — Half-Time Trends (`halftime`, FIXTURE, pro) — **RETIRED, not registered in V2** (S0-6)

**[S]**

```
ht = match.halfTime                          (match_half_time_intelligence)
if NOT ht → INACTIVE "No half-time data available for this fixture"

options = [Home/Home ht.hh_prob, Draw/Home ht.dh_prob,
           Draw/Draw ht.dd_prob, Away/Away ht.aa_prob].filter(v != null)
          ← four of the nine HT/FT paths. hd, ha, da, ah, ad are never read.
if options.length == 0 → INACTIVE "Half-time row exists but carries no HT/FT probabilities"

top    = options.sort(desc by v)[0]          ← sorts in place; rows inherit the order
status = top.v >= 30 ? supports : neutral    ← pickSide never read; no contradicts branch
baseline = null
rows     = every surviving option, descending
```

---

### Module 12 — Clean Sheet Probability (`clean_sheet`, FIXTURE, pro) — **RETIRED, not registered in V2** (S0-6)

**[S]**

```
s = ctx.scoring
if NOT s → INACTIVE "Scoring probabilities not published for this fixture"

homeCs = s.home_concedes_pct != null ? 100 − home_concedes_pct : null
awayCs = s.away_concedes_pct != null ? 100 − away_concedes_pct : null
if homeCs == null AND awayCs == null → INACTIVE "No concede rates recorded for either side"
hs = s.home_concede_sample ; as = s.away_concede_sample

profile (first match wins):
    (homeCs ?? 0) >= 50 AND (awayCs ?? 0) <= 20 → "Home clean sheet strong"
    (awayCs ?? 0) >= 50 AND (homeCs ?? 0) <= 20 → "Away clean sheet strong"
    (homeCs ?? 0) >= 40 AND (awayCs ?? 0) >= 40 → "Both solid"
    (homeCs ?? 0) <= 20 AND (awayCs ?? 0) <= 20 → "Both leaky"
    otherwise                                   → "No clean-sheet edge"
    ← a null side substitutes 0, so it reads as "concedes always"

pickSideCs = pickSide == "home" ? homeCs : pickSide == "away" ? awayCs : null
status = pickSideCs == null → neutral
         pickSideCs >= 45   → supports
         pickSideCs <= 20   → contradicts
         otherwise          → neutral
baseline = homeCs != null ? {rate: homeCs, sample: hs} : null
           ← always the HOME rate regardless of pick; NO provenance field is set
```

**[S]** This is the only baseline in the file that omits `provenance` entirely. **[C]** By the type, `provenance` is optional and therefore `undefined` — neither `"measured"` nor `"unreplayed"`. **[U]** Whether that is deliberate cannot be determined.

---

### Module 13 — Weather Impact (`weather`, FIXTURE, pro) — **RETIRED, not registered in V2** (S0-6)

**[S]** The only module whose `source` is a base table (`match_weather`), not a view.

```
w = match.weather ; temp = w.temperature_c ; condition = w.weather_condition
if temp == null AND NOT condition → INACTIVE "No weather recorded for this fixture"

rows = [Condition, Temperature] (+ Wind if wind_speed_kmh != null) (+ Humidity if humidity != null)

cell = weatherCellFor(temp, condition):
    temp == null OR NOT condition → null
    first WEATHER_CELLS entry where lower(cell.condition) == lower(trim(condition))
                                AND temp >= cell.tempMin AND temp < cell.tempMax

WEATHER_CELLS (all six, verbatim):
    WARM_RAIN     Light Rain  20–30  n  8  goals 3.88  btts 75.0  o2.5 87.5  homeWin 62.5
    HOT_CLEAR     Clear       30–∞   n  8  goals 2.63  btts 50.0  o2.5 75.0  homeWin 87.5
    WARM_CLOUDY   Cloudy      20–30  n 23  goals 2.52  btts 56.5  o2.5 52.2  homeWin 39.1
    WARM_OVERCAST Overcast    20–30  n 11  goals 2.55  btts 63.6  o2.5 45.5  homeWin 54.5
    COOL_CLEAR    Clear       10–20  n  6  goals 2.67  btts 50.0  o2.5 66.7  homeWin 16.7
    COOL_RAIN     Light Rain  10–20  n  6  goals 2.33  btts 33.3  o2.5 33.3  homeWin 33.3

if NOT cell → rows += Profile "None"; status neutral;
              verdict "Conditions fall outside every measured weather profile…"

pooled  = weatherPooled()   — sample-weighted across all six cells (total n = 62)
metrics = [Over 2.5, BTTS, Home win] each against its pooled counterpart
lead    = the metric with the largest |rate − base|
[lo,hi] = wilson(lead.rate, cell.sample, z = 1.96)
separates  = lo > lead.base OR hi < lead.base
calibrated = cell.sample >= WEATHER_MIN_SAMPLE (200)

status = neutral
if calibrated AND separates:
    status = lead.key == "Home win" ? (lead.rate > lead.base ? supports : contradicts)
                                    : supports
    if pickSide == "away" AND lead.key == "Home win": supports ↔ contradicts
baseline = {rate: lead.rate, sample: cell.sample, baseRate: lead.base, provenance: "unreplayed"}
```

**[S]** The largest cell sample is 23 and the gate is 200. **`calibrated` is false for every cell, so `status` is unconditionally `neutral`.** The code says so: *"On the current table nothing does, so this stays neutral rather than printing a directional call off single-digit samples."* Unlike S0-5 this is deliberate and documented.

**[S]** `WEATHER_MIN_SAMPLE = 200` is described as mirroring the backend calibration gate that `backtestSignals` and `backtestConfidenceBands` publish against.

---

## 2. Per-module input inventory

Every input, its source, and how it is fetched. All queries are PostgREST through `supabase-js`; joins are PostgREST embeds, not SQL joins.

| Input | Source relation | Query (`queries.ts`) | Filter | Cardinality | Null handling |
|---|---|---|---|---|---|
| `intel` | `match_intelligence` | `getMatch` :249 | `match_id = id` | `maybeSingle` | absent → `null`; every consumer early-returns INACTIVE |
| `homeIntel` / `awayIntel` | `team_intelligence` | `getMatch` :268–269 | `team_id = home/away` | `maybeSingle` | as above |
| `homeFormQuality` / `awayFormQuality` | `team_form_quality` | `getMatch` :272–273 | `team_id =` | `maybeSingle` | as above |
| `homeVenue` / `awayVenue` | `team_venue_performance` | `getMatch` :274–275 | `team_id =` | `maybeSingle` | as above |
| `travel` | **`mv_module_travel`** | `getMatch` :276 | `match_id = id` | `maybeSingle` | falls back to `intel.away_travel_distance_km` |
| `weather` | `match_weather` | `getMatch` :253 | `match_id = id` | `maybeSingle` | absent → INACTIVE |
| `halfTime` | `match_half_time_intelligence` | `getMatch` :255 | `match_id = id` | `maybeSingle` | absent → INACTIVE |
| `scoring` | **`mv_match_scoring_probabilities`** | `getMatchScoringProbs` :347 | `match_id = id` | `maybeSingle` | absent → INACTIVE for #12; degraded for #7, #9 |
| `bandBacktests` | `signal_backtests` | `getBandBacktests` :1063 | `market = 'PICK_STRICT'`, `rule_key ~ '^CBAND_'`, `sample_size > 0` | many → map | absent → baseline `null`, status unaffected |
| `momentum` | `team_momentum` | `getTeamIntel` :662 | `team_id = id` | `maybeSingle` | **only reaches the dead evaluators**; `matchTeamSides` sets `momentum: null` on both sides |
| `leagueGap` | `league_gap_summary` | `getLeagueGap` :850 | none, ordered `total_picks` desc | many | **never read by any evaluator** |

**[S]** No evaluator issues a query. Every input is fetched by the page and handed in. `getMatch` performs **31 separate PostgREST round trips** for one fixture.

**[S]** Fallback behaviour exists in exactly one place: module 5's `away_trip_km → intel.away_travel_distance_km`. Everywhere else a missing input is an early return.

### Finding S0-10 — two materialised views are on the evaluation path

The revised brief directs that the `mv_module_*` views were auxiliary reporting objects. **That holds for eleven of the thirteen.** It does not hold for two:

| View | Used by | Consequence |
|---|---|---|
| **`mv_module_travel`** | Module 5 — `travel_profile` **is** the status; `away_trip_km` selects the band | Without it, module 5 falls back to `intel.away_travel_distance_km`, which yields a band and a baseline but **`profile == null`, so `status` is permanently `neutral`** |
| **`mv_match_scoring_probabilities`** | Modules 7, 9, 12 — module 12 is INACTIVE without it; module 7 loses `league_btts_pct`; module 9 loses only a display row | Module 12 has **no fallback and no alternative source** |

Under the brief's own proviso — *"Do not recreate the old materialized views unless they are proven to be required by the evaluation engine itself"* — these two are proven required. The other eleven are proven not required: they have zero query sites (§S0-1 of [document 26](./26-phase8-s0-mv-recovery.md)).

**[U]** Their definitions remain unrecoverable, for the reasons in document 26. What each *outputs* is recorded there from the row types; what each *computes from* is not.

---

## 3. V1 → V2 dependency mapping

Classification per the requested scheme. "Replaced by S-5 feature" means a feature exists whose registered meaning covers the same quantity — **not** that the numbers agree.

| V1 input | Class | V2 representation |
|---|---|---|
| `team_intelligence.form_index` | **replaced** | `team.home_form`, `team.away_form` — but see the shape mismatch below |
| `team_intelligence.last_5_points` / `last_10_points` | **requires new Layer 3 logic** | No feature holds a points window. `home_form`/`away_form` are indices derived from points, not the points |
| `match_intelligence.home_rest_days` / `away_rest_days` | **replaced** | `team.rest_advantage` (days, scale 1, provenance ceiling OBSERVED) — per team, not per fixture pair |
| `match_intelligence.away_travel_distance_km` | **replaced** | `team.travel_impact` (index, scale 2) — a band-derived index, **not** a distance |
| `mv_module_travel.travel_profile` | **requires new Layer 3 logic** | Nothing. A six-valued two-sided classification; no V2 feature or column carries it |
| `mv_module_travel.*_km_7d/14d`, `*_trips_7d`, `*_fatigue_score`, `travel_gap_7d` | **removed** | Not ingested, not featured, not stored |
| `team_intelligence.congestion_score` | **replaced** | `team.congestion_index` (index, scale 2) |
| `match_intelligence.readiness_gap` | **requires new Layer 3 logic** | `team.readiness_score` exists **per team**. The gap is a fixture-level difference nothing computes |
| `match_intelligence.confidence_band` / `confidence_score` | **requires new Layer 3 logic** | No feature, no column. See §5 |
| `match_intelligence.predicted_home_goals` / `predicted_away_goals` | **removed** | No V2 relation holds a predicted scoreline |
| `team_form_quality.volatility` | **removed** | Not a feature, not ingested |
| `team_form_quality.opponent_adjusted_form`, `strength_of_schedule` | **removed** | as above |
| `team_form_quality.giant_killer_score`, `flat_track_bully_score`, `ppg_vs_top`, `matches_vs_top`, `window_matches` | **removed** | as above |
| `team_venue_performance.home_win_pct` / `away_win_pct` / `home_matches` / `away_matches` | **removed** | No venue-split feature. `team.home_form`/`away_form` are form indices, not win rates |
| `team_momentum.last_5_points` / `prior_5_points` | **removed** | as above; and its only consumer is dead code |
| `match_weather.*` | **removed** | **No weather relation exists anywhere in V2.** Verified: no column matching `weather|temperature|humidity|wind` in any V2 schema |
| `match_half_time_intelligence.*` (9 HT/FT paths, 2H goals, over probabilities) | **removed** | V2 holds `football.result.home_goals_half_time` / `away_goals_half_time` — **realised half-time scores, not pre-match probabilities.** Different quantity |
| `mv_match_scoring_probabilities.*` (18 columns) | **removed** | No scoring-probability relation in V2 |
| `signal_backtests` (via `CBAND_*`) | **replaced, unavailable** | `calibration.published_baseline` — but S-6 cannot write it, and doc 15 §3.9 states calibration cannot start until S-6 lands |
| `league_gap_summary` | **obsolete** | Dead input in V1 already |
| `matches.competition` (text) | **replaced** | `football.competition_edition` — an entity, not a display string |

---

## 4. Inputs now supplied by S-5 features

**[S]** Seven feature definitions exist, all `subject_kind_code = 'TEAM'`; six are calculated.

| Feature | Scale | Threshold | Covers which V1 input | Faithful? |
|---|---|---|---|---|
| `team.home_form` | 2 | 5 | `team_intelligence.form_index` at home | **partly** — V1's `form_index` is a single per-team number; V2 splits it by venue |
| `team.away_form` | 2 | 5 | same, away | as above |
| `team.rest_advantage` | 1 | 1 | `home_rest_days` / `away_rest_days` | **yes, per team.** V1's rule is a *gap* between two teams; the feature is one team's rest |
| `team.congestion_index` | 2 | 3 | `team_intelligence.congestion_score` | **[U]** V1's congestion is not read by any evaluator, so no comparison is possible |
| `team.travel_impact` | 2 | 3 | `away_travel_distance_km` | **no** — an index on a band, not kilometres. Module 5 bands on raw km |
| `team.readiness_score` | 2 | 3 | `readiness_gap` (one side of it) | **no** — the gap is a difference of two |
| `team.squad_stability` | 4 | 3 | — | **never calculated** (S-5 R-1). No values will ever exist |

**Three consequences, all [S]:**

1. **Every feature is TEAM-subject; nine of the thirteen V1 modules produce a fixture-, league- or two-sided reading.** V2's own registry places five active modules at `FIXTURE` and one at `COMPETITION_EDITION`. There is no feature at those subject kinds.
2. **`feature.feature_value` holds 0 rows.** S-5 is implemented and verified but has never run against ingested reality, because S-4 ingests forward-only and no feed is connected.
3. `team.rest_advantage` is measured in **days at scale 1**; module 6 bands on an **integer day gap between two teams**. The unit survives the crossing; the arity does not.

---

## 5. Inputs no longer available

Ordered by how much of the module set each removal takes with it.

| Removed input | Modules it silences | Why it is gone |
|---|---|---|
| `match_intelligence.readiness_gap` | **`pickSide` for all seven pickSide-dependent modules** (1,2,3,4,5,6,8,12) | No fixture-level readiness difference exists in V2. `team.readiness_score` is per team |
| `mv_match_scoring_probabilities` | **7 loses its classifier** (12 and 9 are retired) | View unrecoverable (doc 26); no V2 relation carries scoring probabilities |
| `team_form_quality` (7 columns) | **3 and 4 INACTIVE outright** | Not ingested, not featured |
| `team_venue_performance` (4 columns) | **1 INACTIVE outright** | Not ingested, not featured |
| `match_weather` | 13 — **retired, not blocked** (S0-6) | No weather relation in any V2 schema |
| `match_half_time_intelligence` | 11 — **retired, not blocked** | V2 holds realised HT scores, not pre-match HT/FT probabilities |
| `match_intelligence.confidence_band` | **10 INACTIVE outright** | No band exists in V2 until something computes one |
| `mv_module_travel.travel_profile` | 5 degrades to permanent `neutral` | View unrecoverable; classification exists nowhere else |
| `match_intelligence.predicted_*_goals` | 7 loses its second input | No predicted scoreline in V2 |
| `team_intelligence.last_5_points` / `last_10_points` | **2 INACTIVE outright** | No points-window feature |
| `signal_backtests` | 10 loses its measured baseline | Superseded by `calibration.published_baseline`, which S-6 may not write |

**Net, against the nine modules S-6 is actually asked to build** (the other four are retired — S0-6): **six can produce nothing but INACTIVE**, one (#5) is permanently `neutral` without its view, **two** have surviving inputs (#6, #8) — and the status axis of those two has no pick side to be relative to.

---

## 6. Evidence model

### 6.1 What V1 emits

**[S]** V1 has no evidence structure. A `ModuleReading` carries:

| Field | Nature | Ordering | Suppression |
|---|---|---|---|
| `status` | one of `supports`/`neutral`/`contradicts`/`inactive` | — | INACTIVE forces `rows: []`, `baseline: null` |
| `headline` | one-line string, per module | — | — |
| `rows[]` | `{label, value, color?}` — **display strings**, pre-formatted | **authored order** per module; module 11 is the exception, sorted by probability descending | conditional spreads omit a row when its column is null (modules 3, 4, 7, 9, 13) |
| `baseline` | `{rate, sample, label, baseRate?, provenance?, pooled?}` | — | `sample: null` renders "unverified"; `pooled: true` suppresses the interval |
| `verdict` | one-line string | — | — |
| `code` | machine-readable classification | — | set by **only two** evaluators: `evalHomeAwayMatch` (`VenueEdge`) and `evalReadinessMatch` (trend base) |
| `locked` | tier redaction | — | set by `redactReadings` in `lib/access.ts`, outside the engine |

**[S]** `rows` is presentation. Labels interpolate team names (`` `${s.homeName} at home` ``), values are formatted with units and thousands separators. **There is no place in V1 where a reading records *which stored value* it consumed.**

### 6.2 What V2 requires

**[S]**, from the live schema:

```
module.module_evidence          declared_input_count         NOT NULL
                                present_input_count          NOT NULL   (<= declared)
                                below_threshold_input_count  NOT NULL   default 0
                                estimated_input_count        NOT NULL   default 0

module.module_evidence_item     cited_feature_value_id       NOT NULL
                                cited_feature_value_as_of    NOT NULL
                                contribution_direction       NOT NULL
                                                 ∈ {SUPPORTS, CONTRADICTS, NEUTRAL}
                                contribution_weight          nullable
   FK  (cited_feature_value_id, cited_feature_value_as_of) → feature.feature_value(id, as_of)
   CK  cited_feature_value_as_of <= reading_as_of
   UQ  (module_evidence_id, reading_as_of, cited_feature_value_id, cited_feature_value_as_of)
```

### Finding S0-8 — evidence can only cite a feature value

`cited_feature_value_id` is **NOT NULL with a foreign key to `feature.feature_value`**. There is no nullable variant, no free-text citation, no alternative subject.

**An input that is not a feature value cannot be cited as evidence at all.** Of the twenty-one V1 inputs mapped in §3, **four** correspond to a feature — `form_index`, `home/away_rest_days`, `away_travel_distance_km`, `congestion_score` — and **seventeen** do not. A module that fires on `team_form_quality.volatility` can produce a reading but cannot produce a single evidence item for it.

**[U]** How `declared_input_count` is established. Confirmed absent: **no relation in schema `module` declares a module's inputs** — Layer 2 has `feature_source` and `feature_dependency`; Layer 3 has no equivalent. This is blocker B-5 of [document 25](./25-phase8-s6-not-specified.md), unchanged.

**[U]** How `contribution_direction` is assigned per citation. V1 has one status for the whole reading; V2 wants a direction per cited value. No V1 construct decomposes a status into per-input directions.

**[U]** `contribution_weight` — nullable, so omissible, but nothing states whether it should be omitted or what scale it would use.

**[U]** Ordering and suppression rules for evidence items. `uq_module_evidence_item__evidence_cited_value` forbids citing the same value twice under one evidence row; beyond that, nothing orders or suppresses them.

---

## 7. Evaluation outputs, and where each lands

**[S]** `module.module_reading` columns against V1's `ModuleReading`:

| V2 column | V1 origin | Status |
|---|---|---|
| `module_status_code` | `status`, uppercased — the vocabularies match exactly (`SUPPORTS`/`CONTRADICTS`/`NEUTRAL`/`INACTIVE`) | **direct** |
| `headline_text` | `headline` | **direct** (nullable) |
| `verdict_text` | `verdict` | **direct** (nullable) |
| `strength` | — | **[U] no V1 equivalent.** Nullable; `ck_module_reading__inactive_is_silent` requires it NULL when INACTIVE |
| `confidence` | — | **[U] no V1 equivalent per module.** Bounded `0 ≤ confidence ≤ 1` |
| `sample_observation_count` | `baseline.sample` — **but** V1's is the baseline's historical n, not this reading's observation count, and it is `null` for six modules and `pooled` for three | **[U] mismatch** |
| `sample_meets_threshold` | — | **[U]** no V1 gate at reading level. The nearest is `WEATHER_MIN_SAMPLE = 200`, module 13 only |
| `published_baseline_id` | `baseline` rate/label/provenance | **[U] unwritable.** See S0-7 |
| `as_of` | — | **[U]** V1 has no as-of. Readings are computed at render time and never stored |

### Finding S0-9 — V1 has no per-module confidence

**[S]** The only confidence V1 computes is **report-level**, in `overallVerdict(tally)`:

```
firing == 0                       → NO READ
contradicts >= 2                  → WEAK
contradicts == 1 AND supports >= 1 → MODERATE
contradicts == 1 AND supports == 0 → WEAK
contradicts == 0 AND supports >= 2 → STRONG
contradicts == 0 AND supports == 1 → MODERATE
otherwise                          → NEUTRAL
```

with `tally` counting statuses and `firing = count(status != inactive)`, and `sortReadings` ordering `supports(0) → neutral(1) → contradicts(2) → inactive(3)`, ties by `def.n`.

**[S] That aggregation is not S-6's.** `module.consensus_rule_version` and `module.verdict_composition_version` are referenced only by `snapshot.match_snapshot` and `snapshot.snapshot_verdict`, and `snapshot_verdict` carries `consensus_supports_count`, `consensus_contradicts_count`, `consensus_neutral_count`, `consensus_inactive_count`, `confidence` and `completeness_ratio`. **V1's `tally` / `overallVerdict` / `sortReadings` belong to S-7.** Their registry rationales nonetheless say *"implemented in S-6"* — a scope contradiction between the registry text and the schema's foreign keys.

So `module_reading.confidence` has **no V1 source at any level**: the report-level number is categorical (`STRONG`…`WEAK`), unbounded by 0–1, and lands in a different schema.

### Finding S0-7 — V1's baselines cannot be written by S-6

**[S]** Eleven of the thirteen modules publish a **hard-coded** baseline: form-gap zone rates (75.7 / 72.6 / 41.1 / 14.5), rest scenarios (62.5 / 52.6 / 42.0 / 43.3), BTTS fatigue splits (60.0 / 53.9 / 52.7 / 51.3), travel bands (48.1 / 44.9 / 44.4 / 42.3), and the six weather cells. Only module 10's is measured.

**[S]** In V2 a baseline is `calibration.published_baseline`, which requires `calibration_result_id NOT NULL` and carries `measurement_provenance ∈ {POINT_IN_TIME, CONTAMINATED_LOOKAHEAD}` — a precise match for V1's `provenance: "measured" | "unreplayed"`.

**[S]** `pt_pipeline_module` holds **SELECT only** on all ten `calibration` relations. It cannot insert a baseline, and doc 15 §3.9 states calibration *"cannot start until S-6 lands"* and that historical backtests are **re-run, not migrated**.

**Therefore S-6 must emit every reading with `published_baseline_id = NULL`**, and every V1 rate constant is dropped at the boundary. Doc 15 §3.9 anticipated exactly this: *"for a period after cut-over, modules will correctly report 'unverified' where V1 displayed a rate."*

---

## 8. Missing information — what cannot be recovered, and why it blocks

| # | Missing | Why it cannot be reconstructed | What it blocks |
|---|---|---|---|
| M-1 | **`mv_module_travel` definition** | Production-only; zero definitions in 832 git blobs (doc 26) | Module 5's `travel_profile`, the six-valued classification that **is** its status. Not derivable from its outputs |
| M-2 | **`mv_match_scoring_probabilities` definition** | as above | **Module 7's classifier** (12 and 9 are retired). `components_available` in particular has no stated meaning |
| M-3 | **Producers of `team_form_quality`** | Backend jobs `processDbOnly.ts` / `processExtendedIntelligence.ts` (9,375 lines) compute `volatility`, `opponent_adjusted_form`, `giant_killer_score`, `flat_track_bully_score`, `ppg_vs_*`; their formulae were never audited into V2 | Modules 3 and 4. **[C]** The "three fixtures vs top-tier" floor is asserted in an INACTIVE message and is unverified |
| M-4 | **Producer of `team_venue_performance`** | as above | Module 1 |
| M-5 | **Producer of `match_intelligence.confidence_band` / `confidence_score`** | `lib/confidenceBand.ts` (463 lines) is named in doc 15 §3.9 but its formula was never brought into V2, and the band vocabulary is a bare `text` column | Module 10 |
| M-6 | **Producer of `match_half_time_intelligence`** | Migration 029 creates the table; what writes the nine HT/FT probabilities is not established | Module 11 — **retired**, so this blocks nothing S-6 must build |
| M-7 | **Provenance of `match_weather`** | Doc 15 §3.5 records weather as **synthetic, stored with no provenance flag, consumed by a paid module** | Module 13 — **retired**. Recorded because the retirement resolves a live product-integrity problem, not only a scope question |
| M-8 | **The 1,893-match and 1,179-match populations** | The counts appear as literals; the populations, dates and selection rules do not exist anywhere | Every pooled baseline. They are marked `provenance: "unreplayed"` — *"scored finished matches using CURRENT team form and therefore contains lookahead"* |
| M-9 | **The 635-match weather study** | Only its six output cells survive, and only 62 of 635 matches fall into any profile | Module 13's baseline — **retired** |
| M-10 | **What `components_available` counts** | Column of an unrecoverable view | Any sampling derivation for scoring-derived modules |

**[U] and unresolved by this exercise:** whether V1's readings were ever correct. There is no golden file, no fixture-level regression corpus, and no stored reading anywhere — readings are computed per render and discarded. Doc 15 §3.6's proposed test is *"golden-file comparison against V1 output for the same fixture"*; producing that file requires running V1 against production data, which this session cannot reach.

---

## 9. Required S-6 implementation assumptions

Each of these is a decision S-6 cannot take for itself. Listed as the questions, not as answers.

| # | Assumption required | Why it cannot be defaulted |
|---|---|---|
| A-1 | **Which implementation is "the V1 module"** for modules 1–4 — the two-sided one that runs, or the single-team one whose name matches | Different inputs, different thresholds, different status rules (S0-4). `module_version` 1.0.0 says "unchanged" and does not say which |
| A-2 | **Whether S0-5's unreachable comparison is ported** | "Unchanged" is satisfied by reproducing a defect and by fixing it. Moot only if A-1 chooses the two-sided version |
| A-3 | **Where `pickSide` comes from** | It is the status pivot for 8 of 13 modules. V1 reads `readiness_gap`; V2 has no fixture-level readiness difference, and the characterisation a module SUPPORTS is composed by S-7 from the readings — a cycle |
| A-4 | **Whether a FIXTURE-subject module may consume TEAM-subject features of its two participants, and how they combine** | Every feature is TEAM; five active modules are FIXTURE, one COMPETITION_EDITION. Blocker B-4 of doc 25, unchanged |
| A-5 | **What `declared_input_count` counts** | No relation declares module inputs. Blocker B-5, unchanged |
| A-6 | **How `contribution_direction` is derived per cited value** | V1 has one status per reading, not per input |
| A-7 | **What `confidence` and `strength` mean** | Neither exists in V1 at module level (S0-9) |
| A-8 | **What `sample_observation_count` counts for a module** | V1's baseline `sample` is a historical population size, `null` for six modules and pooled for three |
| A-9 | **Whether an active module with no surviving input writes INACTIVE readings or is not run at all** | Six of the nine active modules would emit nothing else, and INACTIVE is a legitimate stored reading (`ck_module_reading__inactive_is_silent` contemplates it). Writing it is honest and costs a row per subject per instant; not running it is silent |
| A-10 | **What happens to the four V2 definitions with no V1 evaluator** — `historical_advantage`, `match_context`, `risk_assessment`, `squad_stability` | All are `is_active = false` with the rationale *"no evaluation logic exists"*. Whether authoring that logic is S-6's or a later subsystem's is unstated. (The converse case — the four V1 modules absent from V2 — is **settled**: they are retired. See S0-6) |

### Finding S0-6 — the two registries are not the same thirteen

**[S]** V2 `module.module_definition`, read from the database:

| V2 module | Subject | Active | V1 counterpart |
|---|---|---|---|
| `home_away_split` | TEAM | ✓ | #1 `home_away` |
| `readiness_tracker` | TEAM | ✓ | #2 `readiness` |
| `consistency_index` | TEAM | ✓ | #3 `consistency` |
| `giant_killer_index` | TEAM | ✓ | #4 `giant_killer` |
| `travel_impact` | FIXTURE | ✓ | #5 `travel` |
| `rest_advantage` | FIXTURE | ✓ | #6 `rest` |
| `league_goal_profiles` | COMPETITION_EDITION | ✓ | #7 `league_goals` |
| `form_gap_accuracy` | FIXTURE | ✓ | #8 `form_gap` |
| `confidence_calibration` | FIXTURE | ✓ | #10 `confidence` |
| `historical_advantage` | FIXTURE | ✗ | **none** |
| `match_context` | FIXTURE | ✗ | **none** |
| `risk_assessment` | FIXTURE | ✗ | **none** |
| `squad_stability` | TEAM | ✗ | **none** |

**Four V1 modules have no V2 definition**: #9 `btts_fatigue`, #11 `halftime`, #12 `clean_sheet`, #13 `weather`. **[S] They are retired by an approved decision, not omitted.** S-3's brief instructed *"Treat omitted V1 modules as retired and do not seed them"*; [document 18](./18-phase8-s3-seed-report.md) §1.3 records the implementation, `beta/backend/src/v2/seed/moduleRegistry.ts:382` declares

```ts
export const RETIRED_V1_MODULE_KEYS = ['btts_fatigue', 'halftime', 'clean_sheet', 'weather'] as const;
```

and `seed.test.ts:66` asserts each is absent from the registry. Their omission is a checked fact.

**This narrows S-6's scope from thirteen modules to nine**, and it removes modules 11 and 13 — the two whose inputs are most comprehensively gone — from the problem entirely. It also settles A-10 in one direction: the four retired modules are not to be built. Whether the four V2-only definitions are S-6's or a later subsystem's remains open; all four are `is_active = false` with the rationale *"no evaluation logic exists."*

**[S]** `pt_pipeline_module` holds `INSERT, SELECT` on `module_definition` and `module_version`, and **no `UPDATE` on either** — so S-6 could register a module but could not amend one. Registering one would nonetheless reverse an approved retirement, which is governance, not implementation.

**Four V2 definitions have no V1 evaluator**, all registered inactive with the rationale *"Identity and version only — no evaluation logic exists."*

**[S]** Note also the subject-kind shift: V1 scopes modules 1–4 as `team` but the code that runs evaluates them **two-sidedly, per fixture**, and V1 scopes #7 as `league` but evaluates it **per fixture** from a fixture-scoped row. V2 places 1–4 at `TEAM` and #7 at `COMPETITION_EDITION`. **The registered subject kind and the evaluated grain disagree for five of the nine modules that have both.**

---

## 10. Remaining blockers

The five blockers of [document 25](./25-phase8-s6-not-specified.md), re-assessed against what this investigation recovered.

| Blocker | Effect of this investigation |
|---|---|
| **B-1** — no S-6 architecture, specification or decision record | **Unchanged.** This report is an input to writing them, not a substitute |
| **B-2** — S-0 unfinished | **Narrowed to two objects.** Eleven views are confirmed auxiliary (zero query sites); `mv_module_travel` and `mv_match_scoring_probabilities` are proven required by the engine (S0-10) and remain unrecoverable |
| **B-3** — `module_version` 1.0.0 says "the V1 logic unchanged" | **Sharpened.** For modules 1–4 there are two implementations and the running one is not the name-matching one (S0-4), and one of the two contains an unreachable branch (S0-5). "Unchanged" does not name a rule |
| **B-4** — subject-kind mismatch | **Sharpened.** All seven features are TEAM; and V1's registered scope disagrees with its own evaluated grain for five modules (S0-6) |
| **B-5** — nothing declares module inputs | **Unchanged, and now bounded.** §2 is what the code *reads*, observed. It is not a declaration and must not be treated as one |

**Four blockers are added by this investigation:**

| New | Statement |
|---|---|
| **B-6** | **`pickSide` has no V2 source.** It drives the status of 8 of 13 modules, V1 derives it from `match_intelligence.readiness_gap`, and V2's nearest equivalent is a fixture-level difference of two TEAM readiness values that nothing computes. The characterisation modules are relative to is composed by S-7 **from** the readings — so taking it from there is circular (A-3) |
| **B-7** | **Six of the nine modules S-6 must build have no surviving input.** Against the nine active V2 definitions — modules 11, 12, 13 and 9 being retired (S0-6) — only **two** have inputs today: `rest_advantage` (#6, from `team.rest_advantage`) and `form_gap_accuracy` (#8, from `team.home_form`/`away_form`), both needing a two-team pairing rule that does not exist. `travel_impact` (#5) degrades to permanent `neutral` without `mv_module_travel.travel_profile`. The remaining six — `home_away_split`, `readiness_tracker`, `consistency_index`, `giant_killer_index`, `league_goal_profiles`, `confidence_calibration` — can produce nothing but INACTIVE |
| **B-8** | **Evidence can only cite feature values** (`cited_feature_value_id NOT NULL`, FK to `feature.feature_value`). Fifteen of twenty-one V1 inputs are not features, so readings built on them can carry no evidence item at all (S0-8) |
| **B-9** | **The consensus and verdict-composition rules are S-7's, not S-6's** — their versions are referenced only by `snapshot.match_snapshot` and `snapshot.snapshot_verdict` — yet both registry rationales say "implemented in S-6". Registry text and schema foreign keys disagree (S0-9) |

---

## Status

**The V1 evaluation logic is recovered in full.** All seventeen evaluators, every helper (`classifyVenue`, `classifyFixtureVenue`, `classifyTrend`, `classifyConsistency`, `classifyGiantKiller`, `priorFiveFrom`, `sideStatus`, `weatherCellFor`, `weatherPooled`, `wilson`, `intervalWidth`, `num`, `sign`, `inactive`), every constant, every threshold, every early return and every classification rule is in §1 and §6.1, read from source.

**What the modules read is not recovered in full**, and cannot be: two materialised views on the evaluation path are production-only, and the backend producers of five input tables were never audited into V2 (M-3 … M-7).

**Two things did narrow.** S-6's scope is **nine** modules, not thirteen — four are retired by an approved decision that is recorded, implemented and test-asserted (S0-6). And of the thirteen `mv_*` views, only **two** are required by the evaluation engine; the other eleven are confirmed reporting infrastructure with zero query sites (S0-10).

**S-6 still cannot be specified**, and this exercise makes the reason more precise rather than removing it: the logic is legible, but of the nine modules in scope only two have a surviving input, the status axis has no pick side to be relative to, evidence can cite nothing but feature values, and the registry does not say which of two implementations "unchanged" refers to.

**S-6 has not begun. `src/v2/module/` does not exist. S-5 is untouched and remains complete.**
