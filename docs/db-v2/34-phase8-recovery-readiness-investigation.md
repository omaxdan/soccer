# PitchTerminal V2 — Recovery Readiness: Feasibility Investigation

**Investigation only. Nothing implemented, no migration written, no code or database modified.** Companion to [document 33](./33-phase8-competition-context-investigation.md), which covers competition context and rotation. Read-only catalogue queries throughout.

---

## 1. Executive verdict

### The three findings that shape everything

**Finding R-1 — Recovery Readiness is a measured rate with a sample, and V2 already models that shape completely.**

`calibration.calibration_result` is, column for column, the thing §24 and §27 describe:

| Column | What §24/§27 calls it |
|---|---|
| `band_code` | the comparable-situation class — `HOME_LOSS → NEXT_AWAY` |
| `observation_count` | "18 cases" |
| `hit_count` | "unbeaten in 7" |
| `hit_rate` | 7/18 |
| `baseline_rate` | **the league/context baseline §27 asks for** |
| `lift` | team rate against that baseline |
| `interval_low` / `interval_high` | the confidence interval |
| `interval_suppressed` | suppression when the interval would mislead |
| `sample_gate_id` / `meets_sample_gate` | **the sample-size safeguard §27 makes mandatory** |

Plus `calibration.sample_gate` (`minimum_observation_count`, `applies_to_pooled`, an `effective_period`, and a NOT NULL `rationale`) and `calibration.measurement_population` (which fixtures a measurement covered, with a `completeness_threshold` and an `includes_reconstructed` flag).

**The statistical discipline §27 asks me to propose already exists as schema.** It does not need designing.

**Finding R-2 — but the calibration schema is not team-scoped, and Recovery Readiness must be.**

`calibration_series` is keyed by `module_version_id`, `band_code`, `outcome_dimension_code`, `context_kind_code`, `context_competition_id`, `snapshot_point_code`. **There is no team, player or subject column.** Calibration measures *how reliable the platform's own bands are* — a property of the model, not of a club.

§25 requires the opposite: "Does **THIS** team historically respond poorly after **THIS** type of previous result?"

Encoding the team into `band_code` would be a category error — a band is a class, not a subject — and would multiply the series count by the size of the estate.

> **The right home is `feature.feature_value`, and it needs no schema change.** It is subject-scoped (`subject_team_id`), carries `sample_observation_count` and `sample_meets_threshold` computed against the definition's `meaningful_sample_threshold`, is versioned, provenance-classed, append-only and partitioned by `as_of`. A team's historical response rate is a TEAM-subject feature with a sample count. That is exactly what the relation is for.

**Finding R-3 — the data does not exist, and cannot for roughly two years.**

Every component except the historical response is computable from `football.fixture` + `football.result`, both of which the schedule ingestion already populates. The historical response is not, and the reason is arithmetic rather than architectural:

```
§24's own example needs 18 comparable cases.
A club plays ~50 fixtures a season.
"HOME LOSS → NEXT MATCH AWAY" occurs perhaps 4–7 times a season.
Segmented further by opponent strength (§24) — perhaps 1–3 times a season.

18 unsegmented cases  ≈  3–4 seasons of history.
18 segmented cases    ≈  6+ seasons, or never for a strong club.
```

`football.fixture` is partitioned from 2015, so the schema can hold it. The database holds **none of it**: V2 has never been populated, and the planned backfill window (2026-05-31 → today) is ten weeks of close season. Document 30 §8 and document 32's Finding 3 reach the same conclusion from different directions.

### Capability matrix

| # | Capability | Verdict | Blocking reason |
|---|---|---|---|
| 1 | Previous result — W/D/L, goals, GD | **READY** | `football.result` populated by ingestion |
| 2 | Previous venue — home / away / neutral | **READY** | `fixture.home_team_id` / `away_team_id` / `is_neutral_venue` |
| 3 | Previous competition | **PARTIALLY READY** | Identity yes; **kind** no — doc 33 §6.3 |
| 4 | Expected-goals / performance metrics | **DATA GAP** | **No xG, no rating, no performance column anywhere in V2.** Verified by catalogue scan |
| 5 | Opponent strength | **ARCHITECTURE GAP** | **No strength model exists in V2.** Verified: no `strength`, `rating` or `elo` column in any design schema |
| 6 | Result severity | **ARCHITECTURE GAP** | Derived from #5, which does not exist |
| 7 | Next competitive fixture | **READY** | `fixture` holds future fixtures with kickoff, edition, venue |
| 8 | Historical next-match response | **DATA GAP — years deep** | R-3. Needs 3–6 seasons; V2 holds none |
| 9 | Segmentation by venue / opponent / competition | **DATA GAP** | Multiplies #8's requirement |
| 10 | Sample-size safeguards | **READY** | `meaningful_sample_threshold` + `sample_meets_threshold`, already computed not asserted |
| 11 | League / context baseline for shrinkage | **PARTIALLY READY** | Computable from the same fixtures; nowhere to *store* it as a team feature without a second definition |
| 12 | Current next-match context — venue, opponent, rest, travel | **PARTIALLY READY** | Rest and travel exist as features; opponent strength does not (#5) |
| 13 | Orthogonality to Recent Form | **READY by construction** | §7 |
| 14 | Coexistence with competition / rotation pressure | **READY** | `CROSS_COMPETITION_DERIVED` already exists; three separate features, three separate readings |
| 15 | Explainable output with evidence | **READY in design, gated on S-6** | `module_reading` + `module_evidence_item`, but see §8.3 |
| 16 | **Recovery Readiness end to end** | **DATA GAP** | #5, #8 |

### Verdict

> ## PARTIALLY READY — IMPLEMENT AFTER DATA GAP
>
> **Nothing here is an API limitation.** The provider already supplies everything the signal needs, through the one endpoint V2 already calls. This is unusual and worth saying plainly: unlike rotation intelligence (doc 33), Recovery Readiness has **no unanswered provider question**. Fixtures and results are enough.
>
> Two things stand between here and delivery, in order:
>
> 1. **A team strength model.** V2 has none, and severity, opponent context and the current-match adjustment all rest on it. This is the *architectural* prerequisite and it is buildable today from `football.result` alone.
> 2. **Three to six seasons of fixture history.** This is the *data* prerequisite, it is the binding one, and it is bought with provider calls — nothing else.

---

## 2. Current data flow, and where this signal would attach

```
/schedule/{date}                        ← already ingested, unfiltered
   │
   ├─► football.fixture      home_team_id · away_team_id · is_neutral_venue
   │                         scheduled_kickoff_at · competition_edition_id
   │                         competition_stage_id · lifecycle_state_code
   └─► football.result       home_goals · away_goals · *_half_time
                             *_extra_time · *_penalties · confirmed_at
   │
   ▼  everything below is NEW, and all of it is Layer 2
   │
   ├─ team.baseline_strength        ← DOES NOT EXIST. The prerequisite
   ├─ team.previous_result_severity ← consumes baseline_strength
   ├─ team.recovery_response_rate   ← the historical rate, per band
   └─ team.recovery_readiness       ← composite
   │
   ▼
module.module_reading  (S-6, not implemented)
```

**Every new component is a `feature`, none is a `module`.** That matters: features are subject-scoped, versioned, sampled and append-only; modules are readings *about* a fixture. A historical response rate is a measured property of a team, so it belongs in Layer 2. Only the final `SUPPORTS / NEUTRAL / CONTRADICTS` judgement is Layer 3.

---

## 3. Previous-match context — what exists (§20, §21)

### Fully available today

```sql
-- The previous competitive fixture for a team, with venue and result.
-- This is the same shape readCompletedFixtures already uses in S-5.
SELECT f.id, f.scheduled_kickoff_at, f.competition_edition_id,
       CASE WHEN f.is_neutral_venue THEN 'NEUTRAL'
            WHEN f.home_team_id = :team THEN 'HOME' ELSE 'AWAY' END AS venue,
       CASE WHEN f.home_team_id = :team THEN f.away_team_id
            ELSE f.home_team_id END                                AS opponent_id,
       CASE WHEN f.home_team_id = :team THEN r.home_goals ELSE r.away_goals END AS scored,
       CASE WHEN f.home_team_id = :team THEN r.away_goals ELSE r.home_goals END AS conceded
  FROM football.fixture f
  JOIN football.result  r ON r.fixture_id = f.id
                         AND r.fixture_partition_on = f.fixture_partition_on
 WHERE (f.home_team_id = :team OR f.away_team_id = :team)
   AND f.lifecycle_state_code = 'COMPLETED'
   AND f.scheduled_kickoff_at < :as_of
 ORDER BY f.scheduled_kickoff_at DESC, f.id DESC
 LIMIT 1;
```

W/D/L, goal difference, venue, opponent and competition all fall out of that. `is_neutral_venue` gives the third venue state §21 asks for, and V2 treats stated home/away roles as how a fixture is *constituted* rather than a geographic claim — so a neutral-venue cup tie keeps its roles and is still flagged.

Half-time, extra-time and penalty columns are present, which matters for §33's cup cases: a tie decided on penalties after extra time is not a "loss" in the same sense as a 90-minute defeat, and `result` carries the distinction.

### Not available

**Expected goals, ratings, or any performance-versus-result measure.** A catalogue scan for `expected|xg|rating|strength|elo` across all seven schemas returns only `player_availability.expected_return_on`, `provenance_class.strength_rank` (a provenance ordering) and `module_reading.strength` (the module output slot). **There is no performance metric in V2.**

§20's "expected goals / performance metrics if available" is therefore **not available**, and §23's "expected performance versus actual result" cannot be a severity factor.

---

## 4. Opponent strength (§22) — the architectural prerequisite

### There is no existing framework to reuse

The brief says "investigate whether the existing team-strength / opponent-strength framework can be reused". **There is none in V2.**

| Where it might have been | State |
|---|---|
| `feature.feature_definition` | 7 definitions: `home_form`, `away_form`, `rest_advantage`, `congestion_index`, `travel_impact`, `readiness_score`, `squad_stability`. **No strength** |
| `football.standing` | Modelled with `position`, `points`, `goals_for`, `goals_against`, per `TOTAL` / `HOME` / `AWAY` variant — **empty, no runner** (doc 28 E-3) |
| `football.provider_statistic` | Modelled — **empty, no writer at all** |
| V1 `team_strength_ratings`, `team_strength_dashboard` | V1 only, `public` schema, not carried across |

**So opponent strength must be built, and it can only be built from `football.result`.** That is not a limitation in practice — points and goal difference over a window is the substance of every strength baseline — but it must be stated rather than assumed.

`football.standing` would be the better source when it exists: it carries the `HOME` and `AWAY` variants V1 lacked, which is precisely what a venue-conditioned strength model wants. Populating it is doc 29 blocker **B-1**.

### Avoiding the circularity §22 warns about

Two different circularities, only one of which is real:

**Not circular — a feature consuming another feature.** `team.previous_result_severity` consuming `team.baseline_strength` is a `feature_dependency` edge. V2 derives execution order by topological sort and validates acyclicity (`feature_dependency_acyclic`, registered **BLOCKING**). A DAG is the architecture working.

**Genuinely circular — opponent-adjusted strength.** If A's strength depends on results against B, and B's strength depends on results against A, that is a fixed-point problem. Three ways out, in increasing cost:

| Approach | Circular? | Note |
|---|---|---|
| **Unadjusted baseline** — points per game and goal difference over a window | **No** | Recommended for a first version. Honest, cheap, explainable |
| **Single-pass adjustment** — adjust each team once against opponents' *unadjusted* baselines | **No** | A fixed depth, not a recursion. V1's `opponent_adjusted_form` was this shape |
| **Iterated (Elo-like)** | **Yes, by construction** | Converges, but is a stateful model, not a windowed feature. Would need `module.model` / `model_version`, which exist but are unseeded |

**Recommendation: unadjusted first.** §22's own framing — "season statistics establish baseline, recent results measure form, opponent strength contextualises" — is satisfied by a windowed points-and-goal-difference baseline, and it cannot be circular.

**Strict temporal bound, in either case.** The baseline must be computed over fixtures completed strictly before the `as_of` of the value consuming it. S-5 already enforces this discipline — `readCompletedFixtures` filters `scheduled_kickoff_at < as_of` and `deriveAsOf` is arithmetic with no clock read — and any strength feature must inherit it. Otherwise every historical response measurement is contaminated by lookahead, which is exactly the flaw document 15 §3.9 records in V1's own backtests (`provenance: "unreplayed"`).

---

## 5. Result severity (§23)

Computable **once #4 exists**, from facts that are all present:

| Factor | Source | Available |
|---|---|---|
| W / D / L | `result` vs venue | ✅ |
| Goal difference | `result` | ✅ |
| Heaviness | `abs(goal difference)` | ✅ |
| Venue | `fixture` | ✅ |
| Opponent strength | **new feature** | ⛔ prerequisite |
| Upset — result against strength expectation | derived from the above | ⛔ via strength |
| Competition context | `competition_edition`, but **no kind** | ⚠️ doc 33 §6.3 |
| Expected vs actual performance | — | ⛔ **no xG in V2** |

**Do not hard-code the bands.** §23 says so and the architecture agrees: the S-5 experience (documents 22 and 23) was that a formula asserted in code and a meaning asserted in the registry can disagree, and the registry wins. Severity thresholds belong in a decision record before implementation, and the definition's `meaningful_sample_threshold` governs whether a severity claim may be made at all.

**A note on the brief's own example.** §23 suggests a home loss to a much stronger opponent is *lower* severity. That is a modelling assumption, not a fact, and it is worth testing rather than encoding: it presumes severity means "how unexpected", where it could equally mean "how damaging". Both are defensible; only one can be the definition. This is a governance decision.

---

## 6. Historical next-match response (§24, §25) — the core

### It is computable, and it is a self-join over data V2 already models

```
For each completed fixture F of team T:
    band  := (venue(F), outcome(F), severity(F), venue(next(F)))
    next  := the next completed competitive fixture of T after F
    hit   := next produced an unbeaten result

response_rate(T, band) := count(hit) / count(*)
```

Everything in that derivation exists in `fixture` + `result`, except `severity`, which needs #4.

### Why the sample requirement is the binding constraint

| Segmentation | Occurrences per season | Seasons for n = 18 |
|---|---|---|
| Home loss → next away | ~4–7 | **3–4** |
| + opponent strength band (3 bands) | ~1–3 | **6–12** |
| + rest-days band | < 1 | **effectively never** |
| + competition kind | < 1 | **effectively never** |

**§24's full segmentation is not reachable for any club.** A strong club that loses at home four times a season, split three ways by opponent strength, will not accumulate 18 comparable cases in a decade.

This is not a reason to abandon the signal. It is a reason to **fix the segmentation depth in advance and let the sample gate decide what may be said**, rather than segmenting as far as the data allows and discovering the depth per team — which would make one team's "Weak" and another's "Weak" mean different things.

### Team-specific, per §25 — and where it lives

`feature.feature_value` at TEAM subject:

```
feature_key                team.recovery_response_rate
subject_kind_code          TEAM
subject_team_id            the club
context_kind_code          ALL_COMPETITIONS  (or COMPETITION_SCOPED per doc 33 Phase A)
value                      the rate, numeric, exact
sample_observation_count   the case count
sample_meets_threshold     count >= meaningful_sample_threshold  ← computed, not asserted
provenance_class_code      DERIVED  (calculated from observed facts)
as_of                      derived from the snapshot point, arithmetically
```

**One problem this does not solve: the band.** `feature_value` has no band column — a value is one number for one subject at one instant. Three options:

| Option | Assessment |
|---|---|
| **One feature definition per band** — `team.recovery_response_home_loss_next_away`, … | **Recommended.** Explicit, registry-governed, each with its own threshold. Costs a handful of definitions. Registry rows are cheap; silent ambiguity is not |
| Encode the band in `context_competition_edition_id` | **No.** That column means competition scope and is constrained to it |
| Add a band column to `feature_value` | **No.** A schema change to the highest-volume relation in the design, for a case one more definition covers |

**The number of definitions is the reason to fix segmentation depth.** Four venue-outcome combinations × three severity bands × two next-venues = 24 definitions. Without severity it is 8. Eight is reasonable; 24 is a registry nobody will maintain.

### Shrinkage toward a baseline (§27)

The brief asks for a statistically conservative approach and says to propose one after inspecting V2's methodology. V2's methodology is already visible in three places:

1. **`sample_meets_threshold`**, computed as `count >= meaningful_sample_threshold` — a hard gate, per definition.
2. **`calibration_result.baseline_rate` and `lift`** — the *shape* of comparing a measured rate to a baseline is already modelled.
3. **V1's `Baseline` type**, carried into the module registry: `rate` with a mandatory `sample`, `pooled` suppressing the interval when the n is not the band's own, and a `provenance` marker separating measured from unreplayed.

Consistent with all three:

```
reported_rate = w · team_rate + (1 − w) · baseline_rate,     w = n / (n + k)
```

an empirical-Bayes shrinkage where `k` is a governed constant. At `n = 3` and `k = 15`, a team that lost all three shows `0.17 · 0.00 + 0.83 · baseline` — close to the baseline, which is the §27 requirement exactly. As `n` grows the team's own rate dominates.

**Two things this must not do:**

- **It must not hide the gate.** Shrinkage and `sample_meets_threshold` are complementary: shrinkage stops a small sample dominating, the gate stops a small sample *speaking*. Below the gate, emit the value with `sample_meets_threshold = false` and let the consumer refuse to render a claim — exactly as V1's `<Rate />` did.
- **It must not be applied twice.** If the value stored is already shrunk, a module must not shrink it again. Store one or the other, declare which, and put it in the definition's meaning.

**What the baseline should be** is a governance question, not an implementation one: the same band across the team's league, or across all tracked teams? The former is more comparable and thinner; the latter is more stable and less relevant. `calibration.measurement_population` exists to record precisely this choice (`competition_id`, `fixture_period`, `definition_text`), and it should be recorded there even if the measurement lives in `feature_value`.

---

## 7. Orthogonality (§28) — this one is structurally sound

The concern is well founded and the answer is clean: **Recovery Readiness never reads the previous result's contribution to form. It reads the team's historical response to a class of situation.**

| Existing signal | What it is | Overlap |
|---|---|---|
| `team.home_form` / `away_form` | Points quality over 5- and 10-fixture windows | **The previous loss is in this window** |
| `team.recovery_response_rate` | Rate over *historical* comparable situations, in past seasons | **The previous loss is not in this** |

The previous match appears in both, but as different objects: in form it is an **observation**; in Recovery Readiness it is a **selector** that chooses which historical population to read. The value comes from other fixtures entirely — mostly from other seasons.

**The double-count risk is real in one specific place**, and it is worth naming: if severity is computed from opponent strength, and opponent strength is derived from results, and form is derived from results, then a team on a bad run has both a low form value and a high severity value from the same underlying fixtures. That is correlation, not double counting — but a module combining them must not treat them as independent evidence. This is exactly what `module_evidence_item.contribution_weight` exists for, and it is a decision for the S-6 decision record.

**Provable, not asserted.** `feature_source` and `feature_dependency` declare each feature's inputs, S-5 already proves the declarations against the calculators by test, and the acceptance criterion in §11 makes disjointness checkable rather than claimed.

---

## 8. Combining with competition and rotation context (§29, §30, §31)

### Three signals, three readings, never one number

§29 is right, and V2's vocabulary already enforces it. Three separate features at two different context kinds:

| Signal | Feature | Context kind | Reads |
|---|---|---|---|
| **Recovery Readiness** | `team.recovery_readiness` | `ALL_COMPETITIONS` | previous fixture + historical response |
| **Competition Pressure** | `team.rotation_pressure` | `CROSS_COMPETITION_DERIVED` | forward calendar + competition kind |
| **Rotation Intelligence** | `team.rotation_observed` | `CROSS_COMPETITION_DERIVED` | `appearance` minutes (doc 33) |

`CROSS_COMPETITION_DERIVED`'s seeded meaning names the second and third outright: *"Explicitly about the interaction between competitions. Congestion, active competition count, rotation pressure."* Recovery Readiness is **not** cross-competition — it is about the subject's own trajectory — so `ALL_COMPETITIONS` is correct for it.

At Layer 3 these become three `module_reading` rows, each with its own `module_status_code`, `confidence`, `sample_observation_count` and `module_evidence`. §29's requirement — that the system says *"Recovery Readiness: Moderate. Competition Pressure: High. Rotation Pressure: High"* rather than hiding it in one number — is the architecture's default, not an addition.

### The proposed model (§30) against what exists

| Component | State |
|---|---|
| Baseline Strength | **does not exist** — §4 |
| Recent Form | `team.home_form`, `team.away_form` — exist, but see doc 33 finding CC-1 |
| Home/Away Context | positional + `is_neutral_venue` — exists |
| Opponent Strength | **does not exist** — §4 |
| Rest & Congestion | `team.rest_advantage`, `team.congestion_index` — **exist. Do not duplicate** |
| Travel | `team.travel_impact` — **exists. Do not duplicate** |
| Squad Availability | `player_availability` modelled, **never populated** |
| Competition Pressure | doc 33 Phase F |
| Rotation Intelligence | doc 33 Phases D–G, gated on the provider question |
| **Recovery Readiness** | this document |

**Four of the eleven already exist and must be consumed, not rebuilt.** That is the strongest argument for the feature-dependency model: `team.recovery_readiness` declaring an edge to `team.rest_advantage` is a *declaration*, checkable, and it makes re-derivation impossible.

### Output and explainability (§31)

The labels `Strong / Neutral / Caution / Weak` are a product decision. What the architecture requires is stricter and more useful: **every reading must be reconstructible from stored evidence.**

`module_evidence_item.cited_feature_value_id` is NOT NULL with a foreign key to `feature.feature_value` — so an evidence citation *is* a pointer to the exact value that produced it. §31's worked example maps almost line for line:

| §31 evidence line | Where it comes from |
|---|---|
| "Previous match: Home loss" | the selector — `fixture` + `result` |
| "Previous opponent: Similar strength" | cited `team.baseline_strength` value for the opponent |
| "Next match: Away" | `fixture` |
| "Historical comparable situations: 14" | `feature_value.sample_observation_count` |
| "Unbeaten rate in comparable next matches: 29%" | `feature_value.value` |
| "Current rest: 4 days" | cited `team.rest_advantage` value |

**One gap, and it is doc 33's finding S0-8 again.** Only feature values may be cited. "Previous match: Home loss" is a *fixture*, not a feature value, so it cannot be an evidence item as the schema stands. Either the selector is itself materialised as a feature (a value encoding the band), or it lives in `headline_text` / `verdict_text` as narrative rather than as citable evidence. **The first is cleaner and needs no schema change** — and it is another argument for one definition per band.

---

## 9. The ten investigation questions (§32)

| # | Question | Answer |
|---|---|---|
| 1 | Reconstruct previous-match context? | **Yes.** `fixture` + `result`, §3. Same pattern S-5 already uses |
| 2 | Identify previous venue? | **Yes.** Positional, plus `is_neutral_venue` for the third state |
| 3 | Previous opponent strength using the existing strength model? | **No — there is no existing strength model.** It must be built, from `football.result`. §4 |
| 4 | Result severity without circularity? | **Yes, with an unadjusted or single-pass baseline.** Iterated adjustment would be circular. §4 |
| 5 | Identify the next competitive fixture? | **Yes.** `fixture` holds future fixtures; the calendar is already unfiltered |
| 6 | Calculate historical next-match responses? | **Computable, but no data.** 3–6 seasons required; V2 holds none. §6 |
| 7 | Segment by venue and opponent strength? | **Computable; not reachable at depth.** Full segmentation gives < 1 case/season. §6 |
| 8 | Apply sample-size safeguards? | **Yes, and the mechanism already exists** — `meaningful_sample_threshold` / `sample_meets_threshold`, plus `calibration.sample_gate`'s shape. §6 |
| 9 | Combine with competition and rotation context? | **Yes.** Three features, two context kinds, three readings. §8 |
| 10 | Without contaminating league-only statistics? | **Yes — but the contamination already exists.** Doc 33 finding CC-1: `ALL_COMPETITIONS` is hard-coded and `readCompletedFixtures` has no competition predicate. Fix that first |

---

## 10. Test cases (§33)

**None can be run today: `football.fixture` and `football.result` are empty, and no V2 database has been populated.** What follows is what each test would need and what it would prove.

| Test | Needs beyond fixtures + results | Runnable after |
|---|---|---|
| **A** Home loss → away next | nothing | **backfill of 1 season** — band identifiable, rate not yet meaningful |
| **B** Home loss → home next | nothing | as A |
| **C** Away loss → away next | nothing | as A |
| **D** Home loss to strong opponent → away next | **`team.baseline_strength`** | strength feature + 3–4 seasons |
| **E** Home loss to weaker opponent → away next | as D | as D |
| **F** Previous loss + cup within 2–4 days | **`competition_kind`** (doc 33 Phase B) | Phase B + 1 season |
| **G** Previous loss + no upcoming cup | as F — it is F's control | as F |
| **H** Previous loss + confirmed rotation | **`football.appearance`** — doc 33, gated on the provider question | possibly never |

### The honest reading of this table

- **A, B, C need nothing but history.** They are the cheapest real test of the whole idea, and they are also the weakest signal, because unsegmented.
- **D and E are the first tests with product value**, and they gate on the strength model — which is the one prerequisite entirely within our control.
- **F and G** need competition kind, a small piece of governance.
- **H** needs per-fixture minutes, which may not be obtainable at all (doc 33 §4.3).

**Recommended first acceptance test, once one season exists:**

```sql
-- Every (previous fixture, next fixture) pair for one team, with bands.
-- Proves the SELECTOR works before any rate is claimed.
WITH ordered AS (
  SELECT f.id, f.scheduled_kickoff_at,
         CASE WHEN f.home_team_id = :team THEN 'HOME' ELSE 'AWAY' END AS venue,
         CASE WHEN f.home_team_id = :team THEN r.home_goals ELSE r.away_goals END AS scored,
         CASE WHEN f.home_team_id = :team THEN r.away_goals ELSE r.home_goals END AS conceded,
         lead(CASE WHEN f.home_team_id = :team THEN 'HOME' ELSE 'AWAY' END)
           OVER (ORDER BY f.scheduled_kickoff_at, f.id) AS next_venue
    FROM football.fixture f
    JOIN football.result r ON r.fixture_id = f.id
                          AND r.fixture_partition_on = f.fixture_partition_on
   WHERE (f.home_team_id = :team OR f.away_team_id = :team)
     AND f.lifecycle_state_code = 'COMPLETED'
)
SELECT venue,
       CASE WHEN scored > conceded THEN 'WIN'
            WHEN scored = conceded THEN 'DRAW' ELSE 'LOSS' END AS outcome,
       next_venue, count(*) AS cases
  FROM ordered WHERE next_venue IS NOT NULL
 GROUP BY 1,2,3 ORDER BY cases DESC;
```

**Pass condition: every band has a case count, and the counts sum to the fixture count minus one.** If that holds, the selector is correct and only the sample is missing. It is worth running the day the backfill lands, precisely because it will show how thin the bands are.

---

## 11. Final verdict (§34)

### A. Implementable immediately — no new data, no schema change

| Item | Note |
|---|---|
| **Fix doc 33 finding CC-1** | Bind form to `COMPETITION_SCOPED` and filter by edition. **Prerequisite for every league-only claim here** |
| **`team.baseline_strength`** | Windowed points-per-game and goal difference from `football.result`. Unadjusted, strictly bounded by `as_of`. Needs a registry definition and a calculator — no schema change |
| **The band selector** | The `lead()` query above. Pure derivation |
| **A decision record** | Severity bands, segmentation depth, baseline population, shrinkage constant `k`. **Before code**, per the S-5 lesson |

### B. Requires additional ingestion

| Item | Cost |
|---|---|
| **3–6 seasons of fixture history** | One provider call per date. 2 seasons ≈ 730 calls ≈ 4 days of budget. **The single highest-value purchase available** |
| **`football.standing`** | Doc 29 B-1. Gives `HOME` / `AWAY` variants, a better strength source than results alone |
| **`football.appearance`** | Doc 33, gated on the provider question. Needed only for Test H |

### C. Requires schema changes

| Item | Size |
|---|---|
| **`football.competition_kind` + nullable FK** | Small. Doc 33 §8.1. Needed for competition-conditioned severity |
| **New `feature_definition` rows per band** | **Registry rows, not DDL.** 8 for the recommended depth |
| **Nothing else** | Recovery Readiness needs **no new relation and no new column** |

That last line is the strongest result in this document. Compare document 33, where four relations have no writer and manager has no relation at all.

### D. Requires new derived intelligence

`team.baseline_strength` → `team.previous_result_severity` → `team.recovery_response_rate` (per band) → `team.recovery_readiness`, declared as `feature_dependency` edges so the execution order is derived and acyclicity is validated. Then one Layer 3 module, gated on S-6.

### E. Should NOT be implemented — the evidence would be too weak

| Item | Why |
|---|---|
| **Segmentation beyond (previous venue × outcome × next venue × 3 severity bands)** | Under one case per season. A rate on n ≤ 2 is not evidence at any confidence |
| **Rest-days or competition-kind segmentation of the historical response** | Same, worse |
| **Any Recovery Readiness claim before ~3 seasons of history** | The rate would be almost entirely the baseline. Emit the value with `sample_meets_threshold = false` and render nothing |
| **Manager-conditioned Recovery Readiness** | No manager entity exists (doc 33 §7.2, doc 32 Finding 1). A tendency spanning a managerial change measures two rules |
| **Iterated opponent-adjusted strength** | Circular by construction, and a stateful model rather than a windowed feature. Revisit only if `module.model` / `model_version` are brought into use |
| **Expected-goals-based severity** | **No xG exists in V2.** Do not substitute a proxy and call it performance |
| **A single combined Team Preparedness number** | §29 forbids it and the architecture agrees. Three signals, three readings, each with its own evidence |

---

## 12. Recommended sequence

```
  1. Fix CC-1                       small · no new data · unblocks every league-only claim
  2. Backfill 2–3 seasons           ~1,100 calls · the binding constraint on everything below
  3. Decision record                severity bands · segmentation depth · baseline · k
  4. team.baseline_strength         from football.result · unadjusted · as_of-bounded
  5. Band selector + counts         run the §10 query · SEE HOW THIN THE BANDS ARE
        ↓ gate: proceed only if the counts justify it
  6. team.recovery_response_rate    one definition per band · shrunk toward baseline
  7. team.recovery_readiness        composite · declares edges to rest/travel/congestion
  8. Layer 3 module                 gated on S-6, which cannot yet be specified
```

**Step 5 is a decision gate, not a milestone.** Run the selector against real backfilled history and look at the case counts before building anything on top. If a typical club has six cases of the most common band after two seasons, that is the answer to whether this signal can carry product weight — and it is much cheaper to learn there than after four features are built.

---

## Constraint compliance

| Rule | Observed |
|---|---|
| Do not implement | Nothing written. No migration, no code, no schema change |
| Do not create a circular strength calculation | §4 separates the two circularity classes and recommends the non-circular one |
| Do not duplicate Recent Form | §7 — the previous match is an observation in one and a selector in the other |
| Do not let tiny samples dominate | §6 — shrinkage toward a baseline **plus** the existing hard gate, and they are complementary |
| Keep signals separate | §8 — three features at two context kinds, three readings, never one number |
| Do not contaminate league-only statistics | §9 Q10 — and CC-1 records that this is **already** happening |
| Do not hard-code classifications | §5 — severity thresholds go in a decision record first |
| Use only existing architecture | Every proposal is an existing relation, vocabulary, context kind or provenance class. Two registry additions, one small schema addition shared with doc 33 |
| Evidence-based, no speculation | Every "does not exist" is backed by a catalogue query; every sample claim by arithmetic |
