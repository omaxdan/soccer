# Phase 8 — Season statistics as cumulative snapshots: can deltas carry V2?

**Answer, in one line: SPLIT. For season statistics — plausible, unproven, and
it forces a migration and the PD-16 decision. For appearance intelligence — NO,
and a prior audit already answered this.**

The hypothesis under test:

> Season statistics may be a more practical authoritative baseline than
> event-player statistics, with snapshot-to-snapshot deltas reconstructing
> additive cumulative measures.

Assessment only. No code, schema, migration, test or provider call. **Zero quota
consumed.**

---

## 0. Two findings that must come first

### 0.1 There is not one season-statistics payload in this repository

`backend/docs/api-samples/` and `beta/backend/docs/api-samples/` contain **one
file each: `README.md`.** The README says why:

> **This directory starts empty.** Files appear automatically the first time each
> sync job runs after this feature was added.

`player-stats/A.json`, `team-stats/A.json` and the rest **were never captured**.
So every statement below about the payload comes from **the V1 mapper**, whose
own header says *"Sources (confirmed response structure from real API samples)"*
— written against real responses by someone who had them, but not the responses
themselves.

**That is second-hand evidence, and it bounds this assessment hard.** It
establishes field **names** and the **envelope**. It does **not** establish that
any value is cumulative, what it is null when absent, or whether a lower-tier
competition returns the same fields. Question 2 — *"are the values cumulative
season-to-date snapshots?"* — **cannot be answered from this repository**, and
answering it is the first item in §15.

### 0.2 This hypothesis was already assessed, and rejected — for one of its two uses

[Doc 33](./33-phase8-competition-context-investigation.md) §5, *"Minute-delta
feasibility — definitive answer"*:

> ### 5.1 Verdict: **not feasible, and superseded**
> **The minute-delta approach is unnecessary, and building it would be a
> mistake.**

That verdict is **binding on the appearance question and is not overturned by
anything found here** — §11 shows the new evidence *strengthens* two of its three
reasons. But doc 33 was answering *"can deltas replace `football.appearance` for
rotation detection?"* It was **not** asked *"are cumulative season snapshots a
sound way to populate `provider_statistic` and season-progression features under
a 200/day cap?"* That second question is genuinely open, and §13 answers it.

Conflating the two is the main risk in this proposal, which is why §10 separates
them line by line.

---

## 1. Provider evidence

| Evidence | Where | What it establishes | Grade |
|---|---|---|---|
| `syncSeasonStatistics.ts` | `beta/backend/src/jobs/` | both endpoint paths, both envelopes, **110 player field names**, 30 team field names | **second-hand — names only** |
| `player_season_statistics` upsert | same, `:438` | V1's identity key, and that it **overwrites in place** | direct |
| Season-feed captures ×7 | `docs/api-samples/v2-discovery/` | the fixture universe, `hasEventPlayerStatistics`, competition 325 only | **first-hand** |
| `docs/api-samples/*/README.md` | both V1 trees | the sampling mechanism exists, at zero API cost, and **was never run** | direct |
| `football.provider_statistic` DDL | `004_football.sql:325` | no temporal column; one row per subject per edition per domain | direct |
| `football.standing` / `player_valuation` DDL | `004:376`, `004:291` | the design's **existing** pattern for a dated observation series | direct |
| Doc 33 §5, doc 35 §11 | `docs/db-v2/` | the prior verdict and the AC-4 gate | direct |

## 2. Endpoint and payload structure

Both are **per team, per tournament season**. Neither is registered in V2.

```
GET /teams/{teamId}/tournament/{tournamentId}/season/{seasonId}/player-statistics
GET /teams/{teamId}/tournament/{tournamentId}/season/{seasonId}/statistics
```

`syncSeasonStatistics.ts:262-268` records that these paths were **corrected
against the live API**: `teams` plural, `tournament` singular with no `unique-`
prefix, and the value passed for `tournamentId` is `uniqueTournament.id` — the
same identifier V2 already stores on `football.competition`.

**Player-statistics envelope** (`:277`, both wrappings handled):

```
{ playerStatistics: [ { player: { id, … }, statistics: { …110 fields… },
                        playedEnough: boolean } ] }
{ data: { playerStatistics: [ … ] } }
```

**Team-statistics envelope** (`:507`): `{ statistics: { …30 fields… } }` — one
object, not an array.

`playedEnough` is a **provider-derived qualification flag**, not a measure. It is
not reconstructible and not additive.

## 3. Cumulative vs non-cumulative

**UNVERIFIED — no payload exists.** What can honestly be said:

| Reading | Support |
|---|---|
| The values are season-to-date cumulative totals | **Strong but circumstantial.** `appearances`, `matchesStarted`, `minutesPlayed`, `goals`, `totalRating`/`countRating` are counters by name; V1 stores them as season aggregates keyed by season; doc 35 §1 calls the endpoint's output *"season totals scoped to one tournament season"* |
| Some values are per-90 or per-match rates | **Not excluded.** Providers in this family publish several of these per-90. `expectedGoals`, `keyPasses`, `touches`, `kilometersCovered` are the plausible candidates, and **nothing in this repository distinguishes the two readings** |

**The entire hypothesis rests on precondition 1 — "the provider statistic is
cumulative" — and precondition 1 is exactly what cannot be checked here.** This
must not be assumed; it must be captured.

## 4. Additive vs non-additive — the 110 fields

Classified by name from the mapper. Percentages, ratios and rankings are
identified structurally; the rest is a *candidate* class, subject to §3.

| Class | Count | Delta-safe? | Examples |
|---|---|---|---|
| **Candidate additive counters** | **97** | **yes, if cumulative** | `minutesPlayed`, `appearances`, `matchesStarted`, `goals`, `assists`, `yellowCards`, `redCards`, `totalShots`, `tackles`, `saves`, `touches`, `kilometersCovered`, `numberOfSprints`, `cleanSheet`, `expectedGoals`, `expectedAssists`, `ownGoals`, `totwAppearances` |
| **Percentages** | **9** | **NO** | `accuratePassesPercentage`, `accurateLongBallsPercentage`, `accurateCrossesPercentage`, `goalConversionPercentage`, `successfulDribblesPercentage`, `tacklesWonPercentage`, `groundDuelsWonPercentage`, `aerialDuelsWonPercentage`, `totalDuelsWonPercentage` |
| **Ratios** | **2** | **NO** | `penaltyConversion`, `setPieceConversion` |
| **Average** | **1** | **see below** | `rating` |
| **Extremum** | **1** | **NO — never** | `topSpeed` (a season maximum; a delta is meaningless and a decrease is normal) |
| **Provider-derived flag** | **1** | **NO** | `playedEnough` |

### 4.1 The finding that matters: every ratio here is reconstructible

**All nine percentages and both ratios are quotients whose numerator AND
denominator are both in the payload as counters.** Reconstruct the interval
value from the components, never by subtracting the ratio:

```
accuratePassesPercentage over (T1,T2]  =  Δ accuratePasses / Δ totalPasses
tacklesWonPercentage                   =  Δ tacklesWon     / Δ tackles
groundDuelsWonPercentage               =  Δ groundDuelsWon / (Δ groundDuelsWon + Δ duelLost)   ⚠ see below
goalConversionPercentage               =  Δ goals          / Δ totalShots
penaltyConversion                      =  Δ penaltyGoals   / Δ penaltiesTaken
```

And the one that is usually assumed lost:

> **`rating` is an average, and the provider ships its own numerator and
> denominator: `totalRating` and `countRating`.**
> `rating over (T1,T2] = (totalRating₂ − totalRating₁) / (countRating₂ − countRating₁)`

That is a **DERIVED** value from two OBSERVED counters, not an INFERRED one — a
materially better provenance rank than a subtracted average would carry. Doc 33
§5 did not have this; it does not change doc 33's verdict, but it is the single
strongest technical point in the proposal's favour.

⚠ **Two cautions.** `duelLost` and `aerialLost` are *lost* counts, so any duel
percentage must be rebuilt from won/(won+lost) and the identity checked against
the provider's own value at T2 before being trusted. And **no reconstruction is
valid when the denominator delta is zero** — a player with no tackles in the
interval has no tackle-success rate, and writing 0 would be a fabricated
observation of the class this programme refuses.

## 5. Snapshot-delta feasibility against the five preconditions

| # | Precondition | Status |
|---|---|---|
| 1 | the statistic is cumulative | **UNVERIFIED** — §3. No payload |
| 2 | the statistic is additive | **97 of 110 candidate yes; 12 no, of which 11 are reconstructible from components** — §4 |
| 3 | player identity is stable | **conditionally yes** — §6 |
| 4 | the snapshots are comparable | **NO at the estate scale the budget forces** — §8 |
| 5 | snapshot timing is known well enough | **depends entirely on the intended use** — §8 |

**And the structural blocker that precedes all five:**

> **`football.provider_statistic` cannot hold two snapshots.** Its unique key is
> `(subject_kind_code, player_id, team_id, affiliation_team_id,
> competition_edition_id, statistics_domain_code, provider_code)` — **there is no
> `as_of_on` and no date of any kind**, and it carries `created_at`/`updated_at`,
> i.e. overwrite-in-place. A second observation *replaces* the first.
>
> This is not an oversight to route around. `football.standing` and
> `football.player_valuation` both carry `as_of_on` in their unique key and are
> append-only — **the design knows exactly how to model a dated observation
> series and deliberately did not do so here.** Doc 33 §5.1 row A recorded the
> same thing.

**So the proposed architecture is structurally impossible today and requires a
migration on the relation whose governance question is already open.** That is
not a detail; it is the decision (§12).

## 6. Player identity and transfers

| Question | Answer |
|---|---|
| **Can a player be followed across snapshots?** | Yes at the provider — `player.id` is stable, and `football.player` keys on `(provider_code, provider_external_id)` under LC-02 |
| **What happens on transfer?** | The endpoint is **per team**. A player who moves clubs mid-season leaves club A's response and appears in club B's, **starting from zero or near it.** A naive delta on such a player yields a large negative for club A and a spurious positive for club B |
| **Does V2 handle this?** | **Yes, by design.** `provider_statistic.affiliation_team_id` is in the unique key, and its COMMENT names this exact case: *"THE IDENTITY INCLUDES THE AFFILIATION CLUB, which is what makes a mid-season transfer and dual-competition participation representable — the previous platform's identity rule permitted one record per player per season and could represent neither (LC-19)"* |
| **Does V1?** | **No.** `upsert(… { onConflict: 'player_id,season_external_id' })` (`:438`) omits the team, so a transferred player has one row overwritten by whichever club synced last. This is the defect LC-19 exists to fix, observable in the code |
| **What happens if a player has not appeared?** | **Unknown, and it matters.** Either they are absent from `playerStatistics` or present with zeroes. Absent-vs-zero is the same distinction `participation_state_code` was built for (LC-16), and **"never treat absence as 0"** is already a stated V2 control (doc 33 §10.1). No payload exists to check which the provider does |

So transfers are survivable **only if the delta is computed per
`(player, affiliation_team, edition)`**, exactly as the existing key is shaped —
never per `(player, season)`. Cross-club season totals must be *summed from*
per-affiliation series, never differenced across them.

## 7. Historical corrections

| Question | Answer |
|---|---|
| Can a later snapshot decrease a cumulative value? | **Yes** — a provider restating a disallowed goal, a rescinded card, or a corrected minute count. Doc 33 §5.3 states the rule: *"a decrease is a correction, not negative minutes"* |
| Does the provider expose enough to detect a correction? | **A decrease is self-evident. A compensating correction is not.** If a match is restated downward while another interval is restated upward, the net delta can look normal. Nothing in the payload carries a revision marker, a version, or a last-modified timestamp |
| Does V2 have a place for this? | **Yes, and it is already exercised.** `football.result_revision` records an amended CONFIRMED result carrying the *previous* figures (LC-17), and `recordResult` implements it. The same discipline would apply here: an observed decrease is a **revision record**, never a silent overwrite and never a negative delta |

**A snapshot series therefore has to be append-only to be sound at all** — which
is the opposite of `provider_statistic`'s current mutable shape, and another
reason the migration in §5 is unavoidable rather than optional.

## 8. Snapshot timing — where the proposal is weakest

The delta's meaning is entirely determined by what happened between the two
observations, and the endpoint's per-team cost sets that interval.

**A "snapshot" at estate scale is not an instant. It is a smear.** V1's own
operating point, from the file header:

> 766 teams / 21 days ≈ 36/day […] `player-statistics`: 21-day cooldown, capped
> at 40 teams/run; `team-statistics`: 21-day cooldown, capped at 40 teams/run

So V1's "snapshot" of the estate takes **21 days to complete**, during which
every team is observed once, on a different day, after a different number of
matches. Differencing two such passes gives, per player, *"the change across
however many matches fell between their own two observations"* — which is not a
common interval, not a fixture-aligned interval, and not comparable across
players. **Precondition 4 fails at this cadence, and precondition 5 fails for
any fixture-resolved use.**

### 8.1 The steelman: per-round snapshots

If a snapshot is taken **per competition, after every round**, the interval
contains exactly one league fixture per team — and then the delta *is*
match-attributable. Priced honestly for V2's estate:

| | |
|---|---|
| Teams per competition (measured, 325/87678) | 20 |
| 56 tracked competitions | **1,120 team-season pairs** |
| One player-statistics pass | **1,120 calls** |
| Rounds per week | ~1 |
| **Sustained cost** | **1,120 calls/week = 160/day of a 200/day budget** |
| Left for fixtures, standings, squads, everything else | **40/day** |

The fixture sweep alone is ~224 calls (doc 38 §"56 tracked competitions"). **It
does not fit**, and that is before team-statistics doubles it. Doc 33 §5.2(c)
reached the same conclusion from a smaller estate: *"Even one observation per
team per competition per week does not fit."*

### 8.2 Even at per-round cadence, the interval is not guaranteed to be one match

Midweek rounds, postponements (four in the observed window alone), and
rescheduled fixtures all put two league matches inside one interval, and doc 33
§5.3 names the failure: *"A delta cannot distinguish 90 minutes in one match from
45 + 45 across two matches."* Congested weeks — when rotation actually happens —
are exactly when this breaks.

**One thing does work in the proposal's favour** and deserves stating: the
endpoint is scoped to a single tournament season, so **cup and continental
minutes never contaminate a league delta.** Doc 33 §5.2(b) frames this as a
blindness — and for rotation detection it is — but for *league* season
progression it is a clean boundary.

## 9. Call-budget estimate

| Model | Calls per complete pass | Days at 200/day | Verdict |
|---|---|---|---|
| Player stats only, whole estate | 1,120 | **5.6 days** | a pass is a smear, not a snapshot |
| Player + team stats | **2,240** | **11.2 days** | and nothing else runs |
| Per-round, player only (match-attributable) | 1,120/week = **160/day** | continuous | **does not fit** with fixtures |
| Per-round, player + team | 320/day | — | **exceeds the cap outright** |
| V1's actual operating point | 40+40/day, 21-day cycle | 21 days | fits, but §8 applies |
| One competition, one snapshot, both endpoints | **40** | — | **affordable, and this is the pilot** |

**Question 18 — can one pass serve both player and team needs?** No. They are
**two distinct endpoints**, each one call per team. Team statistics are not
derivable from player statistics: `averageBallPossession`, `shotsAgainst`,
`cornersAgainst` and `bigChancesAgainst` are opponent-relative and appear in no
player row.

## 10. What this can and cannot reconstruct — the classification asked for

**Season statistics ≠ match appearance facts.** Every requirement, judged against
per-round snapshots (the *most* favourable cadence, §8.1):

| Requirement | Classification | Why |
|---|---|---|
| Season totals per player per club per competition | **directly available** | this is exactly what the endpoint returns |
| Season progression / form trend | **derivable from snapshots** | successive deltas of additive counters |
| Interval averages and percentages | **derivable** | from component counters, §4.1 — never by subtracting the ratio |
| **Player appeared in a match** | **derivable, conditionally** | `Δappearances = 1` **and** the interval provably contains exactly one league fixture. Fails on §8.2 |
| **Starter vs substitute** | **derivable, conditionally** | `ΔmatchesStarted = 1` ⇒ started; `Δappearances = 1, ΔmatchesStarted = 0` ⇒ came on. Same condition, same failure |
| **Minutes in a specific match** | **derivable, conditionally** | `ΔminutesPlayed`. Same condition |
| **Unused substitute vs not selected** | **UNAVAILABLE** | both produce Δ = 0 on every counter. `participation_state_code` needs the **bench**, and no season aggregate contains it (LC-16) |
| **Substitution in/out minute** | **only from event-level data** | no season counter carries a minute |
| **Player-specific cards in a match** | **derivable, conditionally** | `ΔyellowCards`, `ΔredCards`, `ΔdirectRedCards`, `ΔyellowRedCards` |
| **Player-specific goals/assists in a match** | **derivable, conditionally** | `Δgoals`, `Δassists` |
| **Position in a specific match** | **UNAVAILABLE** | no positional field in the season payload; the squad endpoint gives a *season* position, not a per-fixture one |
| **Formation** | **UNAVAILABLE** | team-level, per fixture; `football.lineup.formation` has no season-aggregate source |
| **The full XI observed** | **UNAVAILABLE** | requires knowing who did *not* play, which requires the bench |
| **Officials** | **UNAVAILABLE** | absent from every known endpoint |

**Three of the four `participation_state` codes are unreachable.** `STARTED` and
`SUBSTITUTED_ON` are conditionally derivable; `UNUSED_SUBSTITUTE` and
`NOT_SELECTED` are **indistinguishable in any aggregate**, and distinguishing
them is the stated reason the column exists.

And `football.appearance` requires `minutes_played` **NOT NULL** with
`CHECK (0..150)` — so a fixture whose interval was ambiguous cannot be written at
all. **There is no degraded mode.**

## 11. Impact on G-1

**G-1 is not answered by this, and the case against deltas as an appearance
source is now stronger than when doc 33 wrote it.**

| Doc 33 §5.2 reason | Status now |
|---|---|
| **(a) two-rank provenance downgrade** — a delta is `INFERRED` (rank 2) where `appearance.minutes_played` is `OBSERVED` (rank 4), and S-5 caps every composite at its weakest input | **UNCHANGED and binding.** Verified against `football.provenance_class`: OBSERVED 4, DERIVED 3, INFERRED 2, ESTIMATED 1 |
| **(b) the aggregate is per-competition, so the delta is blind to cup minutes** | **UNCHANGED** for rotation detection; §8.2 notes it is a *virtue* for league progression |
| **(c) the quota arithmetic forbids it** | **STRENGTHENED.** Doc 33 priced ~76 teams; the V2 estate is ~1,120 team-season pairs, and §9 shows per-round cadence needs 160/day of 200 for player statistics alone |

Doc 35 §11 states the governing rule and it is unaffected:

> **AC-4 is not runnable, and must not be weakened to make it so.** Substituting
> season aggregates for per-fixture minutes would satisfy the letter of steps 6
> and 8 while destroying their meaning.

The user's own report that `/match/{id}` advertises `hasEventPlayerStatistics:
true` yet **does not carry the player collection** is the important new fact: it
removes the last registered candidate. G-1's source, if it exists, is an endpoint
nobody in either codebase has named — and the capability flag says one exists.

> **G-1 remains BLOCKED. Season snapshots do not close it, and must not be
> presented as closing it.**

## 12. Impact on `provider_statistic` and PD-16

**This is where the proposal forces a decision rather than deferring one.**

PD-16 permits an opaque payload only for *"retained provider responses […] never
queried by content in a production read path"* and prohibits it for *"any value
that is queried, aggregated, joined, or explained."*

> **A snapshot-to-snapshot delta is, definitionally, a value that is queried and
> aggregated.** `measures→>'minutesPlayed'` read at T1 and T2 and subtracted is
> the prohibited case, stated almost word for word.

So the two readings of `provider_statistic` are no longer both available:

| If `provider_statistic` is… | Then |
|---|---|
| **A — an opaque audit relation** | the current jsonb DDL is correct, **and the snapshot-delta architecture cannot use it.** Deltas would need a separate, columnar, dated relation. `provider_statistic` stays a write-only archive |
| **B — a production feature source** | **PD-16 requires columnar measures per domain** — the seven `statistics_domain` codes become enumerated relations. A substantial migration, plus the temporal key of §5 |

**Adopting the snapshot-delta architecture selects B.** Not as a preference — as
a consequence. It also answers the 004 TODO that has been open since Phase 6:

> If the intent was columnar measures per domain, **the domain relations must be
> enumerated before DDL is finalised.**

The 110 field names in §4 are that enumeration, mapping cleanly onto the seven
existing domains — `PARTICIPATION` (appearances, matchesStarted, minutesPlayed,
totalRating, countRating), `ATTACKING`, `CREATION`, `DEFENDING`, `DISCIPLINE`,
`GOALKEEPING` (24 fields), `PHYSICAL` (kilometersCovered, numberOfSprints,
topSpeed). **The vocabulary was built for exactly this payload.** That is
suggestive of original intent B — but it is inference, not evidence, and the
governance decision is not mine to take.

**No implemented V2 feature reads `provider_statistic` today** — the Stage-1
calculators read `fixture`, `result`, `venue`, `team`, `player_registration` and
`player_availability` only. So nothing is broken either way, and the decision is
still free.

## 13. Recommended architecture

Split by use, because the evidence splits by use.

**For season statistics — a PILOT, not an architecture.** The hypothesis's first
precondition is unverified and the cheapest way to verify it costs **zero extra
provider calls** (§15). Recommend: capture the two payloads, verify
cumulativeness across two real snapshots of one competition, and only then
design. Committing to a schema for a payload nobody in this repository has seen
would repeat the mistake the 004 TODO records.

**If the pilot confirms cumulativeness**, the shape the architecture already
implies:

- **Layer 1 — observation.** A dated, append-only cumulative snapshot series,
  keyed `(player, affiliation_team, edition, domain, as_of_on)` — the
  `football.standing` pattern, which already exists and works. Columnar, not
  jsonb, per §12. Provenance **OBSERVED**.
- **Layer 2 — reconstruction.** The delta is a **calculation**, not an
  observation, and belongs in `feature.feature_value`, which is append-only,
  carries `as_of`, and records lineage. Provenance **DERIVED** where both
  endpoints of the interval are observed; the ratio reconstructions of §4.1 are
  DERIVED too. **Never OBSERVED.**
- **Corrections** as revision records, never overwrites (§7).
- **Never** write `football.appearance` from a delta (§10, §11).

**For appearance intelligence — do not build this.** Doc 33 §5.4 already states
the alternative and nothing found here disturbs it: *"Populate
`football.appearance`. It needs no schema change. It needs a provider endpoint
and an ingestion stage."*

## 14. Provider capability variability — and the guard

**The correction is well taken and the evidence is thinner than the previous
document implied.**

| Fact | Evidence |
|---|---|
| `hasEventPlayerStatistics: true` on 86/86 played fixtures, absent on all 30 unplayed and all 4 postponed | first-hand, `docs/api-samples/v2-discovery/` |
| **All of it is from ONE competition** — 325, Brasileirão Série A, a top-tier league | **n = 1.** Nothing is known about tier B/C or lower leagues |
| **No code anywhere reads these flags** | `grep` for `hasEventPlayerStatistics`, `hasEventPlayerHeatMap`, `hasXg`, `detailId` across every `.ts`/`.tsx` in the repository returns **nothing**, in V1 and V2 alike |
| The tier-coverage question is *already* open and V1 built the tool for it | `api-samples/README.md`: *"does a Category B or C league's player-stats response have the same ~80 fields as a Category A league, or a sparser subset?"* — **never answered, because the directory was never populated** |
| A `true` flag does not imply a payload | **now first-hand from the operator's own `/match/{id}` call**: the flag was `true` and the player collection was absent |

So there is no existing handling to inspect, no precedent to follow, and the last
line is decisive: **the flag is a provider assertion about a capability, not a
guarantee about a response.** Any future design must treat all five states as
ordinary, expected outcomes:

| State | Required posture |
|---|---|
| present + `true` | *may* attempt the player path — and must still validate the payload |
| present + `false` | do not request; record the coverage fact |
| **absent** | **treat as `false`**, never as `true`, and never as an error |
| `true` but payload missing/empty | **the observed case.** Not a failure — a coverage fact, counted and logged, never a fabricated row |
| malformed value | refuse and count, per the existing `asRecord`/`nonNegativeInt` discipline |

And explicitly: **`uniqueTournament.hasEventPlayerStatistics` is a season-level
assertion and must never be read as a per-fixture guarantee.** In the one
competition observed, the season flag was `true` while four individual fixtures
carried no flag at all.

The same caution applies to §3 and §4: **the 110 fields are what a tier-A
Brazilian league's mapper reads.** A lower-league response may carry a fraction
of them, and a delta over a field that is present at T1 and absent at T2 is not a
decrease — it is a coverage change, and must be distinguishable from one.

## 15. Remaining unknowns, and the cheapest way to close them

| # | Unknown | Cost to close |
|---|---|---|
| **1** | **Are the values cumulative?** The whole hypothesis | **2 calls** — one team, two dates, one competition. Or **0 calls**: V1's `logApiSample` captures on the next normal sync |
| 2 | Absent vs zero for a player who has not appeared | same 2 calls |
| 3 | Field coverage by tier | **0 extra calls** — V1's mechanism, already built, `refresh:api-samples` |
| 4 | Are `expectedGoals`, `touches`, `kilometersCovered` totals or per-90? | same capture |
| 5 | Does a transferred player vanish from the old club's response, or persist frozen? | one capture across a transfer window |
| 6 | Is there a revision or last-modified marker? | same capture |
| 7 | Teams per competition across all 56 (the budget depends on it) | already in V2's database — a SQL count, **0 calls** |
| 8 | **Which endpoint serves event-player statistics** | the G-1 blocker, unchanged. `/match/{id}` is now excluded |

**Unknown 1 gates everything.** Until a real payload shows the same player's
counter increasing across two dates, this is a hypothesis about the provider, not
an architecture.

---

## Future implementation scope — DEFINED, NOT STARTED

**Step 1 — capture (2 calls, or 0).** One competition already in V2 —
`uniqueTournament 325`, `season 87678`, whose 20 teams and their identifiers are
already ingested. Capture both endpoints for one team into
`docs/api-samples/v2-discovery/`. Repeat after one round has been played.
**Deliverable: an evidence document answering unknowns 1–4 and 6. No schema, no
writer.**

**Step 2 — the PD-16 governance decision (§12).** A/B, taken explicitly and
recorded. **Blocked on Step 1**, because option B's enumeration must be drawn
from an observed payload, not from V1's mapper.

**Step 3 — schema, only if Step 2 chooses B.** A dated, append-only, columnar
snapshot series on the `football.standing` pattern; revision handling per §7. One
migration. **Blocked on Step 2.**

**Step 4 — ingestion, one competition, bounded.** ≤40 calls, explicit CLI window,
per-relation write records, resume point. **Blocked on Step 3.**

**Step 5 — delta reconstruction as a Layer-2 calculator.** Additive counters
only; ratios from components; DERIVED provenance; a zero denominator yields
null, never zero; a decrease raises a revision, never a negative. **Never writes
`football.appearance`.** **Blocked on Step 4.**

**Acceptance criteria are deliberately not written for Steps 3–5.** Writing them
now would require asserting the payload's semantics, which §0.1 establishes
nobody in this repository has seen.

**Explicitly out of scope and unchanged:** `football.appearance`, `lineup`,
`lineup_selection`, `match_event`, `official`, `official_assignment` — all still
blocked on G-1; U-10; the forward window; F-2 and F-3.

---

**Nothing implemented. No schema, migration, code, test or provider call. Zero
quota consumed.**
