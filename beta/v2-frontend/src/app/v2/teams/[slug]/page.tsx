import { notFound } from 'next/navigation';
import { fetchTeam, fetchTeamPerformance, fetchTeamReadiness, fetchEditionStandings } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { findTeamStanding } from '@/lib/v2/standings';
import { Breadcrumb } from '@/components/v2/nav';
import {
  TeamIdentityHeader, TeamPerformanceSnapshot, TeamCurrentForm, TeamHomeAwaySplit,
  TeamRecentVenueForm, TeamReadinessPanel, TeamStandings, TeamCompetitionContext,
  TeamMatchHistory, TeamUpcomingFixtures, TeamPlayers, type TeamStandingEntry,
} from '@/components/v2/team';
import type { TeamPerformanceOverall } from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

const EMPTY_OVERALL: TeamPerformanceOverall = {
  homeForm: null, awayForm: null, momentum: null, goalMarginVolatility: null, giantKillerPpg: null,
};

export default async function V2TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Public URL is {team.slug}-{id}; the trailing DB id is the sole resolver.
  const teamId = idFromParam(slug);
  if (teamId === null) notFound();
  const id = String(teamId);

  // Identity/context (gated), descriptive performance evidence, and the governed
  // readiness reading are three distinct existing endpoints, fetched together. Team
  // detail gates the page (null → 404); the other two degrade to honest empties.
  const [detail, performance, readiness] = await Promise.all([
    fetchTeam(id),
    fetchTeamPerformance(id),
    fetchTeamReadiness(id),
  ]);
  if (!detail) notFound();
  const { team, competitions, squad, recentResults, intelligence } = detail;

  // Standings position — REUSE the existing governed edition-standings read for each
  // edition the team participates in (from detail.competitions), matched by team.id.
  // Nothing is computed here; a missing snapshot/row stays honest.
  const standingEntries: TeamStandingEntry[] = await Promise.all(
    competitions.map(async (c): Promise<TeamStandingEntry> => {
      const s = await fetchEditionStandings(c.editionId);
      return { editionId: c.editionId, seasonLabel: c.seasonLabel, competition: c.competition, line: s ? findTeamStanding(s.standings, team.id) : null };
    }),
  );

  return (
    <main className="space-y-5" style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <Breadcrumb items={[{ label: 'Teams', href: routes.teams() }, { label: team.name }]} />

      {/* IDENTITY */}
      <TeamIdentityHeader team={team} competitions={competitions} />

      {/* EVIDENCE — descriptive persisted performance features */}
      <TeamPerformanceSnapshot overall={performance?.overall ?? EMPTY_OVERALL} coverage={performance?.coverage.overall ?? 'absent'} />

      {/* EVIDENCE — recent completed results */}
      <TeamCurrentForm recentResults={recentResults} />

      {/* EVIDENCE — home/away descriptive features + per-edition win rates */}
      <TeamHomeAwaySplit overall={performance?.overall ?? EMPTY_OVERALL} byCompetition={performance?.byCompetition ?? []} />

      {/* EVIDENCE — recent home/away fixtures (context, not a home/away calculation) */}
      <TeamRecentVenueForm home={intelligence.homeAwayContext.home} away={intelligence.homeAwayContext.away} teamName={team.name} />

      {/* GOVERNED INTELLIGENCE — kept explicitly separate from the evidence above */}
      <TeamReadinessPanel readiness={readiness?.readiness ?? null} coverage={readiness?.coverage ?? { readiness: 'absent', readinessIsGoverned: true }} />

      {/* CONTEXT — standings position (reused governed edition standings), participation, fixtures, squad */}
      <TeamStandings entries={standingEntries} />
      <TeamCompetitionContext participation={intelligence.participation} />
      <TeamMatchHistory recent={intelligence.fixtures.recent} teamName={team.name} />
      <TeamUpcomingFixtures upcoming={intelligence.fixtures.upcoming} teamName={team.name} />
      <TeamPlayers squad={squad} availability={intelligence.availability} />
    </main>
  );
}
