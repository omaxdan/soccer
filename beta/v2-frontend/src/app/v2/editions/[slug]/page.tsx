import { notFound } from 'next/navigation';
import { fetchEditionFixtures, fetchEditions, fetchEditionStandings } from '@/lib/v2/api';
import { routes, type V2EditionRef } from '@/lib/v2/routes';
import { idFromParam } from '@/lib/v2/slug';
import {
  resolveEditionTab, classifyFixtures, deriveEditionTeams, siblingSeasons,
} from '@/lib/v2/competition';
import { Breadcrumb } from '@/components/v2/nav';
import {
  CompetitionHeader, EditionTabNav, MatchesPanel, TeamsPanel,
  FixtureSection, StandingsTable, StandingsUnavailable, CompetitionIntelligenceNote,
} from '@/components/v2/competition';
import type { GroupedFixtures } from '@/lib/v2/competition';
import type { ApiTeam, EditionStandings } from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

/** Overview — a condensed, two-column read of the competition: the next fixtures and
 *  the latest results, with a top-of-table standings preview and intelligence context.
 *  The full lists live on the Matches / Table tabs. */
function Overview({ grouped, teams, hasMatches, standings }: { grouped: GroupedFixtures; teams: readonly ApiTeam[]; hasMatches: boolean; standings: EditionStandings | null }) {
  return (
    <div className="space-y-4">
      {grouped.live.length > 0 && <FixtureSection title="Live" fixtures={grouped.live} emptyMessage="No live matches." />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FixtureSection title="Upcoming" fixtures={grouped.upcoming.slice(0, 6)} emptyMessage="No upcoming fixtures scheduled." />
        <FixtureSection title="Recent results" fixtures={grouped.recent.slice(0, 6)} emptyMessage="No completed matches yet." />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {standings ? <StandingsTable standings={standings} limit={6} /> : <StandingsUnavailable />}
        <CompetitionIntelligenceNote hasMatches={hasMatches} />
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>
        {teams.length} teams in this competition · see the Teams tab.
      </p>
    </div>
  );
}

export default async function V2EditionPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = resolveEditionTab(typeof sp.tab === 'string' ? sp.tab : undefined);

  // Public URL is {competition}-{season}-{id}; the trailing numeric edition id is the
  // source of truth. Parse it and 404 on a slug with no numeric id — the API only
  // ever receives the numeric id, so the backend contract is unchanged.
  const editionId = idFromParam(slug);
  if (editionId === null) notFound();

  const data = await fetchEditionFixtures(String(editionId));
  if (!data) notFound();
  const { edition, fixtures } = data;
  const editionRef: V2EditionRef = { id: edition.id, competition: { slug: edition.competition.slug }, seasonLabel: edition.seasonLabel };

  const grouped = classifyFixtures(fixtures);
  const teams = deriveEditionTeams(fixtures);
  // Sibling seasons + governed standings snapshot — both from existing reads, in parallel.
  const [{ editions }, standingsData] = await Promise.all([fetchEditions(), fetchEditionStandings(String(editionId))]);
  const seasons = siblingSeasons(editions, edition.competition.id);
  const standings = standingsData?.standings ?? null;
  const hasMatches = fixtures.length > 0;

  return (
    <main className="space-y-4 mx-auto w-full max-w-6xl px-4 py-4">
      <Breadcrumb items={[{ label: 'Leagues', href: routes.leagues() }, { label: `${edition.competition.name} · ${edition.seasonLabel}` }]} />

      <CompetitionHeader
        competitionName={edition.competition.name}
        seasonLabel={edition.seasonLabel}
        seasons={seasons}
        currentEditionId={edition.id}
        teamCount={teams.length}
        fixtureCount={fixtures.length}
      />

      <EditionTabNav edition={editionRef} active={tab} />

      {tab === 'overview' && <Overview grouped={grouped} teams={teams} hasMatches={hasMatches} standings={standings} />}
      {tab === 'matches' && <MatchesPanel grouped={grouped} />}
      {tab === 'standings' && (standings ? <StandingsTable standings={standings} /> : <StandingsUnavailable />)}
      {tab === 'teams' && <TeamsPanel teams={teams} />}
      {tab === 'intelligence' && <CompetitionIntelligenceNote hasMatches={hasMatches} />}
    </main>
  );
}
