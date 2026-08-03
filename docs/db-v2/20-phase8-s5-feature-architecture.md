# PitchTerminal V2 — S-5 Feature Calculation Foundation: Architecture

Produced before any S-5 code is written, per the S-5 brief. **No implementation has begun. No calculator has been written.**

**Authority order:** the approved migration set (001–019) over the completed S-1…S-4 documents over V1 behaviour. Three findings below record places where implementation would require a schema change; **none is designed around.**

---

## 0. What S-5 is, and what it is not

S-5 calculates governed features and writes `feature.feature_value` and `feature.feature_lineage`. Nothing else.

It does **not** ingest (S-4), evaluate modules (S-6), compose snapshots (S-7) or calibrate (S-9). That boundary is **structural**: `pt_pipeline_feature` holds no `USAGE` on `module`, `snapshot`, `calibration` or `product`, so a statement touching `module.module_reading` fails with `permission denied for schema module` before reaching a policy.

Every feature is derived exclusively from V2 football reality produced by S-4. **No calculator reads a provider payload.** `football.provider_statistic.measures` — the one permitted structured payload under PD-16 — is not read by S-5 at all, and is not among the relations S-4 populates.

---

## 1. Feature inventory

Seven definitions, five calculators, seven versions at `1.0.0`, all registered by S-3 and **not modifiable by S-5** (§7). All seven have subject kind `TEAM`.

| # | `feature_key` | Calculator | Unit | Scale | Direction | Max provenance | Threshold | Contexts |
|---|---|---|---|---|---|---|---|---|
| 1 | `team.home_form` | `form_backfill` | index | 2 | HIGHER_IS_STRONGER | DERIVED | 5 | ALL, COMPETITION_SCOPED |
| 2 | `team.away_form` | `form_backfill` | index | 2 | HIGHER_IS_STRONGER | DERIVED | 5 | ALL, COMPETITION_SCOPED |
| 3 | `team.readiness_score` | `team_readiness` | index | 2 | HIGHER_IS_STRONGER | DERIVED | 3 | ALL |
| 4 | `team.rest_advantage` | `fixture_load` | days | 1 | HIGHER_IS_STRONGER | **OBSERVED** | 1 | ALL |
| 5 | `team.travel_impact` | `travel_load` | index | 2 | LOWER_IS_STRONGER | DERIVED | 3 | ALL |
| 6 | `team.congestion_index` | `fixture_load` | index | 2 | LOWER_IS_STRONGER | DERIVED | 3 | ALL, COMPETITION_SCOPED |
| 7 | `team.squad_stability` | `squad_continuity` | ratio | 4 | HIGHER_IS_STRONGER | DERIVED | 3 | ALL |

**`max_provenance_class_code` is a ceiling, not a label.** `team.rest_advantage` is the one OBSERVED feature — arithmetic over recorded kickoff times, not an estimate. The other six can never claim better than DERIVED, and a calculator that tried would be writing a stronger claim than its own registry entry permits.

### Expected output

Every value is one row in `feature.feature_value` carrying, all NOT NULL (C-05):

```
as_of                     the moment in the world the value describes (PARTITION KEY)
calculated_at             when the calculation ran — INDEPENDENT of as_of (LC-32)
feature_definition_id     what it is
feature_version_id        which rule produced it
subject_kind_code + subject_team_id      exactly one typed column populated (PD-03, LC-35)
context_kind_code + context_competition_edition_id   edition iff COMPETITION_SCOPED (LC-39)
value                     numeric — EXACT, never binary floating point (PD-06)
provenance_class_code     the weakest class in its lineage (LC-37)
sample_observation_count  how many observations it rests on
sample_meets_threshold    stored, not derived (LC-41)
```

`value` is `numeric` because **calibration compares for equality and replay must not depend on aggregation order** (PD-06). No calculator may use IEEE 754 arithmetic in a path that reaches this column.

`sample_meets_threshold` is stored rather than computed at read time because *"the threshold in force AT CALCULATION is the one that governed the value; a later change to the registry-declared threshold does not retroactively alter whether a historical value met the threshold that applied to it."*

### Lifecycle and append-only behaviour

`feature.feature_value` and `feature.feature_lineage` are **append-only**, enforced at three independent layers:

| Layer | Mechanism |
|---|---|
| Grant | `pt_pipeline_feature` holds `SELECT, INSERT` on schema `feature` — **no UPDATE, no DELETE** |
| Policy | the same modes, applied by `fn_apply_access` from one specification |
| Trigger | `tr_feature_value__append_guard` / `tr_feature_lineage__append_guard` raise on UPDATE or DELETE for every principal without exception (R-19/R-20) |

The only DELETE path in schema `feature` belongs to `pt_retention`, gated on the session marker `pitchterminal.retention_operation` in both the policy and the guard.

---

## 2. Source inventory

**Every source is a Layer 1 relation.** `ck_feature_source__layer_one_only` enforces `source_schema_name = 'football'`, so a declared source cannot be anything else.

| Feature | Relations read | Columns | Vocabularies | Window | Exclusions |
|---|---|---|---|---|---|
| `team.home_form` | `fixture`, `result` | `home_team_id`, `scheduled_kickoff_at`, `lifecycle_state_code`, `home_goals`, `away_goals`, `fixture_partition_on` | `fixture_lifecycle_state` | last **10** completed home fixtures before `as_of` | `lifecycle_state_code <> 'COMPLETED'`; `is_neutral_venue` retained (roles are how the fixture is constituted) |
| `team.away_form` | `fixture`, `result` | as above with `away_team_id` | `fixture_lifecycle_state` | last **10** completed away fixtures | as above |
| `team.rest_advantage` | `fixture` | `home_team_id`, `away_team_id`, `scheduled_kickoff_at`, `lifecycle_state_code` | `fixture_lifecycle_state` | most recent completed fixture before `as_of` | fixtures not COMPLETED cannot establish a rest boundary |
| `team.congestion_index` | `fixture` | as above | `fixture_lifecycle_state` | **28 days** before `as_of` | as above |
| `team.travel_impact` | `fixture`, `venue`, `team` | `venue_id`, `latitude`, `longitude`, `home_venue_id`, `is_neutral_venue` | — | last **5** completed away fixtures | **NULL coordinates yield no value** — LC-05 requires absence, not a substituted distance |
| `team.readiness_score` | `player_availability`, `player_registration`, `team_registration` | `spell_period`, `unavailability_kind_code`, `registration_period`, `team_id` | `unavailability_kind`, `registration_kind` | open spells at `as_of` | closed spells excluded by `upper_inf` / range containment |
| `team.squad_stability` | `player_registration` | `player_id`, `team_id`, `registration_period` | `registration_kind` | **90 days** before `as_of` | see **finding S5-3** — this is not the intended source |

**Nothing reads a provider payload.** Nothing reads `provider_status_raw`; sealing and window decisions branch on `lifecycle_state_code`, the platform's own vocabulary (LC-14).

### Temporal correctness — the rule that governs every window

A value `as_of T` may read **only** football reality that was true at or before `T`. This is not a stylistic preference: calibration measures these values against outcomes, and a feature that saw a fixture's result before the fixture was played measures nothing.

Every source query is therefore bounded by `scheduled_kickoff_at < as_of` (or the equivalent range containment for spells), and no query filters on `calculated_at`.

**This cannot be enforced by the schema** — no constraint can know what a calculator read. It is a named S-5 obligation, tested by the leakage tests of §13.

---

## 3. Dependency graph

### Feature → football relation

```
fixture ──────┬─────────────────────► team.home_form        (+ result)
              ├─────────────────────► team.away_form        (+ result)
              ├─────────────────────► team.rest_advantage
              ├─────────────────────► team.congestion_index
              └──── venue, team ────► team.travel_impact

player_availability ─┬──────────────► team.readiness_score
player_registration ─┤
team_registration ───┘

player_registration ─────────────────► team.squad_stability
```

### Feature → feature

**One edge only.**

```
team.rest_advantage   (ALL_COMPETITIONS) ──┐
                                           ├──► team.readiness_score (ALL_COMPETITIONS)
team.congestion_index (ALL_COMPETITIONS) ──┘
```

`team.readiness_score` is a composite of availability, rest and recent load — the quantity V1 stored as `team_intelligence.readiness_score`. Rest and load already exist as governed features, so readiness **consumes them rather than recomputing them**. Recomputing would create two definitions of "rest" with nothing constraining them to agree, which is the V1 failure mode V2 exists to remove.

`team.travel_impact` is deliberately **not** an input to readiness. V1 held travel separately (`travel_fatigue_score`) and the two were combined at the module layer, not the feature layer. Folding it in here would change what readiness means without a version to record the change.

**The consumed context is part of the declaration, not an assumption inside the calculator** (LC-45). Both inputs are consumed at `ALL_COMPETITIONS`, recorded on `feature_dependency.consumed_context_kind_code`.

### Acyclicity

The graph has one edge and no cycle. `ck_feature_dependency__not_self` refuses a self-edge declaratively; longer cycles are the business of the `feature_dependency_acyclic` check — **which is registered but not implemented (finding S5-2)**.

### Independent vs dependent calculators

| Calculator | Class | Features |
|---|---|---|
| `form_backfill` | independent | `team.home_form`, `team.away_form` |
| `fixture_load` | independent | `team.rest_advantage`, `team.congestion_index` |
| `travel_load` | independent | `team.travel_impact` |
| `squad_continuity` | independent | `team.squad_stability` |
| `team_readiness` | **dependent** | `team.readiness_score` |

Four of five calculators read Layer 1 only. **Only `team_readiness` requires previous outputs**, which is what makes the ordering in §4 two stages rather than one.

---

## 4. Calculation ordering

### Two stages, derived from the graph rather than chosen

```
STAGE 1  (parallelisable — four calculators, no edges between them)
    form_backfill      → team.home_form, team.away_form
    fixture_load       → team.rest_advantage, team.congestion_index
    travel_load        → team.travel_impact
    squad_continuity   → team.squad_stability

STAGE 2  (sequential — requires stage 1 committed)
    team_readiness     → team.readiness_score
```

**Execution order is derived from `feature_dependency`, not hard-coded** (§B.8, §5.12.2). V1's graph — roughly fifty edges — lived entirely in the ordering of calls inside one orchestration process: *"correct, carefully documented, and completely invisible to the model, such that a missing input produced empty values rather than an error."* S-5 reads the declarations and topologically sorts them, so a new dependency changes the order by being declared.

### Transaction boundaries

**One transaction per (calculator, subject batch).** Not one per stage, and not one per value.

- **Per value** would make lineage and its value separately committable, and a value whose lineage failed to commit is a value nobody can reproduce.
- **Per stage** would hold a transaction across the whole subject population — at `10^8`–`10^9` rows the write would be one enormous statement holding locks for its entire duration, and a single bad subject would roll back every other.

Within one transaction, ordering is forced by the foreign key: **values first, then their lineage**, because `feature_lineage.produced_value_id` references `feature_value(id, as_of)`. That ordering is also the cause of finding S5-1.

**Stage 2 must not begin until stage 1 has committed.** Its inputs are read through `feature_value`, and an uncommitted input is invisible to a different connection.

### Parallelism

Stage 1's four calculators are independent and may run concurrently. `withRun` allocates two connections per attributed run (control + work), so four concurrent calculators need eight — above the default pool maximum for `pt_pipeline_feature`. **Decision D-5 (§10) settles the degree of parallelism**; the architecture permits it, the connection budget constrains it.

---

## 5. Duplicate handling

### Business identity includes the version

```sql
UNIQUE (subject_kind_code, subject_team_id, subject_player_id,
        subject_fixture_id, subject_fixture_partition_on,
        subject_competition_edition_id,
        context_kind_code, context_competition_edition_id,
        feature_definition_id, as_of, feature_version_id)
```

This single fact determines every recalculation behaviour:

| Situation | Outcome |
|---|---|
| Recalculate the **same** subject/context/definition/`as_of` under the **same** version | conflicts — `ON CONFLICT DO NOTHING`, reported as **skipped** |
| Recalculate under a **new** version | a **new row**; both coexist, each addressable |
| Calculate a new `as_of` | a new row |

**There is no supersession by overwrite, because there is no UPDATE.** A rule change is a new `feature_version` and therefore a new value; the old value remains, still attributed to the rule that produced it. *"A measured rate spanning two rules describes a system that never existed."*

### Idempotency

Re-running a calculator over the same subjects and the same `as_of` writes **nothing** and reports every row as skipped. That count is diagnostic, not noise — E9.03: *"a calculation that conflicted on every row reports zero written and a high skipped count."*

`calculated_at` differing between runs does **not** break idempotency, because it is not part of the business identity. A value calculated twice keeps the first `calculated_at`, which is correct: it records when the value that exists was produced.

### Conflict handling on append-only relations DISCARDS

`ON CONFLICT DO NOTHING` with a **named target**, never a bare `DO NOTHING`. A bare clause swallows every constraint violation — including the composite version/definition mismatch, the subject-exclusivity check and the context-obligation check, each of which means the calculator is wrong and must be heard.

### Lineage duplicates

`uq_feature_lineage__produced_consumed` makes one edge per (produced, consumed) pair. Re-recording an edge is skipped, same as a value.

---

## 6. Provenance

Every calculated value declares six things. Five are columns; the sixth is the operational attribution.

| Requirement | Where it lives | Enforced by |
|---|---|---|
| Feature definition | `feature_value.feature_definition_id` | FK, plus composite FK binding subject kind (C-09) |
| Feature version | `feature_value.feature_version_id` | composite FK `(version, definition)` — a version belonging to another definition is refused |
| Calculator version | `feature_calculator.implementation_version` | reached through the definition; **see finding S5-4** |
| Calculation timestamp | `feature_value.calculated_at` | NOT NULL, independent of `as_of` |
| Source data period | `feature_value.as_of` + `feature_lineage` | lineage records *instance-level* consumption |
| Pipeline run attribution | `operations.pipeline_job_run` via `withRun` | S-2; ingestion-equivalent posture |

### Provenance class — the weakest input wins

`provenance_class_code` must be **no stronger than the weakest value in the lineage** (LC-37). A value derived from an estimate is itself an estimate.

Two ceilings apply simultaneously, and the calculator must respect both:

1. **The registry ceiling.** `feature_definition.max_provenance_class_code` — `team.rest_advantage` may claim OBSERVED; the other six may not exceed DERIVED.
2. **The lineage ceiling.** `min(strength_rank)` over consumed values. Ranks are `ESTIMATED=1 < INFERRED=2 < DERIVED=3 < OBSERVED=4`.

The declared class is `min(registry ceiling, lineage floor)`.

**This is S-5's responsibility in full, because the database check cannot fire — see finding S5-1.**

### Type-level vs instance-level

- `feature_source` and `feature_dependency` are **type-level**: this rule reads that relation, this rule consumes that rule. Declared once, in advance, by S-5.
- `feature_lineage` is **instance-level**: this value consumed those values. Recorded at calculation.

*"Without it, a stated version tells you which rule ran but not what it ran ON, and a reproduction can differ from the original with nothing revealing why."*

Only `team.readiness_score` produces lineage rows, because it is the only feature consuming other features. **The other six produce none, and that is correct** — a value with no feature inputs has no lineage, and R-53 exempts it explicitly.

### Synthetic values remain prohibited

No gap-filling, no interpolation, no default standing in for an absent fact. **Absence of a feature value is the representation of absence** (PD-07): a team with no completed fixtures in the window gets *no row*, not a zero. V1 stored synthetic weather with no provenance flag and fed it to a paid module; nothing of that shape enters S-5.

---

## 7. Security verification

Read from migration `016_security.sql` and confirmed against the live catalogue.

```sql
('football',  'pt_pipeline_feature', 'S',  NULL, NULL, NULL, NULL),
('feature',   'pt_pipeline_feature', 'SI', NULL, NULL, NULL, NULL),
('operations','pt_pipeline_feature', 'SI', NULL, NULL, NULL, NULL),
```

### Required privileges — present

| Need | Privilege | Status |
|---|---|---|
| Read football reality | `SELECT` on `football` | ✅ |
| Read the registry | `SELECT` on `feature` | ✅ |
| Write values and lineage | `INSERT` on `feature` | ✅ |
| Write its own telemetry | `SELECT, INSERT` on `operations` | ✅ — every stage attributed, no S3-1 equivalent |
| Declare sources and dependencies | `INSERT` on `feature_source`, `feature_dependency` | ✅ (schema-wide `I`) |

### Forbidden privileges — absent

| Must not have | Status |
|---|---|
| `UPDATE` anywhere in `feature` | ✅ absent — including the registry |
| `DELETE` anywhere in `feature` | ✅ absent — `pt_retention` alone, marker-gated |
| Any privilege on `football` beyond `SELECT` | ✅ — S-5 cannot alter reality |
| `USAGE` on `module`, `snapshot`, `calibration`, `product` | ✅ absent — module evaluation is impossible |
| Service role | ✅ never referenced; S-5 authenticates as `pt_pipeline_feature` only |

**No UPDATE where the lifecycle forbids it:** `feature_value` and `feature_lineage` are append-only and `pt_pipeline_feature` holds no UPDATE on any relation in the schema, so the posture is stronger than the lifecycle strictly requires. `pt_platform_admin` holds `UPDATE` on exactly five governed-configuration relations and explicitly **not** on `feature_value` or `feature_lineage`.

---

## 8. Constraint verification

| Guarantee | Preserved by | Verified in §13 by |
|---|---|---|
| Append-only lifecycle | grant + policy + trigger; no UPDATE/DELETE path in S-5 | privilege tests, lifecycle tests, mutation test |
| Audit visibility | per-relation `operations.write_record`; zero-write runs legible | database tests |
| Version attribution | `feature_version_id` NOT NULL, in the business identity, composite-FK bound to its definition | database tests |
| Governed vocabularies | `subject_kind`, `context_kind`, `provenance_class` referenced by FK; **S-5 introduces none** | declaration tests |
| Feature provenance | weakest-input rule computed by the calculator; lineage recorded per value | declaration + database tests |
| Telemetry | `withRun` under `pt_pipeline_feature`; run, job run, write record, failure | database tests |
| Idempotency | version-in-identity + `ON CONFLICT DO NOTHING` on a named target | database tests |
| Scale conformance | rounding to `feature_definition.value_scale` before write | declaration + database tests |
| Temporal correctness | every source query bounded by `as_of` | leakage tests |

**No database rule is duplicated in TypeScript.** S-5 does not re-check foreign keys, subject exclusivity, context obligation, sample non-negativity or the version/definition binding — PostgreSQL owns all of them, and a violation must surface as a named constraint failure. The two things S-5 *does* enforce in application code — value scale and provenance class — are enforced there **because the schema explicitly delegates them** (§5.9.9 names `value_scale` a residual enforcement point) or because the intended check cannot fire (S5-1).

---

## 9. Scope

### Implemented in S-5

Seven features, five calculators, both write relations, the type-level declarations S-3 deferred:

- `feature.feature_value` — every value for the seven definitions
- `feature.feature_lineage` — the readiness edges
- `feature.feature_source` — **populated for the first time.** S-3 deferred it: *"Not knowable until the calculators exist, which is S-5."* The calculators now exist, so their Layer 1 sources are declarable.
- `feature.feature_dependency` — likewise, one edge

### Deferred to S-6

| Item | Why |
|---|---|
| `module.module_reading`, `module_evidence`, `module_evidence_item` | Module evaluation. S-5 holds no USAGE on `module` |
| `module.model`, `model_output_type` | No model exists; S-3 left the vocabulary unseeded |
| Promotion of the four inactive modules | Requires evaluation logic, which is S-6's |
| `football.position_profile` | Its governed meaning is defined by module logic that arrives in S-6 |

### Deferred to S-7

| Item | Why |
|---|---|
| `snapshot.match_snapshot` and the ten sealed relations | Snapshot composition. S-5 holds no USAGE on `snapshot` |
| `snapshot.snapshot_feature_state` | Cites feature values compositely; S-7 owns sealing |
| Verdict and consensus composition | S-3 registered the version identities; the rules are S-6/S-7 |

### Deferred within S-5's own layer, and why

| Item | Why |
|---|---|
| PLAYER, FIXTURE and COMPETITION_EDITION subject features | S-3 registered seven definitions, all TEAM. Adding a definition is a governed registry change, not something a calculation phase does |
| `COMPETITION_SCOPED` values for the three features that permit it | See **decision D-3** — needs `competition_edition` resolution per fixture, which multiplies volume |
| Historical backfill | See **decision D-4**. The write path is the same; the volume decision is separate |
| Features sourcing `appearance`, `lineup`, `match_event`, `provider_statistic` | **S-4 did not ingest these relations.** No feature may source a relation with no rows |

---

## 10. Decisions required before implementation

Six. Each changes what gets built.

### D-1 — Temporal granularity of `as_of` *(open — architecture owner)*

The single largest determinant of storage. Document 08 §5.24.1 puts `feature_value` at `10^8`–`10^9` rows *"subject to the temporal granularity decision"*, and total storage between **150 GB and 1 TB**, because lineage cannot be thinned independently (LC-47).

| Option | Rows/team/feature/season | Consequence |
|---|---|---|
| **Per fixture** | ~38 | Smallest. A value exists only where a fixture needs one — which is what snapshots consume |
| **Daily** | ~365 | Ten times larger. Supports "what was readiness on any date" directly |
| **Per snapshot point** | ~152 (4 × 38) | Aligns exactly with `football.snapshot_point`; every sealed snapshot finds its value already present |

**Recommendation: per snapshot point.** S-7 seals at T-7d, T-3d, T-1d and kickoff, and `snapshot_feature_state` cites a feature value compositely. Any other granularity forces S-7 either to interpolate — forbidden — or to find no value at the moment it must seal.

### D-2 — Rest advantage is a team feature with a fixture-relative meaning *(open)*

`team.rest_advantage` is *"days of recovery since the previous fixture"*, which is only defined relative to an upcoming fixture. Its subject kind is TEAM, so the fixture cannot be the subject. `as_of` therefore carries the whole temporal meaning: the value at `as_of` is days since the team's last completed fixture before `as_of`. This is consistent with D-1 and requires no registry change — **but it must be stated, or two calculators will interpret it differently.**

### D-3 — Which contexts to calculate *(open)*

Three features declare `COMPETITION_SCOPED` as well as `ALL_COMPETITIONS`. Calculating both multiplies volume by roughly the number of competitions a team plays in.

**Recommendation: `ALL_COMPETITIONS` only in S-5.** The competition-scoped bindings remain registered and valid; nothing is retracted. Adding them later is additive and needs no schema change.

### D-4 — Backfill posture *(open)*

Same shape as S-4's D-3. Calculation is date-range driven regardless, so replay is the same code path. **Recommendation: forward-only by default**, with historical replay as an explicit, bounded invocation — and with the honest caveat that S-4 ingests forward-only, so there is no deep football reality to calculate over yet.

### D-5 — Parallelism and the connection budget *(open)*

Stage 1's four calculators are independent. Each attributed run holds two connections, so full parallelism needs eight against a pool maximum currently below that.

**Recommendation: sequential within a stage for S-5.** The pool maxima are *"deliberately small (20 across all seven)"* and R-05 registers slot exhaustion as a High risk. Sequential execution is correct, measurable, and can be parallelised later once §13's timing evidence exists. Raising a pool maximum to chase throughput before measuring is how slot exhaustion arrives.

### D-6 — What to do about the three findings *(open — see §12)*

S5-1 and S5-2 leave provenance and scale unenforced by the database. S-5 can compute both correctly, but **detection of drift does not currently exist**. The owner's call is whether S-5 ships an application-side verification command as the interim control, or whether a migration is scheduled.

---

## 11. Proposed implementation layout

No code. Structure only, mirroring S-4.

```
src/v2/feature/
  index.ts                    public surface
  README.md

  registry/
    load.ts                   reads feature_definition, version, calculator,
                              context bindings from the DATABASE — never a
                              hard-coded copy. The registry is data (S-3 owns it)
    declare.ts                writes feature_source and feature_dependency —
                              the type-level declarations S-3 deferred
    order.ts                  topological sort over feature_dependency.
                              EXECUTION ORDER IS DERIVED, not written down

  calculators/
    types.ts                  the Calculator contract: given subjects, a context
                              and an as_of, return candidate values + consumed
                              value references. PURE — no database writes
    formBackfill.ts           team.home_form, team.away_form
    fixtureLoad.ts            team.rest_advantage, team.congestion_index
    travelLoad.ts             team.travel_impact
    squadContinuity.ts        team.squad_stability
    teamReadiness.ts          team.readiness_score — the only consumer

  read/
    fixtures.ts               windowed reads of fixture + result, bounded by as_of
    availability.ts           open spells and registrations at as_of
    venues.ts                 coordinates, with NULL propagated not substituted
    featureValues.ts          reads prior feature values for stage 2

  write/
    values.ts                 INSERT ... ON CONFLICT (<named target>) DO NOTHING
    lineage.ts                edges, written after values in the same transaction
    scale.ts                  rounding to feature_definition.value_scale
    provenance.ts             min(registry ceiling, weakest lineage input)

  pipeline.ts                 stage orchestration, attribution, telemetry
  verify.ts                   the interim controls for S5-1/S5-2 — see D-6
  cli.ts                      npm run feature:v2

  __tests__/
    feature.test.ts           declaration + database + leakage + lifecycle
```

**Calculators are pure.** They receive already-read inputs and return candidate values; they do not open connections, issue writes or record telemetry. That is what makes them testable without a database and what keeps the append-only write path in exactly one place.

**The registry is read from the database, never restated in source.** S-3 owns those rows. A hard-coded copy would drift, and the copy would be the one the calculator believed.

---

## 12. Findings

Three, all discovered by reading and executing the approved migration set. **None is designed around.**

### S5-1 — The A.12 provenance propagation trigger cannot fire *(material)*

`tr_feature_value__provenance_propagation` is an `AFTER INSERT … FOR EACH STATEMENT` trigger over a transition table, joined against `feature_lineage`:

```sql
FROM new_values n
JOIN feature.feature_lineage l
  ON l.produced_value_id = n.id AND l.produced_value_as_of = n.as_of
```

**Lineage for a new value cannot exist when the trigger runs.** `fk_feature_lineage__produced_value` references `feature_value(id, as_of)`, so a lineage row can only be written *after* its produced value is committed to the table. At `AFTER INSERT` time the inner join therefore always matches zero rows, and R-53's exemption for values with no lineage — *"the inner join provides this naturally"* — swallows every value rather than only the genuinely lineage-free ones.

**Verified by execution**, not by reading. Inserting an `ESTIMATED` value, then an `OBSERVED` value, then a lineage edge from the second to the first:

```
INSERT 0 1      -- weak (ESTIMATED) value
INSERT 0 1      -- strong (OBSERVED) value  ← trigger fired, saw no lineage
INSERT 0 1      -- lineage: OBSERVED consumes ESTIMATED
VIOLATION PERSISTS: value 2 claims OBSERVED but consumes ESTIMATED
```

The trigger *is* installed on the partitioned parent and *is* statement-level — so the platform doubt recorded in `015_triggers.sql` (*"statement-level triggers with transition tables on PARTITIONED relations must be verified against the target PostgreSQL 16 build"*) **is resolved in the affirmative**. The defect is not platform support; it is write ordering.

**Effect:** LC-37 has no database enforcement. A calculator declaring a provenance class stronger than its inputs is accepted silently.

**S-5's response:** compute `min(registry ceiling, weakest lineage input)` in `write/provenance.ts` and test it, including by mutation. **No schema change is proposed here** — the fix belongs to the architecture owner, and the plausible shapes (a constraint trigger deferred to commit, or moving the check into the lineage insert) are schema decisions.

### S5-2 — Twelve of fourteen registered quality checks have no implementation *(material)*

`operations.quality_check` holds 14 rows. Only two have executable functions — `fn_assert_access_correspondence` and `fn_assert_security_posture`, both covering security posture. The remaining twelve are **declarations of intent with no code behind them**, verified by enumerating `pg_proc` in schema `operations`.

Four bear directly on S-5:

| Check | Severity | Consequence for S-5 |
|---|---|---|
| `feature_scale_conformance` | HIGH | `value_scale` is a *named residual enforcement point* — *"cannot be enforced on the value column by CHECK … Enforced by the calculating process and verified by the scale conformance assertion."* The verifier does not exist, so scale rests **entirely** on the calculator |
| `provenance_propagation` | HIGH | The compensating control for S5-1. It does not exist either, so the guarantee has **neither** prevention nor detection |
| `feature_dependency_acyclic` | **BLOCKING** | LC-44 is *"validated, not triggered"*. S-5 is the phase that first populates `feature_dependency`, and the validation is absent |
| `orphan_absence` | HIGH | No detection of values referencing a retired definition |

**S-5's response:** `verify.ts` implements these four as application-side checks over the catalogue and the data, exposed as a CLI verb and run in the test suite. This is **not** duplicating a database rule — there is no database rule to duplicate; it is supplying the residual enforcement the design explicitly assigns outside the schema. Recorded here so the gap is closed knowingly rather than assumed handled.

### S5-3 — `team.squad_stability` has no ingested source *(scope)*

S-3 registered it as *"continuity of selection across recent fixtures — how settled a side is. V1: derived from `team_squads_snapshot`."*

**Selection** continuity requires `football.lineup_selection` or `football.appearance`. **S-4 ingested neither** — both are per-fixture detail endpoints, deferred as a separate quota class.

The only available substitute is `player_registration`, which measures **squad membership** stability: how much the roster changed. That is a different quantity from how much the *starting eleven* changed, and a team with a stable roster and heavy rotation would score high on one and low on the other.

**Three options, none of which S-5 may take unilaterally:**

1. Calculate membership stability and **change the definition's `meaning`** — requires `UPDATE` on `feature_definition`, which only `pt_platform_admin` holds. A governed registry change, not an S-5 action.
2. **Defer `team.squad_stability`** to a phase after lineup ingestion. Six features ship; the definition stays registered and simply has no values, which the freshness view reports honestly.
3. Extend S-4 to ingest lineups first.

**Recommendation: option 2.** Calculating a different quantity under a registered name is precisely the drift V2's registry exists to prevent, and an absent feature is visible in `operations.v_freshness` where a wrong one is not.

### S5-4 — Calculator implementation version is not carried on the value *(minor, no action)*

`feature_calculator.implementation_version` is *"distinct from the feature versions this calculator produces. A calculator may be reimplemented without the rule changing, and the two must be separable."*

`feature_value` carries `feature_version_id` but **not** the calculator's implementation version. Two values produced by different implementations of the same rule are indistinguishable on the row; the implementation version is reachable only through the definition, which reflects *current* state rather than state at calculation.

**Assessed as correct by design, not a defect.** If the implementation changed the numbers, the rule changed and a new `feature_version` was required; if it did not, the values are equivalent by definition. Recorded because the brief requires calculator version in the provenance set, and the honest answer is that it is recoverable by joining the registry, not stored per value.

**S-5 has no UPDATE on `feature_calculator`**, so it cannot bump `implementation_version` itself — that is `pt_platform_admin`'s, through the governed configuration path.

---

## 13. Verification plan

Five classes, following the S-3/S-4 pattern.

### Declaration tests — no database

- every registered feature has a calculator in the implementation, and every calculator claims only registered features
- topological order over the declared graph is stable, deterministic and cycle-free
- scale rounding: 2-scale features round to 2 decimals; a 4-scale ratio keeps 4
- provenance resolution: `min(ceiling, weakest input)` across all 16 ceiling/input pairings
- **no floating-point path reaches a value** — arithmetic asserted exact
- window arithmetic is UTC and inclusive/exclusive exactly as declared

### Database tests

- values land with the correct subject, context, version and provenance
- lineage edges are written for readiness and **for nothing else**
- re-running writes **0 rows** and reports every row as skipped
- `feature_source` rows are Layer 1 only (`ck_feature_source__layer_one_only` refuses anything else)
- `write_record` is written per relation, and a zero-write run is legible
- a team with no completed fixtures in the window produces **no row** — absence, not zero

### Privilege tests — against the live catalogue, not the register

- `pt_pipeline_feature` holds **no UPDATE** anywhere in `feature`
- **no DELETE** anywhere in `feature`
- **no USAGE** on `module`, `snapshot`, `calibration`, `product`
- **only SELECT** on `football`
- it **can** write its own telemetry

### Lifecycle tests

- an `UPDATE` on `feature_value` is **refused** — grant, policy and guard
- a `DELETE` on `feature_value` is **refused** without the retention marker
- a value under a new version coexists with its predecessor rather than replacing it

### Leakage tests — S-5's own hardest guarantee

- a value `as_of T` computed over a fixture set containing a fixture kicking off after `T` **must not** include it: seed fixtures either side of `T`, assert the value equals the one computed from the earlier set alone
- readiness at `T` consumes only inputs with `as_of <= T` — which `ck_feature_lineage__consumed_not_after_produced` also enforces, so the test proves the calculator agrees with the constraint rather than discovering it

### Mutation tests

Guarantees whose loss nothing else would reveal:

| Mutation | Must fail |
|---|---|
| Remove the provenance floor (always claim the registry ceiling) | the provenance test — **the only control that exists, given S5-1** |
| Remove scale rounding | the scale conformance test — **the only control, given S5-2** |
| Widen a window past `as_of` | the leakage test |
| Replace `ON CONFLICT DO NOTHING` with a bare `DO NOTHING` | a constraint-visibility test |

---

## 14. Constraint compliance

| Constraint | How S-5 complies |
|---|---|
| No implementation code in this phase | This document contains none |
| No migration modified | None touched |
| No schema change | Three findings recorded instead; none designed around |
| No permission change | The role's grants are read and verified, never altered |
| No new vocabulary | S-5 references `subject_kind`, `context_kind`, `provenance_class` by FK and introduces nothing |
| Append-only not weakened | No UPDATE or DELETE path exists in the design; three layers verified |
| Database rules not duplicated in TypeScript | Only scale and provenance are enforced in code, and only because the schema delegates or cannot enforce them |
| No module output calculated | No USAGE on `module` |
| No snapshot composed | No USAGE on `snapshot` |
| No provider data ingested | Only `football` relations read, `SELECT` only |
| No service role | The role is `pt_pipeline_feature` throughout |

---

## 15. Standing after S-5

**Once implemented — not now** — S-6 will receive:

- **`feature.feature_value` populated** for six or seven TEAM features (per S5-3) at `ALL_COMPETITIONS`, at the granularity D-1 settles, each carrying subject, context, version, provenance and sample sufficiency.
- **`feature.feature_lineage`** recording instance-level consumption for the readiness edge, making reproduction checkable rather than nominal.
- **`feature.feature_source` and `feature.feature_dependency` populated** — the type-level declarations that make freshness derivable and execution order data rather than convention.
- **`operations.v_freshness` meaningful for the first time.** It joins `feature_definition` to `feature_value.calculated_at`; with no values it reports every feature as never calculated. After S-5 it reports genuine staleness per context.
- **A read path for module inputs.** `pt_pipeline_module` holds `SELECT` on `feature`, so S-6 reads values without S-5 exposing anything.

**Nothing beyond S-5 is implemented, and S-5 itself is not implemented — this document is architecture only.**

What S-6 will **not** receive: PLAYER, FIXTURE or COMPETITION_EDITION features; competition-scoped values (D-3); any feature sourcing lineups, appearances, match events or provider statistics; and `team.squad_stability` if S5-3 resolves as recommended.
