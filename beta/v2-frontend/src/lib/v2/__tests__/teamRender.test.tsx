// TEAM ENTITY HUB RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Verifies the Team page surfaces render honest, numbers-first content with a strict
// evidence-vs-intelligence separation:
//   • identity header carries name/country/venue, the season, the GOVERNED standings
//     row and the home/away win-rate features (all verbatim, nothing computed);
//   • Current Form groups the W/D/L strip, the descriptive performance FEATURES, and the
//     recent home/away venue-split fixtures (team-relative GF/GA, never re-oriented);
//   • the governed readiness reading is badged "governed" and never merged with evidence;
//   • nullable metrics/scores render as an em dash — never zero-filled;
//   • empty collections show honest empty states;
//   • no prediction / probability / travel / betting language.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  TeamIdentityHeader, TeamCurrentForm, TeamReadinessPanel, TeamHomeAwaySplitPanel,
  TeamConsistencyPanel, TeamCompetitionContext, TeamSeasonStatistics, TeamLastMatch,
  TeamUpcomingFixtures, TeamPlayers,
} from '@/components/v2/team';
import type {
  PerformanceMetric, StandingLine,
  TeamAvailabilityRecord, TeamDetailResponse, TeamFixtureLine, TeamGovernedReading, TeamIntelligence, TeamParticipation,
  TeamPerformanceOverall, TeamReadinessReading,
} from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const TEAM: TeamDetailResponse['team'] = { id: '68', name: 'Flamengo', slug: 'flamengo-5981', shortName: 'Flamengo', countryCode: 'BR', homeVenueName: 'Estádio do Maracanã' };
const COMPETITIONS: TeamDetailResponse['competitions'] = [
  { editionId: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' } },
];
const METRIC = (value: number, matches: number, meets = true): PerformanceMetric => ({ value, unit: 'index', direction: 'HIGHER_IS_STRONGER', sample: { matches, meetsThreshold: meets }, asOf: '2026-07-17T23:00:00.000Z' });
const OVERALL_FULL: TeamPerformanceOverall = { homeForm: METRIC(1.83, 12), awayForm: METRIC(1.36, 11), momentum: METRIC(2.3, 10), goalMarginVolatility: METRIC(1.1, 20), giantKillerPpg: METRIC(0.9, 6) };
const OVERALL_EMPTY: TeamPerformanceOverall = { homeForm: null, awayForm: null, momentum: null, goalMarginVolatility: null, giantKillerPpg: null };
const HOME_WR = METRIC(50, 4);
const AWAY_WR = METRIC(0, 4);
const STANDING: StandingLine = { position: 8, team: { id: '68', name: 'Flamengo', slug: 'flamengo-5981' }, played: 25, won: 7, drawn: 6, lost: 12, goalsFor: 22, goalsAgainst: 33, goalDifference: -11, points: 27 };
const HOME_LINES: TeamFixtureLine[] = [
  { fixtureId: '900', kickoffAt: '2026-08-01T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '67', name: 'Fluminense', slug: 'fluminense-1961' }, isHome: true, status: 'COMPLETED', score: { home: 2, away: 0 } },
];
const AWAY_LINES: TeamFixtureLine[] = [
  { fixtureId: '901', kickoffAt: '2026-07-25T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }, isHome: false, status: 'COMPLETED', score: { home: 1, away: 1 } },
];
const RECENT: TeamFixtureLine[] = [...HOME_LINES, ...AWAY_LINES];
const UPCOMING: TeamFixtureLine[] = [
  { fixtureId: '950', kickoffAt: '2026-09-20T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '73', name: 'Atlético Mineiro', slug: 'atletico-mineiro-1977' }, isHome: false, status: 'SCHEDULED', score: null },
];
const PARTICIPATION: TeamParticipation[] = [
  { competitionEditionId: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, fixturesTotal: 38, completed: 20, scheduled: 18, postponed: 0, registered: true, firstKickoff: null, lastKickoff: null },
];
const SQUAD: TeamIntelligence['squad'] = [
  { playerId: '5001', fullName: 'Gabriel Barbosa', shortName: 'Gabigol', slug: 'gabriel-barbosa-441', registrationKindCode: 'PERMANENT', registrationFrom: '2026-01-15', registrationTo: null },
  { playerId: '5002', fullName: 'Injured Player', shortName: null, slug: 'injured-player-882', registrationKindCode: 'LOAN_IN', registrationFrom: '2026-02-01', registrationTo: '2026-12-31' },
];
const AVAILABILITY: TeamAvailabilityRecord[] = [
  { playerId: '5002', fullName: 'Injured Player', unavailabilityKindCode: 'INJURY', from: '2026-09-10', to: null, expectedReturnOn: null, reason: 'Meniscus Injury', severityRank: null, current: true },
];
const NEXT_FIXTURE: NonNullable<TeamIntelligence['nextFixture']> = {
  fixture: { fixtureId: '494', kickoffAt: '2026-09-20T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '75', name: 'Grêmio', slug: 'gremio-1967' }, isHome: false, status: 'SCHEDULED', score: null },
  registeredCount: 29,
  explicitlyUnavailable: [
    { playerId: '5002', fullName: 'Injured Player', unavailabilityKindCode: 'INJURY', reason: 'Meniscus Injury', expectedReturnOn: null },
    { playerId: '5003', fullName: 'Suspended Player', unavailabilityKindCode: 'SUSPENSION', reason: null, expectedReturnOn: '2026-09-27' },
  ],
  availabilityUnknown: Array.from({ length: 27 }, (_, i) => ({ playerId: `6${i}`, fullName: `Squad Member ${i}` })),
};
const READING: TeamReadinessReading = { moduleKey: 'readiness_tracker', status: 'NEUTRAL', strength: null, confidence: null, sample: { matches: 10, meetsThreshold: true }, verdictText: 'Steady form.', inactiveReason: null, asOf: '2026-07-17T23:00:00.000Z', evidence: null };
const LAST_MATCH_FIXTURE: TeamFixtureLine = {
  fixtureId: '480', kickoffAt: '2026-09-07T20:00:00.000Z',
  competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
  opponent: { id: '76', name: 'Botafogo', slug: 'botafogo-1958' },
  isHome: false, status: 'COMPLETED', score: { home: 1, away: 2 }, // team-relative: GF=1, GA=2 (an away loss)
};
const PERFORMANCES: TeamIntelligence['playerPerformances'] = {
  fixture: LAST_MATCH_FIXTURE,
  performances: [
    // In SQUAD (slug resolvable) → linked. Order is the backend order and must be preserved.
    { playerId: '5001', fullName: 'Gabriel Barbosa', statistics: [
      { key: 'minutesPlayed', value: '90', valueType: 'number' },
      { key: 'rating', value: '7.7', valueType: 'number' },
      { key: 'expectedGoals', value: '0.2506', valueType: 'number' },
      { key: 'expectedAssists', value: '0.0366572', valueType: 'number' },
      { key: 'accuratePass', value: '31', valueType: 'number' },
      { key: 'ratingVersions', value: '{"original":7.7}', valueType: 'json' }, // provider metadata → excluded
      { key: 'statisticsType', value: 'lineups', valueType: 'json' },           // provider metadata → excluded
    ] },
    // NOT in SQUAD (no slug) → plain name; only minutes recorded → other primary cells honest dashes.
    { playerId: '5099', fullName: 'Unlinked Sub', statistics: [
      { key: 'minutesPlayed', value: '12', valueType: 'number' },
    ] },
  ],
};
const PLAYER_STATS: TeamIntelligence['playerStatistics'] = {
  playersWithStats: 30,
  statisticKeys: [
    { statisticKey: 'goals', valueType: 'number', fixtures: 25, players: 12, numericTotal: '48', numericMean: '1.0667' },
    { statisticKey: 'expectedGoals', valueType: 'number', fixtures: 28, players: 20, numericTotal: '31.9995', numericMean: '0.5' },
    { statisticKey: 'accuratePass', valueType: 'number', fixtures: 28, players: 30, numericTotal: '10478', numericMean: '24.0874' },
    { statisticKey: 'saves', valueType: 'number', fixtures: 20, players: 2, numericTotal: '80', numericMean: '4' },
    // non-numeric provider metadata → null total → must be excluded (not an athlete-facing stat)
    { statisticKey: 'ratingVersions', valueType: 'json', fixtures: 28, players: 30, numericTotal: null, numericMean: null },
    // a numeric key NOT in the curated catalogue → must not appear (no raw-key dump)
    { statisticKey: 'passValueNormalized', valueType: 'number', fixtures: 28, players: 30, numericTotal: '123.45', numericMean: '0.3' },
    // a catalogued key present but with a null total → must be excluded (never zero-filled)
    { statisticKey: 'totalTackle', valueType: 'number', fixtures: 0, players: 0, numericTotal: null, numericMean: null },
  ],
};

function header(over: Partial<React.ComponentProps<typeof TeamIdentityHeader>> = {}) {
  return <TeamIdentityHeader team={TEAM} competitions={COMPETITIONS} season="Brasileirão Betano · Brasileiro Serie A 2026" standing={STANDING} homeWinRate={HOME_WR} awayWinRate={AWAY_WR} {...over} />;
}
function currentForm(over: Partial<React.ComponentProps<typeof TeamCurrentForm>> = {}) {
  return <TeamCurrentForm recent={RECENT} home={HOME_LINES} away={AWAY_LINES} teamName="Flamengo" overall={OVERALL_FULL} coverage="present" {...over} />;
}

describe('Team identity header (identity + season + standings + win rate)', () => {
  test('links country + edition; shows name/venue, season, standings row and win rates', () => {
    const markup = html(header());
    assert.match(markup, /Flamengo/);
    assert.match(markup, /Estádio do Maracanã/);
    assert.match(markup, /href="\/v2\/countries\/BR"/);
    assert.match(markup, /href="\/v2\/editions\/brasileirao-betano-325-brasileiro-serie-a-2026-18"/);
    const t = text(header());
    assert.match(t, /Season/); assert.match(t, /Brasileiro Serie A 2026/);
    assert.match(t, /#8/); assert.match(t, /27 pts/); assert.match(t, /P25/); assert.match(t, /GD -11/);
    assert.match(t, /Home win rate/i); assert.match(t, /Away win rate/i);
    assert.match(t, /\b50\b/); assert.match(t, /n=4/);
  });
  test('absent standing / null win rate render honestly (no fabricated number)', () => {
    const t = text(header({ standing: null, homeWinRate: null, awayWinRate: null }));
    assert.doesNotMatch(t, /#\d/);          // no fabricated position
    assert.match(t, /—/);                    // null win rate → dash
    assert.match(t, /Flamengo/);             // identity still renders
  });
});

describe('Current form (W/D/L strip + descriptive features + venue-split fixtures)', () => {
  test('renders strip, descriptive metrics, and recent home/away tables with links', () => {
    const markup = html(currentForm());
    assert.match(markup, /Fluminense/);                                        // home opponent
    assert.match(markup, /Palmeiras/);                                         // away opponent
    assert.match(markup, /href="\/v2\/matches\/flamengo-vs-fluminense-900"/);  // home → team is home
    assert.match(markup, /href="\/v2\/matches\/palmeiras-vs-flamengo-901"/);   // away → team is away
    const t = text(currentForm());
    assert.match(t, /Recent home matches/); assert.match(t, /Recent away matches/);
    assert.match(t, /1\.83/);                         // descriptive home-form feature
    assert.match(t, /not a governed reading/i);
  });
  test('venue tables show team-relative GF/GA per row', () => {
    const t = text(currentForm());
    assert.match(t, /W\s+2\s+0/);  // home 2-0 win: Res GF GA
    assert.match(t, /D\s+1\s+1/);  // away 1-1 draw
  });
  test('coverage absent → no descriptive metric grid, but venue tables still render', () => {
    const t = text(currentForm({ overall: OVERALL_EMPTY, coverage: 'absent' }));
    assert.doesNotMatch(t, /Home form/);        // metric labels gone
    assert.match(t, /Recent home matches/);     // venue evidence remains
  });
  test('empty recent → honest empty state', () => {
    assert.match(text(currentForm({ recent: [], home: [], away: [], overall: OVERALL_EMPTY, coverage: 'absent' })), /No completed matches/i);
  });
  test('null score → em dash (never zero-filled)', () => {
    const NULL_LINE: TeamFixtureLine = { ...HOME_LINES[0], fixtureId: '905', score: null };
    const t = text(currentForm({ recent: [NULL_LINE], home: [NULL_LINE], away: [], overall: OVERALL_EMPTY, coverage: 'absent' }));
    assert.match(t, /—/);
  });
});

// Score/result ORIENTATION lock. The backend TeamFixtureLine.score is team-relative
// (score.home = GF, score.away = GA) for BOTH venues; away rows must NOT be inverted.
// Regression for the away-fixture double-orientation bug (away 1–2 L wrongly shown as
// 2–1 W). Locks the RENDERED venue tables, not just the pure helper.
describe('Team fixture score/result orientation (team-relative, both venues)', () => {
  const HOME_WIN: TeamFixtureLine = { fixtureId: '910', kickoffAt: '2026-08-01T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '67', name: 'Fluminense', slug: 'fluminense-1961' }, isHome: true, status: 'COMPLETED', score: { home: 1, away: 0 } };
  const AWAY_LOSS: TeamFixtureLine = { fixtureId: '911', kickoffAt: '2026-07-25T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '73', name: 'Atlético Mineiro', slug: 'atletico-mineiro-1977' }, isHome: false, status: 'COMPLETED', score: { home: 1, away: 2 } };
  const AWAY_WIN: TeamFixtureLine = { ...AWAY_LOSS, fixtureId: '912', opponent: { id: '74', name: 'Santos', slug: 'santos-1968' }, score: { home: 3, away: 1 } };

  test('home renders W 1 0 and away renders L 1 2 (never inverted to 2 1)', () => {
    const t = text(currentForm({ recent: [HOME_WIN, AWAY_LOSS], home: [HOME_WIN], away: [AWAY_LOSS], overall: OVERALL_EMPTY, coverage: 'absent' }));
    assert.match(t, /W\s+1\s+0/);      // home: Res GF GA
    assert.match(t, /L\s+1\s+2/);      // away: Res GF GA, team-relative
    assert.doesNotMatch(t, /L\s+2\s+1/); // must NOT invert the away row
  });
  test('away win renders W 3 1 (GF first), not W 1 3', () => {
    const t = text(currentForm({ recent: [AWAY_WIN], home: [], away: [AWAY_WIN], overall: OVERALL_EMPTY, coverage: 'absent' }));
    assert.match(t, /W\s+3\s+1/);
    assert.doesNotMatch(t, /W\s+1\s+3/);
  });
  test('invariant: venue result letter agrees with GF/GA (GF>GA→W, GF<GA→L)', () => {
    const win = text(currentForm({ recent: [HOME_WIN], home: [HOME_WIN], away: [], overall: OVERALL_EMPTY, coverage: 'absent' }));
    assert.match(win, /W\s+1\s+0/); assert.doesNotMatch(win, /[LD]\s+1\s+0/);
    const loss = text(currentForm({ recent: [AWAY_LOSS], home: [], away: [AWAY_LOSS], overall: OVERALL_EMPTY, coverage: 'absent' }));
    assert.match(loss, /L\s+1\s+2/); assert.doesNotMatch(loss, /[WD]\s+1\s+2/);
  });
});

describe('Readiness (GOVERNED intelligence — separated)', () => {
  const markup = html(<TeamReadinessPanel readiness={READING} coverage={{ readiness: 'present', readinessIsGoverned: true }} />);
  test('badged governed; shows status, null strength/confidence as dash, sample and verdict', () => {
    assert.match(markup, /governed/i);
    assert.match(markup, /NEUTRAL/);
    assert.match(markup, /Steady form\./);
    const t = text(<TeamReadinessPanel readiness={READING} coverage={{ readiness: 'present', readinessIsGoverned: true }} />);
    assert.match(t, /—/); // strength/confidence null → dash, not 0
  });
  test('absent readiness → honest empty state', () => {
    assert.match(text(<TeamReadinessPanel readiness={null} coverage={{ readiness: 'absent', readinessIsGoverned: true }} />), /No governed readiness/i);
  });
});

describe('Competition context, upcoming, players', () => {
  test('competition context links competition and edition; shows counts', () => {
    const markup = html(<TeamCompetitionContext participation={PARTICIPATION} />);
    assert.match(markup, /href="\/v2\/competitions\/brasileirao-betano-325-28"/);
    assert.match(markup, /href="\/v2\/editions\/brasileirao-betano-325-brasileiro-serie-a-2026-18"/);
    assert.match(text(<TeamCompetitionContext participation={PARTICIPATION} />), /38/);
  });
  test('upcoming links to the canonical match URL (opponent is home for an away fixture)', () => {
    assert.match(html(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" />), /href="\/v2\/matches\/atletico-mineiro-vs-flamengo-950"/);
  });
  test('no nextFixture → selection picture is absent (only the fixtures table renders)', () => {
    const t = text(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" />);
    assert.doesNotMatch(t, /selection picture/i);
    assert.doesNotMatch(t, /registered/i);
  });
  test('empty fixtures/participation → honest empty states', () => {
    assert.match(text(<TeamUpcomingFixtures upcoming={[]} teamName="Flamengo" />), /No upcoming fixtures/i);
    assert.match(text(<TeamCompetitionContext participation={[]} />), /No governed participation/i);
  });
  test('players link canonically; current availability shows kind + reason + from, others "no current record"', () => {
    const markup = html(<TeamPlayers squad={SQUAD} availability={AVAILABILITY} />);
    assert.match(markup, /href="\/v2\/players\/gabriel-barbosa-441-5001"/);
    const t = text(<TeamPlayers squad={SQUAD} availability={AVAILABILITY} />);
    assert.match(t, /INJURY/);
    assert.match(t, /Meniscus Injury/);      // reason surfaced verbatim
    assert.match(t, /from 2026-09-10/);       // meaningful `from` shown
    assert.match(t, /no current record/i);    // player without a record — NOT "available"
    assert.doesNotMatch(t, /\bavailable\b/i);  // never claim availability from absence of a record
  });
  test('registration detail renders kind + from/to null-honestly (null `to` is never "permanent")', () => {
    const t = text(<TeamPlayers squad={SQUAD} availability={[]} />);
    assert.match(t, /PERMANENT/);               // kind code verbatim
    assert.match(t, /2026-01-15 → —/);          // open-ended registration: null `to` → dash, not "permanent"/"present"
    assert.match(t, /LOAN_IN/);
    assert.match(t, /2026-02-01 → 2026-12-31/); // bounded loan window
    assert.doesNotMatch(t, /present/i);
  });
  test('expected return only shows when non-null (a null return date is never an estimate)', () => {
    const withReturn: TeamAvailabilityRecord[] = [{ ...AVAILABILITY[0], expectedReturnOn: '2026-10-01' }];
    assert.match(text(<TeamPlayers squad={SQUAD} availability={withReturn} />), /expected return 2026-10-01/);
    // AVAILABILITY has expectedReturnOn: null → no "expected return" line at all.
    assert.doesNotMatch(text(<TeamPlayers squad={SQUAD} availability={AVAILABILITY} />), /expected return/i);
  });
  test('non-empty squad renders each registered player; empty squad shows the honest empty state only', () => {
    // Populated (e.g. an ingested roster) → every player row renders, no empty message.
    const full = text(<TeamPlayers squad={SQUAD} availability={[]} />);
    assert.match(full, /Gabriel Barbosa/);
    assert.doesNotMatch(full, /No squad registered yet/i);
    // Genuinely empty read model → the honest empty state, and only then.
    assert.match(text(<TeamPlayers squad={[]} availability={[]} />), /No squad registered yet/i);
  });
});

// GOVERNED home_away_split + consistency_index — render the module reading verbatim,
// visually governed, never a frontend calculation. Regression against relabelling
// descriptive home/away or goal-margin volatility as governed.
const HAS_READING: TeamGovernedReading = { moduleKey: 'home_away_split', status: 'NEUTRAL', strength: null, confidence: null, sample: { matches: 3, meetsThreshold: true }, verdictText: 'Balanced home and away', inactiveReason: null, asOf: '2026-09-13T12:30:00.000Z', scope: { kind: 'COMPETITION_SCOPED', competitionEditionId: '18' }, evidence: null };
const CONSISTENCY_READING: TeamGovernedReading = { moduleKey: 'consistency_index', status: 'MEASURED', strength: 1.89, confidence: null, sample: { matches: 10, meetsThreshold: true }, verdictText: null, inactiveReason: null, asOf: '2026-09-13T12:30:00.000Z', scope: { kind: 'ALL_COMPETITIONS', competitionEditionId: null }, evidence: null };

describe('Governed Home/Away Split + Consistency (governed module readings)', () => {
  test('Home/Away Split renders governed status + verdict + sample + scope, badged governed', () => {
    const markup = html(<TeamHomeAwaySplitPanel readings={[HAS_READING]} />);
    assert.match(markup, /governed/i);
    const t = text(<TeamHomeAwaySplitPanel readings={[HAS_READING]} />);
    assert.match(t, /Home \/ Away Split/); assert.match(t, /NEUTRAL/); assert.match(t, /Balanced home and away/);
    assert.match(t, /n=3/); assert.match(t, /Competition scoped/);
    assert.doesNotMatch(t, /%/); // no percentage / win-rate arithmetic
  });
  test('Consistency renders MEASURED + magnitude 1.89 with volatility meaning (not a 0-100 score)', () => {
    const t = text(<TeamConsistencyPanel reading={CONSISTENCY_READING} />);
    assert.match(t, /Consistency Index/); assert.match(t, /MEASURED/); assert.match(t, /1\.89/);
    assert.match(t, /goal-margin volatility/i); assert.match(t, /less consistent/i);
    assert.match(t, /n=10/); assert.match(t, /All competitions/);
    assert.doesNotMatch(t, /%/);
  });
  test('INACTIVE reading shows status + reason honestly, no fabricated verdict/value', () => {
    const inactive: TeamGovernedReading = { ...HAS_READING, status: 'INACTIVE', inactiveReason: 'FEATURE_ABSENT', verdictText: null, strength: null };
    const t = text(<TeamHomeAwaySplitPanel readings={[inactive]} />);
    assert.match(t, /INACTIVE/); assert.match(t, /FEATURE_ABSENT/);
  });
  test('absent readings → honest governed empty states (not zero, not fabricated)', () => {
    assert.match(text(<TeamHomeAwaySplitPanel readings={[]} />), /No governed home\/away split reading available/i);
    assert.match(text(<TeamConsistencyPanel reading={null} />), /No governed consistency reading available/i);
  });
  test('negative control: no Giant Killer governed reading is rendered by these panels', () => {
    const all = (text(<TeamHomeAwaySplitPanel readings={[HAS_READING]} />) + ' ' + text(<TeamConsistencyPanel reading={CONSISTENCY_READING} />)).toLowerCase();
    assert.doesNotMatch(all, /giant.?killer/);
  });
});

// NEXT-FIXTURE SELECTION PICTURE — a descriptive availability SUMMARY attached to the
// upcoming fixtures. Locks the honesty contract: no-record ≠ available, null expected
// return is not an estimate, and the full per-player picture stays in Squad (this block
// only summarizes count + lists the explicitly unavailable).
describe('Next-fixture selection picture (descriptive availability summary)', () => {
  test('shows registered count, explicitly-unavailable list (kind/reason/return), and honest unknown count', () => {
    const markup = html(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" nextFixture={NEXT_FIXTURE} />);
    assert.match(markup, /href="\/v2\/matches\/gremio-vs-flamengo-494"/); // opponent home for an away fixture
    const t = text(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" nextFixture={NEXT_FIXTURE} />);
    assert.match(t, /selection picture/i);
    assert.match(t, /29 registered/);
    assert.match(t, /Explicitly unavailable \(2\)/);
    assert.match(t, /INJURY.*Injured Player/); assert.match(t, /Meniscus Injury/);
    assert.match(t, /SUSPENSION.*Suspended Player/);
    assert.match(t, /expected return 2026-09-27/);           // shown only for the record that has one
    assert.match(t, /27 registered players have no current unavailability record/); // honest wording, NOT "27 available"
    assert.match(t, /not confirmed available, fit, rested or selected/i);
    assert.doesNotMatch(t, /27 available/i);
  });
  test('no explicitly-unavailable records → honest per-fixture empty line (not "all available")', () => {
    const clean = { ...NEXT_FIXTURE, explicitlyUnavailable: [], availabilityUnknown: NEXT_FIXTURE.availabilityUnknown };
    const t = text(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" nextFixture={clean} />);
    assert.match(t, /No current unavailability records for this fixture/i);
    assert.doesNotMatch(t, /all available/i);
  });
  test('singular grammar when exactly one registered player has no record', () => {
    const one = { ...NEXT_FIXTURE, availabilityUnknown: [{ playerId: '60', fullName: 'Only One' }] };
    assert.match(text(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" nextFixture={one} />), /1 registered player has no current unavailability record/);
  });
});

// SEASON STATISTICS — descriptive backend-derived season aggregates. Renders numericTotal
// verbatim + fixtures/players coverage, grouped and curated. Locks: only catalogued numeric
// keys appear, JSON provider metadata and null totals are excluded, no numericMean/percentage/
// per-90, and it is NOT badged governed.
describe('Season statistics (descriptive derived aggregates)', () => {
  test('renders curated numeric totals by group with fixtures/players coverage', () => {
    const t = text(<TeamSeasonStatistics playerStatistics={PLAYER_STATS} />);
    assert.match(t, /Season statistics/i);
    assert.match(t, /derived aggregates/i);
    // groups with ≥1 present metric
    assert.match(t, /Attacking/); assert.match(t, /Passing &amp; distribution/); assert.match(t, /Goalkeeping/);
    // curated labels + backend totals verbatim
    assert.match(t, /Goals\s+48/); assert.match(t, /xG\s+31\.9995/);
    assert.match(t, /Accurate passes\s+10478/); assert.match(t, /Saves\s+80/);
    // coverage metadata (no percentages)
    assert.match(t, /25 fx · 12 pl/);
  });
  test('excludes JSON provider metadata, non-catalogued keys, and null totals (no zero-fill, no key dump)', () => {
    const t = text(<TeamSeasonStatistics playerStatistics={PLAYER_STATS} />);
    assert.doesNotMatch(t, /ratingVersions/i);      // JSON provider metadata excluded
    assert.doesNotMatch(t, /passValueNormalized/i); // numeric but not catalogued → not dumped
    assert.doesNotMatch(t, /normalized/i);
    assert.doesNotMatch(t, /Tackles/);              // catalogued but null total → excluded
    assert.doesNotMatch(t, /Defending/);            // whole group has no present metric → absent
    // Saves is the only present goalkeeping metric; a null-total goalkeeping key never shows a 0.
    assert.doesNotMatch(t, /Goals prevented/);
  });
  test('numericMean is NOT surfaced (hidden denominator) and there is no per-90/percentage/rating-score language', () => {
    const t = text(<TeamSeasonStatistics playerStatistics={PLAYER_STATS} />).toLowerCase();
    assert.equal(t.includes('1.0667'), false);   // mean per player-match not rendered
    assert.equal(t.includes('24.0874'), false);
    for (const term of ['predicted', 'prediction', 'probability', 'forecast', 'per 90', 'per-90', 'per match', 'odds', 'bookmaker', 'stake', 'wager', 'betting', 'recommend', 'percentile', 'conversion', 'out of 100']) {
      assert.equal(t.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(t, /\bbet\b/);
    assert.doesNotMatch(t, /\btravel\b/);   // physical "distance covered" is legitimate; travel distance is not
    assert.doesNotMatch(t, /%/);
  });
  test('descriptive, never badged governed', () => {
    const markup = html(<TeamSeasonStatistics playerStatistics={PLAYER_STATS} />);
    assert.match(markup, /context/);          // descriptive context eyebrow badge
    assert.doesNotMatch(markup, /governed/i);  // never governed, no module status badge
  });
  test('empty statistics → honest empty state (not a fabricated table of zeros)', () => {
    assert.match(text(<TeamSeasonStatistics playerStatistics={{ playersWithStats: 0, statisticKeys: [] }} />), /No season statistics recorded yet/i);
  });
});

// LAST MATCH — most recent completed fixture's recorded player statistics (evidence).
// Locks: team-relative score (away orientation), verbatim provider values, JSON metadata
// excluded, honest dashes for missing primary metrics, backend order preserved, player
// links only when resolvable, no starter/bench/inference, no derived football calculation.
describe('Last match (player statistics evidence)', () => {
  function lastMatch(over: Partial<React.ComponentProps<typeof TeamLastMatch>> = {}) {
    return <TeamLastMatch playerPerformances={PERFORMANCES} squad={SQUAD} teamName="Flamengo" {...over} />;
  }
  test('fixture header shows opponent, competition, away venue, date, team-relative score + result', () => {
    const markup = html(lastMatch());
    assert.match(markup, /href="\/v2\/matches\/botafogo-vs-flamengo-480"/); // opponent home for an away fixture
    const t = text(lastMatch());
    assert.match(t, /Flamengo 1–2 Botafogo/);   // team-relative: GF first
    assert.doesNotMatch(t, /2–1/);               // away score NOT inverted (orientation regression)
    assert.match(t, /Brasileirão Betano/); assert.match(t, /Away/);
  });
  test('primary metrics render verbatim; missing values are honest dashes (never zero-filled)', () => {
    const t = text(lastMatch());
    assert.match(t, /Gabriel Barbosa/);
    assert.match(t, /7\.7/);        // rating verbatim, not rounded
    assert.match(t, /0\.2506/);      // xG verbatim
    assert.match(t, /0\.0366572/);   // xA verbatim, full precision
    // The sub recorded only minutes → Min shows, Rating/xG/xA are dashes (not 0).
    assert.match(t, /Unlinked Sub\s+12\s+—/);
  });
  test('player links only when the slug resolves via squad; unresolved names are plain text', () => {
    const markup = html(lastMatch());
    assert.match(markup, /href="\/v2\/players\/gabriel-barbosa-441-5001"/); // in squad → linked
    assert.doesNotMatch(markup, /href="[^"]*5099"/);                        // not in squad → no fabricated link
  });
  test('expandable raw statistics render verbatim and exclude JSON provider metadata', () => {
    const t = text(lastMatch());
    assert.match(t, /5 statistics/);        // 7 recorded − 2 JSON metadata = 5 displayable
    assert.match(t, /accuratePass/);         // raw provider key surfaced verbatim
    assert.doesNotMatch(t, /ratingVersions/); assert.doesNotMatch(t, /statisticsType/);
    assert.doesNotMatch(t, /"original"/);    // no raw JSON dumped
  });
  test('preserves backend player order (no derived ranking) and shows no starter/bench/inference label', () => {
    const markup = html(lastMatch());
    assert.ok(markup.indexOf('Gabriel Barbosa') < markup.indexOf('Unlinked Sub')); // API order kept
    const t = text(lastMatch()).toLowerCase();
    for (const term of ['starter', 'starting xi', 'bench', 'inferred', 'best player', 'worst player', 'impact', 'ranked', 'per 90', 'per-90']) {
      assert.equal(t.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(t, /%/);
  });
  test('descriptive, never badged governed', () => {
    const markup = html(lastMatch());
    assert.match(markup, /context/); assert.doesNotMatch(markup, /governed/i);
  });
  test('no completed match with stats → honest empty state', () => {
    assert.match(text(lastMatch({ playerPerformances: { fixture: null, performances: [] } })), /No completed match with player statistics yet/i);
  });
});

describe('no prediction / probability / travel / betting language across the team hub', () => {
  test('the assembled surfaces carry no forbidden lexicon', () => {
    const all = [
      text(header()),
      text(currentForm()),
      text(<TeamReadinessPanel readiness={READING} coverage={{ readiness: 'present', readinessIsGoverned: true }} />),
      text(<TeamCompetitionContext participation={PARTICIPATION} />),
      text(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" nextFixture={NEXT_FIXTURE} />),
      text(<TeamPlayers squad={SQUAD} availability={AVAILABILITY} />),
      text(<TeamLastMatch playerPerformances={PERFORMANCES} squad={SQUAD} teamName="Flamengo" />),
    ].join(' ').toLowerCase();
    for (const term of ['predicted', 'prediction', 'probability', 'travel', 'distance', 'fatigue', 'forecast', 'odds', 'bookmaker', 'stake', 'wager', 'betting', 'recommend']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
