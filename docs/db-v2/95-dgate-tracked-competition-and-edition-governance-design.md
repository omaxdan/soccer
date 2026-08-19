# D-GATE — Combined Tracked-Competition + Season/Edition Governance Design

**Status:** DESIGN GATE — contract only. No code, migration, seed, DB write, or provider
call was produced. Conceptual schema only.
**Working tree:** `033a451`.
**Composes:** V6 (competition enumeration) **and** V5 (season selection) as **one**
governance layer — not two unrelated registries.

---

## 0. Grading and scope

Facts are graded **AUTHORITATIVE** (schema / committed capture), **EMPIRICAL**
(runtime, e.g. Run 76), or **UNVERIFIED** (docs egress-blocked). The design authorizes
nothing on UNVERIFIED evidence.

The one sentence the whole design turns on:

> **Discovery of a competition or season is never authorization to ingest it broadly.**
> Discovery produces *candidates*; a governance decision produces *authorization*.

---

## 1. Existing identity chain — PRESERVED, NOT REDESIGNED

Verified in source this gate and treated as fixed architecture:

| Level | Provider source | V2 relation | Identity / key | Evidence |
|---|---|---|---|---|
| Competition | `event.tournament.uniqueTournament.id` | `football.competition` | `uq_competition__provider_external_id (provider_code, provider_external_id)` | `004_football.sql:34-48` — AUTHORITATIVE |
| Edition | `season.id` | `football.competition_edition` | global alt-key `provider_external_id` (mig `022`); business key `(competition_id, season_period)`; non-overlap exclusion | `004_football.sql:54-70` — AUTHORITATIVE |
| Stage/phase | (below edition) | `football.competition_stage` | `(competition_edition_id, stage_ordinal)`, `nesting_depth 0-4` | `004_football.sql:75-93` — AUTHORITATIVE |

`event.tournament.id` is the season/phase instance and is **never** the competition key.
`reference.ts:160` already throws if one provider season arrives under two competitions.
**None of this is changed.** The governance layer sits *above* it and *references* it; it
adds no identity and relaxes no constraint.

---

## 2. Tracked-competition governance contract

**Principle: provider identity stays on `football.competition` (immutable, provider-owned);
PitchTerminal governance state lives in a separate relation.** They are joined, never merged.

Proposed relation **`governance.tracked_competition`** (schema placement in §9).

| Field | Kind | Necessity | Source |
|---|---|---|---|
| `id` | identity (surrogate) | PK | PT |
| `provider_code` | **identity** | The registry must be answerable *before* a `football.competition` row exists, so it keys on provider identity, not on the reality row. | provider |
| `provider_external_id` | **identity** (= `uniqueTournament.id`) | Same. This is the join key to reality once the row exists. | provider |
| `competition_id` (NULL FK → `football.competition.id`) | **operational linkage** | Set once the reality row exists; NULL means "authorized/known but not yet materialized." Keeps governance decidable ahead of ingestion. | PT (linkage) |
| `competition_type_code` | **classification** (governance) | league vs cup drives edition shape, standings applicability, and phase expectations (§5). Cannot be trusted from provider (`category.name` is geography, and not even stored). | **PT-governed** |
| `competition_scope_code` | **classification** (governance) | DOMESTIC / CONTINENTAL / INTERNATIONAL — orthogonal to type; needed because continental competitions map to `category='World'`/unmapped and cannot be inferred. | **PT-governed** |
| `tracking_status_code` | **governance state** | The actual authorization lifecycle (§10). This is what broad ingestion checks. | PT-governed |
| `decided_by`, `decided_at` | **auditability** | Every authorization must name who and when. | PT |
| `note` | operational | Rationale for the decision. | PT |
| `created_at`, `updated_at` | operational | Standard. | PT |

**Deliberately NOT included:**
- `tier` — not required for ingestion authorization; a competition is tracked or not
  regardless of tier. Omit until a concrete consumer needs it (avoid inventing a dimension).
- Any competition **name/slug/country** — those live on `football.competition` (reality),
  never duplicated into governance.

**Constraints:** `UNIQUE (provider_code, provider_external_id)`; `UNIQUE (competition_id)
WHERE competition_id IS NOT NULL`; FK `competition_id` → `football.competition (id)`
`ON DELETE RESTRICT`.

---

## 3. Season/edition governance contract (this is the V5 registry)

Proposed relation **`governance.tracked_edition`** — the durable, auditable form of today's
safe operator-supplied `--season`.

| Field | Kind | Necessity | Source |
|---|---|---|---|
| `id` | identity | PK | PT |
| `tracked_competition_id` FK → `governance.tracked_competition.id` | **linkage** | Every edition binding belongs to exactly one tracked competition. | PT |
| `provider_season_external_id` (= `season.id`) | **identity** | The provider season this binding authorizes; the join key to `football.competition_edition.provider_external_id`. | provider |
| `competition_edition_id` (NULL FK → `football.competition_edition.id`) | **operational linkage** | Set once the reality edition exists; NULL = approved but not yet materialized. | PT (linkage) |
| `season_period` (daterange) | **governance-approved period** | The authoritative period; must agree with the edition's immutable `season_period` once linked. Removes reliance on year-token derivation for *selection* (dating stays where it is). | PT-governed |
| `edition_status_code` | **governance state** | Lifecycle (§10): APPROVED / ACTIVE / SUPERSEDED / HISTORICAL / UNAVAILABLE. | PT-governed |
| `authorized_for_ingestion` (bool) | **authorization** | Explicit gate; ACTIVE is necessary but the boolean makes authorization unmistakable and separately auditable. | PT-governed |
| `decided_by`, `decided_at`, `note` | auditability | Who approved this season and why. | PT |

**Constraints (these encode deterministic selection):**
- `UNIQUE (tracked_competition_id, provider_season_external_id)` — one binding per season.
- **`UNIQUE (tracked_competition_id) WHERE edition_status_code = 'ACTIVE'`** — *at most one
  ACTIVE edition per competition at any time.* This is the whole of V5's deterministic
  selection: the current season is the one governance marked ACTIVE, never `seasons[0]`,
  never `max(year)`, never a name parse, never provider ordering.
- `UNIQUE (competition_edition_id) WHERE competition_edition_id IS NOT NULL`.
- FK `competition_edition_id` → `football.competition_edition (id)` `ON DELETE RESTRICT`.

**Forbidden selectors** (`seasons[0]`, `max(year)`, name parsing) do not appear anywhere;
the ACTIVE row *is* the selection.

---

## 4. Composition — explicit and fail-closed

**Ingestion authorization predicate** (what a broad automated job MUST evaluate, read-only):

```
authorized(competition, season) :=
      tracked_competition.tracking_status_code = 'TRACKED'
  AND tracked_edition.edition_status_code      = 'ACTIVE'
  AND tracked_edition.authorized_for_ingestion = true
  AND tracked_edition.tracked_competition_id   = tracked_competition.id
```

Answers to the required questions:

| Question | Answer |
|---|---|
| Competition tracked without an edition? | **Yes.** TRACKED with no ACTIVE edition = authorized in principle, not ingestable now → broad ingestion **refused** (fail-closed). |
| Edition exists without authorization? | **Yes.** APPROVED / HISTORICAL / UNAVAILABLE editions exist but do not authorize; only ACTIVE + `authorized_for_ingestion` does. |
| Multiple editions active? | **No** — the partial unique constraint permits exactly one ACTIVE per competition. Historical re-ingestion is a separate, explicitly-authorized operator action, not an ACTIVE state. |
| Season boundary? | Old ACTIVE → SUPERSEDED/HISTORICAL and new APPROVED → ACTIVE in one governed transition (§11). Never automatic. |
| Historical editions retained? | Yes, as HISTORICAL rows; reality identity preserved by existing edition constraints. |
| New season activated? | Governance transition APPROVED → ACTIVE, which supersedes the prior ACTIVE. |
| Edition of A attached to B? | Prevented at reality (global alt-key + `reference.ts:160`) **and** governance (binding is under one `tracked_competition_id`; linkage FK inherits the reality guarantee). |
| Broad ingestion on an ungoverned competition? | No registry row / not TRACKED ⇒ predicate false ⇒ **refuse**. |

---

## 5. Competition-type governance — minimum vocabulary

V6 proved no type is stored and `category.name` is geography, not type. Three layers kept
strictly separate:

- **A. Provider facts:** `uniqueTournament.id`, `category.name`, `name`. Usable as *hints*
  only. `category.name` is UNVERIFIED as a type signal.
- **B. PT governance classification:** the authoritative values, set by a person.
- **C. Ingestion authorization:** derived from status (§4), never from A.

**Minimum vocabularies (governed, not seeded this gate):**
- `competition_type_code`: **`LEAGUE`**, **`CUP`**, **`OTHER`**. (League vs cup is the only
  distinction ingestion actually needs — standings applicability and phase expectations.
  `OTHER` is the honest bucket, never a default that authorizes.)
- `competition_scope_code`: **`DOMESTIC`**, **`CONTINENTAL`**, **`INTERNATIONAL`**.

**Deliberately NOT built:** youth / reserve / amateur / friendly as vocabulary. Those are
simply **never granted TRACKED status** — an authorization decision, not a taxonomy. Building
the taxonomy would invite the assumption that categorization implies coverage.

**If type cannot be safely derived** (the normal case): the governance value is
**curated by a person**; a provider hint may pre-fill a CANDIDATE row but never sets the
authoritative value and never advances status.

---

## 6. Provider enumeration (`/tournaments`)

State: defined (`endpoints.ts:61`), **zero callers**, **no committed capture**, docs host
egress-blocked → **UNVERIFIED**. Therefore:

- The registry is **manually curated** as the safe default.
- Provider enumeration, if ever wired, produces **CANDIDATE rows only** — never TRACKED,
  never authorization.
- A future catalogue sync is permissible strictly as a discovery feeder into CANDIDATE.
- **Enumeration can never authorize ingestion automatically.**
- **Evidence required before trusting `/tournaments`:** a committed capture proving
  (a) exhaustiveness, (b) pagination behavior, (c) stable provider IDs, (d) whether it
  exposes a usable type — until all four are AUTHORITATIVE/EMPIRICAL, it stays candidate-only.

Safe default, restated: `provider discovery → candidate` ; `governance decision → authorized`.

---

## 7. Broadening / silent-write prevention

| Path | Current behavior | Future governance rule |
|---|---|---|
| **A. `schedule/{date}`** (`schedule.ts:251`, unscoped) | Writes every competition of the day. | May continue as a **discovery** source: competitions it surfaces land as CANDIDATE identity, never authorized. Broad automated intelligence runs only on TRACKED+ACTIVE. |
| **B. team spine** (cross-competition, Run 76 → 325/373/384) | Discovers cross-competition events. | **Keep** — discovery is useful. Discovered competitions land as CANDIDATE; **never auto-TRACKED**. |
| **C. `resolveCompetition()`** (`reference.ts:58`) | Any event upserts its competition. | Creating an identity **row** stays allowed (identity ≠ authorization). Broad ingestion checks the §4 predicate before doing spine/intelligence work; a fresh row defaults to no authorization. |
| **D. optional scope** (`ingestEvents` scope absent = no filter) | Absent scope = ingest all. | In **broad automated mode**, absent/empty tracked set must mean **refuse**, never "all". Empty is fail-closed, not fail-open. |
| **E. CLI default-to-schedule** | Unrecognized command silently → `schedule`. | Unrecognized command must **error**. (Latent risk flagged in V6/I1 gates; the fix belongs to the broad-ingestion implementation gate.) |

Bounded, operator-named runs (I1) are unaffected: the operator *is* the governance decision
for that one run.

---

## 8. `product.watchlist` and `active_competitions` — not governance

Verified from source:
- **`product.watchlist`** (`011_product.sql:107`): per-user (`user_id NOT NULL → auth.users`),
  RLS-scoped, references competitions that must already exist. It is downstream product state.
  Repurposing it would conflate *user interest* with *ingestion authorization* and put
  authorization under user-scoped RLS. **Excluded.**
- **`active_competitions`** (`004_active_competitions.sql`): a derived
  `COUNT(DISTINCT competition)` intelligence metric. Not a set, not authoritative. **Excluded.**

Neither participates in ingestion governance.

---

## 9. Migration boundary (conceptual only — no SQL)

**Two new relations, in a new `governance` schema** (owned `pt_owner`, consistent with every
existing schema).

| | `governance.tracked_competition` | `governance.tracked_edition` |
|---|---|---|
| Purpose | Authoritative "which competitions may be ingested" | Authoritative "which season per competition may be ingested" |
| Business key | `(provider_code, provider_external_id)` | `(tracked_competition_id, provider_season_external_id)` |
| FKs | `competition_id` → `football.competition` (NULL, RESTRICT) | `tracked_competition_id` → `tracked_competition`; `competition_edition_id` → `football.competition_edition` (NULL, RESTRICT) |
| Uniqueness | provider identity; competition_id when present | season per competition; **one ACTIVE per competition (partial)**; edition_id when present |
| Status fields | `tracking_status_code` | `edition_status_code`, `authorized_for_ingestion` |
| Required constraints | FK RESTRICT; status ∈ vocab | partial-unique ACTIVE; period agreement with linked edition; FK RESTRICT |

**Security / RLS (critical fail-closed property):** governance relations are **written only by
a governance role** (`pt_platform_admin` / `pt_owner`) and are **SELECT-only for
`pt_pipeline_ingestion`**. The role that ingests can never grant itself authorization. RLS
enabled and forced, matching the platform posture (`016`/`018`).

**Schema choice:** a dedicated `governance` schema is preferred over `football` (which is
provider *reality*, not PT policy) and over `operations` (telemetry, not policy). If a new
schema is undesirable, second choice is `operations`; `football` is rejected because it would
mix immutable provider identity with mutable PT policy.

**Untouched — must remain so:** `football.competition`, `football.competition_edition`,
`football.competition_stage`, `football.team_registration`, and every existing constraint
(alt-keys, non-overlap exclusion, immutability). The governance layer only references them.

---

## 10. State machines (smallest correct)

**A. Tracked competition**
```
CANDIDATE ──(governance approve)──▶ TRACKED ──(governance)──▶ SUSPENDED
   │                                   ▲                          │
   │(governance reject/retire)         └────(governance resume)───┘
   ▼                                   
RETIRED ◀───(governance)────────────── TRACKED / SUSPENDED
```
- **Automatic:** only `→ CANDIDATE` (from discovery: schedule/team/catalogue).
- **Governance-controlled:** every other transition. Authorization requires TRACKED.

**B. Governed edition**
```
APPROVED ──(governance activate)──▶ ACTIVE ──(governance supersede)──▶ SUPERSEDED ──▶ HISTORICAL
                                     │  ▲
                     (temporary)     ▼  │ (governance restore)
                                  UNAVAILABLE
```
- **Automatic:** none that authorize; discovery may *propose* a binding (a non-authorizing
  pre-APPROVED candidate), never ACTIVE.
- **Governance-controlled:** APPROVED, ACTIVE (which supersedes the prior ACTIVE atomically),
  UNAVAILABLE, HISTORICAL.

**C. Ingestion authorization** — not a stored machine; the **derived predicate** of §4.

---

## 11. Season-boundary behavior

- **Current season ends:** its ACTIVE row → SUPERSEDED/HISTORICAL; if no new ACTIVE is
  approved, the competition has **no authorized edition** → broad ingestion refused. No gap
  is filled by provider ordering.
- **New season appears (discovery):** lands as a proposed/APPROVED binding requiring an
  explicit governance ACTIVE transition. **Never auto-activated.**
- **Multiple plausible editions:** the partial-unique ACTIVE constraint makes "which one"
  a single governed choice; the system cannot hold two.
- **No currently verified season:** refuse broad ingestion; bounded operator run still allowed.
- **Cup/continental spanning calendar years:** `season_period` is the explicit governed
  daterange (may cross the boundary); `competition_type_code`/`scope_code` inform expectations
  but the period is stated, not derived.
- **Historical re-ingestion:** an explicit operator-authorized action against a HISTORICAL
  binding; does not disturb the ACTIVE row.
- **Temporarily unavailable:** UNAVAILABLE pauses broad ingestion without losing the binding
  or its history.

---

## 12. Failure semantics — all fail-closed, none broaden

| Condition | Behavior |
|---|---|
| Tracked competition, no edition binding | Predicate false → **refuse** broad ingestion. |
| Edition binding to nonexistent competition | FK RESTRICT prevents; provider-keyed orphan → refuse. |
| Duplicate governance bindings | `UNIQUE(tracked_competition_id, provider_season_external_id)` prevents. |
| Conflicting active editions | Partial-unique ACTIVE prevents (cannot store two). |
| Unknown competition type | Record incomplete → not TRACKED → refuse. |
| Unregistered provider competition | Not in registry → refuse broad; bounded operator run still allowed. |
| Provider season 404 | Hard-stop (existing V1/D2 fail-closed). |
| Provider catalogue unavailable | Discovery yields nothing; existing TRACKED set unaffected; **no auto-expansion**. |
| Stale governance record | ACTIVE whose period has ended without a fresh ACTIVE → refuse (no current authorization); `decided_at` makes staleness auditable. |
| Malformed provider enumeration | Rejected at discovery; no CANDIDATE written from unparseable data. |

No branch has a fallback that widens ingestion.

---

## 13. Dependency graph & preservation of I1

```
V1  (pagination/termination — season AUTHORITATIVE, team EMPIRICAL)
        │
        ▼
V6  competition governance  ── governance.tracked_competition  (this design)
        │
        ▼
V5  edition governance      ── governance.tracked_edition       (this design)
        │
        ▼
broad automated ingestion   ── gated by the §4 predicate, fail-closed
        │
        ▼
fixture spine (existing team/season pagers + shared writer)
        │
        ▼
intelligence layers (feature / module / calibration)
```

**I1 bounded, operator-supplied ingestion = SAFE and authorized, and is NOT broken by this
design.** The bounded path treats the operator as the governance decision for a single run;
it reads no registry and needs none. The governance layer is **additive** and gates only the
*broad automated* path. No rewrite of the certified I1 code is required to adopt this contract.

---

## 14. Decision table

| Question | Current state | Required future contract | Gate |
|---|---|---|---|
| Which competitions are tracked? | no durable registry | `governance.tracked_competition`, keyed on provider identity, status-gated | V6 |
| Which season is selected? | operator CLI `--season` | one **ACTIVE** `governance.tracked_edition` per competition (partial-unique) | V5 |
| Competition type? | absent | governed `LEAGUE/CUP/OTHER` + `DOMESTIC/CONTINENTAL/INTERNATIONAL`, curated | V6 |
| Provider enumeration? | unverified, unwired | candidate-only feeder; never authorizes; capture required first | V6 |
| Team-discovered competition? | auto-created | CANDIDATE only, never auto-TRACKED | broadening control |
| Schedule feed? | unscoped | discovery source → CANDIDATE; broad job filters to TRACKED+ACTIVE | broadening control |
| Historical editions? | existing identity model | HISTORICAL bindings; explicit re-ingestion | V5 |
| Season transition? | operator | governed APPROVED→ACTIVE supersede; never auto | V5 |

---

## 15. Final verdict

### **DESIGN READY**

The contract defines a **deterministic, auditable, fail-closed** authorization for
`tracked competition + governed season/edition + ingestion authorization` **without** relying
on provider ordering, `seasons[0]`, `max(year)`, name parsing, team-derived discovery,
schedule-derived discovery, or any undocumented provider assumption. Determinism is carried by
constraints (one ACTIVE edition per competition; status-gated predicate), not by heuristics.
Authorization is separated from the ingesting role at the RLS layer. It composes V5 and V6 as
one layer and leaves the certified I1 path intact.

**Residual items — resolved BY the design (fail-closed), NOT assumptions to be filled:**
1. **Competition type is not provider-derivable** → curated governance value; provider is a
   hint only. (Resolved: manual curation.)
2. **`/tournaments` is UNVERIFIED** → candidate-only; a committed capture is a prerequisite
   before any catalogue sync, and even then it cannot authorize. (Resolved: candidate-only.)
3. **Phase model is deferred and does NOT block this gate** — competition/edition enumeration
   keys on `uniqueTournament.id`/`season.id` and is phase-independent (V6 §J). Phase modeling
   affects only stage resolution *within* an authorized edition and is a separate gate.

These are downstream **implementation prerequisites**, not holes in the contract; without them
the system refuses rather than guesses.

**Next gate (implementation, separately authorized):** materialize the two `governance`
relations + vocabularies as a migration, wire the §4 predicate into the broad-ingestion path,
convert schedule/team writes to discovery/CANDIDATE semantics, and fix the CLI
default-to-schedule fallthrough (§7E). No part of that is performed here.

**STOP after the design verdict. No implementation, migration, provider call, or DB write.**
