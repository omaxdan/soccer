# Phase 8 — Season-statistics pilot: attempted, not performed

**Verdict: INCONCLUSIVE — the BEFORE observation exists, the AFTER observation
does not.** No comparison has been made and none is possible with one body.

**Zero provider calls were made from this environment.** One was attempted and
refused at the egress tunnel; the capture below was taken by the operator on a
machine that can reach the provider. No schema, migration, code, test or
ingestion changed for this branch.

---

## Capture status

| | |
|---|---|
| **BEFORE the fixture** | **CAPTURED**, by the operator |
| file | `palmeiras-1963-season-87678-T1-20260811T224705Z.json` |
| captured at | `2026-08-11T22:47:05Z` |
| raw body length | `3283` bytes |
| SHA-256 | `B06DE754464D5169DA56BE2668EFA0D64358DC9DD9BC951903FA9C8AFAF80A58` |
| **AFTER the fixture** | **NOT CAPTURED.** Due after Fluminense v Palmeiras, 2026-08-15 19:30Z |

**The body has not been read here, and nothing in this document is derived from
it.** The metadata above is recorded so the two observations can be shown to be
the same request against the same subject, and so the AFTER body can be verified
as a *different* one when it arrives — a matching digest would mean the two
responses are byte-identical, which §"Procedure" says is a result in its own
right rather than a failed capture.

Sections 1–8 below are unchanged: they report the state of the analysis, and no
analysis can be performed on one observation. **Do not read the existence of a
BEFORE capture as evidence about cumulativeness** — a single body cannot show a
value changing.

---

## Why it stopped

### Blocker 1 — no route to the provider

The pilot's BEFORE observation — the first of two identical requests — was
attempted exactly once:

```
GET https://v2.football.sportsapipro.com/api/teams/1963/tournament/325/season/87678/statistics
curl: (56) CONNECT tunnel failed, response 403
```

The egress proxy, asked directly:

```json
{"ts":"2026-08-11T22:31:29.670Z","kind":"connect_rejected",
 "host":"v2.football.sportsapipro.com:443",
 "detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)"}
```

The TLS tunnel is refused, so **no request reached the provider and no quota was
charged.** Per the standing rule for policy denials, one attempt was made and no
retry followed. This is the same blocker recorded in
[doc 50](./50-phase8-s4-g1-match-endpoint-discovery.md) §5 and it is unchanged.

### Blocker 2 — no route to V1's database either

`syncTeamSeasonStatistics` cannot run headless without it (see Blocker 3):

```
GET https://<supabase host>/rest/v1/   →   000 (no connection)
```

So even the V1 job path is unavailable here, independently of the provider.

### Blocker 3 — `logApiSample` structurally cannot capture two observations

**This one matters most, because it would block the pilot on a machine with full
network access.** The instruction was to use V1's existing mechanism if possible.
It is not possible, and the reason is in the mechanism itself
(`src/utils/apiSamples.ts:63-68`):

```ts
const filePath = path.join(dir, `${groupLabel}.json`);

// Skip if a sample already exists for this endpoint+group …
if (fs.existsSync(filePath)) return;
```

| Property | Consequence for a T1/T2 pilot |
|---|---|
| **Skip-if-exists** | the first call writes `team-stats/MANDATED.json`. **The second is silently skipped.** The second observation is never written, and the sync reports success |
| Path is `{endpoint}/{BAND}.json` | **no team, no season, no date in the filename.** Two captures could not be told apart or ordered even if both were written |
| File content is the bare response body | `JSON.stringify(response, null, 2)` — **no capture timestamp, no URL, no parameters.** Nothing attributes a sample to a team-season or an instant |
| `refresh:api-samples` deletes then recaptures | clearing before T2 yields **T2 only** — the baseline is destroyed, not preserved |

The mechanism was built to answer *"what shape is this endpoint, per tier band"*,
once. It was never built to hold a series, and its own docstring says so:
*"one clean sample per combination rather than accumulating near-duplicate noise
on every sync run."*

**A snapshot-delta pilot needs the exact opposite property.** That is a genuine
finding about the tooling, not an inconvenience: V2's discovery capture
(`discover.ts`) already writes the envelope this pilot needs — `capturedAt`,
`url`, `parameters`, `status`, `responseSha256`, `body` — and V1's does not.

### Blocker 4 — the V1 job is not a read-only experiment

Two further properties of `sync:team-stats <externalId>`, for the record:

- It calls `resolveTeamSeasonContext()` first, which reads 90 days of `matches`
  from Supabase. **If the context does not resolve, the team is skipped and no
  API call is made at all** — the run looks like a clean no-op while achieving
  nothing.
- On success it **writes to V1's production `team_season_statistics`**
  (`:515`, upsert). A pilot routed through it is not observation-only.

**The single-team override itself is sound** — `sync:team-stats 1963` bypasses
both the 21-day cooldown and the 40-team cap and issues exactly one call
(`syncSeasonStatistics.ts:471-478`). The call count was never the problem.

---

## The eight required sections

### 1. Raw payload evidence

**NONE.** No payload was obtained. No file was written to
`docs/api-samples/`. The repository's season-statistics evidence is unchanged
from [doc 51](./51-phase8-season-statistics-snapshot-delta-assessment.md) §0.1:
both `api-samples` trees still contain only a `README.md`.

### 2. Before → after counter comparison

**NOT PERFORMED.** Neither observation exists, so there is nothing to compare —
not byte-for-byte, not field-by-field. Nothing in this section may be inferred
from the V1 mapper, and nothing is.

### 3. Fields demonstrating cumulative behaviour

**NONE DEMONSTRATED.** The hypothesis that the payload is cumulative remains
exactly where doc 51 §3 left it: **UNVERIFIED**, supported only by field naming
and V1's storage model, neither of which is payload evidence.

### 4. Reconstructible ratios and rating

**NOT MEASURED.** One structural observation from the mapper is worth recording
because it narrows what the capture must check — and it points the *opposite* way
to the player payload.

Of the **28 team fields** V1 reads, 22 are counters and 6 are derived. Asking
whether each derived field's components are present **in the team payload**:

| Derived field | Numerator | Denominator | Reconstructible from the team payload? |
|---|---|---|---|
| `accuratePassesPercentage` | `accuratePasses` — **absent** | `totalPasses` — present | **no** |
| `accurateOppositionHalfPassesPercentage` | absent | absent | **no** |
| `duelsWonPercentage` | absent | absent | **no** |
| `aerialDuelsWonPercentage` | absent | absent | **no** |
| `averageBallPossession` | absent | absent | **no**, but see below |
| `avgRating` | absent | absent | **no**, but see below |

**The rating decomposition found in doc 51 §4.1 does not apply here.**
`totalRating` and `countRating` are in the **player** payload. The team payload
carries `avgRating` alone.

A second path exists for the two plain averages, using `matches` as the weight:

```
interval_average = (avg₂ · matches₂ − avg₁ · matches₁) / (matches₂ − matches₁)
```

This is valid **only if** the field is an unweighted mean over matches — which is
**UNKNOWN** and is precisely the kind of thing the capture would settle.

**Important caveat, stated so it is not read as a finding about the provider:**
V1's mapper reads a *subset*. Its own comment at `:534` records fields *"already
present in every response above, [that] w[ere] being discarded."* **Absence from
the mapper is not absence from the payload.** These six may well be
reconstructible from fields V1 never mapped. Nobody in this repository has looked.

### 5. Anomalies

**NONE OBSERVABLE.** Decreases, resets and null transitions are detectable only
across two observations.

### 6. Capability flags versus actual collections

**NOT OBSERVED for this endpoint.** No `/statistics` payload exists, so it is
unknown whether it carries `hasEventPlayerStatistics`, `hasEventPlayerHeatMap`,
`hasXg` or `detailId` at all.

The one relevant datum is unchanged and is the operator's, not this pilot's:
on `/match/{id}` for event 15237975 the flag was `true` and the player collection
was **absent** — *capability asserted, collection absent*. The n=1 caution of
doc 51 §14 stands in full, and this pilot did nothing to reduce it.

### 7. Provenance classification

| Statement | Class |
|---|---|
| The two endpoint paths and their envelopes | **OBSERVED** — in V1 code corrected against the live API, not in a payload |
| The 28 team field names / 110 player field names V1 reads | **OBSERVED** (of the mapper) — **INFERRED** as a description of the payload, since the mapper is a subset |
| `football.provider_statistic` has no temporal column | **OBSERVED** — DDL |
| `logApiSample` cannot capture a second observation | **OBSERVED** — `apiSamples.ts:68` |
| The provider host is refused by this environment | **OBSERVED** — proxy relay log |
| **The values are cumulative season-to-date** | **UNKNOWN** |
| **Any counter increases between two dates** | **UNKNOWN** |
| Team-payload derived fields are not reconstructible | **INFERRED** — true of the mapper's field set; unknown of the payload |
| `avgRating` / `averageBallPossession` de-averaging via `matches` | **UNKNOWN** — valid only if they are plain means over matches |
| `topSpeed` is an extremum, `playedEnough` a provider flag | **INFERRED** from naming — and both are excluded from delta arithmetic regardless |

Nothing has been promoted. The two statements the pilot existed to move —
cumulativeness, and an observed increase — are **UNKNOWN** and stay UNKNOWN.

### 8. Verdict

> ## INCONCLUSIVE
>
> Not because the two observations conflict, but because **zero were obtained.**
> The cumulative-counter hypothesis is neither supported nor refuted, and doc 51's
> SPLIT verdict is unchanged in both halves: season statistics OPEN and
> unverified, appearance ingestion BLOCKED under doc 33 §5.

---

## What is missing, exactly

Four things. The first is the only hard one.

1. **Network egress to `v2.football.sportsapipro.com:443`** — either added to
   this environment's policy (chosen at environment creation; see
   https://code.claude.com/docs/en/claude-code-on-the-web), or the two calls made
   from the machine that ran runs 50–53.
2. **A capture mechanism that preserves both observations.** `logApiSample`
   cannot (Blocker 3). V2's `discover.ts` envelope already has the right shape —
   `capturedAt`, `url`, `parameters`, `responseSha256`, `body` — but `/teams/{id}/
   tournament/{t}/season/{s}/statistics` is not in the V2 registry, so wiring it
   is a code change and deliberately not made here.
3. **Supabase reachability**, only if the pilot is routed through the V1 job
   rather than a direct request. A direct request needs neither.
4. **Time.** The two identical requests must straddle a played match. **No
   single session can produce both**, whatever the network policy — the interval
   is the entire experiment.

## The pilot, fully specified and ready to run

### What the experiment actually is

**The two requests are byte-identical. That is not a limitation of the design —
it IS the design.**

```
GET /api/teams/1963/tournament/325/season/87678/statistics
```

The path carries **no date, no round, no snapshot or as-of parameter**, and
nothing in this repository suggests the endpoint accepts one. The provider is
asked for the **current state** of one team-season, twice, with a known fixture
played in between.

So the labels mean exactly this and nothing more:

| | |
|---|---|
| **T1** | the current team-season statistics **before** the fixture |
| **T2** | the current team-season statistics **after** the fixture |

Neither is "the statistics as of T1". There is no historical retrieval here, and
any V2 dating of these observations is **V2 stamping when it looked**, never the
provider stating when the figures applied.

**The primary observation is a single question:** *what changed between two
identical requests separated by a played match?*

### Procedure — behaviour first, interpretation second

1. **Compare the two raw bodies byte-for-byte first.** Record whether they are
   identical, and their SHA-256s, before parsing anything. This is the result in
   its own right.
2. **Then compare field by field**, listing every field whose value differs, with
   both values.
3. **Only then** ask whether the observed changes are consistent with cumulative
   season-to-date counters.

Three guards, because the whole point is to avoid assuming the conclusion:

- **A changed value is not cumulative merely because it increased.** A per-match
  or per-90 figure also moves when a match is played, and can move upward.
- **An unchanged value is not thereby non-cumulative.** A counter can legitimately
  not advance — a team that took no corners adds no corners.
- **If the bodies are identical, that is the result.** Record it plainly. Do not
  explain it — caching, lag, a stale season, a wrong identifier and a
  non-cumulative payload all produce the same observation, and none of them is
  distinguishable from one pair. A further observation would be a **new**
  experiment with its own authorisation.

### The subject

**Team-season: Palmeiras — provider team id `1963`, tournament `325`, season
`87678`.**

Chosen because it minimises every source of ambiguity:

| Criterion | Value |
|---|---|
| Already in V2 | yes — one of the 20 clubs ingested for 325/87678 |
| Next fixture in this competition | **2026-08-15 19:30Z, round 23, Fluminense v Palmeiras** — the earliest in the whole forward feed |
| Matches played before the fixture | ~22 (round 23). If the payload is cumulative, its figures are large; if it is per-match or per-90, they are small. **A team with 1–2 matches played would make the two readings indistinguishable** |
| Competition scoping | the endpoint is per tournament-season, so no cup fixture can contaminate the interval |

Fluminense (`1961`) is the equally valid alternative — same fixture, same window.
Capturing both would cost 4 calls and is out of the stated budget.

**Exactly two calls — the same call, twice:**

```bash
# BEFORE the fixture — any time up to 2026-08-15 19:30Z
curl -sS -H "x-api-key: $SPORTSAPI_KEY" \
  "https://v2.football.sportsapipro.com/api/teams/1963/tournament/325/season/87678/statistics"

# AFTER the fixture — on or after 2026-08-16, once it has been played
curl -sS -H "x-api-key: $SPORTSAPI_KEY" \
  "https://v2.football.sportsapipro.com/api/teams/1963/tournament/325/season/87678/statistics"
```

**Preserve both raw bodies verbatim and unformatted** — no pretty-printing, no
key reordering, or the byte-for-byte comparison is destroyed before it is made.
Name them so they cannot be confused, e.g.
`team_statistics__teamId-1963__tournamentId-325__seasonId-87678__BEFORE.json`
and `…__AFTER.json`, in `docs/api-samples/v2-discovery/` beside their siblings.
**Record with each: the UTC instant of the request, the HTTP status, the response
headers, and the SHA-256 of the body.** The filename is not a timestamp, and the
capture instant is the only thing that dates these observations — the payload
does not date itself.

**What the pair can settle:** whether the two bodies differ at all; if they do,
exactly which fields differ and by how much; whether `matches` advances by
exactly 1; whether the changes are of a size consistent with one match having
been added to a season total; whether any value **decreases**; whether `avgRating`
and `averageBallPossession` move consistently with a mean over `matches`; whether
the payload carries fields V1 never mapped — including the numerators that would
make the six derived fields reconstructible; and whether any capability flag
appears on this endpoint at all.

**What one pair cannot settle even if everything changes as hoped:** that the
behaviour holds for a second interval, for another club, for another competition,
or for a lower tier. **n = 1 interval, 1 team, 1 competition, 1 tier.** It is
enough to justify a larger evidence step or to stop; it is not enough to design a
schema on.

**What it will not settle:** anything about the player endpoint (a separate
capture, 2 more calls), anything about lower-tier coverage (doc 51 §14, still
n=1), and anything about G-1.

---

**Nothing implemented. No schema, migration, code, test or broad sync. One
provider call attempted, refused before leaving this environment, zero quota
consumed.**
