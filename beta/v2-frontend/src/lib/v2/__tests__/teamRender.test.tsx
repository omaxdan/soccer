// TEAM ENTITY HUB RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Verifies the Team page surfaces render honest, numbers-first content with a strict
// evidence-vs-intelligence separation:
//   • identity links (country, competition/edition); player + match links use
//     canonical public URLs;
//   • descriptive performance FEATURES render as numbers with sample sizes, badged
//     "context"; the governed readiness reading is badged "governed" and never merged;
//   • nullable metrics/scores render as an em dash — never zero-filled;
//   • empty collections show honest empty states;
//   • no prediction / probability / travel / betting language, and no claim that a
//     context table is itself the governed calculation.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  TeamIdentityHeader, TeamPerformanceSnapshot, TeamCurrentForm, TeamHomeAwaySplit,
  TeamReadinessPanel, TeamStandings, TeamCompetitionContext,
  TeamUpcomingFixtures, TeamPlayers, type TeamStandingEntry,
} from '@/components/v2/team';
import type {
  ApiPlayerSummary, CompetitionPerformance, PerformanceMetric,
  TeamAvailabilityRecord, TeamDetailResponse, TeamFixtureLine, TeamParticipation,
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
const BY_COMP: CompetitionPerformance[] = [
  { edition: { id: '18', seasonLabel: '2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' } }, homeWinRate: METRIC(0.67, 12), awayWinRate: METRIC(0.36, 11) },
];
const HOME_LINES: TeamFixtureLine[] = [
  { fixtureId: '900', kickoffAt: '2026-08-01T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '67', name: 'Fluminense', slug: 'fluminense-1961' }, isHome: true, status: 'COMPLETED', score: { home: 2, away: 0 } },
];
const AWAY_LINES: TeamFixtureLine[] = [
  { fixtureId: '901', kickoffAt: '2026-07-25T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }, isHome: false, status: 'COMPLETED', score: { home: 1, away: 1 } },
];
const UPCOMING: TeamFixtureLine[] = [
  { fixtureId: '950', kickoffAt: '2026-09-20T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '73', name: 'Atlético Mineiro', slug: 'atletico-mineiro-1977' }, isHome: false, status: 'SCHEDULED', score: null },
];
const PARTICIPATION: TeamParticipation[] = [
  { competitionEditionId: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, fixturesTotal: 38, completed: 20, scheduled: 18, postponed: 0, registered: true, firstKickoff: null, lastKickoff: null },
];
const SQUAD: ApiPlayerSummary[] = [
  { id: '5001', fullName: 'Gabriel Barbosa', shortName: 'Gabigol', slug: 'gabriel-barbosa-441', team: null },
  { id: '5002', fullName: 'Injured Player', shortName: null, slug: 'injured-player-882', team: null },
];
const AVAILABILITY: TeamAvailabilityRecord[] = [
  { playerId: '5002', fullName: 'Injured Player', unavailabilityKindCode: 'INJURY', from: null, to: null, expectedReturnOn: null, reason: null, severityRank: null, current: true },
];
const READING: TeamReadinessReading = { moduleKey: 'readiness_tracker', status: 'NEUTRAL', strength: null, confidence: null, sample: { matches: 10, meetsThreshold: true }, verdictText: 'Steady form.', inactiveReason: null, asOf: '2026-07-17T23:00:00.000Z', evidence: null };

describe('Team identity', () => {
  const markup = html(<TeamIdentityHeader team={TEAM} competitions={COMPETITIONS} />);
  test('shows name, short name, home venue; country + competition/edition link canonically', () => {
    assert.match(markup, /Flamengo/);
    assert.match(markup, /Estádio do Maracanã/);
    assert.match(markup, /href="\/v2\/countries\/BR"/);
    assert.match(markup, /href="\/v2\/editions\/brasileirao-betano-325-brasileiro-serie-a-2026-18"/);
  });
});

describe('Performance snapshot (descriptive evidence)', () => {
  test('renders metric values + sample sizes and is labelled context, not governed', () => {
    const t = text(<TeamPerformanceSnapshot overall={OVERALL_FULL} coverage="present" />);
    assert.match(t, /1\.83/); assert.match(t, /n=12/);
    assert.match(t, /not a governed reading/i);
    assert.match(t, /context/i);
  });
  test('null metrics render as em dash — never zero-filled', () => {
    const t = text(<TeamPerformanceSnapshot overall={OVERALL_EMPTY} coverage="partial" />);
    assert.match(t, /—/);
    assert.doesNotMatch(t, /\b0\b/);
  });
  test('absent coverage → honest empty state', () => {
    assert.match(text(<TeamPerformanceSnapshot overall={OVERALL_EMPTY} coverage="absent" />), /No descriptive performance/i);
  });
});

describe('Current form (canonical recent completed fixtures)', () => {
  const NULL_SCORE: TeamFixtureLine = { fixtureId: '902', kickoffAt: '2026-07-10T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }, isHome: false, status: 'COMPLETED', score: null };
  const RECENT: TeamFixtureLine[] = [...HOME_LINES, NULL_SCORE];
  test('renders recent fixtures with opponent + competition + canonical match link; unplayed score as dash', () => {
    const markup = html(<TeamCurrentForm recent={RECENT} teamName="Flamengo" />);
    assert.match(markup, /Fluminense/);                                       // opponent
    assert.match(markup, /Brasileirão Betano/);                               // competition column (unique info folded in from Match History)
    assert.match(markup, /href="\/v2\/matches\/flamengo-vs-fluminense-900"/); // opponent → canonical match link
    assert.match(text(<TeamCurrentForm recent={RECENT} teamName="Flamengo" />), /—/); // null score → dash, never 0
  });
  test('empty → honest empty state', () => {
    assert.match(text(<TeamCurrentForm recent={[]} teamName="Flamengo" />), /No completed matches/i);
  });
});

describe('Home / away split (descriptive)', () => {
  test('renders home/away form metrics and per-edition win-rate table', () => {
    const t = text(<TeamHomeAwaySplit overall={OVERALL_FULL} byCompetition={BY_COMP} />);
    assert.match(t, /Home form/i); assert.match(t, /Away form/i);
    assert.match(t, /0\.67/); assert.match(t, /n=12/);
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

describe('Team standings position (reused governed edition standings)', () => {
  const comp = { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' };
  const withLine: TeamStandingEntry = {
    editionId: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: comp,
    line: { position: 8, team: { id: '59', name: 'Mirassol', slug: 'mirassol-21982' }, played: 25, won: 7, drawn: 6, lost: 12, goalsFor: 22, goalsAgainst: 33, goalDifference: -11, points: 27 },
  };
  test('renders position + points + P/W/D/L + GD; links to the edition standings tab', () => {
    const markup = html(<TeamStandings entries={[withLine]} />);
    assert.match(markup, /href="\/v2\/editions\/brasileirao-betano-325-brasileiro-serie-a-2026-18\?tab=standings"/);
    const t = text(<TeamStandings entries={[withLine]} />);
    assert.match(t, /#8/); assert.match(t, /27 pts/); assert.match(t, /P25/); assert.match(t, /GD -11/);
    assert.match(t, /not computed here/i);
  });
  test('team not in snapshot → honest "position —", never a fabricated number', () => {
    const noLine: TeamStandingEntry = { ...withLine, line: null };
    const t = text(<TeamStandings entries={[noLine]} />);
    assert.match(t, /Position — · not in the current standings snapshot/i);
    assert.doesNotMatch(t, /#\d/);       // no fabricated position
    assert.doesNotMatch(t, /\b0(th)?\b/); // no 0 / 0th
  });
  test('no competitions → honest empty state', () => {
    assert.match(text(<TeamStandings entries={[]} />), /No competition standings available/i);
  });
});

describe('Competition context, match history, upcoming, players', () => {
  test('competition context links competition and edition; shows counts', () => {
    const markup = html(<TeamCompetitionContext participation={PARTICIPATION} />);
    assert.match(markup, /href="\/v2\/competitions\/brasileirao-betano-325-28"/);
    assert.match(markup, /href="\/v2\/editions\/brasileirao-betano-325-brasileiro-serie-a-2026-18"/);
    assert.match(text(<TeamCompetitionContext participation={PARTICIPATION} />), /38/);
  });
  test('current form + upcoming link to canonical match URLs', () => {
    assert.match(html(<TeamCurrentForm recent={[...HOME_LINES, ...AWAY_LINES]} teamName="Flamengo" />), /href="\/v2\/matches\/flamengo-vs-fluminense-900"/);
    // Away fixture: opponent is home in the canonical match slug.
    assert.match(html(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" />), /href="\/v2\/matches\/atletico-mineiro-vs-flamengo-950"/);
  });
  test('empty fixtures/participation → honest empty states', () => {
    assert.match(text(<TeamCurrentForm recent={[]} teamName="Flamengo" />), /No completed matches/i);
    assert.match(text(<TeamUpcomingFixtures upcoming={[]} teamName="Flamengo" />), /No upcoming fixtures/i);
    assert.match(text(<TeamCompetitionContext participation={[]} />), /No governed participation/i);
  });
  test('players link canonically; current availability marks unavailable, others available', () => {
    const markup = html(<TeamPlayers squad={SQUAD} availability={AVAILABILITY} />);
    assert.match(markup, /href="\/v2\/players\/gabriel-barbosa-441-5001"/);
    const t = text(<TeamPlayers squad={SQUAD} availability={AVAILABILITY} />);
    assert.match(t, /available/i);
    assert.match(t, /INJURY/);
  });
});

// Score/result ORIENTATION lock. The backend TeamFixtureLine.score is team-relative
// (score.home = GF, score.away = GA) for BOTH venues; away rows must NOT be inverted.
// Regression for the away-fixture double-orientation bug (e.g. away 1–2 L wrongly shown
// as 2–1 W). Locks the RENDERED behavior, not just the pure helper.
describe('Team fixture score/result orientation (team-relative, both venues)', () => {
  const HOME_WIN: TeamFixtureLine = { fixtureId: '910', kickoffAt: '2026-08-01T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '67', name: 'Fluminense', slug: 'fluminense-1961' }, isHome: true, status: 'COMPLETED', score: { home: 1, away: 0 } };
  const AWAY_LOSS: TeamFixtureLine = { fixtureId: '911', kickoffAt: '2026-07-25T20:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '73', name: 'Atlético Mineiro', slug: 'atletico-mineiro-1977' }, isHome: false, status: 'COMPLETED', score: { home: 1, away: 2 } };
  const AWAY_WIN: TeamFixtureLine = { ...AWAY_LOSS, fixtureId: '912', opponent: { id: '74', name: 'Santos', slug: 'santos-1968' }, score: { home: 3, away: 1 } };

  test('Current Form: home renders 1–0 W and away renders 1–2 L (never inverted to 2–1 W)', () => {
    const t = text(<TeamCurrentForm recent={[HOME_WIN, AWAY_LOSS]} teamName="Flamengo" />);
    assert.match(t, /1–0\s+W/);      // home: GF–GA then result
    assert.match(t, /1–2\s+L/);      // away: GF–GA then result, team-relative
    assert.doesNotMatch(t, /2–1/);   // must NOT show the inverted away score
  });
  test('Current Form: away win renders 3–1 W (GF first), not 1–3', () => {
    const t = text(<TeamCurrentForm recent={[AWAY_WIN]} teamName="Flamengo" />);
    assert.match(t, /3–1\s+W/);
    assert.doesNotMatch(t, /1–3/);
  });
  test('invariant: displayed score x–y agrees with the result letter (x>y→W, x<y→L)', () => {
    const win = text(<TeamCurrentForm recent={[HOME_WIN]} teamName="Flamengo" />);
    assert.match(win, /1–0\s+W/); assert.doesNotMatch(win, /1–0\s+[LD]/);
    const loss = text(<TeamCurrentForm recent={[AWAY_LOSS]} teamName="Flamengo" />);
    assert.match(loss, /1–2\s+L/); assert.doesNotMatch(loss, /1–2\s+[WD]/);
  });
});

describe('no prediction / probability / travel / betting language across the team hub', () => {
  test('the assembled surfaces carry no forbidden lexicon', () => {
    const all = [
      text(<TeamIdentityHeader team={TEAM} competitions={COMPETITIONS} />),
      text(<TeamPerformanceSnapshot overall={OVERALL_FULL} coverage="present" />),
      text(<TeamCurrentForm recent={[...HOME_LINES, ...AWAY_LINES]} teamName="Flamengo" />),
      text(<TeamHomeAwaySplit overall={OVERALL_FULL} byCompetition={BY_COMP} />),
      text(<TeamReadinessPanel readiness={READING} coverage={{ readiness: 'present', readinessIsGoverned: true }} />),
      text(<TeamUpcomingFixtures upcoming={UPCOMING} teamName="Flamengo" />),
    ].join(' ').toLowerCase();
    for (const term of ['predicted', 'prediction', 'probability', 'travel', 'distance', 'fatigue', 'forecast', 'odds', 'bookmaker', 'stake', 'wager', 'betting', 'recommend']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
