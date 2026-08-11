# Phase 8 — F-1: Competition Edition Identity Investigation

Investigation of F-1 from [doc 40](./40-phase8-s5-fixture-replay-proof.md). **No
provider calls, no migration, no schema change, no ingestion, no sweep, and no
fix implemented.**

| Label | Meaning |
|---|---|
| **VERIFIED** | Read from this repository, with the reference given |
| **REPLAY OBSERVED** | Seen in the doc-40 scratch replay |
| **DERIVED** | Follows necessarily from verified code; **not** observed |
| **UNRESOLVED** | A decision the design record does not make |

---

## Headline

**F-1 is the same disease as U-9, in a different relation.**

In both, a value that must be **derived once at creation and never recomputed**
is instead recomputed from mutable input on every write, and then used as the
conflict target — so the row is looked for where it is not, and a second one is
created. U-9 recomputed `fixture_partition_on` from the current kickoff. F-1
recomputes `season_period` from *each individual fixture's* kickoff.

The difference is what the database can do about it. For `fixture`, PostgreSQL
**cannot** enforce the invariant, because a unique constraint on a partitioned
relation must contain the partition key. For `competition_edition` — unpartitioned
— it **can**, and the design already says it should. It simply does not.

**Every football entity carrying `provider_external_id` enforces it as a unique
alternate key. `competition_edition` is the only exception.** That gap is what
turned a derivation bug into duplicate rows.

---

## A. VERIFIED

### A.1 The relation — `v2/migrations/004_football.sql:54-69`

```sql
CREATE TABLE football.competition_edition (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  competition_id        bigint      NOT NULL,
  provider_external_id  text,                       -- nullable, UNCONSTRAINED
  season_label          text        NOT NULL,
  season_period         daterange   NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_competition_edition                     PRIMARY KEY (id),
  CONSTRAINT uq_competition_edition__competition_period UNIQUE (competition_id, season_period),
  CONSTRAINT fk_competition_edition__competition        FOREIGN KEY (competition_id) …,
  CONSTRAINT ck_competition_edition__period_bounded     CHECK (NOT isempty(season_period)),
  CONSTRAINT ex_competition_edition__periods_do_not_overlap
    EXCLUDE USING gist (competition_id WITH =, season_period WITH &&)
);
```

Note what is **absent**: no `provider_code` column, and **no unique constraint
on `provider_external_id`**.

### A.2 Every sibling enforces the provider key — `004_football.sql`

| Relation | Unique constraint on the provider identifier |
|---|---|
| `competition` | `uq_competition__provider_external_id (provider_code, provider_external_id)` |
| `venue` | `uq_venue__provider_external_id (provider_external_id)` |
| `team` | `uq_team__provider_external_id (provider_code, provider_external_id)` |
| `player` | `uq_player__provider_external_id (provider_code, provider_external_id)` |
| `official` | `uq_official__provider_external_id (provider_external_id)` |
| **`competition_edition`** | **NONE** |

### A.3 The rule the omission breaks — `08-v2-physical-database-design.md:462-466` (§5.6.6)

> Where a relation has more than one candidate key, one is designated the
> business key and expressed as a unique constraint; the remainder are expressed
> as additional unique constraints and designated **alternate keys**.
>
> Provider-supplied external identifiers are alternate keys, never business keys.
> They are **unique and are enforced as such**, but identity does not depend on
> them, because a provider may reissue or retire an identifier without the entity
> changing.

`competition_edition.provider_external_id` is populated on every write and
enforced nowhere. It is neither business key nor alternate key — it is an
unconstrained attribute that looks like an identifier.

### A.4 What the design record says identity IS

**Logical model, `07-v2-logical-data-model.md` §E1.03:**

> **Identity.** Stable identity derived from the combination of **competition and
> season**. A season is a bounded period, not a label — the previous system
> stored season as free text, which made "which season was active on this date"
> unanswerable.

> **Immutability.** Identity is permanent once established.

**LC-04** (`07:3763`): "A competition edition belongs to exactly one competition
and covers a bounded period."
**LC-02** (`07:3761`): "A stable identity is never reassigned once established."

**Physical catalogue, `08:1532`:**

| Logical entity | Relation | Identity |
|---|---|---|
| E1.02 Competition | competition | **Provider identifier as alternate**; surrogate key |
| **E1.03 Competition Edition** | competition_edition | **Competition, season period** |
| E1.05 Venue | venue | **Provider identifier as alternate** |
| E1.06 Team | team | **Provider identifier as alternate** |

**The catalogue never specified an alternate key for E1.03**, while specifying
one for its neighbours. Migration 004 nevertheless added the column. That is the
origin of the gap: the column arrived without the constraint the rule attaches
to it.

**Reading the two together:** the logical model says identity is *competition
and season*. `season_period` is the physical stand-in for "season", chosen so
that "which season was active on this date" is answerable — **a query
requirement, satisfied by an attribute; it does not follow that the period must
be the resolution key.**

### A.5 The code — VERIFIED

`stages/schedule.ts:97` — `seasonPeriod(label, kickoff)`, **not exported**, three
branches:

| Branch | Pattern | Result |
|---|---|---|
| split | `(\d{4})\s*[/\-–]\s*(\d{2,4})` | `[YYYY-07-01, YYYY+1-07-01)` |
| calendar | `^(\d{4})$` — **anchored** | `[YYYY-01-01, YYYY+1-01-01)` |
| **fallback** | anything else | **derived from THIS FIXTURE's kickoff**: July-or-later → `[Y-07-01, Y+1-07-01)`, else `[Y-1-07-01, Y-07-01)` |

`stages/schedule.ts:214-232` — the only caller. `seasonLabel` is
`season.name ?? season.year ?? String(kickoff year)`; the edition cache key is
`${competitionId}:${period.startsOn}`, i.e. **keyed on the derived period**, so
the cache cannot detect the split either.

`entities/reference.ts:101` — `resolveCompetitionEdition`:

```ts
columns: ['competition_id', 'provider_external_id', 'season_label', 'season_period'],
conflictTarget: ['competition_id', 'season_period'],
```

`provider_external_id` is written but is not the conflict target — and because
`upsertMutable` updates non-target columns as `COALESCE(EXCLUDED.col, target.col)`,
it is **overwritten by the last writer**.

**The asymmetry that gives the game away.** In the same file,
`resolveCompetition` (`reference.ts:58`) uses
`conflictTarget: ['provider_code', 'provider_external_id']` — it resolves on the
**provider alternate key** and is therefore stable. The edition resolver is the
only reference resolver in the stage that resolves on a **derived** value.

### A.6 Test coverage — VERIFIED

- `seasonPeriod` is **not exported**; it has **no direct test**.
- The only test touching `competition_edition` (`ingestion.test.ts:582-587`)
  hand-writes `'[2026-07-01,2027-07-01)'` and never invokes `seasonPeriod`.
- **No test exists for a split-season label, a calendar-season label, an
  unparseable label, or repeated resolution.**

That is why F-1 survived to a replay against real payloads.

### A.7 The three provider identifiers — where each lives today

| Provider field | Value (observed) | What it means | Persisted where |
|---|---|---|---|
| `tournament.uniqueTournament.id` | 325 | **the competition** | `football.competition.provider_external_id` |
| `tournament.id` | 83 | the season's *instance* of the competition | **NOWHERE** — read by `interpretEvent` as `tournamentInstanceProviderId`, carried through the pager, then dropped |
| `season.id` | 87678 | **the edition** | `football.competition_edition.provider_external_id` — **written, unconstrained, unused for resolution** |

`pager.ts` already separates all three and says why: "Collapsing any two would
attach a season's fixtures to the wrong competition."

### A.8 Everything that hangs off an edition — VERIFIED

Nine foreign keys, five schemas:

| Relation | Reference | Key including the edition |
|---|---|---|
| `football.competition_stage` | `004:86` | `uq_competition_stage__edition_ordinal (competition_edition_id, stage_ordinal)` |
| `football.team_registration` | `004:166` | `uq_team_registration__team_edition (team_id, competition_edition_id)` |
| `football.player_registration` | `004:214` | optional |
| `football.provider_statistic` | `004:348` | `uq_… (subject_kind_code, player_id, team_id, affiliation_team_id, competition_edition_id, statistics_domain_code, provider_code)` |
| `football.standing` | `004:389` | `uq_… (competition_edition_id, team_id, standing_variant, as_of_on)` |
| `football.fixture` | `005:58` | attribute (`NOT NULL`) |
| `feature.feature_value` | `007:110-113` | **subject AND context** |
| `module.module_reading` | `008:160-163` | **subject AND context** |
| `product` read models | `017:65` | via fixture |

Every one is `ON DELETE RESTRICT ON UPDATE RESTRICT`.

---

## B. F-1 ROOT CAUSE

### B.1 The exact path

For each event, `ingestEvent` (`schedule.ts:213-232`):

1. `seasonLabel = text(season?.name)` → **`"Brasileiro Serie A 2026"`**
2. `seasonPeriod("Brasileiro Serie A 2026", kickoff)`
   - split regex — no match (no separator)
   - calendar regex `^(\d{4})$` — **no match, because it is anchored and the
     label contains words**
   - → fallback, on **this fixture's** kickoff
3. `editionKey = ${competitionId}:${period.startsOn}` — the cache keys on the
   derived period, so two periods are two cache entries
4. `resolveCompetitionEdition(..., conflictTarget: ['competition_id', 'season_period'])`
   → `ON CONFLICT` on a period that differs between fixtures → **two INSERTs**

### B.2 Why 1 July split this particular season

REPLAY OBSERVED (doc 40):

| Fixture kickoff | `julyOrLater` | Derived period | Fixtures |
|---|---|---|---|
| 2026-05-31 | false | `[2025-07-01, 2026-07-01)` | **5** |
| 2026-07-16 → 2026-08-09 | true | `[2026-07-01, 2027-07-01)` | **42** |

The Brasileirão's mid-2026 break falls across 1 July, so the window's 47
fixtures land on both sides of the fallback's hinge.

### B.3 Why the database did not object

- `uq_competition_edition__competition_period` — two **different** periods, no conflict.
- `ex_competition_edition__periods_do_not_overlap` — the two periods are adjacent, not overlapping. No conflict.
- `ck_competition_edition__period_bounded` — both non-empty. Satisfied.
- **No constraint mentions `provider_external_id`**, so two rows carrying 87678 are legal.

Both rows are individually valid. Nothing in the schema expresses "one provider
season is one edition".

### B.4 F-1b — the mirror failure: two provider seasons COLLAPSING into one edition

**DERIVED, not observed** — it follows from the same fallback and needs a second
season's data to demonstrate.

For a calendar-year league, consecutive seasons produce **overlapping** derived
periods:

| Provider season | Fixture kickoffs | Derived period(s) |
|---|---|---|
| 2025 | Jan–Jun 2025 | `[2024-07-01, 2025-07-01)` |
| 2025 | Jul–Dec 2025 | **`[2025-07-01, 2026-07-01)`** |
| 2026 | Jan–Jun 2026 | **`[2025-07-01, 2026-07-01)`** ← same period |
| 2026 | Jul–Dec 2026 | `[2026-07-01, 2027-07-01)` |

The 2025 season's second half and the 2026 season's first half derive the
**identical** period, so they resolve to the **same edition row**. And because
`provider_external_id` is COALESCE-updated on every write, that row's provider
season id **flip-flops** between the two seasons depending on ingestion order.

F-1 splits one season into two editions. **F-1b merges two seasons into one.**
The second is worse: standings, statistics and registrations from two different
seasons accumulate against one edition, and no constraint can notice, because
`uq_team_registration__team_edition (team_id, competition_edition_id)` would
simply match. It becomes reachable the moment history beyond one season is
ingested.

### B.5 A third consequence — a loud failure, DERIVED

If a competition's label format ever changes between seasons (parseable one year,
not the next), a derived `[2026-01-01, 2027-01-01)` and a derived
`[2026-07-01, 2027-07-01)` for the same competition **overlap**, and
`ex_competition_edition__periods_do_not_overlap` raises. That failure is safe —
loud, named, and it aborts — but it is a second symptom of the same cause.

---

## C. INTENDED INVARIANT

### The nine questions, answered

| Question | Answer | Basis |
|---|---|---|
| **What identifies a competition?** | Its surrogate key; `(provider_code, provider_external_id)` = `uniqueTournament.id` is the enforced alternate key used for resolution. "A competition's STABLE IDENTITY ACROSS ALL TIME, deliberately independent of name and sponsor." | `004:50`, resolver VERIFIED |
| **What identifies a competition edition?** | The combination of **competition and season**. Physically: the surrogate key, with `(competition_id, season_period)` as the declared business key. | `07` §E1.03, `08:1532` |
| **Must one provider `season.id` map to exactly one edition?** | **YES.** A provider season *is* a competition in a specific season, which is the definition of the entity. Two editions for one season violate E1.03's purpose and split every dependent. | `07` §E1.03 |
| **Is `(competition_id, season_period)` actually the intended business identity?** | **Yes, as the business key.** It is stated in both the physical catalogue and the migration. **But it was never intended as the resolution key**, and nothing in the design record says a provider season should be *found* by recomputing its period. | `08:1532`, `004:63` |
| **Should `provider_external_id` remain an alternate key?** | **YES — and it must actually BE one.** §5.6.6 forbids it as a business key and requires it to be unique and enforced. Today it is neither. | `08:462-466` |
| **Should the provider season id be persisted as part of identity/resolution?** | It is **already persisted**. It must **not** become the business identity (§5.6.6), but resolving on an enforced alternate key is exactly what `resolveCompetition` already does for competitions. Resolution ≠ identity. | VERIFIED |
| **How must a season spanning 1 July behave?** | **The question must not be answerable from the data.** 1 July is an artefact of one branch of one helper. No part of an edition's identity may depend on which side of it a fixture falls. | DERIVED from C below |
| **A split season, `2025/26`?** | One edition, `season_period = [2025-07-01, 2026-07-01)`. Currently correct — the split branch matches. | VERIFIED |
| **A calendar season, `2026`?** | One edition, `season_period = [2026-01-01, 2027-01-01)`. Correct **only if the label is exactly four digits**; `"Brasileiro Serie A 2026"` is not, and that is F-1. | VERIFIED |

### The invariant, stated

**In application terms.** A competition edition is resolved by the identity the
provider gives it — `(competition, season.id)` — and never by a value recomputed
from a fixture. `season_period` is **derived once, at creation, from the season's
own label, and never recomputed thereafter.**

**In database terms.** For any competition, `provider_external_id` determines at
most one `competition_edition` row:

```sql
SELECT competition_id, provider_external_id, count(*)
  FROM football.competition_edition
 WHERE provider_external_id IS NOT NULL
 GROUP BY 1, 2 HAVING count(*) > 1;   -- must return no rows, always
```

**And note the shape of the invariant: it is `fixture_partition_on` again.**
Derived from mutable input at creation, immutable afterwards, and resolved by
provider identity rather than by re-deriving. U-9 established that pattern for
`fixture`; `competition_edition` needs the same discipline, and unlike `fixture`
it can have a constraint to hold it.

### The consequence that must not be missed

If `season_period` stays in the business unique constraint — and it should, it is
what LC-04 and the no-overlap exclusion express — **it cannot be safely mutated
later.** Widening a period as fixtures arrive would mutate a business key, which
LC-02 forbids ("a stable identity is never reassigned"). So the derivation must
be right the first time and then left alone. Any fix that "corrects the period as
more fixtures arrive" is wrong for the same reason advancing `fixture_partition_on`
was wrong.

---

## D. CANDIDATE FIXES

### D-1. Resolver-only: teach `seasonPeriod` to find a trailing year

Extract a four-digit year from anywhere in the label instead of requiring the
whole label to be one.

| | |
|---|---|
| Change | ~2 lines, one file. No schema, no migration. |
| Fixes F-1? | For **this label**. Not for the class. |
| Fixes F-1b? | **No.** Any label that still misses the pattern falls through to the same per-fixture fallback. |
| Enforces anything? | **No.** The next unanticipated label splits a season again, silently. |
| Dependents | None affected. |

**A patch for one string, not a fix for an identity defect.** It also leaves a
subtle trap: a four-digit year appearing in a sponsor name would be parsed as the
season.

### D-2. Resolve on the provider season id (no schema change)

Look the edition up by `(competition_id, provider_external_id)` before writing —
the `findFixtureByProviderIdentity` pattern from U-9 — and derive a period only
when creating.

| | |
|---|---|
| Change | One resolver, one helper. No schema, no migration. |
| Fixes F-1? | **Yes** — the second fixture finds the first edition. |
| Fixes F-1b? | **Yes** — two provider seasons can no longer share a row. |
| Enforces anything? | **No.** `ON CONFLICT` needs a unique constraint, so resolution must be SELECT-then-upsert with the *period* still as the conflict target. A concurrent writer, or any future code path that skips the lookup, recreates the defect. |
| Dependents | None affected; existing rows keep their ids. |

Correct behaviour, unguarded. This is precisely the U-9 position — application as
sole enforcement point — but **without U-9's justification**, because there
PostgreSQL genuinely could not enforce it and here it can.

### D-3. Change the business key to `(competition_id, provider_external_id)`

| | |
|---|---|
| Fixes F-1 / F-1b? | Yes. |
| **Violates §5.6.6** | **Yes, explicitly**: "Provider-supplied external identifiers are alternate keys, **never** business keys." |
| Also loses | `(competition_id, season_period)` is what makes "which season was active on this date" answerable and what the no-overlap exclusion protects. Demoting it weakens LC-04. |
| Dependents | None structurally, but every edition's identity would become dependent on a value the provider may "reissue or retire" — the exact failure §5.6.6 exists to prevent. |

**Rejected on the rule.**

### D-4. Add the missing alternate-key constraint, and resolve on it

`D-2` **plus** the unique constraint §5.6.6 already requires and every sibling
already has:

```sql
ALTER TABLE football.competition_edition
  ADD CONSTRAINT uq_competition_edition__provider_external_id
  UNIQUE (competition_id, provider_external_id);
```

`(competition_id, season_period)` **remains the business key**, unchanged.
`provider_external_id` becomes an enforced alternate key, and therefore a legal
`ON CONFLICT` target — so resolution needs no SELECT-then-upsert at all.

| | |
|---|---|
| Fixes F-1 / F-1b? | **Yes, and prevents recurrence** — a second row for one season becomes impossible, not merely unlikely. |
| Schema change? | **Yes — one constraint.** It adds no column, changes no key, and rewrites no data. |
| §5.6.6 | **Brought into conformance**, not violated. |
| Nulls | Default `NULLS DISTINCT` is correct here: several editions with no provider id must remain possible. (Contrast migration 020's `NULLS NOT DISTINCT` cases, where the opposite was needed.) |
| `provider_code`? | `competition_edition` has no such column. `venue` and `official` also omit it; `competition`, `team`, `player` include it. **UNRESOLVED** — see below. |

**Consequences for dependents — all four options, D-2/D-4 identical:**

| Dependent | Effect |
|---|---|
| `standing` | **Repaired.** One edition means one table, not two half-tables. `uq_standing (competition_edition_id, team_id, variant, as_of_on)` starts meaning what it says. |
| `team_registration` | **Repaired.** REPLAY OBSERVED: 94 written where 40 belong — 20 teams registered twice, once per half-edition. |
| `provider_statistic` | **Repaired.** Season statistics stop splitting at 1 July. |
| `competition_stage` | **Repaired.** REPLAY OBSERVED: 6 stage rows across two editions for one set of rounds. |
| `fixture` | Attribute only; no fixture identity changes. `fixture_partition_on` is untouched. |
| `feature_value` / `module_reading` | Both use the edition as **subject and context**. A split edition splits every competition-scoped feature. |
| Calibration populations | Keyed on the edition. A split edition halves a population and silently changes what a measurement is over. |
| **Existing foreign keys** | **None break under any option.** Every FK targets `competition_edition.id`, and no option changes a surrogate key or deletes a row. |

---

## E. EXISTING DATA

**No erroneous rows exist anywhere. Nothing needs repairing, and no repair
migration is proposed.**

- The two rows of doc 40 were created inside a `BEGIN … ROLLBACK` in a **scratch
  cluster**, which has since been destroyed. They were never committed.
- The V2 fixture writer has **never been authorised to run** against any
  persistent database. Only `seed:v2` has run, and it writes vocabularies, not
  editions.
- Therefore `football.competition_edition` is **expected to be empty** in the
  real V2 database. **This should be confirmed before any fix is applied** —
  by the query in §C — rather than assumed here, since I have not connected to
  it and will not without instruction.

**If a split were ever found in a populated database**, repair would not be a
schema migration. It would be a data reconciliation — choose the surviving
edition, repoint nine foreign keys, merge or reject conflicting standings and
registrations, then delete the loser — and `pt_pipeline_ingestion` holds no
`DELETE` on `football`, so it could not be done by the pipeline at all. That is a
separate, governed exercise. **It is not needed today, and inventing it now would
be inventing a production problem that does not exist.**

The one thing worth doing before a fix lands is adding the §C query to the
migration-018 quality-assertion registry, so the invariant acquires a detective
control alongside the preventive one.

---

## F. TEST PLAN

`seasonPeriod` must be **exported** to be testable; it is not today, which is
why the defect reached a replay.

### F.1 Period derivation — pure, no database

| # | Input | Expected |
|---|---|---|
| 1 | `"2025/26"`, any kickoff | `[2025-07-01, 2026-07-01)` |
| 2 | `"2025/2026"`, any kickoff | `[2025-07-01, 2026-07-01)` |
| 3 | `"2026"`, any kickoff | `[2026-01-01, 2027-01-01)` |
| 4 | **`"Brasileiro Serie A 2026"`** with a **May** kickoff | one period |
| 5 | **`"Brasileiro Serie A 2026"`** with an **August** kickoff | **the same period as #4** |
| 6 | any label, kickoff 2026-06-30 vs 2026-07-01 | **identical** — the 1 July hinge must not be observable |
| 7 | a label with no year at all | a stated, deterministic outcome — **UNRESOLVED**, see §G |

**#4 and #5 together are the F-1 regression.** Neither alone catches it.

### F.2 Resolution — against a database

| # | Scenario | Expected |
|---|---|---|
| 8 | Ingest the captured Brasileirão window | **exactly 1** `competition_edition` |
| 9 | Repeat the identical ingest | the **same** edition id; no second row |
| 10 | Ingest a May fixture, then an August fixture, of the same season | one edition; the second resolves the first |
| 11 | Ingest the August fixture first, then May | one edition, **same id** — order must not matter |
| 12 | Two provider seasons of a calendar-year league (2025 then 2026) | **two** editions, correctly separated — the **F-1b regression** |
| 13 | A season spanning a year boundary (2026-08 → 2027-05) | one edition; period spans the boundary |
| 14 | A fixture rescheduled within a season | no new edition; `season_period` **unchanged** |
| 15 | A fixture rescheduled across the season's period boundary | `season_period` still **unchanged** — the immutability rule of §C |
| 16 | Repeated resolution across separate transactions | the same edition id |
| 17 | Two editions sharing one `provider_external_id`, inserted directly | **refused** by the constraint (D-4 only) |
| 18 | Editions with `provider_external_id IS NULL` | several permitted |

### F.3 Invariant assertions

| # | Assertion |
|---|---|
| 19 | The §C query returns no rows after any ingestion |
| 20 | `season_period` of an existing edition is never updated by a re-ingest |
| 21 | `provider_external_id` of an existing edition is never overwritten by a different value |

**#21 catches the F-1b flip-flop**, which no count-based test would see.

---

## G. DECISION

### Recommended: **D-4** — add the missing alternate-key constraint and resolve on it

One constraint, one resolver change, no key change, no column, no data movement.

**Why D-4 and not the others:**

- **Not D-1.** It fixes a string, not the class. The next label nobody
  anticipated splits a season again, silently, and F-1b remains live.
- **Not D-2.** Correct behaviour with no guardian. U-9 accepted exactly that
  posture, but only because PostgreSQL structurally *could not* enforce the
  invariant on a partitioned relation. `competition_edition` is unpartitioned;
  here the engine can hold the line, and accepting an unenforced invariant when
  an enforceable one is available would be choosing the weaker of two options for
  no reason.
- **Not D-3.** §5.6.6 forbids it in terms.

**Why the schema change is genuinely necessary, and small.** D-4 does not
introduce a new rule — it *implements one that already exists*. §5.6.6 says
provider identifiers "are unique and are enforced as such"; five sibling
relations enforce theirs; `competition_edition` alone does not. The constraint
also makes the alternate key a legal `ON CONFLICT` target, which removes the need
for the SELECT-then-upsert dance D-2 would require. **The migration is one
`ALTER TABLE … ADD CONSTRAINT` against an empty relation.**

`season_period` stays the business key, keeps the no-overlap exclusion, keeps
LC-04, and answers "which season was active on this date" exactly as designed. It
simply stops being the thing the writer resolves on — the same correction U-9
made for `fixture_partition_on`.

### Two questions the design record does not settle — **UNRESOLVED, for your decision**

1. **Should the constraint include a `provider_code` column?** `competition_edition`
   has none. `venue` and `official` also omit it; `competition`, `team` and
   `player` include it. V2 is single-provider today (`PROVIDER_CODE` is a
   constant). Adding the column is a larger change than the constraint itself.
   **My inclination: omit it now**, matching `venue`/`official`, and treat
   multi-provider support as one change when it is actually needed — but this is
   a schema decision and it is yours.

2. **What should an unparseable label do?** Today it silently invents a period.
   The alternatives are to derive from the season's own fixture span (which
   cannot be known from the first fixture), or to **refuse the edition and reject
   the fixture with a stated reason**. Refusing is consistent with how this
   codebase treats unmapped values elsewhere — an unmapped currency is refused, an
   unmapped status seals by default — but it would drop fixtures for any
   competition whose label the parser cannot read, which on a 56-competition
   sweep could be several. **This needs deciding before implementation**, because
   it determines what `seasonPeriod` returns rather than how it is used.

### Scope of the implementation, when authorised

**In:** export and correct `seasonPeriod`; add
`uq_competition_edition__provider_external_id`; change
`resolveCompetitionEdition`'s conflict target to the alternate key; make
`season_period` immutable on update (as `fixture_partition_on` already is); the
21 tests of §F; the §C quality assertion.

**Out:** any change to `(competition_id, season_period)` as the business key; any
change to the exclusion constraint; any repair migration; any change to fixture
identity or partitioning; the sweep.

---

**Nothing in this report has been implemented. Awaiting a decision on D-4 and on
the two unresolved questions above.**
