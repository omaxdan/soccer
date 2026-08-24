# S-7 — Cross-module synthesis / historical snapshot sealing (v1.0.0)

Seals immutable, governed **match snapshots** from already-persisted intelligence.
This is a **historical-sealing** mechanism first, not a product-display feature: it
accumulates the sealed record that the later `snapshot → outcome_link → calibration`
chain (S-9) will consume, and it **pins** the pre-match evidence it cites (RESTRICT)
before retention can thin it.

```bash
npm run snapshot:v2 -- seal                    # forward: arrived points, last 7 days
npm run snapshot:v2 -- seal --lookback-days 30
npm run snapshot:v2 -- seal --fixture 2557     # exactly one fixture
npm run snapshot:v2 -- replay --from 2027-01-01 --to 2027-02-01
```

## What v1.0.0 IS

A **NON-DIRECTIONAL characterisation** of the intelligence available before kickoff:
*what the active modules reported, and how complete that picture was.* It answers
"what did the system know, and how much of it," never "which team should win."

For each fixture × snapshot point (`T_MINUS_7D / T_MINUS_3D / T_MINUS_1D / KICKOFF`),
at `snapshot_as_of = kickoff − offset`, it seals:

- **`match_snapshot`** — identity, governing rule versions, content checksum, job attribution.
- **`snapshot_version_component`** — the complete version manifest (LC-103): every module
  version, feature version, and the verdict-composition / consensus-rule / checksum-algorithm versions actually referenced.
- **`snapshot_module_reading`** — each cited engaged reading, by composite identity.
- **`snapshot_feature_state`** — each cited feature value the readings consumed, by composite identity.
- **`snapshot_verdict`** — the consensus tally + completeness (see below).
- **`snapshot_completeness` / `_item`** — what could not be seen, recorded as absence.

## The locked semantic contract (approved governance)

- **Consensus unit = one `(module, team)` spoke reading → one status.** An *evidence
  distribution*, never a vote. Home and away readings enter it independently; there is
  no winner inference.
- **`evidence_count = supports + contradicts + neutral`** (schema CHECK). `INACTIVE`
  is counted **separately** (`consensus_inactive_count`) — a silent module is not a
  module that looked and found nothing. Dissent is retained, never averaged.
- **Completeness denominator = ELIGIBLE-ACTIVE modules for the fixture** — `is_active`
  AND subject kind applies (`TEAM` → both participants, `FIXTURE` → once).
  `COMPETITION_EDITION` modules are not per-fixture eligible. Eligible-but-unimplemented
  modules are recorded honestly as `MODULE_INACTIVE` items — absence is never `NEUTRAL`.
- **These columns are permanently NULL at v1.0.0** (no substrate exists to fill them, and
  none is invented): `readiness_edge`, `form_edge`, `travel_edge`, `rest_edge`,
  `congestion_edge`, `availability_edge`, `risk_score`, `confidence`,
  `historical_reliability_baseline_id`. Confidence/reliability await S-9 calibration;
  risk and directional edges await their own governed gates and a richer module set.

## Guarantees

- **As-of safe.** Selection reuses the established current-reading discipline
  (`DISTINCT ON … as_of DESC`, `as_of <= snapshot_as_of`, context-matched). The schema's
  `cited_as_of <= snapshot_as_of` CHECK makes lookahead contamination impossible.
- **No new intelligence.** S-7 selects, counts, and seals. It computes no readiness,
  momentum, form, travel, availability, edge, weight, confidence, or risk, and never
  reinterprets a module status.
- **Immutable & versioned.** All snapshot relations are INSERT-only; the migration-015
  guard raises on any UPDATE/DELETE. A snapshot's identity includes its rule versions, so
  a newer rule version produces a **distinct** snapshot rather than mutating the old one.
- **Idempotent.** Re-sealing the same `(fixture, point, rule versions)` is skipped.
- **Sealable window.** A point is sealed only when its instant has arrived
  (`snapshot_as_of <= now`, so `sealed_at >= snapshot_as_of`) **and** a governing rule
  is in force at that instant; otherwise it is skipped honestly (`not yet due` /
  `no rule in force`).

## Checksum (algorithm `v1`, seeded in migration 003)

`sha256` over a deterministic canonical serialisation in the governed order: *header,
version manifest, feature state (by cited value), module readings (by cited reading),
model outputs, completeness items, verdict.* Numbers are exact decimal text (scale
preserved), timestamps ISO-8601 UTC microseconds, object keys lexicographic, arrays in
the declared order, `null` distinct from `"null"`. A new algorithm is a new version row;
sealed snapshots are never re-checksummed. (`operations.fn_verify_snapshot_checksums` is
a deliberate stub, so this producer is authoritative; determinism is proven by tests.)

## Explicitly NOT in this phase

No Match-page UI, no "favors home/away", no consensus/confidence/risk/edge display. The
product-display gate is separate and deferred until the module substrate grows and
directional/confidence semantics are governed.

## Files

| Path | Role |
|---|---|
| `read/selection.ts` | select fixtures, snapshot points, eligible modules, current spoke readings + cited values, resolve rule versions (read-only) |
| `verdict.ts` | pure non-directional tally: consensus, completeness, verdict (NULL guarantees), version manifest |
| `canonical.ts` | deterministic canonical serialisation + SHA-256 content checksum (algorithm v1) |
| `seal.ts` | one atomic seal in dependency order, within an attributed transaction |
| `driver.ts` | enumerate eligible (fixture × point) pairs and seal each; `runSnapshotSealing` |
| `cli.ts` | `snapshot:v2` operator entry point |
