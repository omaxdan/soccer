# Phase 8 — S-0 Completion & S-6 Critical-Path Audit

## Programme audit only · nothing implemented

| | |
|---|---|
| Latest | `a6336df` (doc 71, travel line closed) |
| **Executive conclusion** | **S-0's substantive decisions are COMPLETE. "S-0 blocks S-6" is now largely STALE as a *decision* blocker — it has become an *execution* gate.** |
| **Root dependency** | D-1, and it is **satisfied**: S-0 provided the recovery baseline and the DEC-1-style ruling that module `1.0.0` = the V2 rule where V1 is defective |
| **Single minimum unblocking action** | **Create migration 023** (two authorised, uncreated columns). Everything semantic is decided; the pending `-i` items are ratifications |
| **S-6 design** | can proceed (largely done) · **S-6 implementation** | not yet — pending the execution items in §16 |
| **Travel architecture** | **CLOSED** (do not reopen) |

Nothing implemented. No migration, registry, module, dependency, value, or
calibration change; no travel/readiness/DEC-2 change; no new feature.

---

## 1. Executive conclusion

The travel line (docs 61–71) closed the **last genuinely-open S-0 decision** —
`S-0-a-i`, the `travel_impact` PARTIAL. With it closed, the S-0 recovery matrix
(docs 59–60) has **no remaining UNRECOVERABLE item and no remaining blocking
decision**. What still carries the "S-0" label is: (a) two/three trivial `-i`
*ratifications*, and (b) *transcriptions* that doc 60 itself labels "not decisions
— unblocked." Neither is an S-0 recovery finding.

The recurring "S-0 → S-6" gate was real when it was written (D-1: module `1.0.0`
could not be reproduced without the `mv_*` derivations). S-0 resolved that by
ruling V2 semantics supersede where V1 is defective and classifying all thirteen
modules RECOVERABLE. **That precondition is now met.** The path to S-6 is no longer
an unresolved decision; it is execution work: confirm the pending `-i` items,
create the authorised **migration 023**, and build the **S-6 module engine** (no
module code exists). The single smallest step is migration 023.

## 2. Complete S-0 inventory

From docs 25–27 (S-0 origin), 59 (recovery matrix), 60 (final decisions), 61–71
(travel), and the S-6 decision records 54–58.

| S-0 item | Source | Status |
|---|---|---|
| Recovery matrix — 13 module input contracts derived | 59 | **A RESOLVED** |
| All 13 modules classified (0 UNRECOVERABLE) | 60 | **A RESOLVED** |
| S-0-a `travel_impact` (the one open PARTIAL) | 60→61–71 | **A RESOLVED** (travel line, `a6336df`) |
| S-0-a-i confirm Option B + fixture-differential | 60→71 | **A RESOLVED** |
| S-0-b `league_goal_profiles` (BTTS from result, prediction dropped) | 60 | **A RESOLVED** |
| S-0-c `readiness_tracker` acceptance criterion | 60 | **A RESOLVED** (V2 golden from declared rule) |
| S-0-c-i confirm golden-file rescoping (doc 15 §6.4 step 5) | 60 | **G NEEDS RATIFICATION** (methodology; not a code/schema blocker) |
| `confidence_calibration` component weights | 60 | **transcription — S-6 impl work** (doc 60: "not a decision, unblocked") |
| `giant_killer_index` tier boundaries | 60 | **transcription — S-6 impl work** |
| four inactive modules (squad_stability, historical_advantage, risk_assessment, match_context) | 60 | **D DEFERRED** (no decision until activation) |
| `readiness_score` six-component V1 formula | 59 | **F SUPERSEDED** by DEC-2 |
| V1 `classifyTrend` defect (unreachable branches) | 60 | **F SUPERSEDED** (V2 rule replaces it) |

## 3. Resolved decisions

All S-0 recovery classifications; S-0-a/b/c; S-0-a-i; the entire travel line
(docs 61–71); and the S-6 decision records that depended on S-0:

| D | State (docs 57/58) |
|---|---|
| D-1 | **DECIDED** — S-6 waits for S-0; `1.0.0` = V2 rule where V1 defective |
| D-2 | **DECIDED** — per-module-version status rule |
| D-3 | **DECIDED** — typed row shapes are the input contract; *declaration site* is the open half |
| D-4 / a / b / c | **DECIDED and RESOLVED** — FIXTURE modules may cite TEAM features |
| D-5a / D-5b | **DECIDED** — `strength` / `confidence` NULL at `1.0.0` |
| D-5c | **Recommended (c) `MIN(consumed)`** — awaiting ratification D-5c-i |
| D-6 | **Prepared, held** — migration 023 (`module_reading.inactive_reason`) |
| D-7 | **S-9 path, NOT an S-6 blocker** — `calibration.sample_gate` governs published rates |

## 4. Implemented decisions

Layer-1/2 feature layer (S-5), from source (`pipeline.ts`, `declare.ts`,
`featureRegistry.ts`):

- Calculators live: `formBackfill`, `fixtureLoad` (rest_advantage + congestion_index),
  `travelLoad` (travel_impact), `teamReadiness` (readiness_score), `travelItinerary`
  (travel_distance).
- **No module (Layer-3) code exists** — `beta/backend/src/v2/module` is absent; only
  `seed/moduleRegistry.ts` (identity + version) exists.

## 5. Empirically verified decisions

`team.travel_distance` — verified against real provider data (doc 65, `7f6e9a4`):
20 teams, 94 candidates, 0 discrepancies, all four V1 defects refuted, millisecond
boundary and zero-vs-no-value confirmed. This is the **only** feature carried
through empirical verification; the others rest on the S-5 test suite.

## 6. Deferred-by-design decisions

- Four inactive modules (no consumer, no spec) — activate later.
- `travel_burden` materialisation (λ=0 adds nothing) — doc 69.
- `travel_recency` — separate future gate.
- D-7 `sample_gate` seeding — S-9, not S-6.
- Migration 023's scope is minimal by design (§7); the checksum canonical form
  (S-7), retention granularity, and calibration all sit beyond S-6 start (doc 54).

## 7. Actual blockers

Precisely three, none of which is an unresolved S-0 recovery finding:

1. **Migration 023 does not exist.** Authorised across D-2/D-5c/D-6, never created.
   It carries the two columns a module reading needs to be *written*:
   `module_version.minimum_sample_observation_count` (so `sample_meets_threshold`
   has a per-version basis at S-6, independent of S-9's `sample_gate`) and
   `module_reading.inactive_reason` (the doc-15 promised reason). Confirmed absent:
   `v2/migrations/` ends at `022`.
2. **The S-6 module engine does not exist.** No calculator, no reading generator,
   no evidence collector. Design is specified (docs 54–58, 70–71); code is not.
3. **Two ratifications + one open sub-decision**, all small:
   `D-5c-i` (confirm `MIN(consumed)`), `S-0-c-i` (confirm golden rescoping), and
   `D-3`'s *declaration site* (recommend calculator-code declaration with derived
   `declared_input_count` — needs no migration, per docs 56/57).

## 8. Obsolete / superseded items

- `readiness_score`'s six-component V1 formula → superseded by DEC-2.
- V1 `classifyTrend` (`"SURGING (+12)"` vs `=== "Surging"`, unreachable branches)
  → superseded; V2 rule declared by `readiness_tracker` `1.0.0`.
- V1 travel band table + hardcoded rates → superseded (S-0-a); belong in
  calibration, "not module inputs."
- The blanket historical claim **"S-0 blocks S-6"** → **now stale** as a decision
  blocker (§9).

## 9. Root S-0 → S-6 dependency — traced

The dependency was **D-1**: the nine active modules' `module_version 1.0.0`
asserts V1's logic, and that logic *"cannot be reproduced without the `mv_*`
derivations … Either S-0 recovers them, or 1.0.0 is redefined as the V2 rule"*
(doc 54). It is **not** a data-contract, provenance, calc-context, calibration, or
database-state issue — it is a **specification-provenance** issue: what rule does
`1.0.0` mean?

S-0 answered it (docs 59–60): the derivations are recoverable, and where V1 is
defective (readiness_tracker, league_goal_profiles, travel_impact) **V2 semantics
supersede** — the DEC-1 ruling, one layer up. With travel (the last PARTIAL)
closed, **D-1's precondition is fully satisfied.** The root blocker is resolved;
what remains (§7) is execution, not recovery.

## 10. V2 feature-graph state (from source; DB unavailable, egress denied)

```
LAYER 1 (implemented, consume no feature)
  team.home_form, team.away_form        formBackfill
  team.rest_advantage                    fixtureLoad     OBSERVED 4
  team.congestion_index                  fixtureLoad     DERIVED 3
  team.travel_impact                     travelLoad      DERIVED 3  (legacy V1-derived; untouched)
  team.travel_distance                   travelItinerary DERIVED 3  (VERIFIED)
  team.squad_stability                   —  registered, never calculated (R-1)

LAYER 2 (composite, the only lineage producer)
  team.readiness_score  ← rest_advantage
                        ← congestion_index          (exactly 2 dependency edges)

LAYER 3 (modules)
  13 registered (moduleRegistry.ts); 9 active, 4 inactive; 0 implemented (no engine)
  #5 travel_impact: FIXTURE, OUTCOME_SCORED/MATCH_RESULT — kept unchanged (doc 71)
```

`travel_distance`, `travel_impact` and `squad_stability` are intentionally
unconsumed; `travel_burden` is unmaterialised. Nothing in the graph is broken or
pending a *decision*.

## 11. S-6 prerequisites — required-to-START vs required-later

| Prerequisite | To START S-6? |
|---|---|
| D-1/D-2/D-3/D-4/D-5 semantic decisions | **done** |
| D-5c-i, S-0-c-i ratifications; D-3 declaration site | **required to start** (trivial) |
| Migration 023 (2 columns) | **required to start** — readings can't be written without a threshold basis + inactive_reason |
| S-6 module engine (evidence collect → reading → status/strength/confidence/verdict) | **required to start** |
| Feature values present for evidence | needed at **run** time (S-5 produces them); not for building the engine |
| `calibration.sample_gate` / `published_baseline` (D-7) | **required LATER** (S-9), not to start |
| Checksum canonical form (S-7), retention granularity | **required LATER** (doc 54) |
| Four inactive modules | **not required** (registered inactive) |
| Confidence_calibration weights, giant_killer boundaries | transcriptions, done **within** S-6 impl of those modules |

## 12. What can proceed before full S-0 closure

Effectively everything, because S-0's substance is done:

- **S-6 design** — already delivered (docs 54–58, 70–71). Complete.
- **Migration 023** — can be authored now (all three prepared changes are decided).
- **The S-6 module engine skeleton** — evidence collection, reading construction,
  status derivation per D-2, `MIN(consumed)` sample per D-5c — can be built against
  the decided contracts; it does not need the `-i` ratifications to be *designed*,
  only to be *finalised*.
- **Blocked-until-later only:** anything touching `sample_gate`/calibration (S-9)
  and the outcome-scored publication of module #5's travel bands.

## 13. Database / registry state

Live DB unavailable (egress denied at proxy; not retried). Authoritative source +
prior empirical evidence:

- **Feature registry:** 8 definitions; 5 calculators; 2 dependency edges; `travel_distance`
  sources `fixture, venue` (verified in-DB earlier this session).
- **Feature values:** 0 in the scratch cluster; production unknown but irrelevant to
  this audit.
- **Module registry:** 13 `module_definition` seeds; `module_version` 1.0.0 identities;
  **0 module_reading / module_evidence** (no engine).
- **Calibration:** `sample_gate`, `published_baseline`, `calibration_series` all
  **empty** (D-7 unseeded; S-9 not run).
- **Migration 023:** **not present.**

## 14. Source-vs-decision discrepancies

| Discrepancy | Class |
|---|---|
| Docs say "migration 023 prepared"; `v2/migrations/` has none | **actual blocker** (§7.1) — expected, it was explicitly *held* |
| Docs 54–58 specify the module engine; no `module/` code | **actual blocker** (§7.2) — expected, S-6 unimplemented |
| "S-0 blocks S-6" repeated in docs 57/58/60/70/71 | **stale documentation** — true when written, now a decision non-blocker (§9) |
| `feature.team.travel_impact` (feature) vs `module.travel_impact` (#5) share a name | **harmless legacy** — distinct rows/schemas (doc 71) |
| D-3 "declaration site open" | **actual open sub-decision**, small (§7.3) |
| Travel V1/V2 semantic conflict | **deliberate supersession** — CLOSED, do not reopen |

No governance conflict found. No source contradicts the frozen travel decisions.

## 15. S-0 closure criteria (only those the repository justifies)

1. Every active-module input contract recovered or superseded — **met** (docs 59–60).
2. No UNRECOVERABLE module — **met** (0).
3. The one open PARTIAL decision (travel) resolved — **met** (`a6336df`).
4. `readiness_tracker` acceptance criterion defined (V2 golden, not V1) — **met**;
   `S-0-c-i` ratification **pending** (methodology only).
5. No unresolved semantic conflict — **met**.
6. Transcriptions identified and unblocked — **met** (they are S-6 impl work).

**S-0 is complete against 1–3, 5–6; item 4 needs a one-line ratification.**
Nothing in this list requires new architecture.

## 16. Critical path

```
S-0  ────────────────────────────────────────────────  [COMPLETE*]
  │   (* one methodology ratification S-0-c-i outstanding; not a code/schema gate)
  ▼
Ratify D-5c-i + S-0-c-i, fix D-3 site (calculator-code)  [READY — trivial]
  ▼
Migration 023  (module_version.minimum_sample_observation_count,
                module_reading.inactive_reason)          [READY — authorised, uncreated]
  ▼
S-6 module engine  (evidence → reading → status/sample/verdict)  [BLOCKED on the two above]
  ▼
First module readings for the recoverable-outright modules
  (home_away_split, rest_advantage, form_gap_accuracy, consistency_index, …)  [BLOCKED]
  ▼
Module #5 travel_impact reading  (cites home+away travel_distance)  [BLOCKED — + home/away formula gate]
  ▼
S-9 calibration (sample_gate seed, published_baseline, outcome validation)   [DEFERRED]
  ▼
Readiness travel integration (new feature_version)                            [DEFERRED / NOT REQUIRED for S-6]
```

**Shortest path to S-6 implementation:** ratify (minutes) → migration 023 (one
file) → module engine. The first two are the true gate; the engine is the work.

## 17. Recommended next gate

**The S-6 entry gate**, in this order:

1. A short **ratification note** confirming D-5c-i (`MIN(consumed)`), S-0-c-i
   (golden rescoping), and D-3's declaration site (calculator-code, count derived)
   — closing the last `-i` items with no new architecture.
2. **Migration 023** authoring gate — the two columns, exactly as prepared;
   nothing more (the `module_version.rationale` amendment is a data update under
   `pt_owner`, not DDL).
3. **S-6 module-engine implementation gate** — starting with a
   *recoverable-outright* module (e.g. `home_away_split` or `rest_advantage`) to
   prove the reading/evidence/status pipeline, **before** module #5, whose
   home/away combination formula is its own modelling gate.

Do **not** start the engine at module #5: travel needs a differential-formula
decision (doc 71 §9) that the simpler modules do not.

## 18. Explicit non-decisions

This audit changes nothing. It does not create migration 023, ratify any `-i`
item, build any engine, alter the feature/module registry, touch travel/readiness/
DEC-2, or reopen the closed travel architecture. It reclassifies the *status* of
existing work; it decides no new work.

---

## STATUS

**S-0:** **Substantively COMPLETE** — Partially complete only in that one
methodology ratification (S-0-c-i) is outstanding; no recovery finding, decision,
or schema item remains open under S-0.

**S-0 blocking items:**
- None that are S-0 decisions. (The execution blockers below belong to S-6 entry,
  not S-0.)

**S-0 non-blocking deferred items:**
- S-0-c-i ratification (golden-file rescoping methodology)
- `confidence_calibration` weights & `giant_killer_index` tiers (transcriptions, S-6 impl)
- four inactive modules (no decision until activation)

**Travel architecture:** **CLOSED**

**S-6:** **Design ready; implementation blocked** on execution (not on S-0 decisions)

**Exact S-6 blocker:**
- **Migration 023 is not created** (`module_version.minimum_sample_observation_count`,
  `module_reading.inactive_reason`) — without it a `module_reading` cannot be
  written with a threshold basis or an INACTIVE reason — **and** the S-6 module
  engine does not exist (`beta/backend/src/v2/module/` absent).

**Can S-6 design proceed:** YES (largely delivered)

**Can S-6 implementation proceed:** NO — until migration 023 exists and the module engine is built

**Minimum work required to unblock:**
1. Ratify D-5c-i, S-0-c-i, and D-3 declaration site (no new architecture)
2. Create migration 023 (two columns, as prepared)
3. Build the S-6 module engine, starting with a recoverable-outright module

**Next gate:** the **S-6 entry gate** — ratification note → migration 023 authoring → module-engine implementation (first on a simple module, not #5)
