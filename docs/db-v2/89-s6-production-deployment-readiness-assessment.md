# S-6 Production Deployment-Readiness Assessment

**Gate type:** governance / read-only assessment. No production write, no migration
applied, no seed run, no schema/registry change, no module execution, no Module #3.
Deliverable: this document. Read-only diagnostics were executed by the operator
against production from a raw-TCP-capable environment; this records and interprets
them and states the exact deployment sequence.

Supersedes the migration-024 finding of doc 88 (now resolved) and refines the
feature-registry finding with the exact production delta.

---

## 1. Production identity confirmed

`D0`: `current_database() = postgres`, server on a Supabase IPv6 address,
`PostgreSQL 17.6`. Combined with the 13-row module registry (Q2), this is the
production database — not a mis-pointed connection. The earlier ambiguity (Q3
flipping between runs) is resolved: it is the same production DB, and **migration
024 has been applied to it since the first run**.

---

## 2. What is correct in production

| Aspect | Evidence | State |
|---|---|---|
| Migration 023 (both columns + both CHECKs) | Q1 `1\|1\|1\|1` | ✅ applied |
| Migration 024 (D-2 rationale amendment) | Q3 = `e8e2464…` / `91d4ee9…` (exact post-024) | ✅ applied |
| Module registry (13 versions, keys/active/`1.0.0`/`min=0`) | Q2 | ✅ complete & correct |
| Module readings / evidence / items | Q4 `0\|0\|0`, Q5 none | ✅ zero — clean slate |
| E-i/E-iii schema + both modules TEAM+active | Q8 `1\|1\|1\|1` | ✅ present |

The module layer is fully in place: schema, registry, corrected rationales, and no
pre-existing output. Migration 024 being present means the D-2 prerequisite is
satisfied in production.

---

## 3. The gap — a stale feature registry with zero values

Production feature registry vs the current seed (scratch reference: **11**
definitions / **8** calculators):

**Production `feature.feature_definition` — 7 (D1):** `team.away_form`,
`team.congestion_index`, `team.home_form`, `team.readiness_score`,
`team.rest_advantage`, `team.squad_stability`, `team.travel_impact`.

**Missing definitions (4):** `team.home_win_rate`, `team.away_win_rate`,
`team.momentum`, `team.travel_distance`.

**Production `feature.feature_calculator` — 5 (D2):** `fixture_load`,
`form_backfill`, `squad_continuity`, `team_readiness`, `travel_load`.

**Missing calculators (3):** `venue_win_rate`, `team_momentum`, `travel_itinerary`.

**Feature values (D3): 0** — the S-5 feature pipeline has **never run** in
production; even the seven present definitions hold no values.

Production's feature seed therefore predates **S-0-a-ii** (`travel_itinerary` /
`team.travel_distance`), **Gate C** (`venue_win_rate` → home/away win rate), and
**Gate E-ii** (`team_momentum` → `team.momentum`), and no feature computation has
been run.

### Mapped to the two implemented modules

| Module | Prerequisite feature(s) | Producing calculator | Production status |
|---|---|---|---|
| home_away_split | `team.home_win_rate`, `team.away_win_rate` (COMPETITION_SCOPED) | `venue_win_rate` (Gate C) | **calculator + definitions + values all absent** |
| readiness_tracker | `team.momentum` (ALL_COMPETITIONS) | `team_momentum` (Gate E-ii) | **calculator + definition + values all absent** |

`travel_itinerary` / `team.travel_distance` are also missing but are **not** a
#1/#2 prerequisite; deploying the full current seed brings them along, and the
travel *architecture* stays closed (`travel_distance` is a measurement feature, not
a module — docs 63–71 unchanged).

---

## 4. Gate 87 status

**Gate 87 remains B — REMEDIATION REQUIRED.** With migration 024 now applied, the
sole remaining read-A blocker is Q6 (the three prerequisite feature definitions are
absent). Q7 (values) is reported-not-gating for the *read* verdict but is required
before the modules can produce *engaged* (non-INACTIVE) readings at the write gate.

---

## 5. Remediation sequence (each a separate, operator-authorized step; none executed here)

Ordered so the two modules reach a verified, writeable production state:

1. **Feature-registry deployment gate.** Deploy the current seed's feature-registry
   additions to production so `feature.feature_definition`,
   `feature.feature_calculator`, `feature.feature_definition_context_kind`, and
   `feature.feature_version` include the missing rows (calculators `venue_win_rate`,
   `team_momentum`, `travel_itinerary`; definitions `team.home_win_rate`,
   `team.away_win_rate`, `team.momentum`, `team.travel_distance`). Mechanism: the
   idempotent `npm run seed:v2` (or a scoped feature-registry seed) run against
   production under the seed roles — `ON CONFLICT DO NOTHING`, so the 7 existing
   definitions and the module registry are untouched. This is a WRITE to registry
   tables (its own authorization); it does **not** touch `module_reading`.
   *Verify after:* Q6 returns the 3 module prerequisites with the correct context
   bindings (home/away_win_rate TEAM COMPETITION_SCOPED; momentum TEAM
   ALL_COMPETITIONS).

2. **Upstream data check (blocking for step 3).** D3 = 0 values may be because S-5
   has not run *and/or* because the upstream football data (fixtures + results) is
   not present. Before S-5 can produce anything, verify production holds ingested
   completed fixtures with results:
   ```sql
   SELECT (SELECT count(*) FROM football.fixture)  AS fixtures,
          (SELECT count(*) FROM football.result)   AS results,
          (SELECT count(*) FROM football.fixture WHERE lifecycle_state_code='COMPLETED') AS completed;
   ```
   If these are ~0, S-4 ingestion must run first (a separate concern outside S-6).

3. **S-5 feature run.** Run the feature pipeline in production to produce the
   prerequisite VALUES: `venue_win_rate` (scoped pass → home/away win rate) and
   `team_momentum` (ALL_COMPETITIONS → momentum), for real teams/editions/as_of.
   Without values the modules emit only INACTIVE. Largest step; its own gate.

4. **Re-run Gate 87 (read-only).** Expect **A**: Q1 `1|1|1|1`, Q2 the 13 rows, Q3
   post-024 hashes, Q4 `0|0|0`, Q5 none, Q6 the 3 bindings, Q7 values present, Q8
   `1|1|1|1`.

5. **Production-write authorization gate.** Gate 83's decision re-evaluated against
   the now-verified production state, then a small, auditable first module write.

Ordering: step 1 before step 3 (definitions before values); step 2 before step 3
(data before computation); migration 024 already done; Gate 87-A (step 4) requires
steps 1 (+ the values from step 3 for engaged readings at step 5).

---

## 6. Status

- **Production:** migrations 023 + 024 applied; module registry complete; zero
  readings (clean); E-i/E-iii schema present; **feature registry stale** (7 defs /
  5 calcs, missing the Gate-C / E-ii / S-0-a-ii additions) with **zero feature
  values** (S-5 not run).
- **Gate 87:** B — remaining blocker is the feature registry (Q6) and its values
  (Q7). Migration-024 gap from doc 88 is resolved.
- **SCRATCH VERIFIED** (reference, unchanged): 11 feature definitions / 8
  calculators, migrations 001–024, module suites 55/55, full suite at the 14-failure
  baseline.
- No code, schema, migration, seed, or registry change was made here; no production
  write; no Module #3.

**Next gate:** the **feature-registry deployment gate** (step 1) — deploy the seed's
feature-registry additions to production (idempotent), then the upstream-data check
(step 2), the S-5 feature run (step 3), a re-run of Gate 87 → A (step 4), and
finally the production-write authorization gate (step 5). No Module #3 until
production write authorization is granted.
