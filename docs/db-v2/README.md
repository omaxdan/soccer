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

Technology-independent. Sits between the architecture and physical database design: no storage types, no keys as implemented, no indexes, no partitioning, no triggers, no access rules, no interfaces.

## Phase 5 — Physical database design

| # | Document | Contents |
|---|---|---|
| 08 | [V2 Physical Database Design](./08-v2-physical-database-design.md) | 25 chapters · 7 schemas · mapping rules · naming standards · identity and attribute strategy · referential integrity · constraint realisation · partitioning · indexing · write and read architecture · lifecycle, version and security realisation · retention · entity and relationship catalogues · migration, validation and performance strategy |

Binding engineering specification for PostgreSQL 16 under Supabase. Contains no DDL, no migration scripts, and no procedural code. Nineteen recorded decisions and three gated on measurement, each with a stated default.

## Phase 5.5 — Physical validation review

| # | Document | Contents |
|---|---|---|
| 09 | [V2 Physical Validation Review](./09-v2-physical-validation-review.md) | PostgreSQL 16 and Supabase compatibility · schema and ownership validation · partitioning and volume assessment · feature value model review · snapshot integrity · RLS leakage paths · trigger burden · migration risk and ordering · blocker table · final decision |

**Outcome: B — Approved with required changes.** 25 findings; 2 blockers; 17 corrections required before DDL; 8 before production. Every correction is physical — none changes the architecture, the logical model, or any Phase 4 guarantee.

## Phase 5.6 — Correction pass

| # | Document | Contents |
|---|---|---|
| 10 | [V2 Physical Database Design, Revision 1](./10-v2-physical-database-design-rev1.md) | Correction register (17 corrections, each with finding, original design, problem, correction, implementation rule, reason) · corrected chapters for principles, catalogue rules, keys, partitioning, constraints, triggers, security, migration, maintenance, DDL authoring · entity catalogue delta · validation checklist |

Supersedes the named sections of document 08; unnamed sections remain in force. 75 implementation rules, 15 DDL authoring rules, 4 new physical relations, none introducing a logical concept. No Phase 4 guarantee weakened; three strengthened.

## Phase 6 — DDL and migration implementation

| # | Location | Contents |
|---|---|---|
| — | [`v2/migrations/`](../../v2/migrations/) | 18 sequential migrations, ~5,100 lines, implementing document 08 revision 1 for PostgreSQL 16 on Supabase |
| 11 | [Phase 6 Migration Audit](./11-phase6-migration-audit.md) | Implementation audit of migrations 001–018 against document 08 rev 1, Phase 4, and platform capability |

**Audit outcome: C — Rework required.** 22 findings; 8 blockers; 8 before production. The implementation is structurally faithful — 12 of 17 corrections fully correct, and every mechanical rule check passes — but three defect clusters prevent deployment: unresolvable GiST operator classes, two silent failures caused by the interaction between `FORCE ROW LEVEL SECURITY` and privileged execution paths, and three defects in the retention and maintenance migration.

Every fix is a correction to the SQL. Nothing in the audit requires a change to the architecture, the logical model, or any Phase 4 guarantee.

## Phase 6.1 — Remediation (migrations Revision 2)

| # | Document | Contents |
|---|---|---|
| 12 | [Phase 6 Remediation Analysis](./12-phase6-remediation-analysis.md) | Classification of every audit finding · B-01 verification · B-07/B-08 architectural verification · scope corrections · remediation report |

**Six blockers resolved, two rejected on analysis.** B-01 was verified and found incorrect — default GiST operator class resolution is search-path independent, so no change was made. B-08 was rejected because Phase 4 E8.09 explicitly authorises the reference. Two blockers proved larger than the audit stated, and two further defects were found beneath them. Thirteen of eighteen migrations modified. Phase 4 unchanged, logical model unchanged, no guarantee weakened, migration ordering unchanged.

## Phase 6.1 — Migration set Revision 2

| # | Document | Contents |
|---|---|---|
| 13 | [Phase 6 Revision 2 Migration Set](./13-phase6-revision-2-migration-set.md) | Per-migration summary, changed SQL, implementation notes and seven-point verification · section-by-section conformance · `SECURITY DEFINER` disposition · idempotency · remaining TODO markers · architectural impact · verification by execution |

**The set was executed end to end on PostgreSQL 16, not reasoned about.** All eighteen migrations apply cleanly in sequence, every corrected behaviour was exercised against real data, and both new conformance gates were verified to fire when the posture is deliberately broken.

Three further blockers were found and fixed in this pass, all of the same silent class as B-02/B-03: the privilege matrix could not reach relations created after migration 016, so the projection pipeline could not write its own projection relations (**B-09**); no refresh path existed for either materialised view, because refresh requires ownership and no process authenticates as the owner (**B-10**); and three more grant-without-policy pairs would have silently affected nothing (**B-11**). Two additional defects surfaced only by running the SQL. Retention gained the archival band §B.9.3 specifies and Revision 1 omitted entirely.

The fix is structural rather than instance-by-instance: the privilege matrix and the policy matrix are now one specification applied by one function, and a catalogue assertion proves the correspondence on every deployment.

**B-01 is now settled empirically.** Eighteen exclusion constraints created with `extensions` absent from the search path.

## Phase 7 — Application conformance audit

| # | Document | Contents |
|---|---|---|
| 14 | [Phase 7 Application Conformance Audit](./14-phase7-application-conformance-audit.md) | Executive summary · architecture conformance · security findings by severity · performance findings with estimated impact · database misuse · production risks · prioritised fixes · final verdict |

**Outcome: Not Ready for Deployment.** The application has zero adoption of the approved architecture — no schema-qualified reference to any of the seven schemas, no V2 relation read or written, and `product.fn_resolve_entitlements` never called. The write model is update-in-place (78 upserts); under V2 those statements raise rather than degrade, because the append and seal guards admit no exception.

Three defects are live today, independent of V2: admin-granted subscriptions never expire because `lib/admin.ts` writes `current_period_end` while `lib/access.ts` reads `expires_at`; an unauthenticated `?q=` parameter is interpolated into a PostgREST `or()` filter; and there is no session-refresh middleware, so sessions expire mid-visit. A fourth — thirteen `mv_*` relations defined nowhere in the repository — means production cannot be reproduced from its own source.

Strengths to preserve through the rewrite: the dependency-ordered idempotent `process:all-db` pipeline, `confidenceBand.ts`'s byte-identical published/backtested formula guarantee, `auth.getUser()` over `getSession()`, and a clean server/client boundary that keeps module logic and entitlement context out of the browser bundle.

## Phase 8 — Application migration specification

| # | Document | Contents |
|---|---|---|
| 15 | [Phase 8 Application Migration & Implementation Specification](./15-phase8-application-migration-specification.md) | Executive summary · dependency graph · backend rewrite plan by subsystem · page-by-page frontend plan · API layer migration · module system migration · snapshot migration · operational layer · security · performance · file-level worklist for all 162 files · testing strategy · phased deployment · risk register · readiness assessment |

The authoritative engineering guide for the V2 rewrite. **Strategy: strangler with a shadow pipeline** — V2 runs alongside V1, new writers are built beside the existing ones rather than editing them, and the read path cuts over page by page. The rollback boundary is the read path, which is what makes a rewrite of this size executable; decommissioning V1 is the one-way door and is separately gated.

**Readiness 7/10 — ready to begin, with one blocking prerequisite.** The thirteen `mv_*` definitions that exist only in production must be recovered first; they feed the module layer and hold the effort estimate at ±40% until closed. Estimated **55–79 engineer-weeks**, ≈36 calendar weeks across six phases with four engineers.

### Implementation progress

| Subsystem | Status | Location |
|---|---|---|
| S-1 Connection & credential layer | **Complete** | `beta/backend/src/v2/db/` |
| S-2 Operational layer | **Complete**, all findings closed | `beta/backend/src/v2/operations/` |
| S-3 Vocabulary & registry seeding | **Complete** | `beta/backend/src/v2/seed/` |
| S-4 Ingestion foundation | **Complete** | `beta/backend/src/v2/ingestion/` |
| S-5 Feature calculation | **Complete** | `beta/backend/src/v2/feature/` · [docs 20](./20-phase8-s5-feature-architecture.md)–[24](./24-phase8-s5-schema-defect.md) · migration 020 |
| S-6 onward | Not started | — |

| # | Document | Contents |
|---|---|---|
| 16 | [S-2 Migration Findings](./16-phase8-s2-migration-findings.md) | Five inconsistencies found by executing the operational layer against the approved schema, with evidence, effect, and candidate corrections |
| 17 | [S-2 Resolution](./17-phase8-s2-resolution.md) | Closure of all five findings · migration 019 · engineering rule ER-01 · regression tests · verification |
| 18 | [S-3 Seed Report](./18-phase8-s3-seed-report.md) | Vocabulary and registry inventory · the three approved decisions as implemented · finding S3-1 · what is deliberately not seeded · defects found by execution · verification |
| 19 | [S-4 Ingestion Inventory & Report](./19-phase8-s4-ingestion-inventory.md) | Provider sources · provider→canonical entity map · foreign key targets · unmapped-value and duplicate handling · provenance requirements · role permissions verified · decisions D-1 to D-3 · finding S4-1 · verification and mutation testing |
| 20 | [S-5 Feature Calculation Architecture](./20-phase8-s5-feature-architecture.md) | Feature and source inventory · dependency graph and derived ordering · duplicate handling and supersession · provenance model · security and constraint verification · scope and deferrals · six open decisions · findings S5-1 to S5-4 · verification plan · proposed layout |
| 21 | [S-5 Implementation Specification](./21-phase8-s5-implementation-specification.md) | **The implementation contract.** All six decisions resolved · `squad_stability` deferred, six features ship · deterministic replay requirements · order-derivation mutation test · ambiguity review · seven-invariant compliance check · finding responses · implementation readiness |
| 22 | [S-5 Implementation Blocked](./22-phase8-s5-implementation-blocked.md) | **Resolved.** The version-semantics conflict found before coding: `feature_version` 1.0.0 claims a V1 carry-across the spec contradicts · per-feature evidence · why congestion was jointly unsatisfiable |
| 23 | [S-5 Decision Record](./23-phase8-s5-decision-record.md) | **Final ruling.** DECISION A · readiness weights and normalisation · window precedence · index scale · composite sampling as `MIN(consumed)` · the two registry amendments and the role correction |
| 24 | [S-5 Schema Defect (S5-5)](./24-phase8-s5-schema-defect.md) | **Resolved by migration 020.** The feature-value business identity could not detect a duplicate — a plain UNIQUE whose key columns are forced NULL · evidence · blast radius across seven relations · the correction as applied |

**All five findings are closed.** M-1 — the blocking one, where `pipeline_run` and `pipeline_job_run` could never leave `RUNNING` because both carry the append-only guard and no role holds UPDATE — is resolved by **migration 019** using Correction B: terminal state is *appended* to a completion companion under ordinal succession, the shape A.2 already uses for snapshot outcome revision. No guard was weakened, no `UPDATE` was granted, and `RUNNING` remains the immutable initial state. M-2 is resolved by a single `INSERT` grant. M-3, M-4 and M-5 are closed as documentation clarifications — in each the approved schema was already right.

A standing engineering rule came out of it: **ER-01**, never round-trip a database-generated `timestamptz` through a JavaScript `Date` and back into a key comparison. PostgreSQL stores microseconds, `Date` carries milliseconds, and the truncation silently breaks every composite foreign key. This binds S-7 above all.

Two costs are stated plainly rather than discovered later: the deep history V2 is designed to hold **does not exist** for the 17 team-level tables V1 overwrote in place, so point-in-time reconstruction begins at cut-over; and calibration must be re-baselined, so modules will correctly report *unverified* where V1 displayed a rate marked `provenance: "unreplayed"` by the code that produced it.

**S-3 produced no migration findings.** 119 rows across twelve relations, seeded by four roles in the order the reference graph forces — there is no single seed role, because the privilege matrix assigns writes by layer and a principal with INSERT across four schemas would be broader than any pipeline. Every statement is `INSERT … ON CONFLICT DO NOTHING`; there is no update, upsert or delete path in the subsystem, because vocabulary and registry rows are historical reference data a sealed snapshot points at. Idempotence is proven by **id and `created_at` fingerprint equality** across repeat runs, not by row counts — counts alone would pass a seed that deleted and re-inserted everything.

One finding, **S3-1**, is recorded rather than worked around: `pt_platform_admin` is the only role with INSERT on `product` and holds SELECT-only on `operations`, so the entitlement stage cannot open a pipeline run and executes unattributed. Widening the role would let an administrative principal write pipeline runs that never happened, so the correct disposition is to accept the gap and name it.

**S-4 writes schema `football` and nothing else, under one provider namespace.** `provider_code = 'SPORTSAPI_API'` is a source constant, not configuration — it participates in the provider alternate keys, so a deployment able to change it would fork every entity. Three duplicate classes are decided by lifecycle rather than preference: mutable identity records upsert, the three append-only relations insert-or-skip, and the two temporal relations use succession, because `ON CONFLICT` cannot target an exclusion constraint. **There is no delete path and there cannot be one** — the role holds no `DELETE` on any `football` relation, so delete-and-reinsert is foreclosed at the privilege layer rather than by convention.

Unmapped values degrade safely and visibly, following the precedent the schema already set with `UNKNOWN` sealing by default: an unmapped country writes NULL and is counted, an unmapped currency **refuses the row**, because `player_valuation.currency_code` is NOT NULL and `minor_unit` makes a substituted currency wrong by orders of magnitude. Nothing creates a vocabulary row. **Finding S4-1**: `SC` (Scotland) collides with Seychelles in ISO 3166-1 and `WA` (Wales) is unassigned — both are football associations occupying ISO-shaped slots, recorded for the schema owner rather than corrected, since the seed has no update path by design.

Two guarantees were **mutation-tested** rather than merely asserted: removing the result-revision append and removing the no-null-overwrite `COALESCE` each made the suite fail, then were restored.

**S-5 is architecture only — no calculator has been written.** The dependency graph has one edge (`readiness_score` consumes `rest_advantage` and `congestion_index`), giving two stages: four independent calculators, then one dependent. Execution order is derived from `feature_dependency` rather than hard-coded, which is the failure V1's fifty-edge implicit graph represents. Supersession is by version, not overwrite — `feature_version_id` sits inside the business identity, so a rule change produces a new row and the old value remains attributed to the rule that made it.

**S-5 is now specified and ready for coding — architecture completeness 98%, no blockers.** All six decisions are resolved: `as_of` is derived per snapshot point from `football.snapshot_point` (read, never hard-coded), `ALL_COMPETITIONS` only, forward-only with replay through the same pipeline, sequential Stage 1, and four temporary `verify.ts` controls standing in for the unimplemented quality checks. `team.squad_stability` is **not calculated** — its registered meaning is selection continuity, which needs lineup data S-4 deferred, and calculating squad *membership* instead would be exactly the drift the registry prevents — so **S-5 ships six features, not seven**, and the absence is visible in `v_freshness` rather than silent. Deterministic replay is a stated requirement with six obligations behind it, the sharpest being that no calculator may read the wall clock; `calculated_at` is the only permitted difference between two clean runs. The remaining 2% is calculator weighting formulae, deliberately left to implementation because every constraint a formula must respect is fixed.

**Two material findings, both proven by execution rather than argued.** **S5-1**: the A.12 provenance propagation trigger *cannot fire* — lineage references its produced value by foreign key, so it can only be written after the value, and the trigger's inner join against lineage therefore always matches zero rows. Demonstrated by inserting an `OBSERVED` value consuming an `ESTIMATED` one and watching it be accepted. The trigger is correctly installed and statement-level on the partitioned parent, so the platform doubt recorded in migration 015 is resolved in the affirmative; the defect is write ordering. **S5-2**: twelve of the fourteen checks registered in `operations.quality_check` have no executable implementation, including the compensating control for S5-1 and the `BLOCKING` acyclicity validation — so `value_scale` and provenance currently rest entirely on the calculating process, with neither prevention nor detection behind them. Neither finding is designed around; both are the schema owner's call.

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
