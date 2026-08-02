# PitchTerminal V2 — Canonical Data Model & Architecture Blueprint

**Status:** Architecture blueprint. Precedes schema design.
**Scope rules:** No SQL. No migrations. No table removals. No frontend redesign. No features outside PitchTerminal's stated scope.
**Input:** The Phase 1 audit of the existing 92-table schema (documents 01–05 in this directory).
**Output contract:** This document must be detailed enough that Phase 3 can derive the V2 schema from it without returning to first principles.

---

# 1. Executive Summary

## 1.1 What V1 established

The current system is a successful prototype in the precise sense that matters: it proved the product thesis and, in doing so, discovered its own requirements.

Four things were settled by building it:

1. **Precompute-and-serve is the right shape.** Nothing of consequence is calculated at request time. The frontend is read-only against football data, and a single writer owns every ingested and derived fact. That boundary held across 92 tables and ~54 processors without erosion, and it is the single most valuable inheritance V2 receives.

2. **Full regeneration is achievable.** `process:all-db` rebuilds every current intelligence value from raw tables, idempotently, with zero API calls, in strict dependency order. The system already knows how to reconstruct itself. V2 extends that guarantee across time rather than introducing it.

3. **Evidence discipline is the product.** The platform does not sell picks; it sells characterizations backed by measured history. V1 built the machinery for that — point-in-time archives, result linking, Wilson intervals, explicit sample gates, and a shared definition file guaranteeing the published formula and the backtested formula are byte-identical. That machinery covers one model out of several. V2 generalizes it.

4. **The module is the right unit of product.** Thirteen modules, each answering one question with one reading and one baseline, is a durable abstraction that users understand. V1 proved the abstraction; it lives in application code because that was the fastest way to prove it.

## 1.2 Why V2 is required

V1's structure encodes a single assumption: **that the interesting question is "what is true now."** Every design consequence follows from it — one row per team, overwritten in place; formulas with no version; match intelligence rewritten by whichever processor ran last; modules evaluated fresh on every render.

The product has outgrown that assumption. PitchTerminal's competitive position rests on claims of the form *"this pattern held across N historical matches, with this lift over baseline, at this confidence."* Claims like those require the database to answer three questions the current shape cannot:

- **What did we believe, and when did we believe it?**
- **Which formula produced this number?**
- **Was this module reliable, historically, at this specific version?**

V2 exists to make those three questions cheap to answer, for every metric and every module, permanently.

The scale targets sharpen the same point. Ten years of history, 100+ leagues, and millions of player statistics are not a volume problem — Postgres handles the volume. They are a *temporal* problem: history is only worth storing if it is addressable, versioned, and reproducible. A larger V1 would hold more rows describing a single instant.

## 1.3 What V2 solves

| V1 discovered | V2 resolves by |
|---|---|
| The same metric materialized in many places, with nothing reconciling them | One declared owner per metric; every other appearance is a resolution or a read model, never a second owner |
| Calculated values overwritten on each run, so yesterday is unrecoverable | A temporal feature store where writing is appending, not replacing |
| No record of which formula produced a number | Version identity carried on every calculated fact, and on every calibration measurement of it |
| Several prediction systems producing competing answers with no arbiter | An explicit model dimension with exactly one canonical output per question |
| Modules as application code, with baselines maintained by hand | A module registry with stored readings, stored evidence, and baselines read from calibration |
| Inputs and outputs sharing rows, so freezing one leaves the other drifting | Snapshots that capture inputs and outputs together, immutably, as one atomic historical claim |
| Structured content held in ARRAY and JSON columns | Relational evidence and relational classifications |
| Almost no signal about whether the pipeline ran or succeeded | Operational entities as a first-class layer with the same rigour as football data |
| Season and competition identified inconsistently, sometimes by name | One competition-edition identity used everywhere, including calibration |

## 1.4 Architectural philosophy

Five commitments, in priority order. Where they conflict, the earlier wins.

**1. Time is a dimension, not a side effect.**
Every calculated fact is *about* an entity *as of* a moment, produced by a *named version* of a formula. This is not metadata bolted on; it is part of the identity of the fact. Two readiness values for the same team at different moments are two facts, not one fact updated.

**2. One owner per metric.**
Every metric has exactly one definition, one producer, and one authoritative location. Copies exist only where they are explicitly derived — inside an immutable snapshot, or inside a read model that is disposable and rebuildable — and they are marked as such.

**3. Layers are one-directional.**
Football reality → features → modules → product. Each layer reads only from the layer beneath it. A module never reads a raw table; a feature never reads a module reading; the product layer never calculates. Nothing flows upward.

**4. Claims are immutable.**
Once the system has stated something about a fixture at a moment in time, that statement is permanent and unmodifiable. Improving the formula produces a *new* statement under a new version alongside the old, never a rewrite. The historical record is the asset; protecting it is not a constraint on the architecture, it is the point of it.

**5. Structure over serialization.**
Anything the system needs to query, aggregate, join, or explain is relational. JSON is reserved for genuinely opaque payloads — a raw provider response retained for audit — never for evidence, classifications, entity references, or product content.

**A note on what V2 is not.** V2 does not change what PitchTerminal sells. It is not a prediction engine, a tipster, or a picks service, and nothing in this blueprint introduces one. Every structure here exists to make historical patterns, readiness analysis, match context, and risk characterization more durable and more defensible than V1 could make them.

---

# 2. V2 Core Architecture Principles

## 2.1 Single Source of Truth

### The situation V1 revealed

`readiness_score` — or a column meaning the same thing — currently exists in seven places: `team_intelligence`, `team_intelligence_history`, `match_intelligence` (as `home_readiness`/`away_readiness`), `readiness_history`, `team_match_snapshots` (as `readiness_before`), `player_intelligence`, and `player_match_impact`.

Reading that list carefully shows it is not one problem but **three distinct ones**, and conflating them is why the duplication was hard to see:

| Case | Example | Nature |
|---|---|---|
| **Genuinely different metric, same name** | `team_intelligence.readiness_score` vs `player_intelligence.readiness_score` | Different subject, different formula. Legitimately two metrics — badly named. |
| **Same metric, resolved for a different subject** | `match_intelligence.home_readiness` | Not a new metric. It is *team readiness*, for the home participant, as of this fixture. |
| **Same metric, captured at a moment** | `readiness_history.home_readiness`, `team_match_snapshots.readiness_before` | Not a new metric. It is *team readiness*, frozen as a historical claim. |

V2 resolves each differently, and the distinction is the mechanism.

### The rule

> **Every metric is declared once, in a registry, with exactly one producer. Every appearance of that metric's value elsewhere is one of exactly two things: a *resolution* (the same metric, for a stated subject, at a stated moment, materialized inside an immutable snapshot) or a *projection* (a disposable read model, rebuildable from the owner). Neither is a second owner, and both are marked as such.**

Applied to readiness:

- `team.readiness` and `player.readiness` are **two registry entries** with different subject types, different formulas, and different version lines. Names are namespaced by subject so they can never again read as the same thing.
- `home_readiness` on a match ceases to be a stored metric. It becomes `team.readiness` resolved for the home participant at the snapshot's as-of moment — materialized inside the snapshot for reproducibility, and unambiguously attributed to its owner.
- `readiness_before` ceases to exist as a separate concept. A snapshot taken before kickoff *is* the "before" state; a suffix is no longer needed to express what the temporal key already says.

Seven locations become **one owner, one resolution mechanism, and one snapshot mechanism** — with no loss of any value V1 stored.

### What the registry declares

Enough that a metric cannot be reintroduced under a second name by accident:

| Property | Purpose |
|---|---|
| Namespaced key and subject type | Makes `team.readiness` and `player.readiness` visibly distinct |
| Unit, scale, and direction | 0–100? index? kilometres? Is higher better? V1 mixed all of these silently |
| Producer | The one calculator permitted to write it |
| Declared inputs | Makes the dependency graph data, not call ordering |
| Current version and version history | See §2.4 |
| Provenance class | Measured, provider-derived, internally calculated, or estimated — see below |
| Sample-size semantics | Whether a value is meaningful below some n, and what that n is |

Registration is the governance point. A new metric requires a registry entry; a calculator writing an unregistered metric is a detectable error rather than a silent one.

### Provenance is part of the truth

V1 stored one genuinely synthetic dataset — climate-zone-estimated weather — in the same shape real observations would take, and a module consumed it. It also carried, in `player_transfers.source`, the only provenance marker in the schema, distinguishing provider-confirmed transfers from squad-diff inferences. The second is the pattern; V2 makes it universal.

Every stored fact declares its provenance class: **observed** (a provider stated it), **derived** (calculated from observed facts), **inferred** (reconstructed by heuristic, e.g. squad-diff transfers), or **estimated** (modelled in the absence of a source). The class travels with the value into snapshots, into module evidence, and into anything the product surfaces — so "we are estimating this" is a property of the data rather than a fact held in someone's memory.

## 2.2 Separation of Layers

Four layers, strictly one-directional. A layer may read only from the layer below it.

```
┌───────────────────────────────────────────────────────────────┐
│ LAYER 4 — PRODUCT PRESENTATION                                │
│ read models · entitlements · users · preferences · delivery   │
└───────────────────────────────────────────────────────────────┘
                              ▲   reads
┌───────────────────────────────────────────────────────────────┐
│ LAYER 3 — INTELLIGENCE MODULES                                │
│ module registry · readings · evidence · baselines · verdicts  │
└───────────────────────────────────────────────────────────────┘
                              ▲   reads
┌───────────────────────────────────────────────────────────────┐
│ LAYER 2 — FEATURE CALCULATION                                 │
│ feature registry · temporal feature store · snapshots         │
└───────────────────────────────────────────────────────────────┘
                              ▲   reads
┌───────────────────────────────────────────────────────────────┐
│ LAYER 1 — FOOTBALL REALITY                                    │
│ what happened, as reported by providers                       │
└───────────────────────────────────────────────────────────────┘
```

### Layer 1 — Football Reality

**Belongs:** Facts about the world that a provider asserted. Competitions, editions, teams, players, venues, fixtures, results, actual lineups, appearances, injury spells, transfers, valuations, standings, provider-supplied statistics.

**Does not belong:** Any value the platform computed. Any judgement. Any flag whose meaning is "we decided". Specifically, the V1 pattern of a computed gate (`played_enough`) sitting on a provider statistics table, and computed injury summary columns sitting on the player record, both move to Layer 2.

**Ownership:** Ingestion only. No calculator writes here, ever. This rule held in V1 and is inherited unchanged.

**Temporal posture:** Append-corrected. Providers revise; corrections are applied, but a correction to a *result* must be observable, because downstream historical claims were made on the pre-correction value.

### Layer 2 — Feature Calculation

**Belongs:** Every number the platform derives about an entity. Readiness and its components, form quality, travel load, rest, congestion, squad stability, strength, depth, versatility, momentum, motivation, playing style, valuation aggregates, opponent quality — all of it, expressed uniformly.

**Does not belong:** Product judgement. A feature says *"this team's travel load over the last 14 days is 2,840 km."* It does not say whether that is good, whether it constitutes an edge, or whether the user should care. That is Layer 3.

**Ownership:** Feature calculators, one per feature (or per coherent feature group), declared in the registry.

**Temporal posture:** Append-only. Writing a feature never overwrites a previous value; it records a new value as of a new moment. **This single change eliminates the entire class of problems V1's singleton tables created**, and removes the need for parallel history tables — the primary store is already the history.

### Layer 3 — Intelligence Modules

**Belongs:** Judgement. A module reads features and states a position: this factor supports, contradicts, or is neutral toward a characterization of this fixture; here is how strongly; here is the evidence; here is how often this has held historically.

**Does not belong:** Raw calculation. A module that computes its own numbers from Layer 1 has made those numbers unversioned, unarchived, and invisible to every other module. If a module needs a number that does not exist, the answer is a new registered feature, not an inline calculation.

**Ownership:** Module calculators, one per module version.

**Temporal posture:** Append-only, and immutable once the fixture kicks off (§2.3).

### Layer 4 — Product Presentation

**Belongs:** Everything about serving and selling. Read models shaped for specific pages, entitlement rules, plans, features, users, preferences, watchlists, notifications, admin.

**Does not belong:** Any calculation, any judgement, any authoritative value. Every number in Layer 4 is a copy whose owner is below it, and every read model must be droppable and rebuildable without data loss.

**Ownership:** Product services and user actions.

**Temporal posture:** Read models are disposable. User data is durable and RLS-governed, exactly as V1 established.

### Why one-directional matters here specifically

V1's dependency graph — roughly fifty edges between calculated artefacts — lives entirely in the ordering of calls inside the CLI. It is correct, carefully documented, and completely invisible to the database. A missing input does not raise; it writes nulls.

Under strict layering with declared inputs in the registry, the graph becomes data. Execution order is *derived* from declared dependencies rather than maintained by hand, and a missing input is a detectable precondition failure rather than a silent null.

## 2.3 Immutable Intelligence

### The governing question

For any piece of data, ask: **is this a description of the present, or a claim about a moment?**

Descriptions of the present may be updated. Claims about moments may not, ever. Almost every difficulty V1 encountered came from storing claims in structures built for descriptions.

### The three postures

| Posture | Meaning | Applies to |
|---|---|---|
| **Mutable** | Corrected in place; only the latest value is meaningful | Provider-owned reality that gets revised; user preferences; product configuration |
| **Temporal** | Append-only; every value is retained with its as-of moment; "current" is a query, not a row | All features; all module readings before kickoff |
| **Sealed** | Written once, then permanently unmodifiable | Every snapshot; every verdict; every outcome linkage; every calibration measurement |

### By data type

**Team and player state — temporal.**
There is no "current" row and no separate history table. Current state is the latest value as of now; historical state is the latest value as of then. The same query shape answers both, which is what makes point-in-time reconstruction cheap rather than a bespoke reconstruction job.

**Match intelligence — temporal, then sealed.**
A fixture's intelligence is recalculated as often as useful while it remains scheduled, each run appending a new snapshot. At kickoff, the fixture seals: no further snapshots, and no modification of existing ones. V1 arrived at exactly this rule for one table, enforced in the database rather than in application code, after a production incident in which finished fixtures' intelligence was rewritten. V2 inherits that posture and applies it uniformly.

The enforcement detail from V1 is worth carrying verbatim: the guard triggers on *"not explicitly still scheduled"* rather than on a specific finished state, because the status vocabulary belongs to the provider and cannot be fully enumerated. Protecting by default and permitting the known-safe case is the correct direction, and V2 should additionally map provider status into an internal lifecycle so the guard depends on a vocabulary the platform controls.

**Predictions and characterizations — sealed on creation.**
The moment a claim about a fixture is written it is history, whether or not the fixture has kicked off. Improving the model produces a new claim under a new version, and both persist. **This is what makes retroactive formula improvement possible at all** — V1's immutability guard, correctly protecting the record, also made re-running a corrected formula over history impossible, because there was nowhere for the corrected value to go. Version identity is the escape hatch that keeps immutability from becoming a trap.

**Module outputs — temporal before kickoff, sealed after.**
Same posture as match intelligence, for the same reason: a module's reading is a claim, and the whole calibration apparatus depends on claims being what they were.

**Calibration measurements — sealed.**
A measurement is *"as of this date, over this window, at this module version, the rate was X with interval Y."* Re-measuring produces a new row. V1 kept only the latest evaluation per rule, so the trajectory of a rule's measured reliability — arguably the most interesting signal in the entire system — was overwritten on every run. V2 retains the series.

### Retention

Immutability is not unbounded accumulation. Retention differs by artefact and should be an explicit policy per class rather than an emergent property of what nobody deleted:

- **Sealed claims about fixtures** — permanent. This is the asset.
- **Feature values for scheduled fixtures** — thinned after sealing to the values referenced by a retained snapshot.
- **Intra-day feature recalculations** — thinned to one per day beyond a short recent window.
- **Read models** — no retention; rebuildable by definition.
- **Operational telemetry** — bounded window, with aggregates retained beyond it.

Exact horizons are a decision for §11, not an architectural constant.

## 2.4 Formula Versioning

### The requirement

Every calculated output — feature value, module reading, verdict, calibration measurement — carries:

- **`formula_version`** — the identity of the calculation rule that produced it. Changes when the rule changes: a weight, a window, a threshold, a component added or removed.
- **`model_version`** — the identity of the broader model the rule belongs to, where a coherent model spans several calculations. Lets a whole model be evaluated as a unit.
- **`calculated_at`** — when the calculation ran. Distinct from the **as-of** moment the value describes; V1 conflated these, which is why `calculated_at` could not serve as a partition key on any match-scoped table.

Version identity must be **declared in the registry before use**, not free text at write time — otherwise it drifts and cannot be reasoned about.

### Why this is load-bearing rather than hygienic

V1's own code states the problem better than an argument could. The shared confidence-band definition exists, in its author's words, because *"the thing being measured must be byte-identical to the thing being published"* — otherwise *"a backtest ends up measuring a rule the product does not ship."*

That discipline is enforced in V1 by a single shared source file. It works, and it works only for as long as every writer remembers to import it. The database has no idea the constraint exists.

Version identity moves the guarantee from convention to structure. Four consequences follow directly:

1. **Calibration becomes truthful.** A measured hit rate is measured over one version. Without version identity, a formula change silently mixes two models into one statistic, and the published rate describes a system that never existed.

2. **Retroactive correction becomes possible.** A corrected formula runs over history as a new version alongside the old. Both are calibrated; the improvement is measurable rather than asserted. Under V1's structure this is impossible in both directions — either the guard blocks the write, or the original claim is destroyed.

3. **Regressions become visible.** Comparing versions over the same fixtures is a query rather than an archaeology project.

4. **Explanations stay honest.** When a user asks why a module said what it said, the answer must reference the rule that actually ran, not the rule currently in the codebase.

### Version transitions

Changing a version is a governed event, not a deployment side effect:

- A new version is **registered** with its effective date, its rationale, and its relationship to the version it succeeds.
- Existing sealed claims are **never** rewritten to the new version.
- The new version may be **backfilled** over history as new claims, if the product wants comparative calibration.
- Calibration series are **keyed by version**, so a new version begins a new series rather than contaminating the old.
- A version may be **retired** — no longer produced — while its historical claims and its calibration series persist permanently.

---

# 3. Proposed V2 Data Architecture

Entity families and their relationships. No SQL, no column lists, no table counts — those are Phase 3.

## 3.1 Football Reality Layer

### Competition structure

| Entity family | Purpose |
|---|---|
| **Country** | Canonical geography. Every geographic reference resolves here — V1 populated this correctly and then bypassed it with free text in three places; V2 routes all of it through the canonical entity. |
| **Competition** | A competition's stable identity across all time. Sponsor renames change a *name*, never an identity. |
| **Competition edition** | **A competition in a specific season.** This is the entity V1's audit showed to be missing, and it resolves more than one problem at once: it gives statistics a real referent (V1 used an unconstrained external season identifier in five tables), gives standings a temporal home, gives fixtures unambiguous context, and gives calibration a competition key that survives a rename (V1 keyed calibration on competition *name*, so a sponsor rename severed the history). |
| **Competition edition stage** | Group phase, knockout round, matchweek. V1 had no round or matchweek concept; the UI wanted one. |
| **Venue** | Stadium with geography, capacity, timezone, surface. Travel calculation depends on coordinates being present and trustworthy. |

**Ownership:** Ingestion. **Relationships:** Country → Competition → Edition → Stage. Venue independent.

### Participants

| Entity family | Purpose |
|---|---|
| **Team** | A club's stable identity. |
| **Team registration** | **A team's participation in a competition edition.** Answers "who is in this competition this season" — a question V1 could only infer from standings or fixtures. Also the natural home for competition-scoped context. |
| **Player** | A person's stable identity: name, birth date, nationality, physical attributes. Bio only. |
| **Player registration** | **A player's affiliation with a team over a period**, including loans. Answers "who was at this club on this date" — V1 stored only current club, so squad reconstruction required replaying transfers. |
| **Player position profile** | Positions a player occupies, with role ranking and source. Replaces V1's five position columns plus a sixth array representation, and makes the primary/secondary/tertiary ordering explicit rather than implied by column names. |

**Relationships:** Team → Team registration → Competition edition. Player → Player registration → Team. Player → Position profile.

### Fixtures and outcomes

| Entity family | Purpose |
|---|---|
| **Match** | A fixture: participants, edition, stage, venue, scheduled time, and an **internal lifecycle state** mapped from the provider's status rather than passed through raw. V1's guard logic, four processors' scoping, and the whole immutability posture depend on this value; it should belong to the platform. |
| **Match officials** | Referee and assistants. A documented UI gap in V1, pending provider confirmation. |
| **Match result** | Final and interval scores, including extra time and penalties — V1's result shape was lossy for cup fixtures. |
| **Match lineup** | The **actual** lineup as reported: starters, substitutes, positions, shirt numbers. Kept strictly separate from predicted lineups, which are Layer 2 output. |
| **Player appearance** | Per-player participation in a fixture: minutes, start/substitute/unused, cards. Note the three-state distinction V1's two booleans could not express. |
| **Match event** | Goals, cards, substitutions, if ingested. Optional — include only if a provider supplies it and a consumer needs it. |

### Player and squad history

| Entity family | Purpose |
|---|---|
| **Player availability spell** | An injury, suspension, or unavailability period with start, expected return, actual end, severity, and reason. Replaces both V1 representations — the ten columns on the player record and the separate injury table — with one owner. Current availability is a query over open spells, not a stored flag. |
| **Player valuation** | Market value **over time**, with currency and source. V1 stored a single scalar with no currency and no date, overwritten on every sync, so valuation history — genuinely useful signal — was continuously discarded. |
| **Transfer** | A move between clubs, with fee, currency, type, and **provenance** distinguishing provider-confirmed from squad-diff-inferred. V1's provenance marker here is the pattern V2 generalizes. |

### Provider statistics

| Entity family | Purpose |
|---|---|
| **Player statistics by domain** | Provider-reported per-player statistics for a team within a competition edition, **partitioned by statistical domain** — see §6.2. |
| **Team statistics** | The same, for teams. |
| **Standings entry** | A team's table position within a competition edition, **as of a date**. V1 stored only current standings, which is why a parallel point-in-time reconstruction had to be built to support backtesting. |

**Note on standings:** making standings temporal removes an entire compensating mechanism from V1 rather than reimplementing it.

## 3.2 Feature Calculation Layer

### The central design decision

V1 answered "where does a calculated metric live" with *a table per metric group*, arriving at 17 team-scoped tables plus 31 match-scoped tables. The cost was not the table count. It was that each table brought its own temporal posture (mostly none), its own uniqueness rules (sometimes absent), and its own implicit relationship to the calculators — so every metric had to be reasoned about individually.

V2 answers the same question **once**, for all metrics:

> **A feature is a value, for a subject, in a context, as of a moment, produced by a version.** Every calculated metric in the system has that shape. The storage strategy may vary for performance; the identity never varies.

### Feature identity

| Component | Meaning |
|---|---|
| **Feature key** | Namespaced by subject: `team.readiness`, `team.travel_load_14d`, `player.fatigue`, `match.readiness_edge`, `competition.avg_goals` |
| **Subject** | The entity the value describes — team, player, match, competition edition |
| **Context** | **The competition edition the value is scoped to, or an explicit all-competitions scope.** This resolves V1's inability to express a team's differing state across simultaneous competitions |
| **As-of** | The moment the value describes |
| **Version** | Formula and model version that produced it |
| **Value + provenance + sample size** | The measurement and its trustworthiness |

Context deserves emphasis. V1's team singletons had no competition dimension, so a club competing domestically and continentally had one readiness figure covering both. Making context part of feature identity means competition-specific intelligence needs no new mechanism — it is the same mechanism with a different context value.

### Storage strategy

A purely generic store buys uniformity and pays for it in type safety and read performance. A purely wide-table approach inverts that trade. V2 takes a hybrid governed by an explicit test rather than by preference.

**A feature group earns a dedicated structure when all four hold:**

1. Its features are **always computed together** by a single calculator
2. They are **always read together** on a hot path
3. The set is **stable** — a change is a deliberate versioned event, not routine
4. The group is **large enough** that generic storage would cost materially

**Everything else lives in the generic temporal store.**

Candidates that plainly pass on today's evidence: the readiness component set (computed as a unit, read as a unit, stable across V1's lifetime, seven-plus components); the predicted-lineup set (high volume, distinctive shape, hot read path); provider statistics by domain (high volume, wide, dictated by provider contract).

Candidates that plainly fail: the many V1 tables holding a handful of scores keyed on a single fixture. Those become feature rows.

**Regardless of storage, every feature is declared in the registry, carries the same identity, and is readable through one uniform interface.** Physical storage is an optimization detail that consumers never see — which is what allows a group to be promoted or demoted later without touching any consumer.

### What becomes a feature

Everything V1 computed. Readiness and components; form quality and opponent-adjusted variants; travel load and distance; rest and congestion; squad stability and depth; strength and quality; versatility and adaptability; momentum, motivation, playing style; injury burden; valuation aggregates; opponent quality; competition aggregates.

Match-scoped comparisons are features too, with a match subject: `match.readiness_edge`, `match.travel_advantage`, `match.rest_advantage`. Where V1 stored `home_x` and `away_x` as paired columns — a shape that prevented any query treating the two sides symmetrically — V2 stores either the underlying team feature resolved per participant, or a signed edge feature on the match. Both are queryable; neither requires a column per side.

### Snapshots

A **feature snapshot** is a sealed capture of a defined feature set, for a defined subject, at a defined moment, with every value's version and provenance retained. Snapshots are the mechanism by which a temporal store becomes a permanent historical claim.

They serve three purposes: reproducibility (exactly what the system saw when it spoke), performance (one read instead of many temporal lookups), and immutability (a sealed artefact that thinning cannot erode).

Match snapshots are the primary application — §4.

## 3.3 Intelligence Module Layer

### What a module is

A module answers **one question** about **one subject** using **declared features**, producing a **reading**: a position, a strength, evidence, an explanation, and a historical baseline.

V1 established the abstraction precisely, including the part that matters most — the design contract in its module registry states that a baseline cannot exist without a sample, because *"a historical rate without an n is a marketing number, not evidence."* V2 makes that contract structural rather than conventional.

### Module registry

Modules become data:

| Property | Purpose |
|---|---|
| Key, display number, name | Stable identity. V1's rule that a display number is never reused is correct and inherited |
| Question | The one question answered — a product commitment, not a description |
| Subject scope | Match, team, or competition |
| Declared feature inputs | Makes dependency explicit and detectable |
| Current version and version history | Every reading attributes to a version |
| Required entitlement | Referenced by product; not defined there |
| Active state | Retirement without deletion; historical readings survive |

**Adding a module becomes a registry entry plus a calculator.** V1 required roughly eleven coordinated changes across two repositories plus one out-of-band database object; the frontend registry, the entitlement union, the permission row, the view, and the query layer each had to agree by hand.

### Module reading

A reading is what a module says about one subject at one moment.

| Component | Purpose |
|---|---|
| Module + version | Which module, which formula |
| Subject + context | What it is about, in which competition scope |
| Computed-at and as-of | When it ran; what moment it describes |
| **Status** | Supports / neutral / contradicts / inactive. V1's four-state vocabulary is correct and inherited — *inactive* (insufficient data to speak) is distinct from *neutral* (spoke, found nothing), and conflating them is how a system starts overstating its coverage |
| **Strength** | How strongly, on a declared scale |
| **Confidence** | How much to trust this reading, grounded in sample size |
| **Sample size** | The n behind the claim. Never optional |
| Baseline reference | Points at the calibration measurement, not at a literal |
| Headline and verdict | Rendered explanation — see below |

### Module evidence

**Every reading decomposes into evidence rows**: which feature, what value, which direction it pushed, how much it contributed.

This replaces V1's three parallel and unconnected representations of "a thing we noticed" — a relational signal table permitting one row per market, and two JSON columns holding risk factors and opportunity signals as opaque blobs. Relational evidence makes three things possible that JSON blobs cannot: querying which features most often drive a module's readings, explaining a reading without re-running it, and detecting when a module's inputs went stale.

It also makes the honest answer available. If a reading rests on one feature with a small sample, the evidence says so structurally.

### Module baselines

A baseline is *"historically, when this module read this way, the characterized outcome held X% of the time over n cases, against a base rate of Y, with interval Z."*

Baselines are **produced by calibration and read by modules** — never authored alongside module code. V1 held them as literals in the module registry file, which meant a re-measurement did not change what the product displayed. V1 also, to its credit, tracked which baselines came from a cohort known to contain lookahead bias and marked them distinctly. **That provenance distinction must survive migration**, because a number's trustworthiness is not recoverable from the number.

Baselines are keyed by module **version** and by band, so a formula change starts a new baseline series.

### Module consensus

With readings stored rather than recomputed, consensus across modules for a fixture becomes derivable: how many spoke, how many supported, how many contradicted, weighted by confidence and sample.

V1 anticipated this — a table exists carrying exactly `module_consensus` and `evidence_count`, and nothing writes to it. The blueprint treats that as a designed intent with no substrate beneath it. §4.3 gives it one.

## 3.4 Product Presentation Layer

### Read models

Purpose-built projections for specific surfaces: the match page, the board, the team page, the competition page.

Three rules: **derived** (never authoritative), **disposable** (droppable and rebuildable with no loss), **declared** (registered with its refresh strategy and freshness expectation).

V1's match page issues roughly thirty parallel queries with no projection layer; the board issues twelve including two materialized views whose definitions exist nowhere in the repository. Read models make projections first-class, versioned, and discoverable, rather than objects the codebase depends on but does not describe.

### Entitlement

Plans, features, and the rules binding them live in the database alone. V1 duplicated plan definitions and feature keys into application code, so a database row without a matching code change was invisible, and a code change without a row silently granted access.

Two structural improvements: entitlement expressed as a **plan-feature matrix** rather than a single minimum plan per feature (V1's shape cannot express a feature available on two non-adjacent plans), and **one resolution path** — V1 carried both an environment-variable tier and a database-backed context, live simultaneously.

The beta-mode flag is inherited unchanged. Enforcing it in the database rather than only in application code is correct, and the pattern extends to every product flag.

### User data

Inherited essentially as-is. V1's user layer is the cleanest part of the schema: auth-linked, RLS-governed, properly constrained, with privilege-escalation guards and referential defence for polymorphic references.

Three refinements: polymorphic references gain the same referential defence uniformly (V1 protected watchlists with prune triggers and left notifications undefended), identity duplication with the auth system is removed, and RLS posture on the football and intelligence layers becomes explicit and uniform — V1 has exactly one such policy, and whether that reflects intent is an open question in the audit.

---

# 4. Match Intelligence Architecture

The most consequential section. V1's audit found inputs and outputs sharing rows, several prediction systems competing without an arbiter, no single authoritative answer, and calculations overwritten by whichever processor ran last.

## 4.1 The reframe

V1's match intelligence table is **one row per fixture, continuously updated**. Its identity is the fixture; its content is whatever was last computed. Immutability was retrofitted onto thirteen of its columns after a production incident, which froze the outputs while the copied inputs beside them continued to drift — leaving historical rows internally inconsistent.

V2 changes the identity:

> **Match intelligence is a series of sealed snapshots, each capturing the complete state of a fixture at a moment: the features that were true, the module readings that followed, and the verdict that resulted. The fixture has many snapshots. Each snapshot is permanent.**

Immutability stops being a guard bolted onto a mutable structure and becomes what the structure *is*. There is nothing to freeze because nothing was ever going to change.

## 4.2 Match Snapshot

### Cadence

Snapshots at defined points before kickoff, each a complete sealed capture:

| Point | Rationale |
|---|---|
| **T-7 days** | Earliest useful signal. Squad and fixture context known; injury picture incomplete |
| **T-3 days** | Congestion and rest resolved; rotation risk becomes readable |
| **T-1 day** | Team news largely settled; predicted lineups at their most reliable |
| **Kickoff** | **The canonical snapshot.** The platform's final stated position, and the one calibration measures |

Exact points are a product decision (§11). The architecture requires only that they are **named, fixed, and identical across every fixture** — a snapshot at "whenever the job happened to run" cannot be compared across fixtures, and comparability is the entire point.

Fixtures entering the window late take whichever snapshots remain available; the missing ones are absent rather than approximated, and absence is itself informative.

### Content

Each snapshot seals four things:

1. **Header** — fixture, snapshot point, as-of moment, sealed-at, versions in force, completeness indicator
2. **Feature state** — every feature value consumed, with its own version and provenance
3. **Module readings** — every module's reading at that moment, with evidence
4. **Verdict** — the canonical product output (§4.3)

Sealing the feature state alongside the readings is what makes reproducibility real. V1 could not answer *"what did the system see when it said that"* because the inputs kept moving after the outputs were frozen. A snapshot answers it by construction.

### Sealing

A snapshot seals on write; it is never updated. At kickoff the fixture seals entirely: no further snapshots, no modification.

Two things remain permitted after sealing, and only two:

- **Outcome linkage** — attaching what actually happened. This is additive, never a modification of the claim, and it is what makes calibration possible.
- **New-version claims** — a corrected formula may produce a *new* snapshot series under a new version, alongside the original. The original is never touched.

The second is the escape hatch V1 lacked. Its guard correctly protected the record and, in doing so, made retroactive formula improvement impossible, because a corrected value had nowhere to go that was not a rewrite.

### Resolving the competing predictions

V1 has two independent systems producing complete outcome-probability sets and predicted scores for the same fixture, from different processors, both reaching the page, with nothing declaring which is authoritative.

V2 makes model identity explicit:

- Every probabilistic output attributes to a **named model at a named version**
- Multiple models may produce the same output type — this is legitimate and useful
- Exactly one is marked **canonical** per output type at any time
- The canonical designation is **data**, changeable without a code deployment
- **All** models are calibrated, so the designation is evidence-based
- Only the canonical output feeds the verdict; non-canonical outputs are retained for comparison

The competition between models becomes a measurable experiment rather than an ambiguity. Which is canonical today is a product decision the audit flagged as requiring an answer — the architecture makes it answerable rather than making it for anyone.

## 4.3 Instant Verdict

### What it is

The canonical product output for a fixture at a snapshot: **a characterization of the fixture, not a prediction of its result.**

This distinction is the product's positioning expressed in data. A prediction says *"this will happen."* A verdict says *"here is what the evidence indicates about this fixture, here is how much of it there is, here is how consistent it is, and here is how reliable that pattern has been historically."*

### Composition

| Component | Meaning |
|---|---|
| **Readiness edge** | Signed differential in team readiness, with the underlying values |
| **Form edge** | Signed differential in opponent-adjusted form quality |
| **Context edges** | Travel, rest, congestion, availability — signed, each attributable |
| **Risk** | How unpredictable this fixture is, independent of direction. **A high-edge, high-risk fixture is a different product statement from a high-edge, low-risk one**, and collapsing them loses the distinction that makes the platform useful |
| **Confidence** | How much to trust this characterization, grounded in sample size and evidence completeness — not in the magnitude of the edge |
| **Evidence count** | How many modules had enough data to speak |
| **Module consensus** | How many supported, contradicted, or were neutral — weighted by confidence |
| **Completeness** | Which expected inputs were missing. **Distinguishes "we looked and found nothing" from "we could not look"** |
| **Historical reliability** | How often verdicts with this profile, at this version, have held |

### Deliberate exclusions

The verdict does **not** contain a recommended action, a stake, a selection, or an instruction. V1's module registry already encodes this — its verdict field is documented as *"never a recommendation to stake."* That constraint is inherited and made structural: there is no field for it.

### Why the verdict is not merely a prediction

Three properties distinguish it, and all three are structural rather than presentational:

1. **It reports its own coverage.** Evidence count and completeness are first-class, so a thin verdict is visibly thin rather than indistinguishable from a well-supported one.
2. **It reports disagreement.** Consensus retains dissent rather than averaging it away. A fixture where nine modules split five-four is a genuinely different object from one where nine agree, and the verdict says so.
3. **It carries its own track record.** Historical reliability at this version is part of the output, not a separate marketing claim.

### Verdict versioning

The verdict composition rule is itself a versioned formula. Changing how confidence is derived, or how consensus is weighted, is a version event that begins a new calibration series — exactly as for any other calculated output.

## 4.4 Consequences

| V1 characteristic | V2 outcome |
|---|---|
| One mutable row per fixture | A series of sealed snapshots |
| Inputs and outputs mixed, with only outputs frozen | Both sealed together, atomically |
| Competing predictions with no arbiter | Explicit model identity; one canonical output, all calibrated |
| Calculations overwritten by the last processor to run | Nothing is overwritten; recalculation appends |
| Point-in-time state reconstructed by a compensating job | Snapshots *are* point-in-time state |
| Immutability on part of one structure | Immutability as the structure's nature |
| Retroactive formula correction impossible | New version alongside the old, both retained, both calibrated |

---

# 5. Team Intelligence Architecture

## 5.1 What V1 established

Seventeen team-scoped structures, each one row per team, each overwritten in place, none carrying competition context, season context, or history. Seven metrics of one structure were archived daily into a parallel history table; the remaining nineteen were discarded on every run.

That shape answered "what is true now" efficiently and correctly. The product's questions moved.

## 5.2 The V2 model

Team intelligence is **not a table**. It is a **view over the feature store**, filtered to team-subject features, at a requested moment, in a requested context.

Three consequences follow immediately, without new mechanism:

**Current state** — the latest feature values as of now.
**Historical state** — the latest feature values as of a past moment. Identical query shape.
**Competition-specific state** — the same query with a competition-edition context rather than an all-competitions context.

V1 needed a separate history table because the primary store could not hold history. V2 needs none because the primary store is temporal. **The history table does not move — it stops being necessary.**

## 5.3 Competition context

The context dimension resolves what V1 could not express: a club competing domestically and continentally has genuinely different readiness in each — different opponents, different congestion, different rotation, different stakes.

Three context scopes:

| Scope | Meaning | Example |
|---|---|---|
| **All competitions** | The club's overall state | Fatigue, injury burden, travel load — these do not partition by competition |
| **Competition edition** | State within one competition | Form quality, opponent-adjusted strength, venue performance, standing |
| **Cross-competition derived** | Explicitly about the interaction | Congestion from fixture density, active competition count, rotation pressure |

Which features are meaningful at which scope is declared **in the feature registry**, so it is data rather than convention, and a calculator writing at the wrong scope is detectable.

## 5.4 Team state snapshots

Most team features need no separate snapshot mechanism — the temporal store, thinned to a daily granularity beyond a recent window, is the history.

The exception is **team state at fixture time**, which is sealed inside the match snapshot (§4.2). V1 built exactly this as a compensating mechanism, and its `_before` naming convention is a precise statement of what it was for. In V2 the temporal key expresses it, so the suffix is unnecessary.

## 5.5 Migration posture

The honest constraint: **V1 holds no team-level history to migrate**, beyond seven daily-archived metrics.

V2 creates the structure; the history begins at cutover. Where reconstruction from raw data is possible — form-derived features can be replayed over the fixture record — backfill should be treated as a **new versioned calculation over history**, clearly attributed, not presented as though it had been observed at the time. Reconstructed history and recorded history are different claims and must remain distinguishable.

---

# 6. Player Intelligence Architecture

## 6.1 What V1 established

A single 118-column statistics table mixing outfield and goalkeeping metrics, where roughly fifty columns are permanently null for any given player. Five position columns plus an array representation. Injury state in ten columns on the player record, duplicating a separate injury table written by the same job. A single market-value scalar, no currency, no date, overwritten on every sync. A uniqueness rule permitting one row per player per season, so a mid-season transfer within a competition, or a player active in two competitions, could not be represented.

## 6.2 The V2 model

Six families, each with one clear owner.

### Player profile

Stable identity: name, birth date, nationality, physical attributes, preferred foot. Bio only.

**Positions move out** into a position profile family: one entry per position a player occupies, with role ranking and source. Five columns and an array become one queryable relationship — and "which players can play left-back" becomes a join rather than a scan across five columns.

**Injury state moves out** entirely (below). **Current club moves out** into registration (§3.1).

### Player statistics — partitioned by domain

Statistics partition by **statistical domain**, keyed by player, team, competition edition, and domain:

| Domain | Content |
|---|---|
| **Participation** | Appearances, starts, minutes, rating — applies to every player |
| **Attacking** | Shots, goals, conversion, big chances, set pieces |
| **Creation** | Passing, key passes, crosses, long balls, assists |
| **Defending** | Tackles, interceptions, clearances, blocks, duels, errors |
| **Discipline** | Cards, fouls, offsides |
| **Goalkeeping** | Saves, claims, distribution, goals conceded — **only for players who keep goal** |
| **Physical** | Distance, sprints, top speed |

Four gains, each addressing a specific V1 finding: a goalkeeper stores goalkeeping metrics and nothing else; adding a provider metric extends one domain rather than widening a 118-column table; sparsity disappears; and domains can be ingested and refreshed independently, which matters when providers supply them on different schedules.

**The uniqueness rule changes.** Keyed by player, team, competition edition, and domain, a mid-season transfer produces two rows, and a player active in two competitions produces two rows. V1's shape could represent neither.

### Player availability

One family owning unavailability: injury, suspension, or otherwise. A spell with start, expected return, actual end, severity, reason, and the player's position and valuation at onset — V1 captured those two point-in-time attributes on its injury table, which is exactly the right instinct and worth preserving.

**Current availability is a query over open spells, not a stored flag.** This eliminates the duplication between the player record and the injury table by removing one of the two representations rather than trying to keep them synchronized.

### Player valuation history

Market value **over time**: value, currency, source, as-of date. V1 stored a single scalar with no currency, overwritten on every sync.

This is not merely a correctness fix. Valuation *trajectory* is signal — a rising valuation and a falling one at the same absolute value describe very different players — and V1 discarded it continuously.

### Player impact and readiness

Calculated player metrics — fatigue, load, readiness, importance, versatility, match impact — are **features** (§3.2) with a player subject. They are not a separate architecture.

This resolves a specific V1 finding: player readiness existed in two structures under the same name with different formulas, and match-scoped player impact duplicated per-fixture what the player-level structure already held. Under one feature identity, `player.readiness` has one owner, one version line, and one temporal store; a fixture-time value is that feature resolved at that moment inside the match snapshot.

### Predicted lineups

Predicted lineups are **Layer 2 output** — a calculated artefact — and must never share a home with actual lineups, which are Layer 1 reality.

V1's predicted-lineup structure is among its strongest: player, position, tactical role, pitch coordinates, ordering, captaincy, confidence, and suitability, properly constrained and well indexed. It is the best-designed high-volume structure in the schema, and the design carries forward largely intact.

Two refinements: formation belongs to the team's lineup, not repeated on every player row (V1 stored it both ways, on each player row and in a separate per-team structure), and derived inputs like recent starts should reference their source feature rather than be copied in.

## 6.3 Scale note

Player data is the volume centre of V2 — statistics across ten years and 100+ competitions, plus per-fixture participation and impact. Domain partitioning helps by eliminating sparsity, but the per-fixture families need the same partitioning and retention treatment as match-scoped data (§8.4, §11).

One V1 structure warrants specific attention before its shape is carried forward: per-fixture player-versus-player matchups, whose uniqueness rule permits a row per player pair and therefore up to 121 rows per fixture. At target scale that is a substantially larger table than any other in the system. Whether it is populated at that density is an open question in the audit, and the answer should govern whether the family survives as-is, is bounded to positional pairs, or is derived on demand.

---

# 7. Calibration & Backtesting Architecture

## 7.1 Why this is the competitive position

PitchTerminal's claim is not *"we predict outcomes."* It is *"here is a pattern, here is how often it has held, here is the sample, here is the interval, and here is the base rate it beats."*

That claim is only as good as the machinery producing it. V1 built genuinely good machinery — point-in-time archives with formula versioning, result linking with strict and lenient scoring, Wilson confidence intervals, explicit sample gates, per-competition calibration — and applied it to **one** of the models the product ships.

V2's requirement is not to invent this. It is to **generalize what already works to everything**, and to fix the two structural limits V1's version hit.

## 7.2 What V1 established, and its two limits

**Established and inherited:** point-in-time archives sealed before outcome, formula version recorded on the archive, strict and lenient correctness scoring, Wilson intervals, an explicit boolean sample gate, per-competition and per-band segmentation, a marked distinction between properly measured cohorts and an earlier cohort known to contain lookahead bias.

That last item deserves particular respect. Distinguishing *"measured on a point-in-time population"* from *"scored using current form and therefore contaminated"* is the difference between a calibration system and a marketing artefact, and V1 tracked it explicitly.

**Limit 1 — the archive holds one snapshot per fixture.** Its uniqueness rule permits a single archived claim per fixture, so a claim made at T-7 and revised at T-1 cannot both be retained. The name says history; the constraint says latest.

**Limit 2 — only one model is archived.** The readiness-based claim is archived rigorously. The second prediction system, the half-time model, the risk assessment, and every module reading are not archived at all — so they cannot be calibrated, and therefore cannot make an evidenced claim.

V2's snapshot architecture (§4.2) resolves both as a side effect: snapshots are per-point and cover everything the system said.

## 7.3 The V2 model

### Claim archive

**Every sealed snapshot is the archive.** No separate archival step, no separate structure, no risk of divergence between what was shown and what was archived.

Each snapshot already carries what calibration needs: what was claimed, at which moment, under which versions, with which evidence and sample sizes, and how complete the inputs were.

### Outcome linkage

When a fixture completes, outcomes attach to every snapshot of it. Attachment is **additive** — the claim is untouched.

Outcomes are recorded at multiple resolutions, because different modules characterize different things: match result, goal totals, both-teams-scored, clean sheets, half-time state, margin. A module is calibrated against **the outcome dimension it actually speaks to**, which V1's single readiness-pick scoring could not express for modules that are not about the result.

### Reading-level scoring

Each module reading is scored against the outcome dimension it addresses: did a supporting reading correspond to the characterized outcome occurring, did a contradicting reading correspond to it not occurring, and was a neutral or inactive reading correctly abstaining.

**Neutral and inactive must be scored separately.** A module that abstains when data is thin is behaving correctly; one that abstains constantly is not earning its place. V1's four-state vocabulary already encodes the distinction; scoring it makes the distinction actionable.

### Calibration runs and results

A **calibration run** records what was measured, over which window, at which module version, over which population, with which code revision. It is sealed.

A **calibration result** records, per module version per band: sample size, hits, rate, baseline rate, lift, confidence interval, and whether the sample gate is met.

Two changes from V1, both consequential:

1. **Results are keyed by module version.** A formula change begins a new series rather than contaminating the old. Without this, a measured rate describes a system that never existed.
2. **Results are a time series, not a latest value.** V1 retained only the most recent evaluation per rule, discarding the trajectory of a rule's measured reliability — which is arguably the most interesting signal the system produces. Whether a module is getting better or worse is not answerable from a single number.

### Baseline publication

Baselines published to modules are **read from calibration results**, filtered to those meeting the sample gate. A rate that fails the gate is surfaced as explicitly unverified rather than as a clean percentage.

V1's design contract states this exactly: a rate without an n must render as unverified rather than silently as a bare number. V2 makes it structural — a published baseline that cannot reference a calibration result meeting its gate is a constraint violation, not a styling decision.

### Answering "was this module historically reliable?"

The architecture answers it directly, with the qualifications intact:

> *Module 5 (Travel Impact) at version 2, over fixtures between these dates, in this competition, when reading "supports" in the long-travel band: n = 222, held 42.3% of the time against a base rate of 38.1%, lift +4.2 points, 95% interval 35.9–48.9, sample gate met, measured on a point-in-time population.*

Every element of that statement is stored, versioned, and reproducible. None of it is authored by hand.

## 7.4 Model comparison

With multiple models producing comparable outputs (§4.2) and all of them archived and calibrated, model comparison becomes a query over calibration results at equal versions over the same population.

The canonical designation becomes evidence-based and revisable without a deployment — which is what turns V1's unresolved question of which prediction is authoritative from an ambiguity into a measurement.

---

# 8. Operational Architecture

## 8.1 The requirement

V1's operational surface is a single daily counters row carrying, among aggregate figures, one nullable last-sync timestamp. Everything else — which jobs ran, how long they took, what they wrote, what failed, how much external quota was consumed — exists only in process logs.

The consequence is that the most basic production question is unanswerable: **is today's intelligence fresh, and which parts of it failed?**

This matters more in V2 than it did in V1, for a structural reason. When calculations were overwritten, a failed run was self-correcting — the next run fixed it. When calculations are append-only and snapshots are sealed, **a failed run leaves a permanent gap**. A snapshot that should exist and does not is indistinguishable, later, from a fixture that never had one, unless the pipeline recorded its own failure.

Operational data is therefore not tooling in V2. It is part of the historical record, and warrants the same rigour as football data.

## 8.2 Entity families

### Pipeline runs

One entry per orchestrated execution: trigger (scheduled, manual, backfill), scope, start, end, outcome, and the code revision that ran.

Code revision matters specifically because sealed claims must be traceable to the software that produced them. Formula version says which rule; code revision says which build.

### Pipeline job runs

One entry per job within a run: job identity, scope, timing, outcome, rows examined, rows written, and the versions in force.

This is the granularity at which failure is actionable — "the run failed" is not, "the travel feature calculator failed for 40 of 61 competitions" is.

### Write records

What each job wrote, by target: rows inserted, updated, skipped, and rejected. Turns "the job succeeded" into "the job succeeded and wrote what it should have."

A job completing successfully while writing nothing is one of the more dangerous states in a precompute system, and it is invisible without this.

### Failure records

Failures as data, not log lines: what failed, in which job run, against which entity, classification (transient, data-quality, logic, upstream), the diagnostic, and resolution state.

Classification enables the distinction that matters operationally: a transient upstream timeout is routine, a logic error is not, and treating them identically produces either alert fatigue or missed incidents.

### External API usage

Requests by provider, endpoint, and window; quota consumed; quota remaining; throttling encountered.

V1's ingestion is quota-bound rather than compute-bound — its configuration exists specifically to double a daily quota by adding a second credential — and nothing records consumption. At 100+ competitions, quota is the binding constraint on freshness, and an unmeasured binding constraint cannot be managed.

### Data freshness

Per feature, per subject class, per context: when it was last computed, when it is next expected, and whether it is within tolerance.

This is what lets the product distinguish **"no edge detected"** from **"the calculator did not run."** V1's frontend degrades gracefully to demo data when a query returns nothing, which is good for resilience and means a silently empty structure looks identical to healthy data.

### Data quality

Assertions as **registered checks with recorded results**, not scripts that print and exit: coverage (does every scheduled fixture in the window have a snapshot), integrity (does every feature reference a registered definition), plausibility (are values within declared ranges), consistency (do sealed snapshots reference features that still exist), and completeness (which expected inputs were missing).

V1 has an integrity verification job that writes nothing. Its logic is valuable; its output is not retained. Recording results turns verification into a monitorable trend rather than a manual action.

## 8.3 Production requirements

| Requirement | Rationale |
|---|---|
| Every write attributable to a job run | Sealed claims must be traceable to the execution that produced them |
| Every job run attributable to code and formula versions | Version identity is worthless if the software that applied it is unknown |
| Failures classified and retained | Distinguishes routine from incident |
| Freshness queryable per feature | The product must know what it does not know |
| Quota consumption tracked | The binding constraint on freshness must be measurable |
| Quality assertions recorded over time | Degradation is a trend, not an event |
| Gaps detectable | An append-only system's failures are permanent absences, and absences are silent by nature |

## 8.4 Scale and retention

Operational data is high-volume and low-value-per-row beyond a recent window. Retention policy: full detail for a bounded recent period, aggregates retained long-term, failure records retained longer than successes, quota history retained long enough to support capacity planning.

Operational data is **not** subject to the immutability commitments of Layers 1–3. It is telemetry, and thinning it loses no claim.

---

# 9. What Happens to the Existing 92 Tables

A classification framework, not a migration plan. **No table is proposed for removal**, and no unused table is assumed unnecessary. Exact mappings are Phase 3 work and are gated on the validations the audit identified as blocking.

## 9.1 The five classes

| Class | Definition | Migration posture |
|---|---|---|
| **PRESERVE** | Represents real football reality; V2 shape is close to V1's | Structural refinement, data carries over |
| **CONSOLIDATE** | Represents calculated intelligence duplicated across several structures | Content becomes features or module readings under a single owner |
| **SPLIT** | Holds several concerns that normalize apart | Decomposed into families with distinct owners |
| **ARCHIVE** | Historically valuable; superseded by a V2 mechanism | Data preserved; structure not carried forward as a live writer target |
| **REVIEW** | Requires a product decision before classification | Held; decision precedes design |

## 9.2 PRESERVE

Football reality, essentially as V1 modelled it.

`countries` · `tournaments` · `seasons` · `teams` · `players` · `stadiums` · `matches` · `match_results` · `team_form_history` · `tournament_standings` · `player_transfers` · `player_injuries` · `team_squads_snapshot` · `player_match_load` · `match_predicted_lineups` · `match_predicted_formations`

**Refinements within preservation** — structural, not conceptual:

- Competition edition becomes a first-class entity; the season identity currently expressed two ways resolves to one
- Fixture status maps to an internal lifecycle rather than passing through provider vocabulary
- Provider statistics partition by domain (§6.2) — the *data* is preserved entirely; its shape changes
- Predicted lineups move to Layer 2 as calculated artefacts, with formation attributed to the team rather than repeated per player
- Injury spells absorb the duplicate representation on the player record; both sources are reconciled, neither is discarded

`team_form_history` is worth a note: it is a derived projection treated as raw input by nearly every calculator, and its position on the layer boundary is deliberate and effective. V2 preserves that role — a materialized reality projection, cheap to rebuild, universally consumed.

## 9.3 CONSOLIDATE

The largest class. All of it becomes features (§3.2) or module readings (§3.3) under single ownership. **No metric is lost**; each acquires one owner, temporal identity, competition context, and version attribution.

**Team-scoped intelligence → team features**
`team_intelligence` · `team_intelligence_history` · `team_strength_ratings` · `team_venue_performance` · `team_form_quality` · `team_momentum` · `team_motivation` · `team_playing_style` · `team_strength_dashboard` · `team_fixture_difficulty` · `team_goal_dependency` · `team_injury_impact` · `team_transfer_intelligence` · `team_tactical_variations` · `team_betting_intelligence` · `team_fixture_load` · `team_travel_load` · `team_locations` · `team_position_depth` · `team_strengths` · `team_weaknesses`

**Player-scoped intelligence → player features**
`player_intelligence` · `player_versatility`

**Match-scoped intelligence → match features, module readings, and snapshot content**
`match_intelligence` · `match_travel_intelligence` · `match_risk_intelligence` · `match_opportunity` · `match_signals` · `match_half_time_intelligence` · `match_performance_comparison` · `match_impact_advantage` · `match_impact_summary` · `match_key_battles` · `match_positional_matchups` · `match_tactical_advantages` · `match_squad_depth_comparison` · `team_match_impact` · `team_versatility` · `player_match_impact` · `player_matchup` · `squad_depth` · `position_depth_comparison` · `position_coverage` · `position_adaptability` · `tactical_flexibility` · `substitution_impact` · `injury_adaptability` · `formation_analysis` · `formation_options` · `formation_matchup` · `versatility_advantage` · `league_intelligence`

**Two consolidations warrant specific mention**, because they show the pattern most clearly:

- `match_impact_advantage` and `versatility_advantage` are structurally identical — the same eight-column shape differing only in subject. Under a generic advantage feature with a stated dimension, they are two rows.
- `formation_analysis` and `formation_options` hold the same facts in two pivots, one per-team and one home/away-paired. Under one formation feature family, they are one thing.

**Content requiring specific handling during consolidation:**

- Narrative held in array columns (strengths, weaknesses, key advantages, formations, tactical patterns) becomes relational evidence or relational classification
- Structured content held in JSON (risk factors, signals, warnings, score components, experience distribution, age profile) becomes module evidence
- Generated prose (recommended approach, executive brief, matchup descriptions, tactical notes) moves to a presentation family, separated from the metrics it currently sits beside

## 9.4 SPLIT

Structures holding several concerns that normalize apart.

| Structure | Splits into |
|---|---|
| `player_season_statistics` | Statistics by domain — participation, attacking, creation, defending, discipline, goalkeeping, physical (§6.2) |
| `team_season_statistics` | The same domain treatment at team scope |
| `players` | Profile · position profile · registration · availability spells · valuation history |
| `matches` | Fixture · officials · lifecycle state, with competition-edition and stage references replacing text descriptors |
| `match_intelligence` | Feature state · module readings · verdict — the input/output separation of §4 |
| `match_results` | Result · interval scores · extra time and penalties |
| `platform_settings` | Product configuration · operational configuration (currently one key-value space serving both) |

## 9.5 ARCHIVE

Historically valuable, superseded by a V2 mechanism. **Data is preserved in full**; the structure is not carried forward as a live writer target.

| Structure | Superseded by | Note |
|---|---|---|
| `readiness_history` | Match snapshots (§4.2) | **The single most valuable dataset in the system.** Its sealed claims and their outcome linkages migrate into the snapshot archive as historical claims under their recorded formula version. Its immutability lock must remain in force throughout, and its formula-version column is the pattern V2 generalizes |
| `team_match_snapshots` | Snapshot feature state | A compensating mechanism for the absence of temporal features. Its reconstructed values migrate as historical feature values, marked as reconstructed rather than observed |
| `match_opponent_context` | Snapshot feature state | Same |
| `league_gap_analytics` / `league_gap_summary` | Calibration results | Content migrates; competition identity resolves from name to competition edition, and rows that cannot be resolved are **quarantined, never dropped** — this is calibration history |
| `signal_backtests` | Calibration results | Content becomes the first entry in each series rather than a latest-value row |
| `platform_daily_summary` | Operational aggregates | Retained as historical aggregates |

**A caution on the calibration archives:** these are the platform's evidence base. Migration must be verifiable claim-by-claim, and any row whose competition identity cannot be resolved must be retained in a quarantine state pending manual resolution. Losing a calibration row is losing evidence.

## 9.6 REVIEW

Requires a product decision before classification. Per the audit's rules, none of these is assumed unnecessary — several are clearly built infrastructure awaiting a product that has not shipped.

| Structure | Decision required |
|---|---|
| `customers` | Is Stripe billing still planned? Structure and the subscription integration points are staged and complete |
| `notifications` · `notification_preferences` | Is the notification product still planned? Its preference topics name a module-change signal that no current structure supports — V2's module readings would support it directly |
| `match_intelligence_watch` | What was this for? It is the only place module consensus and evidence count appear anywhere in the schema, and it is admin-scoped. It reads as a designed intent for exactly what §4.3's verdict provides |
| `match_weather` | Does the estimated-weather module continue to ship? Depends on whether a real weather integration is planned. Under V2 the values would be marked estimated regardless — the decision is whether the module ships on estimated data at a paid tier |
| `subscription_plans` · `feature_permissions` | Does the entitlement model move to a plan-feature matrix? Affects shape, not content |
| `player_matchup` | Does the per-fixture player-pair family survive at its current density (§6.3)? Gated on the population measurement the audit requested |

## 9.7 Product-layer structures

`user_profiles` · `user_subscriptions` · `subscription_events` · `watchlists` · `user_favourite_leagues` · `user_notes` · `admin_actions`

**Preserved substantially as designed.** V1's user layer is its cleanest work: auth-linked, RLS-governed, well-constrained, with a privilege-escalation guard and referential defence for polymorphic references. Refinements are limited to those in §3.4 — uniform polymorphic defence, removal of identity duplication with the auth system, and explicit RLS posture on the layers below.

## 9.8 Summary

| Class | Count | Nature |
|---|---|---|
| Preserve | 16 | Football reality |
| Consolidate | 52 | Calculated intelligence → features and module readings |
| Split | 7 | Normalization (overlaps Preserve — a structure may be preserved *and* split) |
| Archive | 6 | Superseded mechanisms; data fully retained |
| Review | 6 | Awaiting product decision |
| Product layer | 7 | Preserved as designed |

Counts overlap by design — classification describes migration posture, not partition.

---

# 10. V2 Recommended Architecture Diagram

## 10.1 System flow

```
        ┌─────────────────────┐   ┌─────────────────────┐
        │   SportsAPI Pro     │   │  SofaScore / other  │
        │  fixtures, results  │   │  squads, stats,     │
        │  competitions       │   │  injuries, values   │
        └──────────┬──────────┘   └──────────┬──────────┘
                   │                         │
                   ▼                         ▼
        ┌───────────────────────────────────────────────┐
        │            INGESTION SERVICES                 │
        │  quota-aware · provenance-tagging · idempotent│
        │  ── records: api usage, job runs, failures ──│
        └───────────────────────┬───────────────────────┘
                                ▼
╔═══════════════════════════════════════════════════════════════════╗
║ LAYER 1 — FOOTBALL REALITY                          [mutable]     ║
║                                                                   ║
║  competitions → editions → stages                                 ║
║  teams → team registrations                                       ║
║  players → registrations · positions · availability · valuations  ║
║  matches → officials · results · lineups · appearances            ║
║  venues · standings (temporal) · provider statistics (by domain)  ║
╚═══════════════════════════════╤═══════════════════════════════════╝
                                ▼   reads only
╔═══════════════════════════════════════════════════════════════════╗
║ LAYER 2 — FEATURE ENGINE                            [temporal]    ║
║                                                                   ║
║  ┌─────────────────────┐      ┌──────────────────────────────┐   ║
║  │ FEATURE REGISTRY    │─────▶│ FEATURE CALCULATORS          │   ║
║  │ key · subject       │      │ one owner per feature        │   ║
║  │ unit · direction    │      │ order derived from declared  │   ║
║  │ inputs · versions   │      │ inputs, not hand-maintained  │   ║
║  └─────────────────────┘      └──────────────┬───────────────┘   ║
║                                              ▼                    ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ TEMPORAL FEATURE STORE                                     │  ║
║  │ (subject · context · as_of · version) → value              │  ║
║  │ append-only · provenance · sample size                     │  ║
║  │ context = competition edition | all-competitions           │  ║
║  └────────────────────────────────────────────────────────────┘  ║
╚═══════════════════════════════╤═══════════════════════════════════╝
                                ▼   reads only
╔═══════════════════════════════════════════════════════════════════╗
║ LAYER 3 — MODULE ENGINE                             [sealed]      ║
║                                                                   ║
║  ┌─────────────────────┐      ┌──────────────────────────────┐   ║
║  │ MODULE REGISTRY     │─────▶│ MODULE CALCULATORS           │   ║
║  │ key · question      │      │ judgement only —             │   ║
║  │ scope · tier        │      │ never raw calculation        │   ║
║  │ inputs · versions   │      └──────────────┬───────────────┘   ║
║  └─────────────────────┘                     ▼                    ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ MODULE READINGS                                            │  ║
║  │ status · strength · confidence · sample                    │  ║
║  │   └── EVIDENCE (relational: feature · value · direction)   │  ║
║  │   └── BASELINE ref ──────────────┐                         │  ║
║  └──────────────────────────────────┼─────────────────────────┘  ║
╚═════════════════════════════════════┼═════════════════════════════╝
                                      │
        ┌─────────────────────────────┘
        │  baselines read from calibration, never authored
        │
╔═══════╪═══════════════════════════════════════════════════════════╗
║ MATCH INTELLIGENCE SNAPSHOT                         [sealed]      ║
║       │                                                           ║
║  T-7 ─┼─── T-3 ─────── T-1 ─────── KICKOFF ──╢ seal              ║
║       │                                       ║                   ║
║  each snapshot seals, atomically:             ║                   ║
║    · feature state (what was true)            ║                   ║
║    · module readings (what followed)          ║                   ║
║    · INSTANT VERDICT (what we state)          ║                   ║
║        readiness edge · form edge · risk      ║                   ║
║        confidence · evidence count            ║                   ║
║        module consensus · completeness        ║                   ║
║                                               ║                   ║
║  after kickoff: outcome linkage only (additive)                   ║
║  formula correction: NEW version alongside, never a rewrite       ║
╚═══════════════════════════════╤═══════════════╤═══════════════════╝
                                │               │
              ┌─────────────────┘               └──────────────┐
              ▼                                                ▼
╔═════════════════════════════════════╗   ╔═══════════════════════════╗
║ CALIBRATION ENGINE      [sealed]    ║   ║ LAYER 4 — PRODUCT         ║
║                                     ║   ║                           ║
║  outcome linkage (additive)         ║   ║  READ MODELS              ║
║  reading-level scoring              ║   ║  derived · disposable ·   ║
║  calibration runs (versioned)       ║   ║  declared                 ║
║  calibration results (time series)  ║   ║      ↓                    ║
║    n · rate · baseline · lift · CI  ║   ║  ENTITLEMENT              ║
║    keyed by MODULE VERSION          ║   ║  plan × feature matrix    ║
║    sample gate enforced             ║   ║  one resolution path      ║
║                                     ║   ║      ↓                    ║
║  answers: "was this module          ║   ║  PRODUCT API              ║
║  historically reliable, at this     ║   ║      ↓                    ║
║  version, in this competition?"     ║   ║  FRONTEND (read-only)     ║
╚═════════════════════════════════════╝   ╚═══════════════════════════╝

╔═══════════════════════════════════════════════════════════════════╗
║ OPERATIONAL LAYER — observes every layer above                    ║
║                                                                   ║
║  pipeline runs · job runs · write records · failures               ║
║  api quota usage · data freshness · quality check results          ║
║                                                                   ║
║  in an append-only system a failed run leaves a PERMANENT GAP —    ║
║  gaps are silent unless the pipeline records its own failure       ║
╚═══════════════════════════════════════════════════════════════════╝
```

## 10.2 The five rules the diagram encodes

1. **Arrows point one way.** No layer reads upward. A module reading a raw table, or a feature reading a module reading, is an architectural violation detectable from the declared inputs.
2. **Sealing is a boundary, not a decoration.** Everything left of kickoff may be recalculated and appended. Everything at or right of it is permanent.
3. **Baselines flow from calibration to modules, never the reverse.** A module never authors its own historical rate.
4. **Read models hang off the side.** They are projections. Dropping every one of them loses nothing.
5. **Operations observes everything and is observed by nothing.** It is telemetry, exempt from the immutability commitments above it.

---

# 11. Key Architectural Decisions Required Before Schema Design

Unresolved decisions, grouped by what they block. Several depend on validations the audit identified as blocking — those are marked, because deciding them before the evidence arrives would be guessing.

## 11.1 Feature store design

**D1. How generic should the feature store be?**
Fully generic maximizes uniformity and pays in type safety and read performance. The hybrid in §3.2 proposes an explicit four-part test. *Decision: adopt the test, or set a different threshold?*

**D2. Which feature groups earn dedicated structures at launch?**
§3.2 nominates readiness components, predicted lineups, and provider statistics by domain. *Decision: confirm, extend, or reduce — and does promotion or demotion later require a migration, or is it transparent to consumers by design?*

**D3. What is the minimum temporal granularity?**
Per calculation run, per hour, or per day? Governs volume directly. *Depends on: recalculation cadence (D6) and retention (D9).*

**D4. Is context mandatory on every feature?**
Some features are meaningfully competition-scoped, some are not, some are explicitly cross-competition. *Decision: mandatory with an explicit all-competitions value, or optional with a null meaning global?* Mandatory is more verbose and less ambiguous.

## 11.2 Calculation execution

**D5. Event-driven or scheduled?**
V1 is scheduled and full-rebuild. Event-driven — recalculate what a change affects — is more efficient and considerably more complex, and requires the dependency graph to be reliable. *Recommendation: scheduled at launch, with declared inputs making event-driven a later option rather than a rewrite.*

**D6. What is the recalculation cadence per feature class?**
Fixture-driven features need recalculation as team news arrives; competition aggregates do not. *Decision: per-feature cadence in the registry, or a small number of named tiers?*

**D7. Full or incremental recomputation?**
V1 reprocesses every team and player on every run. At 100+ competitions this does not hold. *Decision: what defines the incremental unit — the entity, the competition edition, or the fixture window?*

## 11.3 Snapshots and immutability

**D8. Which snapshot points, exactly?**
§4.2 proposes T-7, T-3, T-1, kickoff. *Decision: confirm, and define behaviour for fixtures entering the window late or being rescheduled.* Rescheduling deserves explicit thought — a postponed fixture's earlier snapshots describe a match that did not happen when they said it would.

**D9. How many snapshots are retained, and for how long?**
All four permanently, or the kickoff snapshot permanently with earlier ones thinned after a period? Governs the largest volume decision in the system. *Depends on: the volume measurements the audit requested.*

**D10. Is match intelligence immutable after kickoff — confirmed?**
The blueprint assumes yes, with new-version claims as the escape hatch. This is the single most consequential commitment in the document. *Decision: confirm, and confirm that the new-version mechanism is an acceptable substitute for in-place correction.*

**D11. Does the seal trigger on kickoff time or on lifecycle state?**
V1 keys on provider status, defending by default. Kickoff time is more predictable; lifecycle state is more accurate when fixtures move. *Recommendation: internal lifecycle state, mapped from provider status, defaulting to sealed when ambiguous.*

## 11.4 Modules

**D12. Are module results fully generic, or do some modules keep bespoke structures?**
Fully generic maximizes extensibility; some modules may produce output the generic shape represents awkwardly. *Decision: fully generic with an evidence extension mechanism, or a documented exception path?*

**D13. Must every module support backtesting?**
Some modules are contextual rather than outcome-predictive — a league goal profile characterizes an environment rather than claiming an outcome. *Decision: is calibration mandatory for every module, or does the registry declare a calibration mode including "not outcome-scored"?* This has direct product consequences for what may be displayed alongside a module.

**D14. How are module readings surfaced when a module is inactive?**
Distinguishing "spoke, found nothing" from "could not speak" is architecturally provided; whether both are shown is a product decision.

**D15. Do modules read features only, or may they read other modules' readings?**
A consensus module reading other readings is legitimate but introduces ordering within Layer 3. *Recommendation: permit it, declared explicitly, as a distinct module class.*

## 11.5 Match intelligence and models

**D16. Which prediction model is canonical?**
The audit raised this; the architecture makes it answerable but does not answer it. *Decision required before design; may initially be either, with the calibration engine settling it empirically.*

**D17. Do non-canonical models continue to be produced?**
Producing several models and calibrating all of them is how the canonical choice stays evidence-based. It also multiplies calculation cost. *Decision: how many models are maintained concurrently?*

**D18. Does the verdict include a directional statement at all?**
The blueprint's verdict is a characterization with signed edges. Whether the product states a direction — as opposed to stating the edges and letting the reader conclude — is a positioning decision with real consequences for how the platform is perceived.

## 11.6 Scope and history

**D19. How much history is in scope — matches or intelligence?**
Ten years of fixtures is a modest volume. Ten years of snapshots, features, and module readings is two orders of magnitude larger. *Decision required before any sizing work.*

**D20. Is reconstructed history produced at all?**
Backfilling features and snapshots over historical fixtures enables far deeper calibration and is a new versioned claim, not an observation. *Decision: produce it, and if so, is it permitted to inform published baselines — given that V1 already learned this cohort can carry lookahead bias?*

**D21. What is the competition coverage target, and does it change the ingestion model?**
V1 tracks ~61 competitions against a stated target of 100+, and coverage is currently a code deployment. Moving coverage to data is assumed; whether the ingestion model itself changes is not. *Depends on: quota measurement.*

## 11.7 Product

**D22. Does entitlement become a plan-feature matrix?**
Affects the entitlement family's shape.

**D23. Do the four unbuilt-on families have a future?**
Billing, notifications, and the admin watch structure. *Decision determines whether they are designed forward or archived.* Note that the notification preference topics already name a module-change signal that V2's stored module readings would support directly — the product intent and the V2 substrate line up.

**D24. Does the estimated-weather module continue to ship at a paid tier?**
Under V2 the values are marked estimated regardless. The decision is whether the module ships on them, is gated off pending a real integration, or ships with the estimation disclosed.

## 11.8 Blocking prerequisites

These are not decisions. They are facts that must be obtained before design begins, restated here because §11's decisions depend on them:

1. **A complete, authoritative schema dump.** Five processors currently write against conflict targets that exist in no migration; the repository does not presently describe production.
2. **The thirteen materialized view definitions.** Two are on the match page and board hot paths and are defined nowhere in either repository.
3. **Row counts and table sizes**, particularly for the per-fixture player-pair family (D9, D19, §6.3).
4. **Orphan and integrity validation results** — season references, competition name resolution, duplicate snapshots, and the agreement rates between duplicated columns.
5. **API quota limits and current consumption** (D21).

Document 05 in this directory contains the specific requests and the SQL to produce them.

---

# Appendix — Traceability

Every architectural commitment traces to an audit finding.

| Blueprint section | Addresses |
|---|---|
| §2.1 Single source of truth | Readiness in 7 locations; confidence in 8; strength in 7; depth in 7; versatility in 8 |
| §2.2 Layer separation | Calculation mixed with product; computed values on provider tables; dependency graph invisible to the schema |
| §2.3 Immutability | 17 destructive singletons; 29 of 31 match structures rewritable after kickoff; retroactive correction impossible |
| §2.4 Formula versioning | One version column across 92 tables |
| §3.1 Football reality | Season identity split across two mechanisms; competition identified by name in calibration; no competition-membership entity |
| §3.2 Feature layer | Table-per-metric growth; no temporal dimension; no competition context; paired home/away columns |
| §3.3 Module layer | Modules only in application code; baselines hardcoded; three unconnected taxonomies for "a thing we noticed" |
| §3.4 Product layer | Plans and feature keys duplicated in code; two entitlement paths; undefined materialized views on hot read paths |
| §4 Match intelligence | Inputs and outputs sharing rows; competing predictions with no arbiter; partial immutability |
| §5 Team intelligence | Singletons; no season or competition context; 7 of 26 metrics archived |
| §6 Player intelligence | 118-column statistics table; five position columns; duplicated injury state; no valuation history; one-row-per-season limit |
| §7 Calibration | One archived snapshot per fixture; one model archived of several; latest-value-only backtest results |
| §8 Operational | One daily counters row as the entire observability surface |
| §9 Classification | All 92 tables; nothing removed; nothing assumed unnecessary |
