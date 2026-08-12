# Phase 8 — `team.travel_distance` Empirical Verification

## Post-implementation / pre-consumption gate · READ-ONLY

| | |
|---|---|
| **Commit under verification** | `127da55` |
| **Verification** | **PASSED** — 20 real teams × 6 `as_of` instants, 0 discrepancies |
| **Database writes performed** | **NONE** — every transaction rolled back |
| **Feature values generated** | **0** |
| **Ready for preparedness consumption** | **YES**, subject to §19 |

---

## 1. Data source and environment

**The live V2 database was unreachable.** All outbound egress from this session
is denied at the agent proxy — `CONNECT` returns 403 for
`hdrnacnvqckgiqpayerp.supabase.co:443` and for an unrelated control host alike,
so the denial is environmental rather than target-specific. It was not retried.
No provider call was made and no quota was spent.

Verification therefore ran against **real provider data replayed into a local V2
database**:

| | |
|---|---|
| **Cluster** | local PostgreSQL 16.13, database `ptv2`, built from the real V2 migrations and the real seed |
| **Football data** | the four captured Brasileirão responses in `docs/api-samples/v2-discovery/` — competition `325`, season `87678` |
| **Ingestion path** | the REAL pager (`sweepSeason`) and the REAL S-4 writer (`ingestScheduleDate`), unmodified |
| **Read path** | the REAL `readCompletedFixtures`, `readHomeVenues`, `readVenueLocations`, called exactly as `buildContext` calls them |
| **Calculation** | the REAL `travelItinerary.calculate` and, for comparison, the REAL `travelLoad.calculate` |
| **Isolation** | one transaction, `BEGIN` … `ROLLBACK` in a `finally`. `writeValues` was never called |

This is the same universe doc 46 proved live: **47 fixtures, 43 completed, 20
teams, 20 venues, 2026-05-31 → 2026-08-09**, every venue carrying coordinates.
The fixtures, kickoffs, venues and coordinates are the provider's, not
invented ones. What is *not* claimed: this is not the live database, and these
values were not calculated by a live S-5 run.

**Post-run state, checked after every script:** `football.fixture` 53,
`football.venue` 4, `football.team` 4, competition `325` rows **0**,
`feature.feature_value` **0**, `feature.feature_lineage` **0** — identical to
the state before. Working tree clean at `127da55`.

## 2. Teams and sequences selected

All **20** real teams, not a sample. Coverage of the requested itinerary shapes,
from the real data:

| | Shape | Status |
|---|---|---|
| A | Home → Away → Home | **OBSERVED** — Palmeiras, Bahia, Cruzeiro, and 12 others |
| B | Away → Away | **OBSERVED** — Athletico (Neo Química → Urbano Caldeira), Atlético Mineiro, Chapecoense |
| C | Away → Home | **OBSERVED** — Bahia (Maracanã → Fonte Nova), Palmeiras, Vasco |
| D | Home → Home, same venue | **OBSERVED** — Coritiba ×2 at Couto Pereira; Red Bull Bragantino, Santos, Grêmio at other `as_of` |
| E | `is_neutral_venue = true` | **NOT OBSERVED IN CURRENT DATA** — 0 of 47. See §4 for the real near-case |
| F | Multiple away trips within 28 days | **OBSERVED** — Chapecoense (4 legs), Remo, Vitória |
| G | Fixtures spread beyond 28 days | **OBSERVED** — the 31 May round sits ~70 days before the August `as_of` |
| H | Missing venue / coordinates | **NOT OBSERVED IN REAL DATA** — all 20 venues located. Covered by pre-existing harness rows, labelled as such in §12 |
| I | High-distance sequence | **OBSERVED** — Remo, 9 270 km over 4 legs |
| J | Low-distance sequence | **OBSERVED** — Fluminense 6.7 km; Santos 332 km; several 0 km |

## 3. Reference timestamps and windows

Six `as_of` instants, each with `windowStart = as_of − 28 × 86 400 000 ms`:

| # | `as_of` | `windowStart` | Purpose |
|---|---|---|---|
| 1 | `2026-08-11T00:00:00.000Z` | `2026-07-14T00:00:00Z` | main reconciliation |
| 2 | `2026-09-06T00:00:00.000Z` | `2026-08-09T00:00:00Z` | window slid past most history |
| 3 | `2026-10-01T00:00:00.000Z` | `2026-09-03T00:00:00Z` | window empty for every team |
| 4 | `2026-08-28T00:30:00.000Z` | `2026-07-31T00:30:00Z` | a fixture EXACTLY at `windowStart` |
| 5 | `2026-08-28T00:30:00.001Z` | `2026-07-31T00:30:00.001Z` | the same fixture, one millisecond out |
| 6 | `2026-08-08T23:30:00.000Z` | `2026-07-11T23:30:00Z` | `as_of` EXACTLY at a fixture's kickoff |

## 4. Reconciliation — expected vs calculator

Expectations were derived independently, in Python, from the raw
`football.fixture` / `football.venue` records: own window arithmetic, own
ordering, own seed selection, own haversine. The calculator was not consulted.

**`as_of = 2026-08-11T00:00:00Z`** — EXPECTED FROM RAW DATA vs CALCULATOR OUTPUT:

| Team | legs (exp / calc) | expected km | calculator km | stored |
|---|---|---|---|---|
| Athletico | 3 / 3 | 794.457059770 | 794.457059770 | 794 |
| Atlético Mineiro | 3 / 3 | 3294.558103599 | 3294.558103599 | 3295 |
| Bahia | 4 / 4 | 4365.440734795 | 4365.440734795 | 4365 |
| Botafogo | 3 / 3 | 687.789903974 | 687.789903974 | 688 |
| Chapecoense | 4 / 4 | 4662.438527976 | 4662.438527976 | 4662 |
| Corinthians | 3 / 3 | 2954.901345197 | 2954.901345197 | 2955 |
| Coritiba | 3 / 3 | 781.081513848 | 781.081513848 | 781 |
| Cruzeiro | 4 / 4 | 4343.377030642 | 4343.377030642 | 4343 |
| Flamengo | 3 / 3 | 3303.325074731 | 3303.325074731 | 3303 |
| Fluminense | 4 / 4 | 2584.504890246 | 2584.504890246 | 2585 |
| Grêmio | 2 / 2 | 1031.566464414 | 1031.566464414 | 1032 |
| Internacional | 4 / 4 | 2871.830871124 | 2871.830871124 | 2872 |
| Mirassol | 3 / 3 | 1961.812313657 | 1961.812313657 | 1962 |
| Palmeiras | 4 / 4 | 3603.018812152 | 3603.018812152 | 3603 |
| Red Bull Bragantino | 3 / 3 | 675.774258740 | 675.774258740 | 676 |
| Remo | 4 / 4 | 9270.030790324 | 9270.030790324 | 9270 |
| Santos | 2 / 2 | 332.368982086 | 332.368982086 | 332 |
| São Paulo | 3 / 3 | 3853.540318467 | 3853.540318467 | 3854 |
| Vasco da Gama | 3 / 3 | 3648.424909041 | 3648.424909041 | 3648 |
| Vitória | 4 / 4 | 6591.707334180 | 6591.707334180 | 6592 |

Itinerary node sequences matched fixture-for-fixture in every case. **Across all
six `as_of` instants: 94 candidates, 0 mismatches** in nodes, legs, count, total
or stored value. Maximum divergence anywhere was **2.7 × 10⁻¹²** km, which is the
expected signature of the design: the calculator converts each leg to a 12-dp
decimal and sums exactly, the reference sums IEEE doubles.

**Raw value is unrounded; the stored value is separate.** `roundHalfUp(value, 0)`
was applied outside the write path for comparison only, and reproduced the
expected whole-kilometre figure for all 94 candidates. No row was written.

**The neutral-ground near-case (E).** No fixture carries
`is_neutral_venue = true`, but one real fixture has a home side playing away from
its recorded ground: **Remo, fixture `15237974` at Estádio Banpará Baenão, whose
recorded home is Mangueirão.** The itinerary placed it at Baenão — the venue —
and the leg out of it measured **2466.738 km**; from Mangueirão it would have
been 2473.615 km. The calculator read the fixture's venue, not the team's ground,
exactly as specified, and no flag was consulted to achieve it.

## 5. Seed verification

Ten of twenty teams had a pre-window seed at `as_of` 1. Example — **Remo**:

| role | fixture | kickoff | venue |
|---|---|---|---|
| **SEED** | `15237974` | 2026-05-31T23:30:00Z | Estádio Banpará Baenão |
| IN_WINDOW | `15237978` | 2026-07-23T22:30:00Z | Neo Química Arena |
| IN_WINDOW | `15235429` | 2026-07-26T22:30:00Z | Mangueirão |
| IN_WINDOW | `15235433` | 2026-07-29T22:30:00Z | Estádio José Maria de Campos Maia |
| IN_WINDOW | `15235415` | 2026-08-08T21:30:00Z | Mangueirão |

The seed contributed the **incoming leg** Baenão → Neo Química, 2466.738 km —
27 % of Remo's total, and a journey that a window-only chain would have lost
entirely. Four legs from four in-window fixtures; without the seed there would
have been three.

**No usable seed**: ten teams, including Vitória, Bahia and Flamengo, whose
earliest completed fixture falls inside the window. Behaviour is as specified —
`n` in-window fixtures yield `n − 1` legs, no leg is invented, and the value is
still produced (Vitória: 5 nodes, 4 legs, 6591.707 km).

**Structural note.** The seed reaches the calculator only because
`read/fixtures.ts` returns the ten most recent fixtures *per side* in addition to
the 28-day branch. The seed is therefore lost only if a team played ten or more
fixtures on one side inside the window. The real data's worst case is **3**. The
margin is large, but it is a coupling to a constant sized for other features and
is recorded here rather than left implicit. No change is proposed.

## 6. Boundary verification

The strongest evidence in this report, because it is millisecond-exact on real
records. **Coritiba**, fixture `15235409`, kickoff `2026-07-31T00:30:00Z`:

| `as_of` | `windowStart` | `15235409` | nodes | legs | value |
|---|---|---|---|---|---|
| `2026-08-28T00:30:00.000Z` | `= kickoff` | **IN_WINDOW** | seed `15235410` + 2 | 2 | 390.540756924 |
| `2026-08-28T00:30:00.001Z` | `kickoff + 1 ms` | **SEED** | 2 | 1 | 0.000000000 |

1. **Exactly at `windowStart` → included.** The lower bound is `>=`, and the
   fixture contributed its leg (Cícero de Souza Marques → Couto Pereira,
   390.541 km).
2. **One millisecond earlier relative to the window → excluded from the
   in-window set, retained as the seed.** The previous seed `15235410` dropped
   out entirely; the total fell to the single remaining 0 km leg.
3. **A fixture at or after `as_of` never contributes.** At `as_of` 6, set
   exactly to fixture `15235413`'s kickoff, that fixture is absent: Coritiba
   falls from 3 legs to 2 while the total is unchanged at 781.082 km, because
   the excluded leg was the 0 km one. Both halves of `before()`'s strictness
   are visible in one comparison.
4. **The seed supplies the incoming leg** — §5.

Cruzeiro reproduces the same transition independently (2 legs / 1645.126 km →
1 leg / 822.563 km).

## 7. Zero versus no-value

**Measured zero — value written.** Red Bull Bragantino at `as_of` 2:

| role | fixture | kickoff | venue |
|---|---|---|---|
| SEED | `15235410` | 2026-07-26T21:30:00Z | Estádio Cícero de Souza Marques |
| IN_WINDOW | `15235407` | 2026-08-09T21:30:00Z | Estádio Cícero de Souza Marques |

Value **0.000000000 km**, `sample_observation_count` **1**, threshold met. The
team demonstrably did not travel between those fixtures; that is a measurement.
Santos, Grêmio and Coritiba produce the same result independently.

**No value.** At `as_of` 3 every one of the 20 teams has a seed but no in-window
fixture: one node, no leg, **no candidate emitted**. Nothing was written as a
zero. This is also the temporal-decay demonstration in §10.

## 8. Provenance

The real `resolve()` was run over all **94** candidates with the registry loaded
from the database:

```
definition: team.travel_distance · unit km · value_scale 0 · direction UNSIGNED
            max_provenance DERIVED · meaningful_sample_threshold 1
ranks:      ESTIMATED 1 · INFERRED 2 · DERIVED 3 · OBSERVED 4
resolved:   DERIVED × 94         candidates failing threshold: 0
            minimum observation count: 1
```

Every candidate carries `consumed: []`, so `min(ceiling, weakest input)`
degenerates to the declared ceiling and **no composite MIN behaviour is
involved**. The observation count reaching the write layer is the calculator's
own count, unaltered — measurable legs, not fixtures and not away fixtures.

## 9. Source and registry verification

From the database, unmodified:

| feature | calculator | unit | scale | direction | max provenance | threshold | sources |
|---|---|---|---|---|---|---|---|
| `team.travel_distance` | `travel_itinerary` | km | 0 | UNSIGNED | DERIVED | 1 | `football.fixture`, `football.venue` |
| `team.travel_impact` | `travel_load` | index | 2 | LOWER_IS_STRONGER | DERIVED | 3 | `football.fixture`, `football.team`, `football.venue` |

`team` is **absent** from `travel_distance`. `travel_impact` is unchanged.
`feature_dependency` rows touching `travel_distance`: **0**. Neither declaration
was modified.

## 10. Evidence against the four original defects

### D-i — away-only · REFUTED

**Bahia**, `as_of` 1, chain ending at home:

| fixture | kickoff | venue | side | leg |
|---|---|---|---|---|
| `16390771` | 2026-07-17T22:30Z | Arena Fonte Nova | HOME | — |
| `15237980` | 2026-07-21T22:30Z | Arena MRV | AWAY | 970.642 |
| `15235408` | 2026-07-26T19:00Z | Arena Fonte Nova | HOME | 970.642 |
| `15235417` | 2026-07-30T00:30Z | Estádio do Maracanã | AWAY | 1212.079 |
| `15235420` | 2026-08-09T19:00Z | Arena Fonte Nova | HOME | 1212.079 |

Total **4365.441 km over 4 legs**. Three of the five nodes are home fixtures and
each participates in a leg; the two *return* journeys — 970.642 and 1212.079 km
— exist only because home fixtures are nodes. Under the away-only rule they are
invisible: the away-only view of this month is two trips, and the trip home from
Rio ten days before the next match does not exist at all. The home fixture on
9 August does not erase the preceding travel; it **records the journey back from
it**.

### D-ii — star topology · REFUTED

**Athletico**, consecutive away pair, home ground Arena da Baixada:

| | km |
|---|---|
| **Actual leg** Neo Química Arena → Estádio Urbano Caldeira | **47.226** |
| Star model: home → Neo Química (353.835) + home → Urbano Caldeira (340.271) | 694.105 |
| Overstatement | **14.7 ×** |

The calculator returned 794.457 km over 3 legs, the last of which is the 47.226 km
leg actually travelled. Two grounds 47 km apart are not two 350 km round trips.

The coverage difference is equally concrete: at `as_of` 1, `travel_distance`
produced a value for **20 of 20** teams and `travel_impact` for **10 of 20** —
because ten teams (Atlético Mineiro, Botafogo, Chapecoense, Corinthians,
Coritiba, Fluminense, Internacional, Mirassol, São Paulo, Vitória) carry no
`home_venue_id` in the ingested data, and a home-radial model has no origin
without one. An itinerary between fixture venues needs no home ground.

### D-iii — no time dimension · REFUTED

Two independent demonstrations on the same fixture history:

**Pre-window fixtures are excluded, and exactly one is retained as the seed.**
Coritiba at `as_of` 4:

| fixture | kickoff | role |
|---|---|---|
| `15237982` | 2026-07-22T22:30Z | **EXCLUDED ENTIRELY** |
| `15235410` | 2026-07-26T21:30Z | SEED |
| `15235409` | 2026-07-31T00:30Z | IN_WINDOW |
| `15235413` | 2026-08-08T23:30Z | IN_WINDOW |

**The same history yields a smaller value as time passes**, with no new fixture
ingested — which a fixture-count window cannot express:

| team | `as_of` 1 (11 Aug) | `as_of` 2 (6 Sep) | `as_of` 3 (1 Oct) |
|---|---|---|---|
| Remo | 9270.031 (4 legs) | **NO VALUE** | NO VALUE |
| Chapecoense | 4662.439 (4) | **NO VALUE** | NO VALUE |
| Bahia | 4365.441 (4) | 1212.079 (1) | NO VALUE |
| Palmeiras | 3603.019 (4) | 1465.590 (1) | NO VALUE |
| Fluminense | 2584.505 (4) | 6.695 (1) | NO VALUE |

V1's `WINDOW = 5` counts fixtures, so all three columns would read alike.

### D-iv — mean dilution · REFUTED

**Remo**, four legs of materially different length:

```
legs   2466.738   2473.615   2164.839   2164.839
SUM    9270.031        MEAN  2317.508        MAX  2473.615
calculator             9270.030790323686
```

The value is the **sum**. A mean would rank Remo — the most-travelled side in the
division by a wide margin — alongside a team that made one trip of similar
length, which is precisely the dilution D-iv names.

## 11. Discrepancies

**None affecting the calculator.** Two items are recorded for completeness:

1. **Harness-data node divergence (not a defect).** The pre-existing `OPS-*`
   operational-harness rows place **45 fixtures at one identical instant**. The
   read layer's ten-per-side rank therefore returns 20 of them, so the reference
   reconstruction (which sees all 45) picks a different seed from the
   calculator. Both agree the result is NO VALUE, so no value differs. This is
   the §5 coupling made visible by data that cannot occur in football — 45
   simultaneous kickoffs for one team — and it does not arise for any real team.
2. **Floating-point signature, expected.** Divergences up to 2.7 × 10⁻¹² km
   between the exact-decimal sum and the double-precision reference. No stored
   value is affected.

## 12. Case H — unlocatable venue

**NOT OBSERVED IN REAL DATA**; all 20 Brasileirão venues carry coordinates.
Covered by the pre-existing harness rows, and clearly labelled as synthetic:
team `Ops Home` has **45 completed fixtures** at *Ops Arena*, a venue with NULL
coordinates. The read layer returned 45 fixtures, the itinerary formed **44
consecutive pairs**, `venuesById` resolved none of them, and the calculator
produced **NO VALUE** — not 0 km, and not a 44-observation zero. Absence of
coordinates yields absence of a row (LC-05, PD-07).

## 13. What this gate does NOT establish

Nothing here says how `travel_distance` should influence Team Preparedness. No
`feature_dependency` edge was created, no readiness calculation was touched, no
`feature_value` row exists, `travel_impact` and `travelLoad.ts` are unmodified,
and no migration was written. The feature is correct; its weight is a separate
decision.

## 14. Residual limitations, stated plainly

1. The live V2 database could not be reached, so no value was reconciled against
   a live S-5 run. The data is real; the host is local.
2. One competition, one season, ten weeks, 20 teams. No mid-week European
   schedule, no continental travel, no DST-crossing window (the connection is
   pinned to UTC, which removes the mechanism rather than testing it).
3. `is_neutral_venue = true` never occurs in this dataset. The venue-not-home
   case in §4 exercises the same code path, since no flag is read.
4. Unlocatable venues appear only in harness data.

---

## Verdict

`travel_distance` reconstructs recent measurable itinerary exposure from real
ingested fixture sequences exactly as specified: correct sources, correct
itinerary, correct window to the millisecond, correct distances, correct
observation counts, correct absence, correct provenance. All four V1 defects are
refuted on real records rather than on constructed examples.

**Ready for the next gate.**
