-- =============================================================================
-- 023_module_reading_contract.sql
-- PitchTerminal V2 — the two columns a module reading needs to be written
-- =============================================================================
-- Source of truth : docs/db-v2/73 §4 (S-6 entry contract); docs/db-v2/74 (Gate A)
--                   D-5c-i (doc 58 §1) · D-6 (doc 57) · doc 15 §6.3 INACTIVE reason
-- Depends on      : 008
-- Transactional   : yes
--
-- Purpose
--   Adds exactly the two additive columns S-6 requires before any module reading
--   can be persisted, and nothing else:
--
--     module_version.minimum_sample_observation_count
--     module_reading.inactive_reason
--
--   No engine, no calculator, no registry row, no module version, no reading, no
--   sample_gate, no calibration, no strength-scale column, no module_input
--   relation. Those are later gates (C, D) or belong to S-9.
--
-- Why these two, and only these two
--
--   (1) A reading's sample_meets_threshold is NOT NULL and must be evaluated at
--       S-6 against a per-module-version threshold. D-5c/D-5c-i place the
--       observation-count rule on the module VERSION (as D-2 places the status
--       rule there), so the threshold that rule is compared against belongs on
--       module_version too. This is INDEPENDENT of calibration.sample_gate, which
--       governs PUBLISHED OUTCOME RATES at S-9 (LC-133) — a different thing at a
--       different layer. A reading may be written without S-9 having run.
--
--   (2) Doc 15 §6.3 promises a stored reason for an INACTIVE reading. The schema
--       had no column for it, and ck_module_reading__inactive_is_silent makes an
--       INACTIVE reading carry no strength and no baseline — so without this
--       column an INACTIVE reading could not say WHY it was silent, which is the
--       coverage-honesty distinction (LC-69) INACTIVE exists to preserve.
--
-- Safety
--   Both changes are additive. minimum_sample_observation_count takes DEFAULT 0
--   — "any observation meets", matching feature_definition.meaningful_sample_
--   threshold's own NOT NULL DEFAULT 0 — so the thirteen seeded module_version
--   rows remain valid with no backfill. inactive_reason is nullable; its CHECK is
--   satisfied by every possible row, and module_reading currently holds zero rows
--   in any case. Reversible by dropping the two columns. No data rewrite.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- module_version.minimum_sample_observation_count
--
-- The module version owns its minimum observation threshold, exactly as it owns
-- its status rule (D-2) and its observation-count rule (D-5c). DEFAULT 0 and the
-- >= 0 CHECK mirror feature_definition.meaningful_sample_threshold, so the two
-- layers state the same thing the same way.
-- -----------------------------------------------------------------------------
ALTER TABLE module.module_version
  ADD COLUMN minimum_sample_observation_count integer NOT NULL DEFAULT 0;

ALTER TABLE module.module_version
  ADD CONSTRAINT ck_module_version__minimum_sample_non_negative
  CHECK (minimum_sample_observation_count >= 0);

COMMENT ON COLUMN module.module_version.minimum_sample_observation_count IS
  'D-5c / D-5c-i. The minimum module_reading.sample_observation_count at which a
   reading of THIS version is treated as meeting its threshold. Owned by the
   version, like the status rule (D-2) and the count rule (MIN(consumed) at
   1.0.0). DEFAULT 0 = any observation meets, matching feature_definition.
   meaningful_sample_threshold. INDEPENDENT of calibration.sample_gate, which
   gates published OUTCOME RATES at S-9 (LC-133) — a reading is written and
   thresholded at S-6 without S-9 having run.';

-- -----------------------------------------------------------------------------
-- module_reading.inactive_reason
--
-- Added to the partitioned parent, so it cascades to every partition. The CHECK
-- enforces a reason EXACTLY when the reading is INACTIVE: an INACTIVE reading
-- must say why it was silent, and a reading that spoke (SUPPORTS/NEUTRAL/
-- CONTRADICTS) carries no such reason. This complements — and does not conflict
-- with — ck_module_reading__inactive_is_silent (INACTIVE => NULL strength and
-- NULL published_baseline_id): one governs what an INACTIVE reading may NOT
-- carry, this governs what it MUST carry.
-- -----------------------------------------------------------------------------
ALTER TABLE module.module_reading
  ADD COLUMN inactive_reason text;

ALTER TABLE module.module_reading
  ADD CONSTRAINT ck_module_reading__inactive_reason_iff_inactive
  CHECK ((module_status_code = 'INACTIVE') = (inactive_reason IS NOT NULL));

COMMENT ON COLUMN module.module_reading.inactive_reason IS
  'D-6 / doc 15 §6.3. Why an INACTIVE reading was silent (e.g. FEATURE_ABSENT).
   Present iff module_status_code = INACTIVE — a silent reading must be
   explainable, and a reading that spoke has no inactive reason. Complements
   ck_module_reading__inactive_is_silent, which forbids strength/baseline on the
   same rows. Preserves the LC-69 INACTIVE-vs-NEUTRAL distinction: a module that
   could not speak is legible as such, not indistinguishable from one that spoke
   and found nothing.';
