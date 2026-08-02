# PitchTerminal Database V2 — Phase 1: Reverse Engineering

Complete audit of the existing PitchTerminal system, produced before any V2 design work.

**Scope rules observed:** no redesign, no migration SQL, no new tables, no removals, no assumption that an unused table is unnecessary. Existing business logic is documented, not judged on whether it should exist.

## Documents

| # | Document | Contents |
|---|---|---|
| 01 | [Current Database Architecture Report](./01-current-database-architecture-report.md) | Overview · layer classification of all 92 tables · ERD explanation · relationship map · data ownership · structural findings · scalability assessment |
| 02 | [Table Documentation](./02-table-documentation.md) | All 92 tables: purpose, ownership, columns summary, dependencies, concerns |
| 03 | [Current Intelligence Pipeline](./03-current-intelligence-pipeline.md) | End-to-end pipeline diagram · intelligence engine audit · module architecture audit · match page data flow |
| 04 | [Database V2 Requirements](./04-database-v2-requirements.md) | Current problems (technical debt + scaling) · what V2 must support · what must remain compatible · migration risk assessment |
| 05 | [Missing Information Checklist](./05-missing-information-checklist.md) | Exactly what is still needed, with the SQL to produce it |

## Phase 2 — Architecture blueprint

| # | Document | Contents |
|---|---|---|
| 06 | [V2 Canonical Data Model & Architecture Blueprint](./06-v2-canonical-data-model-blueprint.md) | Architecture principles · four-layer model · entity families · match intelligence & snapshots · team/player intelligence · calibration · operational architecture · classification of all 92 tables · architecture diagram · decisions required before schema design |

The blueprint is the bridge between the audit and the V2 schema. It contains no SQL and proposes no migrations.

## Phase 4 — Logical data model

| # | Document | Contents |
|---|---|---|
| 07 | [V2 Logical Data Model](./07-v2-logical-data-model.md) | Principles · ~98 logical constructs across nine families · relationship graph · lifecycle classification · versioning and inheritance · identity rules · 173 numbered constraints |

Technology-independent. Sits between the architecture and physical database design: no storage types, no keys as implemented, no indexes, no partitioning, no triggers, no access rules, no interfaces. Phase 5 realizes it, gated on the blocking prerequisites in document 05.

## Sources analysed

| Source | Detail |
|---|---|
| Supplied schema dump | 92 tables in `public` |
| `beta/backend/src` | 64 TypeScript files, ~23k lines — 21 sync/process jobs, ~54 processors, 11 repositories |
| `beta/live-frontend/src` | 98 TS/TSX files, ~10k lines — Next.js 15 App Router, single query layer, 13-module registry |
| `beta/migrations/` | 023–044 |
| `beta/backend/supabase/migrations/` | 000–025 |
| `beta/backend/docs/` | `AUDIT_2026-07-03.md`, `SCHEMA_GAP_ANALYSIS.md`, `PLAYER_STATS_EXPANSION.md` |

## Headline findings

**Strengths to preserve**
- Strict single-writer discipline: the service-key pipeline owns football data, the frontend is read-only against it.
- `process:all-db` is idempotent, zero-API, and dependency-ordered L1→L6 — current intelligence is fully regenerable from raw tables.
- `readiness_history` + its immutability lock, `signal_backtests` with Wilson intervals, and `league_gap_*` with an explicit sample gate form a genuinely defensible evidence layer.
- `confidenceBand.ts` guarantees the published formula and the backtested formula are byte-identical.
- The user/product layer is well-constrained and properly RLS-protected.

**Problems V2 must solve**
- The same quantity is stored in up to 7 tables with nothing reconciling them; two independent match predictions ship side by side on the match page.
- 31 match-scoped tables exist where one module-result structure belongs; two of them are structurally identical and differ only in subject.
- 17 team-level tables are one row per team, overwritten in place — no history, no season dimension, no point-in-time recovery.
- One version column exists across 92 tables; one table of 31 is protected from post-hoc rewrite.
- Modules — the product's core abstraction — exist only as frontend TypeScript, with hardcoded baselines and no stored results.
- The operational layer is effectively absent: no job, sync, error, or quota telemetry.
- Synthetic weather is stored with no provenance flag and consumed by a paid module.

**Blocking gaps before design can start**
- 13 materialized views on the read path are defined nowhere in the repository or the dump.
- Five processors upsert on conflict targets that exist in no migration — the repository does not currently describe production.

See document 05 for the full request list and the SQL to produce it.
