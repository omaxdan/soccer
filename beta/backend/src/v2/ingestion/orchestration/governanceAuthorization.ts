// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANCE AUTHORIZATION — the ONE definition of "authorized for ingestion".
//
// The authorization contract (Doc 95 / V8) is three governance-status facts:
//   a TRACKED competition, an ACTIVE edition, explicitly authorized.
// Two callers need it, and they must never drift:
//   • governedSeason  — asks "is THIS one (competition, season) authorized?"
//                       (status conjuncts + an identity match on the three ids)
//   • governedSelection — asks "WHICH editions are authorized right now?"
//                       (status conjuncts only; returns the set)
//
// So the shared essence is the FROM/JOIN plus the STATUS conjuncts, defined once
// here. The single-edition check adds the IDENTITY conjuncts; the set enumerator
// adds nothing. Both are built from the same status string, which is what keeps
// them in lockstep — asserted by a parity test.
//
// READ-ONLY. Every statement here is a SELECT. Nothing in this module mutates
// governance, calls the provider, or ingests.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE AUTHORIZATION STATUS CONJUNCTS — the essence of "authorized for ingestion".
 * Shared verbatim by the single-edition check and the set enumerator so the two
 * cannot diverge. Leading `\n` + indentation is cosmetic only.
 */
export const AUTHORIZATION_STATUS_CONJUNCTS = `tc.tracking_status_code = 'TRACKED'
    AND te.edition_status_code = 'ACTIVE'
    AND te.authorized_for_ingestion = true`;

/**
 * The identity match for ONE explicit edition. Parameter order is fixed:
 *   $1 = provider_code, $2 = competition provider_external_id, $3 = season id.
 */
export const AUTHORIZATION_IDENTITY_CONJUNCTS = `tc.provider_code = $1
    AND tc.provider_external_id = $2
    AND te.provider_season_external_id = $3`;

const FROM_JOIN = `FROM governance.tracked_competition tc
  JOIN governance.tracked_edition te ON te.tracked_competition_id = tc.id`;

/**
 * Single-edition authorization COUNT. Exact count so the caller distinguishes
 * none / one / many. Params: (provider_code, competition ext id, season ext id).
 */
export const AUTHORIZATION_COUNT_SQL = `
  SELECT count(*)::int AS n
  ${FROM_JOIN}
  WHERE ${AUTHORIZATION_IDENTITY_CONJUNCTS}
    AND ${AUTHORIZATION_STATUS_CONJUNCTS}
`;

/**
 * SINGLE-EDITION AUTHORIZATION LOCK. The at-commit re-check (Gate 4).
 *
 * Row-returning (not count) because the locking clause `FOR SHARE` is not allowed
 * with an aggregate. It composes the SAME identity + status conjuncts as
 * AUTHORIZATION_COUNT_SQL, so the predicate stays single-sourced — only the
 * projection and the lock differ.
 *
 * `FOR SHARE OF tc, te` takes a shared row lock on the matched governance rows:
 * a concurrent `UPDATE tracked_edition SET authorized_for_ingestion = false`
 * (or any revoking mutation of those rows) must wait until this transaction
 * commits or rolls back. Combined with running this as the FINAL statement before
 * commit, that means football is committed only while authorization is held AND
 * locked — Level 3. `FOR SHARE` needs only SELECT privilege, which
 * pt_pipeline_ingestion holds (migration 025), and reads the rows its SELECT
 * policy already exposes. The caller checks that exactly one row returns.
 */
export const AUTHORIZATION_LOCK_SQL = `
  SELECT te.id
  ${FROM_JOIN}
  WHERE ${AUTHORIZATION_IDENTITY_CONJUNCTS}
    AND ${AUTHORIZATION_STATUS_CONJUNCTS}
  FOR SHARE OF tc, te
`;

/**
 * ALL authorized editions — no parameters, returns the whole authorized set.
 * Columns are AUTHORIZATION FACTS ONLY: provider identity, the reality linkage,
 * and the season_period bound. NO window, priority, freshness, or budget — those
 * are other layers (scheduler / window policy), deliberately absent here.
 *
 * `season_period` is exposed as its two bounds; it is a legitimacy fact, NOT an
 * ingestion window. Deriving a window from it is Gate 4+, not this selector.
 */
export const AUTHORIZED_EDITIONS_SQL = `
  SELECT
    tc.provider_code               AS provider_code,
    tc.provider_external_id        AS competition_provider_external_id,
    te.provider_season_external_id AS season_provider_external_id,
    tc.competition_id              AS competition_id,
    te.competition_edition_id      AS competition_edition_id,
    lower(te.season_period)        AS season_from,
    upper(te.season_period)        AS season_to
  ${FROM_JOIN}
  WHERE ${AUTHORIZATION_STATUS_CONJUNCTS}
`;
