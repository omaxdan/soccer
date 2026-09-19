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
  TeamConsistencyPanel, TeamCompetitionContext, TeamSeasonStatistics,
  TeamSquadSnapshot, TeamAvailabilityBoard, TeamLastAppearance,
  TeamUpcomingFixtures, TeamPlayers, TeamCoverage,
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
  { competitionEditionId: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, fixturesTotal: 38, completed: 20, scheduled: 18, postponed: 0, registered: true, firstKickoff: '2026-04-12T20:00:00.000Z', lastKickoff: '2026-12-06T20:00:00.000Z' },
  { competitionEditionId: '41', seasonLabel: 'Libertadores 2026', competition: { id: '55', name: 'CONMEBOL Libertadores', slug: 'conmebol-libertadores-9' }, fixturesTotal: 1, completed: 1, scheduled: 0, postponed: 0, registered: true, firstKickoff: null, lastKickoff: null },
];
const COVERAGE: TeamIntelligence['coverage'] = {
  registrations: 'present', availability: 'present', valuations: 'present', playerMatchStatistics: 'present',
  appearances: 'not-supported', perPlayerCards: 'not-supported', standings: 'not-supported', managerReferee: 'not-supported',
  statisticsAreDerivedAggregates: true,
};
const SQUAD: TeamIntelligence['squad'] = [
  { playerId: '5001', fullName: 'Gabriel Barbosa', shortName: 'Gabigol', slug: 'gabriel-barbosa-441', registrationKindCode: 'PERMANENT', registrationFrom: '2026-01-15', registrationTo: null },
  { playerId: '5002', fullName: 'Injured Player', shortName: null, slug: 'injured-player-882', registrationKindCode: 'LOAN_IN', registrationFrom: '2026-02-01', registrationTo: '2026-12-31' },
];
const AVAILABILITY: TeamAvailabilityRecord[] = [
  { playerId: '5002', fullName: 'Injured Player', unavailabilityKindCode: 'INJURY', from: '2026-09-10', to: null, expectedReturnOn: null, reason: 'Meniscus Injury', severityRank: null, current: true },
];
const VALUATIONS: TeamIntelligence['valuations'] = [
  // playerId 5001 is in SQUAD (linked); 5002 is in SQUAD but here left UNVALUED (must show dash, not 0).
  { playerId: '5001', fullName: 'Gabriel Barbosa', amount: '39000000', currencyCode: 'EUR', asOfOn: '2026-09-17', sourceCode: 'SPORTSAPI_API' },
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
  return <TeamCurrentForm recent={RECENT} home={HOME_LINES} away={AWAY_LINES} teamName="Flamengo" {...over} />;
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

describe('Current form (W/D/L strip + venue-split fixtures — form evidence only)', () => {
  test('renders strip and recent home/away tables with links', () => {
    const markup = html(currentForm());
    assert.match(markup, /Fluminense/);                                        // home opponent
    assert.match(markup, /Palmeiras/);                                         // away opponent
    assert.match(markup, /href="\/v2\/matches\/flamengo-vs-fluminense-900"/);  // home → team is home
    assert.match(markup, /href="\/v2\/matches\/palmeiras-vs-flamengo-901"/);   // away → team is away
    const t = text(currentForm());
    assert.match(t, /Recent home matches/); assert.match(t, /Recent away matches/);
  });
  test('venue tables show team-relative GF/GA per row', () => {
    const t = text(currentForm());
    assert.match(t, /W\s+2\s+0/);  // home 2-0 win: Res GF GA
    assert.match(t, /D\s+1\s+1/);  // away 1-1 draw
  });
  test('does NOT re-show the descriptive signal metrics (those live in the Overview briefing)', () => {
    const t = text(currentForm());
    assert.doesNotMatch(t, /Home form/); assert.doesNotMatch(t, /Momentum/); assert.doesNotMatch(t, /Vs stronger opponents/);
    assert.match(t, /Recent home matches/);     // venue evidence remains
  });
  test('empty recent → honest empty state', () => {
    assert.match(text(currentForm({ recent: [], home: [], away: [] })), /No completed matches/i);
  });
  test('null score → em dash (never zero-filled)', () => {
    const NULL_LINE: TeamFixtureLine = { ...HOME_LINES[0], fixtureId: '905', score: null };
    const t = text(currentForm({ recent: [NULL_LINE], home: [NULL_LINE], away: [] }));
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
    const t = text(currentForm({ recent: [HOME_WIN, AWAY_LOSS], home: [HOME_WIN], away: [AWAY_LOSS] }));
    assert.match(t, /W\s+1\s+0/);      // home: Res GF GA
    assert.match(t, /L\s+1\s+2/);      // away: Res GF GA, team-relative
    assert.doesNotMatch(t, /L\s+2\s+1/); // must NOT invert the away row
  });
  test('away win renders W 3 1 (GF first), not W 1 3', () => {
    const t = text(currentForm({ recent: [AWAY_WIN], home: [], away: [AWAY_WIN] }));
    assert.match(t, /W\s+3\s+1/);
    assert.doesNotMatch(t, /W\s+1\s+3/);
  });
  test('invariant: venue result letter agrees with GF/GA (GF>GA→W, GF<GA→L)', () => {
    const win = text(currentForm({ recent: [HOME_WIN], home: [HOME_WIN], away: [] }));
    assert.match(win, /W\s+1\s+0/); assert.doesNotMatch(win, /[LD]\s+1\s+0/);
    const loss = text(currentForm({ recent: [AWAY_LOSS], home: [], away: [AWAY_LOSS] }));
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
  test('roster links players canonically and carries registration + value only (availability moved to its board)', () => {
    const markup = html(<TeamPlayers squad={SQUAD} valuations={VALUATIONS} />);
    assert.match(markup, /href="\/v2\/players\/gabriel-barbosa-441-5001"/);
    const t = text(<TeamPlayers squad={SQUAD} valuations={VALUATIONS} />);
    // Availability is no longer a roster column — it lives in the dedicated board.
    assert.doesNotMatch(t, /INJURY/);
    assert.doesNotMatch(t, /no current record/i);
    assert.doesNotMatch(t, /\bavailable\b/i);
  });
  test('registration is human-readable for known codes, verbatim (identifiable) otherwise, from/to null-honest', () => {
    const t = text(<TeamPlayers squad={SQUAD} />);
    assert.match(t, /Permanent/);               // PERMANENT → friendly label
    assert.doesNotMatch(t, /PERMANENT/);        // raw code not shown once mapped
    assert.match(t, /LOAN_IN/);                 // unknown/variant code stays identifiable — never remapped
    assert.match(t, /2026-01-15 → —/);          // open-ended registration: null `to` → dash, not "permanent"/"present"
    assert.match(t, /2026-02-01 → 2026-12-31/); // bounded loan window
    assert.doesNotMatch(t, /present/i);
  });
  test('non-empty squad renders each registered player; empty squad shows the honest empty state only', () => {
    // Populated (e.g. an ingested roster) → every player row renders, no empty message.
    const full = text(<TeamPlayers squad={SQUAD} />);
    assert.match(full, /Gabriel Barbosa/);
    assert.doesNotMatch(full, /No squad registered yet/i);
    // Genuinely empty read model → the honest empty state, and only then.
    assert.match(text(<TeamPlayers squad={[]} />), /No squad registered yet/i);
  });
});

// SQUAD SNAPSHOT — the tri-state headline. Locks the honesty rule: the remainder of the
// registered squad without a current unavailability record is "Unknown", NEVER "Available".
describe('Squad snapshot (tri-state: Registered / Unavailable / Unknown)', () => {
  test('counts registered, current-unavailable (in squad), and the unknown remainder', () => {
    const t = text(<TeamSquadSnapshot squad={SQUAD} availability={AVAILABILITY} />);
    assert.match(t, /Registered/); assert.match(t, /Unavailable/); assert.match(t, /Unknown/);
    assert.match(t, /2\s*Registered/);   // SQUAD has 2 players
    assert.match(t, /1\s*Unavailable/);  // Injured Player (5002) has a current record
    assert.match(t, /1\s*Unknown/);      // remainder
  });
  test('no availability records → every registered player is Unknown, never Available', () => {
    const t = text(<TeamSquadSnapshot squad={SQUAD} availability={[]} />);
    assert.match(t, /2\s*Registered/);
    assert.match(t, /0\s*Unavailable/);
    assert.match(t, /2\s*Unknown/);
    assert.doesNotMatch(t, /\d+\s*Available/i); // the remainder is Unknown — never a count of "Available"
  });
  test('a non-current unavailability record does not reduce the Unknown remainder', () => {
    const past: TeamAvailabilityRecord[] = [{ ...AVAILABILITY[0], current: false }];
    const t = text(<TeamSquadSnapshot squad={SQUAD} availability={past} />);
    assert.match(t, /0\s*Unavailable/);
    assert.match(t, /2\s*Unknown/);
  });
});

// AVAILABILITY & INJURIES — the prominent board. Locks: current records rendered verbatim
// (kind/reason/from + return only when present), a non-current record is not "current", and
// absence of records is an honest empty line, never a positive "all available" conclusion.
describe('Availability & injuries board (prominent, honest)', () => {
  test('renders each current record verbatim: player, kind, reason, from; return only when non-null', () => {
    const t = text(<TeamAvailabilityBoard availability={AVAILABILITY} />);
    assert.match(t, /Availability &amp; injuries/i);
    assert.match(t, /Injured Player/);
    assert.match(t, /INJURY/);
    assert.match(t, /Meniscus Injury/);   // reason verbatim
    assert.match(t, /from 2026-09-10/);    // meaningful `from`
    assert.doesNotMatch(t, /expected return/i); // this record's return is null → no estimate line
  });
  test('expected return shows only when the record supplies it', () => {
    const withReturn: TeamAvailabilityRecord[] = [{ ...AVAILABILITY[0], expectedReturnOn: '2026-10-01' }];
    assert.match(text(<TeamAvailabilityBoard availability={withReturn} />), /expected return 2026-10-01/);
  });
  test('no current records → honest empty line, never "all available" or an availability count', () => {
    const t = text(<TeamAvailabilityBoard availability={[]} />);
    assert.match(t, /No current unavailability records/i);
    assert.doesNotMatch(t, /all available/i);
    assert.doesNotMatch(t, /\d+\s*Available/i);
  });
  test('a non-current record is not shown as a current unavailability', () => {
    const past: TeamAvailabilityRecord[] = [{ ...AVAILABILITY[0], current: false }];
    assert.match(text(<TeamAvailabilityBoard availability={past} />), /No current unavailability records/i);
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

// PER-PLAYER VALUATION — descriptive, provider-derived, joined into the Squad by playerId.
// Locks: verbatim amount + currency (no invented symbol/rounding), as-of from the record,
// no sourceCode dump per row, unvalued → dash (never €0), squad order preserved, and NO
// squad total / average / ranking anywhere.
describe('Per-player valuation (descriptive, in Squad)', () => {
  test('valued player shows verbatim amount + currency + record as-of date; joined by playerId', () => {
    const t = text(<TeamPlayers squad={SQUAD} valuations={VALUATIONS} />);
    assert.match(t, /Gabriel Barbosa/);
    assert.match(t, /39000000 EUR/);   // verbatim amount + provider currency (no € / m rounding)
    assert.doesNotMatch(t, /€/);        // no invented currency symbol
    assert.doesNotMatch(t, /39m/i);     // no invented magnitude rounding
    assert.match(t, /as of 2026-09-17/); // from the record's asOfOn, not page/fetch time
  });
  test('registered player without a valuation shows a dash, never a zero value', () => {
    const t = text(<TeamPlayers squad={SQUAD} valuations={VALUATIONS} />);
    // SQUAD[1] (Injured Player, 5002) has no valuation record → dash, not 0/€0/N/A.
    assert.match(t, /Injured Player/);
    assert.equal((t.match(/EUR/g) ?? []).length, 1); // only the one valued player carries a currency value
    assert.doesNotMatch(t, /\b0 EUR/); assert.doesNotMatch(t, /€0/); assert.doesNotMatch(t, /\bN\/A\b/);
  });
  test('sourceCode is not dumped into the row', () => {
    assert.doesNotMatch(text(<TeamPlayers squad={SQUAD} valuations={VALUATIONS} />), /SPORTSAPI/i);
  });
  test('non-EUR currency is preserved verbatim (never converted)', () => {
    const gbp: TeamIntelligence['valuations'] = [{ ...VALUATIONS[0], amount: '25000000', currencyCode: 'GBP', asOfOn: '2026-09-17', sourceCode: null }];
    const t = text(<TeamPlayers squad={SQUAD} valuations={gbp} />);
    assert.match(t, /25000000 GBP/);
    assert.doesNotMatch(t, /EUR/); assert.doesNotMatch(t, /€/);
  });
  test('valuations preserve squad order (no ranking) and add no squad total/average', () => {
    const many: TeamIntelligence['valuations'] = [
      { playerId: '5002', fullName: 'Injured Player', amount: '4400000', currencyCode: 'EUR', asOfOn: '2026-09-17', sourceCode: null },
      { playerId: '5001', fullName: 'Gabriel Barbosa', amount: '39000000', currencyCode: 'EUR', asOfOn: '2026-09-17', sourceCode: null },
    ];
    const markup = html(<TeamPlayers squad={SQUAD} valuations={many} />);
    // SQUAD order is [Gabriel (5001), Injured (5002)] — preserved regardless of valuation size.
    assert.ok(markup.indexOf('Gabriel Barbosa') < markup.indexOf('Injured Player'));
    const t = text(<TeamPlayers squad={SQUAD} valuations={many} />).toLowerCase();
    for (const term of ['squad value', 'total value', 'average value', 'median', 'most valuable', 'percentile', 'ranked']) {
      assert.equal(t.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(t, /43400000/); // 39.0m + 4.4m must NOT be summed anywhere
  });
  test('no valuations passed → column shows dashes only, no fabricated values', () => {
    const t = text(<TeamPlayers squad={SQUAD} />);
    assert.match(t, /Gabriel Barbosa/);
    assert.doesNotMatch(t, /EUR/); assert.doesNotMatch(t, /€/);
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

// LAST APPEARANCE — compact pointer to the most recent completed fixture that carries
// player statistics. Locks: fixture identity + team-relative score (away orientation not
// inverted) + a Match-page link ONLY. Per-player minutes/rating/xG/xA and raw match
// statistics are the Match page's job and must NOT be duplicated here.
describe('Last appearance (compact reference)', () => {
  function lastAppearance(over: Partial<React.ComponentProps<typeof TeamLastAppearance>> = {}) {
    return <TeamLastAppearance playerPerformances={PERFORMANCES} teamName="Flamengo" {...over} />;
  }
  test('shows fixture identity, team-relative score, and a link to the match page', () => {
    const markup = html(lastAppearance());
    assert.match(markup, /href="\/v2\/matches\/botafogo-vs-flamengo-480"/); // opponent home for an away fixture
    assert.match(markup, /View match/);
    const t = text(lastAppearance());
    assert.match(t, /Last appearance/i);
    assert.match(t, /Flamengo 1–2 Botafogo/);   // team-relative: GF first
    assert.doesNotMatch(t, /2–1/);               // away score NOT inverted (orientation regression)
    assert.match(t, /Brasileirão Betano/); assert.match(t, /Away/);
  });
  test('is a pointer, not a stat table: no per-player rows or stat values duplicated', () => {
    const t = text(lastAppearance());
    assert.doesNotMatch(t, /Gabriel Barbosa/);   // no per-player rows
    assert.doesNotMatch(t, /Unlinked Sub/);
    assert.doesNotMatch(t, /7\.7/);              // no rating value
    assert.doesNotMatch(t, /0\.2506/);            // no xG value
    assert.doesNotMatch(t, /0\.0366572/);         // no xA value
    assert.doesNotMatch(t, /accuratePass/);       // no raw provider stat dump
    assert.match(t, /detailed match statistics are on the match page/i); // points to canonical source
  });
  test('descriptive, never badged governed', () => {
    const markup = html(lastAppearance());
    assert.match(markup, /context/); assert.doesNotMatch(markup, /governed/i);
  });
  test('no completed fixture → honest empty state', () => {
    assert.match(text(lastAppearance({ playerPerformances: { fixture: null, performances: [] } })), /No completed match recorded yet/i);
  });
});

// DATA COVERAGE + richer COMPETITION PARTICIPATION — descriptive transparency/context.
// Locks: coverage states rendered verbatim (present / not-supported), derived-aggregate
// disclosure, no data-quality score / percentage / universal timestamp; multi-competition
// participation with completed/scheduled/postponed + first/last kickoff, no frontend
// completion percentage or remaining-fixture subtraction.
describe('Data coverage (transparency)', () => {
  test('renders present and not-supported states verbatim with the derived-aggregate disclosure', () => {
    const t = text(<TeamCoverage coverage={COVERAGE} />);
    assert.match(t, /Data coverage/i);
    assert.match(t, /Registrations\s+PRESENT/);
    assert.match(t, /Player statistics\s+PRESENT/);
    assert.match(t, /Appearances\s+NOT SUPPORTED/);
    assert.match(t, /Standings\s+NOT SUPPORTED/);
    assert.match(t, /Manager \/ Referee\s+NOT SUPPORTED/);
    assert.match(t, /backend-derived aggregates/i);
    assert.match(t, /not that it does not exist/i); // honest: not-supported ≠ doesn't exist
  });
  test('no invented data-quality score, percentage, or failure language', () => {
    const t = text(<TeamCoverage coverage={COVERAGE} />).toLowerCase();
    assert.doesNotMatch(t, /%/);
    for (const term of ['quality score', 'score:', 'error', 'broken', 'failed', 'failure', 'predicted', 'probability']) {
      assert.equal(t.includes(term), false, `must not contain "${term}"`);
    }
  });
  test('a not-supported domain is never rendered as PRESENT/available', () => {
    const t = text(<TeamCoverage coverage={COVERAGE} />);
    // Standings is not-supported here → must not appear as PRESENT.
    assert.doesNotMatch(t, /Standings\s+PRESENT/);
    assert.doesNotMatch(t, /available/i);
  });
  test('partial/absent states render honestly (not forced to present)', () => {
    const t = text(<TeamCoverage coverage={{ ...COVERAGE, valuations: 'absent', availability: 'partial' }} />);
    assert.match(t, /Valuations\s+ABSENT/);
    assert.match(t, /Availability\s+PARTIAL/);
  });
});

describe('Competition participation (richer multi-competition context)', () => {
  test('renders every competition with completed/scheduled/postponed and the kickoff window', () => {
    const markup = html(<TeamCompetitionContext participation={PARTICIPATION} />);
    assert.match(markup, /href="\/v2\/competitions\/brasileirao-betano-325-28"/);
    assert.match(markup, /CONMEBOL Libertadores/);
    const t = text(<TeamCompetitionContext participation={PARTICIPATION} />);
    assert.match(t, /38/); assert.match(t, /20/); assert.match(t, /18/); // fixtures/completed/scheduled verbatim
    assert.match(t, /first/); assert.match(t, /last/);                    // kickoff window fields surfaced
    assert.match(t, /Apr/); assert.match(t, /Dec/);                       // first/last kickoff dates rendered
  });
  test('no frontend completion percentage or remaining-fixture subtraction', () => {
    const t = text(<TeamCompetitionContext participation={PARTICIPATION} />);
    assert.doesNotMatch(t, /%/);
    // 38 total − 20 completed = 18 remaining is NOT computed; only backend counts appear.
    // (18 does legitimately appear as the backend `scheduled` count, so we assert no "remaining" label.)
    assert.doesNotMatch(t, /remaining/i);
    assert.doesNotMatch(t, /complete\b/i); // no "X% complete" style progress label
  });
  test('null kickoff window renders honest — (never a fabricated date)', () => {
    // Libertadores row: both first/last kickoff null → a single dash, no invented month/date.
    const t = text(<TeamCompetitionContext participation={[PARTICIPATION[1]]} />);
    assert.doesNotMatch(t, /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    // Mixed: first present, last null → the present date shows and the missing side is honest.
    const mixed = { ...PARTICIPATION[1], firstKickoff: '2026-04-12T20:00:00.000Z', lastKickoff: null };
    const tm = text(<TeamCompetitionContext participation={[mixed]} />);
    assert.match(tm, /Apr/); assert.match(tm, /last —/);
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
      text(<TeamSquadSnapshot squad={SQUAD} availability={AVAILABILITY} />),
      text(<TeamAvailabilityBoard availability={AVAILABILITY} />),
      text(<TeamPlayers squad={SQUAD} valuations={VALUATIONS} />),
      text(<TeamLastAppearance playerPerformances={PERFORMANCES} teamName="Flamengo" />),
      text(<TeamCoverage coverage={COVERAGE} />),
    ].join(' ').toLowerCase();
    for (const term of ['predicted', 'prediction', 'probability', 'travel', 'distance', 'fatigue', 'forecast', 'odds', 'bookmaker', 'stake', 'wager', 'betting', 'recommend']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
