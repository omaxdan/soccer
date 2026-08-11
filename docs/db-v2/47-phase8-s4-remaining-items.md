# Phase 8 S-4 — Remaining Items: What Is Actually Unblocked

Standings is live-proven ([doc 46](./46-phase8-s4-standings-live-proof.md)).
This assesses the five items left in S-4 against two tests — **unblocked** and
**specified** — and recommends one. **No code changed. Nothing implemented.**

---

## Verdict

**F-2 is the only remaining S-4 item that is both unblocked and specified.**

The two relations doc 15 §3.4 still names are genuinely blocked, and one of them
is blocked harder than the record suggests.

| Item | Unblocked | Specified | Verdict |
|---|---|---|---|
| **F-2** transition telemetry | **yes** | **yes** | **DONE** — fixed, `5647ac5` |
| F-3 insert-vs-update | yes | yes | **DONE** — fixed, [doc 48](./48-phase8-s4-f3-insert-update-telemetry.md) |
| U-10 earlier reschedule | yes | **no** — the behaviour is undecided | needs a decision first |
| `appearance` + match-level family | **no** — G-1 | n/a | blocked |
| `provider_statistic` | **no** — PD-16 conflict | **no** | blocked, and see §3 |

---

## 1. `appearance` and the match-level family — BLOCKED

[Doc 35](./35-phase0-provider-capability-investigation.md) §1, unchanged:

> **G-1 is NOT CONFIRMED, and it cannot be confirmed from this repository.** The
> complete provider surface either integration knows about is thirteen paths. Not
> one of them is documented, typed, called or tested as returning per-fixture
> player data. There is no lineup endpoint, no per-fixture player-statistics
> endpoint, no events endpoint and no manager endpoint in any registry, in either
> codebase.

`appearance`, `lineup`, `lineup_selection`, `match_event`, `official` and
`official_assignment` have **no writer at all** — verified again now: `grep`
for `INSERT INTO football.appearance` or `relation: 'football.appearance'`
across `src/` returns **nothing**.

**There is no source.** Implementing a writer would mean inventing a provider
schema, which this programme has refused at every step. The one cheap question
doc 35 identifies remains open: `/match/{id}` is registered in V1 and **never
called**, and its own description — *"Get match details (teams, date, status)"* —
does not claim lineups. **One discovery call would settle whether G-1 is
answerable at all.** That is a discovery decision, not an implementation one.

## 2. F-3 — unblocked and specified, but not first

`upsertMutable` counts every successful statement as `written`, so an insert and
an update are indistinguishable. `RETURNING (xmax = 0) AS inserted` separates
them at no extra round trip.

It touches the **shared write primitive used by nine relations**, so it deserves
its own step with its own regression pass. Ready whenever, but F-2 is smaller and
its absence distorts more.

## 3. `provider_statistic` — BLOCKED, and the blocker is real

Doc 15's dependency table names *"`provider_statistic.measures` shape undefined
(004 TODO)"* as S-4's blocking issue. That looked as though it might have lapsed
— `measures` is `jsonb NOT NULL` and the migration comment says opaque storage is
*"explicitly permitted by PD-16 circumstance 1"*. **It has not lapsed.** Reading
PD-16 in full is what settles it:

> **PD-16.** Binary structured payloads are permitted in exactly two
> circumstances:
> 1. **Retained provider responses**, kept for audit and reprocessing, which are
>    opaque by definition and **are never queried by content in a production read
>    path**.
> 2. Operational diagnostic detail […]
>
> Structured payloads are **prohibited** for evidence, classifications, entity
> references, narrative content, and **any value that is queried, aggregated,
> joined, or explained**.

So opaque `measures` is permitted **only if nothing reads it by content**. But
`provider_statistic` exists to hold season statistics that feature calculators
consume — a calculator reading `measures->>'minutesPlayed'` is precisely the
"queried and aggregated" case PD-16 prohibits. The 004 TODO says as much:

> If the intent was columnar measures per domain, **the domain relations must be
> enumerated before DDL is finalised.** Confirm before Phase 6 sign-off.

That confirmation never happened, and the DDL shipped. **The two readings imply
different schemas**, so this cannot be settled by writing a stage:

| Reading | Consequence |
|---|---|
| `provider_statistic` is an **audit** relation, never read by content | Opaque jsonb is correct. It is **not** a feature source, and something else must supply season statistics |
| It is a **feature source** | PD-16 requires columnar measures per domain — the seven `statistics_domain` codes need enumerated relations. **A schema change**, and a substantial one |

**A provider source does exist**, which is why this is worth stating precisely
rather than filing under "blocked": doc 35 §2 records two endpoints as **EXISTS +
CALLED by V1** —
`/teams/{id}/tournament/{t}/season/{s}/player-statistics` (read at
`syncSeasonStatistics.ts:268-270`) and `/teams/{id}/tournament/{t}/season/{s}/statistics`.
Neither is registered in V2. Both are **per team**, so a season costs ~20 calls
per domain — 56 competitions would be thousands of calls, its own budget question.

**So `provider_statistic` is blocked on a governance decision, not on evidence,
and the decision may carry a migration.** It should not be started until that
decision is made. Doc 15 was right.

## 4. U-10 — unblocked, not specified

A fixture rescheduled earlier than its original date violates
`ck_fixture__partition_not_after_kickoff` (SQLSTATE `23514`) and aborts the page.
Loud and safe today, and two tests hold that posture.

**The behaviour decision was never made** — abort the page, or catch `23514` on
that constraint, count a stated rejection, and continue. Until it is, there is
nothing to implement. It also cannot bite on a single completed season; it needs
a brought-forward fixture, which arrives with a multi-competition sweep.

---

## 5. F-2 — the recommendation

### What is wrong

`recordLifecycleTransition` is handed the **fixture's** counter
(`entities/fixtures.ts`), so its writes land on `football.fixture`. The schedule
stage creates a bucket for the transition relation and comments that it is
attributing them *"where they belong"* — but the counts are never moved.

**Live-observed on runs 52/53** (doc 46 §2): `football.fixture` reports 94
examined over 47 fixtures on a first-ever run, and
`football.fixture_lifecycle_transition` reports **0** while 47 rows exist.

### Why it is worth doing before the 56-competition sweep

`operations.write_record` is how an operator judges a sweep. Today it reports a
fixture count **roughly double the truth** and a permanent **zero** beside a
relation that is being written on every run. Anyone reading it cold would
reasonably diagnose duplication where there is none — doc 46 needed two
paragraphs of prose to pre-empt exactly that misreading.

It is also the cheapest of the five: **pass the transition relation its own
counter.** No schema change, no migration, no provider call, no change to what is
written — only to which bucket the counts land in.

### Acceptance criteria, for approval — NOT implemented

- `recordLifecycleTransition` receives its own `IngestionCounts`; the schedule
  stage folds it into `football.fixture_lifecycle_transition`.
- A first-ever ingest of N fixtures reports `football.fixture` **examined = N**,
  not 2N, and `fixture_lifecycle_transition` **examined = written = N**.
- A re-ingest with no state change reports `fixture` N and `transition` **0
  written**.
- `football.fixture` counts never include a transition write again — asserted
  structurally, so the wiring cannot silently regress.
- Existing fixture, U-9, F-1 and standings tests stay green.
- Doc 46's two "this looks wrong and is not" notes are then obsolete and should
  be retired with the fix.

**Closure:** the existing test suite plus one live single-season run whose
`write_record` shows `fixture` 47 and `transition` 47 — no new provider call is
needed if it rides along with a sweep already planned.

---

## Recommended order

1. ~~**F-2**~~ — done.
2. ~~**F-3**~~ — done; see [doc 48](./48-phase8-s4-f3-insert-update-telemetry.md), which records
   what §2 above did not state: the named `xmax` technique does not work on the
   two partitioned relations, and the ledger has no column for the split.
3. **U-10** — decide the behaviour, then implement.
4. **`/match/{id}` discovery** — one call to settle whether G-1 is answerable,
   which is what gates `appearance` and everything below it.
5. **`provider_statistic`** — only after the PD-16 governance decision, which may
   carry a migration.

**S-4 standings: COMPLETE and LIVE-PROVEN. S-4 as a whole: OPEN.**

*This document was an assessment; nothing in it was implemented when it was
written. F-2 and F-3 have since been implemented under their own steps — the
table and the order above are annotated accordingly, and nothing else here has
been restated.*
