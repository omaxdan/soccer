# S-5 Architecture Decision Record — Final

Resolves every item raised in [document 22](./22-phase8-s5-implementation-blocked.md). **That blocker is closed.**

---

## DEC-1 — Version semantics

**Decision: DECISION A.** The S-5 specification supersedes V1. Version 1.0.0 represents the S-5 implementation.

**Reason.** Version identity is `(feature_definition_id, designation)`; `rationale` is descriptive `text NOT NULL` bound by no constraint, so correcting it changes no identity. The immutability rule protects *attributed values* — **zero `feature_value` rows exist**, so nothing is restated. And nothing is being *changed*: 1.0.0 has never had a realised rule, only a rationale claiming one. S-5 establishes it for the first time.

**Timing.** The registry correction SHOULD land **before the first production write**, not "later". After the first write, values are attributed to a version whose recorded rationale misdescribes them.

---

## DEC-2 — Readiness composition

**Decision: approved as proposed.**

```
rest_component       = clamp(rest_advantage_days / 7, 0, 1) × 100
congestion_component = 100 − congestion_index

readiness = (50 × rest_component + 50 × congestion_component) / 100
```

**Weights:** rest 50%, congestion 50%. No evidence supports asymmetry; V1 assigned rest no weight at all, so nothing exists to inherit. A future re-weighting is a new `feature_version` — the governed path.

**Missing data:** both absent → **no row** (PD-07). One absent → renormalise over the present component; cite **one** lineage edge, not two.

**Arithmetic:** exact `numeric`, no IEEE 754, rounded **once** at the write boundary, half-up, to `value_scale = 2`.

---

## DEC-3 — Window precedence

**Decision: the S-5 windows own version 1.0.0.**

| Feature | Disposition |
|---|---|
| `rest_advantage` | **Superseded.** D-2 governs: days since the most recent completed fixture |
| `home_form` / `away_form` | **V1 carried across unchanged** — `(pts₅/15)×100 × 0.7 + (pts₁₀/30)×100 × 0.3`. The weighting operates inside the 10-fixture window, so it is compatible |
| `travel_impact` | **V1 carried across unchanged.** `avgKm14` is mean km *per trip*, so V1's band table applies to a per-trip average from any window |
| `congestion_index` | **Transformed, approved:** count completed fixtures over the previous 28 days, `rate = count / 2`, apply V1's original thresholds to that rate. Preserves V1's calibrated band semantics under a backward-looking window |

---

## DEC-4 — Index scale

**Decision: confirmed.** All `unit='index'` features: range **0–100**, **two decimals**, **half-up**, applied once at the write boundary.

`team.rest_advantage` is excluded — `unit='days'`, `value_scale=1`, unbounded above. Only its normalised component inside readiness is clamped.

---

## DEC-5 — Composite sampling *(new, ruled)*

**Decision: `sample_observation_count = MIN(consumed.sample_observation_count)`.** `sample_meets_threshold` is evaluated against that derived value.

**This is architecturally correct, and not merely convenient.** It is the same shape as LC-37, which governs provenance: *"A derived value is no stronger than the weakest input in its lineage."* Sampling by MIN applies that principle to evidence volume — a composite is no better-evidenced than its thinnest input. Two rules, one justification.

It also fixes the direction of causation correctly: **the measurement rule does not bend to make a threshold reachable.**

**Consequence, stated so the governance decision is informed.** `rest_advantage` contributes a fixed count of 1 (D-2 clarification 5), so `MIN(1, N) = 1` for every readiness value. **No threshold above 1 is ever satisfiable**, which makes `sample_meets_threshold` non-discriminating for this feature under *any* threshold. That is a property of composing with a fixed-count input, not a defect in the rule.

The honest threshold is therefore **1** — "at least one observation", true whenever a row exists — rather than 3, which would report "insufficient" for a value that is not.

For the five non-composite features, `sample_observation_count` is their own observation count; MIN does not apply, consistent with R-53's exemption for values with no lineage.

---

## Implementation impact

**Files affected:** the approved layout of document 21 §6, unchanged. No file added or removed. `squadContinuity.ts` remains absent per R-1.

### Registry amendments required before first production write

Both are governance operations. **S-5 performs neither.**

| # | Amendment | Required role | Performable? |
|---|---|---|---|
| 1 | `feature_definition.meaningful_sample_threshold` for `team.readiness_score`: **3 → 1** | `pt_platform_admin` | ✅ **Yes** |
| 2 | `feature_version.rationale` for the six implemented features: 1.0.0 is the S-5 rule, not a V1 carry-across | **`pt_owner` only** | ⚠️ **Not by `pt_platform_admin`** |

**⚠ Correction to the ruling as issued.** Amendment 2 was directed to `pt_platform_admin`. **That role cannot perform it.** Migration 016 grants it `UPDATE` on exactly five relations — `feature_definition`, `feature_calculator`, `feature_definition_context_kind`, `feature_source`, `feature_dependency` — and **`feature_version` is not among them.**

Verified against the live catalogue:

```
feature.feature_definition  UPDATE = true
feature.feature_version     UPDATE = false     ← pt_platform_admin
feature.feature_calculator  UPDATE = true
feature.feature_source      UPDATE = true
feature.feature_dependency  UPDATE = true
```

Checked across every role: **only `pt_owner` holds it**, and `pt_owner` is `NOLOGIN` by design. `pt_migration` does not hold it either.

**So amendment 2 is a migration, not an application operation.** That is proper — a migration is the governed path for a change no application role may make. It is **outside S-5's scope** and I have not written one.

**Assessment: non-blocking.** `rationale` is descriptive text with no constraint; no value, key or check depends on it. Implementation may proceed while it is scheduled. The cost of deferring is that 1.0.0 carries a historically inaccurate description — documented here, and recoverable at any time.

Amendment 1 **is** blocking for meaningful output: without it every readiness value reports `sample_meets_threshold = false`, and S-6 would read the feature as permanently insufficient.

### Blocking items remaining

**None for implementation.** Amendment 1 must land before first production write; amendment 2 should be scheduled but does not gate coding.

---

## Readiness

**S-5 is ready for implementation.**

Every decision is resolved. Every finding from document 22 has an explicit disposition. No formula is invented — three are carried across from V1 unchanged, one is transformed under an approved rule, one is superseded by an approved definition, and one composite is specified with approved weights.

The remaining registry work is governance, correctly separated from implementation, with the one correction recorded above.
