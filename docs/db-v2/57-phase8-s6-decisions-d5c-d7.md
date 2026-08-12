# Phase 8 S-6 — D-4 resolved; D-5c and D-7 decision package

Nothing implemented. No S-6 code, no migration created or applied, no seeding,
no S-7/S-8 change, no provider call. `provider_statistic` and G-1 untouched.

---

# ⚠ Correction to doc 56, before anything else

[Doc 56](./56-phase8-s6-decisions-d4-d5.md) states that
`module_reading.sample_meets_threshold`'s *"intended source is
`calibration.sample_gate`"*, and lists **D-7 as blocking any reading**. **That is
wrong.** It was an inference and the authoritative text contradicts it:

> **E7.07 Sample Gate — Relationships.** *"Applied to **Calibration Result**
> (E7.02); determines whether **Published Baseline** (E7.03) may present a clean
> rate."*
>
> **`calibration.sample_gate` COMMENT (009):** *"EVERY PUBLISHED RATE PASSES A
> DECLARED GATE OR IS MARKED UNVERIFIED — there is no third path (LC-133)."*

The gate governs **published rates**. It is applied to a calibration result and
decides `published_baseline.is_verified`. **It is not applied to a module
reading, and it does not decide `module_reading.sample_meets_threshold`.**

**Consequence: D-7 does not block S-6.** It blocks **S-9** publishing a clean
baseline. A separate, smaller gap does block S-6 — §D-5c below.

---

# D-4 — RECORDED AS DECIDED

> **Permitted by the existing contract.** LC-56 governs feature consumption by
> declaration, not by subject kind. A FIXTURE-scoped module may consume
> TEAM-scoped features where those features are declared inputs of the module
> definition.

## Can D-4a, D-4b and D-4c be resolved from existing LC / docs / code?

**Two of three: yes, from authoritative text. No new constraint is invented.**

### D-4c — must context kinds match? **RESOLVED: NO.**

> **E3.05 Module Evidence Item — Context.** *"Inherits the cited value's context,
> **which may differ from the reading's own where a module legitimately consumes
> a differently-scoped input**."* — **EXPLICIT**

Corroborated by LC-45 at the layer below — *"A dependency declares the context
mapping between consumer and consumed"* — which likewise permits a mismatch
provided it is declared. A `COMPETITION_SCOPED` fixture reading may cite an
`ALL_COMPETITIONS` team value; the context vocabulary exists precisely because
fatigue-type quantities *"do not partition"*.

*Residual, and it belongs to D-3, not here:* the module layer has no relation in
which to **declare** the mapping. Permission is settled; the declaration site is
the open half of D-3.

### D-4b — must all cited values share one `as_of`? **RESOLVED: NO.**

> **E3.05 — Example.** Three questions become answerable, the third being
> *"**whether a module's inputs had gone stale at the moment it spoke**."* —
> **EXPLICIT**

Staleness is something the model makes **detectable**, not something it forbids.
A rule requiring one shared instant would make that third question vacuous. The
only temporal constraint is `cited_feature_value_as_of ≤ reading_as_of`, enforced
per item.

*Remaining as a calculator convention, not a governance question:* which value
each side contributes — presumably each side's latest at or before the reading's
`as_of`. That is an implementation choice inside a module version's rule under
D-2, and needs no separate decision.

### D-4a — is a per-side input one declared input or two? **RESOLVED: TWO.**

Forced by the schema rather than by preference:

1. A citation names **one specific feature value**, not a definition — LC-63,
   **EXPLICIT**, and the composite FK enforces it.
2. `ck_module_evidence__present_within_declared` requires
   `present_input_count ≤ declared_input_count` — **STRUCTURAL**.
3. A fixture module consuming `team.home_form` for both sides cites **two**
   values. If it declared **one** input, `present_input_count` would exceed
   `declared_input_count` and the write would be refused.

**Per-side is the only unit under which the counts are both satisfiable and
meaningful.** It also makes partial availability expressible — home present, away
absent is `declared 2, present 1`, which "one input, half present" cannot say.

**No governance decision is required for D-4a, D-4b or D-4c.** All three follow
from text or constraints already in force.

---

# D-5a — `strength`. **UNRESOLVED, NON-BLOCKING**

**Correct 1.0.0 treatment: NULL.** Recommended on the following grounds, for your
confirmation.

| | |
|---|---|
| Nullable | `module.module_reading.strength numeric` — no CHECK, no bound, **one occurrence in the entire database** |
| INACTIVE must omit it | `ck_module_reading__inactive_is_silent` — **STRUCTURAL** |
| No scale exists to declare it on | E3.03 promises *"strength on a **declared scale**"*. `feature_definition` has `value_scale`; **`module_definition` has no scale column** among its twelve |
| No V1 analogue | V1's `ModuleReading` is `{def, status, headline, rows, baseline, verdict, code?, locked?}` — no magnitude of any kind |

Writing a number on an undeclared scale would produce a value nothing can
interpret, round or validate — the failure `feature_value`'s `value_scale` and
the `feature_scale_conformance` assertion exist to prevent one layer down.
**NULL until a governed scale exists** is representable today, needs no schema
change, and forecloses nothing: a later version may introduce a scale and begin
writing strength, which is exactly what a new `module_version` is for.

# D-5b — `confidence`. **UNRESOLVED, NON-BLOCKING**

**Correct 1.0.0 treatment: NULL.** Same grounds, plus one piece of evidence doc
56 did not have:

> **E3.04 Module Evidence.** *"…how many features contributed, whether any were
> below their meaningfulness threshold, whether any were estimated, and whether
> the expected inputs were all present. **Those set-level properties are what a
> reading's confidence rests on**."* — **EXPLICIT**

So confidence's **inputs are named** — the four evidence counts — and E3.03 bars
it from resting on effect size (*"grounded in sample rather than in the magnitude
of what it found"*). **What is absent is the function**, and nothing in the
repository supplies one. Writing a plausible one would attach a bounded 0–1
figure to every reading that consumers would reasonably treat as calibrated when
it is not.

**NULL until a governed derivation exists.** The evidence counts that would feed
it are written regardless, so no information is lost — confidence remains
computable retrospectively from stored evidence whenever the rule is decided.

---

# D-5c — `sample_observation_count`. **BLOCKING**

## The four quantities, proven distinct

Not four names for one thing — **four columns, in four relations, with four
owners:**

| # | Quantity | Column | Written by | State |
|---|---|---|---|---|
| 1 | **feature sample** | `feature.feature_value.sample_observation_count` NOT NULL | S-5 | exists, 0 rows |
| 2 | **module observation count** | `module.module_reading.sample_observation_count` NOT NULL | **S-6** | **undefined — this decision** |
| 3 | **baseline denominator** | `calibration.calibration_result.observation_count` NOT NULL | S-9 | exists, 0 rows |
| 4 | **pooled historical sample** | #3 where `published_baseline.is_pooled` | S-9 | — |

**V1's `Baseline.sample` maps to #3/#4, and demonstrably not to #2.** Its own
declaration says so — *"Number of historical matches behind `rate`"*, with
`sample: 1179, pooled: true` on a single fixture's reading. 1,179 is the
denominator of a pooled historical rate, not the number of observations *this*
reading rests on. **Equivalence is disproved, not merely unassumed.**

## What the model says #2 is

Two authoritative statements, and they point the same way:

> **E2.09 Feature Sample — Relationships.** *"Qualifies Feature Value (E2.05).
> **Propagates into Module Evidence Item (E3.05) and constrains what Module
> Reading (E3.03) may claim**."* — **EXPLICIT**

> **E2.09 — Example.** *"A form metric computed over three fixtures and one
> computed over thirty are structurally distinguishable, **so a module consuming
> the first can decline to speak** rather than speaking with false authority."*
> — **EXPLICIT**

> **E2.09 — Meaningfulness threshold.** *"A value below threshold is still
> recorded … but is marked as not meeting its own threshold, **and modules are
> constrained accordingly**."* — **EXPLICIT**

So #2 is **a quantity derived from the consumed features' counts**, and its
purpose is to let a module *decline to speak* on thin evidence — which is the
INACTIVE path (LC-69), not a presentational nicety.

**What is NOT stated is the function.** "Constrains" is not "equals MIN".

## The S-5 precedent — evidence, not inheritance

Doc 23 **DEC-5** ruled, for features:
`sample_observation_count = MIN(consumed.sample_observation_count)`; non-composite
features carry their own count. Doc 23 also records the cost honestly — an input
with a fixed count of 1 collapses `MIN` to 1 and makes no threshold above 1
satisfiable.

That is a **Layer-2 composition rule for a feature consuming features**. S-6 is a
Layer-3 module consuming features across subject kinds. The precedent is
available and coherent; **adopting it is a decision, not a deduction.**

## The separate gap: `sample_meets_threshold`

`module_reading.sample_meets_threshold` is **NOT NULL** and — per the correction
above — is **not** decided by `calibration.sample_gate`.

Features resolve theirs from `feature_definition.meaningful_sample_threshold`
(NOT NULL, default 0). **`module_definition` has no equivalent column.** But the
model says where a module's threshold lives:

> **E3.02a Module Version — Example.** *"**Revising a module's thresholds
> registers a new version.**"* — **EXPLICIT**

Under **D-2**, a module version's rule lives in code with the rationale stating
it. A threshold is part of that rule. So `sample_meets_threshold` is evaluable
**with no new column and no sample gate** — the module version declares its
threshold exactly as it declares its status rule.

**This is a consequence of D-2, offered for confirmation rather than assumed.**

## The minimum decision

> ### D-5c — What does a module reading's `sample_observation_count` count?
>
> **(a) `MIN(consumed.sample_observation_count)`** — the DEC-5 rule lifted to
> Layer 3. Consistent with E2.09's *"constrains what a Module Reading may
> claim"*; inherits DEC-5's known weakness that one thin input floors the whole
> reading.
> **(b) The number of feature values cited** — i.e. `present_input_count`. Cheap
> and always defined, but counts *inputs*, not *observations*, and would make
> LC-60's evidential standard nearly vacuous.
> **(c) A per-module-version rule**, consistent with D-2 — each version declares
> what its count means, bounded by E2.09.
>
> **And, following from it:** confirm that the module's **threshold** is
> likewise declared by the module version (E3.02a), so `sample_meets_threshold`
> needs no new column.

---

# D-7 — `calibration.sample_gate`

## 1–4. What is gated, and against what

| Question | Answer | Class |
|---|---|---|
| **Entity gated** | A **calibration result** (E7.02); the gate determines whether a **published baseline** (E7.03) may present a clean rate | **EXPLICIT** — E7.07 Relationships |
| **Population** | The measurement population behind that result — sealed, declared, reproducible (E7.06, LC-129) | **EXPLICIT** |
| **Quantity compared** | `calibration_result.observation_count` — quantity **#3**, never #2 | **STRUCTURAL + EXPLICIT** |
| **Global or specific** | **Both are representable.** `sample_gate.module_definition_id` is **nullable** → null is a platform-wide gate, non-null is module-specific. `applies_to_pooled` distinguishes pooled from competition-scoped, and E7.07 notes *"a competition-scoped gate is typically lower than a pooled one"* | **STRUCTURAL** |
| **Effect of failure** | `published_baseline.is_verified = false` — *"published as EXPLICITLY UNVERIFIED, never as a clean rate"* (LC-126) | **EXPLICIT** |
| **Effect on a reading** | **Indirect only.** LC-68: *"A reading whose baseline fails its sample gate is marked unverified"* — via the cited baseline (E3.06), **not** via the reading's own count | **EXPLICIT** |

## 5–7. Seeding, representability, minimum rows

**Seeded for 1.0.0?** Doc 15 §6.2 lists `calibration.sample_gate` with writer
**"Seeder"** — **EXPLICIT**. It holds **0 rows**.

**Representable without migration? YES.** All seven columns exist —
`gate_key`, nullable `module_definition_id`, `minimum_observation_count`
(`CHECK ≥ 1`), `applies_to_pooled`, `effective_period`, `rationale`. Uniqueness on
`gate_key`; non-overlapping periods per key. **Global gates, per-module gates and
pooled/scoped variants are all expressible today.**

**Minimum rows — structure only, values deliberately absent:**

| Scope | Rows | Why |
|---|---|---|
| Platform default, competition-scoped | 1 — `module_definition_id` null, `applies_to_pooled = false` | Without a default, a result for a module with no specific gate has no gate, and LC-133's *"no third path"* fails |
| Platform default, pooled | 1 — null module, `applies_to_pooled = true` | E7.07: pooled gates are typically higher; LC-132 says a pooled count cannot support a per-band interval |
| Per-module | 0..13, only where a module needs a different standard | Optional |

**Two rows is the minimum that satisfies LC-133.** The **values** are a product
commitment and are not invented here.

**When is it needed?** Before **S-9 publishes a baseline** — not before S-6 writes
a reading. Doc 15 §6.4 step 7 places it exactly there: *"Publish a baseline only
when the sample gate passes."*

## The minimum decision

> ### D-7 — What are the two default `minimum_observation_count` values?
>
> One for competition-scoped populations, one for pooled. Optionally, per-module
> overrides. **This does not block S-6** and is required before the first
> baseline is published.

---

# Status

| Item | State |
|---|---|
| **D-1** | DECIDED — S-6 waits for S-0 |
| **D-2** | DECIDED — per-module-version status rule. Rationale amendment prepared, **held** |
| **D-3** | DECIDED — typed row shapes are the input contract. Declaration *site* open |
| **D-4** | **DECIDED — permitted.** D-4a/b/c **resolved from existing evidence; no decision needed** |
| **D-5a** `strength` | Unresolved, non-blocking. **NULL at 1.0.0** recommended |
| **D-5b** `confidence` | Unresolved, non-blocking. **NULL at 1.0.0** recommended |
| **D-5c** count | **BLOCKING — one decision, three options** |
| **D-6** | Prepared, **held unapplied** |
| **D-7** | **NOT blocking S-6** (correction). Two threshold values needed before S-9 |

**The only decision blocking a module reading from existing is D-5c**, plus its
threshold confirmation. Everything else is either decided, resolved from
evidence, deferred to a later stage, or held.

**S-6 implementation still waits on S-0 under D-1.**
