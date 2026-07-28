Instead of displaying 120+ raw fields, organize them into tabs or cards:

Overview
├── Rating
├── Readiness
├── Form
├── Minutes
├── Availability

Attacking
├── Goals
├── Shots
├── Finishing
├── Chance Creation

Passing
├── Accuracy
├── Final Third
├── Long Balls
├── Progression

Defending
├── Tackles
├── Recoveries
├── Interceptions
├── Duels

Physical
├── Distance
├── Sprints
├── Top Speed

Discipline
├── Fouls
├── Cards

Advanced Intelligence ⭐
├── Attack Efficiency
├── Creativity Index
├── Ball Progression
├── Press Resistance
├── Work Rate
├── Physical Readiness
├── Readiness Score
├── Confidence Score

This approach turns a large collection of raw statistics into a premium analytics experience. Casual users can quickly understand a player's strengths through summarized scores, while advanced users can drill down into the underlying metrics when they want more detail. It also aligns well with your vision of PitchTerminal as a football intelligence platform rather than just a statistics viewer.

A predicted starting XI is essentially a classification problem:

Given all available players, which 11 are most likely to start?

The player statistics you've shown are one of the inputs, but they're not the biggest signal.

What professional providers use

Most providers (Opta, StatsBomb, SofaScore, FotMob, betting companies) combine several datasets.

Past Lineups
        │
        ▼
Starting Probability
        ▲
        │
Player Statistics
        │
Injuries
        │
Suspensions
        │
Recent Form
        │
Minutes Played
        │
Fixture Congestion
        │
Coach Rotation Patterns
        │
Transfers
        │
Position
        │
Opponent

The model then predicts

GK

RB CB CB LB

CM CM

RW CAM LW

ST
Your player statistics contribute several important signals
1. Starts
matchesStarted

This is probably the strongest predictor.

Example

13 appearances
12 starts

versus

13 appearances
2 starts

The first player is almost certainly first choice.

2. Minutes Played
minutesPlayed

Example

982 minutes

versus

120 minutes

982 minutes strongly suggests the player is a regular starter.

3. Appearances
appearances

Useful for distinguishing regular squad members from fringe players.

4. Recent Rating
rating

A player averaging

7.4

is much less likely to be dropped than someone averaging

6.2
5. Physical Metrics

Very useful.

Top Speed

Distance Covered

Sprints

Suppose a winger usually runs

11 km

32 sprints

but suddenly records

6 km

12 sprints

He may be carrying fatigue or returning from injury.

6. Position
Position = M

The prediction model first groups players by position.

For example

Goalkeepers

Defenders

Midfielders

Forwards

Then selects candidates within each position.

7. Availability
playedEnough

This tells you whether enough data exists to evaluate the player.

But this dataset is missing the most important feature

It only contains season aggregates.

To predict tomorrow's lineup, you need recent matches.

Example

Last 5 matches

Started
Started
Bench
Started
Bench

This trend is much more informative than total season minutes.

The ideal database for prediction

For every match store

player_match_load

match_id

player_id

started

minutes

position

rating

subbed_in

subbed_out

captain

formation_position

Now you can compute

Starts in last 5

Starts in last 3

Minutes in last 5

Average rating

Rest days

Consecutive starts

These become powerful features.

Add injury information
player_injuries
Available

Doubtful

Out

Suspended

Recovering

This removes unavailable players before prediction.

Add fixture congestion
Days since last match

Minutes played in last 14 days

Minutes in last 7 days

Example

270 minutes

in 7 days

Many coaches rotate players after heavy workloads.

Coach rotation tendency

One of the strongest predictors.

Example

Coach A

Always keeps same XI

Coach B

Rotates every Europa League game

The model should learn this automatically.

Formation

If the team usually plays

4-2-3-1

then you need

1 GK

4 DEF

2 CM

3 AM

1 ST

The algorithm selects the highest-probability players for each role.

A scoring model

Instead of making a yes/no decision immediately, calculate a Starting Probability Score for every player.

Example:

Feature	Weight
Started last match	30%
Starts in last 5	20%
Minutes in last 5	15%
Season starts	10%
Average rating	10%
Injury status	10%
Rest days	5%

Then compute:

Starting Probability

98%

92%

88%

81%

74%

63%

41%

18%

Finally:

Select the top-ranked goalkeeper.
Fill each position according to the expected formation.
Resolve ties by favoring players with stronger recent form or more starts.
For PitchTerminal, I'd recommend going further

Since you're already building Readiness Intelligence, don't just predict who starts—predict how likely they are to start and why.

For each player, expose something like:

Player	Start Probability	Confidence	Reasoning
Montader Madjed	97%	High	Started 12 of 13 matches, 982 minutes, consistent ratings
Wilson Lindberg Uhrstrom	28%	Medium	Mostly substitute appearances (29 minutes in latest match)
Sourou Koné	5%	High	Only 1 appearance, 1 minute played

This is much more valuable than simply showing a predicted XI because it explains the evidence behind each selection and gives users confidence in the prediction.

This is actually a common problem with lineup generators. The bug isn't the rendering—it's the selection algorithm.

You're trying to solve two problems at once:

Who are the best 11 players?
How do they fit into a valid formation?

Those should be two separate steps.

Why you're getting only 10 players

I suspect your algorithm is doing something like:

Pick:
1 GK
2 CB
1 LB
1 RB
2 CM
2 Wingers
1 ST

If the squad has:

RB = 1
LB = 0

then one slot remains empty.

Or perhaps:

Need:
2 CM

Available:
1 CM
2 DM

The DMs are ignored, leaving only one central midfielder and a lineup of 10.

This is a rigid formation engine.

Don't build lineups from positions

Instead, build them from roles.

For example, normalize all positions.

Defensive roles
CB
LCB
RCB
SW

↓

CENTER_BACK
LB
LWB

↓

LEFT_DEFENDER
RB
RWB

↓

RIGHT_DEFENDER
Midfield roles
DM
CDM

↓

DEFENSIVE_MID
CM

↓

CENTRAL_MID
AM
CAM

↓

ATTACKING_MID
Wide roles
LM
LW

↓

LEFT_ATTACK
RM
RW

↓

RIGHT_ATTACK
Forward
CF
ST
SS

↓

STRIKER

Now you have maybe 8 universal roles, not 20+ raw position strings.

Introduce Position Flexibility

Every player should have:

player_id

primary_position

secondary_positions

selection_score

Example

Player

Primary

CM

Secondary

DM
AM

Another

Primary

RW

Secondary

LW
RM

When filling a formation:

Need CM

No CM available

↓

Look for DM

↓

Look for AM

↓

Choose highest score

Now the slot is always filled.

Step 1: Pick the best players

Ignore formation initially.

Rank everyone.

Example

Player	Score
A	97
B	96
C	94
D	92
E	90
F	89
G	87
H	86
I	85
J	83
K	82
L	60

Top 11 become candidates.

Step 2: Find the best formation

Instead of forcing 4-4-2, test multiple formations.

For example:

4-4-2

4-3-3

4-2-3-1

3-5-2

5-3-2

4-1-4-1

4-5-1

For each formation:

Can every slot be filled?

↓

Yes

↓

How good is each player fit?

↓

Total Formation Score

Example

4-4-2
Score

88

because you only have

1 winger
4-3-3
95

because

3 strong attackers
3-5-2
80

because

Only two CBs

Pick

4-3-3

automatically.

How to score formation fit

Every assignment gets a multiplier.

Primary position

100%

Secondary

90%

Related position

75%

Emergency

50%

Example

Player

Primary

DM

Needs to play

CM

Multiplier

90%

Another

RW

↓

LW

85%

Another

ST

↓

CM

20%

Avoid.

This guarantees 11 players

Because every slot has fallback positions.

Example

Need

LB

No LB

↓

Find

LWB

↓

No LWB

↓

LCB

↓

No LCB

↓

LM

↓

Highest score wins.

No empty slot.

Better yet: Let the squad choose the formation

Instead of hardcoding formations, infer one from the squad composition.

Example:

3 excellent CBs

2 average fullbacks

5 strong midfielders

2 strikers

The best fit is naturally:

3-5-2

Another squad:

2 CBs

2 attacking fullbacks

3 midfielders

3 forwards

Best fit:

4-3-3

You're maximizing the total selection score rather than forcing a tactical shape.

Architecture I'd use for PitchTerminal
Phase 1 — Score every player
selection_score
availability_score
fitness_score
position_flexibility
Phase 2 — Generate every legal formation
4-3-3
4-2-3-1
4-4-2
4-1-4-1
3-5-2
5-3-2
5-4-1
3-4-3
Phase 3 — Solve the assignment

For each formation:

Assign the highest-scoring available player to each role.
Use primary positions first, then secondary or related positions if needed.
Ensure each player is used only once.
Calculate a formation fitness score based on player quality and positional fit.
Phase 4 — Choose the best result

Select the formation with the highest overall fitness score.

The output becomes:

Formation: 4-2-3-1

Overall Fit: 96%

Players Assigned: 11/11

Position Fit: 93%

Confidence: High

This completely eliminates the "10-player lineup" issue, avoids forcing a 4-4-2, and produces formations that better reflect the available squad. As you later add richer data (multiple positions per player, historical lineups, injuries, tactical preferences), the same architecture scales naturally without needing to redesign the lineup engine

The two biggest problems
1. 10-player bug

This happens because your algorithm assumes every team has

1 GK
4 DEF
4 MID
2 FWD

If a team only has

3 defenders
5 midfielders
2 forwards

it simply returns

1
3
4
2
---------
10 players

instead of filling the missing defender.

This is the easier bug.

2. Fixed 4-4-2

This is actually the bigger issue.

Modern football rarely uses 4-4-2.

You'll commonly see

4-3-3
4-2-3-1
3-5-2
3-4-3
4-1-4-1
4-5-1
5-3-2
5-4-1

Your data actually contains enough information to infer these.

What data do we actually have?

You have

primary_position

GK
RB
LB
CB
DM
CM
AM
RM
LM
RW
LW
ST
CF

plus

matches_started
minutes
appearances
rating

That is enough.

You don't need lineup APIs.

Step 1 — Stop thinking in formations

Instead think in roles.

Example.

Instead of

Need 4 midfielders

think

Central Midfielders
Wide Midfielders
Attacking Midfielders
Holding Midfielders

Example roster

GK

RB
CB
CB
LB

DM
CM
CM

RW
LW

ST

Immediately you know

4-3-3

without hardcoding.

Step 2 — Count the natural positions

Imagine Arsenal.

GK

RB
LB

CB
CB
CB

DM
DM

CM
CM

AM

RW
LW

ST
ST

The highest-ranked players are

GK

RB
LB

CB
CB

DM

CM
CM

RW
LW

ST

That's naturally

4-3-3

No formation rules needed.

Another team

GK

RB
CB
CB
LB

DM
DM

AM

RW
LW

ST

becomes

4-2-3-1

Another

GK

CB
CB
CB

RM
LM

CM
CM
CM

ST
ST

becomes

3-5-2
Step 3 — Formation should be discovered

Instead of

const FORMATION = {
G:1,
D:4,
M:4,
F:2
}

You should generate it.

Example.

Count the best available players by natural role.

Example

Defenders

RB
CB
CB
LB

=4

Midfield

DM
CM
CM

=3

Attack

RW
LW
ST

=3

Result

4-3-3

Another

CB
CB
CB

RM
LM

CM
CM
CM

ST
ST

Result

3-5-2
Step 4 — Flexible XI builder

Instead of

Pick

4 defenders
4 mids
2 forwards

Do

Sort every player by score.

Start with GK.

Then repeatedly add the highest ranked player while respecting football constraints.

Constraints

Exactly 1 GK

Minimum 3 defenders

Maximum 5 defenders

Minimum 2 midfielders

Maximum 5 midfielders

Minimum 1 striker

Maximum 3 strikers

Exactly 11 players

This completely eliminates the 10-player bug.

Example.

Suppose

1 GK

3 defenders

6 midfielders

4 forwards

Current algorithm

1
3
4
2

10

New algorithm

1 GK

3 DEF

4 MID

3 ATT

11

Formation

3-4-3

Another team

1 GK

5 DEF

5 MID

1 FW

becomes

5-4-1
Step 5 — Use secondary positions

Right now

CM
DM
AM

are treated as different.

But football doesn't.

Instead build a position compatibility matrix.

Example

CM

primary:
CM

secondary:
DM
AM

DM

primary:
DM

secondary:
CM

AM

primary:
AM

secondary:
CM

RB

primary:
RB

secondary:
RWB

LB

primary:
LB

secondary:
LWB

RW

primary:
RW

secondary:
RM
LW

LW

primary:
LW

secondary:
LM
RW

ST

primary:
ST

secondary:
CF

CF

primary:
CF

secondary:
ST

Then scoring becomes

Primary position

100%

Secondary

90%

Third

75%

Now a

DM

can fill

CM

without creating a hole.

Step 6 — Never leave a slot empty

Suppose

Need LB

No LB exists.

Current

Nothing selected.

New

Search in order

LB

LWB

CB

LM

DM

Choose highest compatibility.

Now you always have

11 players.
Step 7 — Store detected formation

Instead of only storing

position_code

also save

formation

4-3-3

4-2-3-1

3-5-2

Then your UI can draw

RB
CB
CB
LB

DM

CM
CM

RW
LW

ST

instead of forcing

4-4-2
Step 8 — Add lineup confidence

You already calculate confidence per player.

Also calculate confidence for the formation itself.

Example

Natural positions perfectly fit

Formation confidence

96%

Another

Had to move

CM -> DM

RW -> LW

LB -> CB

Formation confidence

68%

This is useful for bettors because it indicates how much the predicted shape relies on players being used outside their usual roles.

What I would change in your code

I would replace this completely:

const FORMATION = {
    G:1,
    D:4,
    M:4,
    F:2
}

with a two-stage pipeline:

Stage 1: Score players

Exactly as you already do.

Your weighted scoring is solid:

Starts
Appearances
Rating
Minutes
Goal contributions
Stage 2: Formation inference

Build the strongest legal XI while respecting:

Exactly 1 goalkeeper
Exactly 11 players
Natural positions first
Secondary positions when necessary
Football-valid role limits (e.g., 3–5 defenders, 2–5 midfielders, 1–3 forwards)

The resulting counts determine the formation automatically:

4 defenders, 3 midfielders, 3 attackers → 4-3-3
4 defenders, 2 midfielders, 4 attacking players (including AM) → 4-2-3-1
3 defenders, 5 midfielders, 2 forwards → 3-5-2
5 defenders, 4 midfielders, 1 forward → 5-4-1
Overall recommendation

I would not try to "fix the 4-4-2 algorithm." I'd replace it with a formation inference engine.

Your existing player ranking logic is already quite good. The weak point is the selection phase. A constraint-based selector with position compatibility and automatic formation detection would:

✅ Always produce 11 players
✅ Infer realistic formations instead of forcing 4-4-2
✅ Handle versatile players (CM/DM/AM, RW/LW, etc.)
✅ Degrade gracefully for teams with incomplete or unbalanced squads
✅ Produce a formation that the UI can render naturally without hardcoded assumptions

That architecture will scale much better as your data grows and will give bettors a more believable predicted XI even without access to official predicted lineup APIs.
The two biggest problems
1. 10-player bug

This happens because your algorithm assumes every team has

1 GK
4 DEF
4 MID
2 FWD

If a team only has

3 defenders
5 midfielders
2 forwards

it simply returns

1
3
4
2
---------
10 players

instead of filling the missing defender.

This is the easier bug.

2. Fixed 4-4-2

This is actually the bigger issue.

Modern football rarely uses 4-4-2.

You'll commonly see

4-3-3
4-2-3-1
3-5-2
3-4-3
4-1-4-1
4-5-1
5-3-2
5-4-1

Your data actually contains enough information to infer these.

What data do we actually have?

You have

primary_position

GK
RB
LB
CB
DM
CM
AM
RM
LM
RW
LW
ST
CF

plus

matches_started
minutes
appearances
rating

That is enough.

You don't need lineup APIs.

Step 1 — Stop thinking in formations

Instead think in roles.

Example.

Instead of

Need 4 midfielders

think

Central Midfielders
Wide Midfielders
Attacking Midfielders
Holding Midfielders

Example roster

GK

RB
CB
CB
LB

DM
CM
CM

RW
LW

ST

Immediately you know

4-3-3

without hardcoding.

Step 2 — Count the natural positions

Imagine Arsenal.

GK

RB
LB

CB
CB
CB

DM
DM

CM
CM

AM

RW
LW

ST
ST

The highest-ranked players are

GK

RB
LB

CB
CB

DM

CM
CM

RW
LW

ST

That's naturally

4-3-3

No formation rules needed.

Another team

GK

RB
CB
CB
LB

DM
DM

AM

RW
LW

ST

becomes

4-2-3-1

Another

GK

CB
CB
CB

RM
LM

CM
CM
CM

ST
ST

becomes

3-5-2
Step 3 — Formation should be discovered

Instead of

const FORMATION = {
G:1,
D:4,
M:4,
F:2
}

You should generate it.

Example.

Count the best available players by natural role.

Example

Defenders

RB
CB
CB
LB

=4

Midfield

DM
CM
CM

=3

Attack

RW
LW
ST

=3

Result

4-3-3

Another

CB
CB
CB

RM
LM

CM
CM
CM

ST
ST

Result

3-5-2
Step 4 — Flexible XI builder

Instead of

Pick

4 defenders
4 mids
2 forwards

Do

Sort every player by score.

Start with GK.

Then repeatedly add the highest ranked player while respecting football constraints.

Constraints

Exactly 1 GK

Minimum 3 defenders

Maximum 5 defenders

Minimum 2 midfielders

Maximum 5 midfielders

Minimum 1 striker

Maximum 3 strikers

Exactly 11 players

This completely eliminates the 10-player bug.

Example.

Suppose

1 GK

3 defenders

6 midfielders

4 forwards

Current algorithm

1
3
4
2

10

New algorithm

1 GK

3 DEF

4 MID

3 ATT

11

Formation

3-4-3

Another team

1 GK

5 DEF

5 MID

1 FW

becomes

5-4-1
Step 5 — Use secondary positions

Right now

CM
DM
AM

are treated as different.

But football doesn't.

Instead build a position compatibility matrix.

Example

CM

primary:
CM

secondary:
DM
AM

DM

primary:
DM

secondary:
CM

AM

primary:
AM

secondary:
CM

RB

primary:
RB

secondary:
RWB

LB

primary:
LB

secondary:
LWB

RW

primary:
RW

secondary:
RM
LW

LW

primary:
LW

secondary:
LM
RW

ST

primary:
ST

secondary:
CF

CF

primary:
CF

secondary:
ST

Then scoring becomes

Primary position

100%

Secondary

90%

Third

75%

Now a

DM

can fill

CM

without creating a hole.

Step 6 — Never leave a slot empty

Suppose

Need LB

No LB exists.

Current

Nothing selected.

New

Search in order

LB

LWB

CB

LM

DM

Choose highest compatibility.

Now you always have

11 players.
Step 7 — Store detected formation

Instead of only storing

position_code

also save

formation

4-3-3

4-2-3-1

3-5-2

Then your UI can draw

RB
CB
CB
LB

DM

CM
CM

RW
LW

ST

instead of forcing

4-4-2
Step 8 — Add lineup confidence

You already calculate confidence per player.

Also calculate confidence for the formation itself.

Example

Natural positions perfectly fit

Formation confidence

96%

Another

Had to move

CM -> DM

RW -> LW

LB -> CB

Formation confidence

68%

This is useful for bettors because it indicates how much the predicted shape relies on players being used outside their usual roles.

What I would change in your code

I would replace this completely:

const FORMATION = {
    G:1,
    D:4,
    M:4,
    F:2
}

with a two-stage pipeline:

Stage 1: Score players

Exactly as you already do.

Your weighted scoring is solid:

Starts
Appearances
Rating
Minutes
Goal contributions
Stage 2: Formation inference

Build the strongest legal XI while respecting:

Exactly 1 goalkeeper
Exactly 11 players
Natural positions first
Secondary positions when necessary
Football-valid role limits (e.g., 3–5 defenders, 2–5 midfielders, 1–3 forwards)

The resulting counts determine the formation automatically:

4 defenders, 3 midfielders, 3 attackers → 4-3-3
4 defenders, 2 midfielders, 4 attacking players (including AM) → 4-2-3-1
3 defenders, 5 midfielders, 2 forwards → 3-5-2
5 defenders, 4 midfielders, 1 forward → 5-4-1
Overall recommendation

I would not try to "fix the 4-4-2 algorithm." I'd replace it with a formation inference engine.

Your existing player ranking logic is already quite good. The weak point is the selection phase. A constraint-based selector with position compatibility and automatic formation detection would:

✅ Always produce 11 players
✅ Infer realistic formations instead of forcing 4-4-2
✅ Handle versatile players (CM/DM/AM, RW/LW, etc.)
✅ Degrade gracefully for teams with incomplete or unbalanced squads
✅ Produce a formation that the UI can render naturally without hardcoded assumptions

That architecture will scale much better as your data grows and will give bettors a more believable predicted XI even without access to official predicted lineup APIs.