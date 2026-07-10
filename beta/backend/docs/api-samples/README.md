# API Response Samples

Reference captures of real API responses, one per (endpoint, group) —
used to see actual data shapes instead of guessing when writing or
debugging parsing logic. See `backend/src/utils/apiSamples.ts` for the
full mechanism and design reasoning.

## Structure

```
standings/
  A.json              — tier A league standings response (e.g. Premier League)
  B.json              — tier B league standings response
  C.json              — tier C league standings response
  MANDATED.json       — 'Mandated' band tournaments (e.g. Brasileirão Série B)
  DISCOVERY.json      — 'Discovery' band tournaments
player-stats/
  A.json, B.json, ...  — same tier-band grouping
team-stats/
  A.json, B.json, ...
squad/
  BRAZIL.json, ENGLAND.json, ...  — grouped by COUNTRY, not tier band
                                     (see apiSamples.ts docstring for why
                                     this endpoint groups differently)
transfers/
  BRAZIL.json, ENGLAND.json, ...  — same country grouping as squad, same
                                     reasoning (per-team sync, no tier
                                     context resolved in that loop)
```

**This directory starts empty.** Files appear automatically the first
time each sync job runs after this feature was added — zero extra API
calls, it just captures the response that sync would have made anyway.

## Why this exists

Built specifically to answer two open questions empirically instead of
by guessing:

1. **Multi-group/conference standings** (e.g. MLS Eastern/Western) — does
   SportsAPI Pro return these as a flat array with a group field per row,
   or as nested group objects each with their own rows array? Compare a
   single-group sample (e.g. Premier League) against a known multi-group
   league once both are captured.

2. **Field coverage by tier** — does a Category B or C league's
   player-stats response have the same ~80 fields as a Category A league,
   or a sparser subset? `player_season_statistics` was recently expanded
   to capture ~98 fields (migration 011) on the assumption that most
   tracked leagues return rich data — comparing `player-stats/A.json`
   against `player-stats/C.json` side by side tells you definitively
   whether that assumption holds.

## Populating / refreshing

Samples are captured automatically on normal sync runs:

```bash
npx ts-node src/cli.ts sync:standings
npx ts-node src/cli.ts sync:player-stats
npx ts-node src/cli.ts sync:team-stats
npx ts-node src/cli.ts sync:squads:v2
npx ts-node src/cli.ts sync:transfers "England,Spain,Germany,Italy,France"
```

Note: `sync:transfers` is NOT a recurring/cron command — it's run once per
region after that region's transfer window closes. See CLI_REFERENCE.md
for the cluster schedule. A sample will only appear here once it's been
run at least once for a given country.

Samples are captured **once** per (endpoint, group) and never
auto-overwritten — this keeps the directory to one clean reference file
per combination rather than accumulating near-duplicate noise on every
sync run.

If a provider changes their response shape and these go stale, clear
them deliberately and let the next sync cycle recapture:

```bash
npx ts-node src/cli.ts refresh:api-samples
```
