# S-6 Production Read-Only Verification Gate

**Gate type:** read-only production verification. No production write, no pipeline
run, no schema/seed/registry/engine/calculator change, no Module #3, no secret
exposed. Deliverable: this document and a single classification.

**Predecessors:** Gate 83 (production write NOT APPROVED — could not inspect
production); Gate 84 (production access UNAVAILABLE — operator action required).
The operator reports that production access is now available and that an
independent `npm run doctor:v2 -- --probe` authenticated read-only against the
intended Supabase production endpoint (session pooler, port 5432, database
`postgres`, TLS verified, PostgreSQL 17.6).

---

## 1. Connectivity from this gate's environment

The verification must be performed **by this gate** against production, then
recorded. Establishing the connection is the first read-only step.

**Finding — production is not reachable from this execution environment.** Verified
with the sanctioned, secret-safe diagnostic (`npm run doctor:v2`):

```
environment files
  absent  .env
  0 variable name(s) supplied by file
  PROBLEM: no PT_V2_* variable came from a file.
connection target
v2 doctor FAILED: V2 database configuration incomplete.
  Missing: PT_V2_DB_HOST, PT_V2_DB_NAME.
```

Corroborated read-only, no secrets printed:
- `PT_V2_DB_HOST`, `PT_V2_DB_NAME`, `PT_V2_DB_PASSWORD`, `PT_V2_DB_USER`,
  `PT_V2_DB_USER_SUFFIX`, `PT_V2_DB_SSL_CA` — **all unset** in this process
  environment.
- No `.env` file exists at the backend cwd or package root (the paths
  `config/env.ts` loads via dotenv).
- `.env2` contains only `LOG_LEVEL`, `SPORTSAPI_*`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY` — **zero `PT_V2_*` variables**, and it is not the file the
  V2 config loads.

The operator's successful `doctor:v2 --probe` ran in a **different environment**
(their own shell/machine) whose `PT_V2_DB_*` values are not inherited by this
session. This gate therefore has **no production connection** and cannot execute
the read-only inspection.

**No workaround was attempted** — no credential guessing, no service-key-as-DB-
password, no host derivation, no REST substitution, no scratch-labelled-as-
production. Per programme discipline, the operator's assertion of connectivity is
**not** recorded as production verification: this gate must observe production
itself, and it could not.

---

## 2. Production database verification (STEP 1) — NOT PERFORMED

Every item below requires a production connection this gate does not have. All are
**UNVERIFIED against production**:

- migrations applied through 024;
- migration 023 columns (`module_version.minimum_sample_observation_count`,
  `module_reading.inactive_reason`);
- migration 024 rationales for `home_away_split` 1.0.0 and `readiness_tracker`
  1.0.0, and exact match to the approved values;
- `module_version` count and identities;
- schema state relevant to these modules.

---

## 3. Production module-reading state (STEP 2) — NOT PERFORMED

`module_reading`, `module_evidence`, `module_evidence_item` production counts are
**UNVERIFIED**. This gate explicitly does **not** assume zero because scratch is
zero (Gate 84 discipline).

---

## 4. Production prerequisite features (STEP 3) — NOT PERFORMED

`team.home_win_rate` / `team.away_win_rate` (COMPETITION_SCOPED) and `team.momentum`
(ALL_COMPETITIONS) availability in production is **UNVERIFIED**.

---

## 5. Production module registration (STEP 4) — NOT PERFORMED against production

The production `module_definition` / `module_version` rows, active flags, and
amended rationales are **UNVERIFIED against production**. (Source and scratch show
the correct state — §7.)

---

## 6. Contract comparison (STEP 5) — NOT PERFORMED against production

The `home_away_split` and `readiness_tracker` contracts have not been exercised
against production data (no connection).

---

## 7. What IS verified — SCRATCH, not PRODUCTION

To keep the distinction explicit:

**SCRATCH VERIFIED** (local `ptv2`, migrations 001–024 applied; prior gates + this
session):
- migrations through 024; migration 023 columns present; migration 024 amended both
  rationales; the two rationales byte-identical to the seed (`e8e2464…`,
  `91d4ee9…`); `module_version` = 13; `module_reading` / `module_evidence` /
  `module_evidence_item` = 0.
- `MODULE_CALCULATORS` = exactly `[home_away_split, readiness_tracker]` (source);
  only two calculator files exist; Module #3 absent.
- both modules pass every contract item (Gates D / E-iii; suites 55/55 green);
  full DB suite 741 tests, 14 failures = the documented environmental baseline.

**PRODUCTION VERIFIED:** **nothing** — this gate obtained no production connection.

Scratch is a proxy and is explicitly **not** proof of production state.

---

## 8. Discrepancies

One, and it is environmental, not a production defect: the production `PT_V2_DB_*`
configuration that the operator used for the successful probe is **not present in
this gate's execution environment**, so the gate's own read-only inspection could
not run. No discrepancy in code, schema, or the modules themselves was found (none
could be checked against production).

---

## 9. Classification

### B. PRODUCTION READ-ONLY VERIFICATION FAILED — REMEDIATION REQUIRED

Not because production is known bad, but because **this gate could not observe
production**: the direct-PostgreSQL `PT_V2_DB_*` credentials (host, name, password,
and for the pooler the tenant suffix + CA) are absent from the environment running
the gate, and `doctor:v2` fails at configuration before any connection. Production
write authorization remains **CLOSED**.

---

## 10. Remediation and next gate

**Remediation (operator):** make the *same* production V2 configuration used for the
successful `doctor:v2 --probe` available to **this gate's execution environment** —
either as a `beta/backend/.env` (the path dotenv loads; git-ignored, never
committed) or as real environment variables injected into the automation — namely
`PT_V2_DB_HOST`, `PT_V2_DB_NAME`, `PT_V2_DB_PASSWORD` (the `postgres` role password,
quoted), `PT_V2_DB_USER_SUFFIX` (project ref, for the session pooler),
`PT_V2_DB_SSL_CA` (Supabase CA PEM), with port `5432`. No secret should be pasted
into chat or committed.

**Next gate:** re-run this **production read-only verification gate** in the
credentialed environment. It will `doctor:v2 --probe`, then run SELECT-only queries
to establish §§1–6 (migrations ≤ 024, both amended rationales exact, 0 existing
readings/evidence/items, prerequisite feature values present, no pre-existing
readings). On a clean pass it classifies **A** and hands off to the separate
**production-write authorization gate** (Gate 83's decision re-evaluated against
verified production state), then a small, auditable first write.

No code, schema, migration, seed, or registry change was made in this gate. No
production write occurred. Module #3 remains out of scope.
