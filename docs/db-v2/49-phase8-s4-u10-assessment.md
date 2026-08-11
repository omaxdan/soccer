# Phase 8 S-4 — U-10: assessment and governance decision

**U-10: SPECIFIED — decision recommended, not taken. Containment is decidable
now; the representation question is not, and the missing evidence is named.**

No code changed. No schema changed. No migration written. Nothing implemented.

---

## 0. Three corrections to the existing record, first

Every prior statement of U-10 — [doc 39](./39-phase8-u9-fixture-identity-investigation.md)
§10.4, [doc 45](./45-phase8-s6-operational-closure.md), [doc 47](./47-phase8-s4-remaining-items.md)
§4 — says the failure "aborts the page" and that the fix is to "catch `23514`
on that constraint, count it as a stated rejection, and continue". **Both halves
are now wrong**, and the second was never implementable as written.

### 0.1 It does not cost a page. It costs the season.

Docs 39 and 45 were written when the only fixture writer was the per-date
schedule path, one transaction per date. Since **B-1** the season sweep is the
production path, and `pipeline.ts` is explicit:

```ts
// ── Write. One transaction for the whole season. ───────────────────────
const stageCounts = await withRun(INGESTION_ROLE, 'ingest.season', async (tx, job) => {
  const written = await ingestEvents(tx, selected.map((event) => event.raw), { … });
```

One brought-forward fixture therefore rolls back **every fixture, team, venue,
competition, edition, stage, result, lifecycle transition and standing of that
season** — 47 fixtures and ~20 clubs for the proven competition, not one page of
them. The provider calls are still charged: usage is flushed in `finally`,
outside the rolled-back transaction. So the cost of one bad row today is a whole
season's write, at full quota price.

### 0.2 "Catch the SQLSTATE and continue" cannot work

By the time `23514` is raised, PostgreSQL has already aborted the transaction.
`ingestEvents` says so, and acts on it:

```ts
} catch (error) {
  // A statement that DID fail rethrows below, because the transaction is then
  // poisoned and continuing would fail every subsequent statement with
  // "current transaction is aborted".
  if (isPostgresError(error)) throw error;
```

Catching `23514` and continuing requires a **SAVEPOINT** around each event —
`withSavepoint` exists, and its own comment warns that "a savepoint per row is a
well-known way to make a bulk load slow". The recorded remedy carries a cost the
record never priced. **§4 option F avoids it entirely**, and that is the core of
this assessment.

### 0.3 U-10 is two provider events, not one

The record describes only a fixture *brought forward*. The constraint is reached
by two materially different conditions:

| | Condition | Reachable today |
|---|---|---|
| **U-10a** | A **future** fixture rescheduled to an earlier UTC date | **No** — the forward window selects zero forward fixtures |
| **U-10b** | A **past** kickoff **restated** earlier by the provider — a data correction | **Yes**, from `events/last`, in the window already proven |

`fixtureReplay.test.ts` test 21 mutates a **COMPLETED** fixture earlier, so the
test suite has been exercising U-10b all along while the prose described U-10a.
This matters for §6: U-10a is gated behind the forward-window decision; **U-10b
is not gated behind anything.**

---

## 1. What exactly is U-10?

`football.fixture` carries

```sql
CONSTRAINT ck_fixture__partition_not_after_kickoff
  CHECK (fixture_partition_on <= (scheduled_kickoff_at AT TIME ZONE 'UTC')::date)
```

`fixture_partition_on` is derived from the kickoff **at creation and never
recomputed** — that is U-9's fix, and it is enforced three ways (the writer's
`partitionForWrite`, `immutableColumns` in the upsert, and `ON UPDATE RESTRICT`
on every child reference). A fixture moved **later** satisfies the check
trivially. A fixture moved to an **earlier UTC date** cannot: its immutable
partition is now after its kickoff, and CHECK constraints are evaluated on
UPDATE.

**The unresolved behaviour, stated precisely:**

> When the provider reports a kickoff whose UTC date precedes a fixture's
> immutable `fixture_partition_on`, the platform cannot store both the truth
> about *when the match is* and the truth about *which partition the fixture has
> always lived in*. **Which of the two it should sacrifice, and how loudly, has
> never been decided.**

Two bounds worth stating because they size the population:

- **Intra-day moves are already legal.** A kickoff moved from 20:00 to 14:00 on
  the same UTC date leaves the date unchanged and the check satisfied. Only a
  move across a UTC date boundary, backwards, reaches U-10.
- **New fixtures can never reach it.** The partition is derived from the same
  kickoff being written.

## 2. What does the system do today?

**It fails, loudly, by name, and rolls back the season.** This is deliberate and
documented in three places, and two tests hold the posture.

`entities/fixtures.ts`:

> U-10, and it is NOT handled here. […] Catching it would mean either advancing
> the partition — the corruption this function exists to prevent — or swallowing
> a scheduling change the platform would then be wrong about. A loud abort is the
> correct posture until U-10 is decided on its own terms.

Evidence, verified in this pass:

| Source | What it establishes |
|---|---|
| `005_fixture.sql:71` | the constraint exists and is `<=` |
| `fixtureIdentity.test.ts` test 23 | an earlier reschedule raises `23514` naming `ck_fixture__partition_not_after_kickoff` |
| `fixtureIdentity.test.ts` test 24 | the constraint definition still reads `fixture_partition_on <=` — a tripwire against "fixing" U-10 by weakening it |
| `fixtureReplay.test.ts` test 21 | the same, against the **real captured payload** with a COMPLETED fixture moved earlier |
| `stages/schedule.ts:214-227` | a PostgreSQL error is rethrown, not absorbed — the transaction is poisoned |
| `pipeline.ts:545` | the season is one transaction |
| `pipeline.ts` `finally` | quota is flushed regardless, so the calls are still spent |

**No occurrence has ever been observed.** Runs 50–53 covered one completed
season; a completed season cannot produce U-10a, and U-10b did not arise.
Observed frequency is therefore **zero out of one season**, which is not evidence
of rarity — it is absence of evidence.

## 3. Plausible interpretations

Six behaviours could reasonably satisfy the architecture. They differ in *which
truth is sacrificed*.

| | Option | What it sacrifices |
|---|---|---|
| **A** | **Abort** — status quo | the whole season's write, per bad row |
| **B** | **Savepoint + stated rejection**, continue the season | the fixture's kickoff (stays stale); costs a savepoint per event |
| **C** | **Pre-emptive refusal** — the writer detects the condition before issuing the statement | the fixture's kickoff (stays stale); costs nothing |
| **D** | **Partial update** — write everything except the kickoff | coherence: the row would claim a state at a time known to be wrong |
| **E** | **Move the partition** — new partition, new row, or re-parent | fixture identity (LC-02) and ~20 dependent relations |
| **F** | **Redefine the column** — drop the check; `fixture_partition_on` becomes a pure creation bucket | the `partition ≤ kickoff` invariant, and one direction of partition prunability |

**E is not viable and is not analysed further.** It is precisely the corruption
U-9 exists to prevent: every child reference holds `ON UPDATE RESTRICT` on
`(fixture_id, fixture_partition_on)`, sealed snapshots reference the pair, and
LC-02 forbids reassigning an established identity. Doc 39 §10.5 already rejected
it on those grounds and nothing here disturbs that.

**C is new to this assessment and is not in any prior record.** It is available
because of U-9: `resolveFixture` **already reads the stored row**, and
`findFixtureByProviderIdentity` **already returns `partitionOn`**. The writer
therefore knows, before it issues any statement, whether the incoming kickoff's
UTC date precedes the stored partition. Refusing there is a pure comparison of
two values it is already holding — no savepoint, no poisoned transaction, no
extra round trip, and the CHECK remains untouched as the backstop for anything
the writer misses.

## 4. Consequences

| | **A** abort | **B** savepoint | **C** pre-emptive | **D** partial | **F** redefine |
|---|---|---|---|---|---|
| **Schema** | none | none | none | none | **drop a CHECK** |
| **Migration** | none | none | **none** | none | **yes** |
| **Ingestion** | none | savepoint per event | one comparison in `resolveFixture` | as C, plus a column-set split | none in the writer |
| **Write semantics** | all-or-nothing per season | per-event atomicity | fixture skipped, everything else written | fixture written with a knowingly stale kickoff | truth stored; partition ≠ fixture date |
| **Feature impact** | none while it never fires; total when it does | stale kickoff for one fixture | same as B | **worse than B** — a COMPLETED state at a wrong instant feeds form and rest-days | none; reads filter on `scheduled_kickoff_at` |
| **Replay / idempotency** | a failing season never commits, so replay is clean | the rejection is deterministic and repeats identically | same | same | fully idempotent |
| **Telemetry** | `operations.failure`, `DATA_QUALITY`, whole run failed | `rows_rejected` on `football.fixture` | same as B | same as B | nothing to report |
| **Cost** | one season per bad row | savepoint per event, on every event forever | **zero** | zero | one migration |

Three points the table cannot carry:

**Downstream reads do not depend on the invariant.** Verified, not assumed:
`feature/read/fixtures.ts` filters on `f.scheduled_kickoff_at` and carries
`fixture_partition_on` only to join `football.result`; `operations.v_coverage`
groups on `date_trunc('month', f.scheduled_kickoff_at)`; no index or view treats
the partition date as the fixture date. So **F breaks no current reader.**

**The check does not preserve partition prunability, and F would not destroy
it.** §5.10.6 asks that no production read path address a partitioned relation
without a partition predicate, and a registered MEDIUM quality check exists for
it. But a fixture postponed from July 2026 to March 2027 already has partition
`2026-…` and kickoff `2027-…` — **blessed by the design**. Any reader pruning
partitions from a kickoff window already misses it. The check bounds the
divergence in one direction only; it does not make partitions prunable by
kickoff, and no current reader relies on it either way.

**D is the worst option and is listed only to be rejected.** Writing the
lifecycle and the venue while knowingly holding a kickoff the provider has
retracted produces a row that looks entirely plausible and is wrong — the class
of defect this programme has refused at every step (a substituted 0–0, an
invented season period, a June league table). If the platform cannot store the
truth, it must say so, not store a coherent-looking half of it.

## 5. What the architecture favours

Repository evidence, in order of weight:

1. **Loud over silent.** `normalise.ts` returns null rather than today's date;
   `pager.ts` never converts a missing score to 0–0; `standings.ts` refuses a row
   rather than writing a fabricated variant; `reference.ts` throws rather than
   silently re-parent an edition. **Nothing here favours swallowing.**
2. **A refusal is a first-class outcome, not an error.** `IngestionCounts.reject`
   exists precisely for "the mapping layer refused this, with a reason", and
   `rows_rejected` is a column in the ledger. The architecture already has a
   place to put a stated rejection — a fact none of A, D or E uses.
3. **Fail before the statement, not after it.** `ingestStandings` refuses a team
   that is not in `football.team` rather than letting the FK fail;
   `interpretStandings` refuses a negative count rather than writing it and
   leaving it to a CHECK. **C is that same discipline** applied to U-10; B is not.
4. **The partition is inert.** Doc 39 answer 3: "Partitioning, identity-inert
   while the writer keeps it immutable." A column the design calls inert is a
   weak thing to sacrifice a season for — which argues against A, and keeps F
   genuinely open rather than heretical.
5. **Savepoints are discouraged in this codebase**, in the helper's own words.
   That is a direct argument for C over B.
6. **The check is a tripwire, not a load-bearing invariant.** Its own COMMENT
   describes it as *documenting* a consequence of the writer's rule. Test 24
   guards it. Under C it stays, and stays meaningful — it becomes the backstop
   for a writer bug rather than the mechanism handling a routine provider event.

**The architecture favours C, decisively, over A, B, D and E.** It is neutral to
mildly favourable on F, which is a different question and is treated as one.

## 6. Is there enough evidence to decide now?

**Partly — and the split is the useful answer.**

**The containment behaviour: YES.** What the writer should do when it meets this
condition is fully determined by repository evidence (§5). It needs no
measurement, no provider call, and no governance decision beyond recording it.

**The representation question: NO.** Whether `fixture_partition_on` should
remain constrained to `≤ kickoff` (status quo) or be redefined as a pure creation
bucket (F) cannot be settled today. The missing evidence is **exactly one thing**:

> **How often does a fixture's UTC kickoff date move backwards?**
> Zero occurrences in one season is not a rate. If it is genuinely negligible,
> containment is the permanent answer and F is unnecessary. If it is routine —
> broadcast rescheduling is a real phenomenon — then a platform that permanently
> cannot represent it has a modelling defect, and F is the fix.

Containment is what makes that measurement affordable: under A the measurement
costs a rolled-back season per occurrence; under C each occurrence costs one
counted rejection and produces exactly the datum needed.

### The dependency to stop at

**U-10a is gated behind the forward-window decision**, which is an unresolved
*product* question recorded in doc 39 and doc 45 §"Forward-window configuration":
the configured window `2026-05-31 → 2026-08-11` selects **zero** forward
fixtures, so a future fixture cannot be brought forward in it. A frequency
measurement that includes U-10a is impossible until a forward horizon exists.

**U-10b is not gated by anything** and can be measured by the 56-competition
sweep as currently configured.

So: containment is decidable and implementable now; the frequency evidence for
U-10a is **blocked on the forward-window decision**, and this assessment stops at
that boundary rather than presuming it.

## 7. Recommended decision

Distinguished as requested.

**Evidence** (verifiable statements about the repository):
- The failure aborts the whole season, not a page (§0.1).
- Catching the SQLSTATE cannot work without savepoints (§0.2).
- The writer already holds both values needed to detect the condition before
  writing (§3, option C).
- No downstream reader depends on `partition ≤ kickoff` (§4).
- The invariant is already violated in the blessed direction by postponement
  (§4).
- Zero observed occurrences, over one season (§2).

**Architectural inference** (reasoning from that evidence):
- A stated rejection is the architecture's own idiom for "refused, with a
  reason", and refusing *before* the statement is its established discipline.
- The CHECK is a tripwire documenting the writer's rule, not a load-bearing
  read-path invariant — so keeping it costs nothing under C, and F is a
  legitimate future option rather than a weakening.
- Storing a partial truth (D) is the one outcome this programme has consistently
  refused.

**Recommendation** — to be recorded as the U-10 decision:

> **U-10 is a WRITER concern and is resolved by pre-emptive refusal.**
> `resolveFixture` compares the incoming kickoff's UTC date against the stored
> `fixture_partition_on` it has already read. When the incoming date is earlier,
> the fixture is **refused before any statement is issued**: counted as a
> rejection with a stated reason, logged, recorded as a `DATA_QUALITY` failure so
> the occurrence is durable rather than only counted, and the season continues.
> The fixture keeps its previous kickoff and lifecycle, and the platform's record
> of it is knowingly stale — which is stated, not hidden.
>
> `ck_fixture__partition_not_after_kickoff` is **NOT weakened, NOT dropped, and
> NOT worked around.** It remains as the backstop, and test 24 remains as its
> tripwire. No savepoint is introduced.
>
> **The representation question (option F) is deferred, not rejected**, pending a
> frequency measurement that pre-emptive refusal makes affordable — and, for
> U-10a, pending the forward-window decision.

## 8. The implementation task that follows — U-10-IMPL

Defined here, **not started.** It is a separate controlled task.

**Scope.** One comparison in `resolveFixture`, one rejection path, one failure
record, and tests. Nothing else.

**Affected files**
| File | Change |
|---|---|
| `src/v2/ingestion/entities/fixtures.ts` | detect and refuse before the upsert; the U-10 comment block becomes a description of behaviour rather than of a deferral |
| `src/v2/ingestion/normalise.ts` *(or `fixtures.ts`)* | one exported pure predicate, so the rule is testable without a database |
| `src/v2/ingestion/pipeline.ts` *(only if the failure record is written)* | append a `DATA_QUALITY` failure on the control connection |
| `src/v2/ingestion/__tests__/fixtureIdentity.test.ts` | test 23 changes from "raises `23514`" to "refuses without issuing a statement"; **test 24 must not change** |
| `src/v2/ingestion/__tests__/fixtureReplay.test.ts` | test 21, same change against the real capture |

**Affected relations:** `football.fixture` (read and refused write),
`operations.write_record` (`rows_rejected`), `operations.failure` (one
`DATA_QUALITY` row per occurrence). **No relation gains, loses or alters a
column.**

**Migration required: NO.** If a future step adopts option F, that is a separate
task and it does carry a migration.

**Acceptance criteria**
1. A fixture whose incoming kickoff has an earlier UTC date than its stored
   partition is **refused before any statement is issued** — asserted by a
   recording client showing no `INSERT`/`UPDATE` was sent, in the manner of
   `fixtureIdentity` test 13.
2. The rejection is counted on `football.fixture` as `rejected`, with a reason
   naming both dates, and the fixture's stored row is **unchanged in every
   column**.
3. **The season continues.** A page containing one refused fixture and N others
   writes the N, and the transaction commits.
4. An intra-day backwards move (same UTC date) is **not** refused and updates
   normally — the population bound of §1.
5. A later reschedule is unaffected, and every existing U-9 test stays green.
6. `ck_fixture__partition_not_after_kickoff` is unchanged; **test 24 passes
   unmodified**, and a mutant that drops the constraint fails it.
7. A mutant that removes the pre-emptive check restores `23514` and fails the
   suite — the writer rule, not the database, is what is being asserted.
8. The occurrence is durable: one `operations.failure` row of class
   `DATA_QUALITY` per refused fixture, naming the provider id and both dates.
9. Idempotent: re-running the same payload refuses identically and writes
   nothing new.

**Required tests:** the pure predicate (no database, both directions and the
same-day boundary); the recording-client assertion that nothing was sent; a
persistence test that the season commits with the rest of its fixtures intact; a
persistence test that the stored row is byte-for-byte unchanged; the two existing
U-10 tests converted; the constraint tripwire unmodified.

**Not in scope:** the forward window, option F, any change to
`football.fixture`'s schema, `provider_statistic`, `appearance`/G-1, and F-2/F-3.

---

## Blockers and dependencies

| | Status |
|---|---|
| **U-10 containment (U-10-IMPL)** | **Unblocked and now specified.** Needs approval of §7, nothing else |
| **U-10 frequency evidence** | Needs the 56-competition sweep — which containment is a precondition for running safely |
| **U-10a frequency evidence** | **BLOCKED on the forward-window decision.** Unreachable in the current configuration |
| **Option F (redefine the column)** | **BLOCKED on the frequency evidence above.** Deferred, not rejected |

**Nothing in this document has been implemented. No schema, migration, ingestion
code or test has been changed. This file is written and left uncommitted.**
