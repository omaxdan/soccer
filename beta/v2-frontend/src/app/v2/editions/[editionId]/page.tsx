import { notFound } from 'next/navigation';
import { fetchEditionFixtures, fetchEditions } from '@/lib/v2/api';
import { routes } from '@/lib/v2/routes';
import {
  resolveEditionTab, classifyFixtures, deriveEditionTeams, siblingSeasons,
} from '@/lib/v2/competition';
import { Breadcrumb } from '@/components/v2/nav';
import {
  CompetitionHeader, EditionTabNav, MatchesPanel, TeamsPanel,
  FixtureSection, StandingsUnavailable, CompetitionIntelligenceNote,
} from '@/components/v2/competition';
import type { GroupedFixtures } from '@/lib/v2/competition';
import type { ApiTeam } from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

/** Overview — a condensed, two-column read of the competition: the next fixtures and
 *  the latest results, with honest standings/intelligence context beneath. The full
 *  lists live on the Matches tab. */
function Overview({ grouped, teams, hasMatches }: { grouped: GroupedFixtures; teams: readonly ApiTeam[]; hasMatches: boolean }) {
  return (
    <div className="space-y-4">
      {grouped.live.length > 0 && <FixtureSection title="Live" fixtures={grouped.live} emptyMessage="No live matches." />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FixtureSection title="Upcoming" fixtures={grouped.upcoming.slice(0, 6)} emptyMessage="No upcoming fixtures scheduled." />
        <FixtureSection title="Recent results" fixtures={grouped.recent.slice(0, 6)} emptyMessage="No completed matches yet." />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StandingsUnavailable />
        <CompetitionIntelligenceNote hasMatches={hasMatches} />
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>
        {teams.length} teams in this competition · see the Teams tab.
      </p>
    </div>
  );
}

export default async function V2EditionPage({ params, searchParams }: {
  params: Promise<{ editionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { editionId } = await params;
  const sp = await searchParams;
  const tab = resolveEditionTab(typeof sp.tab === 'string' ? sp.tab : undefined);

  const data = await fetchEditionFixtures(editionId);
  if (!data) notFound();
  const { edition, fixtures } = data;

  const grouped = classifyFixtures(fixtures);
  const teams = deriveEditionTeams(fixtures);
  // Sibling seasons for the selector — from the editions list (never 404s).
  const { editions } = await fetchEditions();
  const seasons = siblingSeasons(editions, edition.competition.id);
  const hasMatches = fixtures.length > 0;

  return (
    <main className="space-y-4" style={{ maxWidth: 1040, margin: '0 auto', padding: 16 }}>
      <Breadcrumb items={[{ label: 'Leagues', href: routes.leagues() }, { label: `${edition.competition.name} · ${edition.seasonLabel}` }]} />

      <CompetitionHeader
        competitionName={edition.competition.name}
        seasonLabel={edition.seasonLabel}
        seasons={seasons}
        currentEditionId={edition.id}
        teamCount={teams.length}
        fixtureCount={fixtures.length}
      />

      <EditionTabNav editionId={editionId} active={tab} />

      {tab === 'overview' && <Overview grouped={grouped} teams={teams} hasMatches={hasMatches} />}
      {tab === 'matches' && <MatchesPanel grouped={grouped} />}
      {tab === 'standings' && <StandingsUnavailable />}
      {tab === 'teams' && <TeamsPanel teams={teams} />}
      {tab === 'intelligence' && <CompetitionIntelligenceNote hasMatches={hasMatches} />}
    </main>
  );
}
