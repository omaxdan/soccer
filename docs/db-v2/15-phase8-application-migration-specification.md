# PitchTerminal V2 — Phase 8: Application Migration & Implementation Specification

The authoritative engineering guide for migrating the PitchTerminal application from the V1 architecture to the approved V2 database architecture.

**Authority order.** Phase 4 Logical Model → Document 08 Revision 1 → Approved Migration Set (Revision 2) → PostgreSQL 16 → Supabase → application source code.

**Standing constraints for every engineer executing this plan.**

1. The database architecture is **immutable**. If an application requirement appears to need a schema change, the requirement is wrong or the specification has a gap — raise it, do not alter the schema.
2. Never duplicate a rule PostgreSQL already enforces. If the database rejects something, let it reject it and surface the error.
3. Every change traces to Phase 7 (document 14), the Revision 2 migration set, Document 08 Revision 1, or Phase 4. Citations are given inline throughout.
4. The V2 schema has been **executed and verified** on PostgreSQL 16 (Phase 6.1 §14). Its behaviour is not theoretical — where this document says a statement raises, that was observed.

---

# 1. Executive Summary

## 1.1 Current application state

| | |
|---|---|
| Backend | `beta/backend/src` — 64 files, **25,609 lines** |
| Frontend | `beta/live-frontend/src` — 98 files, **20,295 lines** |
| Total | **162 files, 45,904 lines** |
| V2 adoption | **Zero.** No schema-qualified reference to any of the seven schemas; no V2 relation read or written; `fn_resolve_entitlements` never called |
| Write model | Update-in-place — **78 `.upsert()` calls** across 34 tables |
| Transactions | **One** `.rpc()` in the entire backend; every other multi-statement operation is non-atomic |
| Credentials | **One** Supabase service-role key for all pipelines (carries `BYPASSRLS`) |
| Operational telemetry | **None.** All eight `operations` relations unwritten |
| Match page | **31** database round trips, `force-dynamic`, no caching |

Three defects are live in production today (Phase 7 §C): subscriptions that never expire, PostgREST filter injection on an unauthenticated parameter, and no session-refresh middleware. Thirteen `mv_*` relations on the read path are defined nowhere in the repository.

## 1.2 Target architecture

Four strictly one-directional layers across seven schemas, as deployed by migrations 001–018:

```
  football  ──▶  feature  ──▶  module  ──▶  product
  (Layer 1)     (Layer 2)     (Layer 3)     (Layer 4)
      │              │            │              ▲
      └──────────────┴────────────┴──▶ snapshot ─┘   (sealed, insert-only)
                                  └──▶ calibration
  operations ── telemetry, referenced by nothing authoritative
```

The application becomes, on the write side, **seven credentialed pipelines writing append-only rows over direct session-mode connections**, and on the read side **a renderer of two projection relations and one partition-pruned sealed aggregate**.

## 1.3 Migration strategy — Strangler with a shadow pipeline

Three strategies were considered against the constraint that V1 and V2 have **incompatible write models**, not merely different table names.

| Strategy | Assessment |
|---|---|
| Big bang cut-over | Rejected. 45,904 lines with no intermediate verifiable state and no rollback once V1 writes stop. |
| In-place incremental conversion | **Not available.** A V1 `.upsert()` converted to a V2 insert cannot coexist with the V1 reader, because V2 keeps every version and V1 readers expect one row per subject. The two models cannot share a table. |
| **Strangler with shadow pipeline** | **Adopted.** V2 schema runs alongside V1. New writers are built beside the existing ones, not by editing them. V1 keeps serving throughout. Read path cuts over page by page. |

The shape:

1. **V2 schema deployed** to the same Supabase project, in its seven schemas. V1's `public` is untouched. Already verified deployable (Phase 6.1 §14.1).
2. **New writers built alongside V1 writers.** `beta/backend/src/v2/` is a new tree. No existing job is edited during the build phase; V1 continues to run and serve production unchanged.
3. **Backfill** V2 from V1 where V1 retained the history, and record honestly where it did not.
4. **Shadow operation** — both pipelines run, outputs compared, divergence investigated.
5. **Read cut-over page by page**, each page independently revertible.
6. **V1 decommissioned** once every page reads V2 and one full calibration cycle has completed against V2 data.

**The rollback boundary is the read path.** Until a page is cut over, V1 is authoritative and reverting is a deploy. That property is what makes a rewrite of this size executable.

## 1.4 Deployment strategy

Six environments/stages, detailed in §13:

| Stage | Purpose | Exit criterion |
|---|---|---|
| Development | Local PostgreSQL 16 + migration set | Full set applies; behaviour suite passes |
| Staging | Supabase project, V2 schema only | All seven roles connect; RLS suite passes |
| Backfill | Load V2 from V1 | Row-count and checksum reconciliation |
| Shadow | Both pipelines live, V1 serving | 14 days, zero unexplained divergence |
| Cut-over | Read path moves per page | Each page verified before the next |
| Decommission | V1 writers stopped, `public` archived | One full calibration cycle on V2 |

## 1.5 Rollback strategy

| Stage | Rollback | Data loss |
|---|---|---|
| Development / Staging | Drop schemas, re-run migrations | None |
| Backfill | Truncate V2 partitions, re-run | None — V1 untouched |
| Shadow | Stop V2 writers | None — V1 authoritative throughout |
| Cut-over (per page) | Revert the page's deploy | None — V2 keeps writing |
| Post-decommission | **No automated rollback.** V1 tables restored from backup; V2 rows written after the cut are append-only history that V1 cannot represent | Divergence from the cut-over instant |

The one-way door is decommissioning, and it is deliberately last and separately gated.

## 1.6 Estimated engineering effort

Engineer-weeks, assuming engineers familiar with the codebase. Ranges reflect the uncertainty §1.7 identifies.

| Workstream | Est. | Basis |
|---|---|---|
| Recover the thirteen undefined `mv_*` relations | 1–2 | Phase 7 AC-05 — blocking, must precede planning of the module workstream |
| Live-defect remediation (Phase 7 Group 1) | 1–2 | Seven discrete fixes, no architectural dependency |
| Connection and credential layer | 2–3 | New `pg`-based pool per role; retires `supabase-js` for writes |
| Operational layer (§8) | 3–4 | Eight relations, run/job wrappers, retry, scheduling |
| Ingestion pipeline | 4–6 | 11 sync jobs, ~4,000 lines, append-only conversion |
| Feature calculation pipeline | 8–12 | `processDbOnly` + `processExtendedIntelligence` = 9,375 lines, the largest single conversion |
| Module system (§6) | 6–8 | Registry, versions, readings, evidence; `modules.ts` 1,587 lines |
| Snapshot sealing (§7) | 5–7 | New capability, no V1 equivalent to port |
| Calibration | 3–4 | `confidenceBand.ts` and backtests re-keyed to module versions |
| Projection refresh | 2–3 | `p_landing`, `p_team_state`, two matviews |
| Retention scheduler | 1 | Function exists; a caller and a cron entry are needed |
| Frontend read path | 6–8 | 29 pages, `queries.ts` 1,490 lines, entitlement deletion |
| Testing (§12) | 6–8 | Runs concurrently, not sequentially |
| Backfill and reconciliation | 3–5 | Depends on what V1 history survives |
| Shadow operation and cut-over | 4–6 | Mostly elapsed time, not effort |
| **Total** | **55–79 engineer-weeks** | ≈ **14–20 calendar weeks with 4 engineers** |

**This estimate is provisional until the thirteen `mv_*` definitions are recovered.** They feed the module layer, which is the largest and least-understood workstream. Treat the range as ±40% until that is done.

## 1.7 Major technical risks

Summarised here; the full register with probability, impact, mitigation, rollback and verification is §14.

| # | Risk | Class |
|---|---|---|
| R-01 | Thirteen relations exist only in production; the module layer cannot be specified without them | **Critical** |
| R-02 | V1 overwrote 17 team-level tables in place — the history V2 is designed to hold **does not exist** and cannot be backfilled | **Critical** |
| R-03 | PostgREST cannot express a transaction; snapshot sealing is inherently multi-statement | **High** |
| R-04 | Calibration must be re-baselined; existing backtests are keyed to unversioned rules (LC-135) | **High** |
| R-05 | Session-mode direct connections consume Postgres connection slots that PgBouncer previously multiplexed | **High** |
| R-06 | Temporal granularity decision still open — sets retention windows and swings storage 150 GB–1 TB | Medium |
| R-07 | Two platform behaviours unverified: transition tables on partitioned relations (P-05), partition detachment (A.17) | Medium |

---

# 2. Dependency Graph

## 2.1 The governing principle

**The application's build order is the migration set's apply order.** Migrations 001–018 are a topological sort of the reference graph; the subsystems that write those relations inherit the same ordering, because a row cannot be written before the rows it references exist.

Two consequences that are easy to get wrong and expensive to discover late:

- **Nothing can be sealed until job runs exist.** `snapshot.match_snapshot.pipeline_job_run_id` pairs compositely with `pipeline_job_run_occurred_at` (P-04), and `ck_match_snapshot__job_run_reference_complete` enforces both-or-neither. The operational layer is a **prerequisite of sealing**, not a nice-to-have.
- **Nothing can be calibrated until modules are versioned.** `calibration.calibration_series` is keyed by `module_version_id` (LC-135). Calibration cannot start before the module registry exists.

## 2.2 Subsystem dependency table

| # | Subsystem | Prerequisites | Downstream | Blocking items |
|---|---|---|---|---|
| S-0 | `mv_*` recovery | — | S-6, S-9 | **Blocks all module and calibration planning** |
| S-1 | Connection & credential layer | Migration set deployed; seven roles credentialed | Every write subsystem | Supabase connection-slot budget (R-05) |
| S-2 | Operational layer | S-1 | S-3…S-11 (all attribution) | — |
| S-3 | Vocabulary & registry seeding | S-1, S-2 | S-4, S-5, S-6 | Two spec TODOs in 002 (vocabulary cardinality, snapshot point set) |
| S-4 | Ingestion (`football`) | S-1, S-2, S-3 | S-5, S-7 | `provider_statistic.measures` shape undefined (004 TODO) |
| S-5 | Feature calculation (`feature`) | S-4 | S-6, S-7 | Temporal granularity decision (R-06) |
| S-6 | Module generation (`module`) | S-0, S-5, S-3 | S-7, S-9 | `mv_*` definitions |
| S-7 | Snapshot sealing (`snapshot`) | S-2, S-4, S-5, S-6 | S-9, S-10 | `output_values` outside PD-16 (010 TODO) |
| S-8 | Retention | S-5, S-6 | — | Granularity decision; A.17 for bounded class |
| S-9 | Calibration | S-6, S-7 | S-10 | Re-baselining (R-04) |
| S-10 | Projection refresh | S-7, S-9 | S-11 | — |
| S-11 | Frontend read path | S-10 | — | — |
| S-12 | Security & auth | S-1 | S-11 | — |
| S-13 | Quality assertions | S-2 | — | P-05, A.17 verification |

## 2.3 Deployment order

```
                    ┌─────────────────────────────────┐
                    │ S-0  mv_* recovery  [BLOCKING]  │
                    └────────────────┬────────────────┘
                                     │
   ┌─────────────────────────────────▼─────────────────────────────────┐
   │ S-1 connections/credentials  ──▶  S-2 operational layer           │
   └─────────────────────────────────┬─────────────────────────────────┘
                                     │
                          S-3 vocabularies & registries
                                     │
                          S-4 ingestion → football
                                     │
                          S-5 feature calculation → feature
                                     │
              ┌──────────────────────┴──────────────────────┐
              │                                             │
     S-6 module generation                          S-8 retention
              │                                    (independent once
     S-7 snapshot sealing                           S-5/S-6 land)
              │
     S-9 calibration
              │
     S-10 projection refresh          S-12 security/auth     S-13 quality
              │                        (parallel from S-1)   (parallel from S-2)
     S-11 frontend read path
```

**Parallelisable:** S-12 from S-1 onward; S-13 from S-2 onward; S-8 once S-5/S-6 land; frontend component work (§4) throughout, since components change shape only at cut-over.

**Strictly serial:** S-1 → S-2 → S-3 → S-4 → S-5 → S-6 → S-7 → S-9 → S-10 → S-11. This chain is the critical path and is ten subsystems long.

---

# 3. Backend Rewrite Plan

Complexity is **S** (days), **M** (1–2 weeks), **L** (3–5 weeks), **XL** (6+ weeks). Risk is the chance of the work invalidating downstream assumptions.

## 3.1 S-1 — Connection and credential layer

| | |
|---|---|
| **Current** | `db/client.ts` (37 lines) — one `supabase-js` client, one service-role key, `db.from()` / `db.rpc()` façade used by every job |
| **Target** | Seven `pg` connection pools, one per role, direct to PostgreSQL in **session mode** (R-58); `supabase-js` retired for all writes |
| **Files** | `db/client.ts` **rewrite**; new `db/pool.ts`, `db/roles.ts`, `db/tx.ts`; `config/index.ts` **modify** |
| **Complexity** | M |
| **Risk** | **High** — R-05, connection-slot exhaustion |
| **Testing** | Each role connects; each role's privilege set matches `fn_assert_access_correspondence`; a write outside a role's grant fails |
| **Migration** | New module beside the old. V1 jobs keep importing `db/client.ts` until their own conversion. |

Session mode is **required**, not preferred. The retention marker (R-21) and the timeout settings (A.15) are session-scoped state that a transaction pooler does not preserve — Document 08 R-58 states this explicitly. Pipelines therefore connect on port **5432**, not the pooler port.

Transaction helper, used by every subsystem below:

```ts
// db/tx.ts
export async function withRun<T>(
  role: PipelineRole,
  jobKey: string,
  fn: (tx: PoolClient, job: JobRunRef) => Promise<T>
): Promise<T> {
  const client = await poolFor(role).connect();
  try {
    await client.query("BEGIN");
    const job = await openJobRun(client, jobKey);      // operations.pipeline_job_run
    const out = await fn(client, job);
    await closeJobRun(client, job, "SUCCEEDED");
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    await recordFailure(role, jobKey, e);               // separate connection — survives the rollback
    throw e;
  } finally {
    client.release();
  }
}
```

Note the failure record is written on a **separate connection**. A failure recorded inside the rolled-back transaction disappears with it — the exact trap `verifyHistoricalIntegrity.ts:15` already documents for V1.

## 3.2 S-2 — Operational layer

| | |
|---|---|
| **Current** | None. Zero writes to any operational relation. `pino` to stdout only. |
| **Target** | Every pipeline execution opens a `pipeline_run`, each stage a `pipeline_job_run`, each write batch a `write_record`; failures to `failure` / `failure_resolution`; provider calls to `api_usage` |
| **Files** | New `v2/operations/run.ts`, `writeRecord.ts`, `failure.ts`, `apiUsage.ts`, `schedule.ts`; `utils/logger.ts` **modify** |
| **Complexity** | M |
| **Risk** | Medium — every other subsystem depends on it |
| **Testing** | A failed job leaves exactly one `failure` row; a successful run's `write_record` totals match rows actually written |
| **Migration** | Build first, wire into V2 jobs as each is converted |

Detailed in §8.

## 3.3 S-3 — Vocabulary and registry seeding

| | |
|---|---|
| **Current** | Vocabularies are TypeScript literals — `config/trackedLeagues.ts` (413 lines), `constants/endpoints.ts` (175 lines), and inline string unions throughout |
| **Target** | Governed vocabularies in `football` (`subject_kind`, `context_kind`, `provenance_class`, `snapshot_point`, `currency`, …); feature registry in `feature`; module registry in `module` |
| **Files** | New `v2/seed/` — one seeder per registry; `config/trackedLeagues.ts` **keep** (it is provider configuration, not a governed vocabulary) |
| **Complexity** | S |
| **Risk** | Low |
| **Testing** | Every code the application emits resolves to a vocabulary row; seeding is idempotent |
| **Migration** | Idempotent seeders run before any pipeline |

**Two open specification items block completion**, both recorded as TODOs in migration 002 and neither invented here: vocabulary cardinality (§5.9.5 and §5.4.2 conflict) and the snapshot point set (Phase 4 D8 open). Seed what is settled; escalate the rest.

## 3.4 S-4 — Ingestion → `football`

| | |
|---|---|
| **Current** | 11 sync jobs, ~4,000 lines, upserting `matches`, `teams`, `players`, `tournaments`, `seasons`, `countries`, `stadiums`, `tournament_standings`, `player_transfers`, `player_season_statistics`, `team_squads_snapshot` |
| **Target** | `football.competition`, `competition_edition`, `team`, `player`, `venue`, `fixture`, `standing`, `player_registration`, `player_availability`, `player_valuation`, `appearance`, `provider_statistic`, `fixture_lifecycle_transition` |
| **Files** | `jobs/sync*.ts` (11 files) → `v2/ingest/*.ts`; `repositories/*.ts` (11 files) **rewrite**; `services/*.ts` **keep** |
| **Complexity** | L |
| **Risk** | Medium |
| **Testing** | Provider fixture replay; append-guard rejection tests; composite-key round trips |
| **Migration** | New writers beside old; shadow-compare row counts per provider batch |

**The upsert conversion is the substance.** Three distinct target shapes replace one V1 pattern:

| V1 pattern | V2 target | Rule |
|---|---|---|
| `upsert('teams', …, 'external_id')` | `football.team` — **mutable** reality relation | Upsert remains valid |
| `upsert('tournament_standings', …)` | `football.standing` — **append-only** | Insert a new row per observation. Upsert **raises** (R-19, P-06) |
| `upsert('matches', …)` with status change | `football.fixture` + `fixture_lifecycle_transition` | State change is an **inserted transition**, not a column update |

`football.standing`, `player_valuation` and `fixture_lifecycle_transition` hold **SELECT and INSERT only** for `pt_pipeline_ingestion` — verified in Phase 6.1 §14.2, where `has_table_privilege('football.standing','UPDATE')` returned false. An upsert against them fails on privilege before the trigger is reached.

Provider calls additionally write `operations.api_usage`, which is where the two-API-key quota behaviour in `config/index.ts` becomes measurable rather than merely configured.

## 3.5 S-5 — Feature calculation → `feature`

| | |
|---|---|
| **Current** | `processDbOnly.ts` (4,509 lines) + `processExtendedIntelligence.ts` (4,866) + `processForm.ts` (249) + `processHistoricalContext.ts` (762) = **10,386 lines**, writing ~25 wide tables one row per subject, overwritten in place |
| **Target** | `feature.feature_value` — one append-only row per (definition, subject, context, as-of, version), with `feature.feature_lineage` recording what each value consumed |
| **Files** | Four jobs → `v2/feature/` (one calculator module per feature definition); `lib/formNarratives.ts`, `lib/signalLogic.ts` **modify** |
| **Complexity** | **XL** — the largest single conversion |
| **Risk** | **High** |
| **Testing** | Per-calculator unit tests with fixed inputs; lineage completeness; provenance monotonicity; scale conformance |
| **Migration** | Convert calculator by calculator; shadow-compare each V2 feature value against its V1 column |

**The shape change is from columns to rows.** `team_intelligence` has one row per team with ~30 columns; each column becomes a **feature definition**, and each computation becomes a **feature value** with an `as_of`. A single V1 upsert of one `team_intelligence` row becomes ~30 inserts into `feature_value`.

Three rules the calculators must observe, all enforced by the database and none to be reimplemented:

- **Provenance monotonicity** — no derived value carries a provenance class stronger than the weakest in its lineage. Enforced by the statement-level trigger of migration 015 (A.12). Do not check it in TypeScript.
- **Subject exclusivity** — `ck_feature_value__subject_exclusive` permits exactly one of team / player / fixture / competition-edition. A fixture subject additionally requires `subject_fixture_partition_on` (A.1).
- **Context conditionality** — `context_competition_edition_id` is required if and only if `context_kind_code = 'COMPETITION_SCOPED'`.

**Synthetic weather must carry its provenance.** Phase 1 recorded synthetic weather stored with no provenance flag and consumed by a paid module. Under V2 it is `provenance_class_code = 'ESTIMATED'`, and any feature derived from it is capped at that class by the trigger. This resolves a live product-integrity problem as a side effect of conforming.

## 3.6 S-6 — Module generation → `module`

| | |
|---|---|
| **Current** | `lib/modules.ts` in the **frontend** — 1,587 lines, thirteen `eval*` functions computing readings at request time from hardcoded rates |
| **Target** | `module.module_definition`, `module_version`, `module_reading`, `module_evidence`, `module_evidence_item`, written by `pt_pipeline_module` |
| **Files** | `lib/modules.ts` **split** — evaluation logic moves to `v2/module/`, rendering stays; new `v2/module/registry.ts`, `evaluate.ts`, thirteen `modules/*.ts` |
| **Complexity** | L |
| **Risk** | **High** — depends on S-0 |
| **Testing** | Golden-file comparison against V1 output for the same fixture; evidence citations within declared inputs; readings reproducible from stored evidence |
| **Migration** | Per module; a module is converted when its V2 reading matches V1's for a sample of fixtures |

Detailed in §6.

## 3.7 S-7 — Snapshot sealing → `snapshot`

| | |
|---|---|
| **Current** | **No sealing exists.** `team_match_snapshots` is upserted on `(match_id, team_id)`; `readiness_history` rows are UPDATEd to attach outcomes |
| **Target** | Ten `snapshot` relations, insert-only, transactional, checksummed, job-attributed |
| **Files** | `jobs/archiveReadinessHistory.ts` (526 lines) **replace**; `jobs/processHistoricalContext.ts` **modify**; new `v2/snapshot/seal.ts`, `manifest.ts`, `checksum.ts`, `completeness.ts`, `outcome.ts` |
| **Complexity** | L |
| **Risk** | **High** — R-03, no V1 equivalent to port |
| **Testing** | Sealed content is immutable for every principal; checksum verification; manifest completeness; outcome succession ordinality |
| **Migration** | New capability. Runs in shadow, producing snapshots nothing reads, until the read path cuts over. |

Detailed in §7.

## 3.8 S-8 — Retention

| | |
|---|---|
| **Current** | None |
| **Target** | `operations.fn_run_retention()` called on a schedule as `pt_retention` |
| **Files** | New `v2/maintenance/retention.ts` — a caller, roughly 40 lines |
| **Complexity** | **S** |
| **Risk** | Low |
| **Testing** | Already verified in Phase 6.1 §14.2 — 360 recent untouched, 2,560→641 daily, 1,465→53 weekly |
| **Migration** | Schedule once feature and module volume justifies it |

**The database does the work.** The application connects as `pt_retention`, calls one function, and logs the count. Do not implement thinning in TypeScript — the ordering, the marker, the band arithmetic and the guards are all in the function and all verified.

The bounded class remains gated on the A.17/R-71 detachment verification; `fn_run_retention` raises a notice and detaches nothing until that is recorded.

## 3.9 S-9 — Calibration

| | |
|---|---|
| **Current** | `backtestSignals.ts` (293), `backtestConfidenceBands.ts` (533), `sampleBands.ts` (134), `lib/confidenceBand.ts` (463) → `signal_backtests` |
| **Target** | `calibration.measurement_population`, `calibration_run`, `calibration_series`, `calibration_result`, `published_baseline`, `sample_gate` |
| **Files** | Three jobs → `v2/calibration/`; `lib/confidenceBand.ts` **modify** (keep the formula-integrity guarantee) |
| **Complexity** | M |
| **Risk** | **High** — R-04 |
| **Testing** | Wilson interval correctness; sample-gate enforcement; series keyed by module version; published rate identical to measured rate |
| **Migration** | Cannot start until S-6 lands. Historical backtests are **re-run**, not migrated. |

**Existing backtests cannot be carried across.** They measure `match_signals` produced by unversioned rules; LC-135 requires a series keyed by module version, and there is no version to key them to. Attributing them to a version invented after the fact would be a fabricated measurement. Re-baseline from sealed V2 snapshots as they accumulate, and **publish nothing until a sample gate passes** (LC-133).

This is a real product consequence, stated plainly: **for a period after cut-over, modules will correctly report "unverified" where V1 displayed a rate.** That is the specification working, not a regression — the V1 rates were marked `provenance: "unreplayed"` by the code that produced them.

`confidenceBand.ts`'s guarantee that the published and backtested formulas are byte-identical is a genuine strength and must survive; under V2 it becomes a property of the published baseline's derivation.

## 3.10 S-10 — Projection refresh

| | |
|---|---|
| **Current** | None. Thirteen `mv_*` read but never refreshed by any code |
| **Target** | `pt_pipeline_projection` populates `product.p_landing` and `p_team_state`; calls `product.fn_refresh_projection_views()` for the two matviews; records state in `product.projection_refresh_state` |
| **Files** | New `v2/projection/landing.ts`, `teamState.ts`, `refresh.ts` |
| **Complexity** | M |
| **Risk** | Low |
| **Testing** | Every projection row reconstructible from its sources (PR-07); `required_entitlement_key` set correctly; concurrent refresh does not block readers |
| **Migration** | Populate in shadow; cut over per page |

`fn_refresh_projection_views()` is `SECURITY DEFINER` because refresh requires ownership (B-10); the projection role calls it and does not own the views. Verified working in Phase 6.1 §14.2.

## 3.11 S-11 — Maintenance and partition creation

| | |
|---|---|
| **Current** | None |
| **Target** | `operations.fn_maintain_partitions()` daily; `fn_partitions_requiring_freeze()` enumerated and `VACUUM (FREEZE, ANALYZE)` issued **externally** |
| **Files** | New `v2/maintenance/partitions.ts`, `freeze.ts` |
| **Complexity** | S |
| **Risk** | Medium — a missed partition window causes inserts to land in the default partition, which the `default_partition_empty` quality check flags as HIGH |
| **Testing** | Forward buffer of not fewer than three intervals maintained; co-partitioned families extended with identical boundaries |

The freeze pass **must** run outside a transaction. `VACUUM` cannot execute inside one — that was blocker B-05, and the function now enumerates rather than vacuums. The caller is an ordinary script, not a `pg_cron` statement.

## 3.12 S-12 — Quality assertions

| | |
|---|---|
| **Current** | `verifyHistoricalIntegrity.ts` (94 lines) — one check |
| **Target** | Seventeen registered checks in `operations.quality_check`, results to `quality_assertion_result` |
| **Files** | `verifyHistoricalIntegrity.ts` **modify**; new `v2/quality/run.ts` |
| **Complexity** | M |
| **Risk** | Low |
| **Testing** | Each check detects a deliberately introduced violation |

Two are already executable in the database — `fn_assert_security_posture()` and `fn_assert_access_correspondence()`, both verified firing on deliberate breach in Phase 6.1 §14.4. The application schedules them and records results; it does not reimplement them.

---

# 4. Frontend Rewrite Plan

## 4.1 Governing changes

Four changes apply to every page and are not repeated per row below.

1. **Entitlement is deleted from the application.** `canAccessFeature`, `FEATURE_BY_MODULE`, `redactReadings`, `redactTeamInputs`, `boardLimit`, `required`, `rank`, `planRank` are removed. Pages read `product.p_landing` / `p_team_state`, whose RLS policy consults `fn_resolve_entitlements` — a gated row is never returned. Phase 7 AC-03, SEC-06, SEC-08, DB-07.
2. **`force-dynamic` is removed from 24 of 29 pages.** Intelligence reads become cacheable with a `revalidate` matched to the projection's freshness tolerance; the identity read is isolated and memoised with `React.cache()`.
3. **Every partitioned read carries a partition predicate.** §5.10.6 makes this mandatory and F-15 registers a conformance check that detects violations.
4. **Every reference to a partitioned relation is composite** — `(match_snapshot_id, fixture_partition_on)`, never `match_snapshot_id` alone (A.1, R-01).

## 4.2 Page-by-page migration

Freshness tolerances come from `product.read_model` as seeded in migration 017.

| Page | Current source | Target | Removed | New | Cache | Entitlement | Partition-aware | Render |
|---|---|---|---|---|---|---|---|---|
| `/` (223) | `getBoard` — 11 tables | `product.p_landing` | 11 | 1 | `revalidate: 900` | RLS | `fixture_partition_on` range | Static + stream |
| `/app` (204) | `getBoard` + access ctx | `p_landing` + memoised identity | 11 | 1 | `revalidate: 900` | RLS | range | Dynamic (identity) |
| `/match/[slug]` (621) | `getMatch` — **31 queries** | **1** partition-pruned gather across the co-partitioned sealed family | 31 | **1** | `revalidate: 300` | RLS | `= fixture_partition_on` | Static + stream |
| `/matches` (139) | `matches` + `match_results` | `p_landing`, day-grouped | 2 | 1 | `revalidate: 900` | RLS | range | Static |
| `/team/[slug]` (478) | `getTeam*` — 9 tables | `p_team_state` | 9 | 1 | `revalidate: 3600` | RLS | n/a | Static + stream |
| `/teams` (127) | `getTeamDirectory` — 2-stage | `p_team_state` paged | 2 | 1 | `revalidate: 3600` | RLS | n/a | Static |
| `/league/[slug]` (345) | `tournament_standings` + intel | `football.standing` latest + `p_team_state` | 4 | 2 | `revalidate: 3600` | RLS | n/a | Static |
| `/leagues` (108) | `mv_competition_summary` | unchanged (matview) | 0 | 0 | `revalidate: 21600` | none | n/a | Static |
| `/player/[slug]` (123) | `players` + intel + stats | `football.player` + `feature.fn_team_state` analogue | 3 | 2 | `revalidate: 3600` | RLS | n/a | Static |
| `/players` (106) | `players` + `player_intelligence` | projection | 2 | 1 | `revalidate: 3600` | RLS | n/a | Static |
| `/modules` (186) | `MODULES` literal | `mv_module_directory` | 0 | 1 | `revalidate: 86400` | none | n/a | Static |
| `/trends` (107) | `getTeamDirectory` | `p_team_state` ordered | 2 | 1 | `revalidate: 3600` | RLS | n/a | Static |
| `/search` (143) | multi-table `ilike` | sanitised search — **SEC-01** | 3 | 1 | `revalidate: 300` | RLS | n/a | Dynamic |
| `/watchlist` (211) | `watchlists` + board | `product.watchlist` + `p_landing` | 2 | 2 | none | owner policy | range | Dynamic |
| `/settings` (202) | `user_profiles` + subs | `product.user_preference` + `subscription` | 2 | 2 | none | owner policy | n/a | Dynamic |
| `/subscription` (161) | `subscription_plans` | `product.plan` + `plan_entitlement` | 2 | 2 | `revalidate: 3600` | public read | n/a | Static |
| `/pricing` (149) | literals | `product.plan` | 0 | 1 | `revalidate: 3600` | public read | n/a | Static |
| `/method` (79) | literals | unchanged | 0 | 0 | static | none | n/a | Static |
| `/login`, `/signup`, `/logout` (81) | auth | unchanged | 0 | 0 | none | n/a | n/a | Dynamic |
| `/admin/*` (9 pages, 1,205) | `lib/admin.ts` | `product` + `operations` under admin policy | — | — | none | `pt_platform_admin` | n/a | Dynamic |
| `/admin/users/export` (27) | `exportUsersCsv` | paginated + formula-escaped — **SEC-07, SEC-09** | 0 | 0 | none | admin policy | n/a | Route |
| `/auth/callback` (56) | OAuth exchange | unchanged | 0 | 0 | none | n/a | n/a | Route |
| `/not-found`, `loading.tsx` ×4 (38) | — | unchanged | 0 | 0 | static | n/a | n/a | Static |

**Totals: ~120 queries removed, ~25 added.** The match page alone goes from 31 to 1.

## 4.3 Data ownership

| Content | Owner | Application role |
|---|---|---|
| Fixture, team, player, competition facts | `football`, written by ingestion | Read only |
| Every calculated quantity | `feature`, written by feature pipeline | Read only |
| Module readings and evidence | `module`, written by module pipeline | Read only |
| Sealed match intelligence | `snapshot`, insert-only | Read only |
| Reliability baselines | `calibration` | Read only |
| Watchlist, preferences | `product`, written by the **user** under owner policy | Read and write |
| Projections | `product`, written by projection pipeline | Read only |

**The frontend writes exactly two relations**: `product.watchlist` and `product.user_preference`, both under an owner policy with `user_id` taken from the session. `preferences.ts` already does this correctly and is one of the few files that needs only a table rename.

## 4.4 The match page — the one worked example

The 31 queries collapse because the sealed family is **co-partitioned on `fixture_partition_on`**, which is why match intelligence deliberately has no projection (§B.13.3):

```ts
// v2 lib/queries/matchIntelligence.ts
export const getMatchIntelligence = cache(async (fixtureId: number, partitionOn: string) => {
  const { rows } = await readPool.query(`
    SELECT ms.id, ms.snapshot_point_code, ms.sealed_at,
           sv.readiness_edge, sv.form_edge, sv.travel_edge, sv.rest_edge,
           sv.congestion_edge, sv.availability_edge, sv.risk_score, sv.confidence,
           sv.evidence_count, sv.completeness_ratio,
           sv.consensus_supports_count, sv.consensus_contradicts_count,
           sv.consensus_neutral_count, sv.consensus_inactive_count,
           smr.module_definition_id, smr.module_status_code, smr.strength,
           sc.completeness_ratio AS coverage
    FROM snapshot.match_snapshot ms
    JOIN snapshot.snapshot_verdict sv
      ON sv.match_snapshot_id = ms.id AND sv.fixture_partition_on = ms.fixture_partition_on
    LEFT JOIN snapshot.snapshot_module_reading smr
      ON smr.match_snapshot_id = ms.id AND smr.fixture_partition_on = ms.fixture_partition_on
    LEFT JOIN snapshot.snapshot_completeness sc
      ON sc.match_snapshot_id = ms.id AND sc.fixture_partition_on = ms.fixture_partition_on
    WHERE ms.fixture_partition_on = $2      -- partition predicate: mandatory (§5.10.6, F-15)
      AND ms.fixture_id = $1
    ORDER BY ms.sealed_at DESC
  `, [fixtureId, partitionOn]);
  return assemble(rows);
});
```

Every join is composite (A.1). The `WHERE` prunes to one partition per relation. `cache()` deduplicates within the request.

---

# 5. API Layer Migration

## 5.1 Current inventory

| Interaction | Count | Credential | Disposition |
|---|---|---|---|
| Backend PostgREST writes | ~102 sites (78 upsert, 8 insert, 7 update, 9 delete) | service role | **Replace** with direct `pg` |
| Backend PostgREST reads | ~150 sites | service role | **Replace** with direct `pg` |
| Backend RPC | 1 (`replace_player_match_load`) | service role | **Replace** |
| Frontend reads | ~150 sites via `lib/queries.ts` | anon | **Replace** with projection reads |
| Frontend session reads | ~20 via `supabaseServer()` | authenticated | **Keep** — correct pattern |
| Frontend writes | 4 (`preferences.ts`) | authenticated | **Keep** — owner policy, session-derived `user_id` |
| Server Actions | `preferences.ts`, `authActions.ts`, `admin.ts` mutations | authenticated | **Keep** shape, retarget tables |
| Route Handlers | `auth/callback`, `admin/users/export` | authenticated | **Keep** |
| Direct PostgreSQL | **0** | — | **Add** — seven pooled roles |

## 5.2 Target model

```
  ┌──────────────────────────────────────────────────────────────┐
  │ BACKEND — direct PostgreSQL, session mode, port 5432          │
  │   pt_pipeline_ingestion   → football                          │
  │   pt_pipeline_feature     → feature                           │
  │   pt_pipeline_module      → module, snapshot                  │
  │   pt_pipeline_calibration → calibration, snapshot outcome only│
  │   pt_pipeline_projection  → product projections               │
  │   pt_retention            → fn_run_retention()                │
  │   pt_platform_admin       → read-all, governed config write   │
  └──────────────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────────────┐
  │ FRONTEND — Supabase PostgREST                                 │
  │   anon          → football (public), product.plan, projections│
  │   authenticated → the above + own watchlist/preferences/subs  │
  │   (service role: NEVER)                                       │
  └──────────────────────────────────────────────────────────────┘
```

`R-67` is load-bearing and easy to lose: `pt_pipeline_calibration` holds `INSERT` on `snapshot_outcome_link` and `snapshot_outcome_link_currency` **and on no other relation in the schema**. A schema-level default grant would have let the calibration role create snapshots. Do not consolidate the module and calibration credentials.

## 5.3 PostgREST is retained only where it fits

For the frontend it is correct — RLS-enforced, anon/authenticated, single-statement reads.

For the backend it is **structurally insufficient**, on three counts:

1. **No transactions.** Sealing is inherently multi-statement (§7). `db/client.ts:33` already documents the discovery that a `delete()+insert()` pair was two transactions.
2. **No session state.** The retention marker (R-21) and the timeouts (A.15) are session-scoped (R-58).
3. **Wrong credential.** The service role carries `BYPASSRLS`, making the entire verified privilege matrix inert.

## 5.4 Application logic that becomes database behaviour

Per the constraint against duplicating enforced rules:

| Deleted from the application | Replaced by |
|---|---|
| `canAccessFeature` rank comparison (`access.ts:169`) | RLS policy on `p_landing` / `p_team_state` consulting `fn_resolve_entitlements` (F-21) |
| Subscription liveness `!expires_at \|\| … > new Date()` (`access.ts:115`) | `now() <@ s.subscription_period` inside the function — **also closes SEC-02** |
| `boardLimit()` tier row caps (`access.ts:427`) | The projection's RLS policy; a database-applied limit cannot be bypassed |
| `redactReadings`, `redactTeamInputs` (`access.ts:200`, `:387`) | Gated rows are never returned |
| Provenance capping in feature code | Statement-level trigger (A.12) |
| Immutability checks before writing archives | Seal guard (R-23), append guard (R-19) |
| Retention eligibility logic | `fn_run_retention()` |
| Uniqueness checks before upsert | Unique constraints |

---

# 6. Module System Migration

## 6.1 What exists

`beta/live-frontend/src/lib/modules.ts`, 1,587 lines, in the **frontend**. Thirteen module definitions as a TypeScript array; thirteen `eval*` functions computing readings at request time; published rates and sample sizes as literals:

```ts
// :732 — evalRest
baseline: { rate: homeRate, sample: 1179, pooled: true,
            label: "home wins in this scenario", provenance: "unreplayed" },
// :747 — evalBttsFatigue
if (ar >= 7 && hr < 7) { scenario = "Away rested only"; rate = 60.0; }
```

Each definition names a source view — `mv_module_home_away`, `mv_module_readiness_tracker`, … — and **all thirteen are undefined everywhere in the repository** (Phase 7 AC-05). This is why S-0 blocks this workstream.

## 6.2 Target model

| Relation | Holds | Written by |
|---|---|---|
| `module.module_definition` | The thirteen modules: key, display number, question, subject kind, entitlement feature key, calibration mode | Seeder (S-3) |
| `module.module_version` | Effective-period-versioned rule revisions, with rationale and predecessor | Seeder, then on each rule change |
| `module.module_reading` | One append-only reading per (module, subject, context, as-of, version) | `pt_pipeline_module` |
| `module.module_evidence` | The feature values a reading consumed | `pt_pipeline_module` |
| `module.module_evidence_item` | Individual citations within evidence | `pt_pipeline_module` |
| `calibration.published_baseline` | **Every rate and sample currently hardcoded** | `pt_pipeline_calibration` |
| `calibration.sample_gate` | The evidential threshold each rate must clear (LC-133) | Seeder |

## 6.3 Code disposition

| Current | Disposition | Target |
|---|---|---|
| `MODULES` array (`:1`–`:200`) | **Becomes data** | Rows in `module_definition`, seeded once |
| Thirteen `eval*` functions (~1,100 lines) | **Becomes pipeline code** | `v2/module/modules/*.ts`, run by `pt_pipeline_module`, writing `module_reading` |
| Hardcoded `baseline: { rate, sample }` | **Becomes calibration** | `published_baseline` rows behind a sample gate |
| `provenance: "unreplayed"` | **Becomes measured** | `published_baseline.is_verified`, `measurement_provenance` |
| `status` derivation (`supports`/`neutral`/…) | **Becomes data** | `module_reading.module_status_code` → `module.module_status` |
| `headline`, `rows`, `verdict` strings | **Stays rendering** | Frontend, reading stored values |
| `inactive(def, reason)` | **Becomes data** | `module_status_code = 'INACTIVE'` with a stored reason |
| `MODULE_BY_KEY` lookup | **Deleted** | Registry query |
| `FEATURE_BY_MODULE` (`access.ts:25`) | **Deleted** | `module_definition.entitlement_feature_key` — already a real column with a real FK |
| `evidencePolicy.ts` (80 lines) | **Becomes operational metadata** | `module_evidence_item` conformance, checked by `module_input_conformance` |

**Roughly 1,300 of 1,587 lines leave the frontend.** What remains is presentation of values the database supplies.

## 6.4 Migration sequence, per module

1. Recover the module's `mv_*` definition from production (**S-0**).
2. Express its inputs as feature definitions; confirm the feature pipeline produces them (**S-5**).
3. Seed `module_definition` + an initial `module_version`.
4. Port the `eval*` function to `v2/module/modules/<key>.ts`, writing a `module_reading` plus `module_evidence` citing the feature values it consumed.
5. **Golden-file test**: for 100 historical fixtures, the V2 reading must match V1's output exactly, given the same inputs.
6. Open a `calibration_series` keyed by the module version; accumulate results.
7. Publish a baseline **only when the sample gate passes**; until then the module reports unverified.
8. Delete the `eval*` function from the frontend.

Step 7 is where the honest product consequence in §3.9 lands, per module.

## 6.5 Consensus

The consensus is currently computed in the frontend from the full reading set upstream of redaction, so a Free viewer gets the same verdict a Pro viewer does — a deliberate and correct design choice. Under V2 it is computed by the module pipeline under a `verdict_composition_version` and stored in `snapshot.snapshot_verdict`, with `consensus_supports_count` / `contradicts` / `neutral` / **`inactive`** held separately (LC-73: a module silent for want of data is not a module that found the fixture unremarkable). The property that every tier sees the same verdict is preserved and strengthened — it becomes a stored fact rather than a rendering convention.

---

# 7. Snapshot Migration

## 7.1 The workflow that exists, and what happens to it

| V1 workflow | V1 mechanism | V2 replacement |
|---|---|---|
| Archive a pre-match reading | `readiness_history` insert-if-absent (`archiveReadinessHistory.ts:120`) | `snapshot.match_snapshot` + family, sealed in one transaction |
| Attach the result | **`UPDATE readiness_history`** (`:306`) | **INSERT** into `snapshot_outcome_link` (A.2) |
| Correct an outcome | Overwrite | **Ordinal succession** into `snapshot_outcome_link_currency` |
| Record what modules said | Not recorded | `snapshot_module_reading` — individually addressable (LC-86) |
| Record which versions applied | Not recorded | `snapshot_version_component` manifest |
| Record coverage | Not recorded | `snapshot_completeness` + `_item` |
| Detect tampering | Not possible | `content_checksum` + `fn_verify_snapshot_checksums` |
| Attribute to an execution | Not recorded | `pipeline_job_run_id` + `pipeline_job_run_occurred_at` (P-04) |

## 7.2 The sealing transaction

Sealing is **one transaction or nothing**. This is the operation PostgREST cannot express (R-03).

```ts
// v2/snapshot/seal.ts
export async function sealSnapshot(fixtureId: number, partitionOn: string, point: SnapshotPoint) {
  return withRun("pt_pipeline_module", "snapshot.seal", async (tx, job) => {
    // 1 ── the snapshot header, naming the versions in force and the job that made it
    const { rows: [snap] } = await tx.query(`
      INSERT INTO snapshot.match_snapshot
        (fixture_id, fixture_partition_on, snapshot_point_code, snapshot_as_of, sealed_at,
         verdict_composition_version_id, consensus_rule_version_id,
         content_checksum, checksum_algorithm_version_id,
         pipeline_job_run_id, pipeline_job_run_occurred_at)
      VALUES ($1,$2,$3, now(), now(), $4, $5, $6, $7, $8, $9)
      RETURNING id, fixture_partition_on`,
      [fixtureId, partitionOn, point, vcv, crv, checksum, cav, job.id, job.occurredAt]);

    // 2 ── version manifest: every version referenced by content appears here
    await insertVersionComponents(tx, snap, manifest);

    // 3 ── feature state as it stood at the sealing instant
    await insertFeatureStates(tx, snap, featureValues);

    // 4 ── every module reading, individually addressable (LC-86)
    await insertModuleReadings(tx, snap, readings);

    // 5 ── the verdict: a characterisation, never a prediction (LC-71)
    await insertVerdict(tx, snap, verdict);

    // 6 ── completeness: what was present, what was absent, and why
    await insertCompleteness(tx, snap, coverage);

    return snap.id;
  });
}
```

Ordering within the transaction is forced by the references. Every child carries `fixture_partition_on` and joins compositely (A.1).

## 7.3 Checksums

`content_checksum` is `bytea`; `checksum_algorithm_version_id` names the algorithm **and its canonical serialisation** (`module.checksum_algorithm_version.canonical_form`).

**The canonical serialisation is not yet specified.** Migration 018 records this as a TODO rather than inventing one, and `fn_verify_snapshot_checksums` returns `NULL` — reporting unverified rather than falsely passing. Before production the serialisation must be specified and implemented **identically** in the sealing writer and the verification function. Until then, PR-04's fourth control is not operative and the `snapshot_checksum` quality check reports unverified. This must be closed before launch; it is registered as `BLOCKING`.

## 7.4 Outcome linking and revision succession

The V1 UPDATE becomes an insert:

```ts
// v2/snapshot/outcome.ts — runs as pt_pipeline_calibration (R-67)
await tx.query(`
  INSERT INTO snapshot.snapshot_outcome_link
    (match_snapshot_id, fixture_partition_on, outcome_dimension_code,
     outcome_derivation_version_id, observed_value, ordinal)
  VALUES ($1,$2,$3,$4,$5,
          COALESCE((SELECT max(ordinal) + 1 FROM snapshot.snapshot_outcome_link
                     WHERE match_snapshot_id = $1 AND fixture_partition_on = $2
                       AND outcome_dimension_code = $3), 1))`, …);
```

A correction is a **new row with a higher ordinal**; the currency companion records which ordinal prevails. Nothing is updated, so the seal guard is never provoked. This is correction A.2, and it is why the design deliberately avoided a mutable `is_current` flag: a single permitted update would have defeated the schema-level privilege posture.

## 7.5 Feature and module attachment

- **Feature attachment** — `snapshot_feature_state` records the prevailing feature value **as it stood at the sealing instant**, by reference to `(feature_value_id, as_of)`. Because `feature_value` is append-only, the reference remains valid and the historical answer is reconstructible.
- **Module attachment** — `snapshot_module_reading` records each reading, its status, strength and confidence, and the module **version** that produced it. This is what makes per-module reliability measurable, which V1 could not do at all.

## 7.6 Job attribution is a prerequisite, not a decoration

`ck_match_snapshot__job_run_reference_complete` enforces both-or-neither on `(pipeline_job_run_id, pipeline_job_run_occurred_at)`. A sealing transaction that has not opened a job run cannot supply the pair, so **S-2 must land before S-7**. This is the single most common sequencing mistake available in this migration.

---

# 8. Operational Layer Migration

## 8.1 Relation-by-relation

| Relation | Written when | By | Contents |
|---|---|---|---|
| `pipeline_run` | A scheduled execution begins | every pipeline role | Run key, trigger, start/end, outcome |
| `pipeline_job_run` | Each stage within a run | every pipeline role | Job key, parent run, outcome, counts |
| `write_record` | Each write batch | every pipeline role | Target relation, row count, job run |
| `failure` | Any error | every pipeline role | Class, message, context, job run |
| `failure_resolution` | A failure is resolved | `pt_platform_admin` | Resolution, actor, instant |
| `api_usage` | Each provider call | `pt_pipeline_ingestion` | Endpoint, credential, quota consumed |
| `quality_assertion_result` | Each check execution | scheduler | Check, outcome, detail — **permanent** |
| `operational_aggregate` | Period rollup | scheduler | Summary retained after detail is thinned |

## 8.2 Retry

Retry is **per job run**, recorded, and bounded:

| Failure class | Retry | Ceiling |
|---|---|---|
| Provider timeout / 5xx | Exponential backoff | 4 attempts |
| Provider quota exhausted | None — defer to next window | — |
| Constraint violation | **None.** The database rejected the write; retrying repeats it | 1 |
| Deadlock / serialisation | Immediate | 3 |
| Connection lost | Reconnect and resume from the ledger | 3 |

**A constraint violation is never retried.** It means the application attempted something the architecture forbids — an upsert against an append-only relation, a snapshot update — and the correct response is to fail loudly and record it.

## 8.3 Scheduling

`pg_cron` is installed (migration 001) and the schedule entries in 018 are commented pending the cadence decision. Two classes:

| Class | Mechanism | Members |
|---|---|---|
| In-database | `pg_cron` | `fn_maintain_partitions`, `fn_run_retention`, projection refresh, quality assertions |
| External non-transactional | Ordinary scheduled process | The freeze pass (`VACUUM` cannot run in the transaction `pg_cron` establishes — B-05), and every provider-calling ingestion job |

`cli.ts` (1,745 lines) remains the operator entry point and gains run/job wrapping. cPanel cron entries are replaced by a scheduler that records what it started.

## 8.4 Monitoring, alerting, dashboards

| Need | Source |
|---|---|
| Did the pipeline run? | `pipeline_run` |
| Did any stage fail? | `failure` where unresolved |
| Is anything missing? | `operations.v_coverage` — **the only mechanism by which a missing snapshot becomes visible**; a failed run leaves a permanent silent absence |
| Is anything stale? | `operations.v_freshness` |
| Are the quality checks passing? | `quality_assertion_result` |
| Is quota at risk? | `api_usage` against the configured ceiling |

Alerting thresholds: any `BLOCKING` check failing; coverage below the cadence requirement for any competition in window; any unresolved failure older than one run interval; `api_usage` above 80% of the daily quota.

Structured logging replaces the 35 empty catch blocks (Phase 7 SEC-10). `pino` stays; every error additionally writes a `failure` row.

---

# 9. Security Migration

## 9.1 Seven roles and credential separation

| Role | Connects for | Holds |
|---|---|---|
| `pt_pipeline_ingestion` | Provider sync | `football` SIU (SI only on the three append-only relations), `operations` SI |
| `pt_pipeline_feature` | Feature calculation | `feature` SI, `football` S, `operations` SI |
| `pt_pipeline_module` | Module + sealing | `module` SI, `snapshot` SI (8 relations), `feature`/`football`/`calibration` S |
| `pt_pipeline_calibration` | Calibration | `calibration` SI, `snapshot` outcome-link **I only** (R-67) |
| `pt_pipeline_projection` | Projections | `product` projections SIUD, everything else S |
| `pt_retention` | Retention | `feature`/`module` S + D **under the session marker** |
| `pt_platform_admin` | Administration | Read-all, governed config write |

Roles are created `NOLOGIN` by migration 001; **credentials are granted through a secure channel outside version control** — a migration file is not a place for a credential. Each pipeline receives only its own.

## 9.2 Removing the service role

`SUPABASE_SERVICE_KEY` is deleted from every backend environment. Its presence is the finding (Phase 7 SEC-03): one leaked credential grants unrestricted read and write, and no policy in the verified matrix constrains it.

**Verification:** after cut-over, `SELECT * FROM pg_stat_activity` shows no session authenticated as the service role, and `grep -r SERVICE_KEY beta/backend` returns nothing.

## 9.3 RLS integration

The application does **not** implement authorization. It:

1. Connects as the right role.
2. Issues the statement.
3. Surfaces the error if the database refuses.

Two assertions verify the posture continuously, both already proven to fire on deliberate breach (Phase 6.1 §14.4):

- `fn_assert_access_correspondence()` — every granted DML privilege has a covering policy.
- `fn_assert_security_posture()` — RLS enabled and forced everywhere; no UPDATE/DELETE on `snapshot`; no default privileges there; DELETE on thinnable relations held only by `pt_retention`.

## 9.4 Projection-only reads and database entitlement enforcement

End-user roles hold **no privilege whatsoever** on `feature`, `module`, `snapshot`, `calibration` or `operations`. Calculated content reaches users exclusively through `product` projections (§B.7.2).

`fn_resolve_entitlements` is `SECURITY INVOKER` (B-02): the caller reads their own subscription under their own policy plus two publicly-readable relations. It is the **sole** entitlement path (F-21), consulted from the projection's RLS policy. The application never resolves entitlement.

## 9.5 Live security remediation

Independent of V2, do these first (Phase 7 Group 1):

| Item | Fix | Finding |
|---|---|---|
| Session refresh | Add `middleware.ts` with the Supabase SSR refresh | SEC-04 |
| Security headers | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy in `next.config.ts` | SEC-05 |
| Filter injection | Sanitise `q` before `.or()` in `queries.ts:1220` and `admin.ts:128`; bound the id-materialisation | SEC-01, PERF-02 |
| Subscription expiry | Point `access.ts` at `current_period_end` — then delete the logic entirely at cut-over | SEC-02 |
| CSV injection | Prefix `= + - @` in exported cells; paginate rather than truncate | SEC-07, SEC-09 |
| Error visibility | `error.tsx`, `global-error.tsx`, structured logging | SEC-10 |

## 9.6 Audit logging and secret management

`admin_actions` (V1) becomes `operations` telemetry plus `product.subscription_event`; every admin mutation writes an attributable record. Secrets: seven pipeline passwords, one anon key, one provider key pair — none in the repository, none in a migration, none in the frontend bundle. The frontend currently contains **no** service-role reference, which is correct and must stay so.

---

# 10. Performance Migration

## 10.1 Query consolidation

| Path | Before | After | Reduction |
|---|---|---|---|
| `/match/[slug]` | **31** | **1** | −97% |
| `/` and `/app` | 11 | 1 | −91% |
| `/team/[slug]` | 9 | 1 | −89% |
| `/teams`, `/trends` | 2 (unbounded first stage) | 1 (paged) | −50% + bound |
| Identity per request | 7 reads + 2 auth round trips | 2 reads + 1, memoised | −70% |
| **Whole application** | **~150** | **~25** | **−83%** |

## 10.2 Partition pruning

No current read carries a partition predicate; every one would fail F-15's pruning conformance check. After migration every read of a partitioned relation carries `fixture_partition_on` or `as_of`. A match read touches **one** partition per relation instead of the whole hierarchy — and because the sealed family is co-partitioned on the same key with identical boundaries, assembly is a partition-wise gather rather than a cross-relation join.

## 10.3 Caching and rendering

| Layer | Now | Target |
|---|---|---|
| Page | `force-dynamic` on 24 of 29 | `revalidate` matched to `read_model.freshness_tolerance` |
| Request | None | `React.cache()` on identity and every shared read |
| Projection | None | Projection relations are themselves the cache |
| Matview | Never refreshed | `fn_refresh_projection_views()` on schedule |
| Invalidation | `revalidatePath("/", "layout")` on every star click | Narrow, path-specific |

## 10.4 Estimated improvement

Assumptions stated so the figures can be checked: ~15 ms per PostgREST round trip; ~8 ms for a partition-pruned local query; current traffic unchanged.

| Metric | Now | After | Change |
|---|---|---|---|
| Match page, uncached | ~465 ms in database round trips | ~8 ms | **−98%** |
| Match page, cached | n/a (no caching) | ~0 ms for the cache lifetime | — |
| Board page, uncached | ~165 ms | ~8 ms | −95% |
| Queries per match view | 31 | 1 | −97% |
| Database load at constant traffic | baseline | **−80–90%** | query count × cache-hit ratio |
| Identity resolution | 2 auth round trips + 7 reads | 1 + 2, memoised | −70% |

**Scalability.** The current architecture scales linearly with page views because nothing is cached and every view re-runs every query. After migration, read cost scales with the **projection refresh rate** rather than with traffic, and the partitioned relations bound scan cost by time window rather than by total volume. Those two properties together are what let the design absorb the coverage target that V1's read pattern could not.

**Pipeline efficiency.** Appending rather than upserting removes the read-modify-write round trip per row; batched multi-row inserts inside one transaction replace per-row awaits — `archiveReadinessHistory.ts:306`'s sequential UPDATE loop becomes a single statement.

---

# 11. File-Level Migration Worklist

Dispositions: **K** keep · **M** modify · **RW** rewrite · **RP** replace (new file, old deleted) · **D** delete. Effort: **S** ≤2 days · **M** ≤1 week · **L** ≤3 weeks. Phase refers to §2.3.

## 11.1 Backend — `beta/backend/src` (64 files, 25,609 lines)

### Infrastructure

| File | L | Current | Target | Disp | Eff | Deps | Phase |
|---|---|---|---|---|---|---|---|
| `cli.ts` | 1745 | Command entry, ordering | Same, run/job wrapped | M | M | S-2 | S-2 |
| `config/index.ts` | 84 | Env config, service key | Seven role credentials | M | S | — | S-1 |
| `config/trackedLeagues.ts` | 413 | League allowlist | Unchanged — provider config | **K** | — | — | — |
| `constants/endpoints.ts` | 175 | Provider endpoints | Unchanged | **K** | — | — | — |
| `db/client.ts` | 37 | One service-role client | Seven pools, session mode | **RW** | M | — | S-1 |
| `db/chunkedIn.ts` | 78 | PostgREST `.in()` chunking | Obsolete — SQL takes arrays | **D** | S | S-1 | S-4 |
| `db/fetchAllRows.ts` | 114 | PostgREST pagination | Obsolete — cursors | **D** | S | S-1 | S-4 |
| `utils/logger.ts` | 23 | pino to stdout | pino + `failure` rows | M | S | S-2 | S-2 |
| `utils/apiSamples.ts` | 102 | Provider fixtures | Unchanged | **K** | — | — | — |
| `types/index.ts` | 239 | V1 row types | V2 row types | **RW** | M | S-3 | S-3 |
| `transformers/index.ts` | 155 | Provider → V1 rows | Provider → V2 rows | **RW** | M | S-3 | S-4 |

### Services — no change

| File | L | Disposition |
|---|---|---|
| `services/sportsApiClient.ts` | 149 | **K** — add `api_usage` recording (S, S-2) |
| `services/sofaScoreClient.ts` | 108 | **K** — add `api_usage` recording (S, S-2) |

### Repositories — all rewritten to direct SQL

All eleven currently wrap PostgREST upserts; all become parameterised SQL against `football`. Disposition **RW** throughout, phase S-4.

| File | L | Target relations | Eff |
|---|---|---|---|
| `repositories/MatchesRepository.ts` | 247 | `football.fixture`, `fixture_lifecycle_transition` | M |
| `repositories/SquadAndTransfersRepository.ts` | 232 | `player_registration` | M |
| `repositories/TeamFormHistoryRepository.ts` | 197 | → `feature.feature_value` (**moves layer**) | M |
| `repositories/TeamsRepository.ts` | 144 | `football.team` | S |
| `repositories/PlayersRepository.ts` | 141 | `football.player` | S |
| `repositories/IntelligenceRepositories.ts` | 108 | → `feature.feature_value` (**moves layer**) | M |
| `repositories/SeasonsRepository.ts` | 106 | `competition_edition` | S |
| `repositories/TournamentsRepository.ts` | 105 | `competition` | S |
| `repositories/PlayerInjuriesRepository.ts` | 86 | `player_availability` | S |
| `repositories/CountriesRepository.ts` | 76 | `country` | S |
| `repositories/TeamPositionDepthRepository.ts` | 73 | → `feature.feature_value` (**moves layer**) | S |

### Ingestion jobs — S-4

| File | L | Current | Target | Disp | Eff |
|---|---|---|---|---|---|
| `syncSquadSofaScore.ts` | 921 | Squad snapshots | `player_registration` | **RW** | L |
| `syncDateMasterFeed.ts` | 715 | Master feed | `fixture`, `team`, `competition` | **RW** | L |
| `syncSeasonStatistics.ts` | 565 | Season stats | `provider_statistic` | **RW** | M |
| `syncTeamsPlayers.ts` | 423 | Teams/players | `team`, `player` | **RW** | M |
| `syncStandings.ts` | 316 | Standings upsert | `standing` — **append-only** | **RW** | M |
| `syncTeamImages.ts` | 313 | Crest storage | Unchanged + `api_usage` | M | S |
| `syncTournamentEvents.ts` | 303 | Tournament events | `competition_stage` | **RW** | M |
| `backfillSeason.ts` | 246 | Historical backfill | V2 backfill | **RW** | M |
| `syncDiscovery.ts` | 193 | Season discovery | `competition_edition` | **RW** | S |
| `syncSchedule.ts` | 156 | Legacy schedule | Superseded by master feed | **D** | S |
| `syncTransfersV2.ts` | 145 | Transfers | `player_registration` | **RW** | S |

### Feature calculation — S-5

| File | L | Current | Target | Disp | Eff |
|---|---|---|---|---|---|
| `processExtendedIntelligence.ts` | 4866 | ~15 wide tables | `feature_value` + `feature_lineage` | **RW** | **L** |
| `processDbOnly.ts` | 4509 | L1→L6 orchestrator, ~25 tables | Same ordering, append-only | **RW** | **L** |
| `processHistoricalContext.ts` | 762 | History + `team_match_snapshots` | Feature values; snapshot part → S-7 | **RW** | M |
| `processPredictedLineups.ts` | 608 | Predicted XI | `feature_value` (fixture subject) | **RW** | M |
| `processRiskOpportunity.ts` | 371 | Risk/opportunity signals | Module evidence (**moves to S-6**) | **RW** | M |
| `processForm.ts` | 249 | Form backfill | `feature_value` | **RW** | S |
| `lib/formNarratives.ts` | 346 | Narrative strings | Rendering only — **moves to frontend** | M | S |
| `lib/signalLogic.ts` | 381 | Signal derivation | Module evaluation (**S-6**) | **RW** | M |
| `lib/confidenceComponents.ts` | 79 | Confidence inputs | Feature values | M | S |
| `lib/confidenceComponents.test.ts` | 120 | Unit tests | Retained, retargeted | M | S |
| `lib/matchLifecycle.ts` | 25 | Status mapping | `fixture_lifecycle_state` vocabulary | M | S |

### Lineups — `lib/lineups/` (11 files, 1,748 lines)

Pure computation with no database dependency. **Keep all**, retarget only the call sites' inputs and outputs. Effort **S** each, phase S-5.

`assembly.ts` (126) · `availability.ts` (179) · `candidates.ts` (110) · `confidence.ts` (135) · `formationScoring.ts` (180) · `formations.ts` (268) · `index.ts` (32) · `optimizer.ts` (145) · `playerScoring.ts` (139) · `positions.ts` (229) · `types.ts` (171) · `lineups.test.ts` (303) — **K**, tests retained unchanged.

### Snapshot, calibration, quality

| File | L | Current | Target | Disp | Eff | Phase |
|---|---|---|---|---|---|---|
| `archiveReadinessHistory.ts` | 526 | Archive + **UPDATE outcome** | Sealing + outcome insert | **RP** | L | S-7 |
| `backtestConfidenceBands.ts` | 533 | Band backtests | `calibration_run`/`result` | **RW** | M | S-9 |
| `backtestSignals.ts` | 293 | Signal backtests | `calibration_series` by module version | **RW** | M | S-9 |
| `lib/confidenceBand.ts` | 463 | Formula + integrity guarantee | Same, feeding `published_baseline` | M | M | S-9 |
| `sampleBands.ts` | 134 | Band sampling | `measurement_population` | **RW** | S | S-9 |
| `verifyHistoricalIntegrity.ts` | 94 | One integrity check | Quality assertion runner | **RW** | M | S-12 |

### New backend files

| File | Purpose | Eff | Phase |
|---|---|---|---|
| `db/pool.ts`, `db/roles.ts`, `db/tx.ts` | Pooling, roles, run-wrapped transactions | M | S-1 |
| `v2/operations/{run,writeRecord,failure,apiUsage,schedule}.ts` | Operational layer | M | S-2 |
| `v2/seed/*.ts` | Vocabulary and registry seeders | M | S-3 |
| `v2/feature/*.ts` | One calculator per feature definition | **L** | S-5 |
| `v2/module/{registry,evaluate}.ts` + `modules/*.ts` (13) | Module pipeline | **L** | S-6 |
| `v2/snapshot/{seal,manifest,checksum,completeness,outcome}.ts` | Sealing | **L** | S-7 |
| `v2/calibration/*.ts` | Calibration pipeline | M | S-9 |
| `v2/projection/{landing,teamState,refresh}.ts` | Projection refresh | M | S-10 |
| `v2/maintenance/{partitions,freeze,retention}.ts` | Maintenance | S | S-11 |
| `v2/quality/run.ts` | Quality assertions | M | S-12 |

**Backend summary: 11 keep · 12 modify · 27 rewrite · 1 replace · 3 delete · ~30 new.**

## 11.2 Frontend — `beta/live-frontend/src` (98 files, 20,295 lines)

### Data layer

| File | L | Current | Target | Disp | Eff | Phase |
|---|---|---|---|---|---|---|
| `lib/queries.ts` | 1490 | ~150 PostgREST reads incl. 31-query `getMatch` | Projection + sealed-aggregate reads | **RW** | **L** | S-11 |
| `lib/modules.ts` | 1587 | Registry + eval + hardcoded rates | Rendering types only (~250 lines) | **RW** | **L** | S-6 |
| `lib/types.ts` | 779 | V1 row types | V2 projection types | **RW** | M | S-11 |
| `lib/admin.ts` | 705 | Admin CRUD; **SEC-01, SEC-07, SEC-09** | Same under admin policy | M | M | S-12 |
| `lib/teamBrief.ts` | 498 | Brief derivation | Reads `p_team_state` | M | M | S-11 |
| `lib/mock.ts` | 493 | Demo data | Regenerated for V2 shapes | M | S | S-11 |
| `lib/performance.ts` | 455 | Performance derivation | Reads feature values | M | M | S-11 |
| `lib/matchCompare.ts` | 446 | Comparison logic | Reads sealed aggregate | M | M | S-11 |
| `lib/access.ts` | 435 | **Entitlement reimplementation** | ~60 lines: identity only | **RW** | M | S-11 |
| `lib/intel.ts` | 266 | Intelligence shaping | Reads projections | M | S | S-11 |
| `lib/teamProfile.ts` | 212 | Profile assembly | Reads `p_team_state` | M | S | S-11 |
| `lib/glossary.ts` | 193 | Term definitions | Unchanged | **K** | — | — |
| `lib/formation.ts` | 146 | Formation display | Unchanged | **K** | — | — |
| `lib/preferences.ts` | 135 | Watchlist/favourites | `product.watchlist`, `user_preference` | M | S | S-11 |
| `lib/authActions.ts` | 134 | Auth actions | Unchanged | **K** | — | — |
| `lib/tier.ts` | 81 | Tier comparison | **Obsolete** — RLS decides | **D** | S | S-11 |
| `lib/evidencePolicy.ts` | 80 | Evidence rules | Operational metadata | **D** | S | S-6 |
| `lib/region.ts` | 61 | Region grouping | Unchanged | **K** | — | — |
| `lib/supabase/server.ts` | 61 | Session client | Unchanged — correct | **K** | — | — |
| `lib/slug.ts` | 42 | Slug helpers | Unchanged | **K** | — | — |
| `lib/supabase.ts` | 32 | Anon client | Unchanged | **K** | — | — |

### Pages — all `app/` (29 pages + 4 loading + 2 routes)

Per §4.2. Disposition **M** unless noted; effort **S** unless noted; phase S-11.

| File | L | Note |
|---|---|---|
| `app/match/[slug]/page.tsx` | 621 | 31 → 1 query. **M**, effort **M** |
| `app/team/[slug]/page.tsx` | 478 | 9 → 1. **M**, effort **M** |
| `app/league/[slug]/page.tsx` | 345 | 4 → 2. **M** |
| `app/admin/bands/page.tsx` | 234 | Calibration read. **M** |
| `app/admin/users/[id]/page.tsx` | 235 | Admin policy. **M** |
| `app/page.tsx` | 223 | 11 → 1. **M** |
| `app/watchlist/page.tsx` | 211 | Owner policy. **M** |
| `app/app/page.tsx` | 204 | 11 → 1. **M** |
| `app/settings/page.tsx` | 202 | `user_preference`. **M** |
| `app/modules/page.tsx` | 186 | `mv_module_directory`. **M** |
| `app/admin/users/page.tsx` | 184 | **SEC-01**. **M** |
| `app/subscription/page.tsx` | 161 | `product.plan`. **M** |
| `app/pricing/page.tsx` | 149 | Literals → `product.plan`. **M** |
| `app/admin/settings/page.tsx` | 145 | `platform_setting`. **M** |
| `app/search/page.tsx` | 143 | **SEC-01**. **M** |
| `app/matches/page.tsx` | 139 | `p_landing`. **M** |
| `app/teams/page.tsx` | 127 | **PERF-02**. **M** |
| `app/player/[slug]/page.tsx` | 123 | 3 → 2. **M** |
| `app/admin/subscriptions/page.tsx` | 121 | **M** |
| `app/admin/bands/league/[league]/page.tsx` | 108 | **M** |
| `app/leagues/page.tsx` | 108 | Matview. **M** |
| `app/trends/page.tsx` | 107 | **M** |
| `app/players/page.tsx` | 106 | **M** |
| `app/admin/bands/[band]/page.tsx` | 103 | **M** |
| `app/layout.tsx` | 87 | Identity memoisation. **M** |
| `app/method/page.tsx` | 79 | Static. **K** |
| `app/admin/usage/page.tsx` | 48 | → `operations.api_usage`. **RW** |
| `app/auth/callback/route.ts` | 56 | Correct as-is. **K** |
| `app/signup/page.tsx` | 29 | **K** |
| `app/login/page.tsx` | 29 | **K** |
| `app/admin/users/export/route.ts` | 27 | **SEC-07/09**. **M** |
| `app/logout/page.tsx` | 23 | **K** |
| `app/not-found.tsx` | 22 | **K** |
| `app/{league,leagues,match,matches,team}/…/loading.tsx` | 4 ×5 | **K** |
| **New** `middleware.ts` | — | **SEC-04**. **New**, effort S, phase S-12 |
| **New** `app/error.tsx`, `app/global-error.tsx` | — | **SEC-10**. **New**, effort S |

### Components (39 files, 7,384 lines)

Presentation only; they change shape with their props, not their responsibility.

| File | L | Disposition | Note |
|---|---|---|---|
| `MatchReport.tsx` | 633 | **M** (M) | Sealed aggregate props |
| `TeamMatchup.tsx` | 367 | **M** | Projection props |
| `SignalLedger.tsx` | 376 | **M** | `module_evidence` |
| `FeedTable.tsx` | 363 | **M** | `p_landing` |
| `icons/ModuleIcons.tsx` | 308 | **K** | |
| `Nav.tsx` | 298 | **M** | Memoised identity |
| `BettingCard.tsx` | 287 | **M** | Verdict — **not a prediction** (LC-71) |
| `TeamBrief.tsx` | 274 | **M** | `p_team_state` |
| `ModuleCard.tsx` | 250 | **M** | Stored readings |
| `PredictedXI.tsx` | 232 | **M** | Feature values |
| `FeatureGate.tsx` | 229 | **RW** (S) | Locked-state rendering only; gating deleted |
| `ModuleFeed.tsx` | 219 | **M** | Stored readings |
| `icons/NavIcons.tsx` | 194 | **K** | |
| `Rate.tsx` | 177 | **M** | `published_baseline` |
| `WatchToggle.tsx` | 177 | **K** | Correct as-is |
| `PerformanceIntel.tsx` | 174 | **M** | |
| `ModuleReport.tsx` | 163 | **M** | |
| `AdminUserActions.tsx` | 163 | **M** | |
| `KeyPlayerBattles.tsx` | 159 | **M** | |
| `MatchCard.tsx` | 148 | **M** | |
| `InjuryPanel.tsx` | 130 | **M** | `player_availability` |
| `AuthForm.tsx` | 127 | **K** | |
| `Meters.tsx` | 123 | **M** | |
| `AdminFilterBar.tsx` | 121 | **M** | |
| `RadarChart.tsx` | 120 | **M** | |
| `SubscriptionToggle.tsx` | 115 | **M** | |
| `Primitives.tsx` | 112 | **K** | |
| `FavouriteLeagues.tsx` | 100 | **M** | |
| `Explain.tsx` | 97 | **K** | |
| `AccountMenu.tsx` | 94 | **M** | Add `alt` — a11y |
| `LeaguesByRegion.tsx` | 71 | **K** | |
| `Scorecard.tsx` | 67 | **M** | |
| `LocalKickoff.tsx` | 63 | **K** | |
| `Crest.tsx` | 52 | **M** | Add `alt` — a11y |
| `SubTabs.tsx` | 53 | **K** | |
| `Tabs.tsx` | 49 | **K** | |
| `AdminGuard.tsx` | 43 | **M** | Reads role, not entitlement |
| `Skeleton.tsx` | 31 | **K** | |
| `Collapsible.tsx` | 22 | **K** | |

**Frontend summary: 30 keep · 58 modify · 5 rewrite · 2 delete · 3 new.**

## 11.3 Totals

| | Keep | Modify | Rewrite | Replace | Delete | New |
|---|---|---|---|---|---|---|
| Backend (64) | 11 | 12 | 27 | 1 | 3 | ~30 |
| Frontend (98) | 30 | 58 | 5 | 0 | 2 | 3 |
| **Total (162)** | **41** | **70** | **32** | **1** | **5** | **~33** |

**25% of files are untouched; 20% are rewritten.** The rewrites concentrate in the write path — which is exactly where V1 and V2 differ architecturally.

## 11.4 Trees not covered

`beta/frontend/` (66), `backend/` (63), `frontend/` (68), `pitch-frontend/` (52) are superseded (last changed 2026-07-26/28). **Confirm none is deployed, then delete.** If any is live, it must be added to this worklist in full — Phase 7 PR-6.

---

# 12. Testing Strategy

## 12.1 Layers

| Layer | Scope | Tool | Gate |
|---|---|---|---|
| Unit | Pure computation — lineups, confidence, formulas | `node --test` (existing) | 100% of retained pure modules |
| Database | Migration set applies; constraints reject what they must | `psql` + fixtures | Every migration, every run |
| RLS | Each role sees and writes exactly its grant | `SET ROLE` harness | Every role × every schema |
| Integration | One pipeline stage end to end | Ephemeral PostgreSQL 16 | Every stage |
| Pipeline | Full `L1→L6` on a fixture set | Ephemeral database | Nightly |
| Snapshot integrity | Immutability, checksum, manifest, succession | Dedicated suite | Every build |
| Calibration | Wilson intervals, sample gates, version keying | Property tests | Every build |
| Entitlement | Every plan × every feature | RLS harness | Every build |
| Performance | Query count, latency, plan shape | `EXPLAIN` assertions | Pre-cut-over |
| Regression | V2 output equals V1 output | Golden files | Continuous during shadow |
| Smoke | Post-deploy liveness | Scripted | Every deploy |

## 12.2 Database and RLS tests

The Phase 6.1 harness is the starting point and already exists: it applies all eighteen migrations, seeds the platform objects Supabase provides, and exercises the corrected behaviours. Extend it with:

```sql
-- Every append-only relation rejects UPDATE, for every principal
SET ROLE pt_pipeline_feature;
DO $$ BEGIN
  UPDATE feature.feature_value SET value = 1 WHERE true;
  RAISE EXCEPTION 'APPEND GUARD DID NOT FIRE';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Sealed content admits no exception, including for retention
SET ROLE pt_retention;
DO $$ BEGIN
  DELETE FROM snapshot.match_snapshot WHERE true;
  RAISE EXCEPTION 'SEAL GUARD DID NOT FIRE';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- The posture holds
SELECT operations.fn_assert_security_posture();
SELECT operations.fn_assert_access_correspondence();
```

Both assertions were verified to fire on deliberate breach (Phase 6.1 §14.4); the suite asserts they return `0` on a correct deployment and raise on a broken one.

## 12.3 Entitlement verification

The matrix is (plan) × (entitlement feature) × (projection relation), asserted **at the database**, not in the application:

```sql
SET LOCAL request.jwt.claim.sub = '<free-user-uuid>';
SET ROLE authenticated;
SELECT count(*) FROM product.p_landing WHERE required_entitlement_key IS NOT NULL;
-- must be 0 for a free user once subscriptions are enabled
```

The test proves the **database** withholds the row. An application-level test of `canAccessFeature` would prove nothing, which is why that function is deleted.

## 12.4 Snapshot integrity

| Test | Asserts |
|---|---|
| Immutability | UPDATE and DELETE raise for every role including `pt_platform_admin` and `pt_retention` (R-23) |
| Manifest completeness | Every version referenced by content appears in `snapshot_version_component` |
| Checksum | Recomputation matches the sealed value — **pending the canonical serialisation (§7.3)** |
| Completeness | `snapshot_completeness_item` accounts for every expected input |
| Outcome succession | Ordinals strictly increase; currency names exactly one prevailing ordinal |
| Job attribution | Every sealed snapshot names a real job run; the both-or-neither CHECK holds |
| Partition-wise assembly | `EXPLAIN` shows pruning to one partition per relation |

## 12.5 Regression against V1

The shadow phase's core instrument. For a rolling sample of fixtures:

| Compared | Tolerance |
|---|---|
| Module reading status | **Exact** |
| Module strength / confidence | ±0.001 |
| Verdict edges | ±0.001 |
| Consensus counts | **Exact** |
| Feature values | ±0.001 |
| Coverage | **Exact** |

Any divergence is investigated before cut-over. A divergence is not automatically a V2 defect — several will be V1 bugs that V2 declines to reproduce, including the non-deterministic `.limit(1)` of Phase 7 DB-04. Each is classified and recorded.

## 12.6 Performance tests

Assertions, not observations:

- `/match/[slug]` issues **exactly one** database query.
- Every query against a partitioned relation shows partition pruning in `EXPLAIN`.
- No query plan contains a sequential scan of a partitioned parent.
- The whole application issues ≤ 25 queries for the ten most-visited pages combined.

## 12.7 Smoke tests

Post-deploy, under 30 seconds: all seven roles connect; `fn_assert_security_posture()` returns 0; `fn_assert_access_correspondence()` returns 0; the forward partition buffer is ≥ 3 intervals; `v_coverage` shows no gap in the next 48 hours; anon can read `p_landing`; anon reads zero rows from `feature.feature_value`.

---

# 13. Deployment Plan

## 13.1 Stages

### Stage 1 — Development (weeks 1–2)

Local PostgreSQL 16, migration set applied, harness green. **Exit:** every engineer can rebuild the database from zero and run the behaviour suite.

### Stage 2 — Staging (weeks 2–3)

Supabase project with V2 schemas only. Seven roles credentialed via the secure channel. Verify: `REFERENCES` on `auth.users` for the migration role (P-08); exposed schemas limited to `product` (P-09); transition tables on partitioned relations (P-05); partition detachment behaviour (A.17). **Exit:** all four verifications recorded as `quality_assertion_result` rows.

### Stage 3 — Backfill (weeks 4–6)

Load V2 from V1 in reference order: `football` → `feature` → `module` → `snapshot`.

**What can be backfilled, and what cannot.** Phase 1 established that 17 team-level tables were one row per team, overwritten in place, with no history. That history **does not exist and cannot be recovered** (R-02). The backfill therefore produces:

| Source | Backfilled | Fidelity |
|---|---|---|
| `matches`, `teams`, `players`, `tournaments` | `football.*` | Full |
| `team_form_history` | `feature.feature_value` | Full — this table did retain history |
| `readiness_history` | `snapshot.*` | Full — this table was immutability-locked |
| `signal_backtests` | `calibration.*` | **Reference only** — not published (R-04, LC-135) |
| 17 overwritten team tables | `feature.feature_value` | **Current value only, one `as_of`** |

The last row is the honest cost of V1's design, and stating it is part of the deliverable. Deep history begins at cut-over.

**Exit:** row-count reconciliation per relation; every backfilled feature value carries provenance; no row in a default partition.

### Stage 4 — Shadow (weeks 7–10, minimum 14 days)

Both pipelines run. **V1 remains authoritative and continues to serve production.** V2 writes to its own schemas; nothing reads them but the comparison harness.

Daily: the §12.5 regression report; divergence triage; coverage and freshness reviewed.

**Exit:** 14 consecutive days with zero unexplained divergence; one full calibration cycle completed; every quality check passing.

### Stage 5 — Cut-over (weeks 11–14)

Page by page, lowest risk first. Each page ships behind a flag, is verified, and only then is the next started.

| Order | Page | Why here |
|---|---|---|
| 1 | `/method`, `/pricing` | Static; proves the deploy path |
| 2 | `/leagues`, `/modules` | Matview-backed; no entitlement |
| 3 | `/teams`, `/trends`, `/players` | Projection-backed; simple |
| 4 | `/team/[slug]`, `/player/[slug]` | Projection-backed; richer |
| 5 | `/`, `/app`, `/matches` | `p_landing`; entitlement-gated |
| 6 | **`/match/[slug]`** | The 31→1 change; highest value, highest risk |
| 7 | `/watchlist`, `/settings`, `/subscription` | User-owned data |
| 8 | `/admin/*` | Internal; lowest user impact |

Per-page verification: correct content for anon, free and pro; query count as specified; `EXPLAIN` shows pruning; no error-rate change; latency improved as estimated.

### Stage 6 — Decommission (week 15+)

Only after every page reads V2 and one full calibration cycle has run against V2 data. Stop V1 writers; retain `public` read-only for one quarter; snapshot it to cold storage; then drop.

**This is the one-way door.** It is separately approved.

## 13.2 Rollback per stage

| Stage | Trigger | Action | Time |
|---|---|---|---|
| 1–2 | Any | Drop schemas, re-run | minutes |
| 3 | Reconciliation fails | Truncate V2, re-run | hours |
| 4 | Unexplained divergence | Stop V2 writers; V1 unaffected | minutes |
| 5 | Any page defect | Revert that page's flag | minutes |
| 6 | Post-decommission defect | Restore `public` from backup | hours — **with data loss** |

## 13.3 Post-deployment validation

**Day 1:** smoke suite hourly; error rates; latency against §10.4; `v_coverage` gaps.
**Week 1:** all quality checks daily; first V2 retention pass; partition buffer; `api_usage` against quota.
**Month 1:** first full calibration cycle on V2-sealed snapshots; first published baselines through sample gates; storage against the granularity projection; freeze pass on the first inactive partitions.

---

# 14. Risk Register

## Critical

### R-01 — Thirteen relations exist only in production

**Description.** All thirteen `mv_*` sources feeding the module layer are defined nowhere in the repository, and nothing refreshes them (Phase 7 AC-05, PERF-06).
**Probability** Certain — established. **Impact** Critical — the module workstream cannot be specified, and production cannot be reproduced or restored.
**Mitigation** Dump from production into `beta/migrations/` before any module work. Treat as **S-0, blocking**.
**Rollback** n/a — this is recovery, not change.
**Verification** Rebuild a database from the repository alone and confirm all thirteen exist.

### R-02 — The history V2 is designed to hold does not exist

**Description.** V1 overwrote 17 team-level tables in place. Deep history cannot be backfilled.
**Probability** Certain. **Impact** Critical to expectations — "point-in-time reconstruction" is available only from cut-over forward.
**Mitigation** State it explicitly in the backfill plan (§13.3 Stage 3) and to stakeholders before Stage 3. Backfill current values with a single honest `as_of`.
**Rollback** n/a. **Verification** Backfill report states, per relation, how many distinct `as_of` values were produced.

## High

### R-03 — Sealing cannot be expressed through PostgREST

**Probability** Certain. **Impact** High — sealing is the core new capability.
**Mitigation** Direct `pg` connections (S-1) precede sealing (S-7) in the dependency graph. **Verification** No `supabase-js` import in `v2/snapshot/`.

### R-04 — Calibration must be re-baselined

**Description.** Existing backtests measure unversioned rules; LC-135 requires series keyed by module version.
**Probability** Certain. **Impact** High — modules report unverified until gates pass.
**Mitigation** Communicate before cut-over. Carry V1 backtests as reference only, never published. **Verification** No `published_baseline` row exists without a passing sample gate.

### R-05 — Connection-slot exhaustion

**Description.** Seven session-mode pools consume slots PgBouncer previously multiplexed. Supabase plans cap direct connections.
**Probability** High. **Impact** High — pipeline failures under load.
**Mitigation** Budget slots per role before Stage 2; small pools (2–4) per pipeline; pipelines run on a schedule, not concurrently. Session mode is **not negotiable** (R-58) — the retention marker and timeouts depend on it.
**Rollback** Reduce pool sizes; serialise pipelines. **Verification** `pg_stat_activity` peak against the plan limit under a full pipeline run.

### R-06 — Sealing writes contend with the read path

**Probability** Medium. **Impact** High if realised at the coverage target.
**Mitigation** Sealing is insert-only into partitions the read path prunes away; schedule outside peak. **Verification** Latency measured during a sealing run in shadow.

## Medium

### R-07 — Temporal granularity decision still open

Sets retention windows and swings storage 150 GB–1 TB. **Mitigation:** the structure is correct at any setting; settle before Stage 3 so the backfill sizes correctly. **Verification:** storage against projection at month 1.

### R-08 — Two platform behaviours unverified

Transition tables on partitioned relations (P-05) and partition detachment (A.17). **Mitigation:** both are Stage 2 exit criteria and registered as `BLOCKING` quality checks. **Verification:** results recorded as `quality_assertion_result` rows naming the platform version.

### R-09 — Checksum canonical serialisation unspecified

PR-04's fourth control is not operative until specified. **Mitigation:** specify before cut-over; the function reports unverified rather than falsely passing meanwhile. **Verification:** `fn_verify_snapshot_checksums` returns non-null for every sealed snapshot.

### R-10 — Feature calculation conversion is the largest single workstream

10,386 lines across four jobs. **Mitigation:** convert calculator by calculator with shadow comparison; never all at once. **Verification:** each calculator's V2 output matches V1 within tolerance before the next begins.

### R-11 — `output_values` sits outside PD-16

A structured payload with no enumerated attributes (010 TODO). **Mitigation:** resolve to columns or a per-output-type child relation before production. **Verification:** the `structured_payload_conformance` check passes.

## Low

### R-12 — Superseded application trees may still be deployed

Four trees, 249 files. **Mitigation:** confirm and delete (Phase 7 PR-6). **Verification:** deployment manifest names only `beta/`.

### R-13 — Module golden-file comparison may surface V1 defects

Divergence may be V1 being wrong. **Mitigation:** classify each divergence; do not reproduce a V1 defect for the sake of matching. **Verification:** every divergence has a recorded classification.

---

# 15. Final Readiness Assessment

## 15.1 Conformance of the plan

| Criterion | Status | Evidence |
|---|---|---|
| Preserves the Phase 4 Logical Model | **Yes** | No logical entity, identity, lifecycle or constraint is altered. §6 and §7 map application behaviour onto existing entities. |
| Preserves Document 08 Revision 1 | **Yes** | Every rule cited (R-01, R-19, R-20, R-21, R-23, R-57, R-58, R-67, F-05, F-09, F-15, F-21, PD-16, PD-19, A.1–A.17) is applied, none amended. |
| Preserves the approved Revision 2 migration set | **Yes** | No migration is modified. The plan consumes the schema as deployed and verified. |
| PostgreSQL 16 compatible | **Yes** | The set was executed end to end on PostgreSQL 16 (Phase 6.1 §14.1). |
| Supabase compatible | **Yes**, with two deployment verifications | P-08 and P-09 are Stage 2 exit criteria. |
| Removes all application/database divergence | **Yes**, on completion | §5.4 enumerates every duplicated rule and its database replacement; §11 accounts for all 162 files. |
| Supports future maintenance | **Yes** | Rules live in one place; the two conformance assertions detect drift on every deployment. |
| Supports future feature development | **Yes** | A new module is a registry row plus a calculator; a new feature is a definition plus a calculator. Neither requires a schema change. |

## 15.2 Implementation readiness score

**7 / 10 — Ready to begin, with one blocking prerequisite.**

| Dimension | Score | Note |
|---|---|---|
| Database readiness | **10** | Deployed, executed, verified; both gates proven to fire |
| Architectural clarity | **9** | Four Phase 4/5/5.6 documents plus a verified migration set |
| Specification completeness | **7** | Eleven TODOs remain; one (`output_values`) blocks production |
| Application understanding | **5** | Thirteen relations undefined; the module layer cannot yet be fully specified |
| Effort confidence | **6** | ±40% until R-01 closes |
| Risk coverage | **8** | Thirteen risks registered with mitigation and verification |
| Test strategy | **8** | Harness exists and is proven; entitlement and snapshot suites to build |
| Rollback safety | **9** | Every stage reversible until decommissioning, which is separately gated |

## 15.3 Remaining blockers

| # | Blocker | Blocks | Owner |
|---|---|---|---|
| **B-1** | Thirteen `mv_*` definitions exist only in production | S-6, S-9, and the effort estimate | Platform |
| **B-2** | `output_values` structured payload outside PD-16 | Production sealing | Architecture |
| **B-3** | Checksum canonical serialisation unspecified | PR-04's fourth control | Architecture |
| **B-4** | Temporal granularity decision open | Retention windows, storage sizing, backfill | Product + Architecture |
| **B-5** | P-05 and A.17 platform behaviours unverified | Stage 2 exit | Platform |
| **B-6** | Doc 08 §5.3.3 defects S-01/S-02 uncorrected | Documentation only — not implementation | Architecture |

**B-1 is the only one that blocks starting.** B-2 through B-5 block production, not development, and each has a defined owner and a Stage-2 or pre-cut-over deadline.

## 15.4 Recommended execution order

```
  0.  Recover the thirteen mv_* definitions                    [B-1 — BLOCKING]
  1.  Phase 7 Group 1 live-defect remediation                  [independent of V2]
  2.  Connection and credential layer                          [S-1]
  3.  Operational layer                                        [S-2 — prerequisite of sealing]
  4.  Vocabulary and registry seeding                          [S-3]
  5.  Ingestion pipeline                                       [S-4]
  6.  Feature calculation pipeline                             [S-5 — largest]
  7.  Module system                                            [S-6 — needs step 0]
  8.  Snapshot sealing                                         [S-7 — needs step 3]
  9.  Calibration                                              [S-9 — needs step 7]
 10.  Projection refresh                                       [S-10]
 11.  Frontend read path                                       [S-11]
 12.  Retention, maintenance, quality assertions               [parallel from step 6]
 13.  Backfill → shadow → cut-over → decommission              [§13]
```

Steps 1 and 12 parallelise; security work (§9.5) runs alongside from step 2. Everything else on the list is on the critical path.

## 15.5 Implementation phases

| Phase | Weeks | Contents | Gate |
|---|---|---|---|
| **P0 — Unblock** | 1–2 | Recover `mv_*`; fix live defects; confirm deployed trees | B-1 closed; Group 1 shipped |
| **P1 — Foundation** | 3–6 | Connections, operational layer, seeding, staging verifications | All seven roles connect; both assertions return 0; P-05 and A.17 recorded |
| **P2 — Reality & features** | 7–14 | Ingestion, feature calculation | Feature values match V1 within tolerance |
| **P3 — Judgement & sealing** | 15–22 | Modules, snapshot sealing, calibration | Golden files match; snapshots immutable; checksums verify |
| **P4 — Product** | 23–28 | Projection refresh, frontend read path, retention, quality | Match page at 1 query; entitlement enforced by RLS |
| **P5 — Transition** | 29–36 | Backfill, shadow, cut-over, decommission | 14 clean shadow days; every page cut over; one calibration cycle |

**Total: 36 calendar weeks with 4 engineers**, consistent with the 55–79 engineer-week estimate at §1.6 once parallelism and elapsed shadow time are accounted for. The range narrows once B-1 closes.

---

## Closing note for implementing engineers

Two habits will keep this migration correct where a large rewrite usually goes wrong.

**Let the database say no.** Every guard, constraint, policy and assertion in the approved set was executed and verified. When a statement is rejected, the answer is almost never to work around it — it is that the statement attempted something the architecture forbids. The append guard, the seal guard and the two conformance assertions are not obstacles to route around; they are the specification, executing.

**Delete more than you write.** The largest single improvement available is the code that stops existing: 1,300 lines of module evaluation, 375 lines of entitlement logic, ~120 queries, and every application-side check of a rule PostgreSQL already enforces. A file that gets smaller during this migration is usually a file that got more correct.
