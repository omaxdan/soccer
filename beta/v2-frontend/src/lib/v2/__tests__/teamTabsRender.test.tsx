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
  test('resolveTeamTab defaults to overview; accepts known tabs', () => {
    assert.equal(resolveTeamTab(undefined), 'overview');
    assert.equal(resolveTeamTab('nope'), 'overview');
    assert.equal(resolveTeamTab('performance'), 'performance');
    assert.equal(resolveTeamTab('intelligence'), 'intelligence');
  });
  test('teamTabHref: default tab clean, others carry ?tab=', () => {
    assert.equal(teamTabHref('palmeiras-1963-72', 'overview'), '/v2/teams/palmeiras-1963-72');
    assert.equal(teamTabHref('palmeiras-1963-72', 'performance'), '/v2/teams/palmeiras-1963-72?tab=performance');
  });
});

describe('TeamTabNav', () => {
  const markup = html(<TeamTabNav slug="palmeiras-1963-72" active="performance" />);
  test('renders six tabs; default (overview) is the clean URL; active marked', () => {
    assert.equal(TEAM_TABS.length, 6);
    assert.equal(TEAM_TABS[0].key, 'overview');
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72"/);
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72\?tab=squad"/);
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72\?tab=intelligence"/);
    assert.match(markup, /href="\/v2\/teams\/palmeiras-1963-72\?tab=history"/);
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
