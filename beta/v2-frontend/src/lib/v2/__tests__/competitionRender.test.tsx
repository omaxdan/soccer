// COMPETITION WORKSPACE RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Verifies the competition page surfaces render honest, namespace-neutral content:
// identity + season + counts, tab nav with the active tab and non-/pitch hrefs,
// fixture rows linking to the canonical match slug, and — critically — that
// standings and competition intelligence are HONEST unavailable states (no fabricated
// table, no fabricated competition score), with no betting language anywhere.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CompetitionHeader, EditionTabNav, FixtureRow, MatchesPanel,
  TeamsPanel, StandingsUnavailable, CompetitionIntelligenceNote,
} from '@/components/v2/competition';
import { classifyFixtures } from '@/lib/v2/competition';
import type { ApiEditionFixture, ApiEditionSummary, ApiTeam } from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const TEAMS: ApiTeam[] = [
  { id: '599', name: 'Flamengo', slug: 'flamengo-599' },
  { id: '602', name: 'Botafogo', slug: 'botafogo-602' },
];
const FIX: ApiEditionFixture = {
  fixtureId: '1384', kickoffAt: '2026-09-13T12:30:00.000Z', status: 'SCHEDULED',
  homeTeam: TEAMS[0], awayTeam: TEAMS[1], score: null,
};
const SEASONS: ApiEditionSummary[] = [
  { id: '11', seasonLabel: '2026', competition: { id: 'c1', name: 'Série A', slug: 'serie-a' }, fixtureCount: 120 },
];

describe('CompetitionHeader', () => {
  const markup = html(<CompetitionHeader competitionName="Série A" seasonLabel="2026" seasons={SEASONS} currentEditionId="11" teamCount={20} fixtureCount={120} />);
  test('shows competition identity, season and real counts', () => {
    assert.match(markup, /Série A/);
    assert.match(markup, /Season 2026/);
    assert.match(markup, /120 fixtures/);
    assert.match(markup, /20 teams/);
    assert.equal(markup.includes('/pitch'), false);
  });
});

describe('EditionTabNav', () => {
  const markup = html(<EditionTabNav editionId="88" active="matches" />);
  test('renders all tabs, marks the active one, links under /v2, none to /pitch', () => {
    assert.match(markup, /href="\/v2\/editions\/88"/);            // Overview = clean base
    assert.match(markup, /href="\/v2\/editions\/88\?tab=standings"/);
    assert.match(markup, /aria-current="page"/);                  // active = matches
    assert.equal(markup.includes('/pitch'), false);
  });
});

describe('FixtureRow', () => {
  test('links to the canonical match slug', () => {
    assert.match(html(<FixtureRow fixture={FIX} />), /href="\/v2\/matches\/flamengo-vs-botafogo-1384"/);
  });
});

describe('MatchesPanel honest empties', () => {
  test('no fixtures → an honest empty state, no fabricated rows', () => {
    const t = text(<MatchesPanel grouped={classifyFixtures([])} />);
    assert.match(t, /No fixtures are currently available/i);
  });
});

describe('standings + competition intelligence are honest unavailable states', () => {
  const standings = text(<StandingsUnavailable />);
  const intel = text(<CompetitionIntelligenceNote hasMatches={true} />);
  test('standings says not available and carries no fabricated numbers/table', () => {
    assert.match(standings, /not available/i);
    assert.match(standings, /never computes a table/i);
    assert.doesNotMatch(standings, /\b\d+\s*(pts|points)\b/i); // no fabricated points
  });
  test('competition intelligence is framed as per-match sealed, not a competition score', () => {
    assert.match(intel, /per match/i);
    assert.match(intel, /sealed/i);
    assert.match(intel, /no competition-wide governed score/i);
  });
});

describe('no betting language across competition surfaces', () => {
  test('header, tabs, standings, intelligence and teams carry no betting/odds lexicon', () => {
    const all = [
      text(<CompetitionHeader competitionName="Série A" seasonLabel="2026" seasons={SEASONS} currentEditionId="11" teamCount={20} fixtureCount={120} />),
      text(<EditionTabNav editionId="88" active="overview" />),
      text(<StandingsUnavailable />),
      text(<CompetitionIntelligenceNote hasMatches={true} />),
      text(<TeamsPanel teams={TEAMS} />),
    ].join(' ').toLowerCase();
    for (const term of ['odds', 'bookmaker', 'stake', 'wager', 'accumulator', 'payout', 'betting', 'best bet']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
