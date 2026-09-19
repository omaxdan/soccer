import { notFound } from 'next/navigation';
import { fetchTeam, fetchTeamPerformance, fetchTeamReadiness, fetchTeamGovernedIntelligence, fetchEditionStandings } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { findTeamStanding } from '@/lib/v2/standings';
import { Breadcrumb } from '@/components/v2/nav';
import {
  TeamIdentityHeader, TeamCurrentForm, TeamReadinessPanel, TeamHomeAwaySplitPanel,
  TeamConsistencyPanel, TeamCompetitionContext, TeamSeasonStatistics, TeamLastMatch,
  TeamUpcomingFixtures, TeamPlayers, type TeamStandingEntry,
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
  const [detail, performance, readiness, governed] = await Promise.all([
    fetchTeam(id),
    fetchTeamPerformance(id),
    fetchTeamReadiness(id),
    fetchTeamGovernedIntelligence(id),
  ]);
  if (!detail) notFound();
  const { team, competitions, intelligence } = detail;

  // Standings position — REUSE the existing governed edition-standings read for each
  // edition the team participates in (from detail.competitions), matched by team.id.
  // Nothing is computed here; a missing snapshot/row stays honest.
  const standingEntries: TeamStandingEntry[] = await Promise.all(
    competitions.map(async (c): Promise<TeamStandingEntry> => {
      const s = await fetchEditionStandings(c.editionId);
      return { editionId: c.editionId, seasonLabel: c.seasonLabel, competition: c.competition, line: s ? findTeamStanding(s.standings, team.id) : null };
    }),
  );

  // The header surfaces the PRIMARY edition's season, standings row and home/away win
  // rate — all read verbatim from existing reads (nothing computed here). "Primary" is
  // simply the first competition edition; single-edition teams have exactly one.
  const primary = competitions[0] ?? null;
  const primarySeason = primary ? `${primary.competition.name} · ${primary.seasonLabel}` : null;
  const primaryStanding = standingEntries[0]?.line ?? null;
  const primaryWinRate = primary ? (performance?.byCompetition.find((c) => c.edition.id === primary.editionId) ?? null) : null;

  return (
    <main className="space-y-5 mx-auto w-full max-w-6xl px-4 py-4">
      <Breadcrumb items={[{ label: 'Teams', href: routes.teams() }, { label: team.name }]} />

      {/* IDENTITY + season + governed standings row + home/away win rate (top-right) */}
      <TeamIdentityHeader
        team={team}
        competitions={competitions}
        season={primarySeason}
        standing={primaryStanding}
        homeWinRate={primaryWinRate?.homeWinRate ?? null}
        awayWinRate={primaryWinRate?.awayWinRate ?? null}
      />

      {/* CONTEXT — participation counts per governed edition */}
      <TeamCompetitionContext participation={intelligence.participation} />

      {/* EVIDENCE — recent form: W/D/L strip + descriptive features + venue-split fixtures */}
      <TeamCurrentForm
        recent={intelligence.fixtures.recent}
        home={intelligence.homeAwayContext.home}
        away={intelligence.homeAwayContext.away}
        teamName={team.name}
        overall={performance?.overall ?? EMPTY_OVERALL}
        coverage={performance?.coverage.overall ?? 'absent'}
      />

      {/* GOVERNED INTELLIGENCE — kept explicitly separate from the evidence above */}
      <TeamReadinessPanel readiness={readiness?.readiness ?? null} coverage={readiness?.coverage ?? { readiness: 'absent', readinessIsGoverned: true }} />
      <TeamHomeAwaySplitPanel readings={governed?.homeAwaySplit ?? []} />
      <TeamConsistencyPanel reading={governed?.consistency ?? null} />

      {/* PERFORMANCE — descriptive season-statistic aggregates (backend-derived, verbatim).
          Placed AFTER governed intelligence and BEFORE upcoming; never inside the governed block. */}
      <TeamSeasonStatistics playerStatistics={intelligence.playerStatistics} />

      {/* LAST MATCH — most recent completed fixture's recorded player statistics (evidence).
          Descriptive; distinct from Current Form (sequence) and Season Statistics (season aggregate). */}
      <TeamLastMatch playerPerformances={intelligence.playerPerformances} squad={intelligence.squad} teamName={team.name} />

      {/* SUPPORTING — upcoming fixtures + next-fixture selection picture (left),
          squad with registration + availability detail (right). The squad is the
          registration-bearing intelligence.squad (name-only detail.squad is unused). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TeamUpcomingFixtures upcoming={intelligence.fixtures.upcoming} teamName={team.name} nextFixture={intelligence.nextFixture} />
        <TeamPlayers squad={intelligence.squad} availability={intelligence.availability} />
      </div>
    </main>
  );
}
