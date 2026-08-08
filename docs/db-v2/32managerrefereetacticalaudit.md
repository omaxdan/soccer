# Manager, Referee & Advanced Tactical Intelligence — Architecture & Data-Source Audit

**Scope:** feasibility of Manager Intelligence, Referee Intelligence and Advanced Tactical Intelligence on PitchTerminal V2
**Method:** static audit of `v2/migrations/001–020` applied to a live PostgreSQL 16 instance, plus `beta/backend/src/` ingestion code and `docs/db-v2/` phase documents
**Status:** audit only — no code written, no migration modified, no schema changed
**Date:** 2026-08-08

---

## 1. Executive Verdict

All three intelligence areas are **architecturally clean fits** for V2. None requires a new schema layer, none violates the football → feature → module → snapshot separation, and none needs a "tactics score."

But three findings reframe the work, and the second and third are more important than anything about schema design.

**Finding 1 — the schema is largely already there.** `football.official`, `football.official_assignment`, `football.lineup` (with a `formation` column), `football.lineup_selection`, `football.appearance` (with `yellow_cards` / `red_cards`) and `football.result` (with half-time scores) all exist today. Referee and formation intelligence need **almost no new tables**. Manager is the sole genuine gap — there is no manager entity anywhere in V2, and the string "manager" does not appear in any `docs/db-v2/` document.

**Finding 2 — almost none of the required data is being ingested.** S-4 §9 explicitly defers `lineup`, `lineup_selection`, `appearance`, `match_event`, `official`, `official_assignment` and `provider_statistic`. The tables are empty by design, not by accident. **Every one of the three intelligence areas rests on data PitchTerminal does not currently collect.** The binding constraint is ingestion and API quota, not database design.

**Finding 3 — the historical window is the off-season, and that inverts the build order.** The stated backfill window (end of May 2026 → now) is approximately ten weeks that fall almost entirely in the European close-season. For the majority of 57 tracked leagues it contains close to zero competitive matches. Tactical baselines cannot exist for those leagues until the 2026/27 season has run for two to three months — realistically **November–December 2026**. Manager and referee intelligence do **not** have this problem, because their history arrives pre-aggregated from the provider rather than being accumulated by us.

**Recommended order is therefore the inverse of the intuitive one: Referee first, Manager second, Tactical last.**

| Question | Answer |
|---|---|
| Can this be added cleanly? | **Yes.** 3 new `football` tables. Zero changes to `feature`, `module` or `snapshot`. |
| What is the real blocker? | **API quota.** 200 calls/day against ~1,100+ teams and ~1,500 referees. |
| Can it be non-betting? | **Yes, and the architecture already encodes the line** — `calibration_mode = CONTEXTUAL`, *"Characterises an environment; not outcome-scored."* |
| Biggest risk? | Building statistically void signals — new-manager bounce, formation success rate, team-specific referee history. |
| Feasible at 200/day? | **Only on a narrowed league set.** Full 57-league rollout needs ~7,500/day. |

---

## 2. What SportsAPI Pro Already Gives Us

### 2.1 A necessary caveat on the source of truth

The brief says to use SportsAPI Pro V2 documentation as the source of truth and not to invent endpoints. **That documentation is not in this repository.** What exists is `beta/backend/src/constants/endpoints.ts`, a registry described in its own header as *"Phase 1 (Data Warehouse Foundation) endpoints only. Phase 2+ will add intelligence endpoints."*

Every manager and referee endpoint named in the brief is therefore recorded below as **ASSERTED (UNVERIFIED)** — taken from the brief in good faith, but not confirmed against provider documentation or a live call. Nothing in this audit invents an endpoint, and nothing treats an asserted endpoint as confirmed.

**Before implementation, three things must be verified by live call**, because the design consequences differ materially:
1. Does `/api/managers/{id}/career-history` return **home/away splits**, or only aggregate W/D/L per club? (Determines whether managerial home/away record is possible at all.)
2. Does `/api/referee/{id}/statistics` return **per-competition** rows or a single career aggregate? (Determines whether competition normalisation is possible.)
3. **Which endpoint carries the referee assignment for a fixture?** S-4 states plainly that *"Referee data is not in the schedule feed."* If assignment requires one call per fixture, that single fact dominates the entire quota model.

### 2.2 Endpoints currently registered and in use

| Key | Path | Consumer | Volume |
|---|---|---|---|
| `schedule` | `/schedule/{date}` | `syncDateMasterFeed` | **Primary feed.** 1 call/day |
| `tournaments` | `/tournaments` | `syncDiscovery` | 1 call |
| `seasons` | `/seasons` | `syncDiscovery` | 1 call |
| `match` | `/match/{id}` | — | registered, per-fixture |
| `team_players` | `/teams/{id}/players` | `syncTeamsPlayers` | 1 call/team |
| `tournament_team_events` | `/tournament/{t}/season/{s}/team-events` | `syncTournamentEvents` | 1/tournament-season |
| `team_events_last` / `_next` | `/teams/{id}/events/{last,next}/{n}` | CLI only | **targeted use only** |
| *(unregistered)* | `/team/{id}/players`, `/teams/{id}/transfers`, images, standings | various | 1 call/team |

**No manager endpoint and no referee endpoint is registered, referenced, or called anywhere in the codebase.** All five manager endpoints and all three referee endpoints in the brief would be new integrations.

### 2.3 The quota reality

From `beta/backend/src/v2/ingestion/provider/config.ts`:

```
dailyQuotaPerKey  = 100      (PT_V2_PROVIDER_DAILY_QUOTA, default)
keys              = up to 2  (PT_V2_PROVIDER_KEY, PT_V2_PROVIDER_KEY_2)
minRequestIntervalMs = 2000
```

**Whole-deployment budget: 200 calls/day.** S-4 §6.5 confirms: *"at 57 leagues on 200 calls/day, an unmeasured binding constraint cannot be managed."*

`src/config/trackedLeagues.ts` declares **57 leagues across ~48 countries**. At roughly 20 teams per league that is **~1,100–1,200 teams** — an estimate from league count, not a verified team census, and it should be confirmed before committing to the quota plan in §11.

---

## 3. Manager Intelligence Opportunities

### 3.1 Signal classification

| Signal | Classification | Notes |
|---|---|---|
| Manager identity, name, country | **DIRECT API DATA** (asserted) | `/api/teams/{id}` manager object |
| Nationality, age, DOB | **DIRECT API DATA** (asserted) | `/api/managers/{id}` |
| Preferred formation | **DIRECT API DATA** (asserted) | Provider's declared preference — an opinion, not an observation |
| Career W/D/L per club | **DIRECT API DATA** (asserted) | `/career-history` |
| Current-club W/D/L | **DIRECT API DATA** (asserted) | `/career-history`, open spell |
| Tenure length (days) | **DERIVED FROM API DATA** | spell start → now |
| Tenure length (matches) | **DERIVED FROM EXISTING PITCHTERMINAL DATA** | count `fixture` rows in spell range |
| New-manager situation (boolean) | **DERIVED FROM API DATA** | tenure below a declared threshold |
| Recently changed clubs | **DERIVED FROM API DATA** | prior spell end date |
| Actual formations used | **DERIVED FROM EXISTING PITCHTERMINAL DATA** | `football.lineup.formation` — **not currently ingested** |
| Formation stability | **DERIVED FROM EXISTING PITCHTERMINAL DATA** | modal formation ÷ matches — **not currently ingested** |
| Formation changes | **DERIVED FROM EXISTING PITCHTERMINAL DATA** | same dependency |
| Home/away managerial record | **NOT CURRENTLY POSSIBLE** → conditional | Only if career-history carries the split, or manager events join to our fixtures. Verify first. |
| Record vs stronger/weaker opponents | **DERIVED FROM EXISTING PITCHTERMINAL DATA** | needs `standing` + spell range; large sample cost |
| Recent managerial form | **DERIVED FROM EXISTING PITCHTERMINAL DATA** | already computable from `result` once spells exist |
| **New-manager bounce** | **DO NOT BUILD** | see §3.3 |
| **Post-change instability** | **DO NOT BUILD** | see §3.3 |

### 3.2 Minimum samples

| Signal | Minimum | Rationale |
|---|---|---|
| Tenure (days / matches) | **n = 1** | A fact, not an estimate. Report immediately. |
| Formation stability | **≥ 10 matches** under that manager | Below 10, one rotation swings the ratio by >10pp |
| Manager W/D/L at current club | **≥ 20 matches** for any comparison | Below 20, the 95% CI on win rate spans ~±22pp |
| Record vs opponent strength | **≥ 30 matches** | Splitting by strength tier costs an order of magnitude |
| Home/away managerial record | **≥ 20 per venue side (40 total)** | Same reason, doubled |

### 3.3 Manager transition effects — the honest answer

The brief asks not to assume these are valid merely because they are calculable. They are not valid, and this is the clearest "do not build" in the audit.

**New-manager bounce is largely a statistical artefact.** Managers are dismissed after unusually poor runs. Poor runs are partly bad luck. Whatever follows regresses toward the mean **whether or not the manager changed** — so post-appointment improvement is expected under the null hypothesis of no managerial effect at all. Isolating a real effect requires a matched control: clubs in comparably bad runs that did *not* change manager, with fixture difficulty controlled.

The sample makes this decisive rather than merely difficult. Across 57 leagues expect roughly 60–120 managerial changes per season. After matching on run quality, fixture difficulty and league, the usable set falls to tens. **This is not estimable at PitchTerminal's data scale in any timeframe under discussion.**

**Recommendation: report tenure as a fact and stop there.** *"Appointed 14 March 2026; 18 matches in charge"* is true, useful, and cheap. *"New managers typically improve results"* is unsupported and would be the single least defensible claim in the product.

The same applies to post-change instability and to "improvement/decline after appointment."

---

## 4. Referee Intelligence Opportunities

**This is the strongest opportunity in the audit** — best schema readiness, lowest API cost, clearest product value.

### 4.1 Signal classification

| Signal | Classification | Notes |
|---|---|---|
| Referee identity, country | **DIRECT API DATA** (asserted) | `football.official` **already exists** |
| Matches officiated, cards, penalties (tournament level) | **DIRECT API DATA** (asserted) | `/referee/{id}/statistics` |
| Referee assignment per fixture | **DIRECT API DATA** (asserted) | `football.official_assignment` **already exists**; source endpoint unconfirmed |
| Cards per match | **DERIVED FROM API DATA** | cards ÷ matches from statistics |
| Cards per match (our observation) | **DERIVED FROM EXISTING PITCHTERMINAL DATA** | `appearance.yellow_cards` + `red_cards` over `official_assignment` — **preferred**: auditable, competition-normalisable, ours |
| Yellow-card tendency | **DERIVED** | as above |
| Penalty tendency | **DIRECT API DATA** only | Cannot be derived from PitchTerminal — see §4.3 |
| Disciplinary intensity vs competition mean | **DERIVED FROM EXISTING PITCHTERMINAL DATA** | needs competition baseline |
| Consistency across competitions | **DERIVED FROM API DATA** | only if statistics are per-competition — verify |
| Recent referee form | **DERIVED FROM API DATA** | `/referee/{id}/events/last/{page}` |
| Referee home/away difference | **DO NOT BUILD** | §4.4 |
| Team-specific referee history | **DO NOT BUILD** | §4.4 |

### 4.2 Two storage problems, both concrete

**Problem 1 — `provider_statistic` cannot hold referee statistics.** Two independent blockers, both verified against the live schema:

```sql
ck_provider_statistic__subject_exclusive
  CHECK (subject_kind_code = 'PLAYER' AND player_id IS NOT NULL AND team_id IS NULL
      OR subject_kind_code = 'TEAM'   AND team_id   IS NOT NULL AND player_id IS NULL)

affiliation_team_id  bigint  NOT NULL
```

`subject_kind` is seeded with `TEAM, PLAYER, FIXTURE, COMPETITION_EDITION` — no `OFFICIAL`. And `affiliation_team_id NOT NULL` is structurally wrong for a referee, who has no team affiliation. Relaxing it to nullable would weaken a constraint that is correct for the 100% of current rows.

**Recommendation: a dedicated `football.official_statistic` table.** One new table is cheaper and safer than widening a NOT NULL and a CHECK on an existing relation that already satisfies both.

**Problem 2 — `match_event.event_type_code` is ungoverned.** It carries no foreign key and there is no `football.match_event_type` vocabulary table. Every other coded column in the schema references a governed vocabulary. Before match events are ingested this needs a vocabulary, and it is the prerequisite for deriving penalties, cards-by-minute, or goal timing from our own data.

### 4.3 Penalties

Penalty tendency is available **only** as a provider aggregate. It cannot be derived from PitchTerminal data because (a) `match_event` is not ingested and (b) it has no event-type vocabulary to distinguish a penalty.

More importantly, penalties are rare — roughly 0.25 per match. Twenty matches yield ~5 penalties, and the 95% interval on that rate spans roughly a factor of two. **Below ~50 matches officiated, report the count, never a rate**, and never compare two referees' penalty rates.

### 4.4 What not to build, and why

**Team-specific referee history** — *"this referee has shown Team X five reds."* A referee officiates a given team perhaps one to three times per season. Any pattern at n = 3 is noise, and this framing actively invites narrative fallacy in a way a league-relative rate does not. **Do not build at any sample size the product will realistically reach.**

**Referee home/away bias** — a genuine phenomenon in the published literature, but establishing it per-referee requires controlling for team strength, competition and crowd size across hundreds of matches. We will not have that.

### 4.5 Staying on the right side of the betting line

The brief asks whether referee context can be presented without becoming a betting recommendation. **Yes, and the architecture already encodes the distinction:**

```
module.calibration_mode
  CONTEXTUAL      Characterises an environment; not outcome-scored.
  OUTCOME_SCORED  Measured against a stated outcome dimension.
```

The three inactive FIXTURE modules — `match_context`, `risk_assessment`, `historical_advantage` — are all registered `CONTEXTUAL` with `outcomeDimension: null`. That is precisely the non-betting register.

Three rules keep it there:

1. **Descriptive, not predictive.** *"Averages 4.8 cards across 24 matches in this competition"* — a past observation. *"Expect a high-card game"* — a prediction.
2. **Never attach a number to a threshold.** Any probability of exceeding a count is a betting signal regardless of wording.
3. **Always normalise to competition and state n.** *"4.8 vs a competition average of 3.9, across 24 matches"* is context. A bare *"4.8 cards/match"* is a number begging to be bet on.

**Rule 2 is the bright line.** It is also a hard architectural constraint: any referee module registered `OUTCOME_SCORED` against a `GOAL_TOTAL`-style dimension has crossed it. Registering these as `CONTEXTUAL` is what enforces the policy in the database rather than in a code review.

---

## 5. Advanced Tactical Intelligence Opportunities

### 5.1 Correcting the premise

The brief lists what PitchTerminal "already has." Against V2 as it actually stands:

| Claimed | V2 reality |
|---|---|
| Team season statistics | Schema exists (`provider_statistic`, TEAM) — **not ingested** |
| Recent results | **Available** (`football.result`) |
| Opponent strength | Derivable from `standing` + form features |
| Home/away context | **Available** (`fixture.home_team_id` / `away_team_id`) |
| First-half / second-half goal data | **Available** — `result.home_goals_half_time`, `away_goals_half_time` |
| Shots, corners | `provider_statistic.measures` jsonb — **season-level only, not per fixture, not ingested** |
| Cards | `appearance.yellow_cards` / `red_cards` — **not ingested** |
| Predicted lineups | **Not represented in V2 at all** — no `is_predicted` flag, no relation |
| Formations / predicted formations | `lineup.formation` exists — **not ingested**; predicted formation has no representation |
| Player statistics | `provider_statistic` PLAYER — **not ingested** |
| Readiness calculations | **Registered** — `team.readiness_score`, calculator `team_readiness` |
| Historical match data | **Available** (`fixture` + `result`) |

Much of that list describes **V1**, not V2. V2 is mid-migration and S-4 scoped ingestion to identity, fixtures, results, squads and standings only. Any tactical plan assuming V2 already holds V1's per-fixture detail will be planning against data that is not there.

Two consequences worth stating plainly:

- **Shots and corners are season aggregates, not per-fixture facts.** A "shot profile" is possible; "shots in this fixture's first half" is not, without a new per-fixture statistics ingestion stream.
- **Predicted lineups do not exist in V2.** See §6.3.

### 5.2 What is genuinely available, and its provenance

The strongest tactical foundation is the one already in the schema and already populated: **`football.result` carries half-time and full-time scores.** Second-half goals are `FT − HT` — exact integer arithmetic over observed facts, `OBSERVED` provenance, no estimation.

**This is not the retired `halftime` module.** V1's module 11 read `match_half_time_intelligence`, a table of provider-supplied HT/FT *probabilities* — nine outcome paths, odds-adjacent, retired under S0-6. Observed half-time scorelines are a different thing entirely: a fact we hold, not a probability someone sold us. The retirement of module 11 is **not** a precedent against phase-of-match analysis.

### 5.3 The sample-size problem, which governs everything here

Every conditioning dimension divides the sample:

```
10 matches (a realistic early-season total)
 ÷ 2 home/away        →  5 per side
 ÷ 2 first/second half →  2–3 observations per cell
 ÷ 3 opponent tiers    →  under 1
```

**Tactical matchup analysis at any depth requires a full season, not two months.** The brief's example — *"high first-half scoring vs slow-starting opponent"* — conditions on phase **and** venue **and** implicitly on opponent quality. That is a three-way split. It needs 30+ matches per team to be worth stating, and closer to 60 to be worth trusting.

| Tactical signal | Minimum | Realistic availability |
|---|---|---|
| Unconditioned team scoring/conceding rate | 10 matches | ~Oct 2026 |
| Home/away split | 20 (10 per side) | ~Dec 2026 |
| First/second-half split | 20 | ~Dec 2026 |
| Half × venue | 30+ | ~Feb 2027 |
| Half × venue × opponent tier | **60+** | **not before 2027/28 — do not plan for it** |

### 5.4 Tactical matchup — recommended framing

The brief's goal — *"How do these two teams' tendencies interact?"* — is right, and it is achievable **as a comparison of two independently-computed profiles**, not as a modelled interaction.

Compute each team's profile independently (each with its own n and threshold). Present the comparison only where **both** sides meet threshold. Do not fit an interaction term; there is no sample for one, and a fitted interaction would be the "arbitrary score" the brief prohibits.

*"Home scores 61% of its goals after half-time (n=18). Away concedes 58% of its goals after half-time (n=17)."* Two facts, each carrying its sample, adjacent. The reader draws the inference. That is transparent, evidence-based, and cannot be mistaken for a prediction.

---

## 6. Formation Intelligence

### 6.1 What the schema supports

`football.lineup` already carries `formation text`, uniquely per `(fixture, team)`. `lineup_selection` carries `is_starting`, `position_code`, `shirt_number`. Once ingested this supports:

| Signal | Classification | Minimum |
|---|---|---|
| Formation frequency | DERIVED FROM EXISTING PITCHTERMINAL DATA | 10 matches |
| Formation stability (modal ÷ total) | DERIVED FROM EXISTING PITCHTERMINAL DATA | 10 matches |
| Formation changes (count of transitions) | DERIVED FROM EXISTING PITCHTERMINAL DATA | 10 matches |
| Manager formation preference | DERIVED (needs manager spells) | 10 matches in spell |
| Home/away formation difference | DERIVED FROM EXISTING PITCHTERMINAL DATA | 20 (10/side) |
| Formation vs opponent strength | DERIVED FROM EXISTING PITCHTERMINAL DATA | 30+ |
| **Formation success rate** | **DO NOT BUILD** | §6.2 |

One caveat: `formation` is free text with no governing vocabulary. `4-3-3`, `433` and `4-3-3 attacking` would be three distinct formations. **Normalisation must happen at ingestion**, or every stability metric is wrong. This is the formation equivalent of the `match_event_type` gap in §4.2.

### 6.2 Formation success rate — do not build

The brief already says a formation change does not automatically mean improvement or decline. The stronger statement: **formation-to-outcome attribution is not identifiable from this data.**

Formation choice is not random. Managers pick shape *in response to* opponent, venue, availability and league position — the same variables that drive the result. "4-3-3 wins 60% of the time" mostly measures *when* a manager felt able to play 4-3-3. Correcting for that requires modelling the selection process, which needs far more data than the outcome analysis itself.

Per (team, formation) pairing you would need 50+ matches. A team using three formations across a 38-match season gives ~12 each. **Not viable. Report frequency and stability — both observations — and never attach a result to a shape.**

### 6.3 Predicted lineups

**V2 has no representation for a predicted lineup.** `football.lineup` has no `is_predicted` flag, and S-4 defers lineup ingestion entirely.

The architectural ruling is clean and follows directly from existing V2 principles:

- If **the provider supplies** a predicted lineup, it is a provider-reported fact and belongs in `football` — but it must be distinguishable from a confirmed lineup, either by an `is_predicted` boolean or a `provenance_class_code` of `INFERRED`. The latter is more consistent with existing practice (`player_registration` already carries `provenance_class_code` for exactly this purpose).
- If **we compute** the predicted lineup, it is derived and belongs in `feature` or `module`. It must never be written to `football`. S-4 is explicit: *"S-4 ingests what the provider reported and nothing else. No gap-filling, no interpolation, no defaults standing in for absent facts."*

Connecting availability to expected tactical approach — *"missing key player changes tactical structure"* — is a **module-layer judgement** consuming availability features and formation features. It is not a football-layer fact, and it should not be attempted before formation stability has a real sample.

---

## 7. Tactical Matchup Intelligence — Conceptual Model

The brief asks for a conceptual `Tactical Intelligence` module and for a layer assignment. The nine proposed components map as follows.

| Component | Layer | Why |
|---|---|---|
| Team Tactical Profile | **feature** (TEAM subject) | Deterministic quantities: goal-phase split, formation stability, scoring/conceding rates |
| Opponent Tactical Profile | **feature** (TEAM subject) | Identical calculation, different subject — not a separate feature family |
| Manager Tactical Profile | **feature** (TEAM subject) | Attributed to the team under the manager's spell. See §7.1 |
| Formation Context | **feature** (TEAM subject) | Frequency and stability |
| Matchup Interaction | **module** (FIXTURE subject) | Comparison of two profiles = judgement |
| Tactical Stability | **feature** (TEAM subject) | Variance of a measured quantity |
| Tactical Disruption | **module** (FIXTURE subject) | Requires interpreting availability against structure |
| Tactical Advantages | **module** (FIXTURE subject) | Judgement |
| Tactical Risks | **module** (FIXTURE subject) | Judgement |

Raw manager and referee entities are `football`. Sealing is the existing `snapshot` machinery — no change needed; `snapshot_feature_state` and `snapshot_module_reading` already capture whatever features and readings exist at `T_MINUS_7D`, `T_MINUS_3D`, `T_MINUS_1D` and `KICKOFF`.

### 7.1 A hard constraint on subject kinds

Both `feature.feature_value` and `module.module_reading` carry an identical CHECK admitting exactly four subject kinds:

```sql
ck_feature_value__subject_exclusive
  CHECK ( subject_kind_code = 'TEAM'                AND subject_team_id IS NOT NULL ...
       OR subject_kind_code = 'PLAYER'              AND subject_player_id IS NOT NULL ...
       OR subject_kind_code = 'FIXTURE'             AND subject_fixture_id IS NOT NULL ...
       OR subject_kind_code = 'COMPETITION_EDITION' AND subject_competition_edition_id IS NOT NULL ... )
```

**There is no `MANAGER` and no `OFFICIAL` subject kind, and no typed column for either.** A feature whose subject is a referee cannot be stored.

Two ways forward:

**Option A — extend the subject model.** Add `OFFICIAL`/`MANAGER` to `football.subject_kind`, add `subject_official_id` / `subject_manager_id` to both `feature_value` and `module_reading`, extend both CHECKs. Gives reusable entity-level profiles. Cost: a migration touching two partitioned, append-only, RLS-forced relations that the conformance assertions police — immediately after a Supabase compatibility audit.

**Option B — express everything as FIXTURE- or TEAM-subject. *(Recommended)*** A referee's card environment becomes `fixture.referee_card_environment`, computed per fixture from the assigned official's history. Manager tenure becomes `team.manager_tenure_matches`. **Zero schema change to `feature`, `module` or `snapshot`.**

Option B's real cost: the referee profile is never stored as an entity-level fact, so it is recomputed per fixture and cannot be queried as *"show me this referee."* For a match-page product that cost is negligible. **Take Option B, and revisit Option A only if a standalone referee or manager page is commissioned.**

### 7.2 The modules already exist

Three FIXTURE-subject modules are already registered and inactive, with `calibrationMode: 'CONTEXTUAL'`, `outcomeDimension: null`, and the rationale *"Identity and version only — no evaluation logic exists"*:

| Registered module | Question | Natural fit |
|---|---|---|
| `match_context` | *"What is at stake, and for whom?"* | **Referee context + manager context** |
| `risk_assessment` | *"How much could go wrong here?"* | **Disciplinary risk, tactical disruption** |
| `historical_advantage` | *"Does the head-to-head record say anything?"* | Head-to-head |
| `squad_stability` (TEAM) | — | Adjacent to formation stability — see §14 |

**No new module definitions are required for the first release.** Note the governance constraint recorded in S0-6: `pt_pipeline_module` holds `INSERT, SELECT` on `module_definition` but **no `UPDATE`** — activating a module is a registry change under governance, not a pipeline operation.

---

## 8. Data Already Available in PitchTerminal

| Relation | Exists | Ingested | Supports |
|---|---|---|---|
| `football.fixture` | ✅ | ✅ | venue, home/away, kickoff, competition |
| `football.result` | ✅ | ✅ | **half-time and full-time scores** — phase analysis |
| `football.standing` | ✅ | ✅ | opponent strength |
| `football.team`, `player`, `competition*` | ✅ | ✅ | identity |
| `football.player_registration` / `_availability` / `_valuation` | ✅ | ✅ | squad state, absences |
| `football.venue` | ✅ | ✅ | lat/long, elevation, capacity, surface, timezone |
| `football.official` | ✅ | ❌ | **referee identity** |
| `football.official_assignment` | ✅ | ❌ | **referee per fixture** |
| `football.lineup` (+ `formation`) | ✅ | ❌ | **formation history** |
| `football.lineup_selection` | ✅ | ❌ | starting XI |
| `football.appearance` (+ cards) | ✅ | ❌ | **cards per fixture, minutes** |
| `football.match_event` | ✅ | ❌ | goal/card timing — **no event-type vocabulary** |
| `football.provider_statistic` | ✅ | ❌ | season shots/corners/cards |
| `football.manager` | ❌ | ❌ | **nothing — does not exist** |

**Nine of fourteen relations relevant to this work exist but hold no data.** That is the project.

---

## 9. New API Calls Required

| Intelligence | Required data | Endpoint | In V2? | New call? | Derived? | Storage |
|---|---|---|---|---|---|---|
| Manager identity | manager object | `/api/teams/{id}` **(asserted)** | ❌ | ✅ | ❌ | **new** `football.manager` |
| Manager detail | nationality, DOB, preferred formation | `/api/managers/{id}` **(asserted)** | ❌ | ✅ | ❌ | `football.manager` |
| Manager spells | clubs, dates, W/D/L | `/api/managers/{id}/career-history` **(asserted)** | ❌ | ✅ | ❌ | **new** `football.manager_spell` |
| Manager recent matches | last events | `/api/managers/{id}/events/last/{p}` **(asserted)** | ❌ | ✅ | ❌ | none — join to `fixture` |
| Manager tenure | — | — | — | ❌ | ✅ | `feature` (TEAM) |
| Formation history | per-fixture formation | per-fixture lineup endpoint **(NOT IDENTIFIED)** | ❌ | ✅ | ❌ | `football.lineup` *(exists)* |
| Formation stability | — | — | — | ❌ | ✅ | `feature` (TEAM) |
| Referee identity | name, country | `/api/referee/{id}` **(asserted)** | ❌ | ✅ | ❌ | `football.official` *(exists)* |
| Referee statistics | matches, cards, penalties | `/api/referee/{id}/statistics` **(asserted)** | ❌ | ✅ | ❌ | **new** `football.official_statistic` |
| Referee assignment | referee for fixture | **NOT IDENTIFIED** — not in schedule feed | ❌ | ✅ | ❌ | `football.official_assignment` *(exists)* |
| Referee card environment | — | — | — | ❌ | ✅ | `feature` (FIXTURE) |
| Cards per fixture | per-player cards | per-fixture detail **(NOT IDENTIFIED)** | ❌ | ✅ | ❌ | `football.appearance` *(exists)* |
| Goal/card timing | events with minute | per-fixture detail **(NOT IDENTIFIED)** | ❌ | ✅ | ❌ | `football.match_event` *(exists)* |
| 1H/2H goal split | HT + FT scores | `/schedule/{date}` | ✅ | **❌ none** | ✅ | `feature` (TEAM) |
| Team season stats | shots, corners, cards | season statistics **(NOT IDENTIFIED)** | ❌ | ✅ | ❌ | `football.provider_statistic` *(exists)* |
| Opponent strength | table position | standings path | ✅ | ❌ | ✅ | `feature` |
| **Predicted lineup** | — | **NOT AVAILABLE FROM SPORTSAPI PRO** *(no endpoint identified)* | ❌ | — | — | no representation in V2 |

Four required paths are **NOT IDENTIFIED** in the registry or the brief: referee assignment, per-fixture lineup, per-fixture appearances/events, and season team statistics. **These must be resolved before any implementation plan is credible** — the referee assignment path in particular determines the entire quota model.

**One line in that table matters more than the rest: the 1H/2H goal split needs no new API call at all.**

---

## 10. Historical Backfill Requirements

### 10.1 The off-season problem

The stated window — end of May 2026 → 8 August 2026 — is roughly ten weeks that fall almost entirely within the European close-season. Major European leagues run August to May. Of 57 tracked leagues, those with competitive matches in this window are the summer-calendar minority: MLS, Scandinavian leagues, Brazil, J-League, and cup/qualifying competitions.

**For most tracked leagues this window contains close to zero matches.** Backfilling it will not produce tactical baselines. Match accumulation for European leagues begins with the 2026/27 season in mid-August 2026:

| Date | European matches per team | Supports |
|---|---|---|
| Aug 2026 | 0–2 | nothing |
| Oct 2026 | 8–10 | unconditioned team rates |
| Dec 2026 | 16–19 | home/away split, phase split |
| Feb 2027 | 25–28 | phase × venue |
| May 2027 | 36–38 | full season |

### 10.2 What this means for build order

**Manager and referee intelligence are not subject to this constraint.** Manager career history and referee statistics arrive from the provider as pre-computed aggregates encoding years of history. A referee's card rate over 24 matches is available on the first day the endpoint is called, regardless of how long PitchTerminal has been running.

**Tactical intelligence is entirely subject to it.** No API quota buys history we did not collect.

**This inverts the intuitive ordering.** Build referee first — schema ready, history free, cheapest calls. Manager second. Tactical last, and not before roughly November 2026.

### 10.3 Minimum viable historical dataset

| Data | Minimum | Source | Notes |
|---|---|---|---|
| Manager career history | **all spells** | 1 call/manager | Full history costs the same as partial |
| Manager matches at current club | **≥ 20** | derived from `fixture` | Often satisfied by career-history aggregate |
| Referee statistics | **≥ 20 matches in competition** | 1 call/referee | Provider aggregate — free history |
| Referee matches (our observation) | ≥ 20 | `official_assignment` + `appearance` | Only for our own card derivation |
| Team matches — unconditioned | **≥ 10** | `fixture` + `result` | ~Oct 2026 |
| Team matches — home/away or phase | **≥ 20** | `fixture` + `result` | ~Dec 2026 |
| Team matches — phase × venue | **≥ 30** | `fixture` + `result` | ~Feb 2027 |
| Formation history | **≥ 10** | `lineup` | From first ingestion forward |

**Is two months enough?** For manager and referee: yes, because their history is provider-supplied. For tactical: no — and not because two months is short, but because these particular two months are the off-season.

---

## 11. API Quota Impact

### 11.1 Assumptions (all should be verified)

```
57 tracked leagues                                    [verified: trackedLeagues.ts]
~1,100–1,200 teams        (57 × ~20)                  [ESTIMATE — verify by census]
~1,150 managers           (≈1 per team)               [ESTIMATE]
~1,500 distinct referees  (~25/league)                [ESTIMATE]
~80 fixtures/day average, ~200 peak Saturday          [ESTIMATE]
~30 fixtures/day surfaced in the T-7d…T-0 window      [ESTIMATE — product decision]
Budget: 200 calls/day (2 keys × 100)                  [verified: provider/config.ts]
```

### 11.2 Cost at 200/day (current)

| Task | Calls | Days of *entire* budget |
|---|---|---|
| Manager initial (`/teams/{id}` + `/career-history`) | ~2,300 | **11.5** |
| Referee initial (`/referee/{id}` + `/statistics`) | ~3,000 | **15.0** |
| Referee assignment, all fixtures | ~80/day | **40% ongoing** |
| Referee assignment, surfaced fixtures only | ~30/day | 15% ongoing |
| Manager refresh (monthly) | ~38/day | 19% ongoing |
| Referee stats refresh (monthly) | ~50/day | 25% ongoing |

**Verdict: not viable at full scope.** The initial load alone is ~27 days consuming 100% of the budget, during which no other ingestion runs. Steady-state enrichment would consume 59–99% of the budget before the existing S-4 pipeline gets a single call.

**Viable at 200/day only if scope is narrowed.** A six-league pilot:

| Task | Calls | Days |
|---|---|---|
| ~120 teams / 120 managers initial | ~240 | 1.2 |
| ~150 referees initial | ~300 | 1.5 |
| Assignment, ~10 surfaced fixtures/day | 10/day | 5% |
| Monthly refresh | ~10/day | 5% |

**~3 days initial, ~10% ongoing. This is the recommended first deployment.**

### 11.3 Cost at 7,500/day

| Task | Calls | % of budget |
|---|---|---|
| Full initial load (managers + referees) | ~5,300 | **<1 day, one time** |
| Assignment, all ~80 fixtures/day | 80/day | 1.1% |
| Manager refresh monthly | 38/day | 0.5% |
| Referee stats refresh monthly | 50/day | 0.7% |
| **Total steady state** | **~170/day** | **2.3%** |

**Full 57-league rollout is comfortable — and the constraint moves from quota to sample size.** At 7,500/day the whole enrichment layer costs 2.3% of budget. What it cannot buy is match history: tactical baselines still require the 2026/27 season to be played.

The brief warns against spending 7,500 merely because it exists. The audit agrees, and the reason is concrete: **beyond ~200 calls/day of enrichment there is nothing left worth buying.** The next most expensive thing would be per-fixture detail (lineups, appearances, events) at ~80–200 calls/day, which *is* worth buying because it unlocks formation and card derivation. Even with that, total consumption stays near 400/day — around 5% of a 7,500 allowance.

### 11.4 Strategy comparison

| | A — on demand | B — enrich every fixture | C — independent entities | **D — hybrid** |
|---|---|---|---|---|
| API quota | Low | **Prohibitive** | Low | **Low** |
| Completeness | Poor | Complete | Good | **Good** |
| Historical intelligence | Poor | Good | **Excellent** | **Excellent** |
| Freshness | **Excellent** | Excellent | Moderate | **Good** |
| Operational complexity | Low | Low | Moderate | **Moderate** |
| Replay safety | **Poor** | Good | **Excellent** | **Excellent** |

**Recommendation: D — hybrid, composed as C + A.**

- **C for entities.** Managers and referees are slow-changing. Refresh on a schedule (monthly for statistics, weekly for manager spells during transfer windows). Amortised, predictable, replay-safe.
- **A for per-fixture assignment.** Referee assignment is genuinely per-fixture and cannot be amortised. Fetch only for fixtures the product surfaces in the T-7d…T-0 window.
- **Never B.** On a 200-fixture Saturday, per-fixture enrichment needs 200+ calls for referee assignment alone.

On replay safety: C is strongest because entity refreshes are idempotent upserts against a stable key, whereas A's coverage depends on which fixtures were surfaced on the day — a fact that must itself be recorded for a replay to reproduce.

---

## 12. Database / V2 Architecture Impact

**Three new `football` tables. Zero changes to `feature`, `module` or `snapshot`.**

### 12.1 `football.manager`

1. **Why required** — no manager entity exists anywhere in V2.
2. **Why existing schema cannot represent it** — a manager is not a player (no registration, valuation or appearance) and not an official. No relation carries the concept.
3. **Layer** — `football`. Provider-reported identity.
4. **Written by** — `pt_pipeline_ingestion`.
5. **Read by** — `pt_pipeline_feature`, `pt_pipeline_projection`, `anon`, `authenticated`.
6. **Append-only** — no. Mutable biography, like `football.player`. `updated_at` maintained.
7. **Replay/idempotency** — upsert on `(provider_code, provider_external_id)`, matching `uq_team__provider_external_id`.
8. **API cost** — 1 call/manager, monthly.

### 12.2 `football.manager_spell`

1. **Why required** — carries tenure, the single most useful manager signal, plus career W/D/L per club.
2. **Why existing schema cannot represent it** — nothing links a manager to a team over a period.
3. **Layer** — `football`.
4. **Written by** — `pt_pipeline_ingestion`.
5. **Read by** — feature calculators, projection.
6. **Append-only** — **effectively yes.** A spell's end date is set once when it closes. Prefer the append-only lifecycle class with the migration-015 guard.
7. **Replay/idempotency** — upsert on `(manager_id, team_id, started_on)`.
8. **API cost** — 1 call/manager (career-history), monthly.

**This must be a dated spell relation, not a `team.current_manager_id` column.** A pointer column is a mutable denormalisation that destroys temporal replay: rebuilding a snapshot from March 2026 would attribute it to today's manager. The spell pattern is also exactly the precedent S-4 sets for transfers — *"a transfer is the boundary between two registrations, not an independent fact."* A managerial change is the boundary between two spells. Use `daterange` and `provenance_class_code`, as `player_registration` does.

### 12.3 `football.official_statistic`

1. **Why required** — referee statistics are the core of referee intelligence.
2. **Why existing schema cannot represent it** — `provider_statistic` is blocked twice: `ck_provider_statistic__subject_exclusive` admits only `PLAYER` and `TEAM`, and `affiliation_team_id` is `NOT NULL`, which is meaningless for a referee.
3. **Layer** — `football`. Provider-reported.
4. **Written by** — `pt_pipeline_ingestion`.
5. **Read by** — feature calculators, projection.
6. **Append-only** — no; refreshed per competition edition.
7. **Replay/idempotency** — upsert on `(official_id, competition_edition_id, provider_code)`.
8. **API cost** — 1 call/referee, monthly.

### 12.4 Not required

| Proposed | Verdict |
|---|---|
| Referee entity | **Exists** — `football.official` |
| Referee assignment | **Exists** — `football.official_assignment` |
| Venue enhancements | **Not needed** — lat/long, elevation, capacity, surface, timezone all present |
| Team tactical profile | **No table** — `feature.feature_value`, TEAM subject |
| Manager tactical profile | **No table** — `feature.feature_value`, TEAM subject |
| Referee contextual profile | **No table** — `feature.feature_value`, FIXTURE subject (see §7.1 Option B) |
| Tactical matchup features | **No table** — `module.module_reading`, FIXTURE subject |

### 12.5 Two governance gaps to close first

- **`match_event.event_type_code` has no vocabulary and no FK.** Every other coded column references a governed vocabulary. A `football.match_event_type` table is a prerequisite for card, goal-timing or penalty derivation.
- **`lineup.formation` is unnormalised free text.** `4-3-3` vs `433` vs `4-3-3 attacking` would be three formations. Normalise at ingestion or every stability metric is wrong.

Neither is caused by this work; both block it.

---

## 13. Feature vs Module Classification

| Signal | Layer | Subject | Rationale |
|---|---|---|---|
| `team.manager_tenure_matches` | feature | TEAM | Count. Deterministic. |
| `team.manager_tenure_days` | feature | TEAM | Arithmetic on dates. `OBSERVED`. |
| `team.formation_stability` | feature | TEAM | Modal ÷ total. Deterministic. |
| `team.formation_change_count` | feature | TEAM | Count. |
| `team.second_half_goal_share` | feature | TEAM | `(FT−HT) ÷ FT`. Exact numeric. |
| `team.second_half_concede_share` | feature | TEAM | As above. |
| `team.home_goal_rate` / `away_goal_rate` | feature | TEAM | Deterministic. |
| `team.card_rate` | feature | TEAM | Requires `appearance`. |
| `fixture.referee_card_environment` | feature | FIXTURE | Official's rate vs competition mean. |
| `fixture.referee_penalty_rate` | feature | FIXTURE | Provider aggregate. Sample-gated. |
| `match_context` (manager + referee context) | **module** | FIXTURE | Judgement. Already registered, inactive. |
| `risk_assessment` (disciplinary, disruption) | **module** | FIXTURE | Judgement. Already registered, inactive. |
| Tactical matchup | **module** | FIXTURE | Comparison of two profiles = judgement. |

The dividing line, consistent with S-5: **a feature is a number a calculator produces deterministically from football facts; a module is a statement about what that number means.** *"4.8 cards per match"* is a feature. *"This is a high-card environment relative to this competition"* is a module reading.

All new features are TEAM- or FIXTURE-subject, so **`feature_value` and `module_reading` need no schema change** (§7.1).

---

## 14. Double-Counting and Circularity Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Manager tenure → form → readiness.** `team.readiness_score` already consumes recent form. A manager's effect on results is *already in* form. Adding tenure to readiness counts it twice. | **High** | Keep manager signals **out of readiness**. §11 option A/C. |
| 2 | **Referee cards ↔ team cards.** If a referee officiated the team inside the sample window, those matches appear in both rates, correlating the inputs. | **Medium** | Present as two separate facts. Never multiply into a combined score. |
| 3 | **Formation stability ↔ `team.squad_stability`.** A feature named `squad_stability` and an inactive module of the same name already exist. Two near-identical signals would be indefensible. | **Medium** | Distinguish explicitly: **squad = personnel, formation = shape.** They diverge — same XI, different structure. State the distinction in both feature comments. |
| 4 | **Second-half decline ↔ travel/rest.** `travel_impact` and `rest_advantage` are active modules. A "second-half fade" may be the fatigue those modules already report. | **High** | Do not present as independent. If both fire, the verdict composition layer must reconcile them. |
| 5 | **Tactical profile ↔ form.** Attacking output is already partly `home_form` / `away_form`. | **Medium** | Phase-of-match *distribution* is genuinely new; total output is not. Report shares, not volumes. |
| 6 | **Manager record ↔ team form.** Over one spell at one club these measure the same matches. | **High** | Report manager record **only for prior clubs**, or explicitly as "under this manager." Never as independent evidence alongside team form. |

Risks 1, 4 and 6 are the dangerous ones: all three would produce a module that appears to corroborate another while restating the same underlying matches. `verdict_composition_version` is the correct place to enforce reconciliation, since it already governs how readings combine.

---

## 15. Presentation-Layer Recommendations

The architecture already supports an evidence-bearing contract: `module_reading` carries `headline_text`, `verdict_text`, `strength`, `confidence`, `sample_observation_count`, `sample_meets_threshold` and `module_status_code`; `snapshot_completeness_item` records what was missing at seal time.

**Every statement must carry its sample.** A claim without n is not auditable and cannot be defended.

| Good | Why | Bad | Why |
|---|---|---|---|
| "Appointed 14 Mar 2026. 18 matches in charge; same starting formation in 13 (72%)." | Facts with n | "New manager bounce expected." | Unsupported (§3.3) |
| "Referee: 4.8 cards/match over 24 matches in this competition; competition average 3.9." | Comparative, normalised, n stated | "High-card game likely." | Predictive |
| "Home scores 61% of goals after half-time (n=18). Away concedes 58% after half-time (n=17)." | Two facts, each with n | "Home will dominate the second half." | Predictive |
| "Not enough matches to assess formation stability (6 of 10 required)." | Honest absence | *(silence)* | Reader cannot distinguish "no data" from "nothing notable" |

That last row matters most. `module_status_code = 'INACTIVE'` is defined as *"Insufficient data to speak. Distinct from NEUTRAL."* **Surface INACTIVE explicitly.** The distinction between "we looked and found nothing" and "we could not look" is the difference between a trustworthy product and an opaque one, and V2 already models it.

Do not present: any probability of exceeding a count; any composite tactics score; any formation-outcome claim; any team-specific referee history.

---

## 16. Reliability Requirements

| Signal | Min sample | Recency window | Competition norm. | Home/away norm. | Opponent adj. | Fallback |
|---|---|---|---|---|---|---|
| Manager tenure | 1 | current spell | no | no | no | — |
| Manager formation preference | 10 | current spell | no | no | no | INACTIVE |
| Manager W/D/L (prior clubs) | 20 | all career | **yes** | no | no | INACTIVE |
| Formation stability | 10 | current season | no | no | no | INACTIVE |
| Formation home/away difference | 20 (10/side) | current season | no | **yes** | no | INACTIVE |
| Referee cards/match | 20 in competition | 2 seasons | **yes** | no | no | INACTIVE |
| Referee penalty **count** | 20 | 2 seasons | yes | no | no | count only |
| Referee penalty **rate** | **50** | 2 seasons | **yes** | no | no | INACTIVE below 50 |
| Team card rate | 10 | current season | **yes** | no | **yes** | INACTIVE |
| Team goal-phase share | 10 | current season | no | no | no | INACTIVE |
| Phase × venue | 30 | current season | no | **yes** | no | INACTIVE |
| Tactical matchup | **both** sides ≥ 20 | current season | yes | yes | no | INACTIVE |

Three rules:

1. **`sample_meets_threshold` is stored, not computed at read time** — S-5: *"the threshold in force AT CALCULATION is the one that governed the value."*
2. **Below threshold, emit `INACTIVE`** — do not emit a weak value with low confidence. The brief is explicit that NO SIGNAL beats a misleading one, and the schema already provides the status code.
3. **Provenance ceilings** — manager/referee features derived from provider aggregates are at best `DERIVED`; only tenure-in-days (arithmetic over recorded dates) can claim `OBSERVED`.

---

## 17. Recommended Implementation Order

### Phase 1 — from data already in PitchTerminal *(no new API calls)*

- `team.second_half_goal_share`, `team.second_half_concede_share` — from `result` half-time columns
- `team.home_goal_rate`, `team.away_goal_rate`
- Opponent-strength context from `standing`
- Close the two governance gaps: `match_event_type` vocabulary, formation normalisation rule

**Cost: zero API calls.** Deliverable: phase-of-match tactical profile. **Gated on sample, not on data — meaningful from ~Oct 2026.**

### Phase 2 — referee enrichment *(cheapest new capability, highest value)*

- `football.official_statistic` (new)
- Ingest `official`, `official_assignment` — **resolve the assignment endpoint first**
- `fixture.referee_card_environment`
- Activate `match_context`

**Cost: ~300 calls initial for a 6-league pilot; ~10/day ongoing.** Deliverable: referee context, useful immediately — the provider aggregate supplies the history.

### Phase 3 — manager enrichment

- `football.manager`, `football.manager_spell` (new)
- Ingest lineups → `lineup`, `lineup_selection`
- `team.manager_tenure_matches`, `team.formation_stability`
- Extend `match_context`

**Cost: ~240 calls initial (6-league pilot); ~10/day ongoing, plus lineup ingestion per fixture.**

### Phase 4 — advanced tactical *(only after a season and quota headroom)*

- Per-fixture statistics → `provider_statistic`, `appearance`, `match_event`
- Phase × venue profiles
- Tactical matchup comparison, `risk_assessment`

**Prerequisites: ≥ 20 matches/team (≈Dec 2026), ≥ 1,000 calls/day, `match_event_type` vocabulary shipped.**

---

## 18. What Should NOT Be Built

| # | Item | Reason |
|---|---|---|
| 1 | **New-manager bounce** | Regression to the mean is indistinguishable from a managerial effect without matched controls. Not estimable at any sample PitchTerminal will reach. |
| 2 | **Post-change instability / decline after appointment** | Same. |
| 3 | **Formation success rate** | Formation choice is endogenous to opponent, venue and availability. Needs 50+ per (team, formation); a season gives ~12. |
| 4 | **Team-specific referee history** | n = 1–3 per season. Invites narrative fallacy. |
| 5 | **Referee home/away bias** | Real in the literature, unidentifiable per-referee without controls we lack. |
| 6 | **Composite "tactics score"** | The brief prohibits it and no weighting could be justified. |
| 7 | **Any probability of exceeding a count** | Crosses the betting line regardless of wording. |
| 8 | **Penalty *rate* below 50 matches** | Penalties ≈ 0.25/match; CI spans a factor of two at n = 20. |
| 9 | **`team.current_manager_id` column** | Mutable pointer destroys temporal replay. Use dated spells. |
| 10 | **Manager/referee/tactical as Readiness inputs (initially)** | Double-counting risks 1, 4 and 6 in §14. |
| 11 | **Predicted lineups written to `football`** | Only if provider-supplied and flagged `INFERRED`. Computed predictions belong in feature/module. |

---

## 19. Final Architecture Recommendation

**Proceed — in the order Referee → Manager → Tactical, on a narrowed league set, with three new `football` tables and no changes to `feature`, `module` or `snapshot`.**

Five points carry the recommendation:

1. **The schema is ready.** Referee and formation intelligence need almost nothing new — `official`, `official_assignment`, `lineup.formation`, `appearance` cards and `result` half-time scores all exist. Manager is the only real gap, and it is two tables.

2. **The blocker is ingestion and quota, not design.** Nine of the fourteen relevant relations exist but hold no data. At 200 calls/day a full 57-league enrichment is a ~27-day backfill consuming the entire budget. **Start with six leagues** — ~3 days initial, ~10% ongoing — and expand when quota allows.

3. **Build order is the inverse of the intuitive one.** Manager and referee history arrives pre-aggregated from the provider and is useful on day one. Tactical history must be accumulated by us, and the stated backfill window is the European off-season. Tactical signal for European leagues is a **November–December 2026** proposition regardless of spend.

4. **The non-betting boundary is already architectural.** `calibration_mode = CONTEXTUAL` — *"Characterises an environment; not outcome-scored"* — is the exact register required, and the three inactive FIXTURE modules (`match_context`, `risk_assessment`, `historical_advantage`) are already registered that way. Registering new intelligence as `CONTEXTUAL` with `outcomeDimension: null` enforces the policy in the database rather than in review.

5. **The reliability discipline is already modelled.** `sample_observation_count`, `sample_meets_threshold`, per-definition thresholds, provenance ceilings, and `module_status_code = 'INACTIVE'` (*"Insufficient data to speak. Distinct from NEUTRAL"*) mean "prefer NO SIGNAL" is a schema property, not a convention to be remembered.

**The single largest risk is not technical.** It is building signals that are calculable but void — new-manager bounce, formation success rate, team-specific referee history. Each is a plausible-sounding number that would not survive scrutiny, and each would damage the credibility of the genuinely sound intelligence sitting beside it. §18 exists to be enforced, not consulted.

### Before implementation

1. **Verify the four unidentified endpoints** — referee assignment above all; it determines the quota model.
2. **Confirm whether referee statistics are per-competition** — determines whether competition normalisation is possible, which §16 requires for every referee signal.
3. **Confirm whether manager career-history carries home/away splits.**
4. **Census the actual team count** — the ~1,100–1,200 figure is inferred from league count and drives every number in §11.
5. **Decide the pilot league set** — six leagues is the recommendation.
6. **Ship the `match_event_type` vocabulary and the formation normalisation rule** — both block derivation and neither is caused by this work.
