# PitchTerminal V2 — S-5 Implementation: Blocked Pending Decision

**Implementation has not begun. No file under `src/v2/feature/` has been created.**

The S-5 brief instructs: *"If an ambiguity is discovered, STOP and report it instead of making assumptions."* One was discovered before the first line of code, and it is structural rather than peripheral.

---

## 1. The ambiguity in one sentence

**`feature_version` 1.0.0 declares that each feature is *"the V1 computation … carried across unchanged"*, but the S-5 specification declares windows and dependencies that systematically contradict what V1 actually computes** — and for `team.readiness_score` the two cannot both be satisfied.

---

## 2. Where the conflict comes from

Two approved authorities disagree, and neither is obviously subordinate.

**Authority A — the registry, written by S-3 and live in the database.** Every one of the seven `feature_version` rows carries this rationale, verified by query:

```
team.readiness_score :: Initial registration. Represents the V1 computation named
in the definition's meaning, carried across unchanged. The calculator that
implements it arrives in S-5.
```

This makes the V1 computation **the definition of what version 1.0.0 means**. In a system where *"a measured rate spanning two rules describes a system that never existed"*, the formula is not an implementation detail — it *is* the version.

**Authority B — documents 20 and 21**, which declare source windows and a dependency graph that do not match V1.

Document 21 §10 assessed the missing formulae as *"safe to leave to implementation"* because *"a formula chosen within those constraints cannot violate the architecture"*. **That assessment was wrong**, and this document corrects it: the constraints are not free of the formulae. The declared windows *are* part of the formula, and they conflict with V1.

---

## 3. The conflicts, per feature

All V1 references are to `beta/backend/src/jobs/processDbOnly.ts`, read directly.

| Feature | V1 computation (= what 1.0.0 means) | S-5 spec declares | Status |
|---|---|---|---|
| `team.home_form` / `away_form` | `round(last5Score×0.7 + last10Score×0.3)`, where `last5Score=(pts/15)×100`, `last10Score=(pts/30)×100` — over **all** fixtures (`:1540–1542`) | last 10 completed home / away fixtures | **Portable.** The home/away split is stated in the definition's own `meaning`; the weighting carries across intact |
| `team.rest_advantage` | `rest_days_avg` — **mean gap across the last 4 fixtures**, capped at 30 (`:1559–1566`) | D-2: *"days since the team's most recent completed fixture before `as_of`"* | **Different quantity.** A mean of four gaps is not the latest gap |
| `team.congestion_index` | Band table over `nextMatches14` — **fixtures in the NEXT 14 DAYS**, forward-looking (`:353–361`) | *"28 days before `as_of`"*, backward-looking | **Opposite temporal direction**, and see §4 |
| `team.travel_impact` | Band table over `avgKm14` — mean km across trips in a **14-day** window, then `100 − score` (`:818–833`) | last 5 completed away fixtures | **Different window** |
| `team.readiness_score` | Six-component weighted composite (`:1694–1705`): form **30**, `100−congestion` **15**, `100−travel` **15**, stability **5**, `100−fatigue` **10**, `100−rotation` **10** | Two declared edges: `rest_advantage` + `congestion_index` | **Irreconcilable — the blocker** |

### Why `readiness_score` is irreconcilable

| V1 component | Weight | Available as a declared V2 input? |
|---|---|---|
| `form_index` | **30** — the dominant term | ❌ No edge declared. Doc 20's graph has one edge and form is not in it |
| `congestion_score` | 15 | ✅ Declared |
| `travel_fatigue_score` | 15 | ❌ Doc 20 §3 **explicitly excludes** travel: *"deliberately not an input to readiness"* |
| `squad_stability_score` | 5 | ❌ **Not calculated at all** — R-1 defers it |
| `fatigue_index` | 10 | ❌ Not a registered V2 feature. V1 leaves it NULL pending player-minutes tracking |
| `rotation_pressure_index` | 10 | ❌ Not a registered V2 feature |
| *rest* | — | ⚠️ **Does not appear in V1 readiness at all**, yet V2 declares it as an input |

Four of six V1 components have no V2 input, the largest of them is excluded by declaration, and the one input V2 *does* declare is absent from V1. This is not a formula to port; it is a different metric wearing the same name.

---

## 4. One conflict is not merely a mismatch — it is impossible

**V1's congestion is forward-looking.** `matchCountForCongestion = nextMatches14` counts fixtures in the *next* fourteen days.

Document 21 makes temporal correctness a **MUST**:

> A value `as_of T` may read **only** football reality that was true at or before `T`. … a feature that saw a fixture's result before the fixture was played measures nothing.

and specifies leakage tests that fail on exactly this.

**Therefore V1's congestion cannot be "carried across unchanged" under S-5's own rules.** Porting it faithfully would violate a MUST; complying with the MUST means not porting it. The registry rationale and the specification are not merely inconsistent here — they are jointly unsatisfiable.

This also means the conflict cannot be resolved by "just follow V1": that option does not exist for congestion, and readiness depends on congestion.

---

## 5. A compounding problem: the source spec is missing

V1's own code cites an authority for readiness that **is not in the repository**:

> *"The Team Readiness Engine spec defines the FULL 7-component formula (Form 30% + OpponentStrength 20% + Congestion 15% + Travel 15% + HomeAdvantage 10% + Stability 5% + Motivation 5%) as a MATCH-CONTEXT calculation"* (`:1174–1178`)

A repository-wide search for that document returns nothing. So the V1 code is itself an **approximation** of an absent spec: it computes a *"NEUTRAL BASELINE"* with OpponentStrength, HomeAdvantage and Motivation *"assumed at their neutral midpoint (50)"*.

Consequently, "the V1 computation" is ambiguous even on its own terms — it could mean the 7-component spec formula (unavailable), the 6-component baseline in `processDbOnly.ts`, or the per-match variant in `processMatchIntelligencePartial()` which V1's own comment calls *"the spec-AUTHORITATIVE"* one. **Three candidates, and the code names a different one as authoritative than the one it computes.**

This mirrors the Phase 7 finding that thirteen `mv_*` relations exist only in production: the repository does not fully describe the system.

---

## 6. Why I did not implement around it

Four routes were available and each is forbidden or unsound:

| Route | Why not |
|---|---|
| Invent weights for readiness | *"DO NOT invent behaviour that is not supported by the approved specification."* The weights would silently become the meaning of version 1.0.0 |
| Implement the five non-blocked features and stub readiness | `declare.ts` must write the `feature_dependency` edge. Writing an edge for a calculator that does not exist asserts a dependency nobody has — precisely what R-1 forbids for `squad_stability`. And the two-stage model, all lineage, the provenance floor and mutation test 5 exist *only* for readiness, so five of the eight test classes could not run |
| Follow V1 exactly | Impossible for congestion (§4), and readiness depends on congestion |
| Follow the spec windows and treat V1 as superseded | Defensible, but it makes version 1.0.0 mean something other than its registered rationale — a governed registry change I hold no privilege to make and no authority to imply |

`pt_pipeline_feature` holds no `UPDATE` on `feature_version`, so **the rationale cannot be corrected by S-5 in any case.** Whichever way this resolves, an amendment to the registry text is `pt_platform_admin`'s.

---

## 7. Decisions required

### DEC-1 — What does `feature_version` 1.0.0 mean? *(blocking)*

| Option | Consequence |
|---|---|
| **A. The S-5 specification is authoritative; V1 is superseded** | Implement doc 20/21 windows as written. Choose readiness weights over the two declared inputs. **The 1.0.0 rationale becomes false and must be amended by `pt_platform_admin`.** Cleanest forward path; requires accepting that 1.0.0 is a new rule, not a carried-across one |
| **B. V1 is authoritative; the spec is corrected to match** | Requires amending doc 20's dependency graph to add form, travel, stability, fatigue and rotation as readiness inputs — of which three are not registered features and one is deferred. **Congestion still cannot be ported (§4).** Not viable without also registering new definitions, which the brief forbids |
| **C. Version 1.0.0 is retired unused; features are registered at 2.0.0** | Honest — no value ever carried the false rationale. Costs a governed registry change and leaves an unused version row |

**Recommendation: A.** It is the only option that is internally consistent, and the amendment it requires is one rationale text rather than a graph of new definitions. The 1.0.0 rows carry no values yet, so nothing already written is misattributed.

### DEC-2 — Readiness composition *(blocking, follows DEC-1)*

If A: readiness is a composite of `rest_advantage` and `congestion_index` **only**, and the weights must be stated. The natural candidate is V1's *relative* weighting of the components that survive — but V1 assigns rest no weight at all, so there is nothing to carry across. **The weights are a genuine product decision and I will not choose them.**

Also required: the normalisation. V1 works on a 0–100 integer scale throughout; V2 declares `unit = 'index'`, `value_scale = 2`. Whether V2's index is 0–100 with two decimals, or 0–1, is unstated and affects every consumer.

### DEC-3 — Confirm the four window divergences *(blocking for three features)*

Each needs an explicit ruling that the spec window supersedes V1's:

| Feature | V1 | Spec | Ruling needed |
|---|---|---|---|
| `rest_advantage` | mean of last 4 gaps | latest gap (D-2) | D-2 supersedes? |
| `congestion_index` | next 14 days | prior 28 days | Spec supersedes (V1 impossible) — confirm |
| `travel_impact` | 14-day km mean | last 5 away fixtures | Spec supersedes? |
| `home/away_form` | 0.7/0.3 over last 5/10 | last 10, filtered | Carry V1 weighting across? |

### DEC-4 — Index scale convention *(blocking for four features)*

`team.home_form`, `team.away_form`, `team.congestion_index`, `team.travel_impact` and `team.readiness_score` all declare `unit = 'index'` with `value_scale = 2`. **The range is nowhere stated.** V1 uses 0–100 integers. Two implementations could both satisfy every declared constraint and produce values differing by a factor of 100.

**Recommendation: 0–100 with two decimals**, matching V1 and preserving the meaning of every band, threshold and UI label already built against it.

---

## 8. What is ready to build the moment these are answered

Not blocked, and unaffected by DEC-1 through DEC-4:

- the whole `registry/` layer — `load.ts`, `order.ts`, and `declare.ts`'s `feature_source` rows
- the whole `read/` layer — windows are parameterised, and the relations and columns are settled
- the whole `write/` layer — `values.ts`, `lineage.ts`, `scale.ts`, `provenance.ts`
- `driver/eligibility.ts` — D-1 fully specifies it
- `pipeline.ts`, `verify.ts`, `cli.ts`
- every test class except those requiring a readiness value

`team.rest_advantage` is buildable under D-2 as written, pending only DEC-3's confirmation that D-2 supersedes V1.

**Estimated blocked share: the four calculators and the tests that consume their output.** Everything structural is unblocked.

---

## 9. What was not done

- **No file under `src/v2/feature/` was created.** Nothing was written and nothing stubbed.
- **No schema, migration or privilege was touched.**
- **No registry row was read as writable or modified.**
- **No formula was invented**, and no window was silently substituted for another.

The database was queried read-only to establish the registered rationale, and V1 source was read. Both are evidence-gathering, not implementation.
