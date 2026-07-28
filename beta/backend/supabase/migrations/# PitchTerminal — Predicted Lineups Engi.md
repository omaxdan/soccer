# PitchTerminal — Predicted Lineups Engine v2

## Project Context

PitchTerminal is a football analytics SaaS focused on pre-match intelligence for football bettors.

The platform does **not** generate betting predictions directly. Instead, it provides evidence-based intelligence derived from historical football data.

One of the platform's core intelligence modules is **Predicted Lineups**.

This module estimates the most likely starting XI for each team before kickoff.

The predicted lineup feeds multiple downstream systems, including:

* Starting XI Strength
* Player Impact
* Readiness Intelligence
* Match Intelligence
* Team Intelligence
* Frontend match pages
* Future player availability models

Therefore this engine is considered foundational infrastructure.

---

# Architecture

The project follows a strict DB-first architecture.

## Backend

All calculations must happen in backend jobs.

Examples:

* processPredictedLineups()
* processStartingXIStrength()
* processReadiness()
* processMatchIntelligence()

These jobs write their results into Supabase.

---

## Frontend

The frontend must never calculate lineups.

It should only render precomputed values from the database.

No runtime lineup optimization.

No runtime formation inference.

No runtime confidence calculations.

---

# Current Database

Current table:

match_predicted_lineups

Currently stores roughly:

* match_id
* team_id
* player_id
* position_code
* rank_in_position
* matches_started
* confidence
* calculated_at

This schema is no longer sufficient.

---

# Required Database Design

Extend match_predicted_lineups with:

formation

lineup_order

natural_position

weighted_score

suitability

These fields exist specifically for:

* frontend rendering
* debugging
* analytics
* explainability

Avoid requiring frontend calculations.

---

Create:

match_predicted_formations

Columns:

match_id

team_id

formation

confidence

calculated_at

Primary key:

(match_id, team_id)

Purpose:

Avoid storing the same formation value eleven times.

---

# Engine Goal

Given:

* player season statistics
* player availability
* injuries
* transfers
* positions

Generate the strongest and most realistic expected starting XI.

---

# Current Problems

The current engine has several issues.

## Greedy player assignment

Current behaviour:

Fill:

GK

then

RB

then

CB

then

CB

...

This creates locally optimal assignments.

Professional lineup optimizers solve this as an assignment problem.

Desired solution:

Implement a clean optimizer.

Preferred:

Hungarian Algorithm

or

Maximum Weight Bipartite Matching.

If that is excessive for now:

Create a reusable optimizer abstraction so Hungarian matching can replace it later without changing surrounding code.

---

## Formation selection

Current implementation mostly rewards whichever formation fits first.

Instead:

Score every formation.

Factors:

* squad composition
* player suitability
* weighted scores

Examples:

Many centre-backs

↓

3-5-2 gains bonus

Many wingers

↓

4-3-3 gains bonus

Formation should maximize total squad suitability.

---

## Position compatibility

Primary positions should dominate.

Example:

RB

RB = 1.00

RWB = 0.95

CB = 0.70

Secondary positions should receive lower weights.

Tertiary positions lower again.

Avoid unrealistic assignments.

---

## Goalkeeper requirement

A goalkeeper must always exist.

Never assign:

CM

as

GK

If no eligible goalkeeper exists:

Abort lineup generation.

Log warning.

---

## Player weighting

Current weighting is too simplistic.

Desired weighting:

35%

Matches Started

30%

Minutes Played

20%

Average Rating

10%

Recent Starts

5%

Goals + Assists

Minutes played is a stronger predictor than appearances.

Recent starts should use the latest matches if data exists.

---

## Availability

Exclude:

Injured players

Doubtful players

Suspended players

Transferred players

Do not compare expected return against today's date.

Compare against match date.

---

## Confidence

Current implementation compares:

selected player

against

next player in lineup

This is incorrect.

Instead:

Confidence must compare against the second-best candidate for the SAME tactical position.

Example:

RB

Walker

90

James

84

Confidence derives from that gap.

Not from:

Walker

vs

Goalkeeper.

---

## Rank in Position

Current behaviour is acceptable.

Example:

CB

rank 1

rank 2

CM

rank 1

rank 2

rank 3

Keep this.

---

# Shared Engine

Avoid one giant function.

Split into reusable modules.

Suggested structure:

lineups/

formations.ts

playerScoring.ts

positionCompatibility.ts

formationScoring.ts

optimizer.ts

confidence.ts

database.ts

types.ts

These modules should also support Starting XI Strength.

---

# Starting XI Strength

Starting XI Strength must reuse the same formation-slot logic.

Do not implement separate formation rules.

Both engines must compare:

Projected XI

vs

Best Available XI

using identical slot definitions.

---

# Frontend Requirements

The frontend should only query:

formation

lineup_order

position_code

natural_position

confidence

weighted_score

suitability

No calculations.

The PredictedXI component should display:

Formation

Starting XI ordered by lineup_order

Position

Natural position

Confidence

Future enhancements may include pitch coordinates.

---

# Database Writes

Avoid:

DELETE

INSERT

Prefer:

UPSERT

Unique key:

(match_id, team_id, player_id)

This prevents data loss if processing fails midway.

---

# Logging

Provide useful logs.

Examples:

Chosen formation

Formation score

Unavailable players

Players excluded by injury

Goalkeeper missing

Optimizer failures

Players written

Execution time

---

# Code Quality

Avoid one 500+ line function.

Small focused functions.

Readable.

Strong typing.

Reusable.

Document important algorithms.

Avoid duplicated logic.

---

# Testing

Before completing implementation:

Run TypeScript checks.

Run lint.

Run production build.

Verify:

Predicted lineups render correctly.

No frontend calculations exist.

No schema mismatch.

No duplicated formation logic.

No broken pages.

---

# Deliverables

Expected output includes:

Updated database migrations.

Refactored lineup engine.

Shared optimizer.

Shared formation helpers.

Updated Starting XI Strength engine.

Updated frontend queries.

Updated PredictedXI component.

Passing build.

Commit changes.

Push to GitHub.

Provide:

Commit hash

Files changed

Summary of architectural improvements.
Below is a context prompt I'd give Claude. It is written as a senior software architect specification instead of a coding prompt, so Claude understands the goals, constraints, architecture, and expected output instead of trying to patch the existing function.

---

# Rewrite `processPredictedLineups()` into a Production-Grade Lineup Prediction Engine

## Context

We are building **PitchTerminal**, a football intelligence platform.

This project **does not predict fantasy lineups**.

It predicts the most likely starting XI using only our database.

There must be **ZERO external API calls**.

Everything must be derived from data already stored inside Supabase.

The function currently works but has several architectural problems:

* greedy player assignment
* incorrect confidence calculation
* lineup ordering problems
* weak formation inference
* schema mismatch
* difficult to maintain because everything is inside one huge function

I want this entire module rewritten.

Do **NOT** patch the existing code.

Design it properly.

---

# Database

## players

Contains

* primary_position
* secondary_position
* tertiary_position
* position
* current_injury
* injury_status
* injury_return_days
* team_id

---

## player_season_statistics

Contains

* matches_started
* appearances
* minutes_played
* total_rating
* count_rating
* goals
* assists

---

## player_injuries

Contains active injuries.

Must exclude unavailable players.

---

## player_transfers

Used to verify player still belongs to the club.

---

## match_predicted_lineups

Current table

```sql
id
match_id
team_id
player_id
position_code
rank_in_position
matches_started
confidence
calculated_at
```

This schema is insufficient.

---

# Required Schema Changes

Generate a migration that extends the table.

```sql
ALTER TABLE match_predicted_lineups
ADD COLUMN formation text,

ADD COLUMN lineup_order smallint,

ADD COLUMN natural_position text,

ADD COLUMN tactical_position text,

ADD COLUMN x numeric,

ADD COLUMN y numeric,

ADD COLUMN role text,

ADD COLUMN captain boolean DEFAULT false,

ADD COLUMN vice_captain boolean DEFAULT false;
```

Also create

```sql
UNIQUE(match_id,team_id,player_id)
```

---

# Goal

Predict

* best formation

AND

best XI

AND

where each player plays

AND

confidence

AND

pitch coordinates

Everything should already exist in the database after this function finishes.

The frontend should perform **zero football calculations**.

---

# Rewrite Architecture

Instead of one 500-line function, split everything into reusable functions.

Example

```ts
loadMatches()

loadPlayerData()

buildCandidates()

calculateWeightedScores()

calculatePositionSuitability()

inferFormation()

assignPlayers()

calculateConfidence()

assignPitchCoordinates()

savePredictedLineups()
```

Every function should have one responsibility.

---

# Candidate Generation

Every player should become

```ts
interface PlayerCandidate{

playerId

teamId

weightedScore

matchesStarted

appearances

minutesPlayed

averageRating

goals

assists

primaryPosition

secondaryPosition

tertiaryPosition

naturalPosition

positionSuitability

}
```

---

# Weighted Score

Current formula is poor.

Replace it.

Weight

35%

matches started

30%

minutes played

20%

average rating

10%

appearances

5%

goal contributions

Normalize inside each team.

Return

0-100

---

# Injury Rules

Exclude players

if

current_injury=true

OR

injury_status

is

Out

Unavailable

Doubtful

Do NOT simply exclude

expected_return_days>0

Instead compare expected return date against

match.date

A player returning before kickoff should still be eligible.

---

# Transfer Validation

Exclude players whose latest transfer places them at another club.

---

# Position Compatibility

Keep compatibility matrix.

Expand it if necessary.

Primary position

100%

Secondary

90%

Tertiary

75%

Fallback broad positions

50%

---

# Formation Candidates

Evaluate at least

```
433

4231

442

4141

451

352

343

541

```

Make adding new formations easy.

---

# Formation Scoring

Current scoring

```
weightedScore × suitability
```

is too forgiving.

Instead use

```
weightedScore

×

suitability²
```

Natural positions should dominate.

Playing someone out of position should heavily reduce score.

---

# Player Assignment

Do NOT use simple greedy assignment.

Current approach can waste players.

Instead

use maximum-weight assignment.

Examples

Hungarian algorithm

or

maximum bipartite matching.

Every player should only occupy one position.

Every position should only receive one player.

Optimize total squad score.

If implementing Hungarian is excessive,

build an improved assignment algorithm that:

* assigns hardest positions first

* reserves versatile players

* minimizes total suitability loss

Do not simply loop left-to-right.

---

# Formation Selection

Evaluate every formation.

Calculate

```
overall formation score
```

Select the highest scoring valid formation.

If multiple formations are within

2%

choose

the formation requiring the fewest out-of-position players.

---

# Confidence

Current implementation compares player A against the next player in lineup.

That is incorrect.

Instead compare against players competing for the SAME tactical position.

Example

RB

compare all RB candidates.

CB

compare all CB candidates.

CM

compare all CM candidates.

Confidence should consider

* weighted score difference

* positional suitability

* minutes played

* matches started

* rating

Output

0-1

---

# Position Ranking

rank_in_position

must be

GK

1

CB

1

CB

2

CM

1

CM

2

CM

3

NOT

lineup order.

---

# Lineup Order

Store lineup order separately.

```
1

GK

2

RB

3

RCB

4

LCB

...
```

This is used for rendering.

---

# Tactical Position

Store

```
RB

LB

RCB

LCB

DM

CM

AM

RW

LW

ST
```

---

# Natural Position

Also store

the player's natural position.

Example

```
natural_position

CM

tactical_position

DM
```

Frontend needs both.

---

# Pitch Coordinates

Store

```
x

y
```

for every formation.

Example

433

```
GK

50

95

RB

85

75

RCB

65

80

LCB

35

80

LB

15

75

DM

50

60

RCM

68

45

LCM

32

45

RW

82

20

ST

50

10

LW

18

20
```

Every formation should have predefined coordinates.

The frontend should only render circles.

---

# Captain

Automatically assign

captain

to

highest weightedScore player

with

high starts

high minutes

Assign

vice captain

to second best.

---

# Database Writes

Delete existing lineups for the processed matches.

Then insert.

Do not use upsert after deleting.

Insert in batches.

---

# Logging

Log

```
formation

formation score

out-of-position players

average confidence

captain

vice captain

```

---

# Performance

Avoid nested O(n³) loops wherever possible.

Precompute

* suitability maps

* normalized scores

* player lookup maps

* position lookup maps

---

# Code Quality

Requirements

* strongly typed

* modular

* documented

* no duplicated logic

* reusable helper functions

* readable

* production quality

No 600-line monolithic function.

---

# Expected Output

Produce:

1. Complete rewritten `processPredictedLineups()`

2. Helper functions

3. TypeScript interfaces

4. Formation coordinate maps

5. Position compatibility map

6. SQL migration

7. Any supporting utilities required

The final result should be production-ready, maintainable, deterministic, and require **no frontend inference** for rendering predicted formations or starting XIs.
