# Player Season Statistics — Field Expansion (Migration 011)

## Why this exists

`syncSeasonStatistics.ts` was calling SportsAPI Pro's player-statistics
endpoint and receiving ~80 fields per player per API call, but only writing
13 of them to the database (`rating`, `total_rating`, `count_rating`,
`appearances`, `matches_started`, `minutes_played`, `goals`, `assists`,
`expected_goals`, `expected_assists`, `yellow_cards`, `red_cards`,
`played_enough`). Everything else — tackles, passes, duels, dribbles,
shots, goalkeeper-specific stats, physical tracking data — was arriving in
every response and being discarded.

**Cost to fix: zero additional API calls.** This is purely "capture more
of what's already arriving," not a new integration.

## Tiering context

This expansion was prioritized specifically because deep player-level
analytics (attribute breakdowns, role suitability, strengths/weaknesses,
percentile rankings) are natural premium-tier content — the kind of thing
that justifies a Pro/Scout subscription tier, distinct from team-level
readiness data which is more suited to a free or entry tier. Before this
migration, there was no raw material in the database to build that tier
from at all; the underlying stats simply weren't captured.

## Coverage caveat — READ BEFORE BUILDING UI ON TOP OF THIS

Not every field is guaranteed to be populated for every player in every
league. In particular, the three physical-tracking fields
(`kilometers_covered`, `number_of_sprints`, `top_speed`) plausibly require
optical tracking systems that lower-tier competitions may not run — this
is a common, real pattern with sports data providers, separate from
whatever tournament "category A/B/C" tiering already exists in this
codebase for standings tracking.

**Every column added is nullable**, and the sync job maps every field with
the same `?? null` defensive pattern used everywhere else in this
codebase. A league with sparse coverage simply gets `null` in the columns
it doesn't have data for — nothing breaks, nothing gets faked. Any UI
built on top of this data (Player Detail attribute panels, etc.) needs to
check for presence per-player, not assume uniform coverage across all
tracked leagues.

## Verifying real coverage

Run this after the migration + sync job have been live for a while,
against a real mix of leagues:

```sql
SELECT
  t.category,
  t.name AS tournament,
  COUNT(*) AS total_player_rows,
  COUNT(pss.tackles)              AS has_tackles,
  COUNT(pss.total_shots)          AS has_shots,
  COUNT(pss.successful_dribbles)  AS has_dribbles,
  COUNT(pss.big_chances_created)  AS has_big_chances,
  COUNT(pss.kilometers_covered)   AS has_gps_tracking,
  ROUND(COUNT(pss.tackles)::numeric / COUNT(*) * 100, 1) AS pct_core_stats_populated
FROM player_season_statistics pss
JOIN tournaments t ON t.id = pss.tournament_id
GROUP BY t.category, t.name
ORDER BY pct_core_stats_populated ASC;
```

Sorted worst-coverage-first, so any real gaps surface immediately.

## Deliberately excluded fields

- **`goalsAssistsSum`** — trivially `goals + assists`, not worth a column.
- **`scoringFrequency`** — in the one sample checked during this work, its
  value exactly equalled `minutesPlayed` for that player, which doesn't
  match what the field name implies. Flagged as suspect rather than
  trusted blindly. Can be added later if verified to carry real meaning
  once more sample data is available.

## What this unblocks (from the original Player Detail gap analysis)

With this data now captured, the following panels from the FM-style
Player Detail mockup move from "fully blocked" to "buildable, pending a
derived-formula design decision" (same category as the Team Strength
formula change and the Team Comparison radar — needs explicit sign-off
on the exact blend before implementing, not a silent decision):

- Attribute Profile radar (Attacking/Defending/Physical/Creativity/
  Technical/Pace)
- Key Strengths / Weaknesses
- Percentile rankings against peer group

Still blocked regardless of this expansion:
- **Positional Ratings + Player Roles** — needs a much more sophisticated
  tactical classification model on top of these stats, not just the raw
  numbers themselves.
- **Heatmap** — needs positional/coordinate tracking data, a fundamentally
  different data tier than a stats endpoint provides.
- **Per-match Form/Performance Trend charts** — these are season
  aggregates, not match-by-match. Would need a new `player_match_load`
  extension (that table exists with `minutes_played`/`started`/
  `substitute` but no per-match rating column) or a new table entirely.
