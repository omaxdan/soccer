// ENTITY KEYSTONE RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Verifies the Competition / Country / Venue Layer-1 surfaces render honest,
// namespace-neutral identity + canonical relationships:
//   • cross-links use the CANONICAL public URLs (stored slug + trailing DB id;
//     venue = slugify(name)+id; competition editions = established hybrid);
//   • nullable geographic fields render as an em dash — never zero-filled;
//   • empty governed collections show honest empty states (no fabricated members);
//   • no prediction / probability / readiness / travel / betting language anywhere.
//
// Identity resolution itself (trailing-id extraction; a changed human part never
// changes which id resolves; unknown → notFound) is proven in routes/slug tests; the
// pages are thin wrappers around idFromParam + fetch + notFound + these components.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CompetitionHeaderPanel, CompetitionEditionsPanel,
  CountryHeaderPanel, CountryCompetitionsPanel, CountryTeamsPanel,
  VenueHeaderPanel, VenueGeographyPanel, VenueHomeTeamsPanel,
} from '@/components/v2/entity';
import { idFromParam } from '@/lib/v2/slug';
import type { ApiCompetitionSummary, ApiEditionSummary, ApiTeamSummary, CompetitionResponse, CountryResponse, VenueResponse } from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const COMPETITION: CompetitionResponse['competition'] = { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325', countryCode: 'BR' };
const EDITIONS: ApiEditionSummary[] = [
  { id: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, fixtureCount: 286 },
];
const COUNTRY: CountryResponse['country'] = { code: 'BR', name: 'Brazil', alpha3Code: 'BRA' };
const TEAMS: ApiTeamSummary[] = [{ id: '68', name: 'Flamengo', slug: 'flamengo-5981', shortName: 'Flamengo', countryCode: 'BR' }];
const COMPS: ApiCompetitionSummary[] = [{ id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }];
const VENUE_FULL: VenueResponse['venue'] = { id: '25', name: 'Estádio do Maracanã', city: 'Rio de Janeiro', countryCode: 'BR', latitude: -22.91216, longitude: -43.23018, elevationMetres: 9, timezoneName: 'America/Sao_Paulo', capacity: 78838, surface: 'grass' };
const VENUE_SPARSE: VenueResponse['venue'] = { id: '99', name: 'Unknown Ground', city: null, countryCode: null, latitude: null, longitude: null, elevationMetres: null, timezoneName: null, capacity: null, surface: null };
const HOME_TEAMS: ApiTeamSummary[] = [{ id: '67', name: 'Fluminense', slug: 'fluminense-1961', shortName: 'FLU', countryCode: 'BR' }];

describe('Competition surface', () => {
  test('header shows name, canonical slug and countryCode', () => {
    const t = text(<CompetitionHeaderPanel competition={COMPETITION} />);
    assert.match(t, /Brasileirão Betano/);
    assert.match(t, /brasileirao-betano-325/);
    assert.match(t, /BR/);
  });
  test('editions link to the established hybrid URL and show fixtureCount verbatim', () => {
    const markup = html(<CompetitionEditionsPanel editions={EDITIONS} />);
    assert.match(markup, /href="\/v2\/editions\/brasileirao-betano-325-brasileiro-serie-a-2026-18"/);
    assert.match(markup, /286 fixtures/);
    assert.equal(idFromParam('brasileirao-betano-325-brasileiro-serie-a-2026-18'), 18); // API gets the id
    assert.equal(markup.includes('/pitch'), false);
  });
  test('no editions → honest empty state (no fabricated edition)', () => {
    assert.match(text(<CompetitionEditionsPanel editions={[]} />), /No governed editions/i);
  });
});

describe('Country surface', () => {
  test('header shows name, alpha-2 code and alpha-3 when present', () => {
    const t = text(<CountryHeaderPanel country={COUNTRY} />);
    assert.match(t, /Brazil/);
    assert.match(t, /BR/);
    assert.match(t, /BRA/);
  });
  test('alpha-3 absent → not fabricated', () => {
    const t = text(<CountryHeaderPanel country={{ code: 'XK', name: 'Kosovo', alpha3Code: null }} />);
    assert.match(t, /Kosovo/);
    assert.doesNotMatch(t, /·\s*null/i);
  });
  test('competition links use the canonical competition slug + id', () => {
    assert.match(html(<CountryCompetitionsPanel competitions={COMPS} />), /href="\/v2\/competitions\/brasileirao-betano-325-28"/);
  });
  test('team links use the canonical team slug + id', () => {
    assert.match(html(<CountryTeamsPanel teams={TEAMS} />), /href="\/v2\/teams\/flamengo-5981-68"/);
  });
  test('empty governed collections → honest empty states', () => {
    assert.match(text(<CountryCompetitionsPanel competitions={[]} />), /No governed competitions/i);
    assert.match(text(<CountryTeamsPanel teams={[]} />), /No governed teams/i);
  });
});

describe('Venue surface', () => {
  test('header shows name, city and countryCode', () => {
    const t = text(<VenueHeaderPanel venue={VENUE_FULL} />);
    assert.match(t, /Estádio do Maracanã/);
    assert.match(t, /Rio de Janeiro/);
    assert.match(t, /BR/);
  });
  test('geography renders coordinates, elevation, timezone, capacity, surface as evidence', () => {
    const t = text(<VenueGeographyPanel venue={VENUE_FULL} />);
    assert.match(t, /-22\.91216, -43\.23018/);
    assert.match(t, /America\/Sao_Paulo/);
    assert.match(t, /78838/);
    assert.match(t, /grass/);
  });
  test('nullable geographic fields render as em dash — never zero-filled', () => {
    const t = text(<VenueGeographyPanel venue={VENUE_SPARSE} />);
    // coordinates, elevation, timezone, capacity, surface all absent → em dashes.
    assert.match(t, /—/);
    assert.doesNotMatch(t, /\b0\b/);              // capacity/elevation NOT zero-filled
    const headerText = text(<VenueHeaderPanel venue={VENUE_SPARSE} />);
    assert.match(headerText, /—/);                 // null city shows a dash
    assert.doesNotMatch(headerText, /null/);
  });
  test('home teams link with the canonical team slug + id; empty → honest empty state', () => {
    assert.match(html(<VenueHomeTeamsPanel homeTeams={HOME_TEAMS} />), /href="\/v2\/teams\/fluminense-1961-67"/);
    assert.match(text(<VenueHomeTeamsPanel homeTeams={[]} />), /No canonical home teams/i);
  });
});

describe('Layer-1 surfaces carry no intelligence/travel/betting language', () => {
  test('none of prediction/probability/readiness/travel/betting lexicon appears', () => {
    const all = [
      text(<CompetitionHeaderPanel competition={COMPETITION} />),
      text(<CompetitionEditionsPanel editions={EDITIONS} />),
      text(<CountryHeaderPanel country={COUNTRY} />),
      text(<CountryCompetitionsPanel competitions={COMPS} />),
      text(<CountryTeamsPanel teams={TEAMS} />),
      text(<VenueHeaderPanel venue={VENUE_FULL} />),
      text(<VenueGeographyPanel venue={VENUE_FULL} />),
      text(<VenueHomeTeamsPanel homeTeams={HOME_TEAMS} />),
    ].join(' ').toLowerCase();
    for (const term of ['predicted', 'prediction', 'probability', 'readiness', 'travel', 'distance', 'fatigue', 'forecast', 'odds', 'bookmaker', 'stake', 'wager', 'betting', 'recommend']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
