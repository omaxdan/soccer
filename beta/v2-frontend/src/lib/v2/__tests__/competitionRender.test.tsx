// COMPETITION / EDITION WORKSPACE RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Verifies the reconciled Edition workspace renders honest, namespace-neutral content:
// identity header (breadcrumb Country › Competition › Edition, meta cells) with the three
// shipped tabs (Overview · Table · Fixtures), a real semantic standings table (Pos · Team
// · P · W · D · L · GF · GA · GD · Pts) with team links and signed GD, the Overview fixture
// strip, and honest empty/unavailable states — with NO qualification/relegation zones,
// NO fabricated numbers, and no betting language anywhere.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CompetitionHeader, EditionTabNav, StandingsTable, StandingsEmpty, StandingsUnavailable,
  FixtureStrip, QualificationZonesNote, EditionFactsRail, DataAvailableRail, standingsVariantLabel,
} from '@/components/v2/competition';
import type { ApiEditionFixture, ApiEditionSummary, StandingTable } from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const COMPETITION = { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' };
const EDITIONS: ApiEditionSummary[] = [
  { id: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: COMPETITION, fixtureCount: 286 },
];
const EDITION_REF = { id: '18', competition: { slug: 'brasileirao-betano-325' }, seasonLabel: 'Brasileiro Serie A 2026' };

const TABLE: StandingTable = {
  variant: 'TOTAL', asOf: '2026-08-11',
  rows: [
    { position: 1, team: { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }, played: 22, won: 14, drawn: 6, lost: 2, goalsFor: 38, goalsAgainst: 16, goalDifference: 22, points: 48 },
    { position: 20, team: { id: '57', name: 'Chapecoense', slug: 'chapecoense-1973' }, played: 21, won: 1, drawn: 7, lost: 13, goalsFor: 20, goalsAgainst: 43, goalDifference: -23, points: 10 },
  ],
};

function fx(id: string, kickoffAt: string, status: string, home: string, away: string, score: { home: number; away: number } | null = null): ApiEditionFixture {
  const t = (n: string) => ({ id: n, name: n, slug: n.toLowerCase() });
  return { fixtureId: id, kickoffAt, status, homeTeam: t(home), awayTeam: t(away), score };
}

describe('CompetitionHeader', () => {
  const markup = html(
    <CompetitionHeader
      country={{ code: 'BR', name: 'Brazil', alpha3Code: 'BRA' }}
      competition={COMPETITION} seasonLabel="Brasileiro Serie A 2026"
      editions={EDITIONS} currentEditionId="18" editionRef={EDITION_REF}
      fixtureCount={286} asOf="2026-08-11" variantLabel="Overall" activeTab="overview" />
  );
  test('shows identity, breadcrumb, meta cells and the three tabs', () => {
    assert.match(markup, /Brasileirão Betano/);
    assert.match(markup, /Brazil/);
    assert.match(markup, /Brasileiro Serie A 2026/);
    assert.match(markup, /286/);
    assert.match(markup, /11 Aug 2026/);
    assert.match(markup, /Overall/);
    // breadcrumb links use the real entity routes
    assert.match(markup, /href="\/v2"/);                          // Competitions index
    assert.match(markup, /href="\/v2\/countries\/BR"/);           // country
    assert.match(markup, /href="\/v2\/competitions\/brasileirao-betano-325-28"/); // competition
    // three-tab nav, overview active, links under /v2 (readable edition slug)
    assert.match(markup, /href="\/v2\/editions\/[^"]*\?tab=table"/);
    assert.match(markup, /href="\/v2\/editions\/[^"]*\?tab=fixtures"/);
    assert.match(markup, /aria-current="page"/);
    assert.equal(markup.includes('/pitch'), false);
  });
  test('one H1 (the competition name)', () => {
    assert.equal((markup.match(/<h1/g) ?? []).length, 1);
  });
  test('country absent → no code block, breadcrumb omits country (no invented country)', () => {
    const m = html(
      <CompetitionHeader country={null} competition={COMPETITION} seasonLabel="2026"
        editions={EDITIONS} currentEditionId="18" editionRef={EDITION_REF}
        fixtureCount={286} asOf={null} variantLabel={null} activeTab="table" />
    );
    assert.equal(m.includes('/v2/countries/'), false);
    assert.doesNotMatch(m, /BRA/);
  });
});

describe('EditionTabNav', () => {
  const markup = html(<EditionTabNav edition="88" active="table" />);
  test('renders Overview/Table/Fixtures, marks active, links under /v2, none to /pitch', () => {
    assert.match(markup, /href="\/v2\/editions\/88"/);              // overview clean base
    assert.match(markup, /href="\/v2\/editions\/88\?tab=fixtures"/);
    assert.match(markup, /aria-current="page"/);                    // active = table
    assert.match(text(<EditionTabNav edition="88" active="table" />), /Overview .*Table .*Fixtures/);
    assert.equal(markup.includes('/pitch'), false);
  });
});

describe('StandingsTable (governed observed snapshot — real semantic table)', () => {
  test('full: all columns, team link, signed GD, as-of, semantic th scopes', () => {
    const markup = html(<StandingsTable table={TABLE} asOf="2026-08-11" label="Overall" mode="full" />);
    assert.match(markup, /<table/);
    assert.match(markup, /scope="col"/);
    assert.match(markup, /scope="row"/);
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72"/);
    const t = text(<StandingsTable table={TABLE} asOf="2026-08-11" label="Overall" mode="full" />);
    assert.match(t, /Palmeiras/); assert.match(t, /48/);
    assert.match(t, /\+22/);              // positive GD signed
    assert.match(t, /−23/);          // negative GD signed (minus sign)
    assert.match(t, /GF/); assert.match(t, /GA/);
    assert.match(t, /As of 11 Aug 2026/);
    assert.match(t, /Observed standings snapshot/i);
  });
  test('does NOT invent qualification/relegation zones (data discipline)', () => {
    const t = text(<StandingsTable table={TABLE} asOf="2026-08-11" label="Overall" mode="full" />).toLowerCase();
    for (const term of ['champions league', 'libertadores', 'europa', 'relegation', 'qualification', 'promotion']) {
      assert.equal(t.includes(term), false, `standings must not name a zone: "${term}"`);
    }
  });
  test('preview: top-N with a Full table link; deeper rows omitted', () => {
    const t = text(<StandingsTable table={TABLE} asOf="2026-08-11" label="Overall" mode="preview" previewCount={1} editionRef={EDITION_REF} />);
    assert.match(t, /Palmeiras/); assert.doesNotMatch(t, /Chapecoense/);
    assert.match(t, /top 1/i); assert.match(t, /Full table/i);
  });
});

describe('honest standings states (never fabricated)', () => {
  test('empty: coverage present, zero tables → neutral copy, no numbers', () => {
    const t = text(<StandingsEmpty seasonLabel="Brasileiro Serie A 2026" />);
    assert.match(t, /No table published yet/i);
    assert.match(t, /Brasileiro Serie A 2026/);
    assert.doesNotMatch(t, /\b\d+\s*(pts|points)\b/i);
  });
  test('unavailable: honest, never a computed table', () => {
    const t = text(<StandingsUnavailable />);
    assert.match(t, /not available/i);
    assert.match(t, /never computes/i);
    assert.doesNotMatch(t, /\b\d+\s*(pts|points)\b/i);
  });
});

describe('QualificationZonesNote is neutral (no bands drawn)', () => {
  const t = text(<QualificationZonesNote />).toLowerCase();
  test('states future config and draws no zones', () => {
    assert.match(t, /future product configuration/);
    assert.match(t, /no bands are drawn/);
    assert.equal(t.includes('champions league'), false);
  });
});

describe('FixtureStrip (Overview)', () => {
  const fixtures = [
    fx('1', '2026-09-06T15:00:00.000Z', 'COMPLETED', 'Palmeiras', 'Santos', { home: 4, away: 1 }),
    fx('2', '2026-09-12T21:30:00.000Z', 'SCHEDULED', 'Flamengo', 'Corinthians'),
  ];
  test('shows latest results + next scheduled with match links', () => {
    const markup = html(<FixtureStrip fixtures={fixtures} editionRef={EDITION_REF} />);
    assert.match(markup, /href="\/v2\/matches\/palmeiras-vs-santos-1/);
    const t = text(<FixtureStrip fixtures={fixtures} editionRef={EDITION_REF} />);
    assert.match(t, /Latest results/i); assert.match(t, /Next scheduled/i);
    assert.match(t, /All fixtures/i);
  });
  test('honest empties per side (no fabricated fixtures)', () => {
    const t = text(<FixtureStrip fixtures={[]} editionRef={EDITION_REF} />);
    assert.match(t, /No completed matches yet/i);
    assert.match(t, /No scheduled fixtures/i);
  });
});

describe('rails render real key/values', () => {
  test('EditionFactsRail + DataAvailableRail show provided facts', () => {
    const facts = text(<EditionFactsRail facts={[{ k: 'Season', v: 'Brasileiro Serie A 2026' }, { k: 'Fixtures', v: '286' }]} />);
    assert.match(facts, /Season/); assert.match(facts, /286/);
    const avail = text(<DataAvailableRail items={[{ k: 'Standings', v: 'Overall only', present: true }, { k: 'Fixture list', v: 'Available', present: true }]} />);
    assert.match(avail, /Standings/); assert.match(avail, /Overall only/);
  });
});

describe('standingsVariantLabel maps backend codes to product labels', () => {
  test('TOTAL → Overall, HOME → Home, AWAY → Away', () => {
    assert.equal(standingsVariantLabel('TOTAL'), 'Overall');
    assert.equal(standingsVariantLabel('HOME'), 'Home');
    assert.equal(standingsVariantLabel('AWAY'), 'Away');
  });
});

describe('no betting language across edition surfaces', () => {
  test('header, tabs, standings, strip and notes carry no betting/odds lexicon', () => {
    const all = [
      text(<CompetitionHeader country={{ code: 'BR', name: 'Brazil', alpha3Code: 'BRA' }} competition={COMPETITION} seasonLabel="Brasileiro Serie A 2026" editions={EDITIONS} currentEditionId="18" editionRef={EDITION_REF} fixtureCount={286} asOf="2026-08-11" variantLabel="Overall" activeTab="overview" />),
      text(<EditionTabNav edition="88" active="overview" />),
      text(<StandingsTable table={TABLE} asOf="2026-08-11" label="Overall" mode="full" />),
      text(<StandingsUnavailable />),
      text(<QualificationZonesNote />),
    ].join(' ').toLowerCase();
    for (const term of ['odds', 'bookmaker', 'stake', 'wager', 'accumulator', 'payout', 'betting', 'best bet', 'tip', 'prediction']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
