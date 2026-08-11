# Phase 8 S-4 — G-1: the `/match/{id}` discovery attempt

**G-1: BLOCKED — and the blocker has moved. The discovery call was NOT executed:
this environment's egress policy denies the provider host. No provider quota was
consumed and no `/match/{id}` payload exists.**

**One material finding came out of the pre-call analysis anyway**, from evidence
already committed: the provider **declares, per fixture, that per-event player
statistics exist** — for every played fixture and for no unplayed one. That is
new since [doc 35](./35-phase0-provider-capability-investigation.md) and it
sharpens G-1 without answering it.

No code, schema, migration, test, adapter or ingestion changed.

---

## 1. The G-1 question, as the audit states it

[Doc 33](./33-phase8-competition-context-investigation.md) §gaps:

> **G-1 — Per-fixture player minutes — is there a source? CRITICAL. Decides the
> entire feature. Cannot be answered from this repository.**

[Doc 35](./35-phase0-provider-capability-investigation.md) §1 bounded it to a
single unexercised candidate:

> `/match/{id}` is registered in V1's `ENDPOINT_REGISTRY` and invoked nowhere
> […] Its own description reads *"Get match details (teams, date, status)"*,
> which does **not** claim lineups. **One discovery call would settle whether G-1
> is answerable at all.**

Doc 35's own closing line names the exact call this task was to make.

## 2. What V2 requires — the appearance family

Six relations, all with **zero references in the V2 source tree** — no writer, no
runner, not even a disabled one. Verified again in this pass.

| Relation | Migration | NOT NULL columns needing a provider source |
|---|---|---|
| `football.lineup` | `005:169` | `fixture_id`, `team_id`; `formation` nullable |
| `football.lineup_selection` | `005:192` | `lineup_id`, `player_id`, **`is_starting`**; `position_code`, `shirt_number` nullable |
| `football.appearance` | `005:220` | `player_id`, `team_id`, **`participation_state_code`**, **`minutes_played`**, **`yellow_cards`**, **`red_cards`** |
| `football.match_event` | `005:257` | `event_sequence`, `event_type_code`; `minute`, `team_id`, `player_id` nullable |
| `football.official` | `004:306` | `full_name` |
| `football.official_assignment` | `005:144` | `official_id`, `role_code` |

Three constraints decide whether a degraded mode is even possible:

- `ck_appearance__minutes_plausible CHECK (minutes_played BETWEEN 0 AND 150)`
  with `NOT NULL` — **a placeholder cannot be written.** No minutes, no row.
- `ck_appearance__cards_plausible CHECK (yellow_cards BETWEEN 0 AND 2 AND
  red_cards BETWEEN 0 AND 1)` with `NOT NULL` on both.
- `participation_state_code` references a governed four-code vocabulary —
  `STARTED`, `SUBSTITUTED_ON`, `UNUSED_SUBSTITUTE`, `NOT_SELECTED`
  (`002:217-221`). Distinguishing the last two **requires the bench**, not just
  the eleven: doc 35 records that the single state column exists precisely
  because "named but unused" and "absent from the record entirely" are
  materially different facts for a fatigue model (LC-16).

`match_event.event_type_code` has **no governed vocabulary** — migration 005
carries an explicit TODO saying one must be added or the relation deferred until
a provider contract is confirmed. So G-12 needs a vocabulary decision on top of a
provider source.

`official_assignment.role_code` likewise has **no vocabulary** anywhere in the
migration set or the seed.

## 3. Identifiers needed to relate a payload back to V2

Everything except players is already resolvable, which is what makes this
competition the right place to ask:

| V2 entity | Provider key it is keyed by | Present in V2 today |
|---|---|---|
| fixture | `event.id` | **yes** — 47 fixtures for 325/87678 |
| team | `homeTeam.id` / `awayTeam.id` | **yes** — 20 clubs |
| venue | `venue.id` | **yes** |
| competition / edition | `uniqueTournament.id` / `season.id` | **yes** |
| **player** | **a provider player id per fixture** | **NO — no player has ever been ingested for this competition** |
| **official** | a provider official id | **NO** |

So even a perfect `/match/{id}` payload would need `football.player` populated
first. The squad endpoint (`team_squad`, `/team/{id}/players`) is registered in
V2 and uncalled; doc 35 records that G-4 and G-9 do **not** depend on G-1. That
ordering is unchanged and is not this task's business.

## 4. The selected match, and why

**Event `15237975` — Fluminense 1–1 Red Bull Bragantino, 2026-07-17.**

| Criterion | Why this fixture |
|---|---|
| **Completed** | `status.description = "Ended"`. An unplayed fixture cannot have an actual lineup, minutes or cards — it would answer nothing |
| **Already in V2** | inside the proven window `2026-05-31 … 2026-08-11`, so it is one of the 47 rows in `football.fixture` and every identifier in the payload is checkable against entities V2 holds |
| **Three red cards** | **the maximum in the window.** `appearance.red_cards` is `NOT NULL` with `CHECK (0..1)`; dismissals are the scarcest and most diagnostic discipline signal, and they also force substitutions |
| **Half-time ≠ full-time** (0–1 → 1–1) | scoring in both halves, so any incident array is populated across the match and time-stamped — what `match_event` (G-12) needs |
| **`hasEventPlayerStatistics: true`** | the provider itself declares per-event player statistics exist for this fixture (§6) |

Runner-up, if a second call is ever authorised: `15235418` — Vitória 0–4
Palmeiras, 2026-07-30, 2 reds and 4 goals.

## 5. The call — ATTEMPTED, NOT EXECUTED

```
GET https://v2.football.sportsapipro.com/api/match/15237975
Header: x-api-key: <redacted>
```

```
curl: (56) CONNECT tunnel failed, response 403
```

The agent egress proxy confirms it:

```json
{"kind":"connect_rejected",
 "detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)",
 "host":"v2.football.sportsapipro.com:443"}
```

`/root/.ccr/README.md` §"403 / 407 from the proxy": *"The destination host is not
allowed by your organization's egress policy."* The standing instruction is to
**report such denials rather than retry or work around them**, and that is what
this document does.

**Consequences, stated precisely:**

- **No provider quota was consumed.** The TLS tunnel was refused, so no request
  reached the provider. `operations.api_usage` is untouched.
- **No payload exists**, so §7's matrix cannot be filled from observation. It is
  filled from what is established, with the unknown column marked as unknown.
- This is a **failure to obtain**, not a finding about the provider — the same
  distinction doc 35 carried throughout, and for the same reason.
- The live runs 50–53 were executed by the operator on a local machine with
  direct network access. **This environment has never had provider egress**, and
  no earlier document is altered to suggest otherwise.

One further blocker, independent of egress: **`/match/{id}` is not in the V2
registry.** It exists only in V1's `beta/backend/src/constants/endpoints.ts:40-43`.
`operations.api_usage.endpoint_key` is `NOT NULL` and the V2 client resolves
paths through `ENDPOINTS`, so any V2 call to it needs a registry entry — a code
change, correctly out of scope for a discovery pass, and a prerequisite for any
implementation.

## 6. What the committed evidence already establishes — NEW

This did not require a call. It is in the captures taken for the pager and
standings work, and doc 35 could not have known it because those captures did not
exist yet.

**Every played fixture declares that per-event player statistics exist. No
unplayed one does.**

| Field | `events/last` (90 played) | `events/next` (30 unplayed) |
|---|---|---|
| `hasEventPlayerStatistics: true` | **86** | **0 — absent entirely** |
| `hasEventPlayerHeatMap: true` | 86 | 0 |
| `hasXg: true` | 86 | 0 |
| `detailId: 1` | 86 | 20 |

The correlation is **exact, with no residue**: the four played fixtures lacking
the flag are the four whose `status.description` is `Postponed` — `15235414`,
`15235440`, `15235419`, `15235423`, all 2026-07-30, all with `winnerCode: null`
and an empty score object. Flag present ⟺ the match was actually played.

The competition object declares the same capability at season level:
`tournament.uniqueTournament.hasEventPlayerStatistics: true`.

**What this is:** a provider assertion that per-event player statistics exist for
these fixtures. **What it is not:** a path, a schema, or a guarantee of minutes,
participation state or cards. The flag names a capability; it does not name the
endpoint that serves it, and **no endpoint name is inferred here** — inventing
one would be the provider-schema invention this programme has refused at every
step.

It does, however, move G-1's odds materially. Doc 35 could say only that no known
path *claims* per-fixture player data. The provider now says, per fixture, that
such data exists.

## 7. Requirement matrix

The middle column is what this task existed to fill and could not.
**"UNKNOWN — not observed"** means the call was blocked, not that the provider
lacks it.

| Requirement | Present in `/match/{id}`? | Exact provider evidence | Sufficient for V2? |
|---|---|---|---|
| Match participants (teams) | **UNKNOWN — not observed** | V1 registry description claims *"teams, date, status"* | already satisfied by the season feed |
| Starting XI / lineup | **UNKNOWN — not observed** | none | — |
| Formation | **UNKNOWN — not observed** | none | — |
| Substitutions | **UNKNOWN — not observed** | none | — |
| Player appearances | **UNKNOWN — not observed** | none | — |
| **Minutes played** | **UNKNOWN — not observed** | season aggregate `minutesPlayed` exists on `/teams/{id}/tournament/{t}/season/{s}/player-statistics` (V1, `syncSeasonStatistics.ts:268-270`) — **season totals, not per fixture** | **NO** at season grain |
| Player status (started / bench / unused) | **UNKNOWN — not observed** | none | — |
| Position information | **UNKNOWN — not observed** | squad endpoint carries positions, not per-fixture ones | not at fixture grain |
| Cards per player | **UNKNOWN — not observed** | season feed carries `homeRedCards` / `awayRedCards` — **team totals per fixture, no player** | **NO** — cannot attribute to a player |
| **Any player-match statistics** | **UNKNOWN — not observed** | **`hasEventPlayerStatistics: true` on 86/86 played fixtures** — declared to exist, path unnamed | **capability asserted, content unseen** |
| Officials / referee | **UNKNOWN — not observed** | none anywhere | — |
| Identifiers back to V2 | **UNKNOWN — not observed** | fixture, team, venue, edition all resolvable; **player and official are not** (§3) | player ingestion required first |

### The four-way split

1. **Directly available today** — fixture, team, venue, competition, edition,
   scores, half-time scores, status, round, kickoff. All from the season feed,
   all already ingested.
2. **Derivable from a returned payload** — nothing can be placed here.
   Derivation requires a payload.
3. **Available only from another endpoint** — season-aggregate player statistics
   including `minutesPlayed` (confirmed present, confirmed **insufficient**: one
   tournament-season total per player, no fixture grain, ~20 calls per season per
   domain).
4. **Not available** — nothing can be placed here either, and that is the honest
   answer. **Absence of evidence is not evidence of absence**, and §6 now points
   the other way.

**Appearance-level facts versus lineup/match-level:** the season feed supplies
**match-level** facts only — team-level red-card counts and scores. It supplies
**no appearance-level fact whatsoever**: not one player identity, minute, or card
attributable to a person. That has not changed. What has changed is that the feed
now tells us appearance-level data exists somewhere.

## 8. Verdict

> ### G-1: BLOCKED
>
> **Not blocked by the provider — blocked by this environment.** The single
> discovery call that doc 35 identified as the one thing that would change the
> report was attempted and refused at the egress proxy before reaching the
> provider. G-1's classification is therefore **unchanged: NOT CONFIRMED**, and
> `appearance`, `lineup`, `lineup_selection`, `match_event`, `official` and
> `official_assignment` remain without a source.
>
> The question is now **one authorised network call from an answer**, and the
> evidence in §6 makes it materially more likely that the answer is yes.

Deliberately **not** concluded: "partially answerable". Nothing about the
appearance family can be supported from anything observed, so a partial verdict
would overstate the evidence.

## 9. The precise missing capability, and the exact remaining dependency

**Missing capability (provider):** an endpoint returning, per fixture and per
player: identity, participation state, minutes played, and cards. `/match/{id}`
is the registered candidate and remains unexercised. §6 establishes that
per-event player statistics exist; **it does not establish which path serves
them**, and no path name is guessed here.

**The dependency, and it is the only one blocking this task:**

> **Egress to `v2.football.sportsapipro.com:443` is denied by this environment's
> network policy.** The environment's network policy is chosen when the
> environment is created — see
> https://code.claude.com/docs/en/claude-code-on-the-web. Either the host is
> added to the allowlist for this environment, or the call is made from the
> operator's local machine where runs 50–53 were executed.

**The call, ready to run, one call, no quota risk beyond one unit:**

```bash
curl -sS -H "x-api-key: $SPORTSAPI_KEY" \
  "https://v2.football.sportsapipro.com/api/match/15237975"
```

Fluminense 1–1 Red Bull Bragantino, 2026-07-17 — completed, in-window, three red
cards, `hasEventPlayerStatistics: true`. Capture it to
`docs/api-samples/v2-discovery/` beside its siblings, in the envelope
`discover.ts` writes.

**No implementation scope is defined here**, because the deliverable that would
justify one — a payload — does not exist. Defining acceptance criteria for a
writer whose source has not been seen would be inventing a provider schema.

---

## Boundaries observed

No appearance ingestion implemented. No schema change. No migration. No provider
adapter modified — `/match/{id}` is **still** absent from the V2 registry, and
adding it is recorded above as a prerequisite rather than done. No test added or
changed. No fixture changed. U-10 not implemented. `provider_statistic`
untouched. PD-16 not revisited. Forward window unchanged. No sweep performed.

**Zero provider calls completed. Zero quota consumed.** One call was attempted
and refused by the egress proxy before it left this environment.
