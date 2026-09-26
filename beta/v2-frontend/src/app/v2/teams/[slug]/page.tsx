import { notFound } from 'next/navigation';
import { fetchTeam, fetchTeamPerformance, fetchTeamReadiness, fetchTeamGovernedIntelligence, fetchTeamAttributes, fetchEditionStandings } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { findTeamStanding } from '@/lib/v2/standings';
import { resolveTeamTab } from '@/lib/v2/teamTabs';
import { Breadcrumb } from '@/components/v2/nav';
import {
  TeamIdentityHeader, TeamCurrentForm, TeamReadinessPanel, TeamHomeAwaySplitPanel,
  TeamConsistencyPanel, TeamCompetitionContext, TeamSeasonStatistics,
  TeamSquadSnapshot, TeamAvailabilityBoard, TeamPlayers, TeamLastAppearance, TeamCoverage,
  TeamTabNav, TeamIntelligenceBriefing, TeamNextFixtureAndSelection, TeamStatisticalAttributes,
  type TeamStandingEntry,
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
  const [detail, performance, readiness, governed, attributes] = await Promise.all([
    fetchTeam(id),
    fetchTeamPerformance(id),
    fetchTeamReadiness(id),
    fetchTeamGovernedIntelligence(id),
    fetchTeamAttributes(id),
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

        {/* SQUAD — player-centric: the tri-state snapshot headline, the prominent
            availability/injuries board, the roster (player / registration / value), and a
            compact link to the last appearance. Detailed player-match statistics live on
            the Match page — never duplicated here. */}
        {tab === 'squad' && (
          <div className="space-y-4">
            <TeamSquadSnapshot squad={intelligence.squad} availability={intelligence.availability} />
            <TeamAvailabilityBoard availability={intelligence.availability} />
            <TeamPlayers squad={intelligence.squad} valuations={intelligence.valuations} />
            <TeamLastAppearance playerPerformances={intelligence.playerPerformances} teamName={team.name} />
          </div>
        )}

        {/* PERFORMANCE — the single canonical deep-evidence home: recent form + venue split
            (the one place recent fixtures live in full), the governed readings, competition
            participation and season statistics. The descriptive signal metrics are not
            repeated here — they are the Overview briefing's summary. */}
        {tab === 'performance' && (
          <div className="space-y-4">
            <TeamCurrentForm
              recent={intelligence.fixtures.recent}
              home={intelligence.homeAwayContext.home}
              away={intelligence.homeAwayContext.away}
              teamName={team.name}
            />
            <TeamReadinessPanel readiness={readiness?.readiness ?? null} coverage={readiness?.coverage ?? { readiness: 'absent', readinessIsGoverned: true }} />
            <TeamHomeAwaySplitPanel readings={governed?.homeAwaySplit ?? []} />
            <TeamConsistencyPanel reading={governed?.consistency ?? null} />
            <TeamCompetitionContext participation={intelligence.participation} />
            <TeamStatisticalAttributes block={attributes?.statistical ?? null} />
            <TeamSeasonStatistics playerStatistics={intelligence.playerStatistics} />
          </div>
        )}
      </div>
    </main>
  );
}
