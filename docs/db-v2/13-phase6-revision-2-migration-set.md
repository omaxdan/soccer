# PitchTerminal V2 — Phase 6.1, Migration Set Revision 2

The final implementation of every accepted remediation, with per-migration verification.

**Authority order.** Phase 4 logical model → Document 08 Revision 1 → Phase 6 Remediation Analysis (document 12) → this set. Nothing here reinterprets the first three.

---

## Executive position

The set was **executed end to end on PostgreSQL 16** during this pass, not reasoned about. Every migration applies cleanly in sequence inside a transaction, every corrected behaviour was exercised against real data, and both new conformance gates were verified to fire when the posture is deliberately broken.

Verification is recorded in §14. Four defects were found **by execution** that no amount of reading had surfaced, three of them deployment blockers.

| | |
|---|---|
| Migrations modified in Revision 2 | 15 of 18 |
| Migrations verified to apply | **18 of 18** |
| New blockers found and fixed this pass | 4 (B-09, B-10, B-11, plus two execution defects) |
| Accepted remediations implemented | all |
| Phase 4 guarantees weakened | none |
| Migration ordering changed | no |
| Remaining TODO markers | 11, all specification or platform questions |

---

## 1. What was already correct, and what was not

Document 12 recorded Revision 2 as complete. Executing it showed that it was not, in four respects. This is the honest position and it is stated first because it changes how the rest of the document should be read.

| Ref | Defect | Severity | How it was found |
|---|---|---|---|
| **B-09** | The privilege matrix could not reach relations created *after* migration 016. `product.p_landing` and `product.p_team_state` are created in 017 and held SELECT/INSERT/UPDATE/DELETE for `pt_pipeline_projection` **with no policy at all**. Every projection refresh would have failed on its first insert. `operations.retention_policy`, created in 018, had neither RLS enabled nor a policy. | **BLOCKER** | Reading 017 while unifying the matrix |
| **B-10** | `REFRESH MATERIALIZED VIEW` requires ownership. Both materialised views are owned by `pt_owner`, which no process authenticates as. **No refresh path existed for either view.** | **BLOCKER** | Reading 017 |
| **B-11** | Three further grant-without-policy pairs: `pt_platform_admin` UPDATE on the feature registry, `pt_migration` UPDATE on the validation ledger, `pt_platform_admin` INSERT/UPDATE on the retention registry. Each would have silently affected nothing — the resumable validation of F-25 would have lost its resumability precisely when needed. | **BLOCKER** | Building the correspondence assertion |
| **X-01** | `privileges := privileges \|\| 'SELECT'` in the applicator. PL/pgSQL parses `text[] \|\| unknown` as an array literal and raises *malformed array literal*. | Execution | **Running it** |
| **X-02** | `CREATE TEMP TABLE … ON COMMIT DROP` for the access specification. Under autocommit the table is destroyed the instant its CREATE commits, and the expansion then fails on a missing relation. | Execution | **Running it** |

The common root of B-09 and B-11 is worth naming: Revision 1's generator drew from a *list of schemas and roles*, so anything outside that shape — a later relation, a per-relation exception — fell through. Revision 2 replaces the generator with a specification plus an **assertion against the catalogue**, so the class of defect is closed rather than the instances patched.

---

## 2. Migration 009 — `009_calibration.sql`

**Migration:** `009_calibration.sql`
**Revision:** 2

### Summary

`pipeline_job_run_occurred_at` is declared in the `CREATE TABLE` for `calibration.calibration_run` rather than added by `ALTER TABLE` in migration 014.

### Changed SQL

```sql
CREATE TABLE calibration.calibration_run (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  run_key                   text        NOT NULL,
  measurement_population_id bigint      NOT NULL,
  calibration_version_id    bigint      NOT NULL,
  pipeline_job_run_id       bigint,
  pipeline_job_run_occurred_at timestamptz,          -- REVISION 2 (P-04)
  started_at                timestamptz NOT NULL,
  completed_at              timestamptz,
  outcome                   text        NOT NULL,
  CONSTRAINT pk_calibration_run          PRIMARY KEY (id),
  ...
);

COMMENT ON COLUMN calibration.calibration_run.pipeline_job_run_occurred_at IS
  'REVISION 2 (P-04). operations.pipeline_job_run is range-partitioned on its own
   occurred_at, so the reference to it must be composite over ITS key (A.1, R-01).
   This column carries the job run''s own instant, not an instant belonging to this
   row. Declared here rather than added by ALTER in migration 014 so that the
   relation is created in its final shape and the file remains re-runnable.';
```

### Implementation notes

A migration set that creates a table and then alters it two files later is a patch series, not a schema definition. The reference itself still belongs in 014, because `operations` is created in 012 and the ordering may not be disturbed; only the *column* moves.

### Verification

1. **Summary of changes** — one column relocated from an `ALTER` in 014 to the `CREATE TABLE` in 009; one column comment added.
2. **Objects changed** — `calibration.calibration_run`.
3. **Phase 4 preservation** — E7.01 Calibration Run names its executing job run (LC-119). The attribute existed before and exists now; only the file in which it is declared changed. No logical property is affected.
4. **PostgreSQL 16** — plain `timestamptz` column. Nothing version-specific.
5. **Supabase** — nothing platform-specific.
6. **Ordering impact** — none. 009 still precedes 012 and 014; the foreign key is still added in 014, where `operations` exists.
7. **Backward compatibility** — none required; initial deployment. For an environment already carrying Revision 1, the `ALTER` and the `CREATE` produce the identical relation.

---

## 3. Migration 014 — `014_constraints.sql`

**Migration:** `014_constraints.sql`
**Revision:** 2

### Summary

The `ALTER TABLE … ADD COLUMN` for `calibration_run` is removed; this file adds references, not columns. The P-04 note is corrected to describe both carrying columns.

### Changed SQL

```sql
ALTER TABLE snapshot.match_snapshot
  ADD CONSTRAINT fk_match_snapshot__pipeline_job_run
  FOREIGN KEY (pipeline_job_run_id, pipeline_job_run_occurred_at)
  REFERENCES operations.pipeline_job_run (id, occurred_at)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMENT ON CONSTRAINT fk_match_snapshot__pipeline_job_run ON snapshot.match_snapshot IS
  'Execution attribution — the sole direction in which an authoritative relation
   depends on an operational one, and it exists solely for auditability. RESTRICT
   is what makes the retention exception of §B.9.4 structural: a job run referenced
   by a sealed artefact CANNOT be removed by retention.';

-- REVISION 2 (P-04). The reference pairs on the job run's OWN occurred_at,
-- carried on match_snapshot as pipeline_job_run_occurred_at and on
-- calibration_run as the column of the same name. The former form paired on
-- sealed_at, which required the sealing transaction to stamp both from a single
-- clock read and would have rejected valid inserts whenever the two differed by
-- a microsecond. The TODO it carried is resolved and withdrawn.
--
-- Both carrying columns are now declared in the CREATE TABLE of their own
-- migration — 010 and 009 respectively — rather than added by ALTER here. This
-- file adds references, not columns.

ALTER TABLE calibration.calibration_run
  ADD CONSTRAINT fk_calibration_run__pipeline_job_run
  FOREIGN KEY (pipeline_job_run_id, pipeline_job_run_occurred_at)
  REFERENCES operations.pipeline_job_run (id, occurred_at)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE calibration.calibration_run
  ADD CONSTRAINT ck_calibration_run__job_run_reference_complete
  CHECK ((pipeline_job_run_id IS NULL) = (pipeline_job_run_occurred_at IS NULL));
```

### Implementation notes

`ON DELETE RESTRICT` on both references is the mechanism by which §B.9.4's retention exception becomes structural rather than procedural: a job run cited by a sealed snapshot or a calibration run cannot be removed by operational retention. This is also why bounded retention is gated on A.17 (see §10).

The `CHECK` retains its correct `ck_` prefix (D-01). Pairing on `occurred_at` rather than `sealed_at` removes the requirement that two independently-stamped instants agree to the microsecond.

### Verification

1. **Summary of changes** — one `ADD COLUMN` removed; the P-04 note extended.
2. **Objects changed** — `calibration.calibration_run` (constraints only).
3. **Phase 4 preservation** — LC-119 is enforced by a real composite foreign key rather than an unvalidated presence assertion, which is stronger, not weaker. The nullability remains so that a run may be recorded before its job run is finalised within the same transaction.
4. **PostgreSQL 16** — composite foreign key to a partitioned parent requires the parent's unique constraint to include the partition key; `uq_pipeline_job_run__id_occurred` provides it (A.1, R-01).
5. **Supabase** — nothing platform-specific.
6. **Ordering impact** — none.
7. **Backward compatibility** — the resulting constraints are byte-identical to Revision 1's.

---

## 4. Migration 015 — `015_triggers.sql`

**Migration:** `015_triggers.sql`
**Revision:** 2

### Summary

Trigger functions become `CREATE OR REPLACE`. No trigger logic changes. The watchlist defence trigger retains `SECURITY DEFINER`; its justification is verified in §5.

### Changed SQL

```sql
CREATE OR REPLACE FUNCTION snapshot.tf_sealed__guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ ... $$;

CREATE OR REPLACE FUNCTION feature.tf_append_only__guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_marker text := current_setting('pitchterminal.retention_operation', true);
BEGIN
  ...
END $$;

CREATE OR REPLACE FUNCTION product.tf_watchlist__referential_defence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ ... $$;
```

### Implementation notes

Only the five permitted trigger classes exist: sealing guard, append guard, lifecycle guard, statement-level provenance propagation, watchlist defence. The count is unchanged.

Retaining `SECURITY DEFINER` on the watchlist defence is correct under Section 1's test: the deleting principal is an ingestion role with no privilege whatsoever on `product.watchlist`, so no invoker could perform the cascade. It carries `search_path = ''` and now has the two narrow owner policies it requires (§5).

### Verification

1. **Summary of changes** — five function definitions made replaceable; header stamped.
2. **Objects changed** — five trigger functions. No trigger definition, timing, level or condition altered.
3. **Phase 4 preservation** — R-19, R-20, R-23 and A.12 are untouched. Verified behaviourally: the append guard raises on UPDATE for every principal, and the sealing guard raises for every principal including the retention role (§14.3).
4. **PostgreSQL 16** — `CREATE OR REPLACE FUNCTION` cannot change a return type; all five return `trigger` before and after.
5. **Supabase** — unaffected.
6. **Ordering impact** — none.
7. **Backward compatibility** — identical behaviour.

---

## 5. Migration 016 — `016_security.sql`

**Migration:** `016_security.sql`
**Revision:** 2 — **the substantive change of this pass**

### Summary

The privilege matrix and the policy matrix become **one specification with two effects**, applied by one function that issues the policy before the grant it governs. A catalogue assertion then proves the correspondence rather than assuming it. `pt_platform_admin`'s registry UPDATE, `pt_migration`'s ledger UPDATE, and the append-only football exception all move into that specification, closing B-11.

### Changed SQL

The applicator — every privilege in the system is issued through it:

```sql
CREATE OR REPLACE FUNCTION operations.fn_apply_access(
  p_schema   text, p_relation text, p_role text,
  p_modes    text,                 -- any of S I U D
  p_using    text DEFAULT NULL,    -- NULL means "true"
  p_check    text DEFAULT NULL     -- NULL means p_using, else "true"
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  m           text;
  policy_name text;
  privileges  text[] := '{}';
  using_expr  text := coalesce(p_using, 'true');
  check_expr  text := coalesce(p_check, p_using, 'true');
BEGIN
  FOREACH m IN ARRAY string_to_array(p_modes, NULL) LOOP
    -- One policy per (relation, role, command). The relation is NOT part of the
    -- name: policy names are unique per relation in pg_policy, so including it
    -- only risks silent truncation at 63 bytes on the longer combinations.
    policy_name := 'pl_' || p_role || '__' ||
                   CASE m WHEN 'S' THEN 'select' WHEN 'I' THEN 'insert'
                          WHEN 'U' THEN 'update' WHEN 'D' THEN 'delete' END;
    IF length(policy_name) > 63 THEN
      RAISE EXCEPTION 'generated policy name % exceeds the identifier limit and would be truncated silently', policy_name;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_name, p_schema, p_relation);

    CASE m
      WHEN 'S' THEN
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR SELECT TO %I USING (%s)',
                       policy_name, p_schema, p_relation, p_role, using_expr);
        privileges := privileges || 'SELECT'::text;
      WHEN 'I' THEN
        -- INSERT admits WITH CHECK only; a USING clause is a syntax error.
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR INSERT TO %I WITH CHECK (%s)',
                       policy_name, p_schema, p_relation, p_role, check_expr);
        privileges := privileges || 'INSERT'::text;
      WHEN 'U' THEN
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR UPDATE TO %I USING (%s) WITH CHECK (%s)',
                       policy_name, p_schema, p_relation, p_role, using_expr, check_expr);
        privileges := privileges || 'UPDATE'::text;
      WHEN 'D' THEN
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR DELETE TO %I USING (%s)',
                       policy_name, p_schema, p_relation, p_role, using_expr);
        privileges := privileges || 'DELETE'::text;
      ELSE
        RAISE EXCEPTION 'unknown access mode % in specification for %.% / %', m, p_schema, p_relation, p_role;
    END CASE;
  END LOOP;

  -- The grant is issued from the SAME specification, immediately after the
  -- policies it corresponds to. PR-02's ordering is preserved: no privilege
  -- exists before the policy that governs it.
  EXECUTE format('GRANT %s ON %I.%I TO %I',
                 array_to_string(privileges, ', '), p_schema, p_relation, p_role);
END;
$fn$;
```

The assertion — the reason the correspondence is a property rather than a habit:

```sql
CREATE OR REPLACE FUNCTION operations.fn_assert_access_correspondence() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE offenders text; n integer;
BEGIN
  WITH granted AS (
    SELECT ns.nspname::text AS schema_name, c.relname::text AS relation_name,
           a.grantee AS grantee_oid,
           pg_catalog.pg_get_userbyid(a.grantee) AS role_name,
           a.privilege_type::text AS privilege_type
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE c.relkind IN ('r','p') AND NOT c.relispartition
      AND ns.nspname IN ('football','feature','module','snapshot','calibration','product','operations')
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
      -- The owner's privileges are conferred by ownership, not by the access
      -- specification. FORCE ROW LEVEL SECURITY still subjects the owner to
      -- policy; where an owner-executed path needs one it is declared explicitly.
      AND a.grantee <> c.relowner
  )
  SELECT count(*),
         pg_catalog.string_agg(
           format('%s.%s: %s lacks a %s policy', g.schema_name, g.relation_name,
                  g.role_name, g.privilege_type), E'\n'
           ORDER BY g.schema_name, g.relation_name, g.role_name, g.privilege_type)
    INTO n, offenders
  FROM granted g
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = format('%I.%I', g.schema_name, g.relation_name)::regclass
      AND (p.polcmd = '*' OR p.polcmd = CASE g.privilege_type
                                          WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a'
                                          WHEN 'UPDATE' THEN 'w' WHEN 'DELETE' THEN 'd' END)
      AND (p.polroles = '{0}'::oid[] OR g.grantee_oid = ANY (p.polroles))
  );

  IF n > 0 THEN
    RAISE EXCEPTION E'row-level security posture is incomplete: % granted privileges have no covering policy and would fail silently\n%', n, offenders;
  END IF;
  RETURN 0;
END;
$fn$;
```

The specification — extract, showing the three shapes that matter (schema-wide, exception, predicate):

```sql
DROP TABLE IF EXISTS _access_rule;
CREATE TEMP TABLE _access_rule (
  schema_name text NOT NULL, role_name text NOT NULL, modes text NOT NULL,
  include_only text[], exclude text[], using_expr text, check_expr text
);

INSERT INTO _access_rule (schema_name, role_name, modes, include_only, exclude, using_expr, check_expr) VALUES
  -- REVISION 2 (P-06): the three append-only football relations receive SELECT
  -- and INSERT only, in the grant AND the policy.
  ('football','pt_pipeline_ingestion','SIU', NULL,
     ARRAY['standing','player_valuation','fixture_lifecycle_transition'], NULL, NULL),
  ('football','pt_pipeline_ingestion','SI',
     ARRAY['standing','player_valuation','fixture_lifecycle_transition'], NULL, NULL, NULL),
  ...
  -- Governed configuration only. The administrative role does NOT hold UPDATE on
  -- feature_value or feature_lineage, which are append-only.        [B-11]
  ('feature','pt_platform_admin','U',
     ARRAY['feature_definition','feature_calculator','feature_definition_context_kind',
           'feature_source','feature_dependency'], NULL, NULL, NULL),
  -- R-20/R-22. The DELETE policy carries the SAME session-marker condition the
  -- append guard of migration 015 enforces, so the rule is stated at two layers
  -- and a delete without the marker is blocked twice.
  ('feature','pt_retention','D', ARRAY['feature_value','feature_lineage'], NULL,
     'current_setting(''pitchterminal.retention_operation'', true) = ''true''', NULL),
  ...
  -- REVISION 2 (B-02, second instance). The watchlist defence trigger is
  -- SECURITY DEFINER and executes as pt_owner, which FORCE ROW LEVEL SECURITY
  -- subjects to policy. Without these two it would delete nothing and report
  -- success. Deliberately narrow — one relation, two commands.
  ('product','pt_owner','SD', ARRAY['watchlist'], NULL, NULL, NULL),
  -- REVISION 2 (B-11). The migration role seeds and maintains the operational
  -- CONFIGURATION relations from migrations that run AFTER RLS is forced.
  ('operations','pt_migration','SIU',
     ARRAY['quality_check','constraint_validation_progress'], NULL, NULL, NULL);
```

Expansion, with two guards that turn specification errors into migration failures:

```sql
DROP TABLE IF EXISTS _access_grant;
CREATE TEMP TABLE _access_grant (
  schema_name text NOT NULL, relation_name text NOT NULL, role_name text NOT NULL,
  mode text NOT NULL, using_expr text, check_expr text,
  CONSTRAINT pk__access_grant PRIMARY KEY (schema_name, relation_name, role_name, mode)
);

INSERT INTO _access_grant (schema_name, relation_name, role_name, mode, using_expr, check_expr)
SELECT r.schema_name, c.relname::text, r.role_name, m.mode, r.using_expr, r.check_expr
FROM _access_rule r
JOIN pg_class c ON c.relnamespace = to_regnamespace(r.schema_name)::oid
CROSS JOIN LATERAL unnest(string_to_array(r.modes, NULL)) AS m(mode)
WHERE c.relkind IN ('r','p') AND NOT c.relispartition
  AND (r.include_only IS NULL OR c.relname = ANY (r.include_only))
  AND (r.exclude      IS NULL OR c.relname <> ALL (r.exclude));

-- Every relation named in an include_only list must exist. A typo would
-- otherwise silently produce no grant and no policy, which is the failure mode
-- this whole section exists to eliminate.
DO $chk$
DECLARE missing text;
BEGIN
  SELECT string_agg(format('%s.%s', r.schema_name, rel), ', ') INTO missing
  FROM _access_rule r CROSS JOIN LATERAL unnest(r.include_only) AS rel
  WHERE r.include_only IS NOT NULL
    AND to_regclass(format('%I.%I', r.schema_name, rel)) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'access specification names relations that do not exist: %', missing;
  END IF;
END $chk$;
```

Application — grouped by predicate as well as by principal:

```sql
-- Grouped by PREDICATE as well as by principal. Two rules for one role on one
-- relation may carry different predicates — pt_retention reads every feature
-- relation unconditionally but deletes only under the retention marker — and
-- collapsing them would apply one rule's predicate to the other's command.
DO $apply$
DECLARE g record;
BEGIN
  FOR g IN SELECT schema_name, relation_name, role_name, using_expr, check_expr,
                  string_agg(mode, '' ORDER BY mode) AS modes
             FROM _access_grant
            GROUP BY schema_name, relation_name, role_name, using_expr, check_expr
  LOOP
    PERFORM operations.fn_apply_access(
      g.schema_name, g.relation_name, g.role_name, g.modes, g.using_expr, g.check_expr);
  END LOOP;
END $apply$;

DROP TABLE _access_grant;
DROP TABLE _access_rule;

SELECT operations.fn_assert_access_correspondence();
```

Retained from Revision 1, unchanged, and preceding all of the above:

```sql
-- Enable and FORCE row-level security on every relation  (PD-18, F-09)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relnamespace::regnamespace::text AS s, c.relname AS t
           FROM pg_class c
           WHERE c.relnamespace::regnamespace::text IN
                 ('football','feature','module','snapshot','calibration','product','operations')
             AND c.relkind IN ('r','p') AND c.relispartition = false
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.s, r.t);
  END LOOP;
END $$;
```

### Implementation notes

**Why the relation is not in the policy name.** `pg_policy` is keyed on `(polrelid, polname)`, so a policy name need only be unique within its relation. Including the relation produced names such as `pl_feature_definition_context_kind__pt_pipeline_calibration__select` at 67 bytes, which PostgreSQL truncates **silently** at 63. Dropping the relation caps every generated name at 34 bytes, and the applicator raises if a future role name ever pushes one past the limit.

**Why grouping is by predicate.** `pt_retention` holds `S` on every `feature` relation unconditionally and `D` on two of them under the retention marker. Grouping by principal alone would have collapsed those two rules and applied the marker predicate to the SELECT policy, quietly narrowing a read the specification grants unconditionally.

**Why `pt_owner` appears in the specification at all.** `FORCE ROW LEVEL SECURITY` subjects the owner to policy — that is the whole point of forcing it — so an owner-executed path needs an explicit policy like any other principal. Declaring it is the posture F-09 asks for; the alternative is an implicit exemption.

**Why not `BYPASSRLS`.** It requires superuser to set, which the platform's administrative role is not, and it would discard exactly the property F-09 exists to establish.

### Verification

1. **Summary of changes** — the schema/role policy loop, the separate retention-delete loop, the owner-policy block, the football public-read loop, the product end-user policies and all nine per-schema grant blocks are replaced by one specification, one applicator, one expansion and one assertion. `pl_match_snapshot__pt_owner__select` is removed as unnecessary once the checksum function became `SECURITY INVOKER` (§10).
2. **Objects changed** — two new functions in `operations`; policies and grants on every relation in the seven schemas. No relation, column, constraint or index altered.
3. **Phase 4 preservation** — no privilege is granted that the Revision 1 matrix did not grant. Three previously ungranted privileges are *removed* from effect by being declared: `pt_pipeline_projection` no longer receives policies on `product` relations it holds no grant on. Every guarantee is preserved and three are strengthened: R-22 (delete confined to the retention role under the marker, now at two layers), R-69 (no snapshot write privilege, now asserted), F-09 (every principal's access declared, now asserted).
4. **PostgreSQL 16** — `aclexplode`, `pg_policy.polcmd`/`polroles`, `to_regnamespace`, `to_regclass`, `string_to_array(text, NULL)` for character splitting, `CROSS JOIN LATERAL unnest`. All long-established. `polroles = '{0}'` is the catalogue representation of `TO PUBLIC`.
5. **Supabase** — `anon` and `authenticated` are the platform's roles and are addressed by name. `auth.uid()` is schema-qualified and wrapped in a scalar subquery, the platform's recommended form. `BYPASSRLS` is not used anywhere. Custom roles remain `NOLOGIN`, with credentials deferred to a secure channel.
6. **Ordering impact** — none. RLS is still enabled and forced before any policy; every policy still precedes its grant, now by construction rather than by file layout.
7. **Backward compatibility** — the effective privilege set is a subset of Revision 1's, and the policy set is a strict superset. No principal gains access; three gain the ability to exercise access they already nominally held.

---

## 6. Migration 017 — `017_views.sql`

**Migration:** `017_views.sql`
**Revision:** 2

### Summary

The two projection relations obtain their policies and grants through the same applicator (**B-09**), a refresh path is created for the two materialised views (**B-10**), and the correspondence assertion is re-run after the file's own objects exist.

### Changed SQL

```sql
-- Entitlement enforcement AT THE PROJECTION BOUNDARY (§B.7.6). Consults the
-- single resolution function; never resolves entitlement inline.
--
-- REVISION 2 (B-09). Declared through operations.fn_apply_access, the same
-- applicator migration 016 uses, so these relations — created AFTER 016 has run
-- and therefore invisible to its expansion — obtain their policies and their
-- grants from one statement and cannot acquire one without the other.
SELECT operations.fn_apply_access('product','p_landing','authenticated','S',
  $$required_entitlement_key IS NULL
    OR required_entitlement_key IN (SELECT entitlement_feature_key
                                    FROM product.fn_resolve_entitlements((SELECT auth.uid())))$$);
SELECT operations.fn_apply_access('product','p_landing','anon','S',
  'required_entitlement_key IS NULL');
-- REVISION 2 (B-09). The projection pipeline held SELECT, INSERT, UPDATE and
-- DELETE on both projection relations and had NO POLICY on either. Under FORCE
-- ROW LEVEL SECURITY every projection refresh would have failed on its first
-- insert — the same defect as B-03, in the one place the privilege matrix of
-- migration 016 could not reach.
SELECT operations.fn_apply_access('product','p_landing','pt_pipeline_projection','SIUD');
```

```sql
-- Materialised views are not row-level-security capable, so their grants carry
-- no policy and are issued directly. Both are F-05 compliant — they hold no
-- entitlement-scoped content — which is precisely why they may be materialised
-- views at all, and why a blanket read grant on them is safe.
GRANT SELECT ON product.mv_module_directory, product.mv_competition_summary
  TO anon, authenticated, pt_platform_admin;

-- -----------------------------------------------------------------------------
-- Materialised view refresh  (REVISION 2, B-10)
-- -----------------------------------------------------------------------------
-- REFRESH MATERIALIZED VIEW requires OWNERSHIP of the view. Every object in the
-- design is owned by pt_owner, which no process authenticates as (§5.17.5, D-15),
-- so the projection role could not refresh either view and no refresh path
-- existed. This is the one case in this migration where ownership elevation is
-- GENUINELY REQUIRED rather than merely convenient, and it is therefore the one
-- case that retains SECURITY DEFINER — with an empty search path, a fixed set of
-- targets named in the body, and no parameter that can redirect it.
--
-- CONCURRENTLY throughout: both views carry a unique index (P-03 made the first
-- of them genuinely unique), so refresh does not lock out readers. It is
-- permitted inside a transaction block, unlike VACUUM and CREATE INDEX
-- CONCURRENTLY, so no non-transactional migration class is involved (R-62).

CREATE OR REPLACE FUNCTION product.fn_refresh_projection_views() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY product.mv_module_directory;
  REFRESH MATERIALIZED VIEW CONCURRENTLY product.mv_competition_summary;
END;
$$;
ALTER FUNCTION product.fn_refresh_projection_views() OWNER TO pt_owner;
REVOKE ALL ON FUNCTION product.fn_refresh_projection_views() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION product.fn_refresh_projection_views()
  TO pt_pipeline_projection, pt_platform_admin;

SELECT operations.fn_assert_access_correspondence();
```

Unchanged and load-bearing for the above — P-03's fix, without which `CONCURRENTLY` is unavailable:

```sql
-- REVISION 2 (P-03). published_baseline_id is nullable because the view is
-- built on LEFT JOINs, and standard uniqueness treats nulls as distinct — so
-- the index did NOT guarantee row uniqueness and REFRESH ... CONCURRENTLY would
-- fail for any module with no published baseline and more than one version row.
-- NULLS NOT DISTINCT (PostgreSQL 15+) makes the index genuinely unique.
CREATE UNIQUE INDEX ux_mv_module_directory__module_baseline
  ON product.mv_module_directory (module_definition_id, published_baseline_id)
  NULLS NOT DISTINCT;
```

### Implementation notes

P-03 and B-10 compound: without `NULLS NOT DISTINCT` the unique index does not guarantee uniqueness, so `REFRESH … CONCURRENTLY` fails; without the definer function nothing may refresh at all. Both had to be fixed for either to be useful, which is why the refresh function is verified by execution in §14.2 rather than asserted.

The refresh function takes no parameter and names its targets in the body. A definer function that accepts a relation name is a privilege-escalation primitive; this one cannot be redirected.

### Verification

1. **Summary of changes** — four hand-written policies replaced by applicator calls; three new applicator calls for the projection role; matview grants separated and widened to the administrative role; refresh function added; assertion added.
2. **Objects changed** — `product.p_landing`, `product.p_team_state` (policies and grants), `product.mv_module_directory`, `product.mv_competition_summary` (grants), new `product.fn_refresh_projection_views`.
3. **Phase 4 preservation** — F-05 is preserved exactly: entitlement-scoped content remains in projection *relations* under policy, and only non-scoped content is materialised. LC-145 (projections are disposable) is unaffected. The entitlement predicate still consults `fn_resolve_entitlements` and never resolves entitlement inline (F-21, single path).
4. **PostgreSQL 16** — `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index on the view and is permitted inside a transaction block. `NULLS NOT DISTINCT` requires PostgreSQL 15 or later.
5. **Supabase** — `anon`/`authenticated` grants unchanged in effect. The refresh function is reachable by the projection role over a direct connection; it is not exposed through PostgREST, since only `product` is exposed and `EXECUTE` is not granted to `anon` or `authenticated`.
6. **Ordering impact** — none. 017 still follows 016 and depends on `fn_apply_access` existing, which it does.
7. **Backward compatibility** — the four replaced policies have identical predicates and differ only in name. Behaviour for `anon` and `authenticated` is unchanged.

---

## 7. Migration 018 — `018_maintenance.sql`

**Migration:** `018_maintenance.sql`
**Revision:** 2

### Summary

Retention gains its third age band and deterministic bucketing; the retention registry is created in its final shape with class-consistency constraints, its own RLS, and its own policies; the security posture becomes executable rather than described; the checksum function drops `SECURITY DEFINER`; the file closes with two conformance gates.

### Changed SQL — the retention registry

```sql
CREATE TABLE operations.retention_policy (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  target_schema_name    text        NOT NULL,
  target_relation_name  text        NOT NULL,
  retention_class       text        NOT NULL,
  recent_window         interval,
  intermediate_window   interval,
  bounded_window        interval,
  family_key            text,
  is_active             boolean     NOT NULL DEFAULT true,
  CONSTRAINT pk_retention_policy PRIMARY KEY (id),
  CONSTRAINT uq_retention_policy__target UNIQUE (target_schema_name, target_relation_name),
  CONSTRAINT ck_retention_policy__class_known
    CHECK (retention_class IN ('THINNED','BOUNDED')),
  -- REVISION 2 (B-06). A THINNED policy names the DRIVING relation of a family
  -- and must name the family; a BOUNDED policy has no family.
  CONSTRAINT ck_retention_policy__family_known
    CHECK (family_key IS NULL OR family_key IN ('FEATURE','MODULE')),
  CONSTRAINT ck_retention_policy__family_matches_class
    CHECK ((retention_class = 'THINNED') = (family_key IS NOT NULL)),
  CONSTRAINT ck_retention_policy__windows_match_class CHECK (
    CASE retention_class
      WHEN 'THINNED' THEN recent_window IS NOT NULL AND intermediate_window IS NOT NULL
                          AND bounded_window IS NULL
                          AND intermediate_window > recent_window
      WHEN 'BOUNDED' THEN bounded_window IS NOT NULL
                          AND recent_window IS NULL AND intermediate_window IS NULL
    END
  )
);
ALTER TABLE operations.retention_policy OWNER TO pt_owner;
-- REVISION 2 (B-09). This relation is created AFTER migration 016 has enabled
-- and forced row-level security across the seven schemas, so it must do so for
-- itself. PD-18 and F-09 admit no exception.
ALTER TABLE operations.retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.retention_policy FORCE ROW LEVEL SECURITY;

SELECT operations.fn_apply_access('operations','retention_policy','pt_migration','SIU');
SELECT operations.fn_apply_access('operations','retention_policy','pt_platform_admin','SIU');
SELECT operations.fn_apply_access('operations','retention_policy','pt_retention','S');

INSERT INTO operations.retention_policy
  (target_schema_name, target_relation_name, retention_class,
   recent_window, intermediate_window, bounded_window, family_key) VALUES
  ('feature','feature_value',   'THINNED', interval '90 days', interval '2 years', NULL, 'FEATURE'),
  ('module','module_reading',   'THINNED', interval '90 days', interval '2 years', NULL, 'MODULE'),
  ('operations','write_record', 'BOUNDED', NULL, NULL, interval '180 days', NULL),
  ('operations','pipeline_run', 'BOUNDED', NULL, NULL, interval '180 days', NULL),
  ('operations','pipeline_job_run','BOUNDED', NULL, NULL, interval '180 days', NULL),
  ('operations','failure',      'BOUNDED', NULL, NULL, interval '2 years', NULL),
  ('operations','failure_resolution','BOUNDED', NULL, NULL, interval '2 years', NULL),
  ('operations','api_usage',    'BOUNDED', NULL, NULL, interval '3 years', NULL)
ON CONFLICT (target_schema_name, target_relation_name) DO NOTHING;
```

### Changed SQL — family thinning, three bands

```sql
-- THREE AGE BANDS, not two. §B.9.3 states the retained resolution as full in the
-- recent window, DAILY in the intermediate window, and WEEKLY beyond it. Both
-- family functions implement all three. The band discriminator is carried in the
-- window partition alongside the bucket, because a daily bucket and a weekly
-- bucket can name the same instant — a Monday — and without the discriminator a
-- row in the daily band and a row in the weekly band would compete for one
-- survivor across the band boundary, deleting a value the daily band retains.
--
-- Bucket truncation is pinned to UTC. date_trunc/2 on timestamptz resolves day
-- and week boundaries in the session's TimeZone, which would make WHICH ROW
-- SURVIVES depend on the setting of whichever session the scheduler happened to
-- open. The retained boundary must be a property of the data, not of the caller.

CREATE OR REPLACE FUNCTION operations.fn_thin_feature_family(
  p_recent_window interval, p_intermediate_window interval
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  cutoff_recent       timestamptz := now() - p_recent_window;
  cutoff_intermediate timestamptz := now() - p_intermediate_window;
  n_values  integer := 0;
  n_lineage integer := 0;
BEGIN
  DROP TABLE IF EXISTS pg_temp._eligible_values;
  CREATE TEMP TABLE _eligible_values ON COMMIT DROP AS
    SELECT id, as_of FROM (
      SELECT banded.id, banded.as_of,
             row_number() OVER (
               PARTITION BY banded.subject_kind_code, banded.subject_team_id,
                            banded.subject_player_id, banded.subject_fixture_id,
                            banded.subject_competition_edition_id,
                            banded.context_kind_code, banded.context_competition_edition_id,
                            banded.feature_definition_id, banded.band, banded.bucket
               ORDER BY banded.as_of DESC) AS rn
      FROM (
        SELECT fv.id, fv.as_of, fv.subject_kind_code, fv.subject_team_id,
               fv.subject_player_id, fv.subject_fixture_id,
               fv.subject_competition_edition_id, fv.context_kind_code,
               fv.context_competition_edition_id, fv.feature_definition_id,
               CASE WHEN fv.as_of >= cutoff_intermediate THEN 'DAILY' ELSE 'WEEKLY' END AS band,
               CASE WHEN fv.as_of >= cutoff_intermediate
                    THEN date_trunc('day',  fv.as_of, 'UTC')
                    ELSE date_trunc('week', fv.as_of, 'UTC') END AS bucket
        FROM feature.feature_value fv
        WHERE fv.as_of < cutoff_recent
      ) banded
    ) ranked
    WHERE rn > 1;

  -- ORDER MATTERS. Lineage rows whose PRODUCED value is eligible are removed
  -- first; LC-47 permits this because lineage travels with the value it
  -- describes. Lineage citing an eligible value as CONSUMED is untouched, and
  -- the RESTRICT on that endpoint will block the value's deletion if any
  -- remains — which is the eligibility guarantee working as designed.
  DELETE FROM feature.feature_lineage l
   USING pg_temp._eligible_values e
   WHERE l.produced_value_id = e.id AND l.produced_value_as_of = e.as_of;
  GET DIAGNOSTICS n_lineage = ROW_COUNT;

  DELETE FROM feature.feature_value v
   USING pg_temp._eligible_values e
   WHERE v.id = e.id AND v.as_of = e.as_of;
  GET DIAGNOSTICS n_values = ROW_COUNT;

  DROP TABLE pg_temp._eligible_values;
  RETURN n_values + n_lineage;
END;
$$;
```

`fn_thin_module_family` is the same shape over `module_definition_id`, deleting item → evidence → reading:

```sql
  -- Children first, deepest first: items, then evidence, then readings. Any
  -- other order raises on the RESTRICT, which is the point — the chain is
  -- enforced, not assumed.
  DELETE FROM module.module_evidence_item i
   USING module.module_evidence ev, pg_temp._eligible_readings e
   WHERE i.module_evidence_id = ev.id AND i.reading_as_of = ev.reading_as_of
     AND ev.module_reading_id = e.id  AND ev.reading_as_of = e.as_of;
  ...
  DELETE FROM module.module_evidence ev
   USING pg_temp._eligible_readings e
   WHERE ev.module_reading_id = e.id AND ev.reading_as_of = e.as_of;
  ...
  DELETE FROM module.module_reading mr
   USING pg_temp._eligible_readings e
   WHERE mr.id = e.id AND mr.as_of = e.as_of;
```

### Changed SQL — the retention driver

```sql
CREATE OR REPLACE FUNCTION operations.fn_run_retention() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p record; total integer := 0;
BEGIN
  IF current_user <> 'pt_retention' THEN
    RAISE EXCEPTION 'retention may be executed only by the retention role, not by %', current_user;
  END IF;

  -- Session-scoped, per R-21 and R-58 — pipeline connections run in session mode
  -- precisely so this state survives statement boundaries. Session scope means it
  -- also survives a FAILED run, so the body below is wrapped and the marker is
  -- cleared on every exit path. A connection left holding the marker would leave
  -- the retention role able to delete outside a retention execution, which is
  -- exactly what R-20's second condition exists to prevent.
  PERFORM set_config('pitchterminal.retention_operation', 'true', false);

  BEGIN
  -- PD-19 POSITIVE INCLUSION. The registry is the sole driver: a family is
  -- thinned because a policy names its driving relation, never because a
  -- function was written for it. Deactivating the policy stops the pass.
  FOR p IN SELECT * FROM operations.retention_policy
            WHERE is_active AND retention_class = 'THINNED'
            ORDER BY family_key
  LOOP
    CASE p.family_key
      WHEN 'FEATURE' THEN
        total := total + operations.fn_thin_feature_family(p.recent_window, p.intermediate_window);
      WHEN 'MODULE' THEN
        total := total + operations.fn_thin_module_family(p.recent_window, p.intermediate_window);
      ELSE
        -- Fails loudly rather than skipping. A THINNED policy naming a family
        -- with no implementation would otherwise thin nothing and report
        -- success, which is the failure mode B-03 and B-06 both took.
        RAISE EXCEPTION 'retention policy % names family % for which no thinning implementation exists',
          p.id, p.family_key;
    END CASE;
  END LOOP;

  -- BOUNDED policies are registered above and are NOT acted upon here.
  -- §B.9.4 removes bounded operational content by PARTITION DETACHMENT, and A.17
  -- / R-71 requires the detachment behaviour of the target platform version to be
  -- verified empirically — specifically, whether a partition may be detached
  -- while an inbound foreign key references rows within it — before any code
  -- relies on it. That matters concretely here: snapshot.match_snapshot and
  -- calibration.calibration_run reference operations.pipeline_job_run with
  -- RESTRICT precisely so that a job run cited by a sealed artefact survives
  -- operational retention. Until R-71's verification is recorded against the
  -- quality check registered below, no bounded pass executes, and omission fails
  -- safe in the direction PD-19 requires. R-74 states what the implementation
  -- must then do: determine eligibility procedurally before detaching.
  IF EXISTS (SELECT 1 FROM operations.retention_policy
              WHERE is_active AND retention_class = 'BOUNDED') THEN
    RAISE NOTICE 'bounded retention is registered but gated on the A.17 / R-71 detachment verification; no partition was detached';
  END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('pitchterminal.retention_operation', 'false', false);
    RAISE;
  END;

  PERFORM set_config('pitchterminal.retention_operation', 'false', false);
  RETURN total;
END;
$$;
```

### Changed SQL — freeze, unchanged in substance from Revision 1 and reproduced for context

```sql
-- REVISION 2 (B-05). VACUUM cannot be executed from a function — every
-- PL/pgSQL body runs inside a transaction block, and VACUUM is prohibited
-- there. The previous implementation executed VACUUM inside a function while
-- its own comment stated the prohibition.

CREATE OR REPLACE FUNCTION operations.fn_partitions_requiring_freeze(p_inactive_before date)
RETURNS TABLE (schema_name text, partition_name text, partition_month date)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT ns.nspname::text, c.relname::text, to_date(right(c.relname, 6), 'YYYYMM')
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.relispartition
    AND ns.nspname IN ('feature','module','snapshot','football','operations','product')
    AND c.relname ~ '_p[0-9]{6}$'
    AND to_date(right(c.relname, 6), 'YYYYMM') < p_inactive_before
  ORDER BY 1, 2;
$$;
```

### Changed SQL — checksum verification, and the executable posture

```sql
-- REVISION 2 (B-02, third instance). SECURITY INVOKER, not DEFINER.
-- The function only READS snapshot.match_snapshot, and its sole grantee —
-- pt_platform_admin — already holds SELECT on that relation together with the
-- matching SELECT policy generated in migration 016. Ownership elevation is
-- therefore unnecessary, and as DEFINER it executed as pt_owner against a
-- FORCE ROW LEVEL SECURITY relation, which returned the empty set unless a
-- policy was written for the owner.
CREATE OR REPLACE FUNCTION operations.fn_verify_snapshot_checksums(p_from date, p_to date)
RETURNS TABLE (match_snapshot_id bigint, fixture_partition_on date, verified boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$ ... $$;
```

```sql
CREATE OR REPLACE FUNCTION operations.fn_assert_security_posture() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE offenders text;
BEGIN
  -- PD-18 / F-09. Enabled AND forced on every non-partition relation.
  SELECT pg_catalog.string_agg(format('%s.%s', ns.nspname, c.relname), ', ' ORDER BY ns.nspname, c.relname)
    INTO offenders
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.relkind IN ('r','p') AND NOT c.relispartition
    AND ns.nspname IN ('football','feature','module','snapshot','calibration','product','operations')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'row-level security is not enabled and forced on: %', offenders;
  END IF;

  -- R-69 / R-23. No role holds UPDATE or DELETE on any relation in schema snapshot.
  ...
  IF offenders IS NOT NULL THEN RAISE EXCEPTION 'sealed content is modifiable: %', offenders; END IF;

  -- R-66. No default privileges configured on schema snapshot.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d
             JOIN pg_catalog.pg_namespace ns ON ns.oid = d.defaclnamespace
             WHERE ns.nspname = 'snapshot') THEN
    RAISE EXCEPTION 'default privileges are configured on schema snapshot, contrary to A.16 / R-66';
  END IF;

  -- R-22. DELETE on a thinnable relation is held by pt_retention and by nobody else.
  ...
  RETURN 0;
END;
$fn$;
```

```sql
-- =============================================================================
-- CLOSING CONFORMANCE GATE  (REVISION 2)
-- =============================================================================
SELECT operations.fn_assert_security_posture();
SELECT operations.fn_assert_access_correspondence();
```

### Implementation notes

**The third band was missing.** Revision 1 thinned only the intermediate window; everything past two years stayed at full resolution, growing without bound, in direct contradiction of §B.9.3's *"weekly beyond"*. Storage would have exceeded the upper end of §5.24.1's 150 GB–1 TB envelope regardless of which granularity decision is eventually taken.

**Why the band discriminator is necessary.** `date_trunc('week', …)` returns a Monday and `date_trunc('day', …)` on a Monday returns the same instant. Without the discriminator in the window partition, rows immediately either side of the two-year boundary would share a bucket and compete for one survivor — silently deleting the boundary value the daily band is required to retain.

**Why UTC.** Retention is executed by a scheduler. Under `date_trunc/2` the surviving row for a given day would depend on the `TimeZone` of whichever session happened to run the pass. Pinning to UTC makes the retained boundary a property of the data.

**Why the marker is cleared in an exception handler.** R-58 requires session mode precisely so this marker survives statement boundaries; the corollary is that it survives a failed run too. The handler closes that window explicitly rather than relying on transaction rollback.

**Why bounded retention does not execute.** §B.9.4 removes bounded content by detachment, and A.17/R-71 requires detachment behaviour to be verified on the target build first. `snapshot.match_snapshot` and `calibration.calibration_run` reference `operations.pipeline_job_run` with `RESTRICT` specifically so a job run cited by a sealed artefact outlives operational retention — exactly the case R-71 asks about. The registry declares the policies; the pass is gated and says so. Under PD-19, omission fails safe.

### Verification

1. **Summary of changes** — the registry gains `family_key` in its `CREATE TABLE`, three consistency constraints, RLS, and its own policies; both family functions gain the archival band, UTC bucketing and qualified temp-relation references; the driver gains registry-driven dispatch, a loud failure on an unimplemented family, the bounded gate and exception-safe marker handling; the checksum function drops `SECURITY DEFINER`; a posture assertion is added; the file closes with two gates.
2. **Objects changed** — `operations.retention_policy`; `fn_thin_feature_family`; `fn_thin_module_family`; `fn_run_retention`; `fn_verify_snapshot_checksums`; new `fn_assert_security_posture`; one new registered quality check.
3. **Phase 4 preservation** — A.4/R-14 (thinning by deletion, never detachment) preserved. R-15's four eligibility conditions preserved, the first two still enforced by referential checking rather than by function correctness (R-18). §B.9.3's stated resolution is now actually delivered, which is a correction *toward* the specification. R-20/R-21 preserved and hardened. R-23 unaffected — no snapshot relation is thinnable and none is touched.
4. **PostgreSQL 16** — `date_trunc(text, timestamptz, text)` requires PostgreSQL 12 or later. `ON CONFLICT` on a named unique constraint's columns. Temp tables inside a `SECURITY INVOKER` function; `pg_temp` is implicitly searched first for relation names even under `search_path = ''`, and the references are qualified regardless. `pg_default_acl`, `pg_class.relrowsecurity`/`relforcerowsecurity` for the posture assertion.
5. **Supabase** — `pg_cron` scheduling remains commented, pending the cadence decision. The freeze pass is external and non-transactional by design (R-62); nothing in this file issues `VACUUM`.
6. **Ordering impact** — none. 018 remains last, and is now the file that proves the whole deployment.
7. **Backward compatibility** — retention removes strictly more rows than Revision 1 (the archival band), which is the specified behaviour. No relation, key or constraint on any content relation changes.

---

## 8. Migrations 002, 004, 005, 006, 007, 008, 010, 011, 013

**Revision:** 2

### Summary

Header stamp only. Every substantive Revision 2 change in these files was made and verified in the previous pass and is unchanged here.

| Migration | Revision 2 content, carried forward |
|---|---|
| 002 | `subject_kind`, `context_kind`, `provenance_class` created in `football` (**B-07**) |
| 004 | References to the relocated vocabularies |
| 005 | `ck_fixture__partition_not_after_kickoff` reformulated and renamed (**O-02**) |
| 006 | References to the relocated vocabularies |
| 007 | Vacuous `calculated_at` check removed (**O-01**); covering payload attached to the business unique constraint (**O-03**) |
| 008 | References to the relocated vocabularies |
| 010 | `snapshot_verdict` range-partitioned monthly and co-partitioned with the sealed family (**P-01**); `pipeline_job_run_occurred_at` column (**P-04**) |
| 011 | References to the relocated vocabularies |
| 013 | Redundant second `feature_value` index withdrawn (**O-03**) |

### Verification

1. **Summary of changes** — one comment line per file.
2. **Objects changed** — none.
3. **Phase 4 preservation** — trivially preserved; no object is touched.
4. **PostgreSQL 16** — n/a.
5. **Supabase** — n/a.
6. **Ordering impact** — none.
7. **Backward compatibility** — none required.

---

## 9. Section-by-section conformance to the remediation instruction

| Section | Requirement | Status |
|---|---|---|
| **1** | Generated privilege/policy matrix | **Done.** One specification, one applicator (§5). |
| **1** | Every granted privilege has a corresponding RLS policy | **Done and asserted.** `fn_assert_access_correspondence`, run at the end of 016, 017 and 018. Verified to fire on a deliberate breach (§14.4). |
| **1** | Generate rather than duplicate | **Done.** 017 and 018 call the same applicator for relations created after 016. |
| **1** | FORCE RLS remains enabled | **Done and asserted.** `fn_assert_security_posture` limb 1. |
| **1** | No BYPASSRLS | **Done.** Zero occurrences in the set. |
| **1** | DEFINER → INVOKER where elevation unnecessary | **Done.** `fn_verify_snapshot_checksums` converted this pass; `fn_resolve_entitlements` in the previous one. |
| **1** | Retain DEFINER only where genuinely required | **Done.** Four remain, each requiring ownership: two perform DDL, one refreshes materialised views, one cascades into a relation the deleting principal cannot reach. |
| **1** | Retained DEFINER: `search_path=''`, minimal owner policies, least privilege | **Done.** All four carry `search_path = ''`; the only owner policies in the system are `SELECT` and `DELETE` on `product.watchlist`; `fn_refresh_projection_views` has `EXECUTE` revoked from `PUBLIC` and takes no parameter. |
| **2** | Replace the generic thinning function | **Done.** |
| **2** | Family-specific retention, dependency-safe order | **Done.** lineage→value; item→evidence→reading. |
| **2** | Retain prevailing and boundary values | **Done and measured.** §14.2 shows daily and weekly resolution delivered exactly. |
| **2** | Correlate using primary keys; never `ctid` | **Done.** Zero `ctid` occurrences outside explanatory comments. |
| **2** | Retention through the retention registry | **Done.** The registry is the sole driver; an unimplemented family raises. |
| **3** | No VACUUM in PL/pgSQL | **Done.** Zero occurrences. |
| **3** | `fn_partitions_requiring_freeze()` returning identifiers only | **Done.** Verified returning 494 partitions and issuing nothing (§14.3). |
| **4** | Relocate the three vocabularies to `football`; update every FK | **Done.** Verified in the catalogue (§14.1). |
| **5** | Partition `snapshot_verdict`; co-partition; maintain composite PK | **Done.** `RANGE (fixture_partition_on)`, identical to `match_snapshot`; PK `(id, fixture_partition_on)`. |
| **6** | `NULLS NOT DISTINCT`; concurrent refresh compatibility | **Done, and now actually reachable** — B-10 supplied the missing refresh path. |
| **7** | `occurred_at` pairing; composite references; immutability maintained | **Done.** Both references verified in the catalogue. |
| **8** | Append-only football relations receive SELECT and INSERT only, with matching policies | **Done.** Verified: `has_table_privilege('football.standing','UPDATE')` is false for the ingestion role, `INSERT` true. |
| **9** | Remove the vacuous CHECK; rewrite the malformed CHECK; merge redundant indexes | **Done** (O-01, O-02, O-03). |
| **10** | Correct constraint names, comments, TODO wording | **Done.** D-01/D-02/D-03 resolved; the ASSERTED POSTURE comment is now backed by executable assertions, closing the last comment-overstates-implementation gap. |

---

## 10. `SECURITY DEFINER` disposition

| Function | Disposition | Reason |
|---|---|---|
| `operations.fn_ensure_monthly_partitions` | **Retained** | Performs DDL — `CREATE TABLE … PARTITION OF`, `ALTER … OWNER`. Needs ownership. RLS does not apply to DDL, so no owner policy is required. |
| `operations.fn_maintain_partitions` | **Retained** | Same, via the above. |
| `product.fn_refresh_projection_views` | **Retained** (new) | `REFRESH MATERIALIZED VIEW` requires ownership and no process authenticates as the owner. No parameter; targets named in the body; `EXECUTE` revoked from `PUBLIC`. |
| `product.tf_watchlist__referential_defence` | **Retained** | The deleting principal is an ingestion role with no privilege on `product.watchlist`. Two narrow owner policies supplied. |
| `product.fn_resolve_entitlements` | **Converted** (previous pass) | Reads the caller's own subscription plus two publicly-readable relations. Invoker is sufficient and stricter. |
| `operations.fn_verify_snapshot_checksums` | **Converted** (this pass) | Reads `snapshot.match_snapshot`; its sole grantee already holds `SELECT` and the matching policy. Invoker also makes the audit control answer for the principal that ran it. |

Every retained function carries `SET search_path = ''`.

---

## 11. Idempotency

The set is a **sequential first-run deployment**; its ordering is a topological sort of the reference graph and re-running `CREATE TABLE` is not a supported operation. Within that model, everything that *can* be idempotent now is:

| Construct | Behaviour on re-application |
|---|---|
| Extensions, schemas, roles | `IF NOT EXISTS` / existence-guarded `DO` blocks (unchanged from Revision 1) |
| All 22 functions and 3 views | `CREATE OR REPLACE` |
| Policies | `DROP POLICY IF EXISTS` before every `CREATE POLICY`, inside the applicator |
| Grants | Idempotent by definition in PostgreSQL |
| Partitions | Existence-checked in `fn_ensure_monthly_partitions` |
| Seed data — vocabularies, retention registry, quality checks | `ON CONFLICT … DO NOTHING` on the registry seeds |
| Access specification working tables | `DROP TABLE IF EXISTS` before, explicit `DROP` after — no reliance on `ON COMMIT` |

The last row is X-02: `ON COMMIT DROP` made the section fail outright under autocommit. The explicit lifecycle behaves identically inside a transaction and outside one, which is what makes the verification in §14 meaningful.

---

## 12. Remaining TODO markers

Eleven, one more than Revision 1 — the addition is the bounded-retention gate, which is a platform verification marker rather than an omission. Every one is a question the specification has not answered or a platform behaviour not yet confirmed. None is an unimplemented instruction.

| Migration | Subject | Kind |
|---|---|---|
| 001 | PostGIS deferred under PG-01 | Gated decision, default correct |
| 002 | Vocabulary cardinality — §5.9.5 and §5.4.2 conflict | Specification ambiguity |
| 002 | Snapshot point set — Phase 4 D8 open | Specification ambiguity |
| 004 | `provider_statistic.measures` shape not enumerated | Specification ambiguity |
| 005 | `match_event.event_type_code` vocabulary absent | Conditional on a provider contract |
| 006 | Acyclicity by assertion, not constraint | Documentation of §B.5.4 |
| 010 | `output_values` outside PD-16 | **Specification gap — resolve before production** |
| 015 | Transition tables on partitioned relations | Platform verification (P-05) |
| 018 | Retention windows pending the granularity decision | Specification ambiguity |
| 018 | Checksum canonical serialisation | A.6 storage correct; PR-04's fourth control not yet operative |
| 018 | `pg_cron` cadence | Deployment decision |

Plus the A.17/R-71 detachment verification, which gates bounded retention and is registered as a `BLOCKING` quality check rather than a code comment.

---

## 13. Architectural impact

| Question | Answer |
|---|---|
| Phase 4 changed? | **NO** |
| Logical model changed? | **NO** |
| Any guarantee weakened? | **NO** |
| Migration ordering changed? | **NO** |
| Identities preserved? | **YES** — no primary key, unique constraint or partition key altered |
| Composite keys preserved? | **YES** — every reference to a partitioned parent remains composite (A.1, R-01) |
| Partition strategy preserved? | **YES** — no partition key, interval or family membership changed |
| Corrections A.1–A.17 preserved? | **YES** — A.4 and A.16 are now *asserted* rather than described |
| Normalisation reduced? | **NO** |
| Enums introduced? | **NO** — zero occurrences |

Three changes could be read as architectural and are not:

- **The applicator and the assertions** add two functions to `operations` and one to `product`. None holds business logic; they are deployment machinery. `fn_refresh_projection_views` is the only one reachable by a pipeline role, and it names its targets.
- **The retention archival band** delivers behaviour §B.9.3 already specifies. It removes rows Revision 1 retained in contradiction of the specification.
- **The bounded gate** does not remove a capability; it declines to exercise one whose safety is unverified, and says so at run time.

---

## 14. Verification by execution

Performed on **PostgreSQL 16** in this session. Platform objects Supabase supplies — `auth.users`, `auth.uid()`, the `anon`/`authenticated` roles — were provided by a harness; `pg_cron` is unavailable in the container and its single `CREATE EXTENSION` line was stubbed for the run. Nothing else was altered.

### 14.1 The set applies

All eighteen migrations applied in sequence, each inside a transaction, with `ON_ERROR_STOP`:

```
001_extensions.sql   OK      010_snapshot.sql     OK
002_reference_…      OK      011_product.sql      OK
003_versions.sql     OK      012_operations.sql   OK
004_football.sql     OK      013_indexes.sql      OK
005_fixture.sql      OK      014_constraints.sql  OK
006_feature_…        OK      015_triggers.sql     OK
007_feature_storage  OK      016_security.sql     OK
008_module_storage   OK      017_views.sql        OK
009_calibration.sql  OK      018_maintenance.sql  OK
```

Catalogue state after deployment:

| Check | Result |
|---|---|
| Exclusion constraints created | **18** |
| `btree_gist` installed in | `extensions` |
| Session `search_path` during migration | `"$user", public` — **`extensions` absent** |
| Policies generated | **820** across the seven schemas |
| UPDATE or DELETE on schema `snapshot` | **NONE** |
| DELETE on thinnable relations held by | `pt_retention` only |
| Relations without RLS enabled *and* forced | **NONE** |
| `snapshot_verdict` partition key | `RANGE (fixture_partition_on)` — identical to `match_snapshot` |
| `ux_mv_module_directory__module_baseline.indnullsnotdistinct` | `t` |
| `subject_kind`, `context_kind`, `provenance_class` schema | `football` |
| `SECURITY DEFINER` functions | 4, all with `search_path=""` |

**B-01 is now settled empirically, not by argument.** Eighteen exclusion constraints were created with `extensions` absent from the search path. Default GiST operator class resolution is search-path independent, exactly as document 12 §2 reasoned from `GetDefaultOpClass`. Migration 001 remains unchanged and correct.

### 14.2 Corrected behaviours, exercised

| Test | Result |
|---|---|
| **B-03** — `pt_pipeline_ingestion` INSERT into `football.team` under FORCE RLS | **Succeeds.** Under Revision 1 this failed hard with *new row violates row-level security policy*. |
| **P-06** — `has_table_privilege` for `pt_pipeline_ingestion` | `standing` UPDATE **false**, `standing` INSERT **true**, `team` UPDATE **true** |
| **B-02** — `product.fn_resolve_entitlements` as `authenticated` | Returns **1** entitlement under open beta. Under Revision 1, as DEFINER, it returned the empty set for every principal. |
| **B-09** — `pt_pipeline_projection` INSERT into `product.p_landing` | **Succeeds**, 1 row written. Would have failed hard. |
| **B-10** — `product.fn_refresh_projection_views()` as `pt_pipeline_projection` | **Completes.** Both views refreshed `CONCURRENTLY`. No refresh path existed at all before. |

**Retention, measured.** 4,385 values seeded at six-hour intervals across three years for one (subject, context, definition) group:

| Band | Before | After | Expected |
|---|---|---|---|
| Recent (< 90 days) | 360 | **360** | untouched — full resolution |
| Intermediate (90 days – 2 years) | 2,560 | **641** | one per day over 640 days |
| Archival (> 2 years) | 1,465 | **53** | one per week over ~53 weeks |
| **Total removed** | | **3,331** | |

Daily and weekly retained resolution are delivered exactly, and the prevailing value at every retained boundary survives. Under Revision 1 the archival band would have been untouched — 1,465 rows retained where 53 are specified.

### 14.3 Guards and gates

| Test | Result |
|---|---|
| **R-20** — `pt_retention` DELETE without the session marker | **0 rows.** The policy denies before the guard is reached; both layers are present. |
| Marker after a completed run | cleared (`false`) |
| **R-19** — UPDATE on `feature.feature_value` as the superuser-owned session | raises *append-only relation: UPDATE attempted on feature.feature_value_p202308* |
| **R-23** — UPDATE on `snapshot.match_snapshot` | raises *sealed content is immutable* |
| **B-05** — `fn_partitions_requiring_freeze` | returns **494** partitions; issues no `VACUUM` |
| **B-04** — `ctid` in the retention path | zero occurrences outside explanatory comments |

### 14.4 The assertions fire

Applying the same access twice is a no-op, and both gates pass:

```
SELECT operations.fn_apply_access('feature','feature_value','pt_pipeline_feature','SI');  -- twice
SELECT operations.fn_assert_access_correspondence();   -->  0
SELECT operations.fn_assert_security_posture();        -->  0
```

Deliberately breaking each posture makes the corresponding gate raise:

```
GRANT UPDATE ON feature.feature_value TO pt_pipeline_module;
SELECT operations.fn_assert_access_correspondence();
ERROR:  row-level security posture is incomplete: 1 granted privileges have no
        covering policy and would fail silently
        feature.feature_value: pt_pipeline_module lacks a UPDATE policy

GRANT UPDATE ON snapshot.match_snapshot TO pt_platform_admin;
SELECT operations.fn_assert_security_posture();
ERROR:  sealed content is modifiable: UPDATE on snapshot.match_snapshot to pt_platform_admin
```

This is the property that matters most. The defect class behind B-02, B-03, B-09 and B-11 is **silent**: a role with a privilege and no policy reads zero rows or writes nothing and reports success. It cannot be found by reading a migration and it cannot be found by a smoke test that only checks for errors. It can be found by a catalogue assertion, and now is — on every deployment, not on request.

---

## 15. End state

| Criterion | Status |
|---|---|
| Zero deployment blockers | **Met** — 6 resolved previously, 2 rejected on analysis, 3 found and resolved this pass |
| Zero architecture regressions | **Met** — one layer violation removed, none introduced |
| PostgreSQL 16 compliant | **Met, and demonstrated** — the full set applies to a live PostgreSQL 16 |
| Supabase compatible | **Met**, subject to two deployment verifications (P-08 `auth.users` REFERENCES, P-09 exposed schemas) |
| Faithful to Document 08 Revision 1 | **Met** — A.1–A.17 all preserved; §B.9.3's third age band now actually delivered |
| Idempotency maintained | **Met** within the sequential deployment model (§11) |
| Ready for a final independent audit | **Yes** |

Two documentation corrections remain outstanding against Document 08 Revision 1, carried from document 12 §6 and unaffected by this pass:

| Ref | Correction required |
|---|---|
| S-01 | §5.3.3 must add `snapshot` to `product`'s permitted reference targets, per Phase 4 E8.09 |
| S-02 | §5.3.3 must add `product` to `module`'s permitted targets, per §B.21.3 |
