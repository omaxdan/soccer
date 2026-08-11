# Phase 8 — U-9: Fixture Identity, Partitioning and Rescheduling

**Mandatory integrity gate before any fixture writer is wired.** Investigation and
design report. **No schema change is proposed for immediate application, and
nothing here is implemented.**

| Label | Meaning |
|---|---|
| **SCHEMA VERIFIED** | Read from `v2/migrations/*.sql` in this repository |
| **DESIGN VERIFIED** | Stated in docs 07/08/10, the governing design record |
| **CODE VERIFIED** | Read from `beta/backend/src/v2/` |
| **LIVE VERIFIED** | Observed in a captured provider body under `docs/api-samples/v2-discovery/` |
| **UNKNOWN** | Not established by any of the above |

---

## Verdict

**The schema is already correct. The writer is not.**

U-9 was reported in [doc 38](./38-phase8-s4-provider-contract-final.md) as a
partitioning-key consequence that might require a schema change. It does not.
The physical design anticipated rescheduling explicitly, solved it, and wrote
the solution into three separate places. What is wrong is
`resolveFixture()` (`entities/fixtures.ts:80`), which **recomputes
`fixture_partition_on` from the incoming kickoff on every ingest** and thereby
breaks the one premise the design depends on.

So U-9 is an **application conformance defect against an existing physical
rule** — the same class of finding as doc 14 — not a schema gap. **No migration
is required to fix it.** One is worth adding later as a detective control, for
reasons in §10.

There is also a **second-order finding the design record does not cover**: a
fixture rescheduled *earlier* than its original date violates
`ck_fixture__partition_not_after_kickoff`. See §10.4.

---

## 0. The three things that are constantly confused

The whole of U-9 comes from collapsing three distinct concepts. They are
separated here first, because every answer below depends on the distinction.

| | **Provider external fixture identity** | **Fixture scheduled date** | **`fixture_partition_on`** |
|---|---|---|---|
| **Column(s)** | `provider_code` + `provider_external_id` | `scheduled_kickoff_at` | `fixture_partition_on` |
| **Type** | `text` + `text` | `timestamptz` | `date` |
| **Source** | `event.id` from the provider | `event.startTimestamp` × 1000 | derived from `scheduled_kickoff_at` **once, at creation** |
| **Answers** | *Which real-world match is this?* | *When is it expected to be played?* | *Which physical partition is this row filed in?* |
| **Mutability** | **Permanent.** Never changes for the life of the row | **Mutable** while the fixture is open — rescheduling is normal | **Immutable.** Fixed at creation, never advances |
| **Semantic weight** | The logical identity of the fixture | An attribute *of* the fixture | **None.** A filing location |
| **Enforced by** | *Nothing in the database* — see §2 | `ck_fixture__partition_not_after_kickoff` bounds it below | `ON UPDATE RESTRICT` on every child reference |

The trap is that at creation, and only at creation, all three agree:
`fixture_partition_on = (scheduled_kickoff_at AT TIME ZONE 'UTC')::date`. A
reader who meets the schema for the first time sees a partition date that looks
like the kickoff date and concludes it *is* the kickoff date. It is not. It is
where the row was filed **when it was first seen**, and the design requires it to
stay there afterwards no matter where the match moves to.

**One sentence to carry forward:** a fixture's partition date records *when we
first expected the match*, not *when it will be played*.

---

## 1. What is the canonical logical identity of a provider fixture in V2?

**`(provider_code, provider_external_id)`.** Two columns. Nothing else.

DESIGN VERIFIED — doc 07 §E1.13 (`07-v2-logical-data-model.md:563`):

> **Identity.** Stable, independent of scheduled time. A postponed fixture
> retains its identity when rescheduled — this matters because sealed claims
> made before the postponement reference it, and reassigning identity on
> reschedule would orphan them.

SCHEMA VERIFIED — the table comment on `football.fixture` (`005_fixture.sql`)
restates it in the migration itself:

> Identity is stable across rescheduling, because sealed claims made before a
> postponement reference it and reassigning identity would orphan them.

Three consequences follow, and all three are load-bearing:

1. **`scheduled_kickoff_at` is not part of identity.** Doc 07 lists the fixture's
   lifecycle as "Mutable in its scheduling attributes — time, venue, and stage
   are revised."
2. **`fixture_partition_on` is not part of identity either**, despite appearing
   in the business unique constraint. §2 and §3 explain why it is there.
3. **`football.fixture.id` is a surrogate**, assigned by the database. It is the
   identity *within* V2, and it is the thing that must not change — which is
   another way of saying the same fixture must never acquire a second `id`.

---

## 2. Why is `fixture_partition_on` part of `uq_fixture__provider_external_id`?

**Because PostgreSQL refuses to create the constraint without it.**

SCHEMA VERIFIED, `005_fixture.sql:56`:

```sql
CONSTRAINT uq_fixture__provider_external_id
  UNIQUE (provider_code, provider_external_id, fixture_partition_on),
```

DESIGN VERIFIED, doc 10 §A.1 (`10-v2-physical-database-design-rev1.md:46`):

> PostgreSQL requires that a primary key or unique constraint on a partitioned
> relation include every partition key column.

That is a hard engine restriction, not a modelling choice. `football.fixture` is
`PARTITION BY RANGE (fixture_partition_on)`, so **every** unique constraint on it
must contain that column. The design acknowledges the tension and rules on it
directly — doc 10 **C-02** (`:541`):

> For a partitioned relation, the primary key comprises the surrogate key and
> the partition key, and the business unique constraint includes the partition
> key. **Under PD-05 the partition key is functionally determined by the business
> key, so inclusion does not weaken identity.**

**That last clause is the entire U-9 question.** C-02 permits the partition key
inside the business unique constraint *on the stated condition* that PD-05 holds
— doc 08 §PD-05 (`08-v2-physical-database-design.md:435`):

> Where a relation is partitioned and carries a business unique constraint, the
> partition key must be **functionally determined by the attributes of that
> business key**, and the functional dependency must itself be enforced
> physically.

In plain terms: **for any one `(provider_code, provider_external_id)` there must
be exactly one `fixture_partition_on`, forever.** If that holds, the three-column
constraint and the two-column identity are the same constraint and nothing is
weakened. If it does not hold, the three-column constraint silently stops
enforcing identity — and *that* is U-9.

### The gap PostgreSQL leaves open

PD-05 says the dependency "must itself be enforced physically". For every other
partitioned relation in V2 it is: R-01/R-31 enforce it with a composite foreign
key binding the denormalised partition key to its parent.

**`football.fixture` has no such parent.** It is a hub entity; its partition key
is derived from its own `scheduled_kickoff_at`, not denormalised from anywhere.
There is no composite foreign key to bind, and:

> **A unique constraint on a partitioned table cannot span partitions unless it
> contains the partition key. Therefore PostgreSQL structurally cannot enforce
> uniqueness of `(provider_code, provider_external_id)` across partitions.**

SCHEMA VERIFIED by absence: no constraint, index, trigger or assertion anywhere
in `v2/migrations/` enforces it. `013_indexes.sql` carries four fixture indexes
(`ix_fixture__edition_kickoff`, `__home_team_kickoff`, `__away_team_kickoff`,
`__forward_window__open`) and none is on the provider key.

**So the sole enforcement point for fixture identity is the application.** That
is not a defect to be fixed by a migration — it is a property of range
partitioning, and it is why this gate exists at all. The database will accept the
corruption without complaint.

---

## 3. Is the column there for partitioning, logical identity, or both?

**Present for partitioning. Inert for identity — conditionally.**

| Question | Answer |
|---|---|
| Is it in the constraint because PostgreSQL requires it? | **Yes.** Doc 10 §A.1. Unavoidable. |
| Is it part of the fixture's logical identity? | **No.** Doc 07 §E1.13 — identity is "independent of scheduled time". |
| Does its presence change what the constraint enforces? | **Only if PD-05 is violated.** Under PD-05 it is redundant; without PD-05 it is corrupting. |
| Does it carry independent meaning? | **Yes, but not identity meaning** — it is the row's physical filing location, and it doubles as a historical fact: the date the match was *first* expected. |

The honest formulation is: **the column has one job (partitioning) and one
side effect (it appears in the identity constraint), and the side effect is
harmless exactly as long as the writer treats the column as immutable.**

This is not an accident of implementation. `005_fixture.sql` states the rule in
its own header:

> **Partition key immutability (PR-03).** `fixture_partition_on` is written by
> ingestion at fixture creation as the UTC date of scheduled kickoff, and is
> immutable thereafter. […] A fixture rescheduled across a year boundary retains
> its original partition date, which is correct — earlier snapshots describe a
> fixture as it was expected at the time (E4.09).

**The migration file already tells the writer what to do.** The writer does not
do it.

---

## 4. How should V2 handle a postponed fixture that reappears with a new `startTimestamp`?

**Update the existing row in place. Keep its `id`. Keep its
`fixture_partition_on`. Move only `scheduled_kickoff_at` and the lifecycle
state.** Never insert a second row.

This is not a new decision — it is the decision already recorded, in four places:

**a. The lifecycle vocabulary was written for exactly this.** SCHEMA VERIFIED,
`002_reference_vocabularies.sql:118`:

```
('POSTPONED', 'Postponed', 'Fixture postponed. No further snapshots until rescheduled and reopened.', false),
```

"Until rescheduled and **reopened**". A state can only reopen on a row that still
exists. `POSTPONED` carries `is_open = false`, so the fixture seals; returning it
to `SCHEDULED` (`is_open = true`) makes it snapshotable again — and the
`tr_match_snapshot__lifecycle_guard` trigger (`015_triggers.sql`) reads
`is_open` from **the fixture row**, joined on `(id, fixture_partition_on)`. A
second row would leave the original sealed forever and start the replacement's
snapshot history from nothing.

**b. The CHECK constraint was rewritten to permit it.** SCHEMA VERIFIED,
`005_fixture.sql`, REVISION 2 comment:

> The partition date **equals the original UTC kickoff date at creation and never
> advances**, so it can only precede a later rescheduled kickoff. The previous
> formulation stated this as a disjunction whose first branch was subsumed by the
> second, which read as though equality were being enforced when it was not.

`ck_fixture__partition_not_after_kickoff CHECK (fixture_partition_on <=
(scheduled_kickoff_at AT TIME ZONE 'UTC')::date)` is an inequality **precisely
so that the kickoff can move later while the partition stays put**. Someone
already reasoned this through, found the original formulation ambiguous, and
tightened the comment. Doc 11 §426 records the same finding independently.

**c. The transition history exists to record it.** `fixture_lifecycle_transition`
is append-only and keyed `(fixture_partition_on, fixture_id, transitioned_at)`.
A reschedule produces `SCHEDULED → POSTPONED → SCHEDULED` **on one fixture**,
which doc 07 §E1.14 calls the point of the relation: "A fixture postponed and
replayed has a legible history rather than a final state that conceals it." Two
rows would produce two half-histories, neither legible.

**d. Snapshots taken before the postponement must survive.** DESIGN VERIFIED,
doc 08 (`:803`):

> A fixture rescheduled across a partition boundary retains its original
> partition date; this is correct, because the snapshots describe a fixture as it
> was expected at the time, and Phase 4 E4.09 states that earlier snapshots of a
> rescheduled fixture are retained rather than reinterpreted.

And doc 07 (`:2032`):

> A rescheduled fixture retains its earlier snapshots — those snapshots described
> a fixture expected at a different time, which is itself a fact worth retaining,
> and the fixture's identity is deliberately stable across rescheduling (E1.13)
> so nothing is orphaned.

**A second fixture row orphans every sealed claim made before the
postponement.** Those claims are, in the architecture's own words, "the
platform's primary asset".

---

## 5. Can one logical event safely move from one partition to another?

**No. And it never needs to.**

Three independent reasons it cannot:

1. **PR-03 forbids it outright** (`08-v2-physical-database-design.md:87`):
   > Partitioning on a mutable attribute is prohibited: a row whose partition key
   > changes must be relocated, and **relocation is a delete and an insert**,
   > which contradicts the append-only and sealed lifecycle classes.

2. **Every child reference refuses it.** SCHEMA VERIFIED — all eight
   fixture-scoped relations plus four cross-schema references declare
   `ON UPDATE RESTRICT` on `(fixture_id, fixture_partition_on)`. Once any child
   row exists, `UPDATE football.fixture SET fixture_partition_on = …` raises a
   foreign key violation. `005_fixture.sql` names this as the enforcement
   mechanism: "Immutability is enforced declaratively: every child references it
   with ON UPDATE RESTRICT."

3. **`pt_pipeline_ingestion` holds no `DELETE` on schema `football` at all**
   (CODE VERIFIED, `write/index.ts` header; migration 016). Delete-and-reinsert —
   the obvious workaround — fails as `permission denied`, by design.

**But the premise of the question is the thing to reject.** The row does not need
to move, because the partition is not the kickoff date. A match postponed from
July 2026 to March 2027 stays filed in `fixture_p2026`, carries
`scheduled_kickoff_at = 2027-03-xx`, and every child stays with it. That is not a
compromise; doc 08 calls it "correct".

The only genuine cost is a **partition-pruning miss**: a query filtering on
`scheduled_kickoff_at` for March 2027 will not prune to `fixture_p2027`, because
the rescheduled row lives in `fixture_p2026`. This is a performance
characteristic, not a correctness one, and it affects only the small population
of cross-year reschedules. It is worth knowing before someone reports it as a
bug.

---

## 6. What happens to dependent rows if the scheduled date changes?

**Nothing. That is the entire point of the design.**

Every dependent keys on `(fixture_id, fixture_partition_on)`. Neither column
changes when `scheduled_kickoff_at` moves, so no dependent is touched, revalidated
or relocated.

### Full dependent inventory — SCHEMA VERIFIED

**Co-partitioned within `football` (`005_fixture.sql`), all
`FK (fixture_id, fixture_partition_on) … ON UPDATE RESTRICT`:**

| Relation | Keyed on | Lifecycle class |
|---|---|---|
| `fixture_lifecycle_transition` | `(fixture_partition_on, fixture_id, transitioned_at)` | append-only |
| `result` | `(fixture_partition_on, fixture_id)` | mutable |
| `result_revision` | → `result`, `(fixture_partition_on, result_id, revision_ordinal)` | append-only |
| `official_assignment` | `(fixture_partition_on, fixture_id, official_id, role_code)` | mutable |
| `lineup` | `(fixture_partition_on, fixture_id, team_id)` | mutable |
| `lineup_selection` | → `lineup`, `(fixture_partition_on, lineup_id, player_id)` | mutable |
| `appearance` | `(fixture_partition_on, fixture_id, player_id)` | mutable |
| `match_event` | `(fixture_partition_on, fixture_id, event_sequence)` | append-only |

**Cross-schema references to `football.fixture (id, fixture_partition_on)`:**

| Relation | Column pair | Note |
|---|---|---|
| `feature.feature_value` | `subject_fixture_id`, `subject_fixture_partition_on` | `007:109` |
| `module.module_reading` | `subject_fixture_id`, `subject_fixture_partition_on` | `008:159` |
| `snapshot.match_snapshot` | `fixture_id`, `fixture_partition_on` | `010:69` — **and `match_snapshot` is itself partitioned on the fixture's partition date**, so five further snapshot relations inherit it |
| `product.watchlist` | `fixture_id`, `fixture_partition_on` | `011:125` |

Transitively via `snapshot.match_snapshot`: `snapshot_version_component`,
`snapshot_feature_state`, `snapshot_module_reading`, `snapshot_model_output`,
`snapshot_completeness_item`, `snapshot_verdict`, `snapshot_outcome_link`.
`product.notification_intent` reaches the fixture through
`triggering_snapshot_id` + `triggering_fixture_partition_on` (`011:177`).

**Roughly twenty relations across five schemas** hang off that column pair.

### The two failure modes, precisely

| Writer behaviour | Result |
|---|---|
| Partition **held** (correct) | Kickoff updates in place. All ~20 dependents unaffected. Snapshots taken before the postponement remain attached and remain valid history. |
| Partition **updated** | `ON UPDATE RESTRICT` raises a foreign key violation the moment any child exists. **Loud, immediate, safe.** |
| Partition **recomputed and used as a conflict target** (current writer) | `ON CONFLICT` misses. **A second fixture row is inserted.** Silent. This is U-9. |

The third is the dangerous one because the database has no way to object: as
established in §2, it cannot enforce uniqueness of the provider key across
partitions. The two rows are individually valid.

Downstream, the split is worse than a duplicate. Results, appearances and
snapshots accumulate against whichever row the writer resolved *that day*. Any
feature reading fixture history (`feature/read/fixtures.ts`) sees two fixtures
between the same teams; congestion and fatigue calculations count the match
twice; calibration measures claims against a fixture whose result landed on the
other row.

---

## 7. Does the provider keep the same `event.id` when a postponed match is replayed?

**UNKNOWN.** No captured body answers it. Here is all the evidence that bears on
it, and why the answer does not change the recommendation.

### What the evidence shows — LIVE VERIFIED

**The four postponed fixtures have no replay in any captured page.** All four sit
on `events/last/0`, all round 21, all stamped `2026-07-30T18:00:00Z`:

| `event.id` | Home | Away | `customId` |
|---|---|---|---|
| 15235414 | Atlético Mineiro | Red Bull Bragantino | `COsZO` |
| 15235440 | Chapecoense | Vasco da Gama | `zOsVLi` |
| 15235419 | Botafogo | Grêmio | `iOsBtc` |
| 15235423 | São Paulo | Santos | `tOsGO` |

Searching all 120 captured events: **none of these four ids appears elsewhere,
and none of these four team pairs appears elsewhere.** `events/next/0` contains
no round-21 fixture at all. At capture time the provider had not yet published a
replacement date, in either feed, in any form. **The reschedule had not happened
yet** — which is why the postponed entries still carry their abandoned kickoff.

### The suggestive signal — LIVE VERIFIED, inconclusive

Of the 120 captured events, **118 carry ids in a contiguous block
15 235 403 – 15 237 985. Exactly two sit far outside it: 16 390 770 and
16 390 771** — a gap of ~1.15 million. Both are **round 4** fixtures **played in
July**, months after round 4 was due:

| `event.id` | Round | Played | Fixture |
|---|---|---|---|
| 16390771 | 4 | 2026-07-17 | Bahia v Chapecoense |
| 16390770 | 4 | 2026-07-23 | Botafogo v Vitória |

If provider ids are allocated roughly in creation order — which the tight
118-event season block strongly suggests — then these two events were **created
much later than the rest of the season**. That is consistent with:

- **Reading A:** they are *replays* of round-4 fixtures postponed earlier, and
  the provider **minted new event ids** for them. The originals would still exist
  on a deeper `last` page, status 60, at their March timestamps.
- **Reading B:** they were simply scheduled late — a round-4 slot left vacant for
  a cup commitment and filled in when a date was agreed. No replay, no second id.

**The evidence cannot separate these**, and no repeated ordered team pair exists
anywhere in the 120 events to break the tie.

### Why this does not block the recommendation

The two readings imply different provider behaviour but **the same correct writer
behaviour**:

| | Reading A — new id on replay | Reading B / same id reused |
|---|---|---|
| What ingestion sees | A *new* `event.id`, never seen | A *known* `event.id` with a later `startTimestamp` |
| Resolve-then-upsert (§8) does | Finds no existing row → inserts a new fixture in its own partition. **Correct** | Finds the existing row → reuses its partition, updates the kickoff. **Correct** |
| Residual issue | Two fixture rows for one real-world match — but with *different provider identities*, which is the provider's model, not a V2 corruption. The original stays `POSTPONED` and correctly seals | None |

**The recommended strategy is invariant to the answer.** It is therefore *not*
an evidence gap requiring a provider call, and I have not made one.

If confirmation is wanted later, the cheapest decisive experiment is **one call**
to `tournament_team_events`
(`/tournament/325/season/87678/team-events`, already registered), which the
registry describes as returning all events for a season in a single response. A
postponed round-4 entry for Bahia–Chapecoense in the 15.23M block alongside
16390771 would settle it as Reading A. **Not recommended now** — it buys
confirmation, not a decision.

Under Reading A there is a downstream consequence worth recording so it is not
discovered later: **a match that is postponed and replayed under a new provider
id produces two V2 fixtures, one `POSTPONED` and one `COMPLETED`.** Any
population count over fixtures (congestion, matches-played, calibration
denominators) must filter on lifecycle state rather than counting rows. That is
correct behaviour for the identity model — the platform genuinely observed two
provider fixtures — but it is a filtering obligation on every consumer, and it
is currently written down nowhere.

---

## 8. Exact reconciliation / upsert strategy for fixture ingestion

### What the current writer does — CODE VERIFIED

`entities/fixtures.ts:80`:

```ts
const partitionOn = fixturePartitionOn(fixture.scheduledKickoffAt);   // ← recomputed every ingest
…
conflictTarget: ['provider_code', 'provider_external_id', 'fixture_partition_on'],
immutableColumns: ['fixture_partition_on'],
```

`immutableColumns` protects the column **in the UPDATE branch** — but the UPDATE
branch is never reached, because the conflict target itself carries the new
partition date and matches nothing. The guard is real and correctly placed; it
simply guards a door the writer walks past.

`currentLifecycleState()` (`:93`) has the same defect and produces a second
symptom: it filters on the recomputed `partitionOn`, finds nothing, returns
`null`, and writes a spurious `null → SCHEDULED` creation transition for a
fixture that has existed for months.

### Recommended strategy — RESOLVE, then UPSERT

Four steps. Applies to every fixture write, not only rescheduled ones.

**1. Resolve the established partition by logical identity alone.**

```sql
SELECT id, fixture_partition_on
  FROM football.fixture
 WHERE provider_code = $1 AND provider_external_id = $2
```

No partition predicate. PostgreSQL scans all 22 partitions, each using the local
index behind `uq_fixture__provider_external_id`, whose leading columns are
exactly these two. 22 index probes per fixture.

**2. Choose the partition date.**

| Outcome | `fixture_partition_on` used |
|---|---|
| Exactly one row | **the stored value** — never recomputed |
| No row | derived from `scheduled_kickoff_at`, in UTC, as today |
| More than one row | **abort loudly.** This is the corruption itself. It must never be papered over by picking one |

**3. Upsert with the chosen partition in the conflict target.** Unchanged
otherwise. `immutableColumns: ['fixture_partition_on']` stays — it is now a
genuine second line of defence rather than an unreachable one.

**4. Read the previous lifecycle state using the same chosen partition**, so the
transition history stays continuous across a reschedule.

### Why this shape and not the alternatives

| Alternative | Why rejected |
|---|---|
| Add `fixture_partition_on` to a lookup and hope | Doesn't address it — the lookup is the fix |
| Include `scheduled_kickoff_at` in identity | Contradicts doc 07 §E1.13 directly. Every reschedule becomes a new fixture |
| Update the partition to follow the kickoff | Forbidden three ways (§5) |
| Delete and reinsert | `pt_pipeline_ingestion` holds no `DELETE` on `football` |
| Enforce it with a database constraint | **Impossible.** §2 |
| Partition on something immutable instead (e.g. `season_id`) | A schema redesign of ~20 relations across 5 schemas to solve a writer bug |

### Cost, stated honestly

One extra `SELECT` per fixture, across 22 partitions. For a sweep of ~56
competitions × ~40 fixtures each ≈ 2 240 lookups ≈ 49 000 index probes per full
run. Cheap in absolute terms and it runs inside the ingestion transaction. **It
is not free, and no measurement of it exists yet** — if it proves material, the
mitigation is a per-response cache (the schedule stage already caches
competitions, editions, venues and teams per response for exactly this reason),
not the removal of the lookup.

---

## 9. Everything the identity model touches

### Constraints — SCHEMA VERIFIED

| Object | File | Bearing on U-9 |
|---|---|---|
| `pk_fixture (id, fixture_partition_on)` | `005:55` | C-02. The surrogate identity that must not be duplicated |
| `uq_fixture__provider_external_id (provider_code, provider_external_id, fixture_partition_on)` | `005:56` | **The centre of U-9.** Enforces identity only while PD-05 holds |
| `ck_fixture__partition_not_after_kickoff` | `005` | Permits the kickoff to move later. **Refuses it moving earlier** — see §10.4 |
| `ck_fixture__participants_distinct` | `005` | Unaffected |
| `uq_result__fixture`, `uq_appearance__fixture_player`, `uq_lineup__fixture_team`, `uq_match_event__fixture_sequence`, `uq_official_assignment__…`, `uq_fixture_lifecycle_transition__fixture_at` | `005` | All scoped by `fixture_partition_on`. All silently split across a duplicate fixture |
| `uq_match_snapshot__fixture_point_versions` | `010:57` | Same, for sealed claims |

### Foreign keys

**12 direct**: 8 co-partitioned within `football` (`005`) and 4 cross-schema
(`007:109`, `008:159`, `010:69`, `011:125`). Every one is composite on
`(fixture_id, fixture_partition_on)` with `ON UPDATE RESTRICT`.

**8 transitive paths** reach the fixture through `snapshot.match_snapshot` —
seven snapshot relations plus `product.notification_intent`. Full table in §6.

### Indexes — `013_indexes.sql`

`ix_fixture__edition_kickoff`, `ix_fixture__home_team_kickoff`,
`ix_fixture__away_team_kickoff`, `ix_fixture__forward_window__open` — **all four
are on `scheduled_kickoff_at`, none on the provider key.** The resolve lookup of
§8 relies on the local indexes behind `uq_fixture__provider_external_id`.

### Partitioning

`PARTITION BY RANGE (fixture_partition_on)`, yearly, 2015–2035, plus
`fixture_pdefault`. Eight `football` relations and the whole `snapshot` family
are co-partitioned on identical boundaries — `005` creates them in one operation
precisely to permit partition-wise joins (§5.11.6). A non-empty default partition
is a **HIGH** quality assertion (`018:536`).

### Triggers — `015_triggers.sql`

| Trigger | Bearing |
|---|---|
| `tr_match_snapshot__lifecycle_guard` | Reads `is_open` via `(fixture_id, fixture_partition_on)`. A duplicate fixture leaves the original sealed and reopens sealing on the replacement |
| `tr_fixture_lifecycle_transition__append_guard` | Refuses UPDATE/DELETE. History cannot be repaired after the fact |
| `tr_fixture__watchlist_defence` | `BEFORE DELETE` only. Never fires here |

### Writers and readers — CODE VERIFIED

| Location | Bearing |
|---|---|
| `entities/fixtures.ts:80` `resolveFixture` | **The defect.** The only place a fixture is written |
| `entities/fixtures.ts:93` `currentLifecycleState` | Same defect, second symptom |
| `entities/fixtures.ts:213` `recordResult` | Correct — takes `FixtureRef`, writes no partition of its own |
| `normalise.ts:59` `fixturePartitionOn` | Correct as written. Its doc comment already says "DERIVED ONCE, AT CREATION, AND NEVER RECOMPUTED". **The caller ignores it** |
| `write/index.ts:212` `findByProviderId` | The right primitive, wrong shape — returns `id` only, so it cannot serve a partitioned relation |
| `stages/schedule.ts` | Passes kickoff through; unaffected |
| `provider/pager.ts` | Unaffected. It reports `startTimestamp` as sent and writes nothing |
| `feature/read/fixtures.ts` | Reader. Orders by `scheduled_kickoff_at`, correctly. Would silently see two fixtures if the corruption occurs |

### Test coverage — CODE VERIFIED

Test 52 (`ingestion.test.ts:765`) postpones a fixture **without moving its
kickoff**, so the partition never changes and the defect is not exercised. Test
30 pins UTC derivation only. **No test covers a reschedule that crosses a date
boundary.** That is the coverage gap, and it is why the defect survived review.

---

## 10. Smallest correct change

### 10.1 Required — application only, **no migration**

Change `resolveFixture()` to resolve-then-upsert per §8, and extend
`findByProviderId` (or add a partition-aware sibling) to return
`(id, fixture_partition_on)`.

**Blast radius:** one function, one helper, no schema, no migration, no data
change, nothing in V1. It brings the writer into conformance with a rule the
migrations, doc 07, doc 08 and doc 10 already state.

**Not implemented, per the gate.** Recommended for whenever the fixture writer is
authorised — the fix must land *with* the writer, not after it.

### 10.2 Required — tests

- A fixture ingested, postponed, then re-ingested with a kickoff in a **different
  year**: one row, `id` unchanged, `fixture_partition_on` unchanged,
  `scheduled_kickoff_at` advanced, transitions `null → SCHEDULED → POSTPONED →
  SCHEDULED` on one fixture.
- Its `result`/`appearance` rows remain reachable on the original partition.
- Two rows sharing `(provider_code, provider_external_id)` across partitions →
  the writer aborts rather than choosing.

### 10.3 Recommended, deferred — a detective control

Because PostgreSQL structurally cannot enforce the invariant (§2), and because
the application is the only enforcement point, the invariant should be
**measured**. `018_maintenance.sql` already carries a quality-assertion registry
with exactly this purpose (`:536`, "No range-partitioned relation has rows in its
default partition", HIGH, hourly).

The analogous assertion:

> Every `(provider_code, provider_external_id)` in `football.fixture` resolves to
> exactly one row.

This is a **new migration** and is **not authorised**. Recommended as a follow-up
once the writer lands — it turns an invariant that currently has no guardian into
one that reports itself. It should not gate the writer, because the writer fix is
the preventive control and this is only the detective one.

### 10.4 New finding — a fixture moved *earlier* breaks the CHECK

`ck_fixture__partition_not_after_kickoff` requires
`fixture_partition_on <= (scheduled_kickoff_at AT TIME ZONE 'UTC')::date`, and
CHECK constraints are evaluated on UPDATE as well as INSERT.

The design record justifies the inequality entirely in terms of fixtures moving
**later** — doc 08, doc 11 §426 and the REVISION 2 comment all reason about
postponement. **Nothing addresses a fixture brought forward.** A match moved from
Saturday to the preceding Friday — routine for broadcast scheduling — has a new
kickoff date *earlier* than its immutable partition date, and the UPDATE is
rejected:

```
new row for relation "fixture_p2026" violates check constraint
"ck_fixture__partition_not_after_kickoff"
```

Assessment:

- **It fails loudly and safely.** No corruption; the constraint is doing its job.
- It aborts the ingestion transaction, so one brought-forward fixture costs the
  whole page.
- The population is small but not zero, and it will occur in a full 56-competition
  sweep sooner or later.

**No change recommended now**, and specifically **no weakening of the check** —
that would be trading a loud failure for a silent one. The options, for a later
decision: catch the SQLSTATE `23514` on this constraint, count it as a rejection
with a stated reason, and continue the page; or accept the abort and treat it as
an operational condition. The first is preferable and is a writer concern, not a
schema one. **Recorded here as U-10.**

### 10.5 Rejected

| Option | Why |
|---|---|
| Change the unique constraint | Cannot — PostgreSQL requires the partition key (§2) |
| Repartition `football.fixture` | ~20 relations across 5 schemas, to fix a writer bug |
| Add `provider_external_id` to the PK | Doesn't help; still needs the partition key |
| Add an unpartitioned identity/lookup table | A second identity for the hub entity, a new FK on every write, and a new way to disagree with itself |
| Add an index on `(provider_code, provider_external_id)` | The unique constraint's local indexes already lead with these columns. Redundant until measured otherwise |
| Weaken `ck_fixture__partition_not_after_kickoff` | §10.4 |

---

## Separately flagged — the forward window (unchanged, no action taken)

The specified ingestion window is **31 May → 11 August 2026**. `events/next/0`
for the observed competition begins **15 August 2026**. The forward half of the
fixture universe therefore lies entirely outside the window, and the pager
correctly terminates on its first forward page having carried nothing.

**This is the contract behaving correctly, not a defect**, and no change has been
made. It is flagged because it exposes an unmade product decision: PitchTerminal
is a *pre-match* intelligence platform, and a window with no forward horizon
gives it nothing to be pre-match about. The historical window and the
future-fixture horizon are two different parameters serving two different
purposes — one bounds how far back baselines are computed, the other bounds how
far ahead fixtures are known — and the current configuration collapses them into
one. `pager.ts` already takes the window as a parameter with the specified value
as its default, so whichever way this is decided, it is a configuration change
and not a code change.

**Recorded for separate decision. Not part of U-9.**

---

## Summary

| # | Question | Answer |
|---|---|---|
| 1 | Canonical logical identity | `(provider_code, provider_external_id)`. Nothing else |
| 2 | Why is the partition key in the unique constraint | PostgreSQL requires it. C-02 permits it only because PD-05 is assumed to hold |
| 3 | Partitioning, identity, or both | **Partitioning.** Identity-inert while the writer keeps it immutable |
| 4 | Handling a reschedule | Update in place. Same `id`, same partition, new kickoff, lifecycle reopens |
| 5 | Can an event change partition | **No** — forbidden three ways, and it never needs to |
| 6 | Effect on dependents | **None**, if the partition holds. ~20 relations across 5 schemas depend on that |
| 7 | Same `event.id` on replay | **UNKNOWN.** Suggestive evidence for new-id-on-replay. **Recommendation is invariant to the answer** |
| 8 | Upsert strategy | Resolve by provider key across partitions → reuse the stored partition → upsert → abort on multiple |
| 9 | Affected surface | 6 constraints · 12 direct FKs + 8 transitive paths · 4 indexes · 3 triggers · 2 writer functions · 1 test gap |
| 10 | Smallest correct change | **A writer fix. No migration.** Plus tests, a deferred quality assertion, and U-10 |

**U-9 is real, is not a schema defect, and requires no migration.** The physical
design solved rescheduling before the writer existed; the writer never
implemented the solution. The database cannot catch this class of error on its
own, which is the reason the gate was worth holding.

**Awaiting approval before implementing anything in §10.**
