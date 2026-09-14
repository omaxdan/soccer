// ─────────────────────────────────────────────────────────────────────────────
// COUNTRY — entity read model (identity + canonical membership). PURE layer.
//
// The parent keystone of the entity hierarchy
//   Country → Competition → Edition → Team → Player → Venue → Match.
//
// football.country is a governed CODE VOCABULARY (E1.01), not a bigint entity:
// its identity is the ISO 3166-1 alpha-2 `code`. It carries NO geography — every
// geographic fact lives on football.venue. This surface is Identity/Context ONLY.
//
//   IDENTITY   — code, display name, ISO alpha-3 (stored facts, passed through).
//   NOT here   — `meaning` / `effective_*` (governance-vocabulary internals),
//                coordinates, ranking, readiness, performance, prediction, travel.
//
// This module is the PURE, DB-free half: mappers + coverage + view/row types.
// The gated composition (getCountry) lives in handlers.ts, colocated with the
// Day-1 governed exposure joins it reuses for teams and competitions.
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiTeamSummary, ApiCompetitionSummary } from '../contract';

// ── contract view types ─────────────────────────────────────────────────────────

/** A country's canonical identity — the governed vocabulary fields only. */
export interface CountryIdentity {
  readonly code: string;               // ISO 3166-1 alpha-2 (primary identifier)
  readonly name: string;               // display_name (NOT NULL)
  readonly alpha3Code: string | null;  // ISO 3166-1 alpha-3, when stored
}

export interface CountryCoverage {
  readonly country: 'present';                       // always 'present' in a 200 (404 when the code is unknown)
  readonly teams: 'present' | 'absent';
  readonly competitions: 'present' | 'absent';
}

export interface CountryDetail {
  readonly country: CountryIdentity;
  readonly teams: readonly ApiTeamSummary[];
  readonly competitions: readonly ApiCompetitionSummary[];
  readonly coverage: CountryCoverage;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

export interface CountryRow {
  code: string;
  display_name: string;
  alpha3_code: string | null;
}

export interface CountryCompetitionRow {
  id: string;
  name: string;
  slug: string;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

/** Map a stored country row to its canonical identity. Pure. Vocabulary internals dropped. */
export function mapCountry(r: CountryRow): CountryIdentity {
  return { code: r.code, name: r.display_name, alpha3Code: r.alpha3_code };
}

/** Map a competition row to the shared competition summary. Pure. */
export function mapCompetitionSummary(r: CountryCompetitionRow): ApiCompetitionSummary {
  return { id: r.id, name: r.name, slug: r.slug };
}

/**
 * Coverage flags for the composed response. The country itself is always 'present'
 * in a 200 (an unknown code is a 404, never an empty-collection 200). Each collection
 * is 'present' when non-empty and 'absent' when empty — an empty collection is a
 * truthful absence, never zero-filled and never promoted to an error.
 */
export function buildCountryCoverage(
  teams: readonly ApiTeamSummary[],
  competitions: readonly ApiCompetitionSummary[],
): CountryCoverage {
  return {
    country: 'present',
    teams: teams.length > 0 ? 'present' : 'absent',
    competitions: competitions.length > 0 ? 'present' : 'absent',
  };
}
