// ─────────────────────────────────────────────────────────────────────────────
// COMPETITION — entity read model (identity + canonical editions). PURE layer.
//
// The Country → COMPETITION → Edition → Team → Player/Venue/Match keystone.
//
// football.competition is a bigint-identity entity: STABLE identity across all time,
// deliberately independent of name/sponsor (E1.02). This surface is Identity/Context
// ONLY.
//
//   IDENTITY   — id, name, slug, country_code (stored facts, passed through).
//   EDITIONS   — competition_edition rows whose competition_id is this competition
//                (the canonical relationship), gated to governed authorized-active
//                editions and projected to the SHARED ApiEditionSummary.
//   NOT here   — no standings, no fixtures projection, no league intelligence, no
//                ranking, no readiness, no performance, no prediction.
//
// This module is the PURE, DB-free half: mappers + coverage + view/row types. The
// gated composition (getCompetition) lives in handlers.ts, colocated with the Day-1
// governed exposure join it reuses.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiEditionSummary } from '../contract';

// ── contract view types ─────────────────────────────────────────────────────────

/** A competition's canonical identity. */
export interface CompetitionIdentity {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly countryCode: string | null;
}

export interface CompetitionCoverage {
  readonly competition: 'present';                   // always 'present' in a 200 (404 when unknown/unauthorized)
  readonly editions: 'present' | 'absent';
}

export interface CompetitionDetail {
  readonly competition: CompetitionIdentity;
  readonly editions: readonly ApiEditionSummary[];
  readonly coverage: CompetitionCoverage;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

export interface CompetitionRow {
  id: string;
  name: string;
  slug: string;
  country_code: string | null;
}

export interface CompetitionEditionRow {
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  fixture_count: number | string;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

/** Map a stored competition row to its canonical identity. Pure. */
export function mapCompetition(r: CompetitionRow): CompetitionIdentity {
  return { id: r.id, name: r.name, slug: r.slug, countryCode: r.country_code };
}

/** Map an edition row to the SHARED ApiEditionSummary (no second edition representation). Pure. */
export function mapCompetitionEdition(r: CompetitionEditionRow): ApiEditionSummary {
  return {
    id: r.edition_id,
    seasonLabel: r.season_label,
    competition: { id: r.competition_id, name: r.competition_name, slug: r.competition_slug },
    fixtureCount: Number(r.fixture_count),
  };
}

/**
 * Coverage flags. The competition itself is always 'present' in a 200 (an unknown or
 * unauthorized competition is a 404, never an empty-collection 200). `editions` is
 * 'present' when any governed edition is exposed and 'absent' when none — an empty
 * collection is a truthful absence, never zero-filled and never promoted to an error.
 */
export function buildCompetitionCoverage(editions: readonly ApiEditionSummary[]): CompetitionCoverage {
  return { competition: 'present', editions: editions.length > 0 ? 'present' : 'absent' };
}
