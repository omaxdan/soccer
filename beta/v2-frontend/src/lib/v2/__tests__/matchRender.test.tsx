// MATCH ENTITY HUB RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Covers the five quantitative match sub-surfaces added in this slice + coverage:
//   • result (FT/HT/ET/pens; absent → honest state; unplayed phases → em dash);
//   • team statistics (per-period side-by-side; raw provider values, no recompute);
//   • lineups (XI/bench with canonical player links; formation as supplied);
//   • venue (fields + canonical venue link + neutral flag; NO travel/weather);
//   • lifecycle (observed transitions);
//   • coverage (present / absent / not-supported — weather & h2h are not-supported);
//   • forbidden-language guard (no betting/prediction/travel/weather claims).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  MatchResultPanel, MatchTeamStatisticsPanel, MatchLineupsPanel, MatchVenuePanel, MatchLifecyclePanel, MatchCoverage,
} from '@/components/v2/match';
import type { MatchLineups, MatchLifecycle, MatchResult, MatchTeamStatistics, MatchVenue } from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const RESULT: MatchResult = { final: { home: 2, away: 1 }, halfTime: { home: 1, away: 0 }, extraTime: null, penalties: null, confirmedAt: '2026-09-06T21:00:00.000Z' };
const STATS: MatchTeamStatistics = {
  periods: [{ period: 'ALL', statistics: [
    { groupName: 'Possession', statisticKey: 'ballPossession', statisticName: 'Ball possession', home: { value: '58', display: '58%' }, away: { value: '42', display: '42%' }, valueType: 'number', compareCode: null, statisticsType: null, renderType: null },
    { groupName: 'Shots', statisticKey: 'totalShots', statisticName: 'Total shots', home: { value: '14', display: '14' }, away: { value: '9', display: '9' }, valueType: 'number', compareCode: null, statisticsType: null, renderType: null },
  ] }],
  coverage: { teamStatistics: 'present', periodsPresent: ['ALL'], statisticsAreObserved: true, provider: 'SPORTSAPI', retrievedAt: '2026-09-06T21:05:00.000Z' },
};
const LINEUPS: MatchLineups = {
  home: { team: { id: '68', name: 'Flamengo', slug: 'flamengo-5981' }, formation: '4-3-3', starting: [{ player: { id: '33', fullName: 'Martinelli', slug: 'martinelli-1067671' }, positionCode: 'M', positionName: 'Midfielder', positionGroup: 'MID', shirtNumber: 8 }], substitutes: [] },
  away: null,
  coverage: { lineups: 'partial', lineupsAreObserved: true },
};
const VENUE: MatchVenue = {
  venue: { id: '25', name: 'Estádio do Maracanã', city: 'Rio de Janeiro', countryCode: 'BR', latitude: -22.91216, longitude: -43.23018, elevationMetres: null, timezoneName: 'America/Sao_Paulo', capacity: 78838, surface: 'grass' },
  isNeutralVenue: false,
  coverage: { venue: 'present', venueIsObserved: true },
};
const LIFECYCLE: MatchLifecycle = {
  transitions: [
    { fromState: null, toState: { code: 'SCHEDULED', displayName: 'Scheduled' }, transitionedAt: '2026-08-01T00:00:00.000Z', providerStatusRaw: 'notstarted' },
    { fromState: { code: 'SCHEDULED', displayName: 'Scheduled' }, toState: { code: 'COMPLETED', displayName: 'Completed' }, transitionedAt: '2026-09-06T21:00:00.000Z', providerStatusRaw: 'finished' },
  ],
  coverage: { transitions: 'present', transitionsAreObserved: true },
};

describe('Result', () => {
  test('renders FT + HT; unplayed phases (ET/pens) as em dash', () => {
    const t = text(<MatchResultPanel result={RESULT} coverage={{ result: 'present' }} homeName="Flamengo" awayName="Fluminense" />);
    assert.match(t, /Full time 2 1/); assert.match(t, /Half time 1 0/); assert.match(t, /Extra time — —/);
  });
  test('absent result → honest empty state (no fabricated 0-0)', () => {
    const t = text(<MatchResultPanel result={null} coverage={{ result: 'absent' }} homeName="A" awayName="B" />);
    assert.match(t, /No result recorded/i);
    assert.doesNotMatch(t, /\b0 0\b/);
  });
});

describe('Team statistics', () => {
  test('renders per-period side-by-side raw values (no recompute)', () => {
    const t = text(<MatchTeamStatisticsPanel teamStatistics={STATS} homeName="Flamengo" awayName="Fluminense" />);
    assert.match(t, /Period: ALL/); assert.match(t, /Ball possession 58% 42%/); assert.match(t, /Total shots 14 9/);
  });
  test('absent → honest empty', () => {
    const empty: MatchTeamStatistics = { periods: [], coverage: { teamStatistics: 'absent', periodsPresent: [], statisticsAreObserved: true, provider: null, retrievedAt: null } };
    assert.match(text(<MatchTeamStatisticsPanel teamStatistics={empty} homeName="A" awayName="B" />), /No team statistics/i);
  });
});

describe('Lineups', () => {
  test('renders formation + XI with canonical player links; missing side → honest state', () => {
    const markup = html(<MatchLineupsPanel lineups={LINEUPS} />);
    assert.match(markup, /4-3-3/);
    assert.match(markup, /href="\/v2\/players\/martinelli-1067671-33"/);
    assert.match(markup, /No lineup reported/i); // away side null
  });
  test('both sides null → honest empty', () => {
    const none: MatchLineups = { home: null, away: null, coverage: { lineups: 'absent', lineupsAreObserved: true } };
    assert.match(text(<MatchLineupsPanel lineups={none} />), /No lineups reported/i);
  });
});

describe('Venue (context only)', () => {
  const markup = html(<MatchVenuePanel matchVenue={VENUE} />);
  test('links to canonical venue page; shows fields; null elevation → dash', () => {
    assert.match(markup, /href="\/v2\/venues\/estadio-do-maracana-25"/);
    const t = text(<MatchVenuePanel matchVenue={VENUE} />);
    assert.match(t, /78838/); assert.match(t, /-22\.91216, -43\.23018/); assert.match(t, /—/); // null elevation
  });
  test('absent venue → honest empty', () => {
    const none: MatchVenue = { venue: null, isNeutralVenue: false, coverage: { venue: 'absent', venueIsObserved: true } };
    assert.match(text(<MatchVenuePanel matchVenue={none} />), /No venue recorded/i);
  });
});

describe('Lifecycle', () => {
  test('renders transitions from→to with provider raw', () => {
    const t = text(<MatchLifecyclePanel lifecycle={LIFECYCLE} />);
    assert.match(t, /Scheduled/); assert.match(t, /Completed/); assert.match(t, /finished/);
  });
});

describe('Coverage', () => {
  test('renders present/absent and marks weather & h2h not-supported', () => {
    const t = text(<MatchCoverage flags={[['match', 'present'], ['result', 'present'], ['weather', 'not-supported'], ['h2h', 'not-supported']]} />);
    assert.match(t, /match: present/); assert.match(t, /weather: not-supported/); assert.match(t, /h2h: not-supported/);
  });
});

describe('no betting / prediction / travel / weather language', () => {
  test('assembled match surfaces carry no forbidden lexicon', () => {
    const all = [
      text(<MatchResultPanel result={RESULT} coverage={{ result: 'present' }} homeName="Flamengo" awayName="Fluminense" />),
      text(<MatchTeamStatisticsPanel teamStatistics={STATS} homeName="Flamengo" awayName="Fluminense" />),
      text(<MatchLineupsPanel lineups={LINEUPS} />),
      text(<MatchVenuePanel matchVenue={VENUE} />),
      text(<MatchLifecyclePanel lifecycle={LIFECYCLE} />),
    ].join(' ').toLowerCase();
    for (const term of ['predicted', 'prediction', 'probability', 'travel', 'distance', 'fatigue', 'weather', 'odds', 'bookmaker', 'stake', 'wager', 'betting', 'tip', 'guaranteed', 'best bet', 'recommend']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
    assert.doesNotMatch(all, /\bpick\b/);
  });
});
