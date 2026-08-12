# Phase 8 S-6 — D-5c final decision package

Nothing implemented. No migration created or applied, no seeding, no S-6 code,
no S-7/S-8 change. `provider_statistic` and G-1 untouched.

---

## Recorded, per instruction

**D-7 — not an S-6 blocker.** `calibration.sample_gate` governs published
baselines and published rates under E7.07 / LC-133. It belongs to the S-9 path;
it does **not** determine `module_reading.sample_meets_threshold`; S-6 is not
blocked on it. **The two-row seed requirement stays documented for S-9** — one
competition-scoped default, one pooled, both representable without migration —
and is **not seeded now**.

**D-4 — resolved.** (a) a declared per-side input is one declared input per cited
value; (b) cited values need no shared `as_of`; (c) cited context kinds need not
match the reading's. Established by E3.05, LC-63 and
`ck_module_evidence__present_within_declared`, all already in force.

**D-5a `strength` = NULL, D-5b `confidence` = NULL at 1.0.0.** This audit looked
for evidence making either mandatory and **found none**: both columns are
nullable, and `ck_module_reading__inactive_is_silent` positively *requires*
`strength` to be null for INACTIVE readings. Unchanged.

**D-1 — S-6 waits for S-0**, which remains responsible for deriving the bounded,
named input contracts before S-6 can evaluate them.

---

# Representability of option (c) — the six questions

## 1. Can a module version already declare its sample sufficiency rule?

**It can already IDENTIFY the rule. It cannot yet STORE the threshold.**

E3.02a's Purpose is unambiguous:

> *"The identity of a specific **rule** for producing a module's readings, with
> its effective period and predecessor."* — **EXPLICIT**

So a module version **is** a rule identity by definition. But its seven columns —
`id`, `module_definition_id`, `designation`, `effective_period`,
`predecessor_id`, `rationale`, `created_at` — hold no threshold and no
machine-readable rule. `module_definition`'s twelve hold none either.

## 2. If yes, where and how?

Two governed places, neither machine-readable:

| Vehicle | What it can carry | Limit |
|---|---|---|
| `designation` + `effective_period` | *Which* rule was in force when a reading was written | Names it, does not state it |
| `rationale` (text NOT NULL) | A prose statement of the rule, including its threshold | Not evaluable; a writer cannot read a number out of it |

**S-5's analogous handling, read directly:** calculators do **not** branch on
designation — verified, zero occurrences of `designation` in
`feature/calculators/`. The rule lives in code and is attributed to whichever
version has an open effective period. The **threshold**, separately, is read from
a registry **column**: `registry/load.ts` selects
`feature_definition.meaningful_sample_threshold` at load time.

**So S-5 splits them: rule in code, threshold in a column. S-6 cannot copy that
split, because the module-side column does not exist.**

## 3. If no — what is the smallest correct solution?

| Option | Assessment |
|---|---|
| **(i) Reuse an existing field** | The only candidate is `rationale`. Prose, not a number. Governs adequately, **evaluates not at all** |
| **(ii) A new versioned field** — `module_version.minimum_sample_observation_count integer` | One nullable column on a 7-column relation. Machine-readable, and see Q4 |
| **(iii) Code-defined rule bound to the open version** | Zero schema change. Matches S-5's *rule* handling — but S-5 still reads its threshold from a column, so this is **less** than S-5, not equal to it |

## 4. Which preserves "changing a threshold creates a new version"?

**Only (ii), and it does so by enforcement rather than by convention.** The
decisive evidence is a privilege asymmetry that has not been noted before:

| Relation | `pt_platform_admin` | Anyone with UPDATE? |
|---|---|---|
| `feature.feature_definition` | **SELECT, UPDATE** | **Yes** |
| `module.module_definition` | SELECT | **No — nobody** |
| `module.module_version` | SELECT | **No — nobody** |

- **At the feature layer the principle is NOT enforced.** `meaningful_sample_threshold`
  is updatable, and doc 23 Amendment 1 did exactly that — `team.readiness_score`
  3 → 1, applied in place by `pt_platform_admin`, **with no new version**.
- **At the module layer no principal can update either registry relation.**
  `module_version` is INSERT-only for `pt_pipeline_module` and SELECT for
  everyone else, and E3.02a states its lifecycle as *"Append-only. Registered,
  activated, retired; **never edited**"*, immutability *"Sealed on
  registration."*

**Therefore a threshold stored on `module_version` can only ever be changed by
inserting a new version row.** The principle of E3.02a's Example — *"Revising a
module's thresholds registers a new version"* — stops being an instruction and
becomes a property of the schema.

Option (iii) preserves it only by convention: code can change with no new row and
nothing detects it. Option (i) shares that weakness and adds unevaluability.

## 5. Does `sample_observation_count` then represent the rule's OUTPUT, not the threshold?

**Yes — and the three concepts stay separate, as they already are in the schema:**

| Concept | Where it lives | State |
|---|---|---|
| **count** — the observed quantity | `module_reading.sample_observation_count` (NOT NULL) | exists |
| **threshold** — the module-version requirement | **nowhere today**; option (ii) puts it on `module_version` | missing |
| **meets** — the evaluation result | `module_reading.sample_meets_threshold` (NOT NULL) | exists |

Two of three already exist and are correctly separated. Only the threshold has no
home.

## 6. Can `sample_meets_threshold` be evaluated deterministically?

**Under (ii): yes, and — decisively — reproducibly.**

`meets = (count ≥ version.minimum_sample_observation_count)`. Both operands are
stored, so a sealed reading's evaluation remains checkable **from the database
alone**, years later, against the version it cites.

**Under (iii) it is deterministic at write time but not reproducible afterwards.**
Re-deriving why a 2027 reading was marked insufficient would require the code
revision in force in 2027. That is the failure mode E3.06 exists to prevent —
*"the reading cites the baseline in force at that time, so a later re-measurement
does not retroactively alter what a historical reading claimed"* — and readings
are permanent and sealed into snapshots.

---

# 1. Final D-5c recommendation

> ## Adopt **(c) — a per-module-version rule** — with `MIN(consumed)` as the declared content of version 1.0.0.
>
> **(c) is the mechanism.** What a module's `sample_observation_count` counts is
> declared by the module version, exactly as D-2 places the status rule there.
> The two decisions then have one shape rather than two, and a version means one
> thing: *this module's rule, entire*.
>
> **`MIN(consumed.sample_observation_count)` is the recommended content for
> 1.0.0**, and it absorbs option (a) as a special case rather than competing
> with it.

**Why (c) and not (a) as the global rule:** (a) fixes one formula for all
thirteen modules forever, in a layer where E3.02a exists precisely so that rules
may differ and evolve per module. It would also have to be revised through a
mechanism nothing provides.

**Why not (b):** counting cited values counts *inputs*, not *observations*. A
module citing two features each resting on three fixtures would report 2, and
LC-60's standard — *"a rate without an observation count is a marketing figure"* —
would be satisfied in letter and defeated in substance.

**Why `MIN` for 1.0.0, stated as a recommendation and not as a derivation:**
E2.09 says the feature sample *"constrains what a Module Reading may claim"*. The
conservative reading of *constrains* is that a reading may not claim more
observations than its thinnest input supports — which is `MIN`. It is also what
doc 23 DEC-5 chose one layer down, so the platform composes counts the same way
at both layers. **"Constrains" is not literally "equals MIN", so this remains a
recommendation requiring your confirmation, not a fact read off the documents.**

**Inherited weakness, stated plainly:** doc 23 records that a fixed-count input
of 1 collapses `MIN` to 1 and makes no threshold above 1 satisfiable. Every
module consuming `team.readiness_score` inherits that, because `rest_advantage`
contributes a fixed count of 1. **A module's threshold of 1 would then be
non-discriminating.** This is a property of composing with a fixed-count input,
not a defect in `MIN`, and it is a reason to set 1.0.0 thresholds deliberately
rather than by analogy with the feature layer.

# 2. Exact representation required

One nullable column on a seven-column relation:

```sql
-- The sample-sufficiency threshold belongs to the RULE, and E3.02a makes the
-- version the rule's identity. Stored rather than compiled so that a sealed
-- reading's sample_meets_threshold stays reproducible from the database alone.
-- Nullable: a version may decline to set a threshold, in which case the
-- reading's sample_meets_threshold is evaluated against 0 and is trivially true
-- — the same posture as feature_definition.meaningful_sample_threshold's
-- DEFAULT 0.
ALTER TABLE module.module_version
  ADD COLUMN minimum_sample_observation_count integer;

ALTER TABLE module.module_version
  ADD CONSTRAINT ck_module_version__minimum_sample_non_negative
  CHECK (minimum_sample_observation_count IS NULL
         OR minimum_sample_observation_count >= 0);
```

**Prepared, not created and not applied.** `module_version` holds 13 rows and
`module_reading` holds 0, so both statements are non-blocking and validate
trivially. It touches no existing column, no existing constraint, and no other
relation.

**Why nullable rather than `NOT NULL DEFAULT 0`:** a default silently asserts
that every one of the thirteen registered versions has declared a threshold of
zero. Null says *"this version has not declared one"*, which is the truth today
and is distinguishable from a deliberate zero — the same distinction LC-69 draws
between INACTIVE and NEUTRAL.

# 3. Does that representation already exist?

**No.** Verified against the live schema: `module_version` has seven columns and
`module_definition` twelve; neither holds a threshold, a scale, or any
machine-readable rule. There is no analogue of
`feature_definition.meaningful_sample_threshold` anywhere in schema `module`.

**Everything else (c) needs already exists:** version identity, effective
periods, the `rationale` field in which the rule is stated, `module_reading`'s
count and meets columns, and the reading→version foreign key that binds an
evaluation to the rule that made it.

# 4. Remaining governance question

**One, and it is small:**

> **D-5c-i — Confirm `MIN(consumed.sample_observation_count)` as version 1.0.0's
> declared count**, accepting the fixed-count-input consequence above.
>
> *(If confirmed, and if the column is authorised, S-6 has no remaining semantic
> blocker. If declined, the alternative content for 1.0.0 is the open item —
> the mechanism (c) stands either way.)*

**Two consequential authorisations, both prepared and held:**

| | |
|---|---|
| The column above | Needed before any reading can have a reproducible `sample_meets_threshold` |
| D-6's `inactive_reason` column | Unchanged, still held |
| The D-2 rationale amendment | Unchanged, still held — and now it must also state each version's **threshold and count rule**, not only its status rule |

**A note on the rationale amendment and E3.02a's "never edited":** doc 23 DEC-1
already settled this shape for `feature_version` — identity is
`(definition, designation)`, `rationale` is descriptive text bound by no
constraint, so correcting it changes no identity; and the immutability rule
protects *attributed values*, of which there are **zero**. `module_reading` holds
0 rows, so the same reasoning applies unchanged. No new governance question.

# 5. Consequences for the two columns

**`sample_observation_count`** — NOT NULL, and now defined: **the quantity
produced by the module version's declared count rule**, which for 1.0.0 is the
minimum of the counts on the feature values the reading cites. It is *not* the
threshold, *not* the number of citations, and *not* a baseline denominator. The
four-quantity separation of doc 57 is preserved intact, and V1's
`Baseline.sample` remains excluded.

**`sample_meets_threshold`** — NOT NULL, and now evaluable:
`count ≥ version.minimum_sample_observation_count`, treating a null threshold as
0. Deterministic at write time and **reproducible from stored data afterwards**,
which a code-held threshold would not be.

**And a reading may still decline to speak.** E2.09's stated purpose — *"a module
consuming [a thin value] can decline to speak rather than speaking with false
authority"* — is served by the INACTIVE status under D-2's per-version rule, and
is deliberately **not** collapsed into `sample_meets_threshold`. A reading that
speaks with a below-threshold sample and one that abstains are different facts,
and LC-41's principle at the layer below is that a below-threshold value is
*"still recorded … never suppressed"*.

---

# Status

| | |
|---|---|
| D-1 | DECIDED — S-6 waits for S-0 |
| D-2 | DECIDED — per-module-version status rule |
| D-3 | DECIDED — declaration *site* remains the open half |
| D-4 / a / b / c | **DECIDED and RESOLVED** |
| **D-5a / D-5b** | **NULL at 1.0.0 — no evidence found making either mandatory** |
| **D-5c** | **Recommended: (c) with `MIN(consumed)` for 1.0.0. Awaiting D-5c-i** |
| D-6 | Prepared, held |
| D-7 | S-9 path. Two-row seed documented, not seeded |

**Held and unapplied: three prepared changes** — `module_version.minimum_sample_observation_count`,
`module_reading.inactive_reason`, and the `module_version.rationale` amendment.
**No migration created or applied.**

**S-6 implementation still waits on S-0 under D-1.**
