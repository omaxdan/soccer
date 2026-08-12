# Phase 8 S-6 — Decision record: D-1, D-3, D-6, D-7 recorded; D-2 package

**D-2 is not yet decided and is not decided here.** Four decisions are recorded
with their consequences; the fifth is presented as an analysis with the minimum
governance question isolated.

Nothing implemented. No S-6 code, no migration applied or created, no S-7/S-8
change, no production data, no provider call, `provider_statistic` and G-1
untouched.

---

# PART A — RECORDED DECISIONS

## D-1 — S-6 waits for S-0. **DECIDED**

> S-6 waits for S-0. V2 `1.0.0` is **not** redefined as a substitute rule merely
> to unblock S-6. S-0 must establish the derivation of the already-known named
> input fields from authoritative V2 data and reconcile them against the
> available V1/golden evidence. **Knowing the field names and types does not
> remove the need to establish their derivation.**

**Consequences, recorded:**

1. **The divergence from S-5 is deliberate and must not be cited as precedent.**
   [Doc 23](./23-phase8-s5-decision-record.md) DEC-1 resolved the identical
   authority conflict the *other* way — the S-5 specification superseded V1. D-1
   declines that route for S-6. The reason the two differ is now on the record:
   for S-5 the V1 computation was *readable and reproducible* and the conflict
   was about which of two known rules governed; for S-6 the V1 computation is
   **not reproducible at all** without the derivations, so "supersede V1" would
   not resolve a conflict — it would author a new rule under a version that says
   it carries an old one.
2. **`module_version` 1.0.0's rationale stands unamended**, and S-6 holds no
   UPDATE on `module_version` in any case (migration 016).
3. **S-0 is now on the critical path in its own right**: S-0 → S-6 → S-7 → S-8.
   Doc 15 registers it as risk B-1, owner Platform, still open.
4. **The scope of S-0 is narrowed but not reduced** (doc 54 §7.2): the fields to
   derive are a bounded, named, typed set — `TeamIntelligence` (12),
   `TeamFormQuality` (16), `TeamVenuePerformance` (8), `TeamMomentum` (3),
   `MatchScoringProbabilities` (18), `ModuleTravelRow` (6),
   `LeagueGapSummary` (8) — not thirteen unknown views. What S-0 must produce is
   the **derivation** of each field, sufficient for a V2 feature to reproduce the
   **number**, because doc 15 §6.4 step 5 compares values, not field names.

## D-3 — Declared inputs. **DECIDED**

> The already-identified, typed input row shapes **are** the declared S-6 module
> input contracts. No additional inputs are invented. Where those fields are
> derived remains part of S-0.

**Consequences, recorded:**

1. **Doc 54's G-e / doc 25's B-5 is now half-answered.** *What* a module declares
   is settled — the typed row shape it consumes. *Where the declaration is
   held* is still open, because `module_evidence.declared_input_count` is NOT
   NULL and no relation in schema `module` declares inputs.
2. The residual question is a **representation** question, not a content one:
   whether the declaration lives in a new `module.module_input` relation (a
   migration) or in calculator code with the count derived from it. That does
   **not** block D-2 and is deferred with D-4/D-5.
3. `operations.quality_check.module_input_conformance` — *"Every evidence
   citation falls within the consuming module's declared inputs"* — remains
   unimplementable until that representation is chosen. It is registered,
   unimplemented, and correctly reported as such by the S-12 runner
   ([doc 53](./53-phase8-s12-quality-assertions.md)).

## D-6 — The INACTIVE reason. **CONTRADICTION RECORDED; CORRECTION PREPARED**

**The contradiction, stated exactly:**

| Side | Source |
|---|---|
| A reason **must** be stored | Doc 15 §6.3: `inactive(def, reason)` → *"`module_status_code = 'INACTIVE'` **with a stored reason**"* |
| No column holds one | `module.module_reading` has 21 columns; the only free text is `headline_text` and `verdict_text`, both defined as the module's *conclusion* (E3.08, E3.09), which an abstention does not have |
| INACTIVE is constrained toward silence | `ck_module_reading__inactive_is_silent`: INACTIVE ⇒ `strength IS NULL AND published_baseline_id IS NULL` |

**No workaround implemented.** Overloading `verdict_text` with a reason would put
an abstention's cause in the column reserved for a module's plain conclusion, and
`operations.quality_check` has no assertion that would catch it.

### The prepared correction — NOT APPLIED, NOT WRITTEN AS A MIGRATION FILE

Smallest change that makes the governed contract representable. One column, one
constraint:

```sql
-- Doc 15 §6.3 requires an INACTIVE reading to carry a stored reason, and no
-- column held one. Distinct from verdict_text (E3.09), which is the module's
-- CONCLUSION — an abstention has no conclusion, it has a cause.
ALTER TABLE module.module_reading
  ADD COLUMN inactive_reason text;

-- Present exactly when the reading abstained. LC-69 makes INACTIVE and NEUTRAL
-- distinct; this makes the distinction legible rather than merely encoded.
ALTER TABLE module.module_reading
  ADD CONSTRAINT ck_module_reading__inactive_reason_stated CHECK (
    (module_status_code =  'INACTIVE' AND inactive_reason IS NOT NULL) OR
    (module_status_code <> 'INACTIVE' AND inactive_reason IS NULL)
  );
```

**Safety, verified:** `module.module_reading` holds **0 rows**, so both
statements are non-blocking and the CHECK validates trivially. `ADD COLUMN`
propagates to all 61 partitions.

**It does not weaken `ck_module_reading__inactive_is_silent`** — that constraint
governs `strength` and `published_baseline_id` and is untouched. Silence about a
*measurement* and a stated *reason for abstaining* are different things, which is
LC-69's whole point.

**Requires your approval before it becomes migration 023.** It is a schema change
and therefore a schema-owner decision.

## D-7 — `calibration.sample_gate`. **RECORDED; SEED REQUIREMENT PREPARED**

**Recorded:** `calibration.sample_gate` is an explicitly assigned **seeded**
registry — doc 15 §6.2 lists it with writer *"Seeder"* — and it holds **0 rows**.
No seed stage writes it. S-6 must not invent thresholds; it **reads** them.

**Verified privileges** (scratch cluster, `pg_class.relacl`):

| Role | `calibration.sample_gate` |
|---|---|
| `pt_pipeline_calibration` | **INSERT, SELECT** |
| `pt_pipeline_module` | **SELECT only** |
| `pt_pipeline_projection`, `pt_platform_admin` | SELECT |

So the schema already enforces D-7: **S-6 structurally cannot write a gate.**

### The prepared seed requirement — NOT IMPLEMENTED

| | |
|---|---|
| **Stage** | A new stage in `src/v2/seed/runAll.ts`, after the module registry — the gate references `module_definition_id` |
| **Role** | **`pt_pipeline_calibration`**, the only role holding INSERT. It is not currently in `SEED_ROLES` and must be added |
| **Shape** | `gate_key`, `module_definition_id` (nullable — **null means a platform-wide default gate**), `minimum_observation_count`, `applies_to_pooled`, `effective_period`, `rationale` |
| **Discipline** | `INSERT … ON CONFLICT DO NOTHING` on `gate_key`, matching every other seed. Insert-only, never updated: a changed threshold is a new gate, because it changes what "verified" means |
| **Same class as** | `operations.quality_check_version`, the unseeded registry closed in doc 53 |

**What is still needed from you and is NOT prepared:** the **threshold values**
and their scope — one platform-wide gate, or one per module, and what
`minimum_observation_count` is for each. Those are product decisions and are
deliberately not invented. They are **not** required to decide D-2.

---

# PART B — D-2 DECISION PACKAGE

**The status derivation.** Presented for decision, not decided.

## ⚠ Correction first — the premise of the question is wrong

[Doc 54](./54-phase8-s6-specification-gap-analysis.md) §9 D-2 states that *"V1
derives SUPPORTS/CONTRADICTS relative to a viewer's selection, which V2
forbids."* **That is incorrect, and the error is mine.** Read to its source,
`pickSide` is not a viewer's selection:

```ts
// modules.ts:1266
export function derivePickSide(match: MatchRow): "home" | "away" | null {
  const gap = match.intel?.readiness_gap ?? null;
  if (gap == null || gap === 0) return null;
  return gap > 0 ? "home" : "away";
}
```

**`pickSide` is computed from the data — the sign of `readiness_gap`.** No user
input reaches it anywhere in the codebase. The name is misleading; the mechanism
is a **derived orientation**.

This changes D-2 materially. LC-71 forbids *"a recommended action, stake, or
selection"*. A side derived from the platform's own readiness signal is none of
those — it is which team the evidence leans toward, which is precisely what a
*characterisation* is. **So V1's rule is not disqualified by LC-71 on the ground
doc 54 gave.** The real question is narrower and is stated in §7.

## 1. Exact V1 semantics, established from code

Seventeen status derivations exist. **Only six consult the orientation at all;
eleven derive status from the module's own characterisation with no orientation
whatsoever.**

**Orientation-free (11)** — status from the module's own finding:

| Function | Rule |
|---|---|
| `evalConfidence` | band `Elite`/`Strong` → SUPPORTS · `Moderate` → NEUTRAL · else CONTRADICTS |
| `evalReadinessTracker` | trend `Surging` → SUPPORTS · `Crashing` → CONTRADICTS · else NEUTRAL |
| `evalConsistency` | `Erratic` → CONTRADICTS · volatility ≤ 0.6 → SUPPORTS · else NEUTRAL |
| `evalGiantKiller` | `Strong vs top` → SUPPORTS · `Flat-track bully`/`Struggles vs top` → CONTRADICTS · else NEUTRAL |
| `evalHomeAway` | `Neutral` type → NEUTRAL · \|disparity\| ≥ 40 → SUPPORTS · else NEUTRAL |
| `evalTravel` | six literal branches |
| `evalBttsFatigue`, `evalHalftime` | rate ≥ threshold → SUPPORTS · else NEUTRAL |
| `evalWeather` | always NEUTRAL |
| `evalLeagueGoals` | no orientation |

**Orientation-dependent (6):** `evalRest`, `evalCleanSheet`,
`evalHomeAwayMatch`, `evalReadinessMatch`, `evalConsistencyMatch`,
`evalGiantKillerMatch` — the last four via a shared helper:

```ts
function sideStatus(pickSide, homeFavourable, awayFavourable): ModuleStatus {
  if (pickSide == null) return "neutral";
  const pickOk = pickSide === "home" ? homeFavourable : awayFavourable;
  const oppOk  = pickSide === "home" ? awayFavourable : homeFavourable;
  if (pickOk && !oppOk) return "supports";
  if (oppOk && !pickOk) return "contradicts";
  return "neutral";
}
```

**Two further facts that bear directly on the decision:**

- **The same four modules have BOTH rules.** `evalHomeAway` (team scope,
  orientation-free) and `evalHomeAwayMatch` (match scope, orientation-relative)
  are the same module evaluated two ways — and V2 registers all four of these as
  **TEAM**-subject, i.e. the scope whose V1 rule needs no orientation.
- **V1's no-orientation fallbacks disagree with each other.** `evalRest` returns
  **SUPPORTS** when there is no orientation (`pickSide == null || …`); `sideStatus`
  returns **NEUTRAL**. V1 has no single answer to "what is the status when
  nothing orients it", which is itself evidence that the rule was never governed.

## 2. What in V2 makes those semantics non-portable

| Constraint | Effect |
|---|---|
| **LC-71** — no construct for a recommended action, stake or selection | Bars a *selection*. **Does not bar a derived orientation** — see the correction above |
| **`readiness_gap` does not exist in V2** | V1's orientation comes from a field of the `mv_*` estate. V2 has `team.readiness_score` (TEAM-subject); a fixture-level gap would have to be **composed from two teams' features** — which is exactly D-4, undecided |
| **`module_reading` has no orientation column** | 21 columns; none names a side, an orientation or a favoured team. An orientation could be *used* in the derivation but **cannot be recorded**, so a reading's status would not be explainable from the stored row |
| **The four orientation-using V1 modules are TEAM-subject in V2** | A TEAM-subject reading has one team as its subject. "Home vs away" is not expressible about a single team outside a fixture |
| **S-5 delivers 6 calculated features, all TEAM** | `feature.feature_value` holds **0 rows**. No orientation input exists to compute against today |

## 3. Everywhere V2 defines or constrains `module_status_code`

| Location | What it establishes | Class |
|---|---|---|
| `002:321` vocabulary | **`SUPPORTS` = "The module's reading agrees with the characterisation." `CONTRADICTS` = "argues against the characterisation." `NEUTRAL` = "spoke and found nothing of consequence." `INACTIVE` = "Insufficient data to speak."** | **EXPLICIT** |
| `module_status.is_engaged` | TRUE for all but INACTIVE | STRUCTURAL |
| `008` `fk_module_reading__status` | Only these four codes | STRUCTURAL |
| `ck_module_reading__inactive_is_silent` | INACTIVE ⇒ no strength, no baseline | STRUCTURAL |
| LC-69 (`002` comment) | INACTIVE and NEUTRAL are distinct and separately scored | EXPLICIT |
| LC-73 / `snapshot_verdict` | Four consensus counts, inactive held separately | EXPLICIT |
| Doc 07 E3.07 | Vocabulary is governed; a meaning may **not** be redefined — sealed readings reference it | EXPLICIT |
| Doc 07 E3.03 | A reading states status, strength, confidence, sample | EXPLICIT |
| Doc 15 §6.3 | V1's `status` derivation *"becomes data"* — `module_reading.module_status_code` | EXPLICIT |
| **Nowhere** | **What "the characterisation" refers to** | **UNKNOWN** |

### The circularity this exposes

The vocabulary says a status agrees or disagrees with *"the characterisation"*.
The only thing V2 calls a characterisation is **E4.05 Snapshot Verdict** — *"a
characterization of the fixture, not a prediction of its result"*. But the
verdict's consensus counts are **composed from the readings' statuses** (§6.5,
LC-73).

**So read literally, status depends on the characterisation and the
characterisation depends on status.** Any workable interpretation must break that
loop — by reading "the characterisation" as something other than the snapshot
verdict. **This is the core of D-2.**

## 4–5. Plausible interpretations, with what each requires

Only interpretations supported by existing evidence appear. **None is
recommended.**

### I-1 · Self-referential — status is the module's own finding

*"The characterisation" is the module's own.* SUPPORTS = the module found the
condition it exists to detect; CONTRADICTS = it found the opposite; NEUTRAL =
neither.

| | |
|---|---|
| **Requires** | Only the module's own inputs |
| **Data exists?** | **Yes**, once S-0 lands. No orientation, no cross-subject composition |
| **Satisfies** | LC-71 trivially; LC-69; the FK; `inactive_is_silent`; needs no new column |
| **Conflicts** | The vocabulary's *"the characterisation"* reads as external, not the module's own. Breaks the §3 circularity by construction |
| **V1 evidence** | **11 of 17 derivations already work this way**, including all four V2 TEAM modules at their V2 subject kind |
| **Consequence** | "Supports" and "contradicts" become module-relative: a travel module contradicting means "travel burden is adverse", not "argues against a conclusion" |

### I-2 · Orientation-relative — status is relative to a derived favoured side

V1's mechanism, carried across: derive an orientation from a designated signal,
then SUPPORTS/CONTRADICTS relative to it.

| | |
|---|---|
| **Requires** | (a) a designated orientation signal; (b) **fixture-level composition of two teams' features** — D-4; (c) a place to record the orientation, or readings become unexplainable |
| **Data exists?** | **No.** `readiness_gap` has no V2 equivalent; composition is undecided; no column holds an orientation |
| **Satisfies** | LC-71, as corrected — a derived orientation is not a selection |
| **Conflicts** | Not expressible for a TEAM-subject reading (7 of 13 modules, 4 of them the ones whose V1 rule uses orientation); **needs a schema change** to record the orientation; **depends on D-4** |
| **V1 evidence** | 6 of 17 derivations, and V1's own two no-orientation fallbacks disagree |

### I-3 · Baseline-relative — status is relative to a published baseline

SUPPORTS = the observed condition beats the published rate; CONTRADICTS = falls
short; NEUTRAL = within tolerance.

| | |
|---|---|
| **Requires** | `calibration.published_baseline` rows, and a tolerance rule |
| **Data exists?** | **No.** 0 baselines, 0 sample gates (D-7). Baselines are published by S-9, **after** S-6 in the ordering |
| **Satisfies** | `module_reading.published_baseline_id` exists and is nullable, so the citation is representable; strongly consonant with §6.4 step 7 |
| **Conflicts** | **Ordering.** S-6 precedes S-9, so early readings would have no baseline and `inactive_is_silent` would force them INACTIVE — a module reporting INACTIVE for want of *calibration* rather than *data*, which LC-69 explicitly separates |
| **V1 evidence** | V1 attaches a baseline to every reading but **never derives status from it** |

### I-4 · Verdict-relative — status is relative to the snapshot characterisation

The literal reading of the vocabulary.

| | |
|---|---|
| **Requires** | A characterisation existing **before** the readings |
| **Data exists?** | **No**, and it cannot: `snapshot_verdict` is composed from the readings |
| **Conflicts** | **Circular** (§3). Would require a two-pass model — a provisional characterisation, then readings against it — which nothing in the repository describes |
| **V1 evidence** | None. V1 has no snapshot |

### I-5 · Per-module — each module declares its own status rule

No single rule; each calculator states its own, governed by its `module_version`.

| | |
|---|---|
| **Requires** | Nothing structurally; each rule is part of its version's meaning |
| **Data exists?** | Yes |
| **Satisfies** | Consonant with LC-53 (calibration series keyed by version) |
| **Conflicts** | Makes the **vocabulary meaning module-dependent**, and doc 07 E3.07 says a status meaning *may not be redefined*. Calibration scores statuses across modules (E7.10); if SUPPORTS means something different per module, cross-module consensus counts (LC-73) aggregate incommensurable things |
| **V1 evidence** | **This is literally what V1 does** — seventeen hand-written rules |

## 6. Can any interpretation be selected from authoritative documentation alone?

**No.** Precisely one authoritative sentence defines the semantics — *"the
module's reading agrees with the characterisation"* — and:

- the term **"the characterisation" is defined nowhere**;
- its only V2 referent (E4.05) makes the definition **circular**;
- doc 15 §6.3 states only that the derivation *"becomes data"*, not what it is;
- doc 07 E3.03/E3.07 govern the vocabulary's **stability**, not its **application**;
- no architecture document, implementation specification or decision record for
  S-6 exists (doc 25 B-1).

**I-1 and I-5 are the only two implementable with data that exists or will exist
from S-0 alone.** I-2 depends on D-4 and a schema change; I-3 inverts the
S-6/S-9 ordering; I-4 is circular. But *implementable* is not *authorised*, and
choosing among them assigns a meaning to a governed vocabulary — which doc 07
E3.07 places under platform governance, not implementation.

## 7. The minimum decision required

One question, with a second that follows only if the first is answered a
particular way.

> ### D-2 — What is "the characterisation" that a module's status agrees or disagrees with?
>
> **(a)** The **module's own finding** — status is module-relative (I-1).
> **(b)** A **derived orientation** — which side of a fixture the evidence
> favours (I-2). *If (b), D-2b follows: which signal derives it, and where is it
> recorded? Both are new; neither exists.*
> **(c)** A **published baseline** — status is performance against a calibrated
> rate (I-3).
> **(d)** **Per module**, under its own version (I-5) — accepting that SUPPORTS
> then means different things in different modules, and that consensus counts
> aggregate them anyway.

**Why only this is asked:** everything else about status is already settled and
is recorded in §3 — the four codes, that they are governed and unredefinable,
that INACTIVE is silent and distinct from NEUTRAL, that they are separately
scored, and that consensus retains all four counts. The single undetermined term
is the referent of "the characterisation".

**What the answer unblocks:** D-4 becomes answerable (only (b) forces
cross-subject composition), and D-5 becomes answerable (only (c) ties `strength`
to a baseline). Neither is resolved here.

**What it does not unblock:** S-6 implementation still waits on S-0 under D-1.

---

**Nothing implemented. No migration applied or created — the D-6 correction is
prepared text awaiting approval. No S-7/S-8 change, no production data, no
provider call. `provider_statistic` and G-1 untouched. D-4 and D-5 deliberately
unresolved.**
