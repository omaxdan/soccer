# S-6 Production Feature-Registry Deployment Readiness Gate

**Gate type:** investigation / design only. No `seed:v2`, no migration, no S-5, no
module-reading write, no Module #3, no code/seed/registry/schema change, no
production write. Deliverable: this document. Findings from source and from the
operator's read-only production diagnostics (docs 88/89); registry counts validated
against the scratch build of the current seed.

**Purpose:** decide whether deploying the current feature registry to production
(via `seed:v2`) is safe to authorize, exactly what it would add, and what upstream
data S-5 will later require — while keeping registry-metadata deployment, feature
value production (S-5), and module-reading authorization strictly separate.

---

## 1. Current production feature registry (from docs 88/89 diagnostics)

| Relation | Production now | Source (D1/D2/D3) |
|---|---|---|
| `feature.feature_calculator` | **5** | `fixture_load, form_backfill, squad_continuity, team_readiness, travel_load` |
| `feature.feature_definition` | **7** | `away_form, congestion_index, home_form, readiness_score, rest_advantage, squad_stability, travel_impact` |
| `feature.feature_definition_context_kind` | **10** (expected) | derived from the 7 definitions' bindings (2+2+2+1+1+1+1); confirm with §7 query |
| `feature.feature_version` | **7** (expected) | one per definition; confirm with §7 query |
| `feature.feature_value` | **0** | D3 — S-5 has never run |

The current authoritative seed (scratch, byte-for-byte the deployed source) holds
**8 calculators / 11 definitions / 14 context bindings / 11 versions**.

---

## 2. Exact rows `seed:v2` would ADD (feature registry)

Missing calculators (**3**):

| calculator_key | produces | gate of origin |
|---|---|---|
| `venue_win_rate` | `team.home_win_rate`, `team.away_win_rate` | Gate C |
| `team_momentum` | `team.momentum` | Gate E-ii |
| `travel_itinerary` | `team.travel_distance` | S-0-a-ii |

Missing definitions (**4**), each with one context binding and one 1.0.0 version:

| feature_key | subject | context binding | versions |
|---|---|---|---|
| `team.home_win_rate` | TEAM | `COMPETITION_SCOPED` | 1 |
| `team.away_win_rate` | TEAM | `COMPETITION_SCOPED` | 1 |
| `team.momentum` | TEAM | `ALL_COMPETITIONS` | 1 |
| `team.travel_distance` | TEAM | `ALL_COMPETITIONS` | 1 |

Net feature-registry inserts: **+3 calculators, +4 definitions, +4 context
bindings, +4 versions.**

The two implemented modules' prerequisites are among these: `home_away_split` ←
`venue_win_rate` + `home/away_win_rate`; `readiness_tracker` ← `team_momentum` +
`team.momentum`. `travel_itinerary`/`team.travel_distance` come along because they
are in the current seed, but are **not** a #1/#2 prerequisite and open no travel
module — the travel architecture (docs 63–71) is untouched.

---

## 3. Idempotency — can any existing production row be mutated?

**No.** Verified in source: both seed primitives use
`INSERT INTO … ON CONFLICT (<identity>) DO NOTHING` (`seed/helpers.ts`
`seedRows`, `seedRowsResolvingParent`) — *"every statement here is INSERT … ON
CONFLICT DO NOTHING. There is no update."* Consequences:

- The 7 existing feature definitions, their bindings and versions: **untouched**.
- The 13 `module_definition` / `module_version` rows, **including the
  migration-024 amended rationales**: `seed:v2` re-runs the module-registry stage,
  but every row conflicts → DO NOTHING → the post-024 rationales are **preserved,
  not reverted** (this exact behaviour was proven in the D-2 amendment gate: a
  full seed on the migrated DB left the two rationale md5s unchanged).
- Vocabularies, entitlements, quality-check versions: conflict → no-op.

Only genuinely-absent rows are inserted; nothing is ever updated or deleted.

---

## 4. What `seed:v2` writes — and what it does NOT

`seed:v2` (`seed/runAll.ts`) runs five registry stages: vocabularies →
entitlements → **feature registry** → module registry → quality-check versions. It:

**Writes (production):**
- the missing `feature.feature_calculator` / `feature_definition` /
  `feature_definition_context_kind` / `feature_version` rows (§2);
- `operations` telemetry for the attributed stages (`pipeline_job_run`,
  `pipeline_job`, `write_record`) — the ordinary record that a seed ran. This is a
  write to schema `operations`, expected and benign; it is **not** feature or
  module data.

**Does NOT:**
- write `feature.feature_value` (that is S-5) — it establishes registry metadata only;
- run the S-5 feature pipeline, the ingestion pipeline, or any calculator;
- run or alter any migration (migration state is unchanged; 023/024 stay applied);
- write `module_reading` / `module_evidence` / `module_evidence_item`;
- mutate module calculators, module definitions, or module versions (§3).

So `feature_value` stays **0**, `module_reading` stays **0**, migrations unchanged,
module registry unchanged. Registry-metadata deployment is fully separate from
value production and from reading authorization.

---

## 5. Before/after expected row-count matrix

| Relation | Before (prod) | seed:v2 | After | Mutations |
|---|---|---|---|---|
| feature.feature_calculator | 5 | +3 | 8 | none |
| feature.feature_definition | 7 | +4 | 11 | none |
| feature.feature_definition_context_kind | 10* | +4 | 14 | none |
| feature.feature_version | 7* | +4 | 11 | none |
| feature.feature_value | 0 | +0 | 0 | none (S-5 not run) |
| module.module_definition | 13 | +0 | 13 | none |
| module.module_version | 13 | +0 | 13 | none (024 preserved) |
| module.module_reading / evidence / item | 0 / 0 / 0 | +0 | 0 / 0 / 0 | none |
| operations.pipeline_job_run / write_record | n | +telemetry | n+Δ | append-only telemetry |

\* Before-values for context bindings and versions are derived from the 7 known
definitions; confirm with the §7 measurement query so the matrix is measured, not
assumed.

---

## 6. Upstream-data prerequisite for S-5 (read-only; determination PENDING)

S-5 cannot produce the prerequisite feature *values* without upstream football
data. The two producing calculators read:
- `venue_win_rate` (COMPETITION_SCOPED) → completed, result-bearing fixtures per
  competition edition;
- `team_momentum` (ALL_COMPETITIONS) → the ten most-recent completed result-bearing
  fixtures across all competitions;
and the driver derives `as_of` from `football.snapshot_point`.

**This gate cannot read production** (this environment has no raw-TCP egress), so
S-4 necessity is **not** determined here — it must be measured, not assumed. The
operator runs, read-only:

```sql
SELECT
  (SELECT count(*) FROM football.fixture)                                        AS fixtures,
  (SELECT count(*) FROM football.fixture WHERE lifecycle_state_code='COMPLETED') AS completed,
  (SELECT count(*) FROM football.result)                                         AS results,
  (SELECT count(*) FROM football.team)                                           AS teams,
  (SELECT count(*) FROM football.competition_edition)                            AS editions,
  (SELECT count(*) FROM football.snapshot_point)                                 AS snapshot_points;
```

**Decision rule:**
- `completed` ≈ 0 or `results` ≈ 0 → **S-4 ingestion is required before S-5** (no
  population to compute from). `snapshot_points` should be > 0 (seeded by
  migrations); if 0, that too blocks the driver.
- `completed` and `results` > 0 (and snapshot_points > 0) → S-5 can produce values
  directly after the registry deployment; **S-4 not required** for a first run.

Report the six counts to resolve items 6–7.

---

## 7. Measurement query to fix the before-column (read-only)

```sql
SELECT
  (SELECT count(*) FROM feature.feature_calculator)                AS calculators,     -- expect 5
  (SELECT count(*) FROM feature.feature_definition)               AS definitions,     -- expect 7
  (SELECT count(*) FROM feature.feature_definition_context_kind)  AS context_bindings,-- expect 10
  (SELECT count(*) FROM feature.feature_version)                  AS versions,        -- expect 7
  (SELECT count(*) FROM feature.feature_value)                    AS feature_values;  -- expect 0
```

If the measured before-values differ from the expected (5/7/10/7/0), the §5 matrix
must be recomputed before authorizing the deployment.

---

## 8. The three-layer distinction (kept explicit)

1. **Registry-metadata deployment (this gate's subject).** `seed:v2` adds the
   missing calculator/definition/binding/version rows. Idempotent, mutates nothing,
   writes no feature or module data. Makes the *definitions* exist.
2. **Feature-value production (S-5).** A separate run of the feature pipeline that
   computes and writes `feature.feature_value`. Requires step 1 and upstream data
   (§6). Not authorized here.
3. **Module-reading production authorization (Gate 83 re-run + write gate).** A
   separate decision to write `module_reading`. Requires steps 1–2 and verified
   production state. Not authorized here.

Each is a distinct gate; none is collapsed into another.

---

## 9. Findings

- **Exact production registry delta:** +3 calculators (`venue_win_rate`,
  `team_momentum`, `travel_itinerary`), +4 definitions (`team.home_win_rate`,
  `team.away_win_rate`, `team.momentum`, `team.travel_distance`), +4 context
  bindings, +4 versions. After: 8 / 11 / 14 / 11. No mutations.
- **Upstream-data readiness:** **UNDETERMINED from here** — pending the operator's
  §6 read-only counts (this environment cannot reach production).
- **Is S-4 required before S-5?** **UNDETERMINED** — decided by the §6 rule on the
  measured counts, not assumed. (`feature_value = 0` alone does not distinguish
  "no data" from "S-5 never run"; the §6 counts do.)
- **Is `seed:v2` safe to authorize for the feature registry?** **YES.** It is
  idempotent (`ON CONFLICT DO NOTHING`), adds only the four/three missing registry
  rows, mutates no existing row, preserves migrations 023/024 (including the amended
  rationales), writes no `feature_value` and no `module_reading`, and runs no
  migration or S-5. Its only other writes are ordinary `operations` telemetry.
  Recommend running it from the same raw-TCP environment that holds the production
  credentials, then re-measuring §7 (expect 8/11/14/11) and re-running Gate 87 Q6
  (expect the 3 module prerequisites present).

- **Exact next gate:** the **Production Feature-Registry Deployment gate** — execute
  `seed:v2` against production (idempotent), verify §7 → 8/11/14/11 and Gate 87 Q6,
  and run the §6 upstream-data check in the same session. Then, depending on §6:
  if data is present → the **S-5 production feature-run gate**; if not → an **S-4
  ingestion gate** first. Feature-value production and module-reading authorization
  remain separate, later gates. **No Module #3** until production write
  authorization is granted.

No `seed:v2`, migration, S-5, module write, Module #3, or any code/schema/data
change was performed in this gate.
