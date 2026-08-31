-- =============================================================================
-- 033_measured_module_status.sql
-- PitchTerminal V2 — add the MEASURED module status (S-9C, owner OD-1)
-- =============================================================================
-- Source of truth : S-9A Design Decision Register OD-1 (RATIFIED); the S-9C
--                   Magnitude Output Implementation authorization.
-- Depends on      : 002 (module.module_status reference vocabulary)
-- Transactional   : yes
--
-- Purpose
--   Adds a fifth module status, MEASURED, as an ADDITIVE, engaged, NON-DIRECTIONAL
--   code. It represents a valid measured/characterised module result that is NOT
--   asserting SUPPORTS, NEUTRAL, or CONTRADICTS. It exists so magnitude-bearing
--   modules (giant_killer_index, consistency_index) can emit their measurement at
--   the new 2.0.0 version without a fabricated direction or threshold.
--
--   is_engaged = true: a MEASURED reading spoke (it is not INACTIVE). It is
--   distinct from NEUTRAL, which means "spoke and found nothing of consequence".
--
-- Why a migration
--   module.module_status is a reference vocabulary owned by the migration layer
--   (seeded in 002), not by the TypeScript registry seed. Adding a code is a
--   reference-data change and belongs here.
--
-- Safety
--   Data-only, additive, idempotent. Creates no schema object; alters no existing
--   status row; does not touch any module_reading. INSERT ... ON CONFLICT DO
--   NOTHING makes a re-run a no-op. Existing statuses (SUPPORTS/NEUTRAL/
--   CONTRADICTS/INACTIVE) and their meanings are unchanged.
-- =============================================================================

INSERT INTO module.module_status (code, display_name, meaning, is_engaged) VALUES
  ('MEASURED', 'Measured',
   'The module produced a valid non-directional measured/characterised result. It does not assert SUPPORTS, NEUTRAL, or CONTRADICTS. Distinct from NEUTRAL, which means the module spoke and found nothing of consequence.',
   true)
ON CONFLICT ON CONSTRAINT pk_module_status DO NOTHING;
