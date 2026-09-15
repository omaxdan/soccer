// MATCH WORKSPACE RENDER TESTS (DB-free; react-dom/server) + tab-helper unit tests.
//
// Covers the IA shell: state-aware Match Brief (completed vs scheduled — no fake
// score), the four-tab nav (active marking + ?tab= hrefs, default clean), the
// progressive-disclosure Collapsible, and the pure tab helpers.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { MatchHeader, MatchBrief, MatchTabNav, Collapsible } from '@/components/v2/matchWorkspace';
import { resolveMatchTab, matchTabHref, MATCH_TABS } from '@/lib/v2/matchTabs';
import type { ApiMatchHeader, MatchDetailResponse, MatchResult, MatchVenueInfo, CoverageState } from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const VENUE: MatchVenueInfo = { id: '25', name: 'Estádio do Maracanã', city: 'Rio de Janeiro', countryCode: 'BR', latitude: -22.9, longitude: -43.2, elevationMetres: null, timezoneName: 'America/Sao_Paulo', capacity: 78838, surface: 'grass' };
const RESULT: MatchResult = { final: { home: 2, away: 0 }, halfTime: { home: 2, away: 0 }, extraTime: null, penalties: null, confirmedAt: '2026-09-08T19:07:00.000Z' };
const base: ApiMatchHeader = {
  fixtureId: '344', kickoffAt: '2026-09-02T22:30:00.000Z', status: 'COMPLETED',
  competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
  edition: { id: '18', seasonLabel: 'Brasileiro Serie A 2026' },
  homeTeam: { id: '68', name: 'Flamengo', slug: 'flamengo-5981' },
  awayTeam: { id: '59', name: 'Mirassol', slug: 'mirassol-21982' },
  score: { home: 2, away: 0 },
};
const COVERAGE: readonly (readonly [string, CoverageState])[] = [['match', 'present'], ['result', 'present'], ['weather', 'not-supported']];

const DETAIL = (over: Partial<ApiMatchHeader> = {}): MatchDetailResponse => ({
  match: { ...base, ...over },
  form: { home: [], away: [] },
  recentVenueForm: { home: { lastHome: [], lastAway: [] }, away: { lastHome: [], lastAway: [] } },
  intelligence: { home: { readiness: null, homeAwaySplit: null }, away: { readiness: null, homeAwaySplit: null } },
  teamFeatures: { home: { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null }, away: { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null } },
});

describe('MatchHeader — who/when/where', () => {
  test('completed: 2–0, team + venue links, kickoff', () => {
    const markup = html(<MatchHeader context={DETAIL()} venue={VENUE} />);
    assert.match(markup, /href="\/v2\/teams\/flamengo-5981-68"/);
    assert.match(markup, /href="\/v2\/venues\/estadio-do-maracana-25"/);
    const t = text(<MatchHeader context={DETAIL()} venue={VENUE} />);
    assert.match(t, /Flamengo/); assert.match(t, /Mirassol/); assert.match(t, /Estádio do Maracanã/);
  });
  test('scheduled: shows vs, never a fabricated 0–0', () => {
    const t = text(<MatchHeader context={DETAIL({ status: 'SCHEDULED', score: null })} venue={VENUE} />);
    assert.match(t, /\bvs\b/i);
    assert.doesNotMatch(t, /\b0\b/); // no fabricated score
  });
});

describe('MatchBrief — completed', () => {
  const markup = html(<MatchBrief match={base} result={RESULT} venue={VENUE} coverage={COVERAGE} />);
  test('shows score, team/competition/venue links, confirmed state, coverage', () => {
    assert.match(markup, /href="\/v2\/competitions\/brasileirao-betano-325-28"/);
    assert.match(markup, /href="\/v2\/teams\/flamengo-5981-68"/);
    assert.match(markup, /href="\/v2\/venues\/estadio-do-maracana-25"/);
    const t = text(<MatchBrief match={base} result={RESULT} venue={VENUE} coverage={COVERAGE} />);
    assert.match(t, /\b2\b/); assert.match(t, /completed/i); assert.match(t, /confirmed/i);
    assert.match(t, /weather/); // coverage summary
  });
});

describe('MatchBrief — scheduled (no fabricated score)', () => {
  const scheduled: ApiMatchHeader = { ...base, status: 'SCHEDULED', score: null };
  test('shows vs / not yet played and never a 0', () => {
    const t = text(<MatchBrief match={scheduled} result={null} venue={VENUE} coverage={COVERAGE} />);
    assert.match(t, /vs · not yet played/i);
    assert.match(t, /scheduled/i);
    assert.doesNotMatch(t, /\b0\b/);       // no fabricated score/half
    assert.doesNotMatch(t, /confirmed/i);  // no post-match confirmation
  });
});

describe('MatchTabNav', () => {
  const markup = html(<MatchTabNav slug="flamengo-vs-mirassol-344" active="match-data" />);
  test('renders four tabs; default (intelligence) is the clean URL; active marked', () => {
    assert.match(markup, /href="\/v2\/matches\/flamengo-vs-mirassol-344"/);           // intelligence = clean
    assert.match(markup, /href="\/v2\/matches\/flamengo-vs-mirassol-344\?tab=evidence"/);
    assert.match(markup, /href="\/v2\/matches\/flamengo-vs-mirassol-344\?tab=match-data"/);
    assert.match(markup, /href="\/v2\/matches\/flamengo-vs-mirassol-344\?tab=context"/);
    assert.match(markup, /aria-current="page"/);
    assert.equal(MATCH_TABS.length, 4);
  });
});

describe('Collapsible', () => {
  test('renders a details/summary with the children (progressive disclosure)', () => {
    const markup = html(<Collapsible summary="Cited by calculation" count={10}><p>inputs</p></Collapsible>);
    assert.match(markup, /<details/); assert.match(markup, /Cited by calculation/); assert.match(markup, /inputs/); assert.match(markup, /10/);
  });
});

describe('match tab helpers (pure)', () => {
  test('resolveMatchTab defaults to intelligence; accepts known tabs', () => {
    assert.equal(resolveMatchTab(undefined), 'intelligence');
    assert.equal(resolveMatchTab('nope'), 'intelligence');
    assert.equal(resolveMatchTab('evidence'), 'evidence');
    assert.equal(resolveMatchTab('match-data'), 'match-data');
    assert.equal(resolveMatchTab('context'), 'context');
  });
  test('matchTabHref: default tab clean, others carry ?tab=', () => {
    assert.equal(matchTabHref('x-1', 'intelligence'), '/v2/matches/x-1');
    assert.equal(matchTabHref('x-1', 'context'), '/v2/matches/x-1?tab=context');
  });
});
