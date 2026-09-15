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
  TeamsPanel, StandingsTable, StandingsUnavailable, CompetitionIntelligenceNote,
} from '@/components/v2/competition';
import { classifyFixtures } from '@/lib/v2/competition';
import type { ApiEditionFixture, ApiEditionSummary, ApiTeam, EditionStandings } from '@/lib/v2/types';

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
  const markup = html(<EditionTabNav edition="88" active="matches" />);
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

const STANDINGS = (over: Partial<EditionStandings> = {}): EditionStandings => ({
  tables: [{
    variant: 'TOTAL', asOf: '2026-09-06',
    rows: [
      { position: 1, team: { id: '68', name: 'Flamengo', slug: 'flamengo-5981' }, played: 25, won: 18, drawn: 4, lost: 3, goalsFor: 50, goalsAgainst: 20, goalDifference: 30, points: 58 },
      { position: 2, team: { id: '67', name: 'Fluminense', slug: 'fluminense-1961' }, played: 25, won: 15, drawn: 5, lost: 5, goalsFor: 40, goalsAgainst: 25, goalDifference: 15, points: 50 },
    ],
  }],
  coverage: { standings: 'present', variantsPresent: ['TOTAL'], goalDifferenceIsDerived: true, standingsAreObservedSnapshots: true },
  ...over,
});

describe('StandingsTable (governed observed snapshot — not client-computed)', () => {
  test('renders position/P/W/D/L/GF/GA/GD/Pts with team links and signed GD', () => {
    const markup = html(<StandingsTable standings={STANDINGS()} />);
    assert.match(markup, /href="\/v2\/teams\/flamengo-5981-68"/);
    const t = text(<StandingsTable standings={STANDINGS()} />);
    assert.match(t, /Flamengo/); assert.match(t, /58/); assert.match(t, /\+30/); // points + signed GD
    assert.match(t, /as of 2026-09-06/); assert.match(t, /read-layer derivation/i);
  });
  test('limit renders a top-N preview', () => {
    const t = text(<StandingsTable standings={STANDINGS()} limit={1} />);
    assert.match(t, /Flamengo/); assert.doesNotMatch(t, /Fluminense/);
    assert.match(t, /top 1 of 2/i);
  });
  test('absent coverage → honest empty (never a fabricated/computed table)', () => {
    const empty = STANDINGS({ tables: [], coverage: { standings: 'absent', variantsPresent: [], goalDifferenceIsDerived: true, standingsAreObservedSnapshots: true } });
    const t = text(<StandingsTable standings={empty} />);
    assert.match(t, /No standings snapshot has been ingested/i);
  });
});

describe('no betting language across competition surfaces', () => {
  test('header, tabs, standings, intelligence and teams carry no betting/odds lexicon', () => {
    const all = [
      text(<CompetitionHeader competitionName="Série A" seasonLabel="2026" seasons={SEASONS} currentEditionId="11" teamCount={20} fixtureCount={120} />),
      text(<EditionTabNav edition="88" active="overview" />),
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
