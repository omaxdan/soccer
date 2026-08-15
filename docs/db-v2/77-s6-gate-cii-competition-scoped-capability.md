# Phase 8 — S-6 Gate C-ii: COMPETITION_SCOPED Calculation Capability

## Architecture design only · nothing implemented

| | |
|---|---|
| Prior | Gate C-i `571c87e` · entry contract `fadd53c` |
| **Decision** | **C-ii: IMPLEMENTATION DESIGN APPROVED** — the schema already supports COMPETITION_SCOPED; the capability is a **purely additive S-5 code path**, reusable, with **no migration** |
| **Subject grain** | `(team_id, competition_edition_id, as_of)` |
| **Context** | `COMPETITION_SCOPED` + `context_competition_edition_id` (existing vocabulary; existing columns) |
| **ALL_COMPETITIONS path** | **untouched** — the scoped path is a separate, additive pass |
| **Migration** | **NONE** |

Nothing implemented. No calculator, read, orchestration, write, registry, module,
migration, dependency, or readiness/travel change. `home_away_performance` is
treated strictly as the *first consumer* of this capability, never wired into it.

---

## 1. Existing S-5 architecture (verified in source)

- **Orchestration** (`pipeline.ts`): loads registry + plan, `selectBatches`,
  declares sources/deps, then per stage per calculator per batch runs `runBatch`
  in one transaction (values → lineage), with `write_record` telemetry.
- **Subject enumeration** (`driver/eligibility.ts`): reads fixtures in a kickoff
  range, derives `as_of = kickoff − offset` per snapshot point, de-duplicates into
  **`(as_of, team)` batches**. Subject is the team, not the fixture.
- **as_of** (`deriveAsOf`): truncated to whole seconds; strict `< as_of` bound
  applied in both the read SQL and `before()`.
- **Context** (`calculators/types.ts`): `CALCULATION_CONTEXT_KIND =
  'ALL_COMPETITIONS'` — a single hardcoded constant. `SubjectMoment = {teamId,
  asOf}`; `CalculationContext` carries `fixturesByTeam` keyed by team only.
- **Read** (`read/fixtures.ts`): `readCompletedFixtures` = 10-per-side rank ∪
  28-day congestion window; `readFixturesForEligibility` returns
  `{fixtureId, kickoffAt, homeTeamId, awayTeamId}` (**no edition**).
- **Write** (`write/values.ts`): hardcodes `CALCULATION_CONTEXT_KIND` and writes
  `context_competition_edition_id = NULL` (a literal `NULL` in the INSERT…SELECT);
  correlates `RETURNING id` by `(feature_definition_id, subject_team_id, as_of)`.
- **Provenance** (`write/provenance.ts`): `min(ceiling, weakest input)`;
  non-composite passes its own count (D-5c-i, R-53).

## 2. Every existing COMPETITION_SCOPED declaration

- **Vocabulary** (`002`): `context_kind` includes `COMPETITION_SCOPED`
  (`requires_edition = true`, "venue performance").
- **Registry bindings**: `home_form`, `away_form`, `congestion_index` declare
  **both** `ALL_COMPETITIONS` and `COMPETITION_SCOPED` in
  `feature_definition_context_kind` (`featureRegistry.ts`).
- **Schema**: `feature_value.context_competition_edition_id`;
  `ck_feature_value__context_edition_conditional` (edition non-null **iff**
  COMPETITION_SCOPED); `uq_feature_value__…` includes `context_kind_code` and
  `context_competition_edition_id` and is **`NULLS NOT DISTINCT`** (migration 020);
  `fk_feature_value__context_edition`; `fk_feature_value__definition_context_kind`
  (a value's (definition, context_kind) must be a registered binding).

**Status: governed and schema-complete, but never executed.** `types.ts` states the
scoped bindings "remain registered and valid … adding those values later is
additive," and the writer supplies `NULL`. So this gate **activates an existing
governed concept**; it invents nothing. Migration 020's comment is decisive: the
`NULLS NOT DISTINCT` clause was added *"corrected before S-6 rather than after"* —
the idempotency substrate for scoped values was deliberately pre-built.

## 3. Subject grain

**`(team_id, competition_edition_id, as_of)`.** Verified sufficient:

- `competition_edition` = one competition **and** one season (a single edition),
  so `competition_edition_id` alone identifies competition + season — **no separate
  season dimension** (Gate C-i §4).
- **Team must be explicit** — it is the subject (`subject_team_id`).
- **as_of** belongs to the value's temporal identity, not the context — same as the
  ALL_COMPETITIONS path.
- **A team legitimately has multiple editions at one as_of** (league + cup). Each is
  a distinct scoped subject and a distinct `feature_value` row, kept apart by
  `context_competition_edition_id` in the `NULLS NOT DISTINCT` unique key.
- **Scope identity on the value**: `context_kind_code = 'COMPETITION_SCOPED'` +
  `context_competition_edition_id = <edition>`.

## 4. Subject enumeration (the core of this gate)

Current enumeration produces `(as_of, team)` from generating fixtures. The scoped
extension is minimal and **reusable**:

- **`readFixturesForEligibility` also returns `competition_edition_id`** (additive;
  existing callers ignore the extra field).
- **A scoped enumeration** yields `(as_of, team, edition)` where the edition is the
  **generating fixture's own `competition_edition_id`**. This is exactly right: the
  snapshot point is "before this upcoming fixture," and a scoped feature describes
  the team *within the edition of that fixture*. A league fixture generates a
  league-edition subject; a cup fixture a cup-edition subject.
- **Reusability guard**: the edition comes from the fixture, never from a feature
  key. `home_away_performance` is not named anywhere in the enumerator. Any future
  COMPETITION_SCOPED feature enumerates identically.
- De-duplication is by `(as_of, team, edition)` (the ALL_COMP path stays
  `(as_of, team)`), preserving determinism.

**Do not fold this into `selectBatches`'s return shape** in a way that changes the
ALL_COMP batches. Prefer a sibling `selectScopedBatches` (or a second output list)
so the existing batches are byte-identical.

## 5. Read contract

A **new, separate, reusable** primitive — `readEditionVenueResults` — NOT a change
to `readCompletedFixtures`:

```
readEditionVenueResults(tx, subjects: {teamId, editionId}[], asOf)
  → per (teamId, editionId): completed fixtures with a result, on each venue side,
    scheduled_kickoff_at < asOf, scoped to that competition_edition_id
```

Requirements: team; competition edition; venue side (from `home_team_id` /
`away_team_id`); `football.result` join; strict `kickoff < as_of`;
`lifecycle_state_code = 'COMPLETED'`; deterministic order
(`team, edition, kickoff DESC, fixture_id DESC`); **no 28-day window, no rank-10
cap**. It is edition-cumulative by construction. Keeping it separate means the
bounded preparedness reads (`readCompletedFixtures`) are provably unaffected.

## 6. as_of semantics

**Strict `kickoff < as_of`**, identical to the existing path — a value must not see
the fixture it is calculated for (at the KICKOFF snapshot point `as_of` equals that
fixture's kickoff). Boundary behaviour to test: **exactly at as_of → excluded; 1 ms
before → included; 1 ms after → excluded.** No future fixture enters a historical
snapshot.

## 7. Context identity

- **context kind**: `COMPETITION_SCOPED` (no new kind).
- **edition**: `context_competition_edition_id = <edition>` (non-null, satisfying
  `ck_feature_value__context_edition_conditional`).
- **No separate context row/table**: context in V2 is **columns on `feature_value`**,
  not a relation — so there is nothing to seed and nothing to migrate. Uniqueness
  and idempotency come from the `NULLS NOT DISTINCT` unique key (§2).
- **Idempotency**: a re-run of the same `(team, edition, as_of, definition,
  version)` conflicts and `DO NOTHING`s, exactly as ALL_COMP does.

## 8. Write semantics

`write/values.ts` is parametrized to take the context from the subject instead of
the hardcoded constant:

- write `context_kind_code` from the batch's context (ALL_COMPETITIONS or
  COMPETITION_SCOPED) instead of the literal constant;
- write `context_competition_edition_id = <edition>` for scoped, `NULL` for
  ALL_COMP (replacing the literal `NULL`);
- **fix the `RETURNING` correlation** to include `context_kind_code` and
  `context_competition_edition_id` (using `IS NOT DISTINCT FROM` for the nullable
  edition), because `(definition, team, as_of)` is **not unique** once a team has
  multiple editions at one as_of.

**Collision safety**: ALL_COMPETITIONS (`edition NULL`) and COMPETITION_SCOPED
(`edition = X`) for the same team/definition/as_of/version are distinct rows under
the unique key — they cannot collide. Two scoped rows for different editions are
distinct; same-edition re-runs collide and are idempotent.

**ALL_COMP invariance**: for the ALL_COMP path the parameters resolve to
`kind = ALL_COMPETITIONS`, `edition = NULL`, and the augmented correlation still
matches exactly one row per `(definition, team, as_of)` — so ALL_COMP output is
byte-identical. This must be asserted by a regression test (§14 M).

## 9. Preserving ALL_COMPETITIONS behaviour (hard constraint)

The scoped path is a **separate pass**. It does **not** touch: the 28-day window,
the rank-10 rule, existing ALL_COMP values, existing dependencies, provenance, or
any existing calculator. `selectBatches`, `readCompletedFixtures`, and the ALL_COMP
calculators run unchanged. The only shared file is `write/values.ts`, changed
additively with an explicit invariance test.

## 10. Provenance & observation counts

Unchanged. Scoped values use the same `write/provenance.ts`. For a non-composite
scoped feature, `sample_observation_count` is its own count (D-5c-i / R-53) — for
`home_win_rate`/`away_win_rate`, the **side's completed matches in the edition
before as_of**. No new observation-count semantics; no `meaningful_sample_threshold`
invented (it remains a feature-registration decision, out of this gate).

## 11. Performance & data volume

The edition-cumulative read scans a team's fixtures within **one edition** before
as_of — bounded by an edition-season (~19–38 per side). Existing indexes suffice:
`ix_fixture__home_team_kickoff (home_team_id, scheduled_kickoff_at)`,
`ix_fixture__away_team_kickoff`, and `(competition_edition_id, scheduled_kickoff_at)`
cover the team-side + kickoff scan with edition as a cheap residual filter. **No new
index is required.** (A composite `(home_team_id, competition_edition_id,
scheduled_kickoff_at)` would trim it further at very large scale; **surfaced, not
created** — it is not needed for correctness or for realistic volume.)

## 12. Concurrency / idempotency

- **Two teams share an edition** → two distinct subjects, two rows. Fine.
- **Same team, multiple editions** → distinct rows by `context_competition_edition_id`.
- **Snapshot recalculated / feature recalculated after ingestion** → `ON CONFLICT …
  DO NOTHING` on the `NULLS NOT DISTINCT` unique key → idempotent, same as ALL_COMP.
- Compatible with the existing single-writer, one-transaction-per-(calculator×batch)
  model; the scoped pass reuses it.

## 13. Golden policy

Per Gate C-i / S-0-c-i: **V1 raw-number goldens are INVALID** (population
deliberately superseded). This capability's tests use **V2-derived goldens** over a
controlled edition population, plus: boundary fixtures (§6); **edition isolation**
(a fixture from another edition must not count); **contamination test** (a cup
fixture excluded from a league-edition value); **ALL_COMPETITIONS isolation** (the
same team/as_of produces both an ALL_COMP row and a scoped row, distinct). V1's
lifetime values are never resurrected as expected outputs.

## 14. Adversarial matrix

| # | Case | Expected |
|---|---|---|
| A | team in two editions | two scoped subjects, two rows |
| B | same team, same as_of, different editions | two rows, distinct `context_competition_edition_id` |
| C | fixture from another competition | excluded from this edition's value |
| D | fixture from a previous season | excluded (different edition) |
| E | fixture exactly at as_of | excluded (strict `<`) |
| F | fixture 1 ms before as_of | included |
| G | fixture 1 ms after as_of | excluded |
| H | no completed fixtures in edition before as_of | NO VALUE (no row) |
| I | only home fixtures | `home_win_rate` present; `away_win_rate` NO VALUE |
| J | only away fixtures | mirror of I |
| K | draws | in denominator, not numerator |
| L | duplicate/replayed calculation | idempotent (ON CONFLICT DO NOTHING) |
| M | ALL_COMP + scoped for same team/as_of | both rows exist, distinct; **ALL_COMP value byte-identical to pre-change** |
| N | edition with no fixtures before as_of | NO VALUE |
| O | fixtures outside the edition but inside the 28-day ALL_COMP window | included in ALL_COMP only, **excluded** from scoped |
| P | >10 historical fixtures in edition | **all** counted — scoped path does NOT inherit rank-10 truncation |

Cases O and P are the proofs that the scoped path is genuinely edition-cumulative
and independent of the bounded ALL_COMP read.

## 15. Migration assessment

**No migration.** Required changes are: read-layer (new function + one additive
column on an existing read), orchestration (new scoped enumeration + pass),
write-layer (parametrize context + correlation), and — at Gate C — registry rows +
calculator. Schema, vocabulary, constraints, and indexes already exist. No context
seed change (context is columns, not rows). No change to migration 023.

## 16. Implementation boundary

### Required infrastructure (this capability — reusable)
| File | Change |
|---|---|
| `feature/read/fixtures.ts` | `readFixturesForEligibility` also returns `competition_edition_id` (additive) |
| `feature/read/editionVenueResults.ts` | **new** edition-cumulative venue-results read (§5) |
| `feature/driver/eligibility.ts` | **new** `selectScopedBatches` → `(as_of, team, edition)`; `selectBatches` unchanged |
| `feature/calculators/types.ts` | scoped subject carrying `contextEditionId`; a scoped `CalculationContext` (edition-scoped fixtures); a way to read a calculator's context kind (from the registry) |
| `feature/write/values.ts` | parametrize `context_kind_code` + `context_competition_edition_id`; fix `RETURNING` correlation (`IS NOT DISTINCT FROM`); ALL_COMP output invariant |
| `feature/pipeline.ts` | add a COMPETITION_SCOPED pass grouping scoped calculators by their declared context kind; ALL_COMP pass unchanged |
| tests | engine (scoped enumeration, edition-cumulative read, ALL/SCOPED isolation, idempotency, boundary), write invariance (M) |

### Feature-specific work (Gate C, later — NOT this gate)
| File | Change |
|---|---|
| `feature/calculators/venueWinRate.ts` | **new** calculator → `team.home_win_rate`, `team.away_win_rate` |
| `feature/seed/featureRegistry.ts` | two `feature_definition` rows; COMPETITION_SCOPED binding; sources `fixture`+`result`; version 1.0.0 |
| feature tests | formula/draws/zero/no-value; V2 goldens; contamination/edition isolation |

These are kept strictly separate: the infrastructure lands and is tested with a
trivial scoped test-calculator; `venue_win_rate` is then merely its first real
consumer.

## 17. Final decision

**C-ii: IMPLEMENTATION DESIGN APPROVED.**

- **subject grain:** `(team_id, competition_edition_id, as_of)`
- **context identity:** `COMPETITION_SCOPED` + `context_competition_edition_id`
  (existing vocabulary + columns; no new kind, no context table)
- **enumeration strategy:** generating fixture's `competition_edition_id` →
  `(as_of, team, edition)`, via a new `selectScopedBatches`; edition sourced from
  the fixture, never from a feature key (reusable)
- **read function(s):** new `readEditionVenueResults` (edition-cumulative);
  `readCompletedFixtures` untouched
- **as_of semantics:** strict `kickoff < as_of` (exactly-at excluded; −1 ms in;
  +1 ms out)
- **write semantics:** parametrized context kind + edition; `RETURNING` correlation
  extended with `IS NOT DISTINCT FROM` on the nullable edition; ALL_COMP output
  byte-identical (asserted)
- **migration requirement:** NONE
- **files expected to change:** §16 "Required infrastructure" only (feature-specific
  files are Gate C)
- **tests required:** §14 matrix + §16 engine/write tests
- **existing ALL_COMPETITIONS code untouched:** YES — separate pass; only
  `write/values.ts` changes, additively, with an invariance test

`home_away_performance` becomes the first consumer of a general capability, exactly
as the gate required — it is not a special case, and it is not named anywhere in the
infrastructure.

## 18. Scope discipline

No COMPETITION_SCOPED / `home_win_rate` / `away_win_rate` / `home_away_split` /
module-engine implementation; no migration 024; migration 023 untouched; no
dependency or module rows; readiness/travel/DEC-2 untouched; no closed S-0 decision
reopened; no new context kind; no invented window/threshold/coefficient/index.

---

## STATUS

- **S-5 architecture inspected:** YES (orchestration, enumeration, context, read, write, provenance — from source)
- **Existing COMPETITION_SCOPED support:** governed + schema-complete (vocabulary, columns, `NULLS NOT DISTINCT` unique, conditional CHECK, FKs, indexes), **never executed**
- **Subject grain:** `(team_id, competition_edition_id, as_of)`
- **Context identity:** COMPETITION_SCOPED + `context_competition_edition_id`; no new kind, no context table, no seed
- **Enumeration:** `selectScopedBatches` from the generating fixture's edition; reusable; `selectBatches` unchanged
- **Read:** new `readEditionVenueResults` (edition-cumulative); `readCompletedFixtures` untouched
- **as_of:** strict `< as_of` (exactly-at excluded; −1 ms in; +1 ms out)
- **Write:** parametrized context + fixed correlation; ALL_COMP byte-identical (asserted)
- **ALL_COMPETITIONS untouched:** YES (separate pass; only `values.ts` changes additively)
- **Provenance / obs count:** unchanged; non-composite pass-through (D-5c-i)
- **Idempotency:** ON CONFLICT DO NOTHING on the NULLS-NOT-DISTINCT key — holds for scoped rows
- **Performance:** existing indexes sufficient; no new index required (one surfaced, not created)
- **Golden policy:** V2-derived; edition + ALL_COMP isolation; no V1 lifetime values
- **Migration required:** NONE
- **Decision:** **C-ii: IMPLEMENTATION DESIGN APPROVED**
- **Next gate:** **Gate C-ii-impl — build the reusable COMPETITION_SCOPED capability** (§16 required infrastructure) with the §14 tests; then Gate C (venue_win_rate features), then Gate D (`home_away_split`)
