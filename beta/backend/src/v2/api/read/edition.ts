// ─────────────────────────────────────────────────────────────────────────────
// EDITION — entity read model (identity + governed competition). PURE layer.
//
// The Country → Competition → EDITION → Team/Fixture/… keystone. A competition
// edition is a competition in a specific season (E1.03) — the most load-bearing
// Layer-1 entity. This surface is Identity/Context ONLY.
//
//   IDENTITY    — edition id, season label (stored facts, passed through).
//   COMPETITION — the parent competition via competition_edition.competition_id
//                 (the canonical relationship, NOT inferred from fixtures).
//   NOT here    — no fixtures list, no standings, no fixture count (the target
//                 contract omits it and it is not calculated), no team roster,
//                 no league intelligence, ranking, readiness, or prediction.
//
// This module is the PURE, DB-free half: mapper + coverage + view/row types. The
// gated read (getEditionDetail) lives in handlers.ts and REUSES the existing
// EDITION_HEADER_SQL — the same DAY1_AUTHORIZED_EDITION_JOIN gate as the edition
// list, fixtures and standings surfaces — so no new authorization rule is created.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiEditionIdentity, EditionCoverage } from '../contract';

// ── raw row shape (matches EDITION_HEADER_SQL) ──────────────────────────────────

export interface EditionIdentityRow {
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

/**
 * Map a gated edition-header row to the canonical edition identity + its parent
 * competition. Pure. The competition comes from the canonical competition_id join,
 * never inferred from fixtures. Mirrors the edition header already projected by the
 * fixtures and standings endpoints (no second edition representation).
 */
export function mapEditionIdentity(r: EditionIdentityRow): ApiEditionIdentity {
  return {
    id: r.edition_id,
    seasonLabel: r.season_label,
    competition: { id: r.competition_id, name: r.competition_name, slug: r.competition_slug },
  };
}

/**
 * Coverage flags. The edition itself is always 'present' in a 200 (an unknown or
 * unauthorized edition is a 404, never an empty-body 200). Competition is invariantly
 * 'present': competition_edition.competition_id is NOT NULL and EDITION_HEADER_SQL
 * inner-joins the competition, so every resolvable edition carries one — the 'absent'
 * literal is retained only for coverage-shape parity with sibling surfaces.
 */
export function buildEditionCoverage(): EditionCoverage {
  return { edition: 'present', competition: 'present' };
}
