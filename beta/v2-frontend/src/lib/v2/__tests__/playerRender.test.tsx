// PLAYER ENTITY HUB RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Verifies the Player page surfaces render honest, numbers-first evidence:
//   • identity links (nationality→country, team, competition, edition) use canonical URLs;
//   • date of birth is shown verbatim (NO computed age); nullable fields → em dash;
//   • availability / statistics / match participation / valuation render as returned;
//   • empty substrate → honest empty states (never fabricated);
//   • match links use the canonical match slug;
//   • no prediction / betting / intelligence-score language, no frontend-computed stats.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  PlayerIdentityHeader, PlayerAvailabilityPanel, PlayerStatisticsPanel,
  PlayerMatchHistory, PlayerValuationPanel, PlayerCoverage,
} from '@/components/v2/player';
import type {
  ApiTeamSummary, PlayerAvailabilityView, PlayerDetailResponse, PlayerMatchStatLine,
  PlayerRegistrationView, PlayerStatistics, PlayerValuationView,
} from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const PLAYER: PlayerDetailResponse['player'] = { id: '5001', fullName: 'Gabriel Barbosa', shortName: 'Gabigol', slug: 'gabriel-barbosa-441', dateOfBirth: '1996-08-30', nationalityCode: 'BR', heightCm: 178, preferredFoot: 'RIGHT' };
const TEAM: ApiTeamSummary = { id: '68', name: 'Flamengo', slug: 'flamengo-5981', shortName: 'Flamengo', countryCode: 'BR' };
const COMP: PlayerDetailResponse['competition'] = { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325', seasonLabel: 'Brasileiro Serie A 2026' };
const REG: PlayerRegistrationView = { teamId: '68', registrationKindCode: 'PERMANENT', registrationFrom: '2019-01-01', registrationTo: null, competitionEditionId: '18', seasonLabel: 'Brasileiro Serie A 2026' };
const AVAIL: PlayerAvailabilityView = { unavailabilityKindCode: 'INJURY', from: '2026-08-01', to: null, expectedReturnOn: null, reason: 'Hamstring', severityRank: 2, current: true };
const VAL: PlayerValuationView = { amount: '12000000', currencyCode: 'EUR', asOfOn: '2026-07-01', sourceCode: 'PROVIDER' };
const MATCHES: PlayerMatchStatLine[] = [
  { fixtureId: '344', kickoffAt: '2026-09-02T22:30:00.000Z', competitionEditionId: '18', seasonLabel: '2026', teamId: '68', opponentTeamId: '59', opponentName: 'Mirassol', isHome: true, score: { home: 2, away: 0 }, statistics: [{ key: 'goals', value: '1', valueType: 'number' }] },
];
const STATS_FULL: PlayerStatistics = {
  matchesRepresented: 1, availableStatisticKeys: ['goals'],
  summary: [{ statisticKey: 'goals', valueType: 'number', matchesWithValue: 1, numericTotal: '1', numericMean: '1' }],
  editions: [{ competitionEditionId: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, matches: 1 }],
  recentMatches: MATCHES,
};
const STATS_EMPTY: PlayerStatistics = { matchesRepresented: 0, availableStatisticKeys: [], summary: [], editions: [], recentMatches: [] };

describe('Player identity', () => {
  const markup = html(<PlayerIdentityHeader player={PLAYER} currentTeam={TEAM} competition={COMP} registration={REG} />);
  test('links nationality→country, team, competition, edition; shows DOB verbatim', () => {
    assert.match(markup, /href="\/v2\/countries\/BR"/);
    assert.match(markup, /href="\/v2\/teams\/flamengo-5981-68"/);
    assert.match(markup, /href="\/v2\/competitions\/brasileirao-betano-325-28"/);
    assert.match(markup, /href="\/v2\/editions\/brasileirao-betano-325-brasileiro-serie-a-2026-18"/);
    assert.match(text(<PlayerIdentityHeader player={PLAYER} currentTeam={TEAM} competition={COMP} registration={REG} />), /1996-08-30/);
  });
  test('no computed age is shown (DOB is the only birth fact)', () => {
    const t = text(<PlayerIdentityHeader player={PLAYER} currentTeam={TEAM} competition={COMP} registration={REG} />);
    assert.doesNotMatch(t, /\bage\b/i);
  });
  test('nullable identity fields render as em dash; no team → honest label', () => {
    const bare = { ...PLAYER, shortName: null, dateOfBirth: null, nationalityCode: null, heightCm: null, preferredFoot: null };
    const t = text(<PlayerIdentityHeader player={bare} currentTeam={null} competition={null} registration={null} />);
    assert.match(t, /—/);
    assert.match(t, /No current team/i);
    assert.doesNotMatch(t, /\bnull\b/);
  });
  test('registration kind + from render verbatim as context (not reinterpreted)', () => {
    const t = text(<PlayerIdentityHeader player={PLAYER} currentTeam={TEAM} competition={COMP} registration={REG} />);
    assert.match(t, /Registration/); assert.match(t, /PERMANENT/); assert.match(t, /2019-01-01/);
  });
  test('null registrationTo renders an em dash (never fabricated)', () => {
    const t = text(<PlayerIdentityHeader player={PLAYER} currentTeam={TEAM} competition={COMP} registration={REG} />);
    assert.match(t, /Registered to\s*—/);
  });
  test('no registration → no registration facts rendered', () => {
    const t = text(<PlayerIdentityHeader player={PLAYER} currentTeam={TEAM} competition={COMP} registration={null} />);
    assert.doesNotMatch(t, /Registration/);
    assert.doesNotMatch(t, /Registered from/);
  });
});

describe('Availability', () => {
  test('renders the spell; current injury flagged; nullable dates → dash', () => {
    const t = text(<PlayerAvailabilityPanel availability={AVAIL} />);
    assert.match(t, /INJURY/); assert.match(t, /Hamstring/); assert.match(t, /—/); // null "to"/"expected return"
  });
  test('no availability → honest empty state', () => {
    assert.match(text(<PlayerAvailabilityPanel availability={null} />), /No availability record/i);
  });
});

describe('Statistics (backend-derived aggregates, not recomputed)', () => {
  test('renders summary + editions; labels aggregates as descriptive, not governed', () => {
    const t = text(<PlayerStatisticsPanel statistics={STATS_FULL} />);
    assert.match(t, /goals/); assert.match(t, /not a governed score/i);
    assert.match(html(<PlayerStatisticsPanel statistics={STATS_FULL} />), /href="\/v2\/editions\/brasileirao-betano-325-brasileiro-serie-a-2026-18"/);
  });
  test('empty statistics → honest empty state (no fabricated zeros)', () => {
    const t = text(<PlayerStatisticsPanel statistics={STATS_EMPTY} />);
    assert.match(t, /No stored match statistics/i);
    assert.doesNotMatch(t, /\b0 goals\b/i);
  });
});

describe('Match participation', () => {
  test('links to canonical match slug when the player is on the current team side', () => {
    assert.match(html(<PlayerMatchHistory recentMatches={MATCHES} currentTeam={TEAM} />), /href="\/v2\/matches\/flamengo-vs-mirassol-344"/);
  });
  test('empty → honest empty state', () => {
    assert.match(text(<PlayerMatchHistory recentMatches={[]} currentTeam={TEAM} />), /No stored match participation/i);
  });
  test('per-match statistics render verbatim behind a disclosure', () => {
    const markup = html(<PlayerMatchHistory recentMatches={MATCHES} currentTeam={TEAM} />);
    assert.match(markup, /<details/);
    const t = text(<PlayerMatchHistory recentMatches={MATCHES} currentTeam={TEAM} />);
    assert.match(t, /goals/); assert.match(t, /\b1\b/); assert.match(t, /1 statistics/);
  });
  test('a match with empty statistics has no disclosure toggle', () => {
    const noStats: PlayerMatchStatLine[] = [{ ...MATCHES[0], fixtureId: '345', statistics: [] }];
    const markup = html(<PlayerMatchHistory recentMatches={noStats} currentTeam={TEAM} />);
    assert.doesNotMatch(markup, /<details/);
    assert.match(text(<PlayerMatchHistory recentMatches={noStats} currentTeam={TEAM} />), /Mirassol/); // fixture row still renders
  });
  test('nullable statistic value renders as em dash (never fabricated)', () => {
    const nullVal: PlayerMatchStatLine[] = [{ ...MATCHES[0], statistics: [{ key: 'rating', value: null, valueType: 'number' }] }];
    const t = text(<PlayerMatchHistory recentMatches={nullVal} currentTeam={TEAM} />);
    assert.match(t, /rating/); assert.match(t, /—/);
  });
});

describe('Valuation + coverage', () => {
  test('valuation renders amount + currency + asOf; no trend computed', () => {
    const t = text(<PlayerValuationPanel valuation={VAL} />);
    assert.match(t, /12000000 EUR/); assert.match(t, /2026-07-01/);
    assert.doesNotMatch(t, /%|increase|decrease|trend|peak/i);
  });
  test('no valuation → honest empty', () => {
    assert.match(text(<PlayerValuationPanel valuation={null} />), /No stored valuation/i);
  });
  test('coverage reflects field presence honestly', () => {
    const data: PlayerDetailResponse = { player: PLAYER, currentTeam: TEAM, competition: COMP, registration: REG, availability: AVAIL, valuation: null, statistics: STATS_EMPTY };
    const t = text(<PlayerCoverage data={data} />);
    assert.match(t, /registration: present/); assert.match(t, /availability: present/);
    assert.match(t, /statistics: absent/); assert.match(t, /valuation: absent/);
  });
});

describe('no prediction / betting / intelligence-score language', () => {
  test('assembled player surfaces carry no forbidden lexicon', () => {
    const data: PlayerDetailResponse = { player: PLAYER, currentTeam: TEAM, competition: COMP, registration: REG, availability: AVAIL, valuation: VAL, statistics: STATS_FULL };
    const all = [
      text(<PlayerIdentityHeader player={PLAYER} currentTeam={TEAM} competition={COMP} registration={REG} />),
      text(<PlayerAvailabilityPanel availability={AVAIL} />),
      text(<PlayerStatisticsPanel statistics={STATS_FULL} />),
      text(<PlayerMatchHistory recentMatches={MATCHES} currentTeam={TEAM} />),
      text(<PlayerValuationPanel valuation={VAL} />),
      text(<PlayerCoverage data={data} />),
    ].join(' ').toLowerCase();
    for (const term of ['predicted', 'prediction', 'probability', 'readiness', 'fatigue', 'form', 'impact', 'expected to play', 'odds', 'betting', 'recommend']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
