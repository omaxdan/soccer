-- =============================================================================
-- 022_competition_edition_provider_alternate_key.sql
-- PitchTerminal V2 — the alternate key competition_edition was always meant to have
-- =============================================================================
-- Source of truth : Document 08 §5.6.6; docs/db-v2/41 decision D-4
-- Depends on      : 004
-- Transactional   : yes
--
-- Purpose
--   Adds the provider alternate-key unique constraint to
--   football.competition_edition. It is the only relation in schema football
--   that carries provider_external_id and enforces nothing on it.
--
-- Why this is conformance, not a new rule
--   §5.6.6: "Provider-supplied external identifiers are alternate keys, never
--   business keys. They are UNIQUE AND ARE ENFORCED AS SUCH, but identity does
--   not depend on them."
--
--   Enforced by every sibling:
--     competition  uq_competition__provider_external_id  (provider_code, provider_external_id)
--     team         uq_team__provider_external_id         (provider_code, provider_external_id)
--     player       uq_player__provider_external_id       (provider_code, provider_external_id)
--     venue        uq_venue__provider_external_id        (provider_external_id)
--     official     uq_official__provider_external_id     (provider_external_id)
--     competition_edition                                — NOTHING
--
--   The physical catalogue (08 §5.20.1) names a provider alternate key for
--   E1.02, E1.05 and E1.06 and none for E1.03, yet migration 004 added the
--   column regardless. The column arrived without the constraint its rule
--   attaches to it, and F-1 is what that omission cost: one provider season
--   (season.id 87678) became two editions, and nothing in the database could
--   object because no constraint mentioned the provider identifier.
--
-- Why (provider_external_id) and NOT (provider_code, provider_external_id)
--   The convention in 004 is consistent and structural, not arbitrary:
--
--     provider identity MANDATORY  →  provider_code NOT NULL
--                                  +  provider_external_id NOT NULL
--                                  +  UNIQUE (provider_code, provider_external_id)
--                                     — competition, team, player
--
--     provider identity OPTIONAL   →  no provider_code column
--                                  +  provider_external_id nullable
--                                  +  UNIQUE (provider_external_id)
--                                     — venue, official
--
--   competition_edition has no provider_code column and a nullable
--   provider_external_id, so it is structurally in the second group and takes
--   the second form. Adding provider_code purely to permit the two-column shape
--   would be inventing a column to satisfy a pattern this relation does not
--   belong to.
--
-- NULLS DISTINCT is deliberate, and is the DEFAULT
--   An edition whose season the provider does not identify must remain
--   possible, and several such editions must be able to coexist. That is the
--   opposite of migration 020's NULLS NOT DISTINCT cases, where a null-bearing
--   identity had to collide rather than duplicate. Here nulls must not collide.
--
-- Business identity is UNCHANGED
--   uq_competition_edition__competition_period (competition_id, season_period)
--   remains the business key, and ex_competition_edition__periods_do_not_overlap
--   remains the guarantee that a competition's seasons do not overlap. This
--   migration adds an alternate key beside them; it demotes nothing.
--
-- R-43 and why the direct form is used
--   R-43 prescribes CREATE UNIQUE INDEX CONCURRENTLY followed by ADD CONSTRAINT
--   USING INDEX for a POPULATED unpartitioned relation, because the direct form
--   holds ACCESS EXCLUSIVE while it builds. The precondition below reports the
--   row count. This relation is empty in every environment this migration is
--   authorised for — no fixture ingestion has ever been run — so the direct
--   form takes a brief lock on nothing and the migration stays transactional.
--   If a future deployment finds it populated at scale, the notice says so and
--   R-43's pattern should be used instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Precondition: the constraint must be satisfiable
-- -----------------------------------------------------------------------------
-- A duplicate here is F-1 having already happened. It is NOT repaired by this
-- migration: repair means choosing a surviving edition and repointing nine
-- foreign keys across five schemas, which is a governed reconciliation and not
-- a schema change. The migration refuses and names the offending seasons.
DO $$
DECLARE
  duplicates text;
  populated  bigint;
BEGIN
  SELECT string_agg(format('provider_external_id=%s (%s rows)', provider_external_id, n), ', ')
    INTO duplicates
    FROM (
      SELECT provider_external_id, count(*) AS n
        FROM football.competition_edition
       WHERE provider_external_id IS NOT NULL
       GROUP BY provider_external_id
      HAVING count(*) > 1
    ) AS d;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION
      'migration 022 precondition unmet; one provider season resolves to more than one edition: %',
      duplicates
      USING HINT = 'This is F-1 (docs/db-v2/41). Reconcile the editions under governance before adding the constraint; do not delete rows from the pipeline, which holds no DELETE on football.';
  END IF;

  SELECT count(*) INTO populated FROM football.competition_edition;
  IF populated > 0 THEN
    RAISE NOTICE
      'football.competition_edition holds % rows. The direct ADD CONSTRAINT below holds ACCESS EXCLUSIVE while it builds; if that is material at this size, use R-43 (CREATE UNIQUE INDEX CONCURRENTLY, then ADD CONSTRAINT USING INDEX) instead.',
      populated;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- The alternate key
-- -----------------------------------------------------------------------------

ALTER TABLE football.competition_edition
  ADD CONSTRAINT uq_competition_edition__provider_external_id
  UNIQUE (provider_external_id);

COMMENT ON CONSTRAINT uq_competition_edition__provider_external_id
  ON football.competition_edition IS
  'Provider alternate key (§5.6.6), matching venue and official — the two other football relations whose provider identity is optional and which therefore carry no provider_code column. ONE PROVIDER SEASON IS ONE EDITION: this is what makes that enforceable rather than merely intended, and it is what F-1 lacked. Identity remains uq_competition_edition__competition_period; this constraint is what the resolver targets, not what the entity is.';
