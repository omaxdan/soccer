// MATCH OVERVIEW / STATISTICS RENDER TESTS (DB-free; react-dom/server).
//
// Locks the redesigned fixture-centric IA and its honesty rules:
//   • the Intelligence board reads INACTIVE readiness as "Not available" (never a
//     backend code), and shows the VENUE-RELEVANT form (home team's home form, away
//     team's away form) with an honest low-sample note;
//   • Key Signals are plain-language, derived only from supplied values, non-predictive,
//     and surface the xG-vs-result tension (higher xG did not win);
//   • Key Match Evidence + Statistics render observed values with neutral comparison
//     bars (never a green/red "winner"), and never leak backend terminology;
//   • Match Progression derives the 2nd-half score as full − half-time (observed);
//   • scheduled fixtures never show match statistics; H2H has an honest empty state.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  IntelligenceBoard, KeySignals, KeyMatchEvidence, MatchProgression, MatchStatePanel,
  MatchStatisticsFull, HeadToHeadUnavailable, LineupsUnavailable,
} from '@/components/v2/matchOverview';
import type {
  ApiFeatureValue, ApiModuleReading, MatchDetailResponse, MatchResult, MatchTeamStatistics, TeamStatLine,
} from '@/lib/v2/types';

function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }

const fv = (value: number, sample: number, meets: boolean): ApiFeatureValue => ({ value, sampleObservationCount: sample, sampleMeetsThreshold: meets, asOf: '2026-08-23T19:00:00.000Z', direction: 'HIGHER_IS_STRONGER', unit: 'index' });
const INACTIVE_READINESS: ApiModuleReading = { moduleKey: 'readiness_tracker', status: 'INACTIVE', strength: null, confidence: null, sampleObservationCount: 0, sampleMeetsThreshold: false, asOf: '2026-08-23T19:00:00.000Z', verdictText: null, inactiveReason: 'FEATURE_ABSENT', evidence: null };
const NEUTRAL_SPLIT: ApiModuleReading = { moduleKey: 'home_away_split', status: 'NEUTRAL', strength: null, confidence: null, sampleObservationCount: 3, sampleMeetsThreshold: true, asOf: '2026-08-23T19:00:00.000Z', verdictText: 'Balanced home and away record.', inactiveReason: null, evidence: null };

const DETAIL: MatchDetailResponse = {
  match: {
    fixtureId: '292', kickoffAt: '2026-08-23T19:00:00.000Z', status: 'COMPLETED',
    competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
    edition: { id: '18', seasonLabel: 'Brasileiro Serie A 2026' },
    homeTeam: { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' },
    awayTeam: { id: '58', name: 'Vasco da Gama', slug: 'vasco-da-gama-1974' },
    score: { home: 4, away: 1 },
  },
  form: {
    home: [{ fixtureId: '239', kickoffAt: '2026-08-15T19:30:00.000Z', isHome: false, goalsFor: 2, goalsAgainst: 3 }],
    away: [{ fixtureId: '245', kickoffAt: '2026-08-16T19:00:00.000Z', isHome: true, goalsFor: 0, goalsAgainst: 3 }],
  },
  recentVenueForm: { home: { lastHome: [], lastAway: [] }, away: { lastHome: [], lastAway: [] } },
  intelligence: {
    home: { readiness: INACTIVE_READINESS, homeAwaySplit: NEUTRAL_SPLIT },
    away: { readiness: INACTIVE_READINESS, homeAwaySplit: NEUTRAL_SPLIT },
  },
  teamFeatures: {
    home: { homeForm: fv(45.33, 5, true), awayForm: fv(34, 4, false), momentum: fv(-7, 10, true), rest: fv(8, 1, true), congestion: fv(40, 7, true) },
    away: { homeForm: fv(5.67, 3, false), awayForm: fv(5.67, 2, false), momentum: fv(-2, 10, true), rest: fv(7, 1, true), congestion: fv(0, 2, false) },
  },
};

const RESULT: MatchResult = { final: { home: 4, away: 1 }, halfTime: { home: 0, away: 0 }, extraTime: null, penalties: null, confirmedAt: '2026-08-30T02:23:01.670Z' };

const line = (groupName: string, key: string, name: string, home: string, away: string, homeD?: string, awayD?: string): TeamStatLine => ({
  groupName, statisticKey: key, statisticName: name,
  home: { value: home, display: homeD ?? home }, away: { value: away, display: awayD ?? away },
  valueType: 'event', compareCode: '1', statisticsType: 'positive', renderType: '1',
});
const STATS: MatchTeamStatistics = {
  periods: [
    { period: 'ALL', statistics: [
      line('Match overview', 'ballPossession', 'Ball possession', '57', '43', '57%', '43%'),
      line('Match overview', 'expectedGoals', 'Expected goals', '1.74', '2.15'),
      line('Match overview', 'totalShotsOnGoal', 'Total shots', '13', '12'),
      line('Match overview', 'passes', 'Passes', '551', '407'),
      line('Match overview', 'bigChanceCreated', 'Big chances', '3', '3'),
      line('Shots', 'shotsOnGoal', 'Shots on target', '5', '4'),
    ] },
    { period: '1ST', statistics: [
      line('Match overview', 'ballPossession', 'Ball possession', '58', '42', '58%', '42%'),
      line('Match overview', 'expectedGoals', 'Expected goals', '0.2', '0.13', '0.20', '0.13'),
      line('Match overview', 'totalShotsOnGoal', 'Total shots', '5', '4'),
    ] },
    { period: '2ND', statistics: [
      line('Match overview', 'ballPossession', 'Ball possession', '57', '43', '57%', '43%'),
      line('Match overview', 'expectedGoals', 'Expected goals', '1.54', '2.02'),
      line('Match overview', 'totalShotsOnGoal', 'Total shots', '8', '8'),
    ] },
  ],
  coverage: { teamStatistics: 'present', periodsPresent: ['ALL', '1ST', '2ND'], statisticsAreObserved: true, provider: 'SPORTSAPI_API', retrievedAt: '2026-09-18T11:45:55.877Z' },
};

describe('Intelligence board (Overview centrepiece)', () => {
  test('inactive readiness reads "Not available", never a backend code', () => {
    const t = text(<IntelligenceBoard detail={DETAIL} />);
    assert.match(t, /Readiness/); assert.match(t, /Not available/);
    assert.doesNotMatch(t, /FEATURE_ABSENT/i);
    assert.doesNotMatch(t, /INACTIVE/);
    assert.doesNotMatch(t, /governed/i);
  });
  test('shows venue-relevant form: home home-form 45.33 and away away-form 5.67', () => {
    const t = text(<IntelligenceBoard detail={DETAIL} />);
    assert.match(t, /45\.33/); assert.match(t, /5\.67/);
    assert.match(t, /Neutral/);              // home/away context status word
    assert.match(t, /limited sample/);        // away congestion / form below threshold
    assert.match(t, /Momentum/); assert.match(t, /Rest \(days\)/); assert.match(t, /Congestion/);
  });
});

describe('Key signals (derived, non-predictive)', () => {
  const t = text(<KeySignals detail={DETAIL} stats={STATS} />);
  test('summarises available signals in plain language', () => {
    assert.match(t, /stronger recent home form/i);          // 45.33 vs 5.67
    assert.match(t, /negative recent momentum/i);            // both negative
    assert.match(t, /no clear separation/i);                 // both NEUTRAL
    assert.match(t, /Readiness data is not available/i);
  });
  test('surfaces the xG-vs-result tension (higher xG did not win)', () => {
    assert.match(t, /higher expected goals/i);
    assert.match(t, /ran against/i);
  });
  test('carries no prediction / betting language', () => {
    const lower = t.toLowerCase();
    for (const term of ['will win', 'likely', 'probability', 'predicted', 'prediction', 'odds', 'bet', 'favourite', 'favorite', 'tip']) {
      assert.equal(lower.includes(term), false, `must not contain "${term}"`);
    }
  });
});

describe('Key match evidence + progression (observed)', () => {
  test('evidence shows observed values and links to full statistics; no winner colour language', () => {
    const markup = html(<KeyMatchEvidence stats={STATS} slug="palmeiras-vs-vasco-da-gama-292" />);
    assert.match(markup, /href="\/v2\/matches\/palmeiras-vs-vasco-da-gama-292\?tab=statistics"/);
    const t = text(<KeyMatchEvidence stats={STATS} slug="palmeiras-vs-vasco-da-gama-292" />);
    assert.match(t, /Possession/); assert.match(t, /57%/); assert.match(t, /43%/);
    assert.match(t, /Expected goals/); assert.match(t, /1\.74/); assert.match(t, /2\.15/);
  });
  test('progression derives 2nd-half score as full − half-time (0–0 then 4–1)', () => {
    const t = text(<MatchProgression stats={STATS} result={RESULT} />);
    assert.match(t, /0 – 0/);   // first-half score (half-time)
    assert.match(t, /4 – 1/);   // second-half score = 4−0, 1−0
    assert.match(t, /1st half/i); assert.match(t, /2nd half/i);
  });
});

describe('Statistics tab (canonical, grouped)', () => {
  const t = text(<MatchStatisticsFull stats={STATS} homeName="Palmeiras" awayName="Vasco da Gama" />);
  test('groups by category, shows full match, and explains bars are share not verdict', () => {
    assert.match(t, /Match statistics/i);
    assert.match(t, /Full match/i); assert.match(t, /Match overview/); assert.match(t, /Shots/);
    assert.match(t, /share of the two-team total, not which side performed better/i);
    assert.doesNotMatch(t, /FEATURE_ABSENT/i);
  });
  test('absent statistics → honest empty state', () => {
    const empty: MatchTeamStatistics = { periods: [], coverage: { teamStatistics: 'absent', periodsPresent: [], statisticsAreObserved: true, provider: null, retrievedAt: null } };
    assert.match(text(<MatchStatisticsFull stats={empty} homeName="A" awayName="B" />), /No team statistics recorded/i);
  });
});

describe('State-aware match state + H2H', () => {
  test('scheduled fixture shows status, not statistics', () => {
    const scheduled: MatchDetailResponse = { ...DETAIL, match: { ...DETAIL.match, status: 'SCHEDULED', score: null } };
    const t = text(<MatchStatePanel detail={scheduled} result={null} />);
    assert.match(t, /Match status/i);
    assert.match(t, /will appear once the fixture has been played/i);
    assert.doesNotMatch(t, /Half time/i);
  });
  test('completed fixture shows HT and FT result', () => {
    const t = text(<MatchStatePanel detail={DETAIL} result={RESULT} />);
    assert.match(t, /Half time/i); assert.match(t, /Full time/i); assert.match(t, /4 – 1/);
  });
  test('H2H is an honest empty state (never fabricated)', () => {
    assert.match(text(<HeadToHeadUnavailable />), /not available for this fixture/i);
  });
  test('Lineups unavailable is an honest empty state, no unavailable/fit/selection claim', () => {
    const t = text(<LineupsUnavailable />);
    assert.match(t, /Lineups/);
    assert.match(t, /Lineup information is not available for this fixture yet\./);
    const lower = t.toLowerCase();
    for (const term of ['injur', 'unavailable player', 'not fit', 'suspend', 'will not play', 'ruled out', 'selected', 'available to play']) {
      assert.equal(lower.includes(term), false, `must not contain "${term}"`);
    }
  });
});
