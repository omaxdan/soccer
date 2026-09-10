# `team.squad_stability` — Definition Decision Record

**Type:** Feature definition / governance decision record. Nothing implemented.
**Status:** **Definition governed / implementation pending bounded historical lineup substrate.**

> **Nothing was implemented by this record.** No calculator, `feature_calculator`
> row, `feature_source`/`feature_dependency` edge, `feature_value`, registry code
> change, migration, provider call, or lineup ingestion. No change to
> `team.travel_burden` (remains deferred/unmaterialised under doc 69),
> `team.readiness_score` v1.0.0, `team.preparedness` (unimplemented), snapshots,
> S-9, or frontend. This record fixes the definition and authorizes **planning** of
> the prerequisite corpus only.

| | |
|---|---|
| **Feature** | `team.squad_stability` |
| **Concept** | Selection / **starting-XI continuity** across recent fixtures |
| **Explicitly NOT** | roster membership · squad turnover · availability continuity · generic rotation · **position** continuity |
| **Measure** | A3 on A1 — mean of per-transition `retained_players / 11` over the window |
| **Window** | last **6** eligible completed fixtures (up to **5** transitions) |
| **Observation unit** | fixture-to-fixture **transition** (not fixture) |
| **Sample threshold** | `3` **transitions** (unchanged registry value) |
| **Provenance** | `DERIVED` rank 3; **source-based** (declares `feature_source`, not a feature→feature dependency) |
| **Version** | `1.0.0` |
| **Implementation status** | **Definition governed / implementation pending bounded historical lineup substrate** |
| **Resolves** | doc 97 §1 "Squad Stability = HUMAN DECISION REQUIRED"; the S-5 deferral of the seventh feature (doc 21) |

---

## 1. Preserved existing governance (unchanged)
From the registry declaration (`seed/featureRegistry.ts`) and prior records — **carried verbatim, not modified here**:

| Slot | Value |
|---|---|
| `feature_key` | `team.squad_stability` |
| `subject_kind_code` | `TEAM` |
| context kind | `ALL_COMPETITIONS` |
| `unit` | `ratio` |
| `value_scale` | `4` |
| `direction` | `HIGHER_IS_STRONGER` |
| `meaningful_sample_threshold` | `3` |
| `max_provenance_class_code` | `DERIVED` (rank 3) |
| calculator slot | `squad_continuity` |

## 2. Concept (owner decision 2)
`team.squad_stability` measures **starting-XI selection continuity** — how settled a side's chosen eleven is across its recent matches. It is **not** roster/squad membership, squad turnover, availability continuity, generic rotation, or **position** continuity. This matches the registered `meaning` ("continuity of selection across recent fixtures") and doc 21/README §175, which held that computing squad *membership* instead "would be exactly the drift the registry prevents."

## 3. Exact measure — A3 built on A1 (owner decision 3)
For two consecutive **eligible** starting XIs `XI_prev` and `XI_curr` (each exactly 11 players, identified by `player_id` where `is_starting = true`), a **transition ratio** is:

```
transition_ratio = |XI_curr ∩ XI_prev| / 11        (retained players / 11)
```

The **feature value** is the arithmetic mean of the valid transition ratios in the window:

```
team.squad_stability = mean( transition_ratio over the valid transitions in the window )
```

Retention is by **player identity only** (`player_id`). It is **not** position retention — a retained player who changed position counts as retained. Range is `[0, 1]`.

## 4. Historical window (owner decision 4)
The **last 6 eligible completed fixtures** for the team, ordered by kickoff. Six eligible fixtures yield **up to 5** consecutive transitions. The window is a count of *eligible* fixtures (see §6), not a calendar span.

## 5. Observation unit and sample threshold (owner decisions 5 + registry)
- The **observation unit is a fixture-to-fixture transition**, not a fixture.
- The governed `meaningful_sample_threshold = 3` is **unchanged** and means **3 valid transitions**.
- `sampleObservationCount` **MUST count transitions** (not fixtures).
  - **0–2 valid transitions → NO VALUE** (no feature row).
  - **3–5 valid transitions → the feature may be calculated.**

## 6. Eligible fixture (owner decision 6)
A historical fixture contributes a valid starting-XI observation **only** when all hold:
1. `fixture.lifecycle_state_code = COMPLETED`;
2. kickoff is **strictly before** the evaluation as-of `T`;
3. the team's starting XI is **determinable**; and
4. **exactly 11** starting players are identifiable from the persisted substrate (`lineup` + `lineup_selection` with `is_starting = true` for that team's lineup in that fixture).

Missing or malformed lineup data is **never** treated as zero stability — an ineligible fixture simply provides no observation.

## 7. Gap handling (owner decision 7)
- Missing/ineligible fixtures **break** the transition chain; the calculation **does not bridge** across a gap.
- Only **adjacent eligible fixtures** in the usable historical sequence form a transition.
- Postponed, abandoned, cancelled, incomplete, or otherwise non-`COMPLETED` fixtures provide **no** valid starting-XI observation and therefore break the chain at that point.

## 8. As-of semantics (owner decision 8)
For an evaluation at kickoff `T`:
- only **eligible completed** fixtures with kickoff **strictly < T** may contribute;
- the **historical starting XI stored for each fixture** is used — never the current/most-recent roster, never any future fixture;
- the existing `before(T)` / `priorValues` architecture is preserved (as used by `home_form`/`away_form`, `congestion_index`). No new as-of mechanism is introduced.

## 9. NO VALUE semantics (owner decision 10 + PD-07/LC-05)
- **Insufficient sample** (`< 3` valid transitions) or **missing required historical XIs** that drop the count below threshold → **absent row (NO VALUE)**.
- A **measured zero-retention** result (a valid window in which consecutive XIs shared no starters) is a real value stored as **`0.0000`**, a row at the floor — categorically distinct from absence.
- Absence is never converted to `0`, and a measured `0` is never elided to absence.

## 10. Input substrate (owner decision 9) — source-based
Minimum raw **sources** (this is a **source-based** feature; it declares `feature_source` edges to Layer-1 relations, **not** a feature→feature dependency):
- `football.fixture` — kickoff, `lifecycle_state_code` (COMPLETED), team identity, competition/edition scope, `fixture_partition_on`;
- `football.lineup` — the team's lineup per fixture;
- `football.lineup_selection` — `player_id`, `is_starting`.

`position_code` is **not** required. The feature must **not** depend on `player_match_statistic`, availability, injuries, suspensions, or `player_registration` / roster membership.

## 11. Output mapping (owner decision 10)
- The mathematical value is a **raw ratio in `[0, 1]`**; it is **not** multiplied by 100.
- Stored under `value_scale = 4` (four decimal places); the existing write-boundary **half-up rounding** applies **once** (`feature/write/values.ts` + `scale.ts`) — the calculator returns the unrounded ratio.
- Legitimate zero-retention → `0.0000`; insufficient/missing evidence → NO VALUE (absent row).

## 12. Provenance (owner decision 11) — eventual implementation shape
When implemented, the feature must use the existing feature architecture:
- `feature_version` (`1.0.0`, §13) with rationale;
- **source lineage** via `feature_source` (the three football relations in §10);
- **no `feature_dependency`** edge (it consumes no feature — do not invent one merely because it is derived);
- `sampleObservationCount` = number of **valid transitions** (§5); `sample_meets_threshold` compares it to `3`;
- as-of evidence = the eligible completed fixtures with kickoff `< T`;
- `max_provenance_class_code = DERIVED` (rank 3) — measured from football relations, no INFERRED input.

## 13. Version (owner decision 13)
First implementation version **`1.0.0`**, rationale: *"Initial registration of selection (starting-XI) continuity. Mean of per-transition player-retention ratios (`retained_players / 11`) over the last 6 eligible completed fixtures (up to 5 transitions); `meaningful_sample_threshold = 3` counts valid fixture-to-fixture transitions; gaps break the chain; player identity only (not position); raw ratio in [0,1], DERIVED, source-based on fixture/lineup/lineup_selection."*

## 14. Feature identity (owner decision 12)
Preserved exactly as §1. No registry identity slot is changed by this record.

## 15. Bounded corpus authorization (owner decision 14)
- The owner **authorizes the prerequisite historical lineup enrichment** required to evaluate this feature.
- The required substrate is a **bounded historical lineup corpus**: sufficient to fill the **six-eligible-fixture window** for the teams of the tracked edition(s) at each evaluation point — **not** an all-history requirement.
- **This authorization is for planning only.** It does **not** authorize executing ingestion, provider calls, or the calculator in this task. Fixture 61 alone remains insufficient (it proves the persistence path, not a corpus).

## 16. Implementation status
**Definition governed / implementation pending bounded historical lineup substrate.**
Not authorized in this pass: the `squad_continuity` calculator, `feature_source` seeding, `feature_value` computation, corpus ingestion execution, or provider calls.

## 17. Follow-up noted (not a contradiction, not changed here)
The registry `meaning` currently carries a historical V1-source clause ("derived from `team_squads_snapshot`, which records composition at each squad sync"). The governed **concept** ("continuity of selection across recent fixtures") is unchanged and correct; the V1-source clause describes V1 provenance only. At implementation, the `meaning` should be refined to cite the V2 substrate (`lineup`/`lineup_selection`) and this record — a governed registry edit made at the implementation gate, **not** in this document.

---

## Cross-check (no contradiction found)
- **doc 21 / README §175** — resolves the deferral it named ("selection continuity, which needs lineup data S-4 deferred; S-5 ships six, not seven"); §15 authorizes the lineup substrate it required. Consistent.
- **doc 27 A-10** — A-10 left authoring the logic "unstated"; this record supplies the governed definition. Consistent.
- **doc 34 (R-1)** — Recovery-Readiness shape finding; unrelated to the selection-continuity definition. The `declare.ts` "never calculated (R-1)" status is now advanced to "definition governed, implementation pending." Consistent.
- **doc 69** — `team.travel_burden` untouched and unreferenced. No change.
- **doc 97** — advances §1 "Squad Stability = HUMAN DECISION REQUIRED / blocked" to "definition governed" (doc 97 not edited; this is an additive successor record). Consistent.
- **Registry declaration** — all governed slots preserved verbatim (§1/§14); only a future `meaning` refinement noted (§17), not made here. Consistent.
- **lineup / lineup_selection architecture** — `is_starting` is `NOT NULL`; an exactly-11 starting XI is determinable per team/fixture; source-based reads match the established feature-source convention. Consistent.
