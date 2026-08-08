# V2 Migration Set — Supabase Compatibility Audit

**Scope:** `v2/migrations/001`–`020`
**Target under audit:** PostgreSQL 16 on Supabase (managed)
**Method:** static analysis plus **full empirical execution** against a PostgreSQL 16.13 cluster configured to emulate Supabase's role model
**Status:** audit only — no migration file has been modified

---

## 1. Verdict

The reported failure is real, but its diagnosis is wrong in a way that changes the entire remediation plan.

> `ERROR: must be able to SET ROLE "pt_owner"`

This is **not** a superuser requirement. It is a PostgreSQL **16** behaviour change in how `CREATEROLE` principals are granted membership in roles they create. Supabase's `postgres` role has every privilege this migration set actually needs.

**With one line added to migration 001, the complete set 001–020 applies successfully on a non-superuser principal, and both of V2's own conformance gates pass.** That was executed, not estimated.

| Question | Answer |
|---|---|
| Was V2 designed for vanilla PostgreSQL? | **No.** It is already Supabase-targeted — and it cannot run on vanilla PostgreSQL as written. |
| Does it require superuser? | **No.** It requires `CREATEROLE`, which Supabase grants. |
| Can it run on Supabase? | **Yes**, after four fixes, three of which are one-liners. |
| Should the security model be adapted, or should V2 move to self-managed? | **Adapt.** Stay on Supabase. |

The one finding that genuinely needs a design decision is unrelated to privileges: an `ON DELETE CASCADE` from `auth.users` collides with an append-only trigger and makes **Supabase user deletion permanently fail** (§6, C-1).

---

## 2. How this was verified

A PostgreSQL 16.13 cluster was built and seeded to match a new Supabase project:

- `postgres` created as **`NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS`** — the role a Supabase customer actually connects as
- granted `anon`, `authenticated`, `service_role`, `authenticator`, `pg_read_all_data`, `pg_write_all_data`, `pg_monitor`, `pg_signal_backend`
- `auth` schema owned by `supabase_auth_admin`, containing `auth.uid()` and `auth.users`
- `extensions` schema with `pgcrypto` and `pg_stat_statements` pre-installed

All twenty migrations were then applied **as `postgres`**, each inside a single transaction, in the documented order.

Two deviations from the shipped files were required, and only two:

1. `SET createrole_self_grant = 'set, inherit';` prepended to 001 — **the fix under test**
2. `CREATE EXTENSION pg_cron` commented out — the audit container has no pg_cron binary. This is a container limitation, not a Supabase one, but pg_cron has a separate real problem on Supabase (§6, B-2).

Everything below labelled **[verified]** was executed. Items labelled **[analysis]** could not be executed in this container and are reasoned from documented platform behaviour; they are called out individually rather than blended in.

---

## 3. Root cause of the reported error

**[verified]**

PostgreSQL 16 changed `CREATEROLE`. When a non-superuser `CREATEROLE` principal creates a role, it is auto-granted membership — but the `INHERIT` and `SET` options of that membership are governed by the `createrole_self_grant` GUC, which **defaults to empty**.

Observed immediately after `CREATE ROLE pt_owner` as Supabase's `postgres`:

```
   role   |  member  | admin_option | inherit_option | set_option
----------+----------+--------------+----------------+------------
 pt_owner | postgres | t            | f              | f
```

`admin_option` is true; `set_option` is **false**. PostgreSQL 16 gates both `CREATE SCHEMA … AUTHORIZATION` and `ALTER … OWNER TO` behind `check_can_set_role`, so:

```
postgres=> SET ROLE pt_owner;
ERROR:  permission denied to set role "pt_owner"

postgres=> CREATE SCHEMA probe AUTHORIZATION pt_owner;
ERROR:  must be able to SET ROLE "pt_owner"
```

Migration 001 line 159 (`CREATE SCHEMA IF NOT EXISTS football AUTHORIZATION pt_owner`) is the first statement to hit it. That is the exact error and the exact line reported.

**The same migration on PostgreSQL 15 or on any superuser connection would have succeeded.** The failure is a PG16 + `CREATEROLE` interaction, not a Supabase capability gap. Self-managed PostgreSQL 16 would hit it too if migrations were run as a non-superuser owner — so "move to self-managed" does not, by itself, fix this.

Both remedies were tested and both work **without superuser**:

```sql
-- Option A (recommended) — one line at the top of 001
SET createrole_self_grant = 'set, inherit';

-- Option B — explicit, after each CREATE ROLE; valid because the creator holds ADMIN OPTION
GRANT pt_owner TO current_user WITH INHERIT TRUE, SET TRUE;
```

---

## 4. Q1 — Was V2 designed for vanilla PostgreSQL?

**No. V2 is already a Supabase-targeted design.** It is a *hybrid*: Supabase-native in its authentication and end-user access layer, vanilla-PostgreSQL-native in its ownership and role-provisioning layer. The two halves were never reconciled, and the reported error is where they meet.

Evidence that V2 targets Supabase — none of this works on stock PostgreSQL:

| Supabase dependency | Location |
|---|---|
| `auth.uid()` in six RLS policy predicates | `016:373-379`, `017:216,249` |
| `FOREIGN KEY … REFERENCES auth.users (id)` — four constraints | `011:71,120,153,172` |
| Grants and policies for `anon` / `authenticated` | `016:303-304,364-379,462,468,498,510`, `017:213-262` |
| `-- Platform: PostgreSQL 16 on Supabase` | `001:6` |
| `-- Target: PostgreSQL 16 on Supabase` | `README.md:6` |

**Critically, `anon` and `authenticated` are never created by any migration** — the only `CREATE ROLE` statements in the set are the three in `001` that create the nine `pt_*` roles. `016` grants to `anon`/`authenticated` as pre-existing platform roles. That is a Supabase assumption baked into the security layer.

So the premise inverts: rather than V2 being a vanilla design that stumbled on Supabase, **V2 cannot be deployed on vanilla PostgreSQL without a compatibility shim** that creates `anon`, `authenticated`, `service_role`, an `auth` schema, an `auth.users` table, and a JWT-backed `auth.uid()`. Self-managed is the *more* invasive path, not the safer one. This is decisive for Q5.

What is genuinely vanilla-flavoured is narrower than it appears — the ownership model (`D-15`, "every object owned by `pt_owner`"). And that model is not actually incompatible with Supabase; it simply needs PG16's self-grant setting.

---

## 5. Q2 — Per-migration dependency matrix

**[verified]** Counts are from the shipped files; the outcome column is from the executed run.

| # | `CREATE ROLE` | `GRANT` role | `ALTER ROLE` | `OWNER TO` | `CREATE EXTENSION` | Supabase refs | Needs superuser? | Ran as non-superuser |
|---|---|---|---|---|---|---|---|---|
| 001 | **3** | **1** | **22** | 0 | **4** | 1 | **No** — `CREATEROLE` suffices | ✅ *(with the one-line fix)* |
| 002 | 0 | 0 | 0 | 1 | 0 | 0 | No | ✅ |
| 003 | 0 | 0 | 0 | 11 | 0 | 0 | No | ✅ |
| 004 | 0 | 0 | 0 | 1 | 0 | 0 | No | ✅ |
| 005 | 0 | 0 | 0 | 5 | 0 | 0 | No | ✅ |
| 006 | 0 | 0 | 0 | 5 | 0 | 0 | No | ✅ |
| 007 | 0 | 0 | 0 | 4 | 0 | 0 | No | ✅ |
| 008 | 0 | 0 | 0 | 7 | 0 | 0 | No | ✅ |
| 009 | 0 | 0 | 0 | 1 | 0 | 0 | No | ✅ |
| 010 | 0 | 0 | 0 | 3 | 0 | 0 | No | ✅ |
| 011 | 0 | 0 | 0 | 2 | 0 | **4** | No | ✅ *(needs `auth.users`)* |
| 012 | 0 | 0 | 0 | 3 | 0 | 0 | No | ✅ |
| 013 | 0 | 0 | 0 | 0 | 0 | 0 | No | ✅ |
| 014 | 0 | 0 | 0 | 1 | 0 | 0 | No | ✅ |
| 015 | 0 | 0 | 0 | 5 | 0 | 0 | No | ✅ |
| 016 | 0 | 0 | 0 | 4 | 0 | **19** | No | ✅ |
| 017 | 0 | 0 | 0 | 8 | 0 | **8** | No | ✅ |
| 018 | 0 | 0 | 0 | 12 | 0 | 0 | No | ✅ |
| 019 | 0 | 0 | 0 | 7 | 0 | 0 | No | ✅ |
| 020 | 0 | 0 | 0 | 0 | 0 | 0 | No | ✅ |

**`SET ROLE` appears in zero migrations.** The error message mentions it only because PG16 phrases the ownership-transfer permission check in those terms. There is no explicit `SET ROLE`, no `ALTER SYSTEM`, no `CREATE TABLESPACE`, no `CREATE PUBLICATION`/`SUBSCRIPTION`, no event trigger, no untrusted procedural language, and no `pg_authid`/`pg_shadow` access anywhere in the set.

**Every one of the 80 `ALTER … OWNER TO pt_owner` statements across migrations 002–019 is the same single root cause as 001.** They are not 80 problems. Fix the membership once in 001 and all 80 succeed — verified.

Ownership after the full run:

```
  owner   | relkind | count
----------+---------+-------
 postgres | r       |     1     <-- defect, see D-1
 pt_owner | S       |    87
 pt_owner | m       |     2
 pt_owner | p       |    34
 pt_owner | r       |  1675
 pt_owner | v       |     6
```

---

## 6. Q3 — What cannot work on Supabase as written

Four items. Only two block deployment.

### B-1 — `CREATE SCHEMA … AUTHORIZATION` / `ALTER … OWNER TO` (blocking) **[verified]**
Root cause in §3. **Fix: one line.** Everything downstream of it is collateral.

### B-2 — `CREATE EXTENSION pg_cron SCHEMA extensions` — `001:49` (blocking) **[analysis]**
Three independent problems on Supabase:
- pg_cron requires `shared_preload_libraries`, which is not customer-settable; it must be enabled from the dashboard.
- pg_cron's control file is **non-relocatable with a fixed schema of `cron`**. `SCHEMA extensions` is expected to be rejected outright — `IF NOT EXISTS` does not rescue it, because the extension does not yet exist and the schema clause is still honoured.
- pg_cron runs only in the `postgres` database.

**This extension is entirely unused.** Every `cron.schedule` call in `018:628-631` is commented out, and the file explicitly routes the freeze pass through an external non-transactional job instead. The dependency can be dropped from 001 with no loss of function.

Not verified here only because the container lacks the pg_cron binary; the schema constraint follows from the extension's own control file.

### B-3 — `product.subscription` → `auth.users` `ON DELETE RESTRICT` — `011:71` (operational) **[verified]**
Deleting a Supabase auth user fails whenever that user holds a subscription row. `auth.admin.deleteUser()` and the Studio delete button both surface this as an opaque foreign-key error.

### C-1 — `auth.users` CASCADE collides with the append-only guard (**blocking, and the one real design conflict**) **[verified]**

`product.notification_intent` carries `ON DELETE CASCADE` from `auth.users` (`011:172`) *and* the append-only guard from `015:110`, which raises unconditionally on `DELETE`. The two are mutually exclusive. Executed:

```
ERROR:  append-only relation: DELETE attempted on product.notification_intent_p202608
        by role pt_owner without the retention marker
CONTEXT: PL/pgSQL function feature.tf_append_only__guard() line 16 at RAISE
SQL statement "DELETE FROM "product"."notification_intent" WHERE $1 = "user_id""
```

**Once a user has a single notification intent, that Supabase account can never be deleted.** This breaks the Auth admin API, the Studio user-management UI, and any right-to-erasure workflow.

It is not fixable by privilege. The cascade executes as whichever principal deletes the auth user — `supabase_auth_admin` — which is not `pt_retention` and cannot set the retention marker, so the guard's own exception path is unreachable. This needs a design decision (§7, step 4), not a permission grant.

`watchlist` and `user_preference` also cascade but carry no append guard, so they delete cleanly — verified.

### Non-issues, checked and cleared **[verified]**
- `pg_stat_statements`, `pgcrypto`, `btree_gist` — all installable or pre-present; `IF NOT EXISTS` handles the pre-installed cases.
- All 22 `ALTER ROLE … SET` statements in 001 — succeed under `CREATEROLE`.
- `CREATE SCHEMA IF NOT EXISTS extensions` — succeeds; `postgres` holds `CREATE` on the database.
- No `VACUUM` or `CREATE INDEX CONCURRENTLY` inside any transactional migration; `017` correctly uses only `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which is transaction-legal.

---

## 7. Q4 — Required changes

### Does the security model survive? Mostly yes — verified, not assumed.

After the full run on the Supabase role model:

| Guarantee | Result |
|---|---|
| `fn_assert_access_correspondence()` | **passes** (0) |
| `fn_assert_security_posture()` | **passes** (0) |
| RLS enabled **and** forced | **107 / 107** base relations |
| No `UPDATE`/`DELETE` on `snapshot` (R-69, R-23) | **holds** — `(none)` |
| Cross-layer isolation | **holds** — `pt_pipeline_ingestion` writing to `feature` → `permission denied for schema feature` |
| Pipeline writes its own layer | **works** |
| `anon` reads `football`, denied `feature` | **works** |
| Retention marker path (R-20/21/22) | **works** |

The design's decision to place everything in seven private schemas rather than `public` is what carries it. Because `USAGE` is revoked and never granted to `service_role`, the Supabase service key **cannot reach the design schemas at all** — verified: `SET ROLE service_role; SELECT … FROM snapshot.match_snapshot` → `permission denied for schema snapshot`. Supabase's default `public`-schema grants never apply.

### S-1 — `BYPASSRLS` voids `FORCE ROW LEVEL SECURITY` (security) **[verified]**

`016:109-122` reasons carefully about `BYPASSRLS` and rejects it as a fix, but never checks whether the platform already hands it out. Supabase does — to two roles:

```
   rolname     | rolsuper | rolbypassrls
---------------+----------+--------------
 service_role  | f        | t
 postgres      | f        | t
```

`postgres` additionally holds `pg_read_all_data`. Combined:

```
 postgres_can_select_sealed | postgres_can_select_subs
----------------------------+--------------------------
 t                          | t
```

`postgres` reads every sealed snapshot row and every subscription row, and **`fn_assert_security_posture()` returns 0 — it passes.** The assertion never examines `rolbypassrls`, so V2's headline conformance gate certifies a posture that does not hold.

This is the gap between "F-09 is enforced" and "F-09 is enforced *on Supabase*". `service_role` is contained by schema `USAGE`; `postgres` is not, and `postgres` is the credential behind the dashboard SQL editor. On self-managed the equivalent hole is the superuser, but there the migration principal is not also an application-reachable credential.

**Fix:** extend `fn_assert_security_posture()` to enumerate `rolbypassrls` holders and fail — or, if `postgres` and `service_role` are accepted as trusted operators, to assert that the set is *exactly* those two and nothing has been added. Either way the assertion should state the truth rather than pass silently.

### S-2 — PostgREST does not expose the design schemas **[analysis]**
Every `anon`/`authenticated` grant in `016` and `017` is unreachable over the REST/GraphQL API until `football` and `product` are added to Exposed Schemas (API settings / `PGRST_DB_SCHEMAS`, default `public, graphql_public`). Add only `football` and `product` — the other five must stay unexposed.

### S-3 — Pipeline roles need session-mode connections **[analysis]**
The nine `pt_*` roles are `NOLOGIN` by design (`001:92-94`), with credentials issued out of band. Two Supabase-specific constraints:
- They must connect **direct (5432) or via Supavisor session mode**, never transaction mode. Transaction pooling does not preserve `SET ROLE` or session GUCs, which would silently break the retention marker `pitchterminal.retention_operation` — and a broken marker means retention deletes nothing and reports success, exactly the silent-failure class the design exists to prevent.
- `001:127-153` sets per-role `statement_timeout`, `lock_timeout`, `timezone` and `search_path` via `ALTER ROLE`. These apply to direct connections; confirm they survive the pooler in session mode.

The design already specifies "direct connection, session mode" (`001:88-90`) — this needs enforcing in deployment config, not redesigning.

### Defects found that are independent of Supabase **[verified]**

**D-1 — `product.notification_intent_pdefault` is never re-owned.** `011:195` creates it and, unlike every other `_pdefault` in the set (005, 007, 008, 010, 012, 019 all handle theirs), omits the `OWNER TO pt_owner`. It is the single `postgres`-owned relation in the ownership census above, and it has **RLS neither enabled nor forced** — `016`'s enable loop filters on `relispartition = false` and so skips it, while the partition loop only revokes from `PUBLIC`. A one-line D-15 violation that becomes materially worse on Supabase, where the migration principal is an application-reachable login role with `BYPASSRLS` rather than a locked-down superuser.

**D-2 — sequence over-grant contradicts the asserted posture.** `016:510` grants `USAGE` on **all** sequences in **all seven** schemas to `authenticated`. `016:533` asserts "No end-user role holds any privilege on feature, module, snapshot, calibration or operations." Against the catalogue:

```
   schema    | sequences_granted_to_authenticated
-------------+------------------------------------
 calibration |                                  9
 feature     |                                  7
 module      |                                 10
 operations  |                                 11
 snapshot    |                                 10
```

47 grants contradicting the stated posture. Contained in practice — `authenticated` has no schema `USAGE` — but `fn_assert_access_correspondence()` filters on `relkind IN ('r','p')` and never inspects sequences, so it cannot catch this class. The grant should be scoped to `football` and `product`.

**D-3 — `020` opens its own transaction.** `020:140` `BEGIN` / `020:356` `COMMIT` conflict with the documented per-file transaction wrapper, producing `WARNING: there is already a transaction in progress` and `WARNING: there is no transaction in progress`. Harmless in effect, but it means 020's contents commit at line 356 rather than with the runner — so a later failure in the file would not roll back the earlier part. Cosmetic to fix, real in principle.

**D-4 — identifier truncation in `010`.** `NOTICE: identifier "uq_snapshot_outcome_link_currency__snapshot_dimension_superseded" will be truncated`. `016`'s `fn_apply_access` guards policy names against exactly this at line 161-163; constraint names get no such guard.

---

## 8. Q5 — Adapt to Supabase, or move to self-managed?

**Adapt. Stay on Supabase.** The case is not close, and it rests on findings above rather than on preference.

**The premise for moving does not hold.** The blocking error is a PostgreSQL 16 `CREATEROLE` behaviour, not a Supabase restriction. Self-managed PostgreSQL 16 reproduces it identically whenever migrations run as a non-superuser — which is exactly what the design's own `D-15`/`§5.17.5` posture calls for. Moving platforms to fix a one-line GUC would be a large migration that does not address the actual defect.

**Moving is the more invasive direction.** V2's security model is *built on* Supabase primitives: `auth.uid()` in six policy predicates, four foreign keys into `auth.users`, and `anon`/`authenticated` grants throughout `016` and `017` for roles no migration creates. Self-managed would require reimplementing GoTrue's contract — an `auth` schema, a `users` table, JWT claim extraction — and every reimplementation is a new place for the entitlement path to diverge. `016:59` records that the previous platform already suffered exactly that failure: "two paths — an environment-variable tier and a database-backed context — live simultaneously." Self-managed reintroduces the conditions for it.

**The model demonstrably works on Supabase.** 1,675 tables, 34 partitioned parents, 87 sequences, 6 views and 2 materialised views all owned by `pt_owner`; RLS enabled and forced on 107 of 107 relations; both conformance gates green; cross-layer isolation, the snapshot seal, and the retention marker all verified functional — under a non-superuser principal.

**What is genuinely lost is one property, and it is recoverable.** On Supabase, `postgres` holds `BYPASSRLS` and `pg_read_all_data`, so `FORCE ROW LEVEL SECURITY` does not contain the operator credential (S-1). Self-managed does not eliminate this — it renames it to `superuser` — but it does let you keep the migration principal off the application's network path. If containing the operator credential is a hard compliance requirement rather than a design preference, that is the one argument for self-managed, and it should be made explicitly on those grounds. Otherwise, compensate on Supabase: assert the `BYPASSRLS` set, restrict who holds the `postgres` credential, and rely on the private-schema boundary that already contains `service_role`.

**Recommendation:** adapt to Supabase. Treat `postgres` as a trusted operator credential — the same trust boundary a self-managed superuser would occupy — and make `fn_assert_security_posture()` state that boundary explicitly instead of passing over it in silence.

---

## 9. Migration strategy

Ordered by dependency. Steps 1–3 unblock deployment; step 4 needs a decision before production.

### Step 1 — Unblock (one line, ~5 minutes)
Prepend to `001_extensions.sql`, before the first `CREATE ROLE`:
```sql
SET createrole_self_grant = 'set, inherit';
```
Session-scoped, requires no elevated privilege, and is a no-op under superuser — so it is safe on both Supabase and self-managed, and the file stays portable. **Verified sufficient for all 80 ownership transfers across 002–019.**

### Step 2 — Remove the pg_cron dependency (~10 minutes)
Delete or comment `001:49`. Every scheduled call in `018:628-631` is already commented out, so nothing is lost. If scheduling is wanted later, enable pg_cron from the dashboard and let it install into `cron`, then reference `cron.schedule` from a separate operational migration outside the transactional set.

### Step 3 — Close the security gaps (~1 hour)
- **S-1:** extend `fn_assert_security_posture()` to enumerate `rolbypassrls` holders and fail on anything outside an explicit allowlist of `postgres` and `service_role`.
- **D-1:** add `ALTER TABLE product.notification_intent_pdefault OWNER TO pt_owner` at `011:196`; audit `016`'s enable loop so default partitions are not skipped by the `relispartition = false` filter.
- **D-2:** scope the `016:510` sequence grant for `authenticated` to `football` and `product`; extend `fn_assert_access_correspondence()` to cover `relkind = 'S'` so the class is caught in future.
- **D-3:** remove the `BEGIN`/`COMMIT` pair from `020`.

### Step 4 — Resolve the `auth.users` conflict (**decision required, do not defer**)
C-1 makes user deletion permanently impossible; B-3 makes it conditionally impossible. Both must be settled before any real user exists, because both get harder with data. Options, in order of preference:

1. **Break the FK.** Drop the four `auth.users` foreign keys and enforce the relationship in the application. Preserves the append-only guarantee and decouples the product schema from GoTrue's lifecycle. Costs referential integrity at the database boundary — which the design elsewhere treats as load-bearing, so this is a real trade.
2. **`ON DELETE SET NULL` for `notification_intent.user_id`.** Anonymises rather than deletes. Requires the column to become nullable and the append guard to permit that specific `UPDATE` — a guard exception, which the design has precedent for (`015` A.5 retention exception).
3. **Deletion-time exception in the guard.** Teach `tf_append_only__guard()` to permit deletes originating from an `auth.users` cascade. Fragile — the guard cannot reliably identify the cascade context, and widening it weakens the R-23 seal for every relation that shares it.
4. **Soft-delete users.** Never delete from `auth.users`. Conflicts with right-to-erasure obligations.

Option 1 or 2. Option 2 preserves more and is likely correct for `notification_intent` specifically; option 1 is cleaner for `subscription`, where `RESTRICT` is arguably right and the FK is the thing causing the problem.

### Step 5 — Deployment configuration (not migration work)
- Add **only** `football` and `product` to Exposed Schemas.
- Issue `LOGIN` and credentials to the nine `pt_*` roles out of band, per `001:92-94`.
- Pin all pipeline connections to **direct (5432) or Supavisor session mode**. Transaction mode silently breaks the retention marker.
- Confirm the `ALTER ROLE … SET` timeouts from `001:127-153` are in effect on pipeline sessions.
- Restrict distribution of the `postgres` credential — after S-1 it is the documented trust boundary.

### Step 6 — Re-verify
Re-run 001–020 end to end on a throwaway Supabase project and confirm both gates return 0, RLS is enabled and forced on every base relation, ownership is `pt_owner` with no exceptions, and a Supabase user with a notification intent can be deleted.

### Effort

| Step | Effort | Blocking? |
|---|---|---|
| 1 — `createrole_self_grant` | 1 line | **Yes** |
| 2 — drop pg_cron | 1 line | **Yes** |
| 3 — security gaps | ~1 hour | No, but ship together |
| 4 — `auth.users` conflict | design decision + ~2 hours | **Yes, before production** |
| 5 — deployment config | ~1 hour | **Yes** |
| 6 — re-verification | ~1 hour | — |

**No schema redesign. No platform change. No rewrite of the security model.** The privilege architecture V2 specifies is achievable on Supabase as designed, and was observed working.

---

## 10. Corrections to project documentation

Two claims in `v2/migrations/README.md` do not survive this audit:

- **`README:8-11`** — "**Verified by execution.** The complete set has been applied end to end to a live PostgreSQL 16." Accurate as far as it goes, but that run must have been as a superuser or on PG15; as written the set cannot reach migration 002 as a non-superuser on PG16. The claim should record the principal and privilege level it was verified under, since that is precisely the variable that was untested.
- **`README:6`** — "Target: PostgreSQL 16 on Supabase." True of the auth layer, untrue of the ownership layer until step 1 lands.

Neither is a defect in the schema. Both are the reason the failure reached a live Supabase project instead of being caught earlier.
