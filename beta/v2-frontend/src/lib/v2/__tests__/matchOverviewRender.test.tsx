// MATCH OVERVIEW / CLIENT RENDER TESTS (DB-free; react-dom/server).
//
// Locks the rebuilt Match page composition (authoritative wireframe):
//   • MatchHeader — identity, score, HT, status chip, "Venue not supplied", confirmation;
//   • TeamFeatureCompare — mirrored features, stronger side by governed direction, low
//     sample flagged, no backend codes;
//   • ResultCard — FT/HT (+ ET/PEN when present) + confirmation; scheduled → honest note;
//   • RecentFormPanel — recent form for both sides;
//   • MatchFactorList — the seven factor rows (fixture modules + splits + readiness),
//     status word chips, plain sentence for missing data (never inactiveReason code);
//   • StatisticsTab — period switch, grouped compare rows, better-side note;
//   • LineupsTab — formation, position-group headers, canonical player links, subs;
//   • VenueFormRail — this-fixture / reversed switch;
//   • forbidden-language guard (no betting / prediction / backend codes).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { MatchHeader, TeamFeatureCompare, ResultCard } from '@/components/v2/matchOverview';
import { RecentFormPanel, MatchFactorList, StatisticsTab, LineupsTab, VenueFormRail } from '@/components/v2/matchClient';
import type {
  ApiFeatureValue, ApiModuleReading, MatchDetailResponse, MatchResult, MatchTeamStatistics, MatchLineups, TeamStatLine,
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
  matchModules: [],
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
      line('Shots', 'shotsOnGoal', 'Shots on target', '5', '4'),
    ] },
    { period: '1ST', statistics: [ line('Match overview', 'ballPossession', 'Ball possession', '58', '42', '58%', '42%') ] },
    { period: '2ND', statistics: [ line('Match overview', 'ballPossession', 'Ball possession', '57', '43', '57%', '43%') ] },
  ],
  coverage: { teamStatistics: 'present', periodsPresent: ['ALL', '1ST', '2ND'], statisticsAreObserved: true, provider: 'SPORTSAPI_API', retrievedAt: '2026-09-18T11:45:55.877Z' },
};

const LINEUPS: MatchLineups = {
  home: {
    team: { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' }, formation: '4-2-3-1',
    starting: [
      { player: { id: '11', fullName: 'Weverton', slug: 'weverton-1' }, positionCode: 'G', positionName: 'Goalkeeper', positionGroup: 'GOALKEEPER', shirtNumber: 1 },
      { player: { id: '12', fullName: 'Gustavo Gómez', slug: 'gustavo-gomez-2' }, positionCode: 'D', positionName: 'Defender', positionGroup: 'DEFENDER', shirtNumber: 15 },
    ],
    substitutes: [{ player: { id: '19', fullName: 'Bench Player', slug: 'bench-player-777' }, positionCode: 'F', positionName: 'Forward', positionGroup: 'FORWARD', shirtNumber: 19 }],
  },
  away: null,
  coverage: { lineups: 'partial', lineupsAreObserved: true },
};

describe('MatchHeader', () => {
  const t = text(<MatchHeader context={DETAIL} venue={null} result={RESULT} />);
  test('identity, score, HT, status chip, venue-not-supplied, confirmation', () => {
    assert.match(t, /Palmeiras/); assert.match(t, /Vasco da Gama/);
    assert.match(t, /4\s*–\s*1/);
    assert.match(t, /HT 0 – 0/);
    assert.match(t, /FT/);                              // completed → FT
    assert.match(t, /Venue not supplied/);
    assert.match(t, /result confirmed/i);
  });
});

describe('TeamFeatureCompare', () => {
  const t = text(<TeamFeatureCompare detail={DETAIL} />);
  test('mirrored features with low-sample flag; no backend codes', () => {
    assert.match(t, /Team features/);
    assert.match(t, /Home form/); assert.match(t, /45\.33/); assert.match(t, /5\.67/);
    assert.match(t, /Momentum/); assert.match(t, /Rest \(days\)/); assert.match(t, /Congestion/);
    assert.match(t, /low sample/);
    assert.doesNotMatch(t.toLowerCase(), /governed/);
    assert.doesNotMatch(t, /INACTIVE/);
  });
});

describe('ResultCard', () => {
  test('completed → FT + HT + confirmation', () => {
    const t = text(<ResultCard detail={DETAIL} result={RESULT} />);
    assert.match(t, /Result/); assert.match(t, /Full time/); assert.match(t, /4 – 1/); assert.match(t, /Half time/); assert.match(t, /Confirmed/);
  });
  test('scheduled → honest not-yet-played note (no fabricated 0–0)', () => {
    const scheduled: MatchDetailResponse = { ...DETAIL, match: { ...DETAIL.match, status: 'SCHEDULED', score: null } };
    const t = text(<ResultCard detail={scheduled} result={null} />);
    assert.match(t, /Not yet played/i);
    assert.doesNotMatch(t, /0 – 0/);
  });
});

describe('RecentFormPanel', () => {
  test('shows recent form for both sides', () => {
    const t = text(<RecentFormPanel detail={DETAIL} />);
    assert.match(t, /Recent form/); assert.match(t, /Palmeiras/); assert.match(t, /Vasco da Gama/);
  });
});

describe('MatchFactorList (7 rows)', () => {
  const t = text(<MatchFactorList detail={DETAIL} />);
  test('renders factor labels, status words, and plain sentence for missing data', () => {
    assert.match(t, /Match factors/);
    assert.match(t, /Travel Impact/); assert.match(t, /Rest Advantage/); assert.match(t, /Form Gap Accuracy/);
    assert.match(t, /Home\/Away Split/); assert.match(t, /Readiness/);
    assert.match(t, /Neutral/);                              // split status
    assert.match(t, /Balanced home and away record\./);       // split verdict verbatim
    assert.match(t, /No data recorded for this match\./);     // absent + inactive rows
  });
  test('never exposes the inactiveReason code or backend jargon', () => {
    assert.doesNotMatch(t, /FEATURE_ABSENT/i);
    assert.doesNotMatch(t.toLowerCase(), /governed/);
    assert.doesNotMatch(t, /\bINACTIVE\b/);
  });
});

describe('StatisticsTab', () => {
  const t = text(<StatisticsTab stats={STATS} homeName="Palmeiras" awayName="Vasco da Gama" />);
  test('period switch, grouped compare rows, better-side note', () => {
    assert.match(t, /Statistics/);
    assert.match(t, /Full match/); assert.match(t, /1st half/); assert.match(t, /2nd half/);
    assert.match(t, /Match overview/); assert.match(t, /Shots/);
    assert.match(t, /57%/); assert.match(t, /43%/);
    assert.match(t, /brighter, bolder side/i);
  });
});

describe('LineupsTab', () => {
  test('formation, position-group headers, canonical player links, substitutes', () => {
    const markup = html(<LineupsTab lineups={LINEUPS} />);
    assert.match(markup, /4-2-3-1/);
    assert.match(markup, /href="\/v2\/players\/weverton-1-11"/);
    const t = text(<LineupsTab lineups={LINEUPS} />);
    assert.match(t, /Goalkeeper/); assert.match(t, /Defence/);
    assert.match(t, /Substitutes/i);
  });
  test('both sides null → honest empty', () => {
    const none: MatchLineups = { home: null, away: null, coverage: { lineups: 'absent', lineupsAreObserved: true } };
    assert.match(text(<LineupsTab lineups={none} />), /No lineups reported/i);
  });
});

describe('VenueFormRail', () => {
  test('renders the switch and honest empty rows', () => {
    const t = text(<VenueFormRail homeName="Palmeiras" awayName="Vasco da Gama" home={DETAIL.recentVenueForm.home} away={DETAIL.recentVenueForm.away} />);
    assert.match(t, /Venue form/); assert.match(t, /This fixture/);
    assert.match(t, /No recent matches recorded\./);
  });
});

describe('no betting / prediction language across the Overview surfaces', () => {
  test('assembled surfaces carry no forbidden lexicon', () => {
    const all = [
      text(<MatchHeader context={DETAIL} venue={null} result={RESULT} />),
      text(<TeamFeatureCompare detail={DETAIL} />),
      text(<ResultCard detail={DETAIL} result={RESULT} />),
      text(<MatchFactorList detail={DETAIL} />),
      text(<StatisticsTab stats={STATS} homeName="Palmeiras" awayName="Vasco da Gama" />),
    ].join(' ').toLowerCase();
    for (const term of ['predicted', 'prediction', 'probability', 'odds', 'bookmaker', 'stake', 'wager', 'betting', 'tip', 'guaranteed', 'best bet', 'favourite', 'favorite']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
    assert.doesNotMatch(all, /\bpick\b/);
  });
});
