import { notFound } from 'next/navigation';
import { fetchTeam, fetchTeamPerformance, fetchTeamReadiness, fetchTeamGovernedIntelligence, fetchEditionStandings } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { findTeamStanding } from '@/lib/v2/standings';
import { resolveTeamTab } from '@/lib/v2/teamTabs';
import { Breadcrumb } from '@/components/v2/nav';
import { EmptyState } from '@/components/v2/ui';
import {
  TeamIdentityHeader, TeamCurrentForm, TeamReadinessPanel, TeamHomeAwaySplitPanel,
  TeamConsistencyPanel, TeamCompetitionContext, TeamSeasonStatistics, TeamLastMatch,
  TeamUpcomingFixtures, TeamRecentFixtures, TeamPlayers, TeamCoverage,
  TeamTabNav, TeamIntelligenceBriefing, TeamNextFixtureAndSelection, type TeamStandingEntry,
} from '@/components/v2/team';
import type { TeamPerformanceOverall } from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

const EMPTY_OVERALL: TeamPerformanceOverall = {
  homeForm: null, awayForm: null, momentum: null, goalMarginVolatility: null, giantKillerPpg: null,
};

export default async function V2TeamPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = resolveTeamTab(typeof sp.tab === 'string' ? sp.tab : undefined);

  // Public URL is {team.slug}-{id}; the trailing DB id is the sole resolver.
  const teamId = idFromParam(slug);
  if (teamId === null) notFound();
  const id = String(teamId);

  // Identity/context (gated), descriptive performance evidence, and the governed
  // readiness reading are three distinct existing endpoints, fetched together.
  const [detail, performance, readiness, governed] = await Promise.all([
    fetchTeam(id),
    fetchTeamPerformance(id),
    fetchTeamReadiness(id),
    fetchTeamGovernedIntelligence(id),
  ]);
  if (!detail) notFound();
  const { team, competitions, intelligence } = detail;

  // Standings position — REUSE the existing governed edition-standings read (nothing computed).
  const standingEntries: TeamStandingEntry[] = await Promise.all(
    competitions.map(async (c): Promise<TeamStandingEntry> => {
      const s = await fetchEditionStandings(c.editionId);
      return { editionId: c.editionId, seasonLabel: c.seasonLabel, competition: c.competition, line: s ? findTeamStanding(s.standings, team.id) : null };
    }),
  );

  const primary = competitions[0] ?? null;
  const primarySeason = primary ? `${primary.competition.name} · ${primary.seasonLabel}` : null;
  const primaryStanding = standingEntries[0]?.line ?? null;
  const primaryWinRate = primary ? (performance?.byCompetition.find((c) => c.edition.id === primary.editionId) ?? null) : null;

  const governedPanels = (
    <>
      <TeamReadinessPanel readiness={readiness?.readiness ?? null} coverage={readiness?.coverage ?? { readiness: 'absent', readinessIsGoverned: true }} />
      <TeamHomeAwaySplitPanel readings={governed?.homeAwaySplit ?? []} />
      <TeamConsistencyPanel reading={governed?.consistency ?? null} />
    </>
  );

  return (
    <main className="space-y-4 mx-auto w-full max-w-6xl px-4 py-4">
      <Breadcrumb items={[{ label: 'Teams', href: routes.teams() }, { label: team.name }]} />

      {/* IDENTITY (permanent across tabs) + season + standings row + home/away win rate */}
      <TeamIdentityHeader
        team={team}
        competitions={competitions}
        season={primarySeason}
        standing={primaryStanding}
        homeWinRate={primaryWinRate?.homeWinRate ?? null}
        awayWinRate={primaryWinRate?.awayWinRate ?? null}
      />

      <TeamTabNav slug={slug} active={tab} />

      <div className="space-y-4" style={{ minWidth: 0 }}>
        {/* OVERVIEW — the current intelligence briefing + next fixture/selection + coverage.
            The deep governed readings (Readiness / Home-Away / Consistency) live on the
            Intelligence tab, so Overview never repeats the verdict or the volatility value. */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <TeamIntelligenceBriefing
              teamName={team.name}
              overall={performance?.overall ?? EMPTY_OVERALL}
              readiness={readiness?.readiness ?? null}
              coverage={performance?.coverage.overall ?? 'absent'}
            />
            <TeamNextFixtureAndSelection nextFixture={intelligence.nextFixture} teamName={team.name} slug={slug} />
            <TeamCoverage coverage={intelligence.coverage} />
          </div>
        )}

        {/* SQUAD — full roster + registration + availability + valuation */}
        {tab === 'squad' && (
          <TeamPlayers squad={intelligence.squad} availability={intelligence.availability} valuations={intelligence.valuations} />
        )}

        {/* FIXTURES — participation, upcoming, recent results */}
        {tab === 'fixtures' && (
          <div className="space-y-4">
            <TeamCompetitionContext participation={intelligence.participation} />
            <TeamUpcomingFixtures upcoming={intelligence.fixtures.upcoming} teamName={team.name} nextFixture={intelligence.nextFixture} />
            <TeamRecentFixtures recent={intelligence.fixtures.recent} teamName={team.name} />
          </div>
        )}

        {/* PERFORMANCE — descriptive season evidence: form, season statistics, last match */}
        {tab === 'performance' && (
          <div className="space-y-4">
            <TeamCurrentForm
              recent={intelligence.fixtures.recent}
              home={intelligence.homeAwayContext.home}
              away={intelligence.homeAwayContext.away}
              teamName={team.name}
              overall={performance?.overall ?? EMPTY_OVERALL}
              coverage={performance?.coverage.overall ?? 'absent'}
            />
            <TeamSeasonStatistics playerStatistics={intelligence.playerStatistics} />
            <TeamLastMatch playerPerformances={intelligence.playerPerformances} squad={intelligence.squad} teamName={team.name} />
          </div>
        )}

        {/* INTELLIGENCE — the deep governed readings (with their supporting evidence) */}
        {tab === 'intelligence' && (
          <div className="space-y-4">
            <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>
              Current readings with the evidence behind them. Each shows its sample size and when it was last updated.
            </p>
            {governedPanels}
          </div>
        )}

        {/* HISTORY — long-term patterns (honest: about one season is available today) */}
        {tab === 'history' && (
          <section className="space-y-2">
            <p className="eyebrow">Historical patterns</p>
            <EmptyState message="Historical patterns are limited: about one season of data is currently available for this team." />
          </section>
        )}
      </div>
    </main>
  );
}
