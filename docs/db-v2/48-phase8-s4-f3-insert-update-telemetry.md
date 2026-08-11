# Phase 8 S-4 — F-3: separating an insert from an update

`upsertMutable` counted every successful statement as `written`, so a run that
created 47 fixtures and a run that updated 47 reported identically. This closes
that. **F-3 only.** No schema change, no migration, no provider call, no change
to what is written — only to what the run can say about it.

---

## 1. What was wrong

[Doc 40](./40-phase8-s5-fixture-replay-proof.md) §3 and
[doc 45](./45-phase8-s6-operational-closure.md) both record it:

> `upsertMutable` counts every successful statement as `written`. A pass that
> inserted 47 fixtures and a pass that updated 47 are indistinguishable in
> telemetry: both report `examined 47, written 47, skipped 0`.

The cost was already being paid in prose. Doc 40 had to derive the split by
counting rows before and after. Doc 45 had to warn readers that run 51's
`written = 47` did **not** contradict "zero new fixtures", and that the
idempotency proof was the row count rather than the column. Nobody reading a
finished 56-competition sweep can count rows before and after, and *"how much of
this competition was new?"* is the first question that sweep will be asked.

**Runs 50–53 predate this fix and are left exactly as recorded.** Docs 40, 45
and 46 describe what those runs reported at the time, which is what a run record
is for; none of them has been restated.

## 2. Three things doc 47 did not say

Doc 47 §2 is four sentences of assessment. It carries **no acceptance criteria**
— the only `Acceptance criteria` heading in that document is §5's, and it belongs
to F-2. So the defect statement and the live evidence were taken as the contract,
and the following were settled from the repository before any code changed.

### 2.1 The named technique does not cover the schema

Doc 47 §2 and doc 45 both name `RETURNING (xmax = 0) AS inserted` and describe it
as separating the two "at no extra round trip". It does — **on an ordinary
table**. On a partitioned one PostgreSQL refuses it outright:

```
ERROR:  cannot retrieve a system column in this context
```

Of the nine relations the primitive writes, **seven are ordinary and two are
partitioned**: `football.fixture` and `football.result`. Those two are also the
two the question is actually about.

Both of them **already read the existing row before writing** — `resolveFixture`
for identity-before-partition (U-9), `recordResult` for the LC-17 revision check
— so the caller states what it already knows and no extra statement is issued
anywhere. Omitting it on a partitioned relation fails the statement with the
error above, so the second mechanism can be forgotten into a loud failure but
never into a wrong count.

Test 9 asserts the refusal against PostgreSQL rather than trusting this
paragraph.

### 2.2 The ledger has nowhere to put it, and that was deliberate

`operations.write_record` holds `rows_examined`, `rows_written`, `rows_skipped`
and `rows_rejected`. Finding **M-3** (`src/v2/operations/writeRecord.ts`) records
that the S-2 brief asked for *"rows inserted, rows updated, rows deleted"* and
that the approved relation deliberately does not carry them.

Persisting the split is therefore a **migration and a governance decision**, and
the instruction for this step permitted a migration only if doc 47 stated that
F-3 required one. It does not. **So the split lives in the run's own report and
in the structured log, and the ledger is untouched.** Test 12 pins the ledger's
shape so this stays a stated limitation rather than a forgotten one.

This is the honest half-measure and it is named as such in §6.

### 2.3 The split does not cover every write, and says so

`inserted + updated === written` holds for the writes made through the two
primitives in `write/index.ts`. `squad.ts` writes `player_registration` and
`player_availability` with hand-written SQL; those are **outside F-3's remit and
are untouched**, so a counter including them has `inserted + updated < written`.
The residue is the unclassified raw-SQL path, not a lost row, and it is stated in
the counter's own comment rather than papered over.

## 3. What changed

| File | Change |
|---|---|
| `write/index.ts` | `IngestionCounts` gains `inserted`/`updated` and `countUpsert`; `upsertMutable` projects `(xmax = 0) AS inserted`, or accepts `existedBeforeWrite` from a caller that has already read the row; `insertAppendOnly` reports its writes as creations |
| `entities/reference.ts` | four call sites count through `countUpsert` |
| `entities/participants.ts` | three call sites, same |
| `entities/fixtures.ts` | two call sites, and both state `existedBeforeWrite: existing !== null` from the read they already make |
| `cli.ts` | the season report shows `new` and `existing` beside `written`, per relation |
| `pipeline.ts`, `stages/standings.ts` | the structured log lines carry the split |
| `feature/__tests__/fixtures.ts` | the seeding helper writes the two partitioned relations and had to state the branch; it reads once and answers for both |

`countUpsert` takes the **returned row**, not a boolean, so the branch cannot be
restated by hand at nine call sites — its only source is the statement that
performed the write. A row arriving without the flag **throws**: guessing would
make `inserted + updated === written` quietly false, which is the exact class of
defect F-3 exists to remove.

## 4. What is proven

`src/v2/ingestion/__tests__/writeTelemetry.test.ts` — **13 tests, all passing**.

| # | Assertion |
|---|---|
| 1–4 | the counter splits, folds, refuses a flagless row, and leaves `toWriteCounts()` at exactly the four ledger quantities |
| 5–6 | **structural**: no entity writer counts a write by hand, every upsert is counted through `countUpsert`, and both partitioned sites state the branch from a prior read |
| 7 | an ordinary relation: first write created, second updated — **and one row exists, carrying the updated value** |
| 8 | a caller cannot shadow the flag with a column of its own |
| 9 | `RETURNING xmax` really is refused on a partitioned relation |
| 10 | through the real writer: a first-ever ingest reports the fixture **new**, a re-ingest reports it **existing**, and one row exists across both |
| 11 | `football.result` splits the same way; the score is unchanged both times |
| 12 | every relation in a pass satisfies `inserted + updated === written`, **and `operations.write_record` still has no column for it** |
| 13 | an append-only write is a creation by construction; a repeat is neither |

Tests 5 and 6 are the F-2 lesson applied: every behavioural assertion above would
still pass if one call site reverted to `counts.written += 1`, because the row
lands identically and only that relation's split would quietly stop adding up.

**Mutation-tested — eight mutants, eight killed.**

| Mutant | Tests failed |
|---|---|
| `countUpsert` ignores the flag | 5 |
| a flagless row defaults to `inserted` instead of throwing | 1 |
| `insertAppendOnly` leaves `inserted` at zero | 2 |
| the shadow guard is removed | 1 |
| the fixture upsert stops stating the branch | 5 |
| one call site counts by hand again | 3 |
| the partitioned branch is inverted | 2 |
| the two mechanisms are swapped | 5 |

### Full verification

| Check | Baseline | After |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| suite, **no database** | 370 / 370 | **376 / 376** (+6 new) |
| suite, **scratch database** | 583 tests, 14 leaf failures | **596 tests, the identical 14** — plus T-1 below on some runs |
| `lint:reads` | 64 (baseline 57) | **64** — none introduced |

The 14 failures are pre-existing and environmental: nine pool/health tests that
require each pipeline role to authenticate as itself, and five privilege-refusal
tests that a superuser login cannot fail correctly. Neither condition is
reproducible in a scratch cluster and neither is touched here.

### T-1 — a pre-existing test-isolation defect, found while verifying this

Some full runs fail `standings.test.ts` test 17 with `40P01 deadlock detected`.
It is **not caused by F-3**, and the server log names both parties:

```
Process A: INSERT INTO football.team … ON CONFLICT … DO NOTHING          (standings 17)
Process B: INSERT INTO football.team … ON CONFLICT … DO UPDATE           (fixtureReplay)
CONTEXT:  while inserting index tuple in relation "team"
```

`standings.test.ts` test 17 seeds the twenty teams the **standings capture**
names; `fixtureReplay.test.ts` replays the **fixture capture** for the same
competition and season, which contains the same twenty clubs. Node's test runner
runs files in parallel, so two uncommitted transactions insert the same team
identities in different orders and wait on each other.

Measured directly, running only those two files: **8 of 8 runs deadlock with
this change reverted.** It is pre-existing, it belongs to the tests rather than
to the pipeline, and per the scope of this step it is **recorded and left
untouched**.

## 5. What an operator now sees

```
  per relation:
    football.fixture       examined 47  written 47  new 47  existing  0  skipped 0  rejected 0
    football.fixture       examined 47  written 47  new  0  existing 47  skipped 0  rejected 0
```

The second line is the run that answers *"nothing here was new"* — the statement
run 51 could not make about itself.

## 6. What is NOT done

- **The ledger still cannot answer this.** `operations.write_record` reports
  `rows_written` and nothing finer, so the split survives only in the run report
  and the log. Persisting it needs a column, therefore a migration, therefore the
  governance decision that finding M-3 already took once in the other direction.
  **Call it F-3b. It is not taken here.**
- **`squad.ts`'s raw-SQL writers are unclassified** (§2.3). Untouched
  deliberately.
- **T-1**, the test-isolation deadlock above — a real defect, found here,
  belonging to the test suite and not to this change.
- **U-10, the forward window, `/match/{id}` discovery and `provider_statistic`**
  are exactly where doc 47 left them. Nothing here touches any of them.

---

**S-4 standings: COMPLETE and LIVE-PROVEN. F-2: FIXED. F-3: FIXED, with F-3b
stated. S-4 as a whole: OPEN.**
