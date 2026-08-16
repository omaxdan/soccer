# S-6 Production-Reading Authorization Gate (home_away_split, readiness_tracker)

**Gate type:** authorization / verification. Not a new-architecture gate. It
decides whether the two implemented S-6 modules may move from scratch verification
to **writing production `module_reading` rows**. No engine, calculator, registry,
or migration change is in scope; the deliverable is this document plus — only if
authorized — a small, auditable first production write.

---

## STEP 1 — Definition of the gate

**"Production-reading authorization"** means: a specific module version is cleared
to persist `module.module_reading` rows (with their `module_evidence` /
`module_evidence_item`) in the **production** database, attributed to a version
whose recorded metadata accurately describes the rule that produced them.

**Eligible modules (and only these):**
1. `home_away_split` 1.0.0 — TEAM × COMPETITION_SCOPED.
2. `readiness_tracker` 1.0.0 — TEAM × ALL_COMPETITIONS.

**Excluded:** the other eleven registered modules — the seven active-but-
unimplemented (consistency_index, giant_killer_index, travel_impact, rest_advantage,
league_goal_profiles, form_gap_accuracy, confidence_calibration) and the four
inactive (squad_stability, historical_advantage, risk_assessment, match_context).
No calculator exists for any of them and none is in `MODULE_CALCULATORS`, so the
engine produces nothing for them. Module #3 is **not** selected.

**Feature / context prerequisites that must exist in production:**
- for `home_away_split`: `team.home_win_rate` + `team.away_win_rate`
  (COMPETITION_SCOPED, edition-cumulative) for the eligible team × edition × as_of.
- for `readiness_tracker`: `team.momentum` (ALL_COMPETITIONS) for the eligible
  team × as_of.

**Lifecycle invariants that must hold (per docs 73/78/81/82, migrations 023/024):**
- strength / confidence / published_baseline_id NULL at 1.0.0 (D-5a/b; S-9 out).
- `sample_observation_count = MIN(consumed)` (D-5c-i); `sample_meets_threshold =
  count ≥ module_version.minimum_sample_observation_count` (= 0 for both).
- an absent declared input → INACTIVE, `inactive_reason = FEATURE_ABSENT`, no
  evidence items, silent (LC-69); a real 0 value is engaged, never INACTIVE.
- edition isolation (scoped) / edition NULL (all-competitions); the two scopes
  never mix; idempotent on the named unique constraint.
- the two amended 1.0.0 rationales (migration 024) are present.

**What must be verified before the first production write:** every item in STEPs
2–5 below, against the **production** environment — not a proxy.

**What remains S-9 and must NOT be activated:** `calibration.published_baseline`,
`calibration.sample_gate`, any strength/confidence fitting, any baseline lookup.

**Rollback / containment if verification fails:** the first write is a single
bounded batch inside one transaction; on any unexpected row count, constraint
error, or stray reading it is rolled back and nothing persists. Because
`module_reading` is append-only and pipeline roles hold no DELETE, containment is
achieved by **not committing**, never by after-the-fact deletion.

---

## STEP 2 — Production preconditions (the decisive step)

The gate requires the **actual target production database** to be inspected:
migrations through 024 applied, module definitions/versions present, the two
amended rationales present, the prerequisite feature values present, exactly two
registered calculators, **zero** existing `module_reading` rows, and no hidden
mechanism able to create readings.

**Finding — the production database cannot be inspected from this environment:**

| Check | Result |
|---|---|
| V2 pipeline connection model | direct PostgreSQL via `PT_V2_DB_HOST/PORT/USER/PASSWORD` (`assertDatabaseConfigured`), **not** the Supabase REST API. |
| Production Postgres credentials present? | **No.** `.env2` provides only `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (REST) — there are **no `PT_V2_DB_*` production values**. The only configured `PT_V2_DB_HOST` is `127.0.0.1` / `ptv2` — the local **scratch** cluster. |
| Egress to Supabase | denied all session (agent proxy 403 on CONNECT to the Supabase host); the HTTPS proxy carries tool traffic, not a raw Postgres 5432/6543 connection. |
| Consequence | migrations-applied state, existing-reading count, and feature availability **in production** are **unverifiable** from here. |

Per this gate's own STEP 2 instruction — *"If the target production DB cannot
safely be inspected, STOP and report that as the blocker rather than claiming
authorization"* — this is a **hard blocker**. All verification below is therefore
against the **scratch cluster**, which is a high-fidelity proxy (migrations
001–024 applied, the real seed, the real engine and calculators) but is
**explicitly not proof of production state** (doc discipline: do not assume scratch
= production).

---

## STEP 3 — home_away_split verification (scratch proxy)

Against the seeded scratch editions, every contract item holds (Gate D
`moduleEngine.test.ts`, re-run green this gate — 55/55 across the two module
suites):

- TEAM subject; COMPETITION_SCOPED context; correct competition edition on the reading.
- `home_win_rate` and `away_win_rate` read from the **same** team + edition + as_of.
- `disparity = home − away`; `|disparity| ≥ 40 → SUPPORTS`, otherwise NEUTRAL.
- either input missing → INACTIVE; `inactive_reason = FEATURE_ABSENT`; no evidence items.
- engaged reading cites exactly the two consumed feature values; `sample = MIN(consumed)`.
- `sample_meets_threshold` uses `module_version.minimum_sample_observation_count`
  (= 0); threshold remains 0.
- strength / confidence / published_baseline_id NULL; no S-9 calibration touched.
- edition isolation holds; rerun is idempotent (named unique constraint, NULLS NOT DISTINCT).

**Verdict:** implementation-correct on the proxy. Not exercised against production
data (STEP 2 blocker).

---

## STEP 4 — readiness_tracker verification (scratch proxy)

Against committed ALL_COMPETITIONS `team.momentum` values (Gate E-iii
`readinessTracker.test.ts`, re-run green this gate):

- TEAM subject; ALL_COMPETITIONS context; edition NULL on the reading.
- `team.momentum` is the consumed feature; `≥ +10 → SUPPORTS`, `≤ −10 →
  CONTRADICTS`, otherwise NEUTRAL (the numeric classifyTrend thresholds; the
  broken V1 string evaluator is not reproduced).
- absent momentum → INACTIVE + FEATURE_ABSENT, silent, no items; a real 0 momentum
  → engaged NEUTRAL (distinct from absence).
- engaged reading cites exactly the one momentum value; sample count passes through
  (D-5c-i); threshold 0.
- strength / confidence / published_baseline_id NULL; no S-9 calibration.
- ALL_COMPETITIONS and COMPETITION_SCOPED values remain isolated; rerun idempotent.

**Verdict:** implementation-correct on the proxy. Not exercised against production
data (STEP 2 blocker).

---

## STEP 5 — Production safety (scratch proxy + source)

- `module_reading` holds **0 rows** on the only reachable DB; no accidental write
  occurred during verification (all module writes ran in rolled-back transactions).
- No other module can produce a reading: only two calculator files exist
  (`homeAwaySplit.ts`, `readinessTracker.ts`) and
  `MODULE_CALCULATORS = [homeAwaySplit, readinessTracker]`; the engine reconciles a
  calculator against a registered active module, so an unregistered/unlisted module
  yields nothing.
- **No Module #3** implementation exists.
- Travel architecture untouched; `rest_advantage` remains unresolved (orientation,
  doc 79) — neither reopened.
- No production calibration/baseline data introduced; S-9 relations empty.

These hold on the proxy; the production equivalents are **unverified** (STEP 2).

---

## STEP 6 — Authorization boundary

Successful scratch verification establishes the modules are **implemented and
verified**. It does **not**, by itself, establish production authorization: the
production preconditions (STEP 2) could not be inspected, so the state to which a
first write would be committed is unknown from here. Converting the passing tests
into authorization would be exactly the "implemented ≠ authorized" conflation this
gate forbids.

### PRODUCTION READING AUTHORIZATION: NOT APPROVED

**Exact blocker:** the target production database is not reachable or configured
from this environment — no `PT_V2_DB_*` production credentials are present (only a
Supabase REST URL + service key), and Supabase egress is denied. Migrations-applied
state, the existing `module_reading` count, and feature availability **in
production** are therefore unverifiable, and STEP 2's stop condition applies.

**What is NOT the blocker (so the next attempt is bounded):** the two modules'
implementation, their contracts, the D-2 rationale correction (migration 024), and
all lifecycle invariants are verified correct on the proxy. The only missing
element is production-environment inspection.

---

## STEP 7 — Implementation / writing

**Not performed.** No production reading was written. Writing was neither possible
(no production connection) nor permissible (STEP 6 = NOT APPROVED); writing to the
scratch cluster and calling it "production" would be a mislabelling, and the first
production write must be a deliberate, auditable act against a verified production
state. No architecture, engine, calculator, migration, or registry change was made.

---

## STEP 8 — Final report

1. **Governance decision:** PRODUCTION READING AUTHORIZATION — **NOT APPROVED**
   (blocker: production DB not configured/reachable from this environment).
2. **Production preconditions:** **not verifiable** — no `PT_V2_DB_*` production
   credentials; Supabase egress denied. Only the scratch cluster is reachable.
3. **home_away_split verification:** all contract items pass on the scratch proxy;
   unverified against production.
4. **readiness_tracker verification:** all contract items pass on the scratch
   proxy; unverified against production.
5. **First production write:** none (not authorized, not attempted).
6. **Reading / evidence counts:** `module_reading` = 0, `module_evidence` = 0,
   `module_evidence_item` = 0 (unchanged; scratch, the only reachable DB).
7. **Idempotency:** re-confirmed on the proxy for both modules (named unique
   constraint); not exercised in production.
8. **Full-suite vs baseline:** 741 tests, 14 failures — **identical to the
   documented environmental baseline; zero new** (run this gate).
9. **Typecheck / tests:** `tsc --noEmit` clean; the two module suites 55/55 green.
10. **Diff scope:** this document only. No code, no migration, no seed, no registry
    change. (The scratch DB delete+reseed during earlier D-2 verification self-
    healed to the migration-024 state; no repository change resulted.)
11. **Module #3 status:** NOT selected, NOT implemented.

---

## Final status

- **D-2 governance:** RATIFIED (doc 82).
- **D-2 amendment:** IMPLEMENTED (migration 024, `514dcb8`).
- **Implementation state:** home_away_split and readiness_tracker — **implemented
  and verified** (scratch proxy).
- **Production reading authorization:** **NOT APPROVED** — blocker: production
  database not configured/reachable from this environment (STEP 2).
- **S-9:** out of scope; not activated.
- **Next gate:** re-run this authorization gate **in an environment where the
  production database is reachable** — verify migrations 001–024 applied there, the
  two amended rationales present, the prerequisite feature values present, exactly
  two registered calculators, and `module_reading` = 0 — then, only on that
  verified evidence, perform the small first production write for the two modules.
  No Module #3 until production authorization is granted.
