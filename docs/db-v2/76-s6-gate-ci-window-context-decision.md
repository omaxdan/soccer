# Phase 8 — S-6 Gate C-i: Window & Context Governance Decision

## Governance decision only · nothing implemented

| | |
|---|---|
| Prior | Gate C `fa0632d` · entry contract `fadd53c` |
| **Decision** | **C-i: FAITHFUL RECOVERY APPROVED** — of the *formula*, with the *population/context* deliberately **governed to COMPETITION_SCOPED, edition-cumulative**, which **supersedes** V1's contaminated all-competitions-lifetime population |
| **Key correction to Gate C** | Source shows V1's population is **all-competitions, all-seasons, lifetime** — the *opposite* of COMPETITION_SCOPED. "Faithful" therefore applies to the formula only; on population, V2 **supersedes** V1 (an S-0-style decision) |
| **Migration** | **NONE** — the context model (`context_kind`, `context_competition_edition_id`, `feature_definition_context_kind`) already exists |
| **Gate C implementation** | **may NOT proceed directly** — it depends on a prerequisite S-5 capability (COMPETITION_SCOPED calculation), specified here as Gate C-ii |

Nothing implemented. No calculator, read path, S-5 change, registry row, migration,
dependency, module, or touch to travel/readiness/DEC-2/migration 023.

---

## 0. The finding that reframes the decision

Gate C assumed "faithful V1 recovery = cumulative + COMPETITION_SCOPED." **Source
contradicts the second half.** V1's venue win% is built from
`team_form_history`, populated by `processFormBackfill` →
`matchesRepository.getFinishedMatches(10000)`:

```ts
// MatchesRepository.ts:114-118
db.from('matches').select('*').eq('status','finished').order('date',{ascending:false})
// no competition filter, no season filter, no team scope — every finished match
```

So V1's actual population is **all competitions, all seasons, lifetime** (and was
even globally capped at 1000 by a PostgREST bug they flagged). That is precisely
the contamination the V2 governance rejects. Therefore:

- **Literal V1 fidelity** = all-competitions-lifetime cumulative — **contaminated**,
  and rejected by the governed context vocabulary + S-0.
- **Governed-correct** = COMPETITION_SCOPED (one edition) — what V1 *never* did.

Faithful-to-V1 and governed-correct are **opposites** on this axis. The formula is
carried across; the population is deliberately superseded. This is the honest
frame for the rest of the decision.

## 1. Existing context architecture

Verified in source:

- **`context_kind` vocabulary** (`002`): `COMPETITION_SCOPED` (*"within one
  competition edition … venue performance"*, `requires_edition = true`),
  `ALL_COMPETITIONS` (`requires_edition = false`), `CROSS_COMPETITION_DERIVED`.
  **Venue performance is named, by governed vocabulary, as COMPETITION_SCOPED.**
- **Schema already carries the scope:** `feature_value.context_competition_edition_id`
  with `ck_feature_value__context_edition_conditional` (non-null iff
  COMPETITION_SCOPED); `feature_definition_context_kind` binds a feature to its
  context kinds; `home_form`/`away_form` already declare **both**
  `ALL_COMPETITIONS` and `COMPETITION_SCOPED`.
- **But S-5 computes only ALL_COMPETITIONS:** `calculators/types.ts` —
  `CALCULATION_CONTEXT_KIND = 'ALL_COMPETITIONS'`; the note states the
  COMPETITION_SCOPED bindings "remain registered and valid … adding those values
  later is additive," and the write layer "supplies NULL" for
  `context_competition_edition_id`. **No feature has ever produced a
  COMPETITION_SCOPED value.**

**Conclusion:** a new context kind is **not** needed — the correct one exists and
is expressible in the schema. What is missing is the *calculation path* that emits
a value scoped to an edition. `competition_edition` already encodes competition +
season together, so **`context_competition_edition_id` alone fully identifies the
population** — no separate season dimension is required.

## 2. Read-layer architecture

`readCompletedFixtures` is bounded by design (10-per-side rank + 28-day congestion)
to serve the preparedness features cheaply. It **cannot** supply an
edition-cumulative venue history, and it **must not be widened** — doing so would
change the cost and semantics of every existing feature that shares it.

**Smallest truthful capability: a separate purpose-specific read (option B of the
gate).** A new `readEditionVenueResults(tx, teamIds, asOf, editionIds)` returning,
per (team, edition, venue side), all `COMPLETED` fixtures with a `result` and
`scheduled_kickoff_at < as_of` — no rank cap, no time window, scoped to the
edition. This keeps the bounded preparedness reads untouched and isolates the one
cumulative query to the one feature that needs it. Not option A (widen the shared
read), not C (a general cumulative primitive — more than this needs).

## 3. Exact population semantics (recovered)

- **V1 "cumulative"** = every finished match, all competitions, all seasons,
  lifetime (§0). **Not** season-bounded, **not** competition-bounded in V1.
- **V2 governed population (this decision)** = **cumulative within one competition
  edition**: all completed fixtures of the team in that edition, on the given
  venue side, before `as_of`. Edition = one season of one competition, so this is
  simultaneously competition-bounded *and* season-bounded — the natural unit for a
  "home fortress / road warrior" *identity within a campaign*.

This is a **deliberate narrowing** of V1's population, justified by the governed
vocabulary and the S-0 cup-contamination finding — not an arbitrary window (§7).

## 4. Is COMPETITION_SCOPED genuinely recoverable?

Yes. The population maps cleanly:

- **competition + season** → `fixture.competition_edition_id`
  (`context_competition_edition_id` on the value).
- **team** → subject.
- **venue side** → `fixture.home_team_id`/`away_team_id`.
- **fixture/result** → `football.fixture` + `football.result`.

`competition_id + season` is expressed by the single `competition_edition_id`, and
the existing context model represents it directly. **No new schema, no new context
kind.** The only genuinely new thing is that S-5 must *enumerate the subject at
edition grain* and *write the edition id* — §8.

## 5. Options compared

| Dimension | **A — formula-faithful + governed COMPETITION_SCOPED (edition-cumulative)** | B — literal V1 (all-comp, lifetime, cumulative) | C — reinterpret (rolling-10, ALL_COMP) |
|---|---|---|---|
| semantic fidelity | formula yes; population superseded (governed) | full V1 fidelity | neither (recent, contaminated) |
| governed-correct? | **yes** (vocabulary + S-0) | **no** (contaminated) | no |
| contamination risk | none (edition-scoped) | **high** (cups mixed in) | high |
| circularity | none (§9) | none | none |
| implementation surface | new read + **first COMPETITION_SCOPED S-5 path** + registry + calc + tests; **no migration** | new lifetime read + registry + calc; ALL_COMP path exists | reuse existing read; smallest |
| impact on existing features | none (additive path; ALL_COMP untouched) | none | none |
| provenance | DERIVED | DERIVED | DERIVED |
| testability | V2-derived goldens (population superseded) | **V1-golden-compatible** | V2-derived goldens |
| module fit ("identity") | **strong** — campaign identity | strong but cross-competition | weak — "recent", not identity |
| new feature_version | it is 1.0.0 either way | 1.0.0 | 1.0.0 |
| V1-golden compatible? | **NO** (population deliberately differs) | **YES** | NO |

**Recommendation: A.** The governed context vocabulary explicitly assigns venue
performance to COMPETITION_SCOPED, and S-0 independently found cup contamination a
real defect. Literal V1 fidelity (B) reproduces a contamination V2 has already
ruled against, and *also* needs a new cumulative read — it buys fidelity to a
disowned population at nearly A's cost. C is the cheapest but is neither faithful
nor governed-correct and quietly changes the module's question from *identity* to
*recent form*. A is the smallest **truthful** architecture: the frozen formula, the
governed population.

## 6. S-0-c-i applied

`home_away_split` is a "carry-forward" module **for its formula**, but under Option
A **V2 deliberately supersedes V1 on population/context**. Per the ratified
S-0-c-i, a V1 golden is legitimate *only where the V1 rule is carried across
deliberately* — here the population is **not** carried across, so **a V1 golden on
the raw win-rate numbers is INVALID** (it would compare an edition-scoped value
against an all-competitions-lifetime one). The test is therefore **V2 goldens
derived from the declared rule** over a controlled edition population. Stated
explicitly, as S-0-c-i requires. (This mirrors how `travel_impact` and
`readiness_score` are superseded, not V1-golden'd.)

## 7. Hidden-modelling check

None introduced. The formula is frozen; "edition-cumulative" is a **population
definition** (all completed fixtures in the edition), not an arbitrary rolling
window; COMPETITION_SCOPED is a **governed vocabulary value**, not a coefficient;
no weighting, decay, normalization, disparity formula, or sample threshold is
invented. The `meaningful_sample_threshold` remains **undecided and is left so**
(V1 had none at the feature; the module owns the `|disparity| ≥ 40` threshold) —
setting it is not required to define the population and must not be guessed.

## 8. Minimum infrastructure for Option A (specified, NOT built)

| Surface | Change | Migration? |
|---|---|---|
| read layer | **new** `read/editionVenueResults.ts` — edition-cumulative completed results per team/side; **`readCompletedFixtures` untouched** | no |
| S-5 orchestration | **new capability:** enumerate COMPETITION_SCOPED subjects at **(team, as_of, edition)** grain and route them to a scoped context; today only (team, as_of)@ALL_COMPETITIONS exists — this is the **first** scoped path | no |
| calculation context | pass `context_kind = COMPETITION_SCOPED` + `context_competition_edition_id` into the context; the calculator stays pure | no |
| write layer | supply `context_competition_edition_id` (schema already supports; currently NULL for ALL_COMPETITIONS) | no |
| calculator | **new** `venue_win_rate` → `team.home_win_rate`, `team.away_win_rate` (the `formBackfill` two-key pattern) | no |
| registry/seed | two `feature_definition` rows; `feature_definition_context_kind` = COMPETITION_SCOPED; sources `fixture`+`result`; `feature_version` 1.0.0 | no |
| tests | engine (edition-grain subject enumeration; edition-cumulative read; ALL vs SCOPED isolation), calculator (formula/draws/zero/no-value), V2 goldens | no |

**No migration is required** — the context columns and vocabulary already exist.
The substantive new thing is the **first COMPETITION_SCOPED calculation path**,
which is a bounded S-5 capability build within the existing schema — its own
sub-gate (**Gate C-ii**), and a prerequisite of Gate C implementation.

## 9. Circularity re-check

```
football.fixture + football.result   (OBSERVED)
        ↓
team.home_win_rate / team.away_win_rate   (DERIVED, consumed: [])
        ↓
home_away_split module   (Gate D)
```

`venue_win_rate` reads football relations only and consumes **no feature** — no
back-edge, no downstream preparedness signal. The graph is a DAG. The module reads
the two rates; nothing reads the module back into the features. Confirmed.

## 10. Final decision

**C-i: FAITHFUL RECOVERY APPROVED** — with the precise scope:

- **Formula:** `win_rate = wins / matches × 100` per venue side, draws in the
  denominator, `matches = 0 → NO VALUE` — carried across from V1 (frozen).
- **Population:** **edition-cumulative** — all completed fixtures of the team in
  the competition edition, on the venue side, before `as_of`. This **supersedes**
  V1's all-competitions-lifetime population.
- **Context:** **COMPETITION_SCOPED** (governed vocabulary; resolves S-0 cup
  contamination), `context_competition_edition_id` populated.
- **Read capability:** a new purpose-specific edition-cumulative venue read;
  `readCompletedFixtures` untouched.
- **Implementation surface:** §8 — new read + first COMPETITION_SCOPED S-5 path +
  registry + calculator + tests.
- **Migration:** **NOT required.**
- **Gate C implementation may proceed?** **Not directly** — it is gated on **Gate
  C-ii** (build the S-5 COMPETITION_SCOPED calculation capability), which is the
  genuinely new infrastructure. Once C-ii exists, Gate C (the two features) is a
  straightforward build; then Gate D (the module).

**Programme note (surfaced, not resolved):** `home_away_split` was chosen as first
module because its *status rule* is frozen — but its prerequisite feature now
requires S-5's *first* COMPETITION_SCOPED path, a heavier lift than doc 73
anticipated. This does not change the correctness of the choice, but the
decision-maker may wish to weigh building the COMPETITION_SCOPED capability now
(Gate C-ii, reusable by `home_form`/`away_form` and future scoped features) against
resequencing to an ALL_COMPETITIONS-only first module. That is a sequencing
question for the next gate, not a reason to compromise this feature's governed
semantics.

## 11. Scope discipline

No feature/read/S-5/module/engine implemented; migration 023 untouched; no
dependency or module rows; readiness and travel untouched; no new context kind; no
invented window/threshold/coefficient.

---

## STATUS

- **C-i-1 window/population:** DECIDED — **edition-cumulative** (all completed fixtures in the competition edition before `as_of`), superseding V1's lifetime population
- **C-i-2 context:** DECIDED — **COMPETITION_SCOPED** (governed vocabulary; resolves S-0 cup contamination)
- **V1 population (recovered):** all competitions, all seasons, lifetime — contaminated; deliberately **superseded**, not carried
- **Faithful to V1:** formula YES; population NO (governed supersession)
- **Read-layer capability:** new purpose-specific edition-cumulative read; `readCompletedFixtures` untouched
- **New context kind required:** NO — `COMPETITION_SCOPED` already exists and is schema-expressible
- **Provenance:** DERIVED · **Circularity:** none (DAG confirmed) · **Hidden modelling:** none
- **V1 golden compatible:** NO — V2 goldens derived from the declared rule (S-0-c-i)
- **Migration required:** NO
- **Decision:** **C-i: FAITHFUL RECOVERY APPROVED** (formula-faithful, population/context governed to COMPETITION_SCOPED edition-cumulative)
- **Gate C implementation authorized:** NO — gated on **Gate C-ii** (build S-5's first COMPETITION_SCOPED calculation capability)
- **Next gate:** **Gate C-ii — S-5 COMPETITION_SCOPED calculation capability** (subject enumeration at (team, as_of, edition) grain + edition-cumulative read + scoped write), then Gate C feature implementation, then Gate D
