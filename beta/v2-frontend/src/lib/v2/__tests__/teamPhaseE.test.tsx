// PHASE E — new Team workspace surfaces (DB-free; react-dom/server, no DOM/network).
//
// Locks the reconciled pieces: result-tier attributes, the compact recent-results list,
// the observation-enriched squad roster, the performance indicators, the performance-
// signals group switcher and the History tab (season record + match log + season stats).
// Every value is rendered verbatim; missing data is an em dash, never a fabricated zero;
// and no betting / prediction language appears.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  TeamResultAttributes, TeamRecentResults, TeamSquadRoster, TeamPerformanceIndicators,
} from '@/components/v2/team';
import { TeamPerformanceSignals } from '@/components/v2/teamPerformanceSignals';
import { TeamHistory } from '@/components/v2/teamHistory';
import type {
  ResultAttribute, TeamFixtureLine, TeamIntelligence, TeamPlayerObservation,
  TeamPerformanceOverall, CompetitionPerformance, SignalWindow, TeamObservation,
  TeamTemporalPerformanceResponse,
} from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── result attributes ────────────────────────────────────────────────────────────────
const RES_ATTR = (over: Partial<ResultAttribute> = {}): ResultAttribute => ({
  key: 'goals_per_match', label: 'Goals scored per match', type: 'strength', level: 'TOP_QUARTILE',
  direction: 'HIGHER_IS_MORE', qualityOrientation: 'HIGHER_IS_BETTER',
  evidence: { signalKey: 'goals_per_match', signalValue: 1.76, benchmark: { rank: 2, teams: 20, percentile: 0.95, median: 1.26, q1: 1.08, q3: 1.48 }, teamFixtures: 25 },
  ...over,
});

describe('TeamResultAttributes', () => {
  test('renders label, value, rank n/N and orientation verbatim', () => {
    const t = text(<TeamResultAttributes strengths={[RES_ATTR()]} tendencies={[]} weaknesses={[]} />);
    assert.match(t, /Goals scored per match/);
    assert.match(t, /1\.76/);
    assert.match(t, /2nd of 20/);
    assert.match(t, /higher is better/);
    assert.match(t, /Strengths/);
  });
  test('insufficient sample → honest state, no fabricated ranks', () => {
    const t = text(<TeamResultAttributes strengths={[]} insufficientSample />);
    assert.match(t, /Not enough completed matches/i);
    assert.doesNotMatch(t, /of 20/);
  });
  test('all mid-table → honest "no standout" state', () => {
    assert.match(text(<TeamResultAttributes strengths={[]} tendencies={[]} weaknesses={[]} />), /no standout/i);
  });
});

// ── recent results ───────────────────────────────────────────────────────────────────
const LINE = (id: string, isHome: boolean, gf: number | null, ga: number | null): TeamFixtureLine => ({
  fixtureId: id, kickoffAt: '2026-09-06T21:30:00.000Z',
  competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
  opponent: { id: '61', name: 'Botafogo', slug: 'botafogo-1958' },
  isHome, status: 'COMPLETED', score: gf === null || ga === null ? null : { home: gf, away: ga },
});

describe('TeamRecentResults', () => {
  test('shows opponent link + team-relative score; empty → honest', () => {
    const markup = html(<TeamRecentResults recent={[LINE('352', false, 0, 0)]} teamName="Palmeiras" />);
    assert.match(markup, /href="\/v2\/matches\/botafogo-vs-palmeiras-352"/);
    assert.match(text(<TeamRecentResults recent={[]} teamName="Palmeiras" />), /No completed matches/i);
  });
  test('null score → em dash, never 0–0', () => {
    const t = text(<TeamRecentResults recent={[LINE('9', true, null, null)]} teamName="Palmeiras" />);
    assert.match(t, /—/);
  });
});

// ── squad roster ─────────────────────────────────────────────────────────────────────
const SQUAD: TeamIntelligence['squad'] = [
  { playerId: '715', fullName: 'Agustín Giay', shortName: 'A. Giay', slug: 'agustin-giay-1106603', registrationKindCode: 'PERMANENT', registrationFrom: '2026-09-17', registrationTo: null },
  { playerId: '733', fullName: 'Jefté', shortName: null, slug: 'jefte-99', registrationKindCode: 'PERMANENT', registrationFrom: '2026-01-01', registrationTo: null },
];
const PLAYER_OBS: TeamPlayerObservation[] = [
  { player: { id: '715', fullName: 'Agustín Giay', slug: 'agustin-giay-1106603' }, observationCount: 20, latestObservation: null, participation: { started: 18, bench: 2, unknown: 0 }, summary: [{ key: 'minutesPlayed', total: 1620, present: 18, totalObservations: 20 }, { key: 'goals', total: 1, present: 18, totalObservations: 20 }] },
  // A player who appeared but is NOT in the registered squad → "also appeared".
  { player: { id: '999', fullName: 'Loanee Gone', slug: 'loanee-gone-999' }, observationCount: 4, latestObservation: null, participation: { started: 2, bench: 2, unknown: 0 }, summary: [{ key: 'minutesPlayed', total: 210, present: 4, totalObservations: 4 }] },
];
const VALS: TeamIntelligence['valuations'] = [
  { playerId: '715', fullName: 'Agustín Giay', amount: '7700000', currencyCode: 'EUR', asOfOn: '2026-09-17', sourceCode: 'SPORTSAPI_API' },
];
const AVAIL: TeamIntelligence['availability'] = [
  { playerId: '733', fullName: 'Jefté', unavailabilityKindCode: 'INJURY', from: '2026-09-17', to: null, expectedReturnOn: null, reason: 'Meniscus Injury', severityRank: null, current: true },
];

describe('TeamSquadRoster', () => {
  const markup = html(<TeamSquadRoster squad={SQUAD} playerObservations={PLAYER_OBS} valuations={VALS} availability={AVAIL} />);
  const t = text(<TeamSquadRoster squad={SQUAD} playerObservations={PLAYER_OBS} valuations={VALS} availability={AVAIL} />);
  test('joins observations/valuations/availability; player links; also-appeared list', () => {
    assert.match(markup, /href="\/v2\/players\/agustin-giay-1106603-715"/);
    assert.match(t, /1620/);              // minutes
    assert.match(t, /7700000 EUR/);       // valuation verbatim
    assert.match(t, /INJURY/);            // availability chip (Jefté)
    assert.match(t, /Also appeared this season, not currently registered · 1/);
    assert.match(t, /Loanee Gone/);
  });
  test('states positions/numbers/ages are not supplied', () => {
    assert.match(t, /Positions, shirt numbers, ages and nationality are not supplied/i);
  });
  test('a player with no observations shows dashes, never zero', () => {
    // Jefté (733) has no observation row → started/bench/minutes/goals dashes.
    assert.match(t, /—/);
  });
});

// ── performance indicators ─────────────────────────────────────────────────────────────
const PM = (value: number, matches: number, meets: boolean, unit = 'index'): TeamPerformanceOverall['homeForm'] =>
  ({ value, unit, direction: 'HIGHER_IS_STRONGER', sample: { matches, meetsThreshold: meets }, asOf: '2026-09-06T21:30:00.000Z' });
const OVERALL: TeamPerformanceOverall = {
  homeForm: PM(48.33, 6, true), awayForm: PM(34, 4, false),
  momentum: { value: -7, unit: 'points', direction: 'HIGHER_IS_STRONGER', sample: { matches: 10, meetsThreshold: true }, asOf: '2026-09-06T21:30:00.000Z' },
  goalMarginVolatility: PM(1.89, 10, true, 'goals'), giantKillerPpg: PM(1.33, 9, true, 'ppg'),
};
const BY_COMP: CompetitionPerformance[] = [
  { edition: { id: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' } }, homeWinRate: PM(50, 4, true), awayWinRate: PM(66.67, 3, true) },
];

describe('TeamPerformanceIndicators', () => {
  test('shows indicators + small-sample flag; absent → honest', () => {
    const t = text(<TeamPerformanceIndicators overall={OVERALL} byCompetition={BY_COMP} coverage="present" />);
    assert.match(t, /48\.33/); assert.match(t, /Momentum/); assert.match(t, /small sample/); // awayForm below threshold
    assert.match(t, /Home win rate · Brasileirão Betano/);
    const empty = text(<TeamPerformanceIndicators overall={{ homeForm: null, awayForm: null, momentum: null, goalMarginVolatility: null, giantKillerPpg: null }} coverage="absent" />);
    assert.match(empty, /No performance data available/i);
  });
});

// ── performance signals ────────────────────────────────────────────────────────────────
const win = (goalsPm: string): SignalWindow => ({
  windowSize: 5, fixtureIds: ['1', '2', '3', '4', '5'],
  scoring: [{ key: 'goals_per_match', label: 'Goals per match', value: 1.4, displayValue: goalsPm }],
  conceding: [{ key: 'goals_conceded_per_match', label: 'Goals conceded per match', value: 1, displayValue: '1.00' }],
  totalGoals: [], btts: [], result: [], margin: [], attack: [], defensiveXg: [], creation: [],
  streaks: [{ key: 'current_scoring_streak', label: 'Current scoring streak', length: 3, fixtureIds: ['1', '2', '3'] }],
});

describe('TeamPerformanceSignals', () => {
  const windows = { last5: win('1.40'), previous5: win('2.60'), season: win('1.79'), seasonHome: win('1.79'), seasonAway: win('1.79') };
  const t = text(<TeamPerformanceSignals windows={windows} />);
  test('renders the group switcher, window columns and displayValues verbatim; current runs', () => {
    assert.match(t, /Scoring/); assert.match(t, /Conceding/); assert.match(t, /Finishing vs xG/);
    assert.match(t, /Prev 5/); assert.match(t, /Last 5/); assert.match(t, /Season/); assert.match(t, /Home/); assert.match(t, /Away/);
    assert.match(t, /Goals per match/);
    assert.match(t, /1\.40/); assert.match(t, /2\.60/);  // window displayValues
    assert.match(t, /Current runs/); assert.match(t, /Current scoring streak/);
  });
  test('no formulas or betting language', () => {
    const lower = t.toLowerCase();
    for (const term of ['sum(', 'formula', 'odds', 'bet', 'tip', 'prediction']) assert.equal(lower.includes(term), false, `must not contain "${term}"`);
  });
});

// ── history ──────────────────────────────────────────────────────────────────────────
const OBS = (id: string, gf: number | null, ga: number | null, xg: number | null, r: 'W' | 'D' | 'L'): TeamObservation => ({
  fixtureId: id, fixturePartitionOn: '2026-09-06', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
  edition: { id: '18', seasonLabel: 'Brasileiro Serie A 2026' }, kickoffAt: '2026-09-06T21:30:00.000Z', sequenceIndex: 1,
  opponent: { id: '61', name: 'Botafogo', slug: 'botafogo-1958' }, venueSide: 'away', result: r,
  goalsFor: gf, goalsAgainst: ga, goalMargin: gf !== null && ga !== null ? gf - ga : null, points: r === 'W' ? 3 : r === 'D' ? 1 : 0,
  cleanSheet: ga === 0, xg, xga: 0.5, metrics: [],
});
const SEASON: TeamTemporalPerformanceResponse['season'] = {
  observationCount: 28, scopeLabel: 'all competitions',
  results: { wins: 16, draws: 8, losses: 4, points: 56, goalsFor: 50, goalsAgainst: 24, goalDifference: 26 },
  metrics: [
    { metric: 'ballPossession', class: 'MEAN', value: 52.86, observations: 28, total: 28 },
    { metric: 'expectedGoals', class: 'SUM', value: 29, observations: 26, total: 28 },
  ],
};

describe('TeamHistory', () => {
  const obs = [OBS('1', 2, 2, 1.01, 'D'), OBS('352', 0, 1, null, 'L')];
  const markup = html(<TeamHistory observations={obs} season={SEASON} teamName="Palmeiras" />);
  const t = text(<TeamHistory observations={obs} season={SEASON} teamName="Palmeiras" />);
  test('season record + match log with xG/xGA + season statistics + earlier-seasons note', () => {
    assert.match(t, /Season record/); assert.match(t, /56/); assert.match(t, /\+26/);
    assert.match(t, /Match log/);
    assert.match(markup, /href="\/v2\/matches\/botafogo-vs-palmeiras-352"/); // away → opponent home
    assert.match(t, /Season statistics/); assert.match(t, /52\.86/); assert.match(t, /26 of 28 matches/); // coverage
    assert.match(t, /Earlier seasons/); assert.match(t, /No earlier seasons are recorded/i);
  });
  test('a match without xG shows — not 0 for xG', () => {
    // fixture 352 has xg=null → dash in the log.
    assert.match(t, /—/);
  });
  test('no data at all → honest unavailable', () => {
    assert.match(text(<TeamHistory observations={[]} season={null} teamName="X" />), /Historical data not available yet/i);
  });
});
