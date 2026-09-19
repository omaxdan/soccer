// TEAM TAB IA RENDER TESTS (DB-free; react-dom/server) + tab-helper unit tests.
// Locks the tabbed Team page: six horizontal tabs (default Overview, clean URL), a
// compact Squad summary (count + current unavailability, no value ranking/total) and a
// recent-results list — all reusing existing tokens/components.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { TeamTabNav, TeamSquadSummary, TeamRecentFixtures } from '@/components/v2/team';
import { resolveTeamTab, teamTabHref, TEAM_TABS } from '@/lib/v2/teamTabs';
import type { TeamAvailabilityRecord, TeamFixtureLine, TeamIntelligence } from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }
function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const SQUAD: TeamIntelligence['squad'] = Array.from({ length: 29 }, (_, i) => ({
  playerId: String(700 + i), fullName: `Player ${i}`, shortName: null, slug: `player-${i}-${700 + i}`,
  registrationKindCode: 'PERMANENT', registrationFrom: '2026-09-17', registrationTo: null,
}));
const AVAILABILITY: TeamAvailabilityRecord[] = [
  { playerId: '733', fullName: 'Jefté', unavailabilityKindCode: 'INJURY', from: '2026-09-17', to: null, expectedReturnOn: null, reason: 'Meniscus Injury', severityRank: null, current: true },
  { playerId: '1222', fullName: 'Paulinho', unavailabilityKindCode: 'INJURY', from: '2026-09-17', to: null, expectedReturnOn: null, reason: 'Muscle Injury', severityRank: null, current: true },
];
const RECENT: TeamFixtureLine[] = [
  { fixtureId: '292', kickoffAt: '2026-08-23T19:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '58', name: 'Vasco da Gama', slug: 'vasco-da-gama-1974' }, isHome: true, status: 'COMPLETED', score: { home: 4, away: 1 } },
];

describe('team tab helpers (pure)', () => {
  test('resolveTeamTab defaults to overview; removed tabs degrade to overview', () => {
    assert.equal(resolveTeamTab(undefined), 'overview');
    assert.equal(resolveTeamTab('nope'), 'overview');
    assert.equal(resolveTeamTab('performance'), 'performance');
    assert.equal(resolveTeamTab('squad'), 'squad');
    assert.equal(resolveTeamTab('intelligence'), 'overview'); // removed → graceful fallback
    assert.equal(resolveTeamTab('fixtures'), 'overview');
    assert.equal(resolveTeamTab('history'), 'overview');
  });
  test('teamTabHref: default tab clean, others carry ?tab=', () => {
    assert.equal(teamTabHref('palmeiras-1963-72', 'overview'), '/v2/teams/palmeiras-1963-72');
    assert.equal(teamTabHref('palmeiras-1963-72', 'performance'), '/v2/teams/palmeiras-1963-72?tab=performance');
  });
});

describe('TeamTabNav', () => {
  const markup = html(<TeamTabNav slug="palmeiras-1963-72" active="performance" />);
  test('renders three tabs; default (overview) is the clean URL; active marked', () => {
    assert.equal(TEAM_TABS.length, 3);
    assert.deepEqual(TEAM_TABS.map((t) => t.key), ['overview', 'squad', 'performance']);
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72"/);
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72\?tab=squad"/);
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72\?tab=performance"/);
    assert.doesNotMatch(markup, /tab=intelligence/);
    assert.doesNotMatch(markup, /tab=history/);
    assert.doesNotMatch(markup, /tab=fixtures/);
    assert.match(markup, /aria-current="page"/);
  });
});

describe('TeamSquadSummary (compact Overview preview)', () => {
  const t = text(<TeamSquadSummary squad={SQUAD} availability={AVAILABILITY} slug="palmeiras-1963-72" />);
  test('shows registered count + current unavailability, links to full squad', () => {
    assert.match(t, /29/); assert.match(t, /registered players/i);
    assert.match(t, /Current unavailability \(2\)/);
    assert.match(t, /INJURY · Jefté · Meniscus Injury/);
    assert.match(html(<TeamSquadSummary squad={SQUAD} availability={AVAILABILITY} slug="palmeiras-1963-72" />), /href="\/v2\/teams\/palmeiras-1963-72\?tab=squad"/);
  });
  test('no squad-value total or ranking language', () => {
    const lower = t.toLowerCase();
    for (const term of ['squad value', 'total value', 'most valuable', '€', 'eur', 'ranked']) {
      assert.equal(lower.includes(term), false, `must not contain "${term}"`);
    }
  });
  test('no current unavailability → honest line, never "0 injuries"', () => {
    const clean = text(<TeamSquadSummary squad={SQUAD} availability={[]} slug="x-1" />);
    assert.match(clean, /No current unavailability records/i);
    assert.doesNotMatch(clean, /0 injuries/i);
  });
});

describe('TeamRecentFixtures', () => {
  test('renders recent completed results; empty → honest state', () => {
    assert.match(text(<TeamRecentFixtures recent={RECENT} teamName="Palmeiras" />), /Vasco da Gama/);
    assert.match(text(<TeamRecentFixtures recent={[]} teamName="Palmeiras" />), /No completed fixtures recorded/i);
  });
});

// ── Team Intelligence briefing (Overview lead card) ──────────────────────────────────
import { TeamIntelligenceBriefing } from '@/components/v2/team';
import type { TeamPerformanceOverall, TeamReadinessReading } from '@/lib/v2/types';

const PM = (value: number, matches: number, meets: boolean, unit: string, direction: 'HIGHER_IS_STRONGER' | 'UNSIGNED' = 'HIGHER_IS_STRONGER') =>
  ({ value, unit, direction, sample: { matches, meetsThreshold: meets }, asOf: '2026-09-06T21:30:00.000Z' });
const OVERALL: TeamPerformanceOverall = {
  homeForm: PM(48.33, 6, true, 'index'), awayForm: PM(34, 4, false, 'index'),
  momentum: PM(-7, 10, true, 'points'), goalMarginVolatility: PM(1.89, 10, true, 'goals', 'UNSIGNED'),
  giantKillerPpg: PM(1.33, 9, true, 'ppg'),
};
const READY: TeamReadinessReading = { moduleKey: 'readiness_tracker', status: 'NEUTRAL', strength: null, confidence: null, sample: { matches: 10, meetsThreshold: true }, verdictText: 'Steady form: last-five points minus prior-five is -7.', inactiveReason: null, asOf: '2026-09-06T21:30:00.000Z', evidence: null };

describe('TeamIntelligenceBriefing (Overview lead)', () => {
  const t = text(<TeamIntelligenceBriefing teamName="Palmeiras" overall={OVERALL} readiness={READY} coverage="present" />);
  test('shows current-picture narrative verbatim + signals with window/reliability', () => {
    assert.match(t, /Team intelligence/i); assert.match(t, /Key signals for Palmeiras/);
    assert.match(t, /Current picture/); assert.match(t, /Steady form: last-five points minus prior-five is -7\./);
    assert.match(t, /48\.33/); assert.match(t, /last 6 matches/);
    assert.match(t, /34/); assert.match(t, /limited sample/);       // awayForm below threshold
    assert.match(t, /Based on 10 matches/); assert.match(t, /not a prediction/i);
    assert.match(t, /These signals span all competitions\./); // ALL_COMPETITIONS scope disclosure
  });
  test('uses user-facing labels only (no "Giant Killer", no backend terms)', () => {
    const lower = t.toLowerCase();
    assert.match(t, /Vs stronger opponents/);
    for (const term of ['giant killer', 'giant-killer', 'governed', 'feature', 'module', 'substrate', 'pipeline']) {
      assert.equal(lower.includes(term), false, `must not contain "${term}"`);
    }
  });
  test('no narrative when readiness absent; signals still render honestly', () => {
    const t2 = text(<TeamIntelligenceBriefing teamName="X" overall={OVERALL} readiness={null} coverage="present" />);
    assert.doesNotMatch(t2, /Current picture/);
    assert.match(t2, /48\.33/);
  });
});

// ── Next fixture & selection (Overview consolidation of Upcoming + Squad) ─────────────
import { TeamNextFixtureAndSelection } from '@/components/v2/team';

const NEXT: TeamIntelligence['nextFixture'] = {
  fixture: { fixtureId: '494', kickoffAt: '2026-09-20T14:00:00.000Z', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, opponent: { id: '66', name: 'Grêmio', slug: 'gremio-5926' }, isHome: false, status: 'SCHEDULED', score: null },
  registeredCount: 29,
  explicitlyUnavailable: [
    { playerId: '733', fullName: 'Jefté', unavailabilityKindCode: 'INJURY', reason: 'Meniscus Injury', expectedReturnOn: null },
    { playerId: '1222', fullName: 'Paulinho', unavailabilityKindCode: 'INJURY', reason: 'Muscle Injury', expectedReturnOn: null },
  ],
  availabilityUnknown: Array.from({ length: 27 }, (_, i) => ({ playerId: `9${i}`, fullName: `U ${i}` })),
};

describe('TeamNextFixtureAndSelection (Overview consolidation)', () => {
  const markup = html(<TeamNextFixtureAndSelection nextFixture={NEXT} teamName="Palmeiras" slug="palmeiras-1963-72" />);
  const t = text(<TeamNextFixtureAndSelection nextFixture={NEXT} teamName="Palmeiras" slug="palmeiras-1963-72" />);
  test('folds fixture + registered count + unavailable + honest unknown, links to full squad', () => {
    assert.match(t, /Next fixture .* selection/i);
    assert.match(markup, /href="\/v2\/matches\/gremio-vs-palmeiras-494"/); // opponent home for an away fixture
    assert.match(t, /Grêmio · Away · Brasileirão Betano/);
    assert.match(t, /29 registered players/);
    assert.match(t, /Unavailable \(2\)/); assert.match(t, /INJURY · Jefté · Meniscus Injury/);
    assert.match(t, /27 registered players have no current unavailability record/);
    assert.match(t, /not confirmed available, fit, rested or selected/i);
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72\?tab=squad"/);
  });
  test('no next fixture → honest empty state', () => {
    assert.match(text(<TeamNextFixtureAndSelection nextFixture={null} teamName="X" slug="x-1" />), /No upcoming fixture scheduled/i);
  });
});
