// ─────────────────────────────────────────────────────────────────────────────
// PLAYER STATUS / ABSENCE — read model (player-scoped, spell-based, descriptive)
//
// Answers ONLY "what explicit availability evidence is recorded for this player, and
// which spell covers the requested point in time?" — NOT "is this player available?".
// A CONTEXT dimension, independent of Observation/Temporal; never prediction, causal
// interpretation, impact/severity/risk scoring, or a disciplinary/injury inference.
//
// LOCKED GOVERNANCE (v1):
//   • Current/as-of status is ACTIVE_ABSENCE or NO_EXPLICIT_ABSENCE_RECORDED — NEVER
//     AVAILABLE. Absence of a covering spell is not proof of availability: the
//     availability feed is manually accumulated (squad ingestion, not the governed
//     season path) with no completeness/freshness guarantee.
//   • PLAYER-SCOPED only. No team ownership (the table stores none), no team/match
//     endpoint, no derivation from current registration.
//
// SUBSTRATE (football.player_availability — verified, unchanged):
//   • spell_period is a `daterange` with '[)' bounds (lower inclusive, upper exclusive)
//   • open spell  = upper_inf(spell_period); closed spell exposes upper(spell_period)
//   • point-in-time membership = spell_period @> asOfDate (UTC date, PD-08)
//   • same-kind spells cannot overlap (gist exclusion); DIFFERENT kinds MAY overlap —
//     both are preserved, with NO governed precedence between kinds
//   • kinds are exactly INJURY / SUSPENSION / OTHER (text-derived at ingestion; the
//     provider's words are retained verbatim in `reason`)
//   • `expected_return_on` is a provider ESTIMATE, independent of the actual spell end
//   • the closed upper bound is "the date the provider stopped reporting the player as
//     unavailable" — NOT an observed medical/return date
//   • provenance is weaker than the observation tables: NO provider_code, NO
//     retrieved_at; only created_at/updated_at, and spells are MUTATED IN PLACE
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

export type PlayerStatusCode = 'ACTIVE_ABSENCE' | 'NO_EXPLICIT_ABSENCE_RECORDED';

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export interface PlayerStatusSpell {
  readonly id: string;
  readonly kind: string;                    // INJURY | SUSPENSION | OTHER (FK-controlled)
  readonly from: string | null;             // ISO date (lower bound, inclusive)
  readonly to: string | null;               // ISO date (upper bound, exclusive) or null when open
  readonly isOpen: boolean;                 // upper_inf(spell_period)
  readonly activeAtAsOf: boolean;           // spell_period @> asOf date
  readonly expectedReturnOn: string | null; // provider ESTIMATE, independent of `to`
  readonly reason: string | null;           // provider's verbatim words (source evidence)
  readonly severityRank: number | null;     // provider-supplied; NOT a governed score
  readonly recordedAt: string | null;       // created_at (write time; not a provider audit)
  readonly updatedAt: string | null;        // updated_at (spells are mutated in place)
}

export interface PlayerStatusSummary {
  readonly code: PlayerStatusCode;
  readonly kinds: readonly string[]; // kinds of the spells active at asOf (no precedence implied)
}

export interface PlayerStatusResponse {
  readonly player: { readonly id: string; readonly fullName: string; readonly slug: string };
  readonly asOf: string; // ISO cutoff actually applied
  readonly status: PlayerStatusSummary;
  readonly spells: readonly PlayerStatusSpell[]; // full recorded history, chronological
  readonly coverage: {
    readonly type: 'RECORDED_ABSENCE';
    readonly complete: false;
    // NO_EXPLICIT_ABSENCE_RECORDED never means AVAILABLE — the feed is not complete.
    readonly note: string;
  };
  readonly provenance: {
    readonly source: 'football.player_availability';
    readonly recordedVia: 'squad_ingestion';
    readonly spellsAreMutable: true; // closing/correcting a spell updates it in place
    readonly hasProviderAudit: false; // no provider_code / retrieved_at on the substrate
    readonly asOf: string;
    readonly note: string;
  };
}

export interface PlayerAvailabilityOptions {
  readonly asOf?: Date;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

function iso(v: Date | string | null): string | null {
  if (v === null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** Reduce an instant to a UTC date string (YYYY-MM-DD) — the grain of `daterange`
 *  containment, per PD-08 (mirrors readSquadAvailability). */
export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Guard against a zero/epoch sentinel masquerading as a real date (mirrors the
 *  existing mapAvailability behaviour). */
function meaningfulDate(d: string | null): string | null {
  if (d === null || d.trim() === '' || d === '1970-01-01') return null;
  return d;
}

export interface PlayerAvailabilityRow {
  id: string;
  kind: string;
  spell_from: string | null;
  spell_to: string | null;
  is_open: boolean;
  active_at_as_of: boolean;
  expected_return_on: string | null;
  reason: string | null;
  severity_rank: number | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

/** Map one stored spell row to its wire shape. Pure. Dates pass through verbatim
 *  (the daterange bounds are authoritative); only expected_return_on is epoch-guarded. */
export function mapSpell(row: PlayerAvailabilityRow): PlayerStatusSpell {
  return {
    id: row.id,
    kind: row.kind,
    from: row.spell_from,
    to: row.is_open ? null : row.spell_to,
    isOpen: row.is_open,
    activeAtAsOf: row.active_at_as_of,
    expectedReturnOn: meaningfulDate(row.expected_return_on),
    reason: row.reason,
    severityRank: row.severity_rank === null || row.severity_rank === undefined ? null : Number(row.severity_rank),
    recordedAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Derive the as-of status from the spell set. ACTIVE_ABSENCE iff ≥1 spell is active at
 *  asOf; kinds are the DISTINCT kinds of those active spells (sorted, no precedence).
 *  Zero active spells → NO_EXPLICIT_ABSENCE_RECORDED — NEVER AVAILABLE. Pure. */
export function deriveStatus(spells: readonly PlayerStatusSpell[]): PlayerStatusSummary {
  const activeKinds = spells.filter((s) => s.activeAtAsOf).map((s) => s.kind);
  if (activeKinds.length === 0) return { code: 'NO_EXPLICIT_ABSENCE_RECORDED', kinds: [] };
  const kinds = Array.from(new Set(activeKinds)).sort(); // deterministic; no kind outranks another
  return { code: 'ACTIVE_ABSENCE', kinds };
}

const COVERAGE_NOTE =
  'Recorded absence evidence only. "NO_EXPLICIT_ABSENCE_RECORDED" means no covering spell is on record — it does NOT prove the player is available.';
const PROVENANCE_NOTE =
  'Spells are accumulated by squad ingestion and mutated in place (closed/corrected); the substrate carries no provider_code/retrieved_at, so this is current best knowledge of stored spells, not an immutable provider audit trail.';

/** Assemble the response from ordered spell rows. Pure — the status reflects the asOf
 *  the caller applied (already encoded in each row's active_at_as_of). */
export function assemblePlayerStatus(
  player: { id: string; fullName: string; slug: string },
  rows: readonly PlayerAvailabilityRow[],
  asOf: Date,
): PlayerStatusResponse {
  const spells = rows.map(mapSpell);
  return {
    player,
    asOf: asOf.toISOString(),
    status: deriveStatus(spells),
    spells,
    coverage: { type: 'RECORDED_ABSENCE', complete: false, note: COVERAGE_NOTE },
    provenance: {
      source: 'football.player_availability',
      recordedVia: 'squad_ingestion',
      spellsAreMutable: true,
      hasProviderAudit: false,
      asOf: asOf.toISOString(),
      note: PROVENANCE_NOTE,
    },
  };
}

// ── SQL (read-only) ─────────────────────────────────────────────────────────────
//
// Exposure gate mirrors the governed Player Observation / Player Detail gate: the
// player is surfaced ONLY when currently registered (not loaned out) in a governed,
// tracked edition. An unknown OR unexposed player yields null (→ 404). This is a copy
// of the established governed player gate, deliberately not a new mechanism.
const PLAYER_STATUS_IDENTITY_SQL = `
  SELECT p.id::text AS id, p.full_name AS full_name, p.slug AS slug
    FROM football.player p
   WHERE p.id = $1::bigint
     AND EXISTS (
       SELECT 1
         FROM football.player_registration pr
         JOIN football.team_registration tr ON tr.team_id = pr.team_id AND tr.withdrawn_on IS NULL
         JOIN football.competition_edition ce ON ce.id = tr.competition_edition_id
         JOIN governance.tracked_edition te
           ON te.competition_edition_id = ce.id
          AND te.edition_status_code = 'ACTIVE'
          AND te.authorized_for_ingestion = true
         JOIN governance.tracked_competition tc
           ON tc.id = te.tracked_competition_id
          AND tc.tracking_status_code = 'TRACKED'
        WHERE pr.player_id = p.id
          AND pr.registration_kind_code <> 'LOAN_OUT'
          AND pr.registration_period @> current_date
     )
`;

// All recorded spells for the player, chronological. `active_at_as_of` and `is_open`
// are computed in-DB using the authoritative daterange semantics ('[)' bounds).
//   $1 player id · $2 asOf date (YYYY-MM-DD; UTC-reduced)
const PLAYER_STATUS_SPELLS_SQL = `
  SELECT pa.id::text                                        AS id,
         pa.unavailability_kind_code                        AS kind,
         to_char(lower(pa.spell_period), 'YYYY-MM-DD')      AS spell_from,
         CASE WHEN upper_inf(pa.spell_period) THEN NULL
              ELSE to_char(upper(pa.spell_period), 'YYYY-MM-DD') END AS spell_to,
         upper_inf(pa.spell_period)                         AS is_open,
         (pa.spell_period @> $2::date)                      AS active_at_as_of,
         to_char(pa.expected_return_on, 'YYYY-MM-DD')       AS expected_return_on,
         pa.reason                                          AS reason,
         pa.severity_rank                                   AS severity_rank,
         pa.created_at                                      AS created_at,
         pa.updated_at                                      AS updated_at
    FROM football.player_availability pa
   WHERE pa.player_id = $1::bigint
   ORDER BY lower(pa.spell_period) ASC, pa.id ASC
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

/** Returns the player's recorded availability status, or null when the player does not
 *  exist or is not governed-exposed (→ 404). An exposed player with zero spells yields
 *  status NO_EXPLICIT_ABSENCE_RECORDED (NEVER AVAILABLE). Two bounded queries: identity
 *  gate + one spells query — no per-spell N+1. */
export async function readPlayerAvailability(
  tx: PoolClient,
  playerId: string,
  options: PlayerAvailabilityOptions = {},
): Promise<PlayerStatusResponse | null> {
  const identity = await tx.query<{ id: string; full_name: string; slug: string }>(PLAYER_STATUS_IDENTITY_SQL, [playerId]);
  if (identity.rows.length === 0) return null;
  const player = { id: identity.rows[0].id, fullName: identity.rows[0].full_name, slug: identity.rows[0].slug };

  const asOf = options.asOf ?? new Date();
  const rows = await tx.query<PlayerAvailabilityRow>(PLAYER_STATUS_SPELLS_SQL, [playerId, utcDate(asOf)]);
  return assemblePlayerStatus(player, rows.rows, asOf);
}

export { PLAYER_STATUS_IDENTITY_SQL, PLAYER_STATUS_SPELLS_SQL };
