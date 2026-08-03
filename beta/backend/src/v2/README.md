# PitchTerminal V2 — backend

Implementation of the V2 application against the approved database architecture, built **alongside** V1 per the strangler strategy of Phase 8 §1.3.

**Status: S-1 and S-2 complete, all S-2 findings closed.** Nothing beyond S-2 is implemented.

## What exists

| Path | Subsystem | Purpose |
|---|---|---|
| `config/index.ts` | S-1 | V2 environment configuration, validated and fail-fast |
| `db/roles.ts` | S-1 | The seven pipeline roles, their capabilities, and lookup helpers |
| `db/pool.ts` | S-1 | One session-mode PostgreSQL pool per role, health checks, graceful shutdown |
| `db/tx.ts` | S-1 | `withRun` / `withConnection` / `withSession` / `withSavepoint`, job lifecycle seam |
| `db/index.ts` | S-1 | Public surface — import from here, not from the modules |
| `db/*.test.ts` | S-1 | Connection, permission, transaction and session-persistence suites |

## V1 is untouched

Not one V1 source file is modified. `src/db/client.ts` and its `supabase-js` client keep working exactly as before; `src/config/index.ts` is not extended, so no existing deployment gains a new required variable. The only changes outside this directory are two additions to `package.json`: `pg` and `@types/pg`.

## Rules every caller must know

**1. All SQL must be schema-qualified.** Sessions run with `search_path = ''` (§5.3.4). `SELECT … FROM feature_value` will not resolve; `FROM feature.feature_value` will.

**2. Session mode, port 5432.** Not the transaction pooler. R-58 requires it because the retention marker (R-21) and the timeouts (A.15) are session-scoped. Configuration refuses port 6543 outright, because a pooled connection does not fail loudly — retention would delete nothing and report success.

**3. A constraint violation is never retried.** It means the application attempted something the architecture forbids. `withRun` lets it propagate; §8.2 is explicit that retrying repeats it.

**4. Anything referencing a job run must call `requireJobRun()`.** `snapshot.match_snapshot` pairs compositely on `(pipeline_job_run_id, pipeline_job_run_occurred_at)` and the both-or-neither CHECK rejects a partial reference (P-04). With S-2 installed this now returns a real attribution; without `installOperationalLayer()` it still fails with a message naming the missing call.

**5. ER-01 — timestamp precision.** Any timestamp participating in a **composite key**, a **foreign key** or a **partition key** must either (a) originate from an application-controlled value, or (b) remain serialised without JavaScript `Date` conversion. **Never** `database timestamptz → JS Date → database key comparison`. PostgreSQL stores microseconds; a JS `Date` carries milliseconds, so the round trip truncates and the key matches nothing. Supply the instant from the application — `operations/run.ts:operationalNow()`. This binds every later subsystem, **S-7 above all**, whose sealing writes carry the job run's instant into `snapshot.match_snapshot` under P-04.

**7. Terminal state is appended, never updated.** `operations.pipeline_run` and `pipeline_job_run` stay `RUNNING` for ever — that is their immutable initial state. Outcome and duration live in `pipeline_run_completion` / `pipeline_job_run_completion` under ordinal succession (migration 019, the A.2 pattern). Read current state from `operations.v_pipeline_run_current`.

**6. Connection arithmetic.** An attributed run holds **two** connections at steady state (control + work). N concurrent pipelines need 2N. The pipeline-run connection is acquired only to open and to close, deliberately — holding it for the body cost three per pipeline and deadlocked against the small pools of R-05.

## Environment variables

Connection parameters are required; credentials are not. A process holds only the secrets for the roles it uses — `assertRolesConfigured()` at startup turns an absent one into a clear failure before any work begins.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PT_V2_DB_HOST` | yes | — | |
| `PT_V2_DB_NAME` | yes | — | |
| `PT_V2_DB_PORT` | no | `5432` | 6543 is refused; see rule 2 |
| `PT_V2_DB_SSL` | no | `true` | `false` only for a local database |
| `PT_V2_DB_CONNECT_TIMEOUT_MS` | no | `10000` | |
| `PT_V2_DB_IDLE_TIMEOUT_MS` | no | `30000` | |
| `PT_V2_ALLOW_NON_SESSION_PORT` | no | `false` | Local/CI only. Never in a deployed environment |
| `PT_V2_APP_NAME` | no | `pitchterminal-v2` | Prefix for `application_name` |
| `PT_V2_DB_PASSWORD_INGESTION` | per role | — | `pt_pipeline_ingestion` |
| `PT_V2_DB_PASSWORD_FEATURE` | per role | — | `pt_pipeline_feature` |
| `PT_V2_DB_PASSWORD_MODULE` | per role | — | `pt_pipeline_module` |
| `PT_V2_DB_PASSWORD_CALIBRATION` | per role | — | `pt_pipeline_calibration` |
| `PT_V2_DB_PASSWORD_PROJECTION` | per role | — | `pt_pipeline_projection` |
| `PT_V2_DB_PASSWORD_RETENTION` | per role | — | `pt_retention` |
| `PT_V2_DB_PASSWORD_ADMIN` | per role | — | `pt_platform_admin` |
| `PT_V2_POOL_MAX_<SUFFIX>` | no | per role | Override after the §13 Stage 2 slot budget |

Role **names** are never configurable. The architecture names them, migration 016 attaches grants to them, and the conformance assertions look for them by name. A deployment able to rename a role could point the application at one the grants do not describe.

## Usage

```ts
import { withRun, withSession, requireJobRun, assertRolesConfigured } from './v2/db';

// Once, at process start.
assertRolesConfigured(['pt_pipeline_module']);

// A transactional, attributed unit of work.
await withRun('pt_pipeline_module', 'snapshot.seal', async (tx, job) => {
  const attribution = requireJobRun(job, 'Sealing a match snapshot');
  await tx.query(
    `INSERT INTO snapshot.match_snapshot
       (fixture_id, fixture_partition_on, snapshot_point_code, snapshot_as_of, sealed_at,
        pipeline_job_run_id, pipeline_job_run_occurred_at)
     VALUES ($1, $2, $3, now(), now(), $4, $5)`,
    [fixtureId, partitionOn, point, attribution.id, attribution.occurredAt]
  );
  // …manifest, feature states, module readings, verdict, completeness…
  // All of it commits together, or none of it does.
});

// Retention: one session, no transaction — the marker of R-21 is session-scoped.
await withSession('pt_retention', async (session) => {
  const { rows } = await session.query('SELECT operations.fn_run_retention() AS removed');
  return Number(rows[0].removed);
});
```

## Architectural decisions

**One pool per role, not one pool with `SET ROLE`.** `SET ROLE` is reversible: any code holding that pool can `RESET ROLE` and recover the underlying login's full privileges. The separation of §B.7.1 would then hold only as long as nobody made a mistake. Seven authenticated logins make the boundary structural.

**Two connections per attributed run.** The job lifecycle runs on its own connection, outside the work transaction. The illustrative sketch in Phase 8 §3.1 opens the job run *inside* the transaction, and implementing it exposed a flaw: the sketch's own justification for a separate failure connection — "a failure recorded inside the rolled-back transaction disappears with it" — applies identically to the job run. Opened inside, a failed run rolls back its own record, and the runs most worth recording are the ones leaving no trace. The composite foreign key still resolves, because the job run is committed before the work transaction references it. The cost is one extra connection per run, which is why `withRun` refuses a pool sized below two rather than self-deadlocking.

**`search_path` and `timezone` pinned as connection startup options.** Not as a `SET` after connect. The first implementation used a pool `connect` handler, and the test caught it as a race: `pg` emits `connect` without awaiting the handler, so a caller could receive the client and query before the `SET` landed. A path pinned only *usually* is worse than one never pinned, because it fails intermittently. The startup option is applied by the server before any query can be issued and costs no round trip.

**Pool maxima are deliberately small** (20 across all seven). Session-mode connections are not multiplexed, and Phase 8 R-05 registers slot exhaustion as a High risk. Pools are created lazily, so a process using two roles holds two pools.

## Findings for the architecture owner

Two gaps in **migration 001**, both found by the health check in `pool.test.ts` running against a deployed database. Neither is fixed here — S-1 may not change the approved schema — and both are closed client-side for the application.

| # | Finding | Effect | Client-side mitigation |
|---|---|---|---|
| **F-1** | `ALTER ROLE … SET search_path = ''` is applied to the five pipeline roles and `pt_retention`, but **not** to `pt_platform_admin`. That role reports `"$user", public`. | Contrary to §5.3.4, which states the rule without exception. An unqualified reference in administrative code would resolve against `public` — where the entire V1 schema still lives during the shadow phase. | `-c search_path=` startup option |
| **F-2** | `ALTER ROLE … SET timezone = 'UTC'` is likewise applied to six roles but **not** to `pt_platform_admin`, which reports the cluster default `Etc/UTC`. | Benign as long as the cluster default is UTC, and silently wrong the moment it is not — PD-08 requires every pipeline session in UTC, and a session in local time shifts every `date_trunc` and every partition key derived from it. | `-c timezone=UTC` startup option |

Both are one-line additions to migration 001 and should be raised through the schema-change process, not patched here.

A third item, not a defect: `roles.ts` originally recorded `pt_platform_admin` as holding `SELECT` only on `operations`. The permission suite failed on its first run against a real database because migration 018 grants that role `SELECT, INSERT, UPDATE` on `operations.retention_policy` through `fn_apply_access`. The register was wrong and the database was right — which is exactly what that test exists to establish.

## Testing

```bash
# Unit and configuration tests only — no database needed.
npm test

# Full suite, including permissions, transactions and session persistence.
export PT_V2_DB_HOST=127.0.0.1 PT_V2_DB_NAME=ptv2 PT_V2_DB_SSL=false
export PT_V2_DB_PASSWORD_INGESTION=... # etc, per role
npm test
```

The integration suites **skip** rather than fail when no V2 database is configured, so V2 work never blocks V1 work. `assertCiHasDatabase()` fails the run when `CI` is set and no database is present, because a skipped suite is not a passing suite (§12.1).

Verified against PostgreSQL 16 with the full migration set applied: **130 tests, 130 passing** (64 without a database, with the integration suites skipping). All seven roles connect, both conformance assertions return 0, and operational history is proven to survive rollback of the work it describes.

## S-2 — Operational layer

Install once, at process start, before any `withRun()`:

```ts
import { installOperationalLayer, withPipelineRun } from './v2/operations';

installOperationalLayer();

await withPipelineRun('pt_pipeline_ingestion', 'nightly.ingest', async () => {
  await withRun('pt_pipeline_ingestion', 'ingest.fixtures', async (tx, job) => {
    const attribution = requireJobRun(job, 'Ingesting fixtures');
    // …work, all in one transaction…
  });
});
```

After installation `withRun` opens a `pipeline_run` (or joins the ambient one),
opens a `pipeline_job_run`, executes the business transaction, and records the
outcome — with the lifecycle on a connection that survives a rollback of the work
it describes. **S-1's public contract is unchanged.**

Five migration findings were produced while implementing S-2
([document 16](../../../../docs/db-v2/16-phase8-s2-migration-findings.md)) and
**all five are now closed**
([document 17](../../../../docs/db-v2/17-phase8-s2-resolution.md)):

- **M-1** — resolved by migration `019`, Correction B. Terminal state is appended
  to `pipeline_run_completion` / `pipeline_job_run_completion` under ordinal
  succession, the pattern A.2 already established for snapshot outcomes. No guard
  weakened, no `UPDATE` granted, `RUNNING` remains the immutable initial state.
- **M-2** — resolved by migration `019`. `pt_platform_admin` holds `INSERT` on
  `operations.failure_resolution`, and `INSERT` alone.
- **M-3, M-4, M-5** — closed as documentation clarifications; no schema change.

## Next: S-3 — Vocabulary & registry seeding

Not started. S-2 is complete and nothing beyond it has been implemented.
