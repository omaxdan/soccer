# S-9 — Calibration & Confidence Governance (Consolidated Record)

**Type:** Consolidated governance decision record.
**Status of this document:** authoritative record of the S-9 decision state established during the completed S-9A, S-9B, S-9C, and S-9D work.

> **Historical-integrity note.** This is a *consolidated* record, created after the fact.
> The repository did not previously contain dedicated S-9A / S-9B / S-9C decision-record
> documents; this document does not claim to be a contemporaneous original for those
> phases, and it does not backfill separate per-phase records. It documents the decisions
> as they were established, without altering any historical implementation file. No
> application code, migration, schema, calculator, API, test, snapshot, ingestion, or
> operational behaviour is changed by this record.

---

## 1. S-9 overall state

S-9 comprises four sub-phases:

| Sub-phase | Scope | State |
|---|---|---|
| S-9A | Owner ratification / magnitude decision register (OD-1…OD-5) | Completed / ratified |
| S-9B | Outcome / substrate accrual (MATCH_RESULT outcome linkage) | Substrate present; machinery ready |
| S-9C | Snapshot sealing / deterministic production proof | **CLOSED** |
| S-9D | Calibration / confidence governance | **DORMANT / NOT CURRENTLY APPLICABLE** |

```
S-9C STATUS: CLOSED
S-9D STATUS: DORMANT / NOT CURRENTLY APPLICABLE
```

---

## 2. OD-6.1 — Band model — RATIFIED

- **Hybrid band architecture:** one controlled conceptual band vocabulary **plus** module-version-specific mappings from native output into that vocabulary.
- Identical band labels do **not** imply identical underlying measurements across modules.
- **Directional categorical states remain distinct and unordered.** `SUPPORTS`, `NEUTRAL`, `CONTRADICTS` are **not** ordinal strength levels; never interpret them as `CONTRADICTS < NEUTRAL < SUPPORTS` or any equivalent ordering.
- **Magnitude modules use fixed, module-version-specific mappings** from their native numeric output into controlled bands (`giant_killer_index` native `[0,100]`, higher = stronger; `consistency_index` native `[0,∞)`, higher = more goal-margin volatility / less consistency). No universal numeric threshold system across the two modules; native semantics preserved (never inverted/relabelled to appear equivalent).
- **No dynamic corpus-derived bands:** no moving quantiles, percentiles, or calibration-population-derived cutpoints. Band membership must not change merely because the corpus grows. (Any future distribution-derived banding would require explicitly frozen, versioned, governed edges — not part of this decision.)
- **Band mappings belong to the `module_version`.** Changing a mapping's semantics requires a **new module version**; a mapping change must never silently reinterpret historical readings. The existing module-version calibration identity (LC-135) is the version boundary.
- **NULL / INACTIVE outputs receive no band** and produce no synthetic calibration observation.
- **Exact magnitude band vocabulary and numeric cutpoints remain future governed implementation detail** — not invented by this record.
- **No schema change was required** to represent this model: `band_code` is already free-text, `NOT NULL`, and scoped per `module_version_id` in the calibration-series identity.

**Band vs confidence (strict separation):** a *band* classifies a reading from the reading's own output only. It must never incorporate hit rate, baseline rate, lift, Wilson interval, sample size, or confidence. Calibration measures how a banded population performs historically; confidence later expresses the reliability of that evidence. Banding must not become a hidden confidence system.

---

## 3. OD-6.2A — MATCH_RESULT target semantics — RATIFIED

Established fact: the seven current module calculators do **not** declare that they predict `HOME_WIN`, `DRAW`, or `AWAY_WIN`. `MATCH_RESULT ∈ {HOME_WIN, DRAW, AWAY_WIN}` while `calibration_result.hit_rate = hit_count / observation_count` is binary, so a fixed positive event must be **declared** before `hit_rate` / `baseline_rate` have meaning.

- **OD-6.2A-1 — No current MATCH_RESULT calibration.** No current module is treated as a MATCH_RESULT predictor. MATCH_RESULT calibration is deferred until a future module version explicitly and defensibly declares a MATCH_RESULT target.
- **OD-6.2A-2 — TEAM modules.** `home_away_split` and `readiness_tracker` remain uncalibrated against MATCH_RESULT; their semantics stay team-phenomenon descriptions. No HOME_WIN/DRAW/AWAY_WIN target is manufactured.
- **OD-6.2A-3 — Magnitude modules.** `giant_killer_index` and `consistency_index` remain uncalibrated against MATCH_RESULT; no MATCH_RESULT target is manufactured. Future calibration may use outcome dimensions appropriate to what they actually measure.
- **OD-6.2A-4 — FIXTURE modules.** `rest_advantage`, `form_gap_accuracy`, and `travel_impact` have **no current MATCH_RESULT target**. Never infer `SUPPORTS → HOME_WIN` or `CONTRADICTS → AWAY_WIN` from their home-relative evidence; such a mapping is a new product claim requiring a separate explicit governance decision.
- **OD-6.2A-5 — NEUTRAL.** No current MATCH_RESULT-specific NEUTRAL policy is required, because no current module has a MATCH_RESULT target. This decision activates only if a future module version receives a MATCH_RESULT target.
- **OD-6.2A-6 — Future outcome dimensions.** Dimension-specific calibration is **permitted**; the architecture does not imply every module must be calibrated against match result. No future dimension is invented by this record.

---

## 4. Permanent calibration governance principle

> **Calibration evaluates an explicitly declared module claim. It must never infer a
> predictive target from a module's direction, naming, presentation, or consumer
> interpretation.**

Explicitly:

```
SUPPORTS    ≠ HOME_WIN
CONTRADICTS ≠ AWAY_WIN
```

…unless a future module-version contract explicitly declares that relationship.

---

## 5. OD-6.2 — Baseline rate — NOT CURRENTLY APPLICABLE

```
OD-6.2 STATUS: NOT CURRENTLY APPLICABLE
```

Reason: there is currently no declared MATCH_RESULT positive event. Therefore there is currently:

- no MATCH_RESULT hit definition;
- no MATCH_RESULT `baseline_rate` to define;
- no MATCH_RESULT `lift` to calculate;
- no MATCH_RESULT calibration series;
- no MATCH_RESULT confidence output.

This is **not** an unresolved owner decision; it is a decision with no currently applicable calibration subject.

---

## 6. OD-6.3 through OD-6.6 — currently not applicable

No current calibration target / outcome dimension exists, so none of these has a live calibration population:

- **OD-6.3 — Confidence mapping — not currently applicable.** No calibration output exists to map into confidence; the engine legitimately leaves `confidence` NULL.
- **OD-6.4 — Minimum sample gate — not currently applicable.** No series exists to gate.
- **OD-6.5 — Contextual calibration.** All current modules remain uncalibrated against MATCH_RESULT; how a module receives an appropriate outcome dimension is governed separately (see OD-6.2A-6).
- **OD-6.6 — Insufficient-data behaviour — not currently applicable.** No calibration series exists that could be below a gate.

No answers to these dormant decisions are invented here.

---

## 7. S-9D reactivation condition

S-9D reactivates when **either**:

1. a future module version explicitly declares a defensible MATCH_RESULT target; **or**
2. a future governed outcome dimension is introduced for one or more modules.

On reactivation, decisions proceed in dependency order:

```
target / outcome dimension
  → baseline_rate
  → confidence mapping
  → sample gate
  → contextual / eligibility rules
  → insufficient-data behaviour
  → implementation
  → verification
  → activation
```

This governance record does **not** activate any of those steps.

---

## 8. S-9C boundary

S-9C is **CLOSED**. Its objectives — deterministic sealing, fixture selection, snapshot-point eligibility (`asOf ≤ now`), as-of derivation, effective-period governance resolution, `NO_RULE_IN_FORCE` handling, lifecycle protection, idempotency, attribution, fixture isolation, future-point protection, production write boundary, and regression coverage — were proven (Gate 1 serial regression 101/101; production seals of fixtures 345 and 354, each independently DB-verified). S-9C must **not** be reopened merely to repeat evidence already established. Further snapshot sealing / accrual of remaining, backfill, or future fixtures is **operational governed work**, not a reason to reopen S-9C.

---

**OD-6.1 STATUS: RATIFIED**
**OD-6.2A STATUS: RATIFIED**
**OD-6.2 STATUS: NOT CURRENTLY APPLICABLE**
**S-9D STATUS: DORMANT / NOT CURRENTLY APPLICABLE**
**S-9C STATUS: CLOSED**
