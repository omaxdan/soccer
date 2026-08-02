# PitchTerminal V2 — Logical Data Model

**Phase 4.** Technology-independent logical model derived from the approved architecture blueprint (document 06).

**This document is not a schema.** It contains no physical constructs — no storage types, no keys as implemented, no indexes, no partitioning, no triggers, no access rules, no interfaces. Those are Phase 5 concerns and are deliberately absent.

**Authority.** Every entity here follows from an architectural commitment already approved. Nothing is redesigned, no decision is reopened, and terminology is inherited unchanged. Where the architecture left a decision open, the entity is modelled and the dependency is stated — the model accommodates the decision rather than pre-empting it.

**Status.** This document is the authoritative specification for the V2 database implementation. Phase 5 realizes it; Phase 5 does not reinterpret it.

---

## Reading conventions

Entities are numbered for cross-reference and carry a stable prefix by family:

| Prefix | Family |
|---|---|
| `E1.x` | Football Reality |
| `E2.x` | Feature Engine |
| `E3.x` | Module Engine |
| `E4.x` | Match Intelligence |
| `E5.x` | Team Intelligence (derived) |
| `E6.x` | Player Intelligence |
| `E7.x` | Calibration |
| `E8.x` | Product |
| `E9.x` | Operational |

Logical constraints are numbered `LC-nn` and consolidated in §4.15.

Each entity is classified by **construct kind**, because not everything named in the architecture is an entity in the logical sense, and conflating the three is how a logical model becomes a table list:

| Kind | Meaning |
|---|---|
| **Entity** | Has independent existence and its own identity |
| **Value Object** | Has no independent identity; exists only as a qualified part of an entity |
| **Identity Component** | Participates in forming another entity's identity; not itself a thing |
| **Reference Entity** | A governed, slow-changing vocabulary that other entities point at |
| **Derived View** | Has no stored existence; defined entirely by a rule over other entities |

Each entity entry states: **Purpose · Layer & ownership · Identity · Lifecycle · Relationships · Version behaviour · Immutability · Context · Constraints · Historical behaviour · Example.** Where a facet does not apply, that is stated rather than omitted — a facet marked *not applicable* is itself information about the entity.

---

# 4.1 Principles of the Logical Model

Eight principles govern every entity in this document. They are the architectural commitments restated as modelling rules, and every constraint in §4.15 derives from one of them.

## 4.1.1 Entity ownership

Every entity has exactly one **owning process class** — the only process permitted to bring it into existence or alter it. Ownership is a property of the entity, declared in the model, not a convention observed by whoever writes to it.

Four owning process classes exist, one per layer:

| Owner | Owns |
|---|---|
| **Ingestion** | Football Reality entities |
| **Feature calculation** | Feature values and their lineage |
| **Module calculation** | Module readings, evidence, and verdicts |
| **Product & user action** | Product-layer entities |

Two cross-cutting owners exist outside the layer stack: **Calibration** (owns calibration entities) and **Operations** (owns operational entities).

An entity with two owners is a modelling error, not a design trade-off. Where the architecture found the same fact written by two processes — provider-reported injury state alongside a computed injury summary, current club alongside transfer history — the logical model assigns one owner and derives the other.

## 4.1.2 One source of truth

Every fact is **stated once, by one entity, under one owner**. Every other appearance of that fact is one of exactly two things, and both are marked as such in the model:

- a **resolution** — the same fact, for a stated subject, at a stated moment, materialized inside a sealed artefact for reproducibility; or
- a **projection** — a derived view or disposable materialization whose authority lies entirely in the entity it reads from.

Neither constitutes a second owner. A resolution that cannot name the entity it resolves, or a projection that cannot be rebuilt from its source, violates the principle.

This is the rule that dissolves the architecture's central finding. A metric appearing in seven places is not seven facts; it is one fact, one resolution mechanism, and one projection mechanism.

## 4.1.3 Append-only versus mutable

Three write postures exist, and every entity declares exactly one:

| Posture | Rule |
|---|---|
| **Mutable** | Corrected in place. Only the latest state is meaningful. |
| **Append-only** | Never corrected. A new statement supersedes an earlier one by being later; both persist. |
| **Sealed** | Written once, then permanently unmodifiable by any process for any reason. |

The distinction rests on a single question: **is this a description of the present, or a claim about a moment?** Descriptions may be corrected. Claims may not.

Provider-reported reality is a description — providers revise, and the revision is the better description. Anything the platform calculated, judged, or stated is a claim, and a claim about a past moment cannot become untrue by being recalculated. It can only be joined by a second claim.

## 4.1.4 Version ownership

Every calculated entity **owns** a version identity and **inherits** the version identities of what it consumed.

- **Owned version** — the identity of the rule that produced this entity. It is part of the entity's identity, not a descriptive attribute.
- **Inherited version** — the version identities of the entities consumed, held by reference. Inheritance is never a copy: a consuming entity points at what it consumed rather than restating it.

Version identity is **declared before use**. A calculated entity referencing an unregistered version is invalid. This is what prevents version identity from degrading into free text, which would make it unreasonable-about and therefore worthless.

The full inheritance chain is specified in §4.13.

## 4.1.5 Temporal identity

For every calculated entity, **the moment is part of the identity**, and two moments are distinguished:

- **As-of** — the moment in the world that the value describes.
- **Calculated-at** — the moment the calculation ran.

These are independent. A calculation running today may produce a value describing a moment last year; that is backfill, and it is legitimate and marked. Conflating them — as a single processing timestamp does — makes a calculated entity unable to say what it is about.

Two values of the same metric for the same subject at different as-of moments are **two entities, not one entity updated**. This is the modelling consequence of append-only, and it is what makes point-in-time reconstruction a query rather than a reconstruction project.

## 4.1.6 Context identity

For every calculated entity, **the competition scope is part of the identity**.

Three context kinds exist:

| Context kind | Meaning |
|---|---|
| **Competition-scoped** | The value describes the subject within one competition edition |
| **All-competitions** | The value describes the subject overall, across everything it participates in |
| **Cross-competition derived** | The value is explicitly *about* the interaction between competitions |

Context is **mandatory and explicit**. There is no absent context meaning "global", because an absent context is indistinguishable from an unset one, and the distinction between "this team's form in this competition" and "this team's fatigue overall" is exactly what the architecture requires the model to express.

Which context kinds are valid for a given metric is declared, not assumed — a metric calculated at an invalid context is a detectable error.

## 4.1.7 Historical preservation

**No process destroys a claim.** This is absolute and admits no operational exception.

Three mechanisms preserve history, and between them they cover every case the architecture identified:

1. **Append-only calculation** — a new value never displaces an earlier one.
2. **Sealing** — a claim about a fixture becomes permanently unmodifiable once made.
3. **New-version claims** — an improved rule produces additional claims alongside the originals, never in place of them.

The third is what keeps preservation from becoming paralysis. A model that only forbade rewriting would make formula improvement impossible; version identity gives a corrected value somewhere to exist.

Thinning is permitted and is not destruction: an intermediate value may be removed when a sealed artefact retains what was claimed from it. Removing a value that a sealed artefact references is destruction and is forbidden.

## 4.1.8 Derived versus authoritative entities

Every entity is **authoritative** or **derived**, and the model states which.

- **Authoritative** entities are the sole statement of their fact. Losing one loses information permanently.
- **Derived** entities are computable from authoritative entities by a stated rule. Losing all of them loses nothing but the work of recomputation.

Two rules follow, and together they make the boundary testable rather than aspirational:

- A derived entity **must name the rule and the entities it derives from**. A derivation nobody can state is not a derivation.
- A derived entity **must be discardable**. If discarding it loses information, it was authoritative and is misclassified.

Sealed resolutions occupy a deliberate middle position: the values inside a sealed artefact are derived in origin and authoritative in status, because the artefact's purpose is to make them permanent. Once sealed, they are no longer discardable — the seal is what promotes them.

---

# 4.2 Layer 1 — Football Reality Entities

**Layer purpose.** To state what happened in the world, as reported by external providers.

**Layer ownership.** Ingestion, exclusively. No calculation process brings a Layer 1 entity into existence or alters one. This boundary held throughout the previous system and is inherited without modification.

**Layer posture.** Mutable, in the specific sense of §4.1.3: providers revise, and revisions are applied. Revision is not rewriting a claim — the platform made no claim here. It is accepting a better description.

**What is excluded.** Any value the platform computed. Any judgement. Any flag whose meaning is "we decided". The architecture identified two specific intrusions in the previous system — a computed sufficiency gate on a provider statistics record, and computed injury summary attributes on a player record — and both are assigned to Layer 2 in this model.

**One qualification on revision.** A revision to a *result* is materially different from a revision to a *name*, because sealed claims were made against the pre-revision result. Result revision is therefore observable rather than silent (E1.19), so that calibration can distinguish a claim that was wrong from a claim measured against a figure that later changed.

---

### E1.01 Country

**Purpose.** The canonical geographic vocabulary. It exists because the previous system populated a canonical country list and then bypassed it with free text in three separate places, producing three incompatible spellings of the same geography and making regional analysis unreliable. Every geographic reference in V2 resolves here.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Reference Entity.

**Identity.** Stable identity, independent of name. A country's name may be revised; its identity does not change.

**Lifecycle.** Mutable. Slow-changing.

**Relationships.** Referenced by Competition (E1.02) for competition geography, by Venue (E1.05) for venue location, by Team (E1.06) for club nationality, and by Player (E1.08) for player nationality. It references nothing.

**Version behaviour.** Not applicable. Reality entities carry no formula version — no rule produced them.

**Immutability.** None. Corrections are applied in place.

**Context.** Not applicable. Context qualifies calculated entities; a country is not calculated.

**Constraints.** LC-01, LC-02.

**Historical behaviour.** Current state only. Geographic history is out of scope for the platform.

**Example.** A club's nationality, a venue's location, and a competition's national association all resolve to the same country identity rather than to three independently-spelled strings.

---

### E1.02 Competition

**Purpose.** A competition's **stable identity across all time**. It exists to separate what a competition *is* from what it is currently *called* — the architecture recorded a real instance of a competition being stored under a sponsor-branded name that differed from the provider's name, and the previous system's calibration history was keyed on competition name, so a rename severed the accumulated evidence for that competition.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** Stable identity, deliberately independent of name, sponsor, and format. A competition renamed, responsored, or restructured remains the same competition.

**Lifecycle.** Mutable. Names and attributes are revised; identity is not.

**Relationships.** References Country (E1.01). Parent of Competition Edition (E1.03). Referenced as a context anchor by calibration entities that measure reliability per competition.

**Version behaviour.** Not applicable.

**Immutability.** None, with one qualification: a competition's **identity** may never be reassigned, because sealed claims and calibration series reference it permanently.

**Context.** Not applicable — it is a component of context rather than a subject of one.

**Constraints.** LC-01, LC-03.

**Historical behaviour.** Permanent. A competition entity persists after the competition ceases to exist, because historical claims reference it.

**Example.** A domestic top division retains one identity across a decade of sponsor renames, so ten years of accumulated calibration evidence remains attached to one competition rather than fragmenting across four names.

---

### E1.03 Competition Edition

**Purpose.** **A competition in a specific season.** This is the entity whose absence the architecture identified as the root of several unrelated-looking problems, and introducing it resolves all of them at once: provider statistics gain a real referent rather than an unconstrained external season number; standings gain a temporal home; fixtures gain unambiguous competition context; calibration gains a competition key that survives a rename; and calculated values gain the context anchor that lets a club's state differ between the competitions it plays in.

It is the single most load-bearing entity in Layer 1.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity. Also serves as an **Identity Component** for every calculated entity, via Feature Context (E2.08).

**Identity.** Stable identity derived from the combination of competition and season. A season is a bounded period, not a label — the previous system stored season as free text, which made "which season was active on this date" unanswerable.

**Lifecycle.** Mutable during ingestion of its details; permanent thereafter.

**Relationships.** References Competition (E1.02). Parent of Competition Stage (E1.04), Team Registration (E1.07), and Standing (E1.20). Referenced by Fixture (E1.13), by all provider statistics (E1.21), and by Feature Context (E2.08) as the competition-scoped context value.

**Version behaviour.** Not applicable.

**Immutability.** Identity is permanent once established. Sealed claims, calibration series, and every competition-scoped calculated value reference it.

**Context.** It **is** context. Competition-scoped calculated entities name a competition edition as their context value.

**Constraints.** LC-01, LC-03, LC-04.

**Historical behaviour.** Permanent, and one of the most heavily referenced entities in the model. Ten years of history means ten editions per competition, each permanently referenced.

**Example.** A club's opponent-adjusted form is calculated separately for its domestic edition and its continental edition, because the two are genuinely different — different opponents, different congestion, different stakes. The previous model could hold only one figure covering both.

---

### E1.04 Competition Stage

**Purpose.** The structural phase of a competition edition — group phase, knockout round, matchweek, playoff. It exists because the previous system had no round or matchweek concept at all, which made stage-relative analysis impossible and left a documented product gap unfillable.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** Stable, within its competition edition. A stage is identified by its edition and its position within that edition's structure, not by a label alone — labels repeat across editions.

**Lifecycle.** Mutable during ingestion; permanent thereafter.

**Relationships.** References Competition Edition (E1.03). Referenced by Fixture (E1.13). May reference a parent stage where competitions nest phases within phases.

**Version behaviour.** Not applicable.

**Immutability.** Identity permanent once fixtures reference it.

**Context.** Not a context anchor in its own right. Stage-relative analysis is expressed as a calculated metric, not as a context kind — the architecture defines exactly three context kinds and this model does not extend them.

**Constraints.** LC-01, LC-03.

**Historical behaviour.** Permanent.

**Example.** Distinguishing a fixture in a group phase from one in a knockout round, so that stakes-sensitive analysis can reference a real structural fact rather than inferring it from the calendar.

---

### E1.05 Venue

**Purpose.** A physical location where fixtures are played, with the geography, capacity, timezone, and surface that downstream calculation depends on. It exists as an entity in its own right — rather than as attributes of a club — because a venue is shared, neutral venues exist, and travel calculation requires coordinates that belong to the place rather than to whoever is playing there.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** Stable, independent of name and of current tenant. Venues are renamed frequently and change tenant occasionally.

**Lifecycle.** Mutable.

**Relationships.** References Country (E1.01). Referenced by Team (E1.06) as home venue, by Fixture (E1.13) as the location of play, and consumed by travel-related feature calculation.

**Version behaviour.** Not applicable.

**Immutability.** None.

**Context.** Not applicable.

**Constraints.** LC-01, LC-02, LC-05.

**Historical behaviour.** Current state. Historical capacity or surface changes are not modelled; the platform has no consumer for them.

**Example.** Travel distance for an away side is computed from the geographic separation between its home venue and the fixture venue. A missing coordinate makes the calculation unavailable, which under LC-05 must be expressed as absence rather than as a zero — the distinction between "no travel" and "travel unknown" is one the previous system could not make.

---

### E1.06 Team

**Purpose.** A club's **stable identity**. One of the two hub entities of the entire model — very nearly every calculated entity resolves to a team or to a fixture between two.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** Stable, independent of name, of current competition, and of current venue.

**Lifecycle.** Mutable.

**Relationships.** References Country (E1.01) for nationality and Venue (E1.05) for home venue. Parent of Team Registration (E1.07). Referenced by Player Registration (E1.09), by both sides of Fixture (E1.13), by Standing (E1.20), and as a subject by a large share of all feature values and module readings.

**Version behaviour.** Not applicable.

**Immutability.** Identity permanent — sealed claims reference it indefinitely.

**Context.** Not applicable to the entity itself. Its *calculated* state is heavily context-scoped, which is the point of Team Registration (E1.07).

**Constraints.** LC-01, LC-02.

**Historical behaviour.** Permanent.

**Example.** A club dissolved five years ago retains its identity, because sealed claims about fixtures it played reference it and those claims are permanent.

---

### E1.07 Team Registration

**Purpose.** **A club's participation in a competition edition.** It exists to answer "which clubs are in this competition this season" — a question the previous system could answer only by inference from standings or from the fixture list, both of which are indirect and both of which fail for a club that has registered but not yet played.

It is also the natural anchor for competition-scoped club context, and therefore the reality-layer counterpart to the context dimension that runs through Layer 2.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of club and competition edition.

**Lifecycle.** Mutable during a season — clubs are excluded, withdraw, or are replaced.

**Relationships.** References Team (E1.06) and Competition Edition (E1.03). Referenced by Standing (E1.20) and consulted by competition-scoped feature calculation to determine which clubs are in scope.

**Version behaviour.** Not applicable.

**Immutability.** None, but historical registrations persist — a club's participation in a past edition is permanent fact.

**Context.** It is the reality-layer expression of competition scope.

**Constraints.** LC-01, LC-03, LC-06.

**Historical behaviour.** Permanent per edition. Ten editions produce ten registrations for a continuously participating club.

**Example.** Determining which clubs a competition-scoped aggregate covers, without inferring membership from whoever happens to appear in the fixture list.

---

### E1.08 Player

**Purpose.** A person's **stable identity and biography** — name, birth date, nationality, physical attributes, preferred foot. Biography only.

The architecture identified this entity in the previous system as carrying four concerns beyond biography: positional profile across five attributes plus a sixth list representation, current club affiliation, current injury state across ten attributes duplicating a separate injury record, and a single undated market value overwritten on every ingestion. All four are separated out in this model, into E1.10, E1.09, E1.11 and E1.12 respectively.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** Stable, independent of club, position, availability, and valuation.

**Lifecycle.** Mutable. Biographical attributes are corrected as providers revise them.

**Relationships.** References Country (E1.01). Parent of Player Registration (E1.09), Position Profile (E1.10), Player Availability (E1.11), and Player Valuation (E1.12). Referenced by Appearance (E1.17), by provider statistics (E1.21), and as a subject by player-scoped feature values.

**Version behaviour.** Not applicable.

**Immutability.** Identity permanent.

**Context.** Not applicable to the entity. Player *statistics* and *calculated state* are context-scoped.

**Constraints.** LC-01, LC-02, LC-07.

**Historical behaviour.** Permanent.

**Example.** A player who has represented four clubs across a decade has one identity, four registration periods, a position profile, an availability history, and a valuation series — where the previous model held one row that was overwritten as each fact changed.

---

### E1.09 Player Registration

**Purpose.** **A player's affiliation with a club over a period**, including loans. It exists to answer "who was at this club on this date" — the previous system stored current club only, so squad composition at any past moment had to be reconstructed by replaying transfer records, and any gap or duplicate in those records corrupted the reconstruction silently.

Registration also subsumes what the previous system expressed as transfers. A transfer is the **boundary between two registrations**, not an independent fact, and modelling the periods rather than the transitions removes an entire class of reconstruction error.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of player, club, and period start.

**Lifecycle.** Mutable while open — an expected end date is revised. Permanent once closed.

**Relationships.** References Player (E1.08) and Team (E1.06). May reference Competition Edition (E1.03) where registration is competition-specific, as it is in competitions operating squad registration rules.

**Version behaviour.** Not applicable.

**Immutability.** Closed registrations are permanent fact.

**Context.** Optionally competition-scoped, for competitions where a player may be registered for one competition and not another.

**Constraints.** LC-01, LC-03, LC-08.

**Historical behaviour.** Fully preserved. This is the entity that makes historical squad reconstruction a query.

**Example.** Determining the squad available to a club for a fixture played three seasons ago, by selecting registrations open on that date — rather than by replaying a transfer sequence and hoping it is complete.

**Note on provenance.** The previous system distinguished provider-confirmed transfers from transfers inferred by comparing squad snapshots, using a marker on the transfer record. That distinction is preserved and generalized: a registration carries a provenance classification (E2.07), because an inferred registration boundary is a materially weaker fact than a confirmed one and downstream consumers must be able to tell.

---

### E1.10 Position Profile

**Purpose.** The positions a player occupies, with role ranking and source. It exists because the previous system expressed position across five separate attributes on the player record plus a sixth list representation, with no stated precedence between them — which made "which players can play at left-back" a scan across six representations rather than a relationship traversal, and made the primary/secondary/tertiary ordering implicit in attribute naming rather than explicit in data.

**Layer & ownership.** Layer 1 · Ingestion. Where a position profile is *calculated* from observed appearances rather than provider-asserted, the calculated form is a feature (§4.7) and does not belong here.

**Construct kind.** Entity.

**Identity.** The combination of player and position.

**Lifecycle.** Mutable. Positional profiles evolve.

**Relationships.** References Player (E1.08) and Position (a reference vocabulary, E1.10a). Consumed by lineup prediction and depth-related feature calculation.

**Version behaviour.** Not applicable in its provider-asserted form.

**Immutability.** None.

**Context.** Not applicable.

**Constraints.** LC-01, LC-03, LC-09.

**Historical behaviour.** Current profile only. Historical positional evolution, where required, is a calculated feature over observed appearances rather than a history of this entity.

**Example.** Identifying cover for an absent left-back by traversing to every player whose profile includes that position at any rank, rather than by inspecting six differently-named attributes.

---

### E1.10a Position

**Purpose.** The governed vocabulary of playing positions. It exists because the previous system carried position codes as uncontrolled text across five separate structures with no shared vocabulary, so the same position could be spelled differently in each and no join between them was safe.

**Layer & ownership.** Layer 1 · Ingestion, under platform governance.

**Construct kind.** Reference Entity.

**Identity.** Stable code with stable meaning.

**Lifecycle.** Mutable, slow-changing, governed. A new position value is a deliberate act.

**Relationships.** Referenced by Position Profile (E1.10), Lineup (E1.16), Appearance (E1.17), predicted lineups (§4.7), and every position-scoped feature.

**Version behaviour.** Not applicable.

**Immutability.** A position's meaning may not be redefined in place — sealed claims reference it. A changed meaning is a new position value.

**Context.** Not applicable.

**Constraints.** LC-01, LC-10.

**Historical behaviour.** Permanent. Retired position values persist because historical claims reference them.

**Example.** Positional depth comparison across two clubs is meaningful only when both resolve to the same position vocabulary.

---

### E1.11 Player Availability

**Purpose.** A period during which a player is unavailable — injury, suspension, or otherwise — with onset, expected return, actual end, severity, reason, and the player's position and valuation at onset.

It exists to hold, in **one** owner, what the previous system held in two: ten attributes on the player record and a separate injury record, both written by the same ingestion process, with nothing constraining them to agree. The resolution is not to synchronize the two representations but to remove one of them.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of player and spell onset.

**Lifecycle.** Mutable while open — expected return is revised as information arrives. Permanent once closed.

**Relationships.** References Player (E1.08) and Position (E1.10a) for position at onset. Consumed by availability-related feature calculation and by lineup prediction.

**Version behaviour.** Not applicable.

**Immutability.** Closed spells are permanent fact.

**Context.** Optionally competition-scoped for suspensions, which are frequently competition-specific — a player suspended in one competition may be available in another. This is a real modelling requirement, not a hypothetical, and the previous system could not express it.

**Constraints.** LC-01, LC-03, LC-11.

**Historical behaviour.** Fully preserved. Availability history is a genuine analytical asset.

**Example.** Current availability is a query over open spells, not a stored flag. This eliminates by construction the divergence the architecture found between the two prior representations, because there is now only one.

**Note on point-in-time capture.** Recording position and valuation *at onset* is a pattern the previous system applied here and almost nowhere else. It is the right instinct — a player's importance at the moment of injury is not recoverable later once the profile moves on — and it is preserved.

---

### E1.12 Player Valuation

**Purpose.** A player's market value **over time**, with currency, source, and as-of date.

It exists because the previous system stored a single undated, uncurrencied scalar, overwritten on every ingestion. That discarded valuation *trajectory* continuously — and trajectory is signal, since a rising valuation and a falling one at the same absolute figure describe very different players.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of player, source, and as-of date.

**Lifecycle.** Append-only. A new valuation never displaces an earlier one — this is a reality entity with an append-only posture, and the exception is deliberate: a valuation is a dated observation, not a description of a permanent present.

**Relationships.** References Player (E1.08). Consumed by squad value and injury impact feature calculation.

**Version behaviour.** Not applicable — the platform does not compute these; providers assert them.

**Immutability.** Recorded valuations are permanent.

**Context.** Not applicable.

**Constraints.** LC-01, LC-12.

**Historical behaviour.** Fully preserved by construction.

**Example.** A squad's aggregate value at a past moment is computed from the valuations in force at that moment — where the previous model could only ever apply today's figures to yesterday's squad, silently.

**Currency.** Valuations carry currency explicitly. The previous system stored an uncurrencied scalar in one place and a currency-named attribute in another, making cross-source comparison unsound.

---

### E1.13 Fixture

**Purpose.** A scheduled meeting between two clubs. The second hub entity of the model, and the anchor of everything in §4.5.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** Stable, independent of scheduled time. A postponed fixture retains its identity when rescheduled — this matters because sealed claims made before the postponement reference it, and reassigning identity on reschedule would orphan them.

**Lifecycle.** Mutable in its scheduling attributes — time, venue, and stage are revised. Its **lifecycle state** (E1.14) advances rather than being revised.

**Relationships.** References Competition Edition (E1.03), Competition Stage (E1.04), Venue (E1.05), and Team (E1.06) twice, in stated home and away roles. Parent of Result (E1.19), Lineup (E1.16), Appearance (E1.17), and official assignments (E1.15). Referenced as subject by fixture-scoped feature values, module readings, and every Match Snapshot (E4.01).

**Version behaviour.** Not applicable.

**Immutability.** Identity permanent. Scheduling attributes remain revisable until the lifecycle state seals.

**Context.** Its competition edition supplies context to every fixture-scoped calculated entity derived from it.

**Constraints.** LC-01, LC-03, LC-13.

**Historical behaviour.** Permanent, and the most heavily referenced entity in the model at scale.

**Example.** Ten years of fixtures across a hundred competitions form the population over which every calibration measurement is taken.

**Note on the home and away roles.** The two participant roles are **stated roles, not a symmetric pair**. Venue advantage, travel, and virtually every comparative metric depend on the distinction. Neutral-venue fixtures retain the stated roles while the venue relationship reflects neutrality — the roles are how the fixture is constituted, not an assertion about geography.

---

### E1.14 Fixture Lifecycle State

**Purpose.** The **platform's own** statement of where a fixture stands: scheduled, in progress, completed, postponed, abandoned, cancelled.

It exists because the previous system used the provider's status string directly, and that string was load-bearing — the immutability guard, four calculation processes' scoping, and the entire sealing posture all branched on it. The architecture recorded the consequence plainly: the vocabulary belonged to the provider, was not fully enumerable, and a new provider value would silently change platform behaviour.

Sealing is the most consequential commitment in the architecture. It cannot depend on a vocabulary the platform does not control.

**Layer & ownership.** Layer 1 · Ingestion, but the **vocabulary is platform-governed**. Ingestion maps provider status onto this vocabulary; it does not extend it.

**Construct kind.** Reference Entity (the vocabulary) with a per-fixture current value and transition history.

**Identity.** Stable state codes with stable meanings, plus per-fixture transition records identified by fixture and transition moment.

**Lifecycle.** Append-only per fixture. States advance; transitions are recorded, not overwritten.

**Relationships.** References Fixture (E1.13). Consulted by the sealing rule (§4.5) and by every calculation process scoping itself to fixtures still open.

**Version behaviour.** The **mapping** from provider status to platform state is a versioned rule, because a change to it changes platform behaviour and must be attributable.

**Immutability.** Transition records are permanent.

**Context.** Not applicable.

**Constraints.** LC-01, LC-10, LC-14.

**Historical behaviour.** Full transition history preserved. A fixture postponed and replayed has a legible history rather than a final state that conceals it.

**Example.** The sealing rule consults platform lifecycle state, not provider status. An unrecognized provider value maps to a state that seals by default — inheriting the previous system's posture of protecting whenever a fixture is not explicitly still open, rather than attempting to enumerate every value meaning "over".

---

### E1.15 Official Assignment

**Purpose.** The officials appointed to a fixture, in their stated roles. It exists because officiating identity was a documented product requirement that the previous schema could not express at all.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity, referencing an Official reference entity.

**Identity.** The combination of fixture, official, and role.

**Lifecycle.** Mutable until the fixture seals — appointments change.

**Relationships.** References Fixture (E1.13) and Official (E1.15a).

**Version behaviour.** Not applicable.

**Immutability.** Permanent once the fixture seals.

**Context.** Not applicable.

**Constraints.** LC-01, LC-03.

**Historical behaviour.** Permanent.

**Availability note.** The architecture recorded that provider availability of officiating data was unconfirmed. The entity is modelled because the requirement is real; whether it is populated is an ingestion question, and an unpopulated entity is a coverage fact rather than a modelling defect.

---

### E1.15a Official

**Purpose.** A match official's stable identity, so that officiating patterns can be analysed across fixtures rather than treated as per-fixture text.

**Layer & ownership.** Layer 1 · Ingestion. **Construct kind.** Reference Entity. **Identity.** Stable. **Lifecycle.** Mutable. **Relationships.** References Country (E1.01); referenced by Official Assignment (E1.15). **Version behaviour.** Not applicable. **Immutability.** Identity permanent. **Context.** Not applicable. **Constraints.** LC-01, LC-02. **Historical behaviour.** Permanent.

---

### E1.16 Lineup

**Purpose.** The **actual** lineup as reported: which players started, which were substitutes, in which positions, wearing which numbers, in which formation.

It exists as an entity strictly separate from predicted lineups (§4.7), and the separation is not stylistic. A predicted lineup is a Layer 2 calculated artefact carrying a formula version and subject to calibration; an actual lineup is Layer 1 reality. Housing them together would place a claim and an observation in the same structure, which is precisely the input/output conflation the architecture set out to eliminate.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of fixture and club.

**Lifecycle.** Mutable until confirmed; permanent once the fixture seals.

**Relationships.** References Fixture (E1.13), Team (E1.06), and — through its constituent selections — Player (E1.08) and Position (E1.10a). Consumed by lineup-prediction calibration, which measures predicted against actual.

**Version behaviour.** Not applicable.

**Immutability.** Permanent once sealed.

**Context.** Inherits fixture context.

**Constraints.** LC-01, LC-03, LC-15.

**Historical behaviour.** Permanent.

**Example.** Predicted lineup accuracy is measured by comparing a sealed prediction against this entity — a comparison the model supports because the two are distinct entities with distinct owners.

**Formation.** Formation is an attribute of a club's lineup, stated once. The previous system stored it both on a per-club structure and repeated on every player row of that club's selection, creating two representations of one fact.

---

### E1.17 Appearance

**Purpose.** A player's participation in a fixture: minutes played, whether starting, substitute, or unused, and disciplinary outcome.

It exists because participation is the foundational input to every load, fatigue, and readiness calculation, and because the previous system's representation could not express one of the three participation states. Two independent flags for starting and substitute leave "named but unused" indistinguishable from "absent from the record entirely" — and those are materially different facts for a fatigue model.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of fixture and player.

**Lifecycle.** Mutable until the fixture seals; permanent thereafter.

**Relationships.** References Fixture (E1.13), Player (E1.08), Team (E1.06), and Position (E1.10a). Consumed by load, fatigue, readiness, importance, and depth feature calculation.

**Version behaviour.** Not applicable.

**Immutability.** Permanent once the fixture seals.

**Context.** Inherits fixture context.

**Constraints.** LC-01, LC-03, LC-16.

**Historical behaviour.** Permanent. One of the highest-volume entities in the model.

**Example.** Trailing-window minutes across the last seven and thirty days derive entirely from this entity, at any historical moment — the same query shape whether the moment is today or four years ago.

**Participation state.** A single stated participation state — started, substituted on, unused substitute, not selected — replaces two flags that could not express the third and fourth cases.

---

### E1.18 Match Event

**Purpose.** Discrete occurrences within a fixture: goals, cards, substitutions, with timing.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of fixture, event sequence, and event type.

**Lifecycle.** Mutable until the fixture seals; permanent thereafter.

**Relationships.** References Fixture (E1.13), Player (E1.08), and Team (E1.06).

**Version behaviour.** Not applicable.

**Immutability.** Permanent once sealed.

**Context.** Inherits fixture context.

**Constraints.** LC-01, LC-03.

**Historical behaviour.** Permanent.

**Scope note.** Modelled conditionally: included only where a provider supplies event data and a calculated metric consumes it. An entity with no producer and no consumer is scope creep, and the architecture's constraint against inventing features outside platform scope applies to the logical model as directly as to the architecture.

---

### E1.19 Result

**Purpose.** The outcome of a played fixture: final score, interval scores, and the outcomes of extra time and penalties where they occurred.

It exists separately from Fixture (E1.13) because a scheduled fixture has no result, and modelling absence as a set of empty attributes on the fixture makes "not yet played" and "played, nil-nil" structurally identical.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The fixture.

**Lifecycle.** Mutable in the narrow window before confirmation; permanent thereafter, with revisions **observable** rather than silent.

**Relationships.** References Fixture (E1.13). Consumed by outcome linkage (E4.08), by every calibration measurement, and by form-derived feature calculation.

**Version behaviour.** Not applicable.

**Immutability.** Permanent once confirmed. Post-confirmation revision — a provider correcting a score, or an outcome amended by a governing body — is recorded as a **revision with its own record**, never as a silent overwrite.

**Context.** Inherits fixture context.

**Constraints.** LC-01, LC-03, LC-17.

**Historical behaviour.** Permanent, including revision history.

**Example.** A fixture whose result is amended weeks later by a disciplinary ruling has both the original and the amended result on record. Sealed claims were measured against the original; calibration must be able to tell that this happened, or a claim that was correct at measurement time silently becomes a miss.

**Cup completeness.** Extra time and penalty outcomes are modelled explicitly. The previous system's result shape was lossy for cup fixtures, which distorted any measurement taken over a population including them.

---

### E1.20 Standing

**Purpose.** A club's position within a competition edition **as of a date**.

The temporal qualifier is the entire point. The previous system stored current standings only, with no as-of dimension — which is why a separate point-in-time reconstruction mechanism had to be built to support backtesting, replaying results to infer what the table looked like when a historical claim was made. Making standings temporal removes that compensating mechanism from the system rather than reimplementing it.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of competition edition, club, standing variant, and as-of date. The variant distinguishes overall, home-only, and away-only tables.

**Lifecycle.** Append-only. Each observation is a new statement.

**Relationships.** References Competition Edition (E1.03) and Team (E1.06). Consumed by strength, opponent-quality, and fixture-difficulty feature calculation.

**Version behaviour.** Not applicable — provider-asserted.

**Immutability.** Recorded observations are permanent.

**Context.** Competition-scoped by construction.

**Constraints.** LC-01, LC-03, LC-18.

**Historical behaviour.** Fully preserved by construction.

**Example.** Opponent quality at the moment a claim was made resolves from the standing in force on that date — directly, rather than by replaying the season to reconstruct it.

---

### E1.21 Provider Statistic Record

**Purpose.** Statistics as reported by a provider, for a subject, within a competition edition, **partitioned by statistical domain**.

Two defects in the previous system motivate this shape. First, a single very wide structure mixed outfield and goalkeeping measures, leaving roughly half its attributes permanently unpopulated for any given player — an outfielder has no save count, a goalkeeper no dribble count. Second, and more consequentially, its identity rule permitted one record per player per season, so a player transferring mid-season within a competition, or appearing in two competitions in one season, **could not be represented at all**.

Domain partitioning addresses the first. The revised identity addresses the second.

**Layer & ownership.** Layer 1 · Ingestion.

**Construct kind.** Entity.

**Identity.** The combination of subject, club, competition edition, statistical domain, and provider. Including club in the identity is what makes a mid-season transfer representable as two records rather than as a collision.

**Lifecycle.** Mutable — providers revise statistics throughout a season.

**Relationships.** References Player (E1.08) or Team (E1.06) as subject, Team (E1.06) as club, Competition Edition (E1.03), and Statistics Domain (E1.22). Consumed extensively by feature calculation.

**Version behaviour.** Not applicable — the platform does not compute these.

**Immutability.** None. Statistics are descriptions and are corrected.

**Context.** Competition-scoped by construction.

**Constraints.** LC-01, LC-03, LC-19.

**Historical behaviour.** Current provider state per edition. Statistics settle at season end and are effectively permanent thereafter.

**Example.** A player appearing in a domestic competition and a continental one in the same season holds two records per domain — where the previous model could hold one, forcing a choice between them.

**No calculated attributes.** A sufficiency gate expressing whether a player has played enough to be meaningfully rated is a **calculated judgement** and belongs to Layer 2. The previous system carried exactly such a gate on this record, which is the intrusion §4.2 identified.

---

### E1.22 Statistics Domain

**Purpose.** The governed vocabulary partitioning statistics into coherent groups: participation, attacking, creation, defending, discipline, goalkeeping, physical.

It exists so that the partitioning is **data rather than structure**. Adding a provider measure extends one domain; it does not widen anything. A goalkeeper carries goalkeeping and participation domains and nothing else, so sparsity disappears rather than being tolerated. And domains can be ingested and refreshed independently, which matters because providers supply them on different schedules — a fact the previous single-structure shape could not accommodate.

**Layer & ownership.** Layer 1 · Ingestion, under platform governance.

**Construct kind.** Reference Entity.

**Identity.** Stable domain code with stable meaning.

**Lifecycle.** Mutable, slow-changing, governed.

**Relationships.** Referenced by Provider Statistic Record (E1.21) and by feature definitions declaring which domain they consume.

**Version behaviour.** Not applicable.

**Immutability.** A domain's meaning may not be redefined in place — sealed claims reference the measures within it.

**Context.** Not applicable.

**Constraints.** LC-01, LC-10.

**Historical behaviour.** Permanent.

**Example.** A newly-supplied physical measure extends the physical domain, affecting no consumer of any other domain and requiring no change to how any other statistic is held.

---

## Layer 1 summary

| Entity | Kind | Posture | Context-bearing |
|---|---|---|---|
| E1.01 Country | Reference | Mutable | — |
| E1.02 Competition | Entity | Mutable | Anchor |
| E1.03 Competition Edition | Entity | Mutable → permanent | **Primary anchor** |
| E1.04 Competition Stage | Entity | Mutable → permanent | — |
| E1.05 Venue | Entity | Mutable | — |
| E1.06 Team | Entity | Mutable | Subject |
| E1.07 Team Registration | Entity | Mutable | Competition-scoped |
| E1.08 Player | Entity | Mutable | Subject |
| E1.09 Player Registration | Entity | Mutable → permanent | Optionally scoped |
| E1.10 Position Profile | Entity | Mutable | — |
| E1.10a Position | Reference | Governed | — |
| E1.11 Player Availability | Entity | Mutable → permanent | Optionally scoped |
| E1.12 Player Valuation | Entity | **Append-only** | — |
| E1.13 Fixture | Entity | Mutable → sealed | Subject |
| E1.14 Fixture Lifecycle State | Reference + history | **Append-only** | — |
| E1.15 Official Assignment | Entity | Mutable → sealed | — |
| E1.15a Official | Reference | Mutable | — |
| E1.16 Lineup | Entity | Mutable → sealed | Inherits |
| E1.17 Appearance | Entity | Mutable → sealed | Inherits |
| E1.18 Match Event | Entity | Mutable → sealed | Inherits |
| E1.19 Result | Entity | Mutable → permanent, revisions observable | Inherits |
| E1.20 Standing | Entity | **Append-only** | Competition-scoped |
| E1.21 Provider Statistic Record | Entity | Mutable | Competition-scoped |
| E1.22 Statistics Domain | Reference | Governed | — |

Three Layer 1 entities are append-only rather than mutable — valuations, lifecycle transitions, and standings. In each case the entity records a **dated observation** rather than a description of a permanent present, and overwriting it would discard exactly the history the architecture requires.

---

# 4.3 Layer 2 — Feature Engine Entities

**Layer purpose.** To hold every number the platform derives about an entity, expressed uniformly.

**Layer ownership.** Feature calculation, exclusively.

**Layer posture.** Append-only. Writing a feature value never displaces an earlier one; it states a value for a new moment. This single posture eliminates the entire class of problems the architecture attributed to destructive per-subject structures, and it removes the need for parallel history entities — the primary store *is* the history.

**What is excluded.** Judgement. A feature states that a club's travel load over fourteen days is a particular distance. It does not state whether that is good, whether it constitutes an edge, or whether anyone should care. Those are Layer 3.

**The organizing insight.** The previous system answered "where does a calculated metric live" once per metric group, arriving at dozens of structures each with its own temporal posture, its own identity rules, and its own implicit relationship to the process writing it. The cost was not the count. It was that every metric had to be reasoned about individually.

Layer 2 answers the question **once, for every metric**:

> A feature is a **value**, for a **subject**, in a **context**, as of a **moment**, produced by a **version**.

Every calculated metric in the platform has that shape. Physical realization may vary for performance; the logical identity never varies.

---

### E2.01 Feature Registry

**Purpose.** The governed collection of every feature the platform recognizes. It exists as a named construct, distinct from the definitions it contains, because **registration is the governance point** — the mechanism by which a metric cannot be reintroduced under a second name by accident, which is exactly how the previous system arrived at one quantity in seven places.

The registry is what makes §4.1.2 enforceable rather than aspirational.

**Layer & ownership.** Layer 2 · Platform governance.

**Construct kind.** Reference Entity — a governed vocabulary.

**Identity.** Singular. There is one registry.

**Lifecycle.** Mutable — definitions are added, deprecated, and retired.

**Relationships.** Contains Feature Definition (E2.02). Consulted by every feature calculator, by module definitions declaring their inputs, and by validation.

**Version behaviour.** The registry itself is unversioned; its contents are versioned individually.

**Immutability.** A definition may be retired but never removed, because historical values reference it permanently.

**Context.** Not applicable.

**Constraints.** LC-20, LC-21.

**Historical behaviour.** Permanent. Retired definitions persist so that historical values remain interpretable — a value whose definition had been deleted would be a number nobody could read.

**Example.** A calculation process attempting to write a value for an unregistered feature is rejected. In the previous system the equivalent act was undetectable, because there was nothing to detect it against.

---

### E2.02 Feature Definition

**Purpose.** The declaration of what a single metric **is**: its meaning, its subject type, its unit and scale, its direction, its valid contexts, its declared inputs, its owning calculator, and its sample-size semantics.

It exists to make a metric's meaning **data rather than convention**. The architecture found the previous system carrying quantities whose scale, direction, and comparability were knowable only by reading the process that produced them — including two identically-named attributes on different structures that were different metrics, and one identically-named attribute duplicated across two structures that was the same metric.

**Layer & ownership.** Layer 2 · Platform governance.

**Construct kind.** Entity, within the registry.

**Identity.** A stable, **subject-namespaced key**. Namespacing by subject is deliberate and load-bearing: it makes club readiness and player readiness visibly distinct declarations rather than the same word appearing in two places, which is the naming failure that concealed the duplication in the first place.

**Lifecycle.** Mutable in its descriptive attributes; its **meaning** is not mutable. A changed meaning is a new definition, not an edited one.

**Relationships.** Belongs to Feature Registry (E2.01). References the subject type it describes, the valid Feature Contexts (E2.08), the Feature Calculator (E2.04) that owns it, and — through Feature Dependency (E2.11) — the definitions it consumes. Referenced by every Feature Value (E2.05) and by Module Definition (E3.02) input declarations.

**Version behaviour.** Owns a version line, expressed as Feature Version (E2.03). The definition is the stable identity; versions are the successive rules realizing it.

**Immutability.** The key and the meaning are permanently fixed once values exist.

**Context.** Declares which context kinds are **valid** for it. A value written at an invalid context is a detectable error rather than a silent one — the previous system had no way to express that fatigue is meaningful overall while form quality is meaningful per competition.

**Constraints.** LC-20, LC-22, LC-23, LC-24.

**Historical behaviour.** Permanent.

**Example.** Club readiness and player readiness are two definitions with different subject types, different valid contexts, different calculators, and independent version lines. They can no longer be mistaken for one metric, because the model states that they are two.

**What a definition declares.**

| Declaration | Why it exists |
|---|---|
| Namespaced key and subject type | Makes same-named, different-subject metrics visibly distinct |
| Unit and scale | The previous system mixed bounded scores, unbounded indices, percentages and distances with no declaration |
| Direction | Whether a higher value is a stronger or weaker reading — unrecoverable from the number |
| Valid context kinds | Makes context validity checkable |
| Owning calculator | Enforces single ownership |
| Declared inputs | Makes the dependency graph data rather than call ordering |
| Provenance class | The strongest class of evidence this feature can ever carry |
| Sample semantics | Whether the value is meaningful below some observation count, and what that count is |

---

### E2.03 Feature Version

**Purpose.** The identity of a specific **rule** for producing a feature, with its effective period and its relationship to the version it succeeds.

It exists because a metric's meaning is stable while the rule realizing it is not. Changing a weight, a window, a threshold, or a component changes what the number *is* without changing what it is *about* — and the architecture identified the absence of this distinction as a direct threat to the platform's evidence claims, since a measured rate spanning two rules describes a system that never existed.

**Layer & ownership.** Layer 2 · Platform governance.

**Construct kind.** Entity.

**Identity.** The combination of feature definition and version designation.

**Lifecycle.** Append-only. Versions are registered, activated, and retired; they are never edited, because values reference them.

**Relationships.** References Feature Definition (E2.02) and its predecessor version. Referenced by every Feature Value (E2.05) it produced, and inherited by every Module Reading (E3.03) that consumed such a value.

**Version behaviour.** It **is** version identity.

**Immutability.** Sealed on registration. A registered version's rule is fixed permanently.

**Context.** Not applicable — a version applies across all contexts valid for its definition.

**Constraints.** LC-25, LC-26, LC-27.

**Historical behaviour.** Permanent, including retired versions, because historical values and calibration series reference them.

**Example.** A readiness rule is superseded by a revised weighting. The prior version is retired but persists; values produced under it retain their attribution; its calibration series closes rather than being contaminated; and the new version may be applied over history as additional values without touching a single existing one.

**Version registration.** Registering a version records its designation, effective period, rationale, and predecessor. Governance rather than bookkeeping: the previous system's confidence-band discipline depended entirely on every writer remembering to use a shared definition, which worked while it was remembered.

---

### E2.04 Feature Calculator

**Purpose.** The declared **owner** of one feature definition, or of a coherent group computed together.

It exists to make single ownership a modelled fact rather than an observed convention. The architecture's first principle — one owner per metric — is unenforceable unless the owner is named somewhere.

**Layer & ownership.** Layer 2 · Platform governance.

**Construct kind.** Entity.

**Identity.** Stable calculator identity.

**Lifecycle.** Mutable in its declarations; its ownership assignments are governed changes.

**Relationships.** Owns one or more Feature Definitions (E2.02). Through their declared dependencies, consumes other definitions. Referenced by every Feature Value it produced and by operational job records (E9.02).

**Version behaviour.** Carries its own implementation version, distinct from the feature versions it produces — a calculator may be reimplemented without changing the rule, and the two must be separable. The distinction matters when diagnosing whether a change in output came from a changed rule or a changed implementation of the same rule.

**Immutability.** Not applicable.

**Context.** Produces values across every context valid for the definitions it owns.

**Constraints.** LC-20, LC-28.

**Historical behaviour.** Retired calculators persist, because values reference them.

**Example.** Two calculators writing the same feature definition is a constraint violation detectable from the model. In the previous system it was a code review question, and the architecture found several quantities written by more than one process.

---

### E2.05 Feature Value

**Purpose.** **A single stated value of one feature, for one subject, in one context, as of one moment, under one version.** The atomic unit of Layer 2 and the highest-volume entity in the model.

Every calculated metric the previous system held — readiness and its components, form quality, travel, rest, congestion, stability, strength, depth, versatility, momentum, motivation, style, injury burden, valuation aggregates, opponent quality, competition aggregates — is an instance of this entity.

**Layer & ownership.** Layer 2 · Feature calculation.

**Construct kind.** Entity.

**Identity.** The full composite: **feature definition · subject · context · as-of · feature version.** Every element is load-bearing. Remove version and two rules collide. Remove context and a club's competitions collapse into one figure. Remove as-of and the entity reverts to the destructive per-subject shape the architecture set out to eliminate.

**Lifecycle.** Append-only. Never updated, never deleted while referenced. Subject to thinning (§4.1.7) only where no sealed artefact references the value.

**Relationships.** References Feature Definition (E2.02), Feature Version (E2.03), a Subject Reference (E2.06), and a Feature Context (E2.08). Carries Feature Provenance (E2.07) and Feature Sample (E2.09). Records Feature Lineage (E2.12) to the values it consumed. Referenced by Module Evidence Item (E3.05) and materialized into Snapshot Feature State (E4.03).

**Version behaviour.** Owns its feature version; inherits, through lineage, the versions of everything it consumed.

**Immutability.** Effectively sealed — append-only with no update path is indistinguishable from sealed at the level of a single value.

**Context.** Mandatory and explicit.

**Constraints.** LC-29 through LC-34.

**Historical behaviour.** The complete history of every metric, for every subject, in every context, permanently — subject only to declared thinning of unreferenced intermediates.

**Example.** A club's readiness on a date two years ago, within a specific competition, under the rule in force then, is a single value directly addressable by its identity. The previous system could not produce this figure by any means, because the value had been overwritten within a day of being calculated.

---

### E2.06 Subject Reference

**Purpose.** The identification of **what a calculated entity is about**.

It exists as a named construct because four subject types share one calculation apparatus, and modelling each separately would fragment the feature engine into four parallel engines — reintroducing, in a different arrangement, exactly the per-metric divergence the layer exists to prevent.

**Layer & ownership.** Layer 2 · Structural.

**Construct kind.** Identity Component.

**Identity.** The combination of subject type and the identity of the referenced entity.

**Subject types.** Team (E1.06) · Player (E1.08) · Fixture (E1.13) · Competition Edition (E1.03).

**Lifecycle.** Not applicable — it has no independent existence.

**Relationships.** Participates in the identity of Feature Value (E2.05) and Module Reading (E3.03). Resolves to a Layer 1 entity.

**Version behaviour.** Not applicable.

**Immutability.** A subject reference within a sealed artefact is permanently fixed.

**Context.** Distinct from context. **Subject is what the value is about; context is the competition scope within which it holds.** Club readiness for one club has one subject and potentially several contexts.

**Constraints.** LC-35.

**Historical behaviour.** Permanent within the entities carrying it.

**Example.** A comparative fixture metric takes the fixture as subject rather than storing paired club-side attributes — which is what allows the two sides to be queried symmetrically. The previous system's paired-attribute shape made any symmetric query impossible.

---

### E2.07 Feature Provenance

**Purpose.** The declaration of **how strongly a value is known**.

It exists because the previous system stored one genuinely synthetic dataset — values produced by a seeded generator over climate zones, in the absence of any source — in the same shape real observations would take, and a paid module consumed them. It also carried, on exactly one entity, a marker distinguishing provider-confirmed facts from heuristically inferred ones. The second is the pattern; this construct generalizes it to everything.

**Layer & ownership.** Layer 2 · Structural, applied by the producing calculator.

**Construct kind.** Value Object.

**Provenance classes.**

| Class | Meaning |
|---|---|
| **Observed** | A provider stated it |
| **Derived** | Calculated from observed facts |
| **Inferred** | Reconstructed by heuristic where no direct source exists |
| **Estimated** | Modelled in the absence of any source |

**Identity.** None — it qualifies a value.

**Lifecycle.** Fixed at the moment the value is written.

**Relationships.** Qualifies Feature Value (E2.05). Travels into Module Evidence Item (E3.05), into Snapshot Feature State (E4.03), and into anything a consumer sees.

**Version behaviour.** Not applicable.

**Immutability.** Permanent.

**Context.** Not applicable.

**Constraints.** LC-36, LC-37.

**Historical behaviour.** Permanent.

**Example.** An estimated value remains legible as estimated wherever it appears, including inside a sealed claim and inside the evidence supporting a module reading. "We are estimating this" becomes a property of the data rather than a fact held in someone's memory.

**Derivation rule.** A derived value's provenance can be **no stronger than the weakest input it consumed**. A value derived from an estimate is itself an estimate. Provenance propagates along lineage; it is not asserted independently by whoever writes the value.

---

### E2.08 Feature Context

**Purpose.** The **competition scope within which a value holds**.

It exists to resolve what the architecture identified as a structural impossibility in the previous model: a club competing domestically and continentally had one figure covering both, though the two are genuinely different — different opponents, different congestion, different rotation, different stakes.

**Layer & ownership.** Layer 2 · Structural.

**Construct kind.** Identity Component.

**Context kinds.**

| Kind | Resolves to | Applies to |
|---|---|---|
| **Competition-scoped** | A Competition Edition (E1.03) | Form quality, opponent-adjusted strength, venue performance, standing-derived metrics |
| **All-competitions** | An explicit universal scope value | Fatigue, injury burden, travel load, squad stability — quantities that do not partition |
| **Cross-competition derived** | An explicit derived scope value | Congestion from fixture density, active competition count, rotation pressure — quantities explicitly *about* the interaction |

**Identity.** The combination of context kind and, where applicable, the competition edition.

**Lifecycle.** Not applicable.

**Relationships.** Participates in the identity of Feature Value (E2.05) and Module Reading (E3.03). Resolves to Competition Edition (E1.03) when competition-scoped.

**Version behaviour.** Not applicable.

**Immutability.** Fixed within any entity carrying it.

**Context.** It is context.

**Constraints.** LC-38, LC-39.

**Historical behaviour.** Permanent within its carrying entities.

**Example.** A club's opponent-adjusted form exists once per competition edition it participates in. Its fatigue exists once at all-competitions scope. Its congestion exists at cross-competition scope because fixture density across competitions is what produces it. Three metrics, three scopes, each declared valid for its definition — and the previous model could express none of the distinctions.

**Mandatory and explicit.** There is no absent context meaning "global", because absent and unset are indistinguishable, and the difference between the three scopes above is exactly what the layer exists to express.

---

### E2.09 Feature Sample

**Purpose.** The **observation count** a value rests on.

It exists because the platform's stated evidential standard — inherited directly from the previous system's own design contract, which held that a rate without an observation count is a marketing figure rather than evidence — cannot be enforced unless the count travels with the value.

The previous system attached observation counts to five structures out of ninety-two. Good practice, not systematic.

**Layer & ownership.** Layer 2 · Structural, populated by the producing calculator.

**Construct kind.** Value Object.

**Identity.** None — it qualifies a value.

**Lifecycle.** Fixed when the value is written.

**Relationships.** Qualifies Feature Value (E2.05). Propagates into Module Evidence Item (E3.05) and constrains what Module Reading (E3.03) may claim.

**Version behaviour.** Not applicable.

**Immutability.** Permanent.

**Context.** Not applicable — but a competition-scoped value typically rests on a smaller sample than its all-competitions counterpart, which is itself analytically important and now visible.

**Constraints.** LC-40, LC-41.

**Historical behaviour.** Permanent.

**Example.** A form metric computed over three fixtures and one computed over thirty are structurally distinguishable, so a module consuming the first can decline to speak rather than speaking with false authority. The previous system surfaced both as bare numbers.

**Meaningfulness threshold.** Feature Definition (E2.02) declares the count below which a value is not meaningful. A value below threshold is **still recorded** — its existence is informative — but is marked as not meeting its own threshold, and modules are constrained accordingly.

---

### E2.10 Feature Source

**Purpose.** The declaration of **which Layer 1 entities a feature definition draws from**.

It is distinct from Feature Dependency (E2.11), and the distinction is precise: a source is a **reality entity** a feature reads; a dependency is **another feature** it consumes. A feature reading appearances has a source; a feature reading another feature's output has a dependency. Conflating them makes the layer boundary unauditable.

**Layer & ownership.** Layer 2 · Platform governance.

**Construct kind.** Entity, within the registry.

**Identity.** The combination of feature definition and Layer 1 entity.

**Lifecycle.** Mutable — declarations change as rules evolve, under version governance.

**Relationships.** References Feature Definition (E2.02) and a Layer 1 entity. Consulted by freshness monitoring (E9.06) to determine what a feature's currency depends on.

**Version behaviour.** Belongs to a feature version. A rule consuming a different reality entity is a different rule.

**Immutability.** Fixed within a version.

**Context.** Not applicable.

**Constraints.** LC-42, LC-43.

**Historical behaviour.** Permanent per version.

**Example.** Declaring that a fatigue feature sources from appearances lets freshness monitoring state that fatigue is stale whenever appearance ingestion has not run — without anyone hand-maintaining that relationship.

**Layer enforcement.** Only Layer 2 may declare Layer 1 sources. A module declaring one is a layer violation, detectable from the model rather than from code review.

---

### E2.11 Feature Dependency

**Purpose.** The declaration that one feature definition **consumes another**.

It exists to make the calculation dependency graph **data**. The architecture recorded that the previous system's graph — roughly fifty edges — lived entirely in the ordering of calls within one orchestration process. Correct, carefully documented, and completely invisible to the model, such that a missing input produced empty values rather than an error.

**Layer & ownership.** Layer 2 · Platform governance.

**Construct kind.** Entity, within the registry.

**Identity.** The combination of consuming definition and consumed definition.

**Lifecycle.** Mutable under version governance.

**Relationships.** References two Feature Definitions (E2.02). Collectively forms the dependency graph over which execution order is **derived** rather than hand-maintained.

**Version behaviour.** Belongs to a feature version.

**Immutability.** Fixed within a version.

**Context.** Declares whether a dependency is consumed at the same context as the consumer, or at a different one. A cross-competition congestion feature consumes competition-scoped fixture data — the context mapping is part of the declaration, not an assumption inside the calculator.

**Constraints.** LC-42, LC-44, LC-45.

**Historical behaviour.** Permanent per version.

**Example.** Execution order becomes a property derived from declared dependencies. A missing input is a detectable precondition failure rather than a silently empty output — the specific failure mode the architecture identified.

**Acyclicity.** The dependency graph is acyclic. A cycle is a modelling error, and one detectable from the declarations alone.

---

### E2.12 Feature Lineage

**Purpose.** The record of **which specific feature values a specific feature value consumed**.

Its relationship to Feature Dependency (E2.11) is the relationship between a declaration and an event. A dependency says *this rule consumes that rule* — type-level, declared in advance. Lineage says *this value consumed those values* — instance-level, recorded at calculation.

Lineage is what makes reproducibility real rather than nominal. Without it, a stated version tells you which rule ran but not what it ran **on**, and a reproduction can differ from the original with nothing revealing why.

**Layer & ownership.** Layer 2 · Feature calculation.

**Construct kind.** Entity.

**Identity.** The combination of produced value and consumed value.

**Lifecycle.** Append-only, written with the value it describes.

**Relationships.** References two Feature Values (E2.05). Sealed alongside values into Snapshot Feature State (E4.03). Constrains thinning: a value referenced by retained lineage cannot be thinned.

**Version behaviour.** Carries the version identities of both endpoints implicitly, since each value owns its own.

**Immutability.** Permanent.

**Context.** Records the context of both endpoints, which may differ — see E2.11.

**Constraints.** LC-46, LC-47.

**Historical behaviour.** Permanent for values referenced by sealed artefacts; thinnable alongside the intermediates it describes otherwise.

**Example.** A readiness value's lineage identifies exactly which fatigue, congestion, travel, stability, and availability values it consumed — each with its own version, provenance, and sample. Reproducing that readiness value is a matter of replaying the rule over the named inputs, and the provenance rule of E2.07 becomes computable rather than asserted, because the inputs are named.

---

## Layer 2 summary

| Entity | Kind | Posture | Carries version |
|---|---|---|---|
| E2.01 Feature Registry | Reference | Mutable | — |
| E2.02 Feature Definition | Entity | Mutable declaration, fixed meaning | Owns version line |
| E2.03 Feature Version | Entity | **Sealed** | Is version identity |
| E2.04 Feature Calculator | Entity | Mutable | Own implementation version |
| E2.05 Feature Value | Entity | **Append-only** | Owns + inherits |
| E2.06 Subject Reference | Identity Component | — | — |
| E2.07 Feature Provenance | Value Object | Fixed at write | — |
| E2.08 Feature Context | Identity Component | — | — |
| E2.09 Feature Sample | Value Object | Fixed at write | — |
| E2.10 Feature Source | Entity | Mutable per version | Belongs to version |
| E2.11 Feature Dependency | Entity | Mutable per version | Belongs to version |
| E2.12 Feature Lineage | Entity | **Append-only** | Implicit at endpoints |

**The layer in one statement.** Twelve constructs replace dozens of independently-reasoned-about structures, and every calculated metric in the platform — present and future — is expressed through them without extension.

---

# 4.4 Layer 3 — Module Engine Entities

**Layer purpose.** To hold judgement. A module reads features and states a position on one question about one subject.

**Layer ownership.** Module calculation, exclusively.

**Layer posture.** Append-only before a fixture seals; sealed thereafter.

**What is excluded.** Raw calculation. A module that computes its own numbers from Layer 1 has made those numbers unversioned, unarchived, and invisible to every other module. Where a module needs a quantity that does not exist, the resolution is a new registered feature, never an inline calculation.

**The organizing insight.** The previous system established the module abstraction precisely and expressed it entirely in application code: a registry of definitions, a pure evaluator per module, and historical rates as literal figures maintained by hand. The abstraction was right. Its location meant module outputs were never stored, never versioned, never calibrated as modules, and never comparable across time — and that adding one required roughly eleven coordinated changes because five separate places had to be kept in agreement manually.

Layer 3 makes modules **data**.

---

### E3.01 Module Registry

**Purpose.** The governed collection of every module the platform recognizes. As with the feature registry, it exists as a named construct because **registration is the governance point**: a module that is not registered cannot produce a reading, and a reading cannot exist without a registered module to attribute it to.

**Layer & ownership.** Layer 3 · Platform governance.

**Construct kind.** Reference Entity.

**Identity.** Singular.

**Lifecycle.** Mutable — definitions are added, deactivated, and retired.

**Relationships.** Contains Module Definition (E3.02). Consulted by every module calculator, by entitlement resolution, and by calibration.

**Version behaviour.** Unversioned; contents versioned individually.

**Immutability.** A definition may be retired but never removed — historical readings reference it permanently.

**Context.** Not applicable.

**Constraints.** LC-48, LC-49.

**Historical behaviour.** Permanent.

**Example.** Adding a module becomes a registry entry plus a calculator. The previous system's eleven coordinated changes existed because the module's identity, its evaluator, its entitlement key, its permission record, and its backing object each lived somewhere different and none referenced the others.

---

### E3.02 Module Definition

**Purpose.** The declaration of what a module **is**: the single question it answers, the subject it answers it about, its declared feature inputs, its entitlement requirement, its calibration mode, and its display identity.

**Layer & ownership.** Layer 3 · Platform governance.

**Construct kind.** Entity, within the registry.

**Identity.** A stable module key, plus a **stable display number**. The previous system's rule that a display number is never reused — because it is quoted in support and in published material — is inherited as a modelled constraint.

**Lifecycle.** Mutable in its descriptive attributes. Its **question** is not mutable: a module answering a different question is a different module, not an edited one. This is the strictest declaration in the layer, because the question is a product commitment and a module quietly redefined would invalidate every calibration measurement taken against it.

**Relationships.** Belongs to Module Registry (E3.01). Declares inputs by reference to Feature Definitions (E2.02). References its Entitlement Feature (E8.04). Owns a version line via Module Version (E3.02a). Referenced by every Module Reading (E3.03) and every Calibration Series (E7.08).

**Version behaviour.** Owns a version line. The definition is the stable identity; versions are the successive rules realizing it.

**Immutability.** Key, display number, and question permanently fixed once readings exist.

**Context.** Declares which context kinds its readings are valid at, on the same basis as a feature definition.

**Constraints.** LC-48, LC-50, LC-51, LC-52.

**Historical behaviour.** Permanent, including retired modules — their historical readings and calibration series persist and remain interpretable.

**Example.** A module deactivated for product reasons stops producing readings. Its definition, its historical readings, and its calibration series all persist, so a claim made two years ago remains legible and remains attributable to a module that can still be described.

**Calibration mode.** Each definition declares how it is measured: **outcome-scored** against a stated outcome dimension, or **contextual** where the module characterizes an environment rather than claiming an outcome. The distinction is real — a competition goal-environment profile describes conditions rather than asserting a result — and it has direct consequences for what may legitimately be displayed alongside the module. This declaration is the model's accommodation of an architectural decision recorded as open; it does not resolve it.

---

### E3.02a Module Version

**Purpose.** The identity of a specific **rule** for producing a module's readings, with its effective period and predecessor.

It exists for the same reason as Feature Version (E2.03), with one amplification: **calibration series are keyed by module version**. Without version identity, a measured reliability figure spans two rules and describes a system that never existed — which is the precise failure the platform's evidential positioning cannot tolerate.

**Layer & ownership.** Layer 3 · Platform governance.

**Construct kind.** Entity.

**Identity.** The combination of module definition and version designation.

**Lifecycle.** Append-only. Registered, activated, retired; never edited.

**Relationships.** References Module Definition (E3.02) and its predecessor. Referenced by every Module Reading (E3.03) it produced and by every Calibration Series (E7.08) measuring it.

**Version behaviour.** It is version identity.

**Immutability.** Sealed on registration.

**Context.** Not applicable.

**Constraints.** LC-25, LC-53, LC-54.

**Historical behaviour.** Permanent.

**Example.** Revising a module's thresholds registers a new version. Existing readings retain their attribution; the prior calibration series closes; a new series opens; and the two versions become comparable over the same population — which is what makes the revision's value measurable rather than asserted.

---

### E3.03 Module Reading

**Purpose.** **What one module says about one subject, in one context, at one moment, under one version.** The atomic unit of Layer 3.

**Layer & ownership.** Layer 3 · Module calculation.

**Construct kind.** Entity.

**Identity.** The composite: **module definition · subject · context · as-of · module version.** Structurally parallel to Feature Value (E2.05), and deliberately so — the two layers share one temporal, contextual, versioned identity discipline.

**Lifecycle.** Append-only while the subject remains open; sealed when the subject seals.

**Relationships.** References Module Definition (E3.02), Module Version (E3.02a), Subject Reference (E2.06), Feature Context (E2.08), and Module Status (E3.07). Parent of Module Evidence (E3.04). References a Module Baseline Reference (E3.06). Carries Module Headline (E3.08) and Module Verdict (E3.09). Materialized into Snapshot Module Reading (E4.04). Scored by calibration into Historical Reliability (E7.10).

**Version behaviour.** Owns its module version; inherits, through its evidence, the feature versions it consumed.

**Immutability.** Sealed once its subject seals. Before that, superseded by a later reading rather than updated.

**Context.** Mandatory and explicit.

**Constraints.** LC-55 through LC-60.

**Historical behaviour.** Permanent. The complete history of what every module said about every subject.

**Example.** A travel module's reading on a fixture three days before kickoff, under the rule in force then, with the evidence it rested on and the baseline it referenced — permanently addressable. In the previous system no module output was stored at all; readings were recomputed on demand and existed only for the instant they were displayed.

**Composition.** A reading states its **status** (E3.07), its **strength** on a declared scale, its **confidence** grounded in sample rather than in the magnitude of what it found, and its **sample size**. Sample is never optional.

---

### E3.04 Module Evidence

**Purpose.** The **complete set of evidence** underpinning one reading — the collective construct, distinct from the individual items within it.

It exists as a named entity because evidence has properties belonging to the set rather than to any item: how many features contributed, whether any were below their meaningfulness threshold, whether any were estimated, and whether the expected inputs were all present. Those set-level properties are what a reading's confidence rests on, and what completeness reporting consumes.

**Layer & ownership.** Layer 3 · Module calculation.

**Construct kind.** Entity.

**Identity.** The reading it belongs to.

**Lifecycle.** Written with its reading; sealed with it.

**Relationships.** Belongs to Module Reading (E3.03). Parent of Module Evidence Item (E3.05). Consumed by Snapshot Completeness (E4.07).

**Version behaviour.** Inherits its reading's version.

**Immutability.** Sealed with its reading.

**Context.** Inherits.

**Constraints.** LC-61, LC-62.

**Historical behaviour.** Permanent.

**Example.** A reading resting on one feature with a marginal sample is structurally distinguishable from one resting on six well-sampled features — before anyone inspects the individual items. The previous system expressed evidence as opaque serialized content in two places and as a relational structure permitting one entry per market in a third, so no such comparison was possible.

---

### E3.05 Module Evidence Item

**Purpose.** **One feature value's contribution to one reading**: which value, what it was, which direction it pushed, and how much it contributed.

This is the explainability substrate. It replaces three parallel and unconnected representations in the previous system — a relational signal structure whose identity rule permitted a single entry per market per fixture, and two serialized collections holding risk factors and opportunity signals as opaque content.

**Layer & ownership.** Layer 3 · Module calculation.

**Construct kind.** Entity.

**Identity.** The combination of evidence set and contributing feature value.

**Lifecycle.** Written with its reading; sealed with it.

**Relationships.** Belongs to Module Evidence (E3.04). References a specific Feature Value (E2.05) — the exact value, not merely its definition. Through that reference it inherits the value's version, provenance, and sample.

**Version behaviour.** Inherits by reference from the value it cites.

**Immutability.** Sealed with its reading. **Prevents thinning** of any feature value it cites.

**Context.** Inherits the cited value's context, which may differ from the reading's own where a module legitimately consumes a differently-scoped input.

**Constraints.** LC-63, LC-64, LC-65.

**Historical behaviour.** Permanent.

**Example.** Three questions become answerable that were not: which features most often drive a module's readings, why a specific historical reading concluded what it did without re-running it, and whether a module's inputs had gone stale at the moment it spoke.

**Relational, not serialized.** Evidence is relational because it is queried, aggregated, and explained. Serialized evidence supports display and nothing else, which is why the previous system could display its reasoning but never analyse it.

---

### E3.06 Module Baseline Reference

**Purpose.** The link from a reading to the **calibration measurement** that supplies its historical rate.

It exists to enforce, structurally, that baselines are **produced by calibration and read by modules** — never authored alongside module code. The previous system held them as literal figures in the module definition file, so re-measurement changed nothing about what was published, and the shipped figure and the measured figure drifted apart silently.

**Layer & ownership.** Layer 3 · Structural.

**Construct kind.** Identity Component / reference.

**Identity.** The combination of reading and referenced Published Baseline (E7.03).

**Lifecycle.** Fixed at the moment the reading is written — the reading cites the baseline **in force at that time**, so a later re-measurement does not retroactively alter what a historical reading claimed.

**Relationships.** References Module Reading (E3.03) and Published Baseline (E7.03).

**Version behaviour.** The referenced baseline carries its own module version, which must match the reading's. A reading cannot cite a baseline measured on a different version of itself.

**Immutability.** Permanent.

**Context.** The referenced baseline may be competition-scoped or pooled; the reference records which, so a pooled figure is never presented as a competition-specific one.

**Constraints.** LC-66, LC-67, LC-68.

**Historical behaviour.** Permanent.

**Example.** A reading citing a baseline that fails its sample gate is surfaced as explicitly unverified rather than as a clean figure. The previous system's design contract required exactly this behaviour; here it is a constraint rather than a presentational convention.

---

### E3.07 Module Status

**Purpose.** The **position a reading takes**: supports, neutral, contradicts, or inactive.

The four-state vocabulary is inherited from the previous system unchanged, and one distinction within it carries most of its value: **inactive** means the module had insufficient data to speak, while **neutral** means it spoke and found nothing. Conflating them is how a platform begins overstating its coverage — a module silent for want of data looks identical to one that examined the fixture and found it unremarkable.

**Layer & ownership.** Layer 3 · Platform governance for the vocabulary; module calculation for the assignment.

**Construct kind.** Reference Entity.

**Identity.** Stable status codes with stable meanings.

**Lifecycle.** Governed. The vocabulary is fixed; extending it is a deliberate act with calibration consequences.

**Relationships.** Referenced by Module Reading (E3.03) and by Module Consensus (E3.10). Scored distinctly by calibration (E7.10).

**Version behaviour.** Not applicable.

**Immutability.** A status meaning may not be redefined — sealed readings reference it.

**Context.** Not applicable.

**Constraints.** LC-10, LC-69.

**Historical behaviour.** Permanent.

**Example.** Calibration scores abstention separately from engagement. A module abstaining when data is thin is behaving correctly; one abstaining constantly is not earning its place. Both are measurable only because the two abstention reasons are distinguishable.

---

### E3.08 Module Headline

**Purpose.** The **short rendered statement** of what a reading found — the reading's single live datum, expressed for a reader.

It exists as a distinct construct because the architecture requires generated prose to be separated from the quantities it describes. The previous system carried narrative attributes throughout its metric structures, which mixed two concerns with different lifecycles: a number is evidence, while its phrasing is presentation and may be revised without the underlying claim changing at all.

**Layer & ownership.** Layer 3 · Module calculation.

**Construct kind.** Value Object.

**Identity.** None — it qualifies a reading.

**Lifecycle.** Written with its reading; sealed with it.

**Relationships.** Qualifies Module Reading (E3.03).

**Version behaviour.** Inherits its reading's version. Phrasing is part of the rule that produced it.

**Immutability.** Sealed with its reading — a sealed claim's wording is part of the claim.

**Context.** Inherits.

**Constraints.** LC-70.

**Historical behaviour.** Permanent.

**Example.** What a module said, in the words it said it in, remains recoverable for a reading made two years ago — which matters when a historical claim is questioned.

---

### E3.09 Module Verdict

**Purpose.** The reading's **own plain conclusion** — one line stating what this module concludes about this subject.

**Terminology, stated explicitly.** This is **not** the Instant Verdict of §4.5. The two are distinct constructs at different levels and the architecture names both:

| Construct | Level | Scope |
|---|---|---|
| **Module Verdict** (E3.09) | One module's reading | What this module concludes |
| **Snapshot Verdict** (E4.05) | A whole fixture snapshot | The canonical product output across all modules |

**Layer & ownership.** Layer 3 · Module calculation.

**Construct kind.** Value Object.

**Identity.** None — it qualifies a reading.

**Lifecycle.** Written with its reading; sealed with it.

**Relationships.** Qualifies Module Reading (E3.03). Consumed by Snapshot Verdict (E4.05) as one input among many.

**Version behaviour.** Inherits its reading's version.

**Immutability.** Sealed with its reading.

**Context.** Inherits.

**Constraints.** LC-70, LC-71.

**Historical behaviour.** Permanent.

**Example.** A module states what it concludes without stating what anyone should do about it. The previous system's registry documented this constraint explicitly — a verdict is never a recommendation to stake — and the model enforces it by providing no construct in which such a recommendation could be expressed.

---

### E3.10 Module Consensus

**Purpose.** The **derived aggregation** of what all modules said about one subject at one moment: how many spoke, how many supported, how many contradicted, how many abstained and why, weighted by confidence and sample.

It exists because the previous system anticipated exactly this and had no substrate for it — a structure existed carrying consensus and evidence-count attributes, admin-scoped, and nothing wrote to it, because module readings were never stored and so could not be aggregated. With readings stored, consensus becomes derivable rather than aspirational.

**Layer & ownership.** Layer 3 · Derived.

**Construct kind.** Derived View, materialized into Snapshot Verdict (E4.05) when sealed.

**Identity.** The combination of subject, context, and as-of.

**Lifecycle.** Derived and therefore disposable — until sealed inside a snapshot, at which point the sealed copy becomes permanent.

**Relationships.** Derives from the set of Module Readings (E3.03) for a subject at a moment. Consumed by Snapshot Verdict (E4.05).

**Version behaviour.** The **consensus rule** is itself versioned — how dissent is weighted is a rule, and changing it changes what is published.

**Immutability.** Disposable while derived; permanent once sealed.

**Context.** Computed within a stated context. Consensus across mismatched contexts would be a category error.

**Constraints.** LC-72, LC-73, LC-74.

**Historical behaviour.** Preserved through the snapshots that sealed it.

**Example.** A fixture where nine modules split five-to-four is a materially different object from one where nine agree. Consensus retains that dissent rather than averaging it away — which is what allows the product to report disagreement rather than concealing it behind a single figure.

---

## Layer 3 summary

| Entity | Kind | Posture | Version |
|---|---|---|---|
| E3.01 Module Registry | Reference | Mutable | — |
| E3.02 Module Definition | Entity | Mutable declaration, fixed question | Owns version line |
| E3.02a Module Version | Entity | **Sealed** | Is version identity |
| E3.03 Module Reading | Entity | **Append-only → sealed** | Owns + inherits |
| E3.04 Module Evidence | Entity | Sealed with reading | Inherits |
| E3.05 Module Evidence Item | Entity | Sealed with reading | Inherits by reference |
| E3.06 Module Baseline Reference | Reference | Fixed at write | Must match reading's version |
| E3.07 Module Status | Reference | Governed | — |
| E3.08 Module Headline | Value Object | Sealed with reading | Inherits |
| E3.09 Module Verdict | Value Object | Sealed with reading | Inherits |
| E3.10 Module Consensus | Derived View | Disposable → sealed | Own consensus-rule version |

**Module lifecycle.** Registered → activated → producing readings → superseded by a new version → deactivated → retired. At no point are historical readings or calibration series affected; retirement removes a module from production, never from the record.

**Reading lifecycle.** Calculated → appended → superseded by a later reading → sealed when the subject seals → scored against outcome → contributing to calibration → permanent.

---

# 4.5 Match Intelligence Entities

**Purpose.** To hold what the platform stated about a fixture, at defined moments, permanently.

**Ownership.** Module calculation produces the content; the snapshot construct seals it.

**Posture.** Sealed. Without exception.

**The reframe.** The previous system's match intelligence was one record per fixture, continuously updated — its identity was the fixture, and its content was whatever had last been calculated. Immutability was retrofitted onto part of it after a production incident, which froze the stated outputs while the copied inputs beside them continued to move, leaving historical records internally inconsistent.

V2 changes the identity:

> Match intelligence is a **series of sealed snapshots**, each capturing the complete state of a fixture at a moment: the features that were true, the module readings that followed, and the verdict that resulted. The fixture has many snapshots. Each is permanent.

Immutability stops being a guard applied to a mutable structure and becomes **what the structure is**. There is nothing to freeze, because nothing was ever going to change.

---

### E4.01 Match Snapshot

**Purpose.** **The complete, sealed statement of what the platform knew and concluded about one fixture at one defined moment.** The central entity of the model and the platform's primary historical asset.

**Layer & ownership.** Spans Layers 2 and 3 by construction, since it seals content from both · Module calculation.

**Construct kind.** Entity — a composite aggregate.

**Identity.** The composite: **fixture · snapshot point · snapshot version.** All three are load-bearing. The fixture says what it is about; the point says when in the fixture's approach; the version says under which composite rule set — which is what permits a corrected rule set to produce a parallel series without touching the original.

**Lifecycle.** **Sealed on write.** Created once, never updated, never deleted. The only permitted post-creation act is outcome linkage (E4.08), which is additive and attaches alongside rather than modifying.

**Relationships.** References Fixture (E1.13) and Snapshot Point (E4.09). Composed of Snapshot Header (E4.02), Snapshot Feature State (E4.03), Snapshot Module Reading (E4.04), Snapshot Verdict (E4.05), Snapshot Model Output (E4.06), and Snapshot Completeness (E4.07). Referenced by Snapshot Outcome Link (E4.08) and by every calibration measurement.

**Version behaviour.** Owns a Snapshot Version (E4.10) — a manifest, not a single designation, because a snapshot is produced by many rules simultaneously.

**Immutability.** Absolute. Prevents thinning of every Feature Value (E2.05) and Module Reading (E3.03) it references.

**Context.** Inherits the fixture's competition edition. Content within it may carry other contexts where a module legitimately consumed differently-scoped input, and each element records its own.

**Constraints.** LC-75 through LC-81.

**Historical behaviour.** Permanent, without exception and without retention policy. This is the asset.

**Example.** Ten years of snapshots across a hundred competitions form the population over which every calibration measurement is taken and every reliability claim is made. The previous system retained one archived claim per fixture, from one model, and nothing at all from the others.

**Why snapshots seal inputs and outputs together.** This is the direct correction of the architecture's finding. A snapshot answering *"what did the system conclude"* without also answering *"what did it see"* is not reproducible, and the previous system could not answer the second because its inputs kept moving after its outputs were frozen. Sealing both, atomically, makes the snapshot a self-contained and self-explaining historical claim.

---

### E4.02 Snapshot Header

**Purpose.** The **identifying and attesting facts** of a snapshot: which fixture, which point, the as-of moment, the sealed-at moment, the producing job, and the version manifest in force.

It exists as a distinct construct because these facts attest to the snapshot **as an act** rather than describing its content, and they are what makes a snapshot auditable — traceable to the execution that produced it and the rules that governed it.

**Layer & ownership.** Module calculation.

**Construct kind.** Entity — the root of the snapshot aggregate.

**Identity.** The snapshot's identity.

**Lifecycle.** Sealed on write.

**Relationships.** Belongs to Match Snapshot (E4.01). References Snapshot Version (E4.10) and the Pipeline Job Run (E9.02) that produced it.

**Version behaviour.** Carries the version manifest.

**Immutability.** Absolute.

**Context.** Records the fixture's competition edition as the snapshot's primary context.

**Constraints.** LC-75, LC-82.

**Historical behaviour.** Permanent.

**Example.** The distinction between **as-of** and **sealed-at** is what makes backfill legible. A snapshot describing a moment two years ago, sealed last week, is visibly a reconstruction rather than a contemporaneous observation — and the two are different claims that must never be confused.

---

### E4.03 Snapshot Feature State

**Purpose.** The **sealed materialization of every feature value the snapshot consumed**, each with its own version, provenance, sample, and lineage reference.

It exists to make reproducibility real. A snapshot recording conclusions but not inputs cannot be reproduced, cannot be explained, and cannot be defended when questioned.

**Layer & ownership.** Sealed content from Layer 2 · Module calculation seals it.

**Construct kind.** Entity — a sealed resolution, in the sense of §4.1.2.

**Identity.** The combination of snapshot and feature value.

**Lifecycle.** Sealed on write.

**Relationships.** Belongs to Match Snapshot (E4.01). References the specific Feature Value (E2.05) it materializes, and through it the value's Feature Version, Provenance, Sample, and Lineage.

**Version behaviour.** Inherits each value's feature version. Collectively these form part of the Snapshot Version manifest (E4.10).

**Immutability.** Absolute. **Promotes each referenced value from derived to permanent** — the seal is what makes an otherwise thinnable intermediate unremovable.

**Context.** Each element records its own context, which may differ from the snapshot's.

**Constraints.** LC-83, LC-84, LC-85.

**Historical behaviour.** Permanent.

**Example.** Reproducing a two-year-old conclusion requires replaying the stated rules over the stated inputs. Both are present, both are versioned, and neither has moved since.

**Resolution, not duplication.** These values are resolutions under §4.1.2 — the same fact, materialized for reproducibility, permanently attributed to the owner that produced it. A resolution that could not name its owner would be a duplicate, and the distinction is what keeps single-source-of-truth intact while still sealing the content.

---

### E4.04 Snapshot Module Reading

**Purpose.** The **sealed materialization of every module reading** in force at the snapshot's moment, with its evidence, status, confidence, sample, and baseline reference.

**Layer & ownership.** Sealed content from Layer 3 · Module calculation.

**Construct kind.** Entity — a sealed resolution.

**Identity.** The combination of snapshot and module reading.

**Lifecycle.** Sealed on write.

**Relationships.** Belongs to Match Snapshot (E4.01). References the specific Module Reading (E3.03), and through it its Module Version, Evidence, Status, and Baseline Reference. Consumed by Snapshot Verdict (E4.05) and by Snapshot Completeness (E4.07). Scored individually by calibration (E7.10).

**Version behaviour.** Inherits each reading's module version; contributes to the manifest.

**Immutability.** Absolute. Prevents thinning of the reading and of every feature value its evidence cites.

**Context.** Records its reading's context.

**Constraints.** LC-83, LC-86, LC-87.

**Historical behaviour.** Permanent.

**Example.** Reading-level scoring — the measurement underpinning every per-module reliability claim — is possible only because every module's reading at the canonical moment is individually sealed and individually addressable. The previous system archived one model's conclusion and no module readings at all, which is why per-module reliability could not be measured.

---

### E4.05 Snapshot Verdict

**Purpose.** **The canonical product output for a fixture at a snapshot: a characterization of the fixture, not a prediction of its result.**

This distinction is the platform's positioning expressed in data. A prediction states that something will happen. A verdict states what the evidence indicates, how much of it there is, how consistent it is, and how reliable that pattern has been historically.

**Layer & ownership.** Layer 3 · Module calculation.

**Construct kind.** Entity — one per snapshot.

**Identity.** The combination of snapshot and verdict version.

**Lifecycle.** Sealed on write.

**Relationships.** Belongs to Match Snapshot (E4.01). Derives from Snapshot Module Reading (E4.04) collectively, from Module Consensus (E3.10), from the canonical Snapshot Model Output (E4.06), and from Snapshot Completeness (E4.07). References Historical Reliability (E7.10).

**Version behaviour.** Owns a **verdict composition version**. How confidence is derived and how consensus is weighted are rules, and changing either changes what is published and begins a new calibration series.

**Immutability.** Absolute.

**Context.** The fixture's competition edition.

**Constraints.** LC-88 through LC-92.

**Historical behaviour.** Permanent.

**Composition.**

| Component | Meaning |
|---|---|
| Readiness edge | Signed differential in club readiness, with the underlying values |
| Form edge | Signed differential in opponent-adjusted form quality |
| Context edges | Travel, rest, congestion, availability — each signed and individually attributable |
| Risk | How unpredictable the fixture is, independent of direction |
| Confidence | How much to trust the characterization — grounded in sample and evidence completeness, **not** in the magnitude of any edge |
| Evidence count | How many modules had sufficient data to speak |
| Module consensus | How many supported, contradicted, abstained — weighted |
| Completeness | Which expected inputs were missing |
| Historical reliability | How often verdicts with this profile, at this version, have held |

**Deliberate exclusion.** The verdict contains no recommended action, no stake, no selection, and no instruction. The model provides **no construct in which one could be expressed** — the constraint is structural rather than editorial.

**Why risk is separate from confidence.** A high-edge, high-risk fixture is a different product statement from a high-edge, low-risk one. Collapsing them into a single figure destroys exactly the distinction that makes the characterization useful.

**Why this is not merely a prediction.** Three properties, all structural: it reports its own coverage, so a thin verdict is visibly thin; it retains dissent rather than averaging it away; and it carries its own measured track record at its own version.

---

### E4.06 Snapshot Model Output

**Purpose.** The sealed output of a **named probabilistic model** at the snapshot's moment.

It exists to resolve the architecture's finding that two independent systems produced complete, competing outcome-probability sets and predicted scores for the same fixture, both reaching the consumer, with nothing declaring which was authoritative.

**Layer & ownership.** Layer 3 · Module calculation.

**Construct kind.** Entity.

**Identity.** The combination of snapshot, model, model version, and output type.

**Lifecycle.** Sealed on write.

**Relationships.** Belongs to Match Snapshot (E4.01). References a Model Definition and Model Version (governed on the same basis as modules). Scored by calibration on the same basis as readings.

**Version behaviour.** Owns its model version.

**Immutability.** Absolute.

**Context.** The fixture's competition edition.

**Constraints.** LC-93, LC-94, LC-95.

**Historical behaviour.** Permanent, for every model — canonical and non-canonical alike.

**The canonical designation.** Exactly one model is designated canonical per output type at any time. The designation is **data**, changeable without redefinition of anything else. **All** models are archived and calibrated, so the designation is evidence-based; only the canonical output feeds the verdict; non-canonical outputs persist for comparison.

**Example.** The competition between models becomes a measurable experiment rather than an ambiguity. Which model is canonical is a decision the architecture recorded as open; the model makes it answerable and revisable rather than making it.

---

### E4.07 Snapshot Completeness

**Purpose.** The statement of **what the snapshot could not see**: which expected features were absent, which modules could not speak and why, which inputs were below their meaningfulness threshold, and which were estimated rather than observed.

It exists because the platform must be able to distinguish *"we looked and found nothing"* from *"we could not look."* The previous system's consuming surface degraded gracefully to demonstration content whenever a query returned nothing — good for resilience, and it meant a silently empty structure was indistinguishable from healthy data.

**Layer & ownership.** Layer 3 · Module calculation.

**Construct kind.** Entity — one per snapshot.

**Identity.** The snapshot.

**Lifecycle.** Sealed on write.

**Relationships.** Belongs to Match Snapshot (E4.01). Derives from Snapshot Feature State (E4.03) and Snapshot Module Reading (E4.04) against what the registries declared should be present.

**Version behaviour.** Inherits the snapshot manifest.

**Immutability.** Absolute.

**Context.** The fixture's competition edition.

**Constraints.** LC-96, LC-97.

**Historical behaviour.** Permanent, and an input to coverage reporting (E9.09).

**Example.** A snapshot taken when squad information had not yet arrived records that absence explicitly. Two years later it remains clear that the verdict was thin for a stated reason — rather than appearing, indistinguishably, as a fixture about which the platform simply had little to say.

---

### E4.08 Snapshot Outcome Link

**Purpose.** The attachment of **what actually happened** to a sealed snapshot, across every outcome dimension the platform measures.

**Layer & ownership.** Calibration.

**Construct kind.** Entity.

**Identity.** The combination of snapshot and Outcome Dimension (E7.04).

**Lifecycle.** Written once, after the fixture completes. **Additive** — it attaches alongside the snapshot and modifies nothing within it. This is the one permitted post-sealing act, and the reason it is permitted is that it adds a fact about the world rather than altering a claim about it.

**Relationships.** References Match Snapshot (E4.01), Result (E1.19), and Outcome Dimension (E7.04). Consumed by every calibration measurement.

**Version behaviour.** The **outcome derivation rule** is versioned, since deriving a dimension from a result is itself a rule.

**Immutability.** Sealed once written — with one exception, below.

**Context.** Inherits.

**Constraints.** LC-98, LC-99, LC-100.

**Historical behaviour.** Permanent.

**Result revision.** Where a Result (E1.19) is revised after linkage, a **new** outcome link is written recording the revision, and the original is retained. Calibration can then distinguish a claim that was wrong from a claim measured against a figure that later changed — which the previous system could not do, and which materially affects any measurement taken over a population including amended fixtures.

**Example.** A fixture completes; outcome links attach across result, goal total, both-teams-scored, clean sheet, half-time state, and margin. Every sealed snapshot of that fixture becomes measurable, at every dimension its modules addressed.

---

### E4.09 Snapshot Point

**Purpose.** The **named moment in a fixture's approach** at which a snapshot is taken.

It exists because comparability across fixtures requires the moments to be named and fixed. A snapshot taken *"whenever the calculation happened to run"* cannot be compared with one taken at a different offset, and comparability across fixtures is the entire basis of calibration.

**Layer & ownership.** Platform governance.

**Construct kind.** Reference Entity.

**Identity.** Stable point designation with a stable offset rule.

**Lifecycle.** Governed, slow-changing. Adding a point is a deliberate act with volume and calibration consequences.

**Relationships.** Referenced by Match Snapshot (E4.01) and by Calibration Series (E7.08), since a series is measured at a stated point.

**Version behaviour.** The **point definition** is versioned — changing an offset changes what the point means and therefore what a series measures.

**Immutability.** A point's meaning may not be redefined in place; sealed snapshots reference it.

**Context.** Not applicable.

**Constraints.** LC-10, LC-101, LC-102.

**Historical behaviour.** Permanent.

**The canonical point.** One point is designated canonical — the platform's final stated position, and the one against which headline reliability is measured. The architecture proposes four points with the last as canonical and records the exact set as an open decision; the model accommodates any set without change.

**Late entry and rescheduling.** A fixture entering the window late takes whichever points remain reachable; missing points are **absent rather than approximated**, and absence is recorded in coverage (E9.09). A rescheduled fixture retains its earlier snapshots — those snapshots described a fixture expected at a different time, which is itself a fact worth retaining, and the fixture's identity is deliberately stable across rescheduling (E1.13) so nothing is orphaned.

---

### E4.10 Snapshot Version

**Purpose.** The **complete manifest of every rule version in force** when a snapshot was sealed: the verdict composition version, the consensus rule version, every module version represented, every feature version consumed, and the model versions of every output.

It exists because a snapshot is produced by many rules simultaneously, so a single version designation cannot describe it. Version identity at snapshot level is necessarily a manifest.

**Layer & ownership.** Module calculation.

**Construct kind.** Entity — a manifest.

**Identity.** The snapshot.

**Lifecycle.** Sealed on write.

**Relationships.** Belongs to Snapshot Header (E4.02). References Feature Versions (E2.03), Module Versions (E3.02a), model versions, the verdict composition version, and the consensus rule version.

**Version behaviour.** It **is** the snapshot's version identity.

**Immutability.** Absolute.

**Context.** Not applicable.

**Constraints.** LC-103, LC-104.

**Historical behaviour.** Permanent.

**Example.** Two snapshots of the same fixture at the same point, under different manifests, are two legitimate parallel claims. Comparing them is exactly how a rule revision's value is measured — and neither existing means the other must be destroyed.

**Late recalculation.** A corrected rule set applied to historical fixtures produces **new snapshots under a new manifest**, with as-of moments matching the original points and sealed-at moments reflecting when the recalculation ran. The originals are untouched. This is the architecture's escape hatch made concrete: immutability without paralysis, because a corrected value has somewhere to exist that is not a rewrite.

---

## Match intelligence summary

| Entity | Kind | Posture |
|---|---|---|
| E4.01 Match Snapshot | Entity (aggregate) | **Sealed** |
| E4.02 Snapshot Header | Entity | Sealed |
| E4.03 Snapshot Feature State | Entity (resolution) | Sealed |
| E4.04 Snapshot Module Reading | Entity (resolution) | Sealed |
| E4.05 Snapshot Verdict | Entity | Sealed |
| E4.06 Snapshot Model Output | Entity | Sealed |
| E4.07 Snapshot Completeness | Entity | Sealed |
| E4.08 Snapshot Outcome Link | Entity | Additive, then sealed |
| E4.09 Snapshot Point | Reference | Governed |
| E4.10 Snapshot Version | Entity (manifest) | Sealed |

**The sealing rule.** A fixture's snapshots seal individually on write. The **fixture** seals when its Lifecycle State (E1.14) leaves the open state, after which no further snapshots may be created at any point. Consistent with the previous system's proven posture, an unrecognized lifecycle state seals by default: protect unless explicitly still open.

---

# 4.6 Team Intelligence View Model

## Why team intelligence is no longer a stored singleton

The previous system held seventeen per-club structures, each one record per club, each overwritten in place on every calculation run, none carrying competition context, season context, or history. Seven metrics from one of them were archived daily into a parallel history structure; the remaining nineteen were discarded on every run.

That shape answered *"what is true now"* efficiently and correctly. It could not answer *"what was true then"*, *"what is true in this competition"*, or *"under which rule"* — and those are the questions the product's claims now rest on.

**In V2, team intelligence is not an entity. It is a view over the feature store.**

Every quantity those seventeen structures held is a Feature Value (E2.05) with a Team subject. Nothing about team intelligence requires a mechanism the feature engine does not already provide, and this is the clearest demonstration that the architecture's central move — making time and context part of identity — dissolves problems rather than relocating them.

Three consequences follow without any new construct:

| Question | Resolution |
|---|---|
| What is true now? | Latest feature values for this club, as of now |
| What was true then? | Latest feature values for this club, as of then — **identical query shape** |
| What is true in this competition? | The same, at a competition-scoped context |

The previous system needed a separate history structure because its primary store could not hold history. **V2 does not relocate that structure — it stops needing one.**

---

### E5.01 Current Team State

**Purpose.** What is presently true about a club.

**Construct kind.** Derived View. **No stored existence.**

**Definition.** The set of Feature Values (E2.05) with this club as subject, at a stated context, taking the latest value per feature definition as of now.

**Ownership.** Derived from Layer 2. Authority rests entirely with the underlying values.

**Lifecycle.** Disposable. If materialized for performance, the materialization is a Projection (E8.02) and is rebuildable without loss.

**Version behaviour.** Each constituent value carries its own feature version. The view does not homogenize them — a club's current state may legitimately mix values produced under different versions where rules were revised at different times, and concealing that would be a fabrication.

**Immutability.** Not applicable. A view has nothing to protect; its constituents are already append-only.

**Context.** A required parameter. There is no context-free current state, because the concept does not exist in a model where context is part of identity.

**Constraints.** LC-105, LC-106.

**Historical behaviour.** Not applicable — this view is defined as of now. Its historical counterpart is E5.02.

**Example.** A club's present readiness, form quality, travel load, congestion, availability burden, and depth — assembled from the latest value of each, each carrying its own version, provenance, and sample.

---

### E5.02 Historical Team State

**Purpose.** What was true about a club at a past moment.

**Construct kind.** Derived View.

**Definition.** Identical to E5.01, with a stated as-of moment in place of now.

**Ownership.** Derived from Layer 2.

**Lifecycle.** Disposable.

**Version behaviour.** Returns values under the versions **in force at that moment** — not under current versions. This is the distinction between reconstructing history and rewriting it, and getting it wrong would silently apply today's rules to yesterday's world.

**Immutability.** Not applicable.

**Context.** Required.

**Constraints.** LC-105, LC-107.

**Historical behaviour.** This view **is** the historical behaviour of team intelligence.

**Example.** A club's readiness on a date two years ago, in a specific competition, under the rule in force then. The previous system could not produce this by any means; V2 produces it with the same query it uses for the present.

**Reconstructed history.** Where values were backfilled — produced later under a rule applied retrospectively — they are visibly marked through the distinction between as-of and calculated-at (§4.1.5). Reconstructed history and recorded history are different claims, and the model keeps them distinguishable.

---

### E5.03 Competition Team State

**Purpose.** What is true about a club **within one competition**.

**Construct kind.** Derived View.

**Definition.** E5.01 or E5.02 at a competition-scoped Feature Context (E2.08).

**Ownership.** Derived from Layer 2.

**Version behaviour.** As above.

**Context.** Competition-scoped by definition.

**Constraints.** LC-105, LC-108.

**Example.** A club's opponent-adjusted form differs between its domestic and continental competitions, because the opponents differ. The previous system held one figure covering both, and the architecture identified this as a structural impossibility rather than an oversight. No new mechanism resolves it — it is the same view at a different context.

**Feature applicability.** Only features whose definitions declare competition scope valid are returned. A fatigue value has no competition-scoped form, and requesting one returns nothing rather than silently returning the all-competitions figure — a substitution that would be indistinguishable from a real answer.

---

### E5.04 Cross-Competition Team State

**Purpose.** What is true about a club **because it competes in several competitions at once**.

**Construct kind.** Derived View.

**Definition.** E5.01 or E5.02 at cross-competition derived context.

**Ownership.** Derived from Layer 2.

**Context.** Cross-competition derived.

**Constraints.** LC-105, LC-109.

**Example.** Congestion arising from fixture density across competitions, active competition count, and rotation pressure. These are not competition-scoped, because no single competition produces them; nor are they all-competitions, because they are explicitly *about* the interaction. The architecture defines exactly three context kinds and this is the third — its existence is why two would have been insufficient.

---

### E5.05 Derived Team Intelligence

**Purpose.** The **composite presentation** of a club's state — the assembled view a consumer sees, drawing across contexts.

**Construct kind.** Derived View, optionally materialized as a Projection (E8.02).

**Definition.** A declared composition over E5.01–E5.04, naming which features at which contexts.

**Ownership.** Derived. **Authoritative for nothing.**

**Lifecycle.** Disposable. Dropping every materialization loses nothing but recomputation.

**Version behaviour.** Carries a composition version, since which features appear at which contexts is a declared rule.

**Immutability.** Not applicable.

**Context.** Multi-context by construction — its purpose is to assemble across scopes.

**Constraints.** LC-105, LC-110.

**Historical behaviour.** None of its own. Historical composites derive from E5.02.

**Example.** A club's assembled profile draws readiness at all-competitions scope, form quality at competition scope, and congestion at cross-competition scope — each labelled with its context, so a reader can tell which competition a figure describes. The previous system presented all three as unqualified club-level numbers.

---

## What happens to the seventeen structures

Every quantity is preserved. Each becomes a Feature Definition (E2.02) with a Team subject, gaining temporal identity, context identity, version attribution, declared provenance, and a sample count — none of which it previously had.

| Previous structure family | Becomes |
|---|---|
| Composite readiness and its components | Team-subject feature definitions, all-competitions and cross-competition contexts |
| Strength, quality, and dashboard ratings | Team-subject definitions — with the duplication among them resolved to one owner each |
| Venue performance | Team-subject definitions, competition-scoped |
| Form quality, momentum, motivation | Team-subject definitions, competition-scoped |
| Travel, congestion, fixture load | Team-subject definitions, cross-competition context |
| Depth, versatility, position coverage | Team-subject and position-scoped definitions |
| Injury burden, goal dependency, transfer activity | Team-subject definitions |
| Playing style, tactical variation | Team-subject definitions, with classifications relational rather than serialized |
| Narrative strengths and weaknesses | Module evidence and headline content (Layer 3), not metric attributes |
| Daily history archive | **No longer required** — the feature store is the history |

**Migration honesty.** The previous system holds no team-level history to migrate, beyond seven daily-archived metrics. V2 creates the structure; history begins at cutover. Where reconstruction from reality is possible — form-derived quantities can be replayed over the fixture record — backfill is a **new versioned calculation over history**, visibly marked as such through as-of and calculated-at, and never presented as though it had been observed at the time.

---

# 4.7 Player Intelligence Model

**Purpose.** To express everything the platform knows and calculates about a player, with one owner per fact.

Player data is the volume centre of the model, and the previous system's shape here produced the largest single normalization defect in the schema alongside three separate duplications. This section states where each fact now lives.

**The organizing principle.** A player's **reality** is Layer 1; a player's **calculated state** is Layer 2. The previous system mixed them on one record — biography alongside computed injury summaries — and the separation resolves it.

---

### E6.01 Player Statistics Domains

**Purpose.** Provider-reported player statistics, partitioned by statistical domain.

**Ownership.** **Layer 1 · Ingestion.** These are provider assertions, not platform calculations. Fully specified at E1.21 and E1.22.

**Why it appears here.** Because the previous system's single very wide structure was the most conspicuous normalization defect in the schema, and because the identity change accompanying the partition — including club in the identity — is what makes a mid-season transfer and dual-competition participation representable at all.

**What is not here.** Any computed judgement over statistics. The sufficiency gate the previous system carried on this structure is a Layer 2 feature, because it expresses a decision rather than an observation.

**Constraints.** LC-19, LC-111.

**Example.** A goalkeeper carries participation and goalkeeping domains and nothing else. An outfielder carries participation, attacking, creation, defending, discipline, and physical. Neither carries attributes belonging to the other, and sparsity ceases to exist rather than being tolerated.

---

### E6.02 Player Readiness

**Purpose.** A player's calculated availability-weighted condition.

**Ownership.** **Layer 2 · Feature calculation.** A Feature Definition (E2.02) with a Player subject.

**Why it appears here.** The architecture found *readiness* existing as an attribute name on three structures with three different formulas and no declared distinction between them. Under the model there is one player-readiness definition, namespaced by subject so it cannot be confused with the club-level definition, with one owner and one version line.

**Version behaviour.** Owns a version line independent of club readiness. The two are different metrics and their rules evolve independently.

**Context.** Declared per definition. A player's condition is generally all-competitions; a player's competition-specific eligibility is a different fact.

**Historical behaviour.** Append-only, like every feature. A player's readiness trajectory across a season is directly queryable — the previous system overwrote it on every run.

**Constraints.** LC-29, LC-112.

---

### E6.03 Player Impact

**Purpose.** A player's calculated expected contribution to a specific fixture.

**Ownership.** **Layer 2 · Feature calculation.** Feature definitions with a Player subject, calculated per fixture and sealed into snapshots.

**Why it appears here.** The previous system held a per-fixture player structure whose attributes largely restated player-level quantities — readiness, fatigue, importance — recomputed per fixture. Under the model, a fixture-time player quantity is **the player feature resolved at that moment**, sealed inside the snapshot. Genuinely fixture-specific quantities — matchup advantage against a particular opponent — remain distinct definitions, because they are genuinely different facts.

**Constraints.** LC-29, LC-113.

**Example.** A player's fitness at fixture time is the player-readiness feature at that as-of moment, sealed. A player's advantage against a specific opposing player is its own definition, because no player-level quantity expresses it.

---

### E6.04 Player Availability

**Purpose.** Whether a player is available, and if not, why and for how long.

**Ownership.** **Layer 1 · Ingestion.** Fully specified at E1.11.

**Why it appears here.** The previous system held availability in two places — ten attributes on the player record and a separate injury structure, both written by the same process with nothing constraining agreement. The resolution is not synchronization but **removal of one representation**. Current availability is a query over open spells, not a stored flag, so divergence is impossible by construction rather than merely discouraged.

**Derived availability quantities** — squad availability burden, positional availability, importance-weighted absence — are Layer 2 features consuming spells. They are calculated facts and belong above the reality layer.

**Constraints.** LC-11, LC-114.

---

### E6.05 Predicted Lineup

**Purpose.** The platform's calculated expectation of a club's selection for a fixture: which players, in which positions, in which roles, in which formation, with what confidence.

**Ownership.** **Layer 2 · Feature calculation.** A calculated artefact, never Layer 1.

**Construct kind.** Entity — one of the feature groups meeting the architecture's four-part test for a dedicated structure: computed together, read together, stable in shape, and high enough in volume that generic expression would cost materially.

**Identity.** The combination of fixture, club, player, and version.

**Lifecycle.** Append-only before the fixture seals; sealed into snapshots.

**Relationships.** References Fixture (E1.13), Team (E1.06), Player (E1.08), and Position (E1.10a). Consumes availability, statistics, and player features. Compared against actual Lineup (E1.16) for calibration.

**Version behaviour.** Owns a version line. Predicted selection is a rule and its accuracy is measurable.

**Immutability.** Sealed within snapshots.

**Context.** The fixture's competition edition — selection is competition-specific in a way most player facts are not, since squad registration rules differ between competitions.

**Constraints.** LC-115, LC-116.

**Historical behaviour.** Permanent through snapshots; measurable against actual lineups.

**Example.** Prediction accuracy is measurable because prediction and actuality are distinct entities with distinct owners. The previous system's structure was among its strongest work — properly constrained, well specified, with tactical role and positional detail — and the design carries forward substantially intact.

**Two refinements.** Formation belongs to the club's predicted lineup, stated once, rather than repeated on every player selection — the previous system stored it both ways. And derived inputs such as recent starting frequency are **referenced** as feature values rather than copied in, so their version and provenance travel with them.

---

### E6.06 Position Profile

**Purpose.** The positions a player occupies.

**Ownership.** **Split, deliberately, and the split is the point:**

| Form | Layer | Owner |
|---|---|---|
| Provider-asserted profile | Layer 1 | Ingestion (E1.10) |
| Calculated profile from observed appearances | Layer 2 | Feature calculation |

**Why the split.** These are different facts with different trustworthiness. What a provider says a player is differs from where a player has actually played, and both are useful. The previous system carried five attributes plus a list representation with no declared precedence, so the distinction could not be expressed at all — let alone reasoned about.

**Constraints.** LC-09, LC-117.

**Example.** Depth analysis may prefer observed positions over asserted ones, or weight them. Under the model that is a choice a calculator declares; previously it was not expressible.

---

### E6.07 Valuation History

**Purpose.** A player's market value over time.

**Ownership.** **Layer 1 · Ingestion.** Fully specified at E1.12.

**Why it appears here.** The previous system stored one undated, uncurrencied scalar, overwritten on every ingestion — discarding trajectory continuously. Trajectory is signal: a rising and a falling valuation at the same absolute figure describe different players.

**Derived valuation quantities** — squad value, available value, absent value, value concentration — are Layer 2 features consuming the valuation series. Because the series is dated, they are computable **at any historical moment**, where previously today's figures were the only ones that existed and were silently applied to yesterday's squad.

**Constraints.** LC-12, LC-118.

---

## Player model summary

| Fact | Layer | Owner | Previously |
|---|---|---|---|
| Biography | 1 | Ingestion (E1.08) | Mixed with four other concerns |
| Positions (asserted) | 1 | Ingestion (E1.10) | Five attributes plus a list, no precedence |
| Positions (observed) | 2 | Feature calculation | Not expressible |
| Club affiliation | 1 | Ingestion (E1.09) | Current club only |
| Availability | 1 | Ingestion (E1.11) | Two representations, unconstrained |
| Valuation | 1 | Ingestion (E1.12) | One undated scalar, overwritten |
| Provider statistics | 1 | Ingestion (E1.21) | One structure of ~118 attributes |
| Readiness, fatigue, load | 2 | Feature calculation | Overwritten per run |
| Importance, versatility | 2 | Feature calculation | Overwritten per run |
| Fixture-time impact | 2 → sealed | Feature calculation | Restated per fixture |
| Predicted selection | 2 → sealed | Feature calculation | Well modelled; carries forward |

**Volume note.** Player data is the volume centre of V2. Domain partitioning removes sparsity; per-fixture player quantities carry the same retention treatment as all snapshot content. One previous structure warrants specific attention before its shape is carried forward: the per-fixture player-pair family, whose identity rule permits a row per player pairing and therefore a very large number per fixture. Whether it is populated at that density is a measurement the architecture requested and the answer governs whether it survives as a definition family, is bounded to positional pairings, or is derived on demand.

---

# 4.8 Calibration Entities

**Purpose.** To measure, permanently and reproducibly, how reliable the platform's claims have been.

**Ownership.** Calibration — a cross-cutting owner outside the layer stack, reading sealed claims and outcomes and writing measurements.

**Posture.** Sealed. A measurement states what was true of a population at a moment; re-measuring produces a new measurement, never an edit.

**Why this is the competitive position.** The platform's claim is not that it predicts outcomes. It is that a pattern held across a stated number of historical fixtures, with a stated lift over a stated base rate, at a stated confidence. That claim is only as good as the machinery producing it.

The previous system built genuinely good machinery — point-in-time archives, formula version on the archive, strict and lenient scoring, Wilson intervals, explicit sample gates, per-competition segmentation, and a marked distinction between properly measured cohorts and an earlier cohort known to contain lookahead contamination — and applied it to **one** of the models it shipped. The requirement here is not invention. It is generalization, plus the correction of two structural limits.

**Limit 1.** The archive's identity rule permitted one archived claim per fixture, so a claim made a week out and a revised claim made a day out could not both be retained. **Snapshots resolve this**: every point is separately sealed.

**Limit 2.** Only one model was archived, so nothing else could be calibrated and nothing else could make an evidenced claim. **Snapshots resolve this too**: everything the platform said is sealed, so everything is measurable.

---

### E7.01 Calibration Run

**Purpose.** One act of measurement: what was measured, over which population, at which versions, by which code revision, at what moment.

It exists so that a measurement is attributable. A reliability figure that cannot name the population it was taken over, or the rule version it measured, is not evidence.

**Layer & ownership.** Calibration.

**Construct kind.** Entity.

**Identity.** Stable run identity.

**Lifecycle.** **Sealed** on completion.

**Relationships.** References Measurement Population (E7.05), Calibration Version (E7.09), and the Pipeline Job Run (E9.02) that executed it. Parent of Calibration Result (E7.02).

**Version behaviour.** Owns a calibration version — the measurement methodology is itself a rule. Inherits, by reference, the module and model versions it measured.

**Immutability.** Absolute.

**Context.** May be competition-scoped or pooled; records which.

**Constraints.** LC-119, LC-120.

**Historical behaviour.** Permanent. The sequence of runs is the record of how the platform's self-measurement evolved.

**Example.** A run measures every sealed canonical snapshot for a stated competition, over a stated period, at a stated module version, producing results per band. Repeating it a month later produces a **second** run — the two together show the trajectory.

---

### E7.02 Calibration Result

**Purpose.** One measured outcome within a run: for a stated module version, at a stated band, against a stated outcome dimension — the observation count, the hits, the rate, the base rate, the lift, and the interval.

**Layer & ownership.** Calibration.

**Construct kind.** Entity.

**Identity.** The combination of run, calibration series, and band.

**Lifecycle.** Sealed on write.

**Relationships.** Belongs to Calibration Run (E7.01) and to Calibration Series (E7.08). References Outcome Dimension (E7.04). Carries Confidence Interval (E7.06) and is evaluated against Sample Gate (E7.07). Referenced by Published Baseline (E7.03).

**Version behaviour.** Inherits the run's calibration version and the series' module version.

**Immutability.** Absolute.

**Context.** Inherits the series' context.

**Constraints.** LC-121, LC-122, LC-123.

**Historical behaviour.** Permanent — and this is the second correction. The previous system retained only the latest evaluation per rule, discarding the **trajectory** of measured reliability, which is arguably the most interesting signal the system produces. Whether a module is improving or degrading is not answerable from a single figure.

**Example.** Ten monthly runs produce ten results within one series, showing a module's measured rate moving as its sample grows. The previous system would have retained the tenth and destroyed the other nine.

---

### E7.03 Published Baseline

**Purpose.** The calibration result **promoted for use** — the figure a module reading cites.

It exists to make the boundary between measurement and publication explicit. Not every measurement is publishable: a result failing its sample gate is a real measurement and an unpublishable one, and the model must be able to hold both facts at once.

**Layer & ownership.** Calibration.

**Construct kind.** Entity.

**Identity.** The combination of module version, band, outcome dimension, context, and effective period.

**Lifecycle.** Append-only. A new promotion supersedes an earlier one by being later; both persist, so a historical reading's cited baseline remains resolvable.

**Relationships.** References the Calibration Result (E7.02) it promotes. Referenced by Module Baseline Reference (E3.06).

**Version behaviour.** Carries the module version of the result it promotes. **A baseline may only be cited by a reading at the same module version** — this is what prevents a rate measured on one rule from being displayed beside a reading produced by another.

**Immutability.** Sealed on promotion.

**Context.** Records whether it is competition-scoped or pooled, so a pooled figure is never presented as competition-specific.

**Constraints.** LC-124 through LC-127.

**Historical behaviour.** Permanent. A reading made two years ago cites the baseline in force then, and that baseline remains resolvable.

**Example.** A baseline whose result fails its sample gate is promoted as **explicitly unverified** rather than as a clean rate. The previous system's own design contract required exactly this — a rate without an observation count renders as unverified, never as a bare figure — and here it is a constraint rather than a rendering convention.

**Provenance of measurement.** A baseline records whether its result was measured on a properly point-in-time population or on a cohort with known contamination. The previous system tracked exactly this distinction, marking one cohort as containing lookahead because finished fixtures had been scored using then-current form. **That marking must survive migration**, because a figure's trustworthiness is not recoverable from the figure.

---

### E7.04 Outcome Dimension

**Purpose.** The governed vocabulary of **what can be measured about a completed fixture**: result, goal total, both teams scoring, clean sheet, half-time state, margin.

It exists because modules characterize different things, and a module must be measured against **the dimension it actually addresses**. The previous system scored against a single result-based dimension, which could not express reliability for any module not about the result — and several modules are not.

**Layer & ownership.** Platform governance.

**Construct kind.** Reference Entity.

**Identity.** Stable dimension code with a stable derivation rule from Result (E1.19).

**Lifecycle.** Governed, slow-changing.

**Relationships.** Referenced by Module Definition (E3.02) as its scored dimension, by Snapshot Outcome Link (E4.08), by Calibration Series (E7.08), and by Calibration Result (E7.02).

**Version behaviour.** The **derivation rule** is versioned — deriving a dimension from a result is itself a rule, and changing it changes every measurement taken against it.

**Immutability.** A dimension's meaning may not be redefined in place; sealed outcome links reference it.

**Context.** Not applicable.

**Constraints.** LC-10, LC-128.

**Historical behaviour.** Permanent.

**Example.** A module characterizing scoring environments is measured against goal total, not against result. Measuring it against result would produce a figure that is precise, reproducible, and meaningless.

---

### E7.05 Measurement Population

**Purpose.** The **declared, reproducible definition** of which sealed claims a run measured.

It exists because a reliability figure is meaningless without its population, and because the population must be reproducible — a measurement nobody can repeat is an assertion.

**Layer & ownership.** Calibration.

**Construct kind.** Entity.

**Identity.** Stable population definition identity.

**Lifecycle.** Sealed once referenced by a run.

**Relationships.** Referenced by Calibration Run (E7.01) and Calibration Series (E7.08). Selects over Match Snapshot (E4.01) by fixture period, competition, snapshot point, module version, and completeness threshold.

**Version behaviour.** Sealed definitions are not versioned; a different population is a different definition.

**Immutability.** Sealed.

**Context.** May be competition-scoped or pooled.

**Constraints.** LC-129, LC-130.

**Historical behaviour.** Permanent.

**Example.** *"Canonical-point snapshots for fixtures in this competition between these dates, at this module version, where completeness exceeded this threshold."* Stating the completeness threshold matters: a population including badly-incomplete snapshots measures something different from one that excludes them, and the difference must be visible rather than buried in whoever ran the measurement.

---

### E7.06 Confidence Interval

**Purpose.** The **statistical uncertainty** of a measured rate.

It exists because a rate without an interval overstates its own precision, and because a rate over twelve observations and one over twelve hundred are not comparable figures however similar they look.

**Layer & ownership.** Calibration.

**Construct kind.** Value Object.

**Identity.** None — it qualifies a result.

**Lifecycle.** Fixed with its result.

**Relationships.** Qualifies Calibration Result (E7.02). Travels into Published Baseline (E7.03).

**Version behaviour.** The interval **method** belongs to the calibration version, since a different method produces different bounds from the same data.

**Immutability.** Permanent.

**Context.** Inherits.

**Constraints.** LC-131, LC-132.

**Historical behaviour.** Permanent.

**Example.** The previous system computed Wilson intervals, which is sound practice for proportions at small samples and is inherited. It also, correctly, suppressed an interval where the observation count was pooled across bands rather than specific to one — a pooled count cannot support a per-band interval, and drawing one would be falsely narrow. That discipline is inherited as a constraint.

---

### E7.07 Sample Gate

**Purpose.** The declared **minimum observation count** below which a measured rate may not be published.

It exists because the platform's evidential standard is a product commitment, and a commitment enforced by editorial judgement is enforced inconsistently.

**Layer & ownership.** Platform governance.

**Construct kind.** Reference Entity — a policy.

**Identity.** The combination of module definition or series and gate designation.

**Lifecycle.** Governed. Changing a gate is deliberate and affects what may be published.

**Relationships.** Applied to Calibration Result (E7.02); determines whether Published Baseline (E7.03) may present a clean rate.

**Version behaviour.** Versioned. Changing a gate changes what the platform publishes and must be attributable.

**Immutability.** Recorded gate evaluations are permanent, so it remains visible that a historical baseline met or failed the gate in force at the time.

**Context.** May differ by context — a competition-scoped gate is typically lower than a pooled one, since competition-scoped populations are smaller.

**Constraints.** LC-133, LC-134.

**Historical behaviour.** Permanent.

**Example.** The previous system carried an explicit boolean gate on its per-competition summary. The instinct is correct and here it is systematic: every published rate passes a declared gate or is marked unverified, with no third path.

---

### E7.08 Calibration Series

**Purpose.** The **continuous measurement line** for one thing being measured: one module version, at one band, against one outcome dimension, in one context, at one snapshot point.

It exists so that measurements accumulate into a **trajectory** rather than replacing one another, and so that a rule change **starts a new line** rather than contaminating the old.

**Layer & ownership.** Calibration.

**Construct kind.** Entity.

**Identity.** The composite: **module version · band · outcome dimension · context · snapshot point.**

**Lifecycle.** Opened when its module version activates; closed when that version retires. Never deleted.

**Relationships.** References Module Version (E3.02a), Outcome Dimension (E7.04), Snapshot Point (E4.09), and Measurement Population (E7.05). Parent of Calibration Result (E7.02).

**Version behaviour.** Keyed by module version. **This is the correction of the previous system's most consequential calibration limit** — without it, a rule change silently mixes two rules into one statistic, and the published figure describes a system that never existed.

**Immutability.** Series identity permanent; results within it append.

**Context.** Part of identity.

**Constraints.** LC-135, LC-136, LC-137.

**Historical behaviour.** Permanent, including closed series for retired versions.

**Example.** Revising a module closes its series and opens a new one. The two are separately measured over comparable populations, and the revision's value becomes a measurement rather than an assertion.

---

### E7.09 Calibration Version

**Purpose.** The identity of the **measurement methodology** — how scoring is performed, how bands are cut, how intervals are computed, how populations are selected.

It exists because the measurement is itself a rule, and a change to it changes the figures without any change to what is being measured. That is precisely the kind of silent shift the platform's evidential positioning cannot tolerate.

**Layer & ownership.** Platform governance.

**Construct kind.** Entity.

**Identity.** Stable version designation.

**Lifecycle.** Append-only. Registered, activated, retired.

**Relationships.** Referenced by Calibration Run (E7.01). Governs Confidence Interval (E7.06) method and scoring rules.

**Version behaviour.** It is version identity.

**Immutability.** Sealed on registration.

**Context.** Not applicable.

**Constraints.** LC-25, LC-138.

**Historical behaviour.** Permanent.

**Example.** Changing the interval method changes every subsequent figure. With calibration version recorded, comparing a figure measured under the old method with one measured under the new is a detectable mismatch rather than an invisible one.

---

### E7.10 Historical Reliability

**Purpose.** The **derived answer** to the platform's defining question: *was this module historically reliable?*

**Layer & ownership.** Calibration · Derived.

**Construct kind.** Derived View.

**Definition.** For a module version, band, outcome dimension, and context: the latest published baseline meeting its gate, together with the series trajectory behind it.

**Lifecycle.** Disposable while derived; materialized into Snapshot Verdict (E4.05) when sealed.

**Relationships.** Derives from Calibration Series (E7.08), Calibration Result (E7.02), and Published Baseline (E7.03). Consumed by Module Baseline Reference (E3.06) and Snapshot Verdict (E4.05).

**Version behaviour.** Reports at a stated module version; never aggregates across versions.

**Immutability.** Disposable while derived; permanent once sealed.

**Context.** Reports whether competition-scoped or pooled.

**Constraints.** LC-139, LC-140.

**Historical behaviour.** Preserved through the snapshots that sealed it.

**The question, answered.** Every element of the following statement is stored, versioned, and reproducible; none is authored by hand:

> *This module, at version two, over fixtures in this competition between these dates, at the canonical snapshot point, reading in this band: this many observations, this hit rate against this base rate, this lift, this interval, sample gate met, measured on a point-in-time population.*

---

## Calibration summary

| Entity | Kind | Posture |
|---|---|---|
| E7.01 Calibration Run | Entity | **Sealed** |
| E7.02 Calibration Result | Entity | **Sealed** — time series, not latest-value |
| E7.03 Published Baseline | Entity | Append-only |
| E7.04 Outcome Dimension | Reference | Governed |
| E7.05 Measurement Population | Entity | Sealed |
| E7.06 Confidence Interval | Value Object | Fixed with result |
| E7.07 Sample Gate | Reference (policy) | Governed, versioned |
| E7.08 Calibration Series | Entity | Permanent, keyed by module version |
| E7.09 Calibration Version | Entity | Append-only |
| E7.10 Historical Reliability | Derived View | Disposable → sealed |

**What generalization achieves.** The previous system's machinery measured one model. Under this model every sealed claim is measurable: every module reading, every model output, every verdict, at every snapshot point, against every outcome dimension it addresses. The apparatus is the same apparatus; what changes is that everything now falls within its reach.

---

# 4.9 Product Layer Entities

**Purpose.** To hold everything about serving and selling, and nothing about calculating or judging.

**Ownership.** Product and user action.

**Posture.** Read models are disposable. User and commercial data are durable.

**The layer's defining constraint.** **Every number in this layer is a copy whose owner lies below it.** The product layer is authoritative for exactly three things: what a user chose, what a user is entitled to, and what the platform has been configured to do. It is authoritative for nothing about football.

**A terminology collision, stated explicitly.** The word *feature* carries two distinct meanings in this model, and conflating them would be a serious error:

| Term | Meaning | Layer |
|---|---|---|
| **Calculated Feature** | A derived metric about a football entity | Layer 2 |
| **Entitlement Feature** | A sellable capability a plan grants access to | Layer 4 |

They are unrelated constructs. The architecture inherited both usages, and this document preserves the terminology while always qualifying which is meant.

---

### E8.01 Read Model

**Purpose.** The **declaration** of a shaped projection for a consuming surface: which entities, at which contexts, assembled how, refreshed how often, and expected to be fresh within what tolerance.

It exists because the previous system's projections were undeclared. The architecture found objects on primary read paths whose definitions existed in neither the schema dump nor either repository — depended upon, and describable by nobody.

**Layer & ownership.** Layer 4 · Product.

**Construct kind.** Entity — a declaration, distinct from its materialization.

**Identity.** Stable read model identity.

**Lifecycle.** Mutable declaration.

**Relationships.** Declares composition over Layer 1, 2, and 3 entities. Realized as Projection (E8.02). Monitored by Freshness (E9.06).

**Version behaviour.** Versioned. A changed shape is a changed contract with its consumers.

**Immutability.** None.

**Context.** Declares which contexts its constituent quantities are drawn at.

**Constraints.** LC-141, LC-142, LC-143.

**Historical behaviour.** None. Read models describe the present.

**Example.** A declared read model states what a consuming surface needs and where each element comes from. It is discoverable, versioned, and describable — which its predecessor was not.

---

### E8.02 Projection

**Purpose.** A **materialization** of a read model.

It exists as a construct separate from the declaration because materializations are operational artefacts with their own refresh state and staleness, while declarations are contracts. Conflating them makes it impossible to say *"the contract is fine; the materialization is four hours stale."*

**Layer & ownership.** Layer 4 · Product.

**Construct kind.** Entity — disposable.

**Identity.** The combination of read model and materialization scope.

**Lifecycle.** **Disposable.** Dropping every projection loses nothing but recomputation. This is the definitional test of the layer, and any projection failing it is misclassified.

**Relationships.** Realizes Read Model (E8.01). Derives from the entities the model declares.

**Version behaviour.** Carries the read model version that produced it, so a stale projection built under an old contract is identifiable.

**Immutability.** None — rebuilt freely.

**Context.** As declared.

**Constraints.** LC-141, LC-144, LC-145.

**Historical behaviour.** **None, by rule.** A projection retaining information not present in its sources is authoritative and misclassified.

**Example.** Every projection may be discarded and rebuilt with no loss. If that is not true of one, it holds something nothing else holds, and that is a modelling defect to correct rather than a convenience to accept.

---

### E8.03 Plan

**Purpose.** A sellable subscription tier: its identity, its commercial terms, and its rank relative to other plans.

**Layer & ownership.** Layer 4 · Product administration.

**Construct kind.** Entity.

**Identity.** Stable plan identity, independent of display name and price.

**Lifecycle.** Mutable. Plans are repriced, renamed, activated, and deactivated.

**Relationships.** Referenced by Subscription (E8.06) and by Feature Matrix (E8.05).

**Version behaviour.** Not applicable in the formula sense. Commercial terms change over time and historical subscriptions record the terms in force.

**Immutability.** Identity permanent — historical subscriptions reference it.

**Context.** Not applicable.

**Constraints.** LC-146, LC-147.

**Historical behaviour.** Retired plans persist because historical subscriptions reference them.

**Example.** Plan definitions exist **only** here. The architecture found them duplicated into application code alongside prices and inclusion lists, so the platform held two answers to what a plan costs.

**Rank.** Plans carry an explicit rank so tier comparison is data-driven. The previous system did this correctly and it is inherited.

---

### E8.04 Entitlement Feature

**Purpose.** A **sellable capability** — a named thing access may be granted or withheld to.

**Layer & ownership.** Layer 4 · Product administration.

**Construct kind.** Reference Entity.

**Identity.** Stable entitlement key.

**Lifecycle.** Mutable declaration; governed.

**Relationships.** Referenced by Module Definition (E3.02) as its entitlement requirement, and by Feature Matrix (E8.05).

**Version behaviour.** Not applicable.

**Immutability.** Keys permanent once granted, since historical grants reference them.

**Context.** Not applicable.

**Constraints.** LC-148, LC-149.

**Historical behaviour.** Permanent.

**Example.** Entitlement keys exist **only** here. The architecture found them duplicated as a fixed list in application code alongside a hand-maintained mapping, with the consequence that a record added without a corresponding code change was invisible, and a code change without a record silently granted access.

**Direction of reference.** A module definition references its entitlement requirement; the entitlement layer does not enumerate modules. This keeps commercial concerns out of the module registry while leaving entitlement resolvable in one direction.

---

### E8.05 Feature Matrix

**Purpose.** The declaration of **which plans grant which entitlement features**.

It exists because the previous system expressed entitlement as a single minimum plan per capability, and that shape cannot express a capability available on two non-adjacent plans, a capability temporarily promoted, or a capability granted outside the rank ordering. A matrix expresses all three.

**Layer & ownership.** Layer 4 · Product administration.

**Construct kind.** Entity.

**Identity.** The combination of plan and entitlement feature.

**Lifecycle.** Mutable. Commercial packaging changes.

**Relationships.** References Plan (E8.03) and Entitlement Feature (E8.04). Consulted by entitlement resolution.

**Version behaviour.** Not applicable in the formula sense, but grants carry effective periods so that historical resolution is possible.

**Immutability.** Historical grants preserved through effective periods.

**Context.** Not applicable.

**Constraints.** LC-150, LC-151.

**Historical behaviour.** Preserved. What a plan granted at a past moment is answerable.

**Example.** A capability available on two plans but not the one ranked between them is expressible. Under the previous shape it was not.

---

### E8.06 Subscription

**Purpose.** A user's relationship to a plan: its state, its period, and its commercial linkage.

**Layer & ownership.** Layer 4 · Product administration and billing.

**Construct kind.** Entity.

**Identity.** The combination of user, plan, and period start.

**Lifecycle.** Mutable while active; permanent once ended.

**Relationships.** References the user identity and Plan (E8.03). Accompanied by a subscription event history.

**Version behaviour.** Not applicable.

**Immutability.** Ended subscriptions permanent.

**Context.** Not applicable.

**Constraints.** LC-152, LC-153.

**Historical behaviour.** Fully preserved, including the event history of transitions.

**Example.** The previous system's subscription modelling was among its strongest work — well-constrained states, explicit transition events, and enforcement that a user holds one live subscription. It is inherited essentially unchanged.

**Beta posture.** A platform-level configuration flag may open all capabilities regardless of subscription. The previous system enforced this at the data layer rather than only in application code, which is the correct location, and it is inherited.

---

### E8.07 Watchlist

**Purpose.** Entities a user has chosen to follow.

**Layer & ownership.** Layer 4 · User action.

**Construct kind.** Entity.

**Identity.** The combination of user, entity kind, and entity.

**Lifecycle.** Mutable — users add and remove freely.

**Relationships.** References the user identity and, polymorphically, Team (E1.06), Fixture (E1.13), or Competition (E1.02).

**Version behaviour.** Not applicable.

**Immutability.** None.

**Context.** Not applicable.

**Constraints.** LC-154, LC-155.

**Historical behaviour.** Current state only. A removed entry is removed; no analytical requirement retains it.

**Example.** Polymorphic references require **referential defence** — the referenced entity may cease to exist, and a reference to a nonexistent entity must not survive. The previous system provided this for watchlists and, the architecture noted, not for its notification structure. The model requires it uniformly wherever a polymorphic reference appears.

---

### E8.08 User Preferences

**Purpose.** A user's stated choices about presentation, delivery, and personalization — including followed competitions and notification topics.

**Layer & ownership.** Layer 4 · User action.

**Construct kind.** Entity.

**Identity.** The user, plus preference domain.

**Lifecycle.** Mutable.

**Relationships.** References the user identity; may reference Competition (E1.02) for followed competitions.

**Version behaviour.** Not applicable.

**Immutability.** None.

**Context.** Not applicable.

**Constraints.** LC-154, LC-156.

**Historical behaviour.** Current state only.

**Example.** A user following a set of competitions and electing to receive certain notification topics. Preference is authoritative user data — one of only three things this layer owns outright.

---

### E8.09 Notification Intent

**Purpose.** A **statement that something has occurred which a user has asked to hear about**, distinct from any act of delivery.

It exists as *intent* rather than as a message because the interesting fact is the occurrence, not the transmission. What changed, when, and for whom is analytically meaningful and reproducible; whether a delivery succeeded is operational.

**Layer & ownership.** Layer 4 · Product.

**Construct kind.** Entity.

**Identity.** The combination of user, triggering occurrence, and moment.

**Lifecycle.** Append-only. An intent is a statement about a moment.

**Relationships.** References the user identity, User Preferences (E8.08) for the topic, and the occurrence that triggered it — which may be a Module Reading (E3.03), a Match Snapshot (E4.01), or a Fixture Lifecycle transition (E1.14).

**Version behaviour.** The **triggering rule** is versioned — what constitutes a change worth reporting is a rule, and changing it changes what users receive.

**Immutability.** Sealed on write.

**Context.** Inherits the triggering occurrence's context.

**Constraints.** LC-157, LC-158.

**Historical behaviour.** Permanent, subject to retention policy.

**Status.** The architecture recorded notification as a product decision not yet taken, and modelled the prior structures as awaiting one. This entity is specified so that the decision is unblocked, not pre-empted — no entity depends on it and its absence changes nothing.

**Example.** The previous system's preference structure named a module-change topic that nothing could support, because module outputs were never stored and so no change could be detected. Under this model stored readings make that topic supportable directly — the product intent and the substrate now align.

---

## Product layer summary

| Entity | Kind | Posture | Authoritative for |
|---|---|---|---|
| E8.01 Read Model | Entity | Mutable declaration | The contract |
| E8.02 Projection | Entity | **Disposable** | Nothing |
| E8.03 Plan | Entity | Mutable | Commercial terms |
| E8.04 Entitlement Feature | Reference | Governed | Capability identity |
| E8.05 Feature Matrix | Entity | Mutable, effective-dated | Grant rules |
| E8.06 Subscription | Entity | Mutable → permanent | User relationship |
| E8.07 Watchlist | Entity | Mutable | User choice |
| E8.08 User Preferences | Entity | Mutable | User choice |
| E8.09 Notification Intent | Entity | **Append-only** | Occurrence record |

**One resolution path.** Entitlement resolves through the plan, matrix, subscription, and configuration flag — and through nothing else. The architecture found two resolution paths coexisting, one reading a deployment-time setting and one reading stored records. The model provides one.

---

# 4.10 Operational Entities

**Purpose.** To record what the platform did, so that what it produced can be trusted.

**Ownership.** Operations — a cross-cutting owner outside the layer stack.

**Posture.** Append-only, with bounded retention. **Operational data is explicitly exempt from the immutability commitments of Layers 1 through 3.** It is telemetry, and thinning it loses no claim.

**Why this matters more in V2 than it did before.** The previous system's operational surface was a single daily counters record carrying, among aggregate figures, one nullable timestamp. The architecture recorded the consequence: the most basic production question — *is today's intelligence fresh, and which parts of it failed?* — was unanswerable.

Under append-only calculation and sealed snapshots the stakes rise sharply. **When calculations were overwritten, a failed run was self-correcting** — the next run fixed it. **When calculations append and snapshots seal, a failed run leaves a permanent gap**, and a snapshot that should exist and does not is indistinguishable, later, from a fixture that never warranted one.

Operational data is therefore not tooling. It is part of the historical record, and it carries the same design rigour as football data.

---

### E9.01 Pipeline Run

**Purpose.** One orchestrated execution: what triggered it, over what scope, when it started and ended, its outcome, and the code revision that ran.

**Layer & ownership.** Operations.

**Construct kind.** Entity.

**Identity.** Stable run identity.

**Lifecycle.** Append-only; completed on termination.

**Relationships.** Parent of Pipeline Job Run (E9.02).

**Version behaviour.** Records the **code revision**, which is distinct from formula version. Formula version says which rule; code revision says which build. Both are required — a change in output may come from a changed rule or from a changed implementation of the same rule, and diagnosing which is impossible with only one.

**Immutability.** Permanent within retention.

**Context.** Records the scope it ran over.

**Constraints.** LC-159, LC-160.

**Historical behaviour.** Retained in full for a bounded window; aggregated beyond it.

**Example.** Every sealed snapshot traces to the run that produced it. A claim whose producing execution cannot be identified is a claim nobody can audit.

---

### E9.02 Pipeline Job Run

**Purpose.** One job within a run: which job, over what scope, timing, outcome, and the versions in force.

**Layer & ownership.** Operations.

**Construct kind.** Entity.

**Identity.** The combination of run and job execution.

**Lifecycle.** Append-only.

**Relationships.** Belongs to Pipeline Run (E9.01). References Feature Calculator (E2.04) or the module or calibration process executing. Parent of Write Record (E9.03) and Failure (E9.04). Referenced by Snapshot Header (E4.02) and Calibration Run (E7.01).

**Version behaviour.** Records every formula version in force.

**Immutability.** Permanent within retention — **but job runs referenced by sealed artefacts are retained permanently**, because a sealed claim must remain traceable.

**Context.** Records its scope.

**Constraints.** LC-159, LC-161, LC-162.

**Historical behaviour.** As above.

**Example.** "The run failed" is not actionable. "The travel calculator failed for forty of sixty-one competitions" is. Job-level granularity is where failure becomes diagnosable.

---

### E9.03 Write Record

**Purpose.** What a job actually **wrote**: how many entities were examined, written, skipped, and rejected, by target.

It exists because a job completing successfully while writing nothing is among the most dangerous states in a precompute platform, and it is invisible without this record. "The job succeeded" and "the job wrote what it should have" are different facts.

**Layer & ownership.** Operations.

**Construct kind.** Entity.

**Identity.** The combination of job run and target entity family.

**Lifecycle.** Append-only.

**Relationships.** Belongs to Pipeline Job Run (E9.02).

**Version behaviour.** Inherits.

**Immutability.** Permanent within retention.

**Context.** Records the scope written.

**Constraints.** LC-159, LC-163.

**Historical behaviour.** Retained in full for a bounded window; aggregated beyond it.

**Example.** A calculator succeeding while writing zero values is detectable immediately rather than being discovered later as an unexplained gap in a series.

---

### E9.04 Failure

**Purpose.** A failure as **data**: what failed, in which job run, against which entity, its classification, its diagnostic, and its resolution state.

**Layer & ownership.** Operations.

**Construct kind.** Entity.

**Identity.** Stable failure identity.

**Lifecycle.** Append-only; resolution state mutable.

**Relationships.** Belongs to Pipeline Job Run (E9.02). May reference the entity it failed against.

**Version behaviour.** Inherits.

**Immutability.** The failure record is permanent; its resolution state is not.

**Context.** Records scope.

**Constraints.** LC-159, LC-164.

**Historical behaviour.** Retained **longer than successes** — failure history is more valuable per record.

**Classification.** Transient, data-quality, logic, or upstream. The distinction is operationally decisive: an upstream timeout is routine while a logic error is not, and treating them identically produces either alert fatigue or missed incidents.

---

### E9.05 API Usage

**Purpose.** External requests by provider, endpoint, and window; quota consumed, quota remaining, throttling encountered.

It exists because the architecture established that ingestion is **quota-bound rather than compute-bound** — the previous system carried configuration specifically to double a daily quota by adding a second credential — and nothing recorded consumption. At the platform's coverage target, quota is the binding constraint on freshness, and an unmeasured binding constraint cannot be managed.

**Layer & ownership.** Operations.

**Construct kind.** Entity.

**Identity.** The combination of provider, endpoint, and window.

**Lifecycle.** Append-only.

**Relationships.** May reference Pipeline Job Run (E9.02).

**Version behaviour.** Not applicable.

**Immutability.** Permanent within retention.

**Context.** Not applicable.

**Constraints.** LC-159, LC-165.

**Historical behaviour.** Retained long enough to support capacity planning — the longest operational retention, since it answers questions about growth rather than about incidents.

**Example.** Whether coverage can expand is answerable from measurement rather than from estimation.

---

### E9.06 Freshness

**Purpose.** Per feature definition, per subject class, per context: when it was last calculated, when it is next expected, and whether it is within tolerance.

It exists so the platform can distinguish **"no edge detected"** from **"the calculator did not run."** The architecture noted that the previous consuming surface degraded gracefully to demonstration content when a query returned nothing — resilient, and it made a silently empty structure indistinguishable from healthy data.

**Layer & ownership.** Operations · Derived.

**Construct kind.** Derived View, optionally materialized.

**Identity.** The combination of feature definition, subject class, and context.

**Lifecycle.** Derived; disposable.

**Relationships.** Derives from Feature Value (E2.05) calculated-at moments, from Feature Source (E2.10) declarations, and from expected cadence.

**Version behaviour.** Not applicable.

**Immutability.** Not applicable.

**Context.** Reported per context — a value may be current at all-competitions scope and stale at competition scope, and the difference matters.

**Constraints.** LC-166, LC-167.

**Historical behaviour.** Current state; breaches recorded as Failures (E9.04).

**Example.** Declared sources make freshness derivable rather than hand-maintained: a fatigue feature sourcing from appearances is stale whenever appearance ingestion has not run, and nobody has to remember that relationship.

---

### E9.07 Quality Check

**Purpose.** A **registered assertion** about data correctness: what is asserted, over what scope, at what severity, on what cadence.

**Layer & ownership.** Operations · Platform governance.

**Construct kind.** Reference Entity — a registered check.

**Identity.** Stable check identity.

**Lifecycle.** Mutable declaration; governed.

**Relationships.** Parent of Integrity Assertion results (E9.08).

**Version behaviour.** Versioned — a changed assertion measures something different.

**Immutability.** Recorded results permanent.

**Context.** Declares its scope.

**Constraints.** LC-168, LC-169.

**Historical behaviour.** Permanent, so degradation is visible as a trend rather than as an event.

**Check classes.** Coverage (does every fixture in the window have the snapshots it should), integrity (does every value reference a registered definition), plausibility (are values within declared ranges), consistency (do sealed artefacts reference entities that still exist), and completeness (which expected inputs were absent).

---

### E9.08 Integrity Assertion Result

**Purpose.** The **recorded outcome** of one quality check execution.

It exists because the previous system had verification logic that printed and exited — valuable logic whose output was not retained, so verification was a manual act rather than a monitorable trend.

**Layer & ownership.** Operations.

**Construct kind.** Entity.

**Identity.** The combination of quality check and execution moment.

**Lifecycle.** Append-only.

**Relationships.** References Quality Check (E9.07) and Pipeline Job Run (E9.02).

**Version behaviour.** Records the check version, so a change in results attributable to a changed assertion is distinguishable from one attributable to changed data.

**Immutability.** Permanent.

**Context.** Records scope.

**Constraints.** LC-168, LC-170.

**Historical behaviour.** Permanent.

**Example.** An integrity assertion degrading over six months is visible as a trend. As a script that printed and exited, it was visible only to whoever happened to run it.

---

### E9.09 Coverage Report

**Purpose.** What the platform **should** have produced against what it **did**: fixtures in window versus fixtures snapshotted, expected snapshot points versus sealed points, modules expected to speak versus modules that spoke.

It exists because **an append-only platform's failures are permanent absences, and absences are silent by nature**. Nothing raises when a snapshot that should exist does not.

**Layer & ownership.** Operations · Derived.

**Construct kind.** Derived View, optionally materialized.

**Identity.** The combination of scope and period.

**Lifecycle.** Derived; disposable.

**Relationships.** Derives from Fixture (E1.13), Match Snapshot (E4.01), Snapshot Point (E4.09), and Snapshot Completeness (E4.07).

**Version behaviour.** Not applicable.

**Immutability.** Not applicable.

**Context.** Reported per competition and per snapshot point.

**Constraints.** LC-171, LC-172.

**Historical behaviour.** Recomputable for any past period, since its inputs are permanent.

**Example.** A competition whose canonical-point coverage fell to seventy per cent last month is detectable. Without coverage reporting the gap surfaces only when a calibration population is smaller than expected, long after the cause is diagnosable.

---

### E9.10 Operational Aggregate

**Purpose.** Summarized operational history retained beyond the detail window.

It exists because operational detail is high-volume and low-value-per-record beyond a recent window, while operational **trends** remain valuable indefinitely.

**Layer & ownership.** Operations.

**Construct kind.** Entity.

**Identity.** The combination of period, aggregate kind, and scope.

**Lifecycle.** Append-only; permanent.

**Relationships.** Derives from every operational entity above, before their detail is thinned.

**Version behaviour.** Not applicable.

**Immutability.** Permanent.

**Context.** Records scope.

**Constraints.** LC-173.

**Historical behaviour.** Permanent — the long-term operational record.

**Example.** Daily aggregates of runs, jobs, writes, failures by class, quota consumption, and coverage are retained indefinitely, while the underlying detail is thinned. Capacity planning and reliability trending survive; the volume does not.

---

## Operational summary

| Entity | Kind | Posture | Retention |
|---|---|---|---|
| E9.01 Pipeline Run | Entity | Append-only | Bounded |
| E9.02 Pipeline Job Run | Entity | Append-only | Bounded; **permanent if sealed-artefact-referenced** |
| E9.03 Write Record | Entity | Append-only | Bounded |
| E9.04 Failure | Entity | Append-only | Longer than successes |
| E9.05 API Usage | Entity | Append-only | Longest — capacity planning |
| E9.06 Freshness | Derived View | Disposable | None |
| E9.07 Quality Check | Reference | Governed | Permanent |
| E9.08 Integrity Assertion Result | Entity | Append-only | Permanent |
| E9.09 Coverage Report | Derived View | Disposable | None — recomputable |
| E9.10 Operational Aggregate | Entity | Append-only | Permanent |

**Telemetry ownership.** Operations owns every entity here and **no entity anywhere else**. Nothing above depends on operational data for its meaning; operational data observes without participating. The one asymmetry is deliberate: a job run referenced by a sealed artefact is retained permanently regardless of retention policy, because a sealed claim that cannot name the execution that produced it is not fully auditable.

---

# 4.11 Relationships

## 4.11.1 The relationship graph

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — FOOTBALL REALITY                                               │
│                                                                          │
│  Country ──< Competition ──< Competition Edition ──< Competition Stage   │
│                                      │                        │          │
│                                      ├──< Team Registration >──┼── Team   │
│                                      ├──< Standing >───────────┼── Team   │
│                                      └──< Fixture >────────────┘          │
│                                             │                             │
│  Venue ─────────────────────────────────────┤                             │
│  Official ──< Official Assignment >─────────┤                             │
│                                             ├──< Result                   │
│                                             ├──< Lineup >──── Team        │
│                                             ├──< Appearance >── Player    │
│                                             └──< Match Event               │
│                                                                           │
│  Player ──┬──< Player Registration >──── Team                             │
│           ├──< Position Profile >──── Position                            │
│           ├──< Player Availability                                        │
│           └──< Player Valuation                                           │
│                                                                           │
│  Provider Statistic Record >── Player | Team, Competition Edition,        │
│                                Statistics Domain                          │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ Feature Source (declared)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — FEATURE ENGINE                                                 │
│                                                                          │
│  Feature Registry ──< Feature Definition ──< Feature Version             │
│                            │      │                                       │
│                            │      ├──< Feature Source ────▶ Layer 1       │
│                            │      └──< Feature Dependency ─┐              │
│                            │                    ▲──────────┘ (acyclic)    │
│                            │                                              │
│                       Feature Calculator (owns definitions)               │
│                            │                                              │
│                            ▼                                              │
│  Feature Value ── identified by ─▶ Definition · Subject Reference ·       │
│       │                            Feature Context · as-of · Version      │
│       ├── qualified by ── Provenance, Sample                              │
│       └──< Feature Lineage >── Feature Value  (value-level, instance)     │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ Module input declaration
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — MODULE ENGINE                                                  │
│                                                                          │
│  Module Registry ──< Module Definition ──< Module Version                │
│                            │                                              │
│                            ▼                                              │
│  Module Reading ── identified by ─▶ Definition · Subject Reference ·      │
│       │                             Feature Context · as-of · Version     │
│       ├── Module Status ─────── (reference vocabulary)                    │
│       ├── Module Headline, Module Verdict ── (value objects)              │
│       ├──< Module Evidence ──< Module Evidence Item ──▶ Feature Value     │
│       └── Module Baseline Reference ──▶ Published Baseline (Calibration)  │
│                            │                                              │
│                     Module Consensus (derived over readings)              │
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ MATCH INTELLIGENCE — sealed                                              │
│                                                                          │
│  Match Snapshot ── identified by ─▶ Fixture · Snapshot Point ·           │
│       │                             Snapshot Version                      │
│       ├── Snapshot Header ──▶ Snapshot Version (manifest)                 │
│       │                   ──▶ Pipeline Job Run (Operations)               │
│       ├──< Snapshot Feature State ──▶ Feature Value        [seals it]     │
│       ├──< Snapshot Module Reading ──▶ Module Reading      [seals it]     │
│       ├── Snapshot Verdict ──▶ Module Consensus, Historical Reliability   │
│       ├──< Snapshot Model Output ──▶ Model Version                        │
│       ├── Snapshot Completeness                                           │
│       └──< Snapshot Outcome Link ──▶ Result, Outcome Dimension  [additive]│
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ CALIBRATION                                                              │
│                                                                          │
│  Measurement Population ──▶ selects over Match Snapshot                  │
│  Calibration Version ──▶ governs methodology                              │
│  Calibration Run ──< Calibration Result ──▶ Calibration Series           │
│       │                     │                    │                        │
│       │                     ├── Confidence Interval (value object)        │
│       │                     └── evaluated against Sample Gate             │
│       │                                                                   │
│  Published Baseline ──▶ promotes a Calibration Result                     │
│  Historical Reliability (derived over series)                             │
│                                                                           │
│  Series identified by ─▶ Module Version · band · Outcome Dimension ·      │
│                          Context · Snapshot Point                         │
└───────────────────────────────┬──────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ LAYER 4 — PRODUCT                                                        │
│                                                                          │
│  Read Model ──< Projection        (declaration → materialization)        │
│  Plan ──< Feature Matrix >── Entitlement Feature ◀── Module Definition    │
│  Plan ──< Subscription >── User                                           │
│  User ──< Watchlist >── (polymorphic: Team | Fixture | Competition)       │
│  User ──< User Preferences ──< Notification Intent                        │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ OPERATIONS — observes all layers, is referenced by none for meaning      │
│                                                                          │
│  Pipeline Run ──< Pipeline Job Run ──┬──< Write Record                   │
│                        │             └──< Failure                        │
│                        └──▶ referenced by Snapshot Header, Calibration Run│
│  API Usage · Freshness · Quality Check ──< Integrity Assertion Result     │
│  Coverage Report · Operational Aggregate                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## 4.11.2 Downward reference only

Every relationship crossing a layer boundary points **downward**, without exception:

| From | To | Nature |
|---|---|---|
| Feature Definition | Layer 1 entities | Declared source (E2.10) |
| Feature Value | Layer 1 entities | Subject reference and context |
| Module Definition | Feature Definition | Declared input |
| Module Evidence Item | Feature Value | Cited evidence |
| Snapshot Feature State | Feature Value | Sealed resolution |
| Snapshot Module Reading | Module Reading | Sealed resolution |
| Read Model | Layers 1–3 | Declared composition |
| Module Definition | Entitlement Feature | Requirement declaration |

**Three relationships appear to cross upward and do not:**

1. **Module Definition → Entitlement Feature.** A module names what entitlement it requires. This is a downward reference to a *governed vocabulary*, not a dependency on product behaviour — the module engine neither reads a subscription nor resolves entitlement.
2. **Calibration → Match Snapshot.** Calibration reads sealed claims. It is a cross-cutting owner outside the layer stack, not a fifth layer, so no boundary is crossed.
3. **Snapshot Header → Pipeline Job Run.** A sealed artefact names its producing execution. Operations observes without participating, and the reference exists solely for auditability — the snapshot's meaning does not depend on it.

**The relationship the model forbids.** A feature referencing a module reading. That would make a calculated quantity depend on a judgement, inverting the layer stack and making the dependency graph cyclic. Where a module's conclusion needs to feed another calculation, the correct expression is a **consensus-class module** (E3.10) reading other readings within Layer 3 — declared explicitly, and never routed through Layer 2.

## 4.11.3 Ownership boundaries

| Boundary | Rule |
|---|---|
| Ingestion ↔ Feature calculation | Ingestion writes only Layer 1; feature calculation writes only Layer 2 |
| Feature ↔ Module | Features hold quantities; modules hold judgement. A module computing its own quantity is a violation |
| Module ↔ Snapshot | Modules produce readings; the snapshot construct seals them. Sealing is not a module's act |
| Calculation ↔ Calibration | Calculation produces claims; calibration measures them. Calibration never writes a claim |
| All ↔ Product | Product reads everything and is authoritative for user choice, entitlement, and configuration only |
| All ↔ Operations | Operations records; it never produces content |

## 4.11.4 The hub entities

Two Layer 1 entities carry a disproportionate share of the graph:

- **Team (E1.06)** — subject of most feature values and team-scoped readings, participant in every fixture, anchor of registrations and standings.
- **Fixture (E1.13)** — subject of fixture-scoped features and readings, anchor of every snapshot, and the unit over which every calibration population is defined.

Their identities are permanent, without exception, because sealed claims reference them indefinitely.

---

# 4.12 Entity Lifecycle

## 4.12.1 The seven lifecycle classes

The classes are not mutually exclusive dimensions but a single classification, ordered from most permissive to most restrictive. Each entity family carries exactly one.

| Class | Definition | Permitted operations |
|---|---|---|
| **Mutable** | Describes a present state; only the latest is meaningful | Create · correct · retire |
| **Temporal** | Append-only *and* as-of identified; "current" is a query | Create only; thin unreferenced |
| **Append-only** | New statements never displace earlier ones; no as-of dimension | Create only |
| **Sealed** | Written once, permanently unmodifiable | Create only; never modify |
| **Derived** | Defined by a rule over other entities; no independent authority | Compute · discard |
| **Disposable** | Derived *and* materialized; droppable with no loss | Materialize · drop · rebuild |
| **Historical** | Retained permanently, exempt from all thinning | Read only |

**Temporal and append-only differ in one respect.** Temporal entities carry an as-of dimension, so the latest value is a *query result*; append-only entities without an as-of dimension are simply accumulating records. Every temporal entity is append-only; not every append-only entity is temporal.

**Derived and disposable differ in materialization.** A derived view has no stored form; a disposable entity is a derived view that has been materialized for performance. Both are authoritative for nothing.

## 4.12.2 Lifecycle by family

| Family | Class | Notes |
|---|---|---|
| Reference vocabularies (Country, Position, Statistics Domain, Module Status, Outcome Dimension, Snapshot Point) | **Mutable**, governed | Meanings may not be redefined in place — sealed claims reference them |
| Competition, Edition, Stage, Venue, Team, Player | **Mutable** | Identities permanent |
| Team Registration, Player Registration, Player Availability | **Mutable → Historical** | Mutable while open; permanent once closed |
| Player Valuation, Standing | **Temporal** | Dated observations, not present-state descriptions |
| Fixture Lifecycle State | **Append-only** | Transition history |
| Fixture, Lineup, Appearance, Match Event, Official Assignment | **Mutable → Sealed** | Seal when the fixture seals |
| Result | **Mutable → Historical** | Revisions observable, never silent |
| Provider Statistic Record | **Mutable** | Providers revise |
| Feature Registry, Definition, Calculator, Source, Dependency | **Mutable**, governed | Declarations evolve under version governance |
| Feature Version, Module Version, Calibration Version | **Sealed** | Sealed on registration |
| **Feature Value** | **Temporal** | The model's central temporal entity |
| Feature Lineage | **Append-only** | Written with its value |
| **Module Reading** | **Temporal → Sealed** | Temporal while the subject is open; sealed when it seals |
| Module Evidence, Evidence Item, Headline, Verdict | **Sealed with reading** | Never independently mutable |
| Module Consensus | **Derived → Sealed** | Disposable until sealed into a snapshot |
| **Match Snapshot** and all its content | **Sealed** | Absolute. No exception |
| Snapshot Outcome Link | **Append-only, then Sealed** | Additive attachment; revision adds, never edits |
| Calibration Run, Result, Population | **Sealed** | Measurements are claims |
| Published Baseline | **Append-only** | Promotions supersede; earlier ones remain resolvable |
| Calibration Series | **Historical** | Permanent, including closed series |
| Sample Gate, Quality Check | **Mutable**, governed, versioned | Evaluations permanent |
| Historical Reliability, Freshness, Coverage Report | **Derived** | Recomputable |
| Read Model | **Mutable** | A versioned contract |
| **Projection** | **Disposable** | The layer's definitional test |
| Plan, Entitlement Feature, Feature Matrix | **Mutable** | Grants effective-dated |
| Subscription | **Mutable → Historical** | Permanent once ended |
| Watchlist, User Preferences | **Mutable** | User-owned; no analytical retention |
| Notification Intent | **Append-only** | A statement about a moment |
| Pipeline Run, Job Run, Write Record, Failure, API Usage | **Append-only**, bounded retention | Exempt from immutability commitments |
| Integrity Assertion Result, Operational Aggregate | **Append-only**, permanent | Trend record |

## 4.12.3 Transition rules

**Mutable → Sealed.** Triggered by Fixture Lifecycle State (E1.14) leaving the open state. Applies to every fixture-scoped entity simultaneously and atomically — partial sealing would leave a fixture half-claimed and half-mutable, which is the inconsistency the architecture identified in the previous system.

**Temporal → Sealed.** A feature value or module reading becomes sealed by being **referenced from a sealed snapshot**, not by any act on itself. Sealing is conferred by reference, which is what makes it impossible to seal an artefact while leaving its inputs thinnable.

**Derived → Sealed.** A derived view materialized into a snapshot ceases to be disposable at the moment of sealing.

**Thinning eligibility.** A temporal entity may be thinned only when **no sealed artefact references it, directly or through lineage**. This is the one rule that makes retention policy safe to apply automatically rather than by inspection.

**Nothing transitions backward.** No sealed entity becomes mutable, no historical entity becomes thinnable, and no authoritative entity becomes derived. The lifecycle is monotonic in one direction, and this is what makes the guarantees in §4.1.7 checkable rather than merely intended.

---

# 4.13 Entity Versioning

## 4.13.1 What each entity owns and inherits

| Entity | Owns | Inherits (by reference) |
|---|---|---|
| Feature Value | Its Feature Version | The feature versions of every value in its lineage |
| Module Reading | Its Module Version | The feature versions of every value its evidence cites |
| Module Consensus | The consensus rule version | Every module version among the readings aggregated |
| Snapshot Model Output | Its Model Version | The feature versions consumed |
| Snapshot Verdict | The verdict composition version | The consensus rule version and, transitively, every module and feature version present |
| Match Snapshot | Its Snapshot Version manifest | Everything above, enumerated |
| Calibration Result | Its Calibration Version | The module version its series measures |
| Published Baseline | — | The calibration version and module version of the result it promotes |
| Read Model | Its read model version | Nothing — a projection is not a claim |

## 4.13.2 Inheritance is reference, never copy

A consuming entity **points at** what it consumed. It does not restate the consumed version as its own attribute.

This distinction is load-bearing rather than stylistic. A copied version designation is a snapshot of a fact at write time, and it goes stale silently — nothing connects it back to the entity it described. A reference resolves to the actual consumed entity, so the chain remains traversable and verifiable indefinitely.

The practical test: given a sealed verdict from two years ago, it must be possible to traverse to every module reading it aggregated, to every feature value each reading cited, to the lineage of each of those values, and to the version registered for each — without any step relying on a restated designation. The model supports this traversal at every hop.

## 4.13.3 The manifest at snapshot level

A snapshot is produced by many rules at once, so a single version designation cannot describe it. Snapshot Version (E4.10) is therefore a **manifest** enumerating the verdict composition version, the consensus rule version, every module version represented, every feature version consumed, and every model version output.

Two snapshots of one fixture at one point under different manifests are **two legitimate parallel claims**. Neither invalidates the other; comparing them is precisely how a rule revision's value is measured.

## 4.13.4 Version transitions

Registering a new version is a governed event, not a deployment side effect. Five rules apply without exception:

1. A new version is **registered** with its effective period, rationale, and predecessor.
2. Existing sealed claims are **never** rewritten to it.
3. It **may** be applied over history as additional claims, marked as reconstruction through the as-of and calculated-at distinction.
4. Calibration series are **keyed by version**, so a new version opens a new series rather than contaminating the old.
5. A version may be **retired** — no longer produced — while its claims and its calibration series persist permanently.

## 4.13.5 Version identity versus implementation identity

Two identities are recorded and they are not the same thing:

| Identity | Answers | Recorded on |
|---|---|---|
| **Formula version** | Which rule ran | The calculated entity |
| **Code revision** | Which build applied it | The pipeline run |

Both are required. A rule may be reimplemented without changing, and an implementation may change behaviour without the rule changing — and when output moves unexpectedly, distinguishing the two is the first diagnostic question. With only one recorded it is unanswerable.

## 4.13.6 What versioning makes possible

| Capability | Mechanism |
|---|---|
| Truthful calibration | Series keyed by module version, so a measured rate describes one rule |
| Retroactive correction | New-version claims alongside originals, so improvement need not destroy |
| Regression detection | Version comparison over one population becomes a query |
| Honest explanation | A historical reading explains itself under the rule that actually produced it |
| Model comparison | Competing models measured at equal versions over equal populations |
| Reproducibility | Version plus lineage makes any historical value replayable |

---

# 4.14 Identity Rules

Business identity, not implementation identity. These rules state **what makes a thing that thing** — the question a physical design must answer, not the answer itself.

## 4.14.1 The five identity kinds

| Kind | Question it answers | Applies to |
|---|---|---|
| **Stable identity** | Which thing is this, across all time? | Reality entities, registry entries |
| **Version identity** | Under which rule was this produced? | Every calculated entity |
| **Temporal identity** | Which moment does this describe? | Every calculated entity |
| **Context identity** | Within which competition scope does this hold? | Every calculated entity |
| **Snapshot identity** | Which sealed claim is this part of? | Every sealed artefact |

## 4.14.2 Stable identity

**Rule.** A reality entity's identity is **independent of every attribute that can change.** A competition renamed is the same competition; a club relocated is the same club; a player transferred is the same player; a venue rebranded is the same venue.

**Why it is stated.** The architecture found competition identity carried by name in the calibration entities, so a sponsor rename severed the accumulated evidence. Identity that depends on a mutable attribute is not identity.

**Permanence.** A stable identity, once established, is **never reassigned**, because sealed claims reference it indefinitely. This is the strictest identity rule in the model.

## 4.14.3 Version identity

**Rule.** A calculated entity's identity **includes the version of the rule that produced it.** Two values of one metric, for one subject, at one moment, under two rules, are **two entities** — not one entity recalculated.

**Why it is stated.** Without it, applying a corrected rule to history has only two possible outcomes: destroy the original, or be forbidden. The architecture identified exactly this dilemma in the previous system, where an immutability guard correctly protected the record and simultaneously made retroactive improvement impossible.

**Registration.** Version identity is drawn from a registered version. An unregistered version designation is not identity; it is free text.

## 4.14.4 Temporal identity

**Rule.** A calculated entity's identity **includes the moment it describes** — the as-of moment, never the calculation moment.

**Why the distinction is stated.** Conflating them makes the entity unable to say what it is about. A value calculated today describing a moment last year is legitimate backfill; recording only the calculation moment makes it indistinguishable from a value about today.

**Consequence.** Two values of one metric, for one subject, at two moments, are two entities. This is the modelling statement of append-only, and the reason team intelligence needs no history mechanism of its own (§4.6).

## 4.14.5 Context identity

**Rule.** A calculated entity's identity **includes its competition scope**, drawn from exactly three kinds: competition-scoped, all-competitions, or cross-competition derived.

**Mandatory.** There is no absent context meaning "global". Absent and unset are indistinguishable, and the whole purpose of the dimension is to separate three things the previous model collapsed into one.

**Validity.** Which context kinds are valid for a metric is **declared**, so a value at an invalid context is detectable rather than silently accepted.

**Why it is stated.** A club competing in two competitions has genuinely different state in each. The previous model held one figure covering both, and no query could recover the distinction because the distinction had never been recorded.

## 4.14.6 Snapshot identity

**Rule.** A sealed claim's identity is **fixture · snapshot point · snapshot version manifest.**

**Why all three.** The fixture says what it is about. The point says when in the fixture's approach — and named, fixed points are what make snapshots comparable across fixtures, which is the basis of every calibration population. The manifest says under which composite rule set, which is what permits a corrected rule set to produce a parallel series without touching the original.

**Content identity.** Every element within a snapshot is identified by the snapshot **plus** the identity of what it materializes. A sealed feature state is identified by snapshot and feature value; a sealed reading by snapshot and module reading. This is what makes each element individually addressable, which reading-level calibration requires.

## 4.14.7 Composite identity

Calculated entities carry composite identity by construction:

```
Feature Value    = Definition · Subject · Context · As-of · Feature Version
Module Reading   = Definition · Subject · Context · As-of · Module Version
Match Snapshot   = Fixture · Snapshot Point · Snapshot Version
Calibration Series = Module Version · Band · Outcome Dimension · Context · Snapshot Point
```

**Every element is load-bearing.** Removing version collapses two rules into one. Removing context collapses a club's competitions. Removing as-of reverts the entity to the destructive per-subject shape the architecture set out to eliminate. Removing subject or definition makes the value meaningless.

## 4.14.8 Identity of derived views

**Derived views have no identity of their own.** They are defined by a rule plus its parameters, and two evaluations of one rule over one parameter set are the same view, not two things.

A materialized projection is identified by its read model and its materialization scope — deliberately, because a projection is a **cache with a name**, and naming it is what allows staleness to be reported against it.

---

# 4.15 Constraints

Logical constraints. Each states a rule the physical design must enforce; none states how.

## Reality integrity (LC-01 – LC-19)

| # | Constraint |
|---|---|
| LC-01 | Every entity has exactly one owning process class, declared in the model |
| LC-02 | A stable identity is never reassigned once established |
| LC-03 | Every reference resolves to an existing entity; a reference to a nonexistent entity is invalid |
| LC-04 | A competition edition belongs to exactly one competition and covers a bounded period |
| LC-05 | A geographic calculation over an entity lacking coordinates yields absence, never a substituted value |
| LC-06 | A team registration references a competition edition and a club that both exist |
| LC-07 | A player's biography holds no computed attribute |
| LC-08 | Player registrations for one player do not overlap for the same registration kind |
| LC-09 | A position reference resolves to the governed position vocabulary |
| LC-10 | A governed vocabulary entry's meaning is never redefined in place; a changed meaning is a new entry |
| LC-11 | Availability is expressed only as spells; no entity holds a duplicate availability flag |
| LC-12 | Every valuation carries a currency and an as-of date |
| LC-13 | A fixture references exactly two distinct clubs in stated home and away roles |
| LC-14 | Provider status is mapped to the platform lifecycle vocabulary; an unmapped value maps to a state that seals |
| LC-15 | An actual lineup is never held by the same entity as a predicted lineup |
| LC-16 | An appearance states exactly one participation state |
| LC-17 | A result revision after confirmation is recorded as a revision; the original is retained |
| LC-18 | A standing carries an as-of date |
| LC-19 | A provider statistic record holds no computed attribute and is identified including its club |

## Registry governance (LC-20 – LC-28)

| # | Constraint |
|---|---|
| LC-20 | A feature value exists only for a registered feature definition |
| LC-21 | A retired feature definition is never removed while values reference it |
| LC-22 | A feature definition declares unit, scale, direction, valid contexts, owner, provenance class, and sample semantics |
| LC-23 | A feature definition's key and meaning are permanently fixed once values exist |
| LC-24 | Feature keys are namespaced by subject type |
| LC-25 | A version is registered before any entity may reference it |
| LC-26 | A registered version's rule is permanently fixed |
| LC-27 | A retired version's entities and calibration series persist permanently |
| LC-28 | Exactly one calculator owns any given feature definition |

## Feature integrity (LC-29 – LC-47)

| # | Constraint |
|---|---|
| LC-29 | A feature value's identity comprises definition, subject, context, as-of, and version |
| LC-30 | A feature value is never updated |
| LC-31 | A feature value is never deleted while a sealed artefact references it, directly or through lineage |
| LC-32 | A feature value's as-of and calculated-at are recorded separately |
| LC-33 | A feature value is written only by the calculator owning its definition |
| LC-34 | A feature value's context is one of the kinds its definition declares valid |
| LC-35 | A subject reference resolves to an entity of the subject type the definition declares |
| LC-36 | Every feature value carries a provenance class |
| LC-37 | A derived value's provenance is no stronger than the weakest input in its lineage |
| LC-38 | Context is mandatory and explicit; no value carries an absent context |
| LC-39 | A competition-scoped context resolves to an existing competition edition |
| LC-40 | Every feature value carries an observation count |
| LC-41 | A value below its declared meaningfulness threshold is recorded and marked, never suppressed |
| LC-42 | A feature declares its Layer 1 sources and its feature dependencies separately |
| LC-43 | Only Layer 2 declares Layer 1 sources |
| LC-44 | The feature dependency graph is acyclic |
| LC-45 | A dependency declares the context mapping between consumer and consumed |
| LC-46 | Every feature value records lineage to every value it consumed |
| LC-47 | Lineage is never removed while the value it describes is retained |

## Module governance (LC-48 – LC-54)

| # | Constraint |
|---|---|
| LC-48 | A module reading exists only for a registered module definition |
| LC-49 | A retired module definition is never removed while readings reference it |
| LC-50 | A module definition's question is permanently fixed once readings exist |
| LC-51 | A module display number is never reused |
| LC-52 | A module declares its feature inputs, its entitlement requirement, and its calibration mode |
| LC-53 | A module version change opens a new calibration series |
| LC-54 | A module reading references a module version registered for its definition |

## Reading and evidence integrity (LC-55 – LC-74)

| # | Constraint |
|---|---|
| LC-55 | A reading's identity comprises definition, subject, context, as-of, and module version |
| LC-56 | A reading consumes only features its definition declares |
| LC-57 | A reading is never updated; a later reading supersedes it |
| LC-58 | A reading is sealed when its subject seals |
| LC-59 | A reading carries a status drawn from the governed vocabulary |
| LC-60 | A reading carries an observation count; it is never optional |
| LC-61 | Every reading has exactly one evidence set |
| LC-62 | An evidence set reports its completeness against the module's declared inputs |
| LC-63 | An evidence item cites a specific feature value, not merely a definition |
| LC-64 | Evidence is relational; it is never expressed as opaque serialized content |
| LC-65 | An evidence item prevents thinning of the value it cites |
| LC-66 | A reading cites a baseline at the same module version as itself |
| LC-67 | A baseline reference records whether the baseline is competition-scoped or pooled |
| LC-68 | A reading whose baseline fails its sample gate is marked unverified |
| LC-69 | Inactive and neutral are distinct statuses and are scored separately |
| LC-70 | Generated prose is held as reading content, never as an attribute of a metric entity |
| LC-71 | No construct expresses a recommended action, stake, or selection |
| LC-72 | Consensus is computed within a single context |
| LC-73 | Consensus retains dissent; it does not reduce readings to a single figure |
| LC-74 | The consensus rule carries its own version |

## Snapshot integrity (LC-75 – LC-104)

| # | Constraint |
|---|---|
| LC-75 | A snapshot's identity comprises fixture, snapshot point, and version manifest |
| LC-76 | A snapshot is sealed on write |
| LC-77 | No snapshot content is modified after sealing, by any process, for any reason |
| LC-78 | A snapshot seals feature state and module readings atomically together |
| LC-79 | No snapshot is created for a fixture whose lifecycle state has left the open state |
| LC-80 | A snapshot prevents thinning of every entity it references |
| LC-81 | A snapshot is never deleted |
| LC-82 | A snapshot header records as-of, sealed-at, and the producing job run |
| LC-83 | Sealed content names the entity it resolves; it is never an unattributed copy |
| LC-84 | Sealed feature state carries each value's version, provenance, sample, and lineage reference |
| LC-85 | Sealed feature state promotes each referenced value to permanent |
| LC-86 | Every sealed reading is individually addressable |
| LC-87 | A sealed reading carries its evidence, status, sample, and baseline reference |
| LC-88 | Exactly one verdict exists per snapshot per verdict composition version |
| LC-89 | A verdict reports evidence count and completeness |
| LC-90 | Verdict confidence derives from sample and completeness, never from edge magnitude |
| LC-91 | A verdict consumes only the canonical model output |
| LC-92 | The verdict composition rule carries its own version |
| LC-93 | Every model output attributes to a named model and version |
| LC-94 | Exactly one model is canonical per output type at any moment |
| LC-95 | Every model output is calibrated, canonical or not |
| LC-96 | Completeness records every declared input that was absent, below threshold, or estimated |
| LC-97 | Absence is recorded as absence; it is never approximated or substituted |
| LC-98 | Outcome linkage is additive and modifies no snapshot content |
| LC-99 | Outcome linkage occurs only after the fixture completes |
| LC-100 | A result revision produces a new outcome link; the original is retained |
| LC-101 | Snapshot points are named, fixed, and identical across fixtures |
| LC-102 | A missing snapshot point is recorded as absent, never approximated |
| LC-103 | A snapshot manifest enumerates every version in force |
| LC-104 | A recalculation under a new manifest creates new snapshots and modifies none |

## Derived state (LC-105 – LC-118)

| # | Constraint |
|---|---|
| LC-105 | A derived view names its rule and its source entities |
| LC-106 | Current state requires a stated context |
| LC-107 | Historical state returns values under the versions in force at the stated moment |
| LC-108 | Competition-scoped state returns only features declaring competition scope valid |
| LC-109 | Cross-competition state returns only features declaring that scope valid |
| LC-110 | A composite view labels the context of every element it presents |
| LC-111 | Statistics are partitioned by domain; no record spans domains |
| LC-112 | Player and club metrics of the same name are separate definitions with separate version lines |
| LC-113 | A fixture-time subject quantity is the subject's feature resolved at that moment, unless genuinely fixture-specific |
| LC-114 | Derived availability quantities consume spells; they never duplicate them |
| LC-115 | A predicted lineup is a Layer 2 artefact and carries a version |
| LC-116 | Formation is stated once per club per predicted lineup |
| LC-117 | Asserted and observed position profiles are separate facts with separate owners |
| LC-118 | Derived valuation quantities consume the dated series and are computable at any past moment |

## Calibration integrity (LC-119 – LC-140)

| # | Constraint |
|---|---|
| LC-119 | A calibration run names its population, its versions, and its executing job run |
| LC-120 | A calibration run is sealed on completion |
| LC-121 | A calibration result belongs to exactly one series |
| LC-122 | A calibration result is sealed on write |
| LC-123 | Results accumulate as a series; a new measurement never replaces an earlier one |
| LC-124 | A published baseline promotes a specific calibration result |
| LC-125 | A published baseline carries the module version of the result it promotes |
| LC-126 | A published baseline failing its sample gate is marked unverified and never presented as a clean rate |
| LC-127 | A published baseline records the measurement provenance of its population |
| LC-128 | A module is measured only against outcome dimensions its definition declares |
| LC-129 | A measurement population is declared, reproducible, and sealed |
| LC-130 | A population declares its completeness threshold |
| LC-131 | Every published rate carries a confidence interval or is marked unverified |
| LC-132 | A pooled observation count does not support a per-band interval |
| LC-133 | Every published rate passes a declared sample gate or is marked unverified |
| LC-134 | Sample gates are versioned and their evaluations recorded |
| LC-135 | A calibration series is keyed by module version |
| LC-136 | A series is never deleted, including closed series for retired versions |
| LC-137 | A series is measured at a stated snapshot point |
| LC-138 | The measurement methodology carries its own version |
| LC-139 | Reliability is reported at a stated module version and never aggregated across versions |
| LC-140 | Reliability reports whether it is competition-scoped or pooled |

## Product integrity (LC-141 – LC-158)

| # | Constraint |
|---|---|
| LC-141 | A read model declares its composition, its sources, and its freshness tolerance |
| LC-142 | A read model is versioned |
| LC-143 | A read model declares the context of every quantity it draws |
| LC-144 | A projection is authoritative for nothing |
| LC-145 | Every projection is droppable and rebuildable with no information loss |
| LC-146 | Plan definitions exist only in the product layer |
| LC-147 | A plan identity is permanent once subscriptions reference it |
| LC-148 | Entitlement keys exist only in the product layer |
| LC-149 | A module declares its entitlement requirement; entitlement does not enumerate modules |
| LC-150 | Entitlement is expressed as a plan-by-feature matrix |
| LC-151 | Grants are effective-dated so historical resolution is possible |
| LC-152 | A user holds at most one live subscription |
| LC-153 | Subscription transitions are recorded as events |
| LC-154 | User-owned entities are written only by the owning user or by an authorized administrator |
| LC-155 | Every polymorphic reference has referential defence against the disappearance of its target |
| LC-156 | Preference is authoritative user data and is never derived |
| LC-157 | A notification intent records the occurrence that triggered it |
| LC-158 | The triggering rule carries its own version |

## Operational integrity (LC-159 – LC-173)

| # | Constraint |
|---|---|
| LC-159 | Every write is attributable to a job run |
| LC-160 | Every pipeline run records its code revision |
| LC-161 | Every job run records the formula versions in force |
| LC-162 | A job run referenced by a sealed artefact is retained permanently, regardless of retention policy |
| LC-163 | Every job run records what it wrote, by target |
| LC-164 | Every failure is classified and retained longer than successes |
| LC-165 | External request consumption is recorded per provider and window |
| LC-166 | Freshness is derivable from declared sources and expected cadence |
| LC-167 | Freshness is reported per context |
| LC-168 | Quality assertions are registered and their results recorded |
| LC-169 | A quality check is versioned |
| LC-170 | An assertion result records the check version that produced it |
| LC-171 | Coverage compares what should have been produced against what was |
| LC-172 | A missing expected artefact is detectable rather than silent |
| LC-173 | Operational aggregates are retained permanently; operational detail is not |

## Cross-cutting

| # | Constraint |
|---|---|
| **LC-A** | **No entity references an entity in a higher layer.** |
| **LC-B** | **No claim is destroyed.** Thinning removes only unreferenced intermediates. |
| **LC-C** | **Every fact has exactly one owner.** Resolutions and projections are not owners. |
| **LC-D** | **Every calculated entity carries version, temporal, and context identity.** |
| **LC-E** | **Every published rate carries its sample, or is marked unverified.** |

---

# 4.16 Summary

## 4.16.1 What the logical model contains

| Family | Entities | Character |
|---|---|---|
| Football Reality | 24 | What happened, as providers reported it |
| Feature Engine | 12 | Every calculated quantity, uniformly expressed |
| Module Engine | 11 | Judgement, evidence, and conclusion |
| Match Intelligence | 10 | Sealed claims about fixtures |
| Team Intelligence | 5 | Derived views — **no stored entities** |
| Player Intelligence | 7 | Ownership assignments across Layers 1 and 2 |
| Calibration | 10 | Measurement of reliability |
| Product | 9 | Serving and selling |
| Operational | 10 | What the platform did |

**Approximately ninety-eight constructs**, of which a substantial number are value objects, identity components, reference vocabularies, and derived views rather than independently stored entities.

The count is close to the previous system's table count, and the resemblance is coincidental and misleading. The previous ninety-two structures were **ninety-two separate designs**, each with its own temporal posture, its own identity rules, and its own implicit relationship to whatever process wrote it. This model has **four postures, five identity kinds, three context kinds, and one versioning discipline**, applied uniformly. Adding a metric adds a registry entry, not a design.

## 4.16.2 How architecture became model

| Architectural commitment | Logical realization |
|---|---|
| Time is a dimension, not a side effect | Temporal identity (§4.14.4) on every calculated entity; as-of separated from calculated-at |
| One owner per metric | Feature Registry and Definition (E2.01, E2.02); resolutions and projections marked, never owners |
| Layers are one-directional | Declared sources and dependencies (E2.10, E2.11); LC-A |
| Claims are immutable | Sealed lifecycle class; snapshots sealed by construction rather than by guard |
| Structure over serialization | Relational evidence (E3.05); relational lineage (E2.12); LC-64 |
| Snapshots at defined points | Match Snapshot with Snapshot Point in its identity (E4.01, E4.09) |
| The Instant Verdict | Snapshot Verdict (E4.05), with no construct for a recommendation |
| Model identity resolves competing predictions | Snapshot Model Output with a canonical designation as data (E4.06) |
| Modules as data | Module Registry, Definition, Version, Reading (E3.01–E3.03) |
| Baselines from calibration, never authored | Published Baseline and Module Baseline Reference (E7.03, E3.06); LC-66, LC-126 |
| Calibration generalized | Every sealed claim measurable; series keyed by module version (E7.08) |
| Operations as first-class | Ten operational entities; LC-159 through LC-173 |
| Competition context first-class | Feature Context (E2.08) in the identity of every calculated entity |

## 4.16.3 Problems dissolved rather than relocated

The clearest evidence that the model is right is where a problem **stops existing** rather than moving somewhere else:

| Previous problem | Resolution |
|---|---|
| One quantity in seven structures | One definition, one owner. Resolutions and projections are marked as such and are not owners |
| Seventeen destructive per-club structures | **No entity at all.** Team intelligence is a view (§4.6) |
| A parallel history structure archiving seven of twenty-six metrics | **No longer needed.** The feature store is the history |
| A compensating point-in-time reconstruction mechanism | **No longer needed.** Standings are temporal; features are temporal |
| Immutability on part of one structure | Sealing is what a snapshot *is*, not a guard applied to it |
| Retroactive correction impossible | Version identity gives a corrected value somewhere to exist |
| Competing predictions with no arbiter | Model identity plus a canonical designation that is data |
| Modules with no persistence | Readings stored, evidence relational, consensus derivable |
| Baselines drifting from measurement | Baselines are references to measurements |
| Inputs and outputs sharing rows | Snapshots seal both, atomically, as one claim |
| Injury state in two places | One representation removed, not synchronized |
| A structure of ~118 attributes, half empty | Domain partition; sparsity ceases to exist |
| One statistics record per player per season | Club in the identity; transfers and dual competitions representable |
| A dependency graph invisible to the model | Declared dependencies; execution order derived |
| "No edge" indistinguishable from "did not run" | Completeness (E4.07), Freshness (E9.06), Coverage (E9.09) |
| Synthetic data indistinguishable from observation | Provenance on every value, propagating along lineage |

## 4.16.4 Why physical design becomes largely mechanical

Physical database design is difficult when the logical model is ambiguous, because each ambiguity must be resolved by a physical decision made without adequate information — and those decisions compound. This model removes the ambiguities that would otherwise force them.

**Every identity question is already answered.** §4.14 states what makes each entity that entity. Physical key selection is a realization of stated business identity, not a design act.

**Every relationship is already stated.** §4.11 gives the complete graph with direction and cardinality. Referential design follows from it.

**Every lifecycle is already classified.** §4.12 assigns one of seven classes to every family. Mutability, retention, and archival strategy follow from the class rather than from per-entity judgement.

**Every versioning rule is already specified.** §4.13 states what each entity owns and inherits, and that inheritance is by reference. Version handling requires no further decisions.

**Every constraint is already enumerated.** §4.15 lists 173 numbered constraints plus five cross-cutting rules. Physical design chooses enforcement mechanisms; it does not discover the rules.

**Volume characteristics follow from the model.** The high-volume families are identified — feature values, module readings, snapshot content, appearances, predicted lineups, provider statistics. Their temporal and context identity supplies natural partitioning dimensions, and the lifecycle classification supplies the retention policy each requires.

**Storage strategy is already governed by a test.** The architecture's four-part test determines which feature groups earn dedicated physical structures. Physical design applies the test; it does not invent criteria.

What remains for Phase 5 is genuine engineering — access paths, storage layout, enforcement placement, partitioning boundaries, retention automation, and performance work. All of it is bounded work against a specification, rather than design under uncertainty.

## 4.16.5 What this model does not decide

Faithfully carried forward from the architecture, unresolved and deliberately so. The model **accommodates** each without presupposing an answer:

| Open decision | How the model accommodates it |
|---|---|
| Which snapshot points, exactly | Snapshot Point is a governed vocabulary; any set works unchanged |
| How many snapshots retained, for how long | Lifecycle classification supports any policy; sealed content is exempt |
| Which prediction model is canonical | The designation is data (E4.06) |
| How many models maintained concurrently | Any number; all calibrated |
| Whether every module supports backtesting | Calibration mode is declared per module (E3.02) |
| Whether the verdict states a direction | A composition choice within E4.05 |
| How much history is in scope | Temporal identity is indifferent to depth |
| Whether reconstructed history informs baselines | Population provenance is recorded (LC-127) |
| Whether notification ships | E8.09 specified; nothing depends on it |
| Feature groups earning dedicated structures | A physical decision under the architecture's test |

Five **blocking prerequisites** from the audit remain outstanding and are restated because Phase 5 cannot begin without them: a complete authoritative schema dump, the definitions of the undefined read-path objects, volume measurements, orphan and integrity validation results, and external quota measurement.

## 4.16.6 The model in one statement

> **Every fact the platform holds is owned by exactly one entity. Every calculated fact carries the moment it describes, the competition scope it holds within, and the version of the rule that produced it. Every claim about a fixture is sealed at a named moment and never modified. Every published rate carries its sample, its interval, and the version it was measured against. And everything the platform did to produce all of it is recorded.**

The previous system proved the intelligence works. This model makes it durable, reproducible, and defensible — which is what a platform selling evidence must be able to say about its own evidence.

---

## Document control

| | |
|---|---|
| **Phase** | 4 — Logical Data Model |
| **Derives from** | Document 06 — V2 Canonical Data Model & Architecture Blueprint |
| **Preceded by** | Documents 01–05 — Phase 1 audit |
| **Followed by** | Phase 5 — Physical Database Design |
| **Status** | Authoritative specification for V2 implementation |
| **Contains** | ~98 logical constructs · 173 numbered constraints · 5 cross-cutting rules |
| **Excludes** | Storage types · keys as implemented · indexes · partitioning · triggers · access rules · interfaces · migrations |
