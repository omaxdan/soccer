# Phase 8 — F-1 Fixed: Competition Edition Identity

Implements decision **D-4** of [doc 41](./41-phase8-f1-competition-edition-identity.md).
One migration, one resolver, one derivation. **No provider calls, no sweep, no
production data repair.**

---

## The two decisions

### Decision 1 — `UNIQUE (provider_external_id)`, not `(provider_code, provider_external_id)`

Doc 41 tentatively suggested `(competition_id, provider_external_id)`. **That was
wrong, and the repository says so.** The convention in `004_football.sql` is
consistent and structural, not stylistic:

| Provider identity | Shape | Relations |
|---|---|---|
| **Mandatory** | `provider_code NOT NULL` + `provider_external_id NOT NULL` + `UNIQUE (provider_code, provider_external_id)` | `competition`, `team`, `player` |
| **Optional** | no `provider_code` column + nullable `provider_external_id` + `UNIQUE (provider_external_id)` | `venue`, `official` |

`competition_edition` has **no `provider_code` column** and a **nullable**
`provider_external_id`. It is structurally in the second group and takes the
second form. Adding `provider_code` purely to permit the two-column shape would
be inventing a column to satisfy a pattern this relation does not belong to —
which the brief explicitly forbade, and which the convention independently
rejects.

`NULLS DISTINCT` (the default) is deliberate: several editions whose season the
provider does not identify must coexist. That is the opposite of migration 020's
`NULLS NOT DISTINCT` cases, where a null-bearing identity had to collide.

**A consequence worth stating.** The single-column form is **global**, so one
provider season cannot sit under two competitions. That is stricter than the
`(competition_id, …)` form and it is correct — a season id under a second
competition is a data error, not a legitimate state. It also created a new
requirement, handled below.

### Decision 2 — the period comes from `season.year`

**The provider supplies no season dates.** LIVE VERIFIED from
`docs/api-samples/v2-discovery/tournament_seasons__tournamentId-325.json`: the
keys of every season entry are exactly `id`, `name`, `year`, `tournamentId`. The
brief's preferred branch — "if the provider payload contains explicit start/end
dates, prefer those" — is **unavailable**, and no other captured endpoint carries
them.

The strongest source that does exist is **`season.year`**, and the old code
preferred the wrong field:

| Field | Across all 25 captured seasons of competition 325 | Example |
|---|---|---|
| `season.name` | **prose, with sponsors** | `"Brasileirão Betano 2024"`, `"Brasileiro Serie A 2026"` |
| `season.year` | **exactly two machine shapes** | `"2026"`, `"20/21"` |

`season.year` is present on every event of every captured page and on every entry
of the seasons list. **The old code read `name` first**, which never parsed, and
fell through to the fixture's kickoff. That preference is the root of F-1.

Rules, unchanged in convention:

| Year token | Period |
|---|---|
| `2026` | `[2026-01-01, 2027-01-01)` |
| `2020/2021`, `2020/21`, `20/21` (also `-`, `–`) | `[2020-07-01, 2021-07-01)` |
| anything else | **`null` — refused** |

Two-digit years use a pivot at 50, so `99/00` is 1999/2000. A split token whose
second year is not the first plus one (`2025/2027`) is refused as ambiguous.

**`season.name` is a fallback, not a second chance.** `seasonPeriod` accepts only
a *whole-string* year token, so a prose name still refuses. Nothing is ever
extracted from prose — that is the trap the tempting one-line fix falls into, and
`"Copa 2000 Trophy 2026"` is refused rather than resolved to either year. The
fallback exists because a payload may carry a clean token in `name` and no
`year`; it cannot rescue prose.

**An unparseable season is an explicit failure.** The edition is not created, the
fixture is rejected with a stated reason on both `football.competition_edition`
and `football.fixture`, and a warning names the season and its year token. This
follows `mapCurrency`, which refuses rather than substituting.

---

## Root cause, restated

`stages/schedule.ts` previously read
`seasonLabel = season.name ?? season.year ?? <kickoff year>`, passed it to
`seasonPeriod(label, kickoff)`, and — when neither regex matched — derived the
period from **that fixture's own kickoff**, hinging on 1 July. The resolver's
conflict target was that derived period. So:

- **F-1**: one season whose fixtures straddle 1 July → two periods → **two
  editions**. REPLAY OBSERVED: 5 fixtures in `[2025-07-01, 2026-07-01)`, 42 in
  `[2026-07-01, 2027-07-01)`.
- **F-1b**: two seasons of a calendar-year league → the 2025 season's second half
  and the 2026 season's first half both derive `[2025-07-01, 2026-07-01)` →
  **one edition for two seasons**, with `provider_external_id` flip-flopping
  between them on every re-ingest.

The edition cache made it invisible: it keyed on the derived period, so two
periods were two cache entries.

---

## The exact migration

`v2/migrations/022_competition_edition_provider_alternate_key.sql`

```sql
ALTER TABLE football.competition_edition
  ADD CONSTRAINT uq_competition_edition__provider_external_id
  UNIQUE (provider_external_id);
```

Preceded by a precondition block that **refuses to run** if any
`provider_external_id` already resolves to more than one edition, naming the
offending seasons — because that is F-1 having already happened, and repair means
choosing a surviving edition and repointing nine foreign keys across five
schemas. That is a governed reconciliation, not a schema change, and the
migration does not attempt it. A `NOTICE` reports the row count and names R-43 if
the relation is populated.

**Nothing is demoted.** `uq_competition_edition__competition_period
(competition_id, season_period)` remains the business key and
`ex_competition_edition__periods_do_not_overlap` remains the overlap guarantee.
This adds the alternate key §5.6.6 already requires and every sibling already
has.

---

## The exact resolver change

`entities/reference.ts` — `resolveCompetitionEdition`:

```diff
-    conflictTarget: ['competition_id', 'season_period'],
+    conflictTarget: ['provider_external_id'],
+    immutableColumns: ['season_period', 'competition_id'],
+    returning: ['id', 'competition_id'],
```

plus two guards:

1. **`externalId` is required.** `ON CONFLICT (provider_external_id)` on a NULL
   never conflicts, so a null-identified season would insert a fresh edition on
   every sync. The resolver throws; the stage rejects the fixture.
2. **A re-parent is refused, loudly.** Because the alternate key is global, a
   season arriving under a second competition *conflicts with the first* — and an
   upsert would have resolved it to the existing edition and silently repointed
   it, moving every fixture, standing and statistic of one competition under
   another. `competition_id` is immutable and the disagreement is reported:
   *"provider season X already belongs to competition A and arrived under
   competition B."*

**`season_period` is immutable.** It is half the business key, and LC-02 forbids
reassigning an identity once established — so a period widened by a later fixture
would be a business key mutating under its dependents. The same discipline
`fixture_partition_on` carries, for the same reason (U-9).

`stages/schedule.ts`:

```diff
-function seasonPeriod(label: string, kickoff: Date): { startsOn; endsOn }
+export function seasonPeriod(yearToken: string | null | undefined): SeasonPeriod | null
```

**The signature is the fix.** There is no kickoff to pass, so a period cannot
differ between two fixtures of one season. The edition cache key changed from
`${competitionId}:${period.startsOn}` to `${competitionId}:${seasonExternalId}`.

---

## Why F-1 and F-1b are both closed

| | F-1 — one season, two editions | F-1b — two seasons, one edition |
|---|---|---|
| **Derivation** | The period no longer sees a fixture, so one season yields one period however far apart its fixtures kick off | `2025` → `[2025-01-01, 2026-01-01)` and `2026` → `[2026-01-01, 2027-01-01)` are adjacent, never equal |
| **Resolution** | The conflict target is the season id, so a second fixture finds the first edition even if a period ever did differ | Two season ids are two conflict targets and cannot collide |
| **Enforcement** | `uq_competition_edition__provider_external_id` makes a second row for one season **impossible**, not merely unlikely | The same constraint |

**Three independent layers**, and each was mutation-tested separately. That
matters because the derivation fix alone masks the resolver fix in
stage-level tests — reverting the conflict target does *not* fail the F-1
scenario once periods are stable. Test 13 exercises the resolver directly (one
season offered under two periods) and is what catches it.

---

## Test evidence

**19 tests added** in `__tests__/editionIdentity.test.ts` — 7 pure, 12 against a
database.

| # | Test | Covers |
|---|---|---|
| 1 | four-digit calendar season | brief |
| 2 | `20/21`, `2020/21`, `2020/2021`, hyphen, en dash, whitespace | brief |
| 3 | two-digit pivot — `99/00` → 1999/2000 | |
| 4 | **the same season yields the same period, always** — `seasonPeriod.length === 1` | **F-1** |
| 5 | consecutive calendar seasons do not overlap | **F-1b** |
| 6 | prose, empty, `26`, `2025/2027`, `2026/2025` all refused | brief |
| 7 | `"Copa 2000 Trophy 2026"` refused, not resolved to either year | |
| 8 | repeated resolution returns the same edition | brief |
| 9 | two provider seasons stay two editions | brief |
| 10 | the alternate key is enforced by the database, on a **non-overlapping** period so only it can fire | brief |
| 10a | a season cannot be re-parented to a second competition | Decision 1 |
| 11 | `(competition_id, season_period)` still refuses a duplicate period | brief |
| 12 | a null season id is refused before anything is written | |
| 13 | `season_period` immutable; **one season under two periods is still one edition** | **F-1 at the resolver** |
| 13a | `season.year` wins when `year` and `name` disagree | Decision 2 |
| 14 | **Brasileiro 2026, May fixture + August fixture → ONE edition** | **F-1, end to end** |
| 15 | 2025 and 2026 seasons of one competition stay separate | **F-1b, end to end** |
| 15a | `name` used as a fallback only when it IS a year token | Decision 2 |
| 16 | an undatable season rejects the fixture; no edition invented | brief |

### Mutation testing

| Mutant | Caught by |
|---|---|
| Restore the fixture-kickoff fallback for an empty token | test 6 |
| Resolver conflict target back to `(competition_id, season_period)` | tests 10a, **13** |
| Prefer `season.name` over `season.year` | test **13a** |

The second and third initially **survived**, and the tests were strengthened
until they did not. Test 13's row-count assertion and test 13a exist for exactly
that reason.

### The replay proof, before and after

`fixtureReplay.test.ts` test 6a was a failing `todo`; it is now a passing
assertion. Replaying the four captured Brasileirão responses:

| | Before | After |
|---|---|---|
| `competition_edition` rows | **2** | **1** |
| `season_period` | `[2025-07-01,2026-07-01)` + `[2026-07-01,2027-07-01)` | `[2026-01-01,2027-01-01)` |
| Fixtures per edition | 5 + 42 | **47** |
| `team_registration` rows | **30** — 10 teams registered twice | **20** |
| `competition_stage` rows | 6, split across two editions | 6, on one edition |

### Suite counts

| | Before | After |
|---|---|---|
| `npm test`, **no database** | 334 pass / 334 | **341 pass / 341** |
| `npm test`, **with database** | 497 pass, 14 fail, 1 todo / 512 | **517 pass, 14 fail, 0 todo / 531** |
| `npx tsc --noEmit` | clean | **clean** |

**+19 tests, all passing. The `todo` is gone.**

**Pre-existing environmental failures — 14, unchanged, none in the edition or
fixture path.** Verified by filtering: no failure outside the known set. They are
per-role connection health (7), `ALTER ROLE` statement timeouts, unknown-credential
rejection, `UPDATE`/`DELETE` privilege denial (4), and one `pt_platform_admin`
privilege test. The scratch cluster uses trust auth and a single superuser login,
so grants and RLS cannot bite.

`lint:reads` reports 64 against a baseline of 57 — **unchanged by this diff**, and
unrelated (V1 supabase-js reads).

**Scratch database:** PostgreSQL 16, migrations 001–**022** applied with zero
errors, S-3 seed applied (146 rows). Harness-only accommodations, neither touching
the repository: `pg_cron` skipped, `auth.users`/`auth.uid()` stubbed. Torn down
after use.

---

## Production data repair: NONE REQUIRED

**No erroneous rows exist, and no repair migration is proposed.**

- The two rows of doc 40 were created inside a `BEGIN … ROLLBACK` in a scratch
  cluster since destroyed. Never committed.
- The fixture writer has never been authorised against a persistent database;
  only `seed:v2` has run, and it writes vocabularies, not editions.
- **Migration 022 verifies this itself.** Its precondition refuses to add the
  constraint if any provider season already resolves to more than one edition,
  and names them. If the real database is clean — as expected — the migration
  applies silently. If it is not, the migration stops and says exactly which
  seasons need reconciling **before** anything is enforced.

That is the verification the brief asked for, performed by the migration rather
than asserted in prose.

---

## Scope held

**Changed:** migration 022 (one constraint); `seasonPeriod` signature and
derivation; the edition branch of `ingestEvent`; `resolveCompetitionEdition`'s
conflict target and guards; 19 new tests; one `todo` closed.

**Not changed:** the business key `(competition_id, season_period)`; the overlap
exclusion; U-9's fixture partitioning, which is untouched and still proven by its
own 25 tests; the pager; any other ingestion stage; any provider call.

**Still gated:** the live single-competition sweep, the 56-competition sweep,
match-level fan-out, derived calculations, raw-response persistence, and the
forward-horizon decision.

---

## One thing left open

`football.competition_edition` has no `provider_code` column, so the alternate
key is single-provider by construction — correct today (`PROVIDER_CODE` is a
constant) and consistent with `venue` and `official`. If V2 ever ingests a second
provider, `venue`, `official` and `competition_edition` all need the same
treatment at once. **Recorded, not pre-solved.**
