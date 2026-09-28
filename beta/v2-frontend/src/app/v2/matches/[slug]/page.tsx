import { notFound } from 'next/navigation';
import {
  fetchMatchIntelligence, fetchMatch, fetchEditionFixtures,
  fetchMatchResult, fetchMatchLineups, fetchMatchTeamStatistics, fetchMatchLifecycle, fetchMatchVenue,
} from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { findAdjacentFixtures } from '@/lib/v2/matchNav';
import { resolveMatchTab } from '@/lib/v2/matchTabs';
import { Breadcrumb, MatchNav } from '@/components/v2/nav';
import { EmptyState } from '@/components/v2/ui';
import {
  IntelligenceSummary, EdgeGrid, ModuleReadingList, PreparednessPanel, EvidenceTable,
  HistoricalResponse, IntelligenceUnavailable,
} from '@/components/v2/intelligence';
import { LifecycleTimeline } from '@/components/v2/match';
import { MatchTabNav, MATCH_MAIN_CLASS } from '@/components/v2/matchWorkspace';
import { MatchHeader, TeamFeatureCompare, ResultCard } from '@/components/v2/matchOverview';
import { StatisticsTab, LineupsTab, RecentFormPanel, MatchFactorList, VenueFormRail } from '@/components/v2/matchClient';
import type {
  ApiEditionFixture, MatchDetailResponse,
  MatchResultResponse, MatchLineupsResponse, MatchTeamStatisticsResponse, MatchLifecycleResponse, MatchVenueResponse,
} from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

export default async function V2MatchPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = resolveMatchTab(typeof sp.tab === 'string' ? sp.tab : undefined);

  // Public URL is {home}-vs-{away}-{id}; the trailing numeric fixture id resolves.
  const fixtureId = idFromParam(slug);
  if (fixtureId === null) notFound();
  const id = String(fixtureId);

  // Sealed-first: /intelligence returns { intelligence, context } when sealed, else
  // 404 (which means "no sealed snapshot", not "no fixture") — fall back to /matches/:id.
  const sealed = await fetchMatchIntelligence(id);
  const context: MatchDetailResponse | null = sealed?.context ?? (sealed ? null : await fetchMatch(id));
  if (!sealed && !context) notFound();
  const detail = sealed?.context ?? context;
  if (!detail) notFound();

  // The five observed sub-resources (each 200 with its own coverage for a real fixture).
  const [resultRes, lineupsRes, statsRes, lifecycleRes, venueRes]: [
    MatchResultResponse | null, MatchLineupsResponse | null, MatchTeamStatisticsResponse | null,
    MatchLifecycleResponse | null, MatchVenueResponse | null,
  ] = await Promise.all([
    fetchMatchResult(id), fetchMatchLineups(id), fetchMatchTeamStatistics(id), fetchMatchLifecycle(id), fetchMatchVenue(id),
  ]);

  const match = detail.match;
  const homeName = match.homeTeam.name;
  const awayName = match.awayTeam.name;
  const editionId = match.edition.id;
  const editionHref = routes.edition({ id: match.edition.id, competition: { slug: match.competition.slug }, seasonLabel: match.edition.seasonLabel });
  const stats = statsRes?.teamStatistics ?? null;
  const result = resultRes?.result ?? null;
  const venue = venueRes?.venue ?? null;

  // Prev/next within the same edition — from the existing fixtures read, never fabricated.
  let prev: ApiEditionFixture | null = null;
  let next: ApiEditionFixture | null = null;
  const editionData = await fetchEditionFixtures(editionId);
  if (editionData) ({ prev, next } = findAdjacentFixtures(editionData.fixtures, id));

  // Breadcrumb: Fixtures (by the match's UTC date) → Competition · Season → this match.
  const matchDate = match.kickoffAt.slice(0, 10);
  const crumbs = [
    { label: 'Fixtures', href: routes.fixtures(matchDate) },
    { label: `${match.competition.name} · ${match.edition.seasonLabel}`, href: editionHref },
    { label: `${homeName} vs ${awayName}` },
  ];

  return (
    <main className={MATCH_MAIN_CLASS}>
      <Breadcrumb items={crumbs} />
      <MatchHeader context={detail} venue={venue} result={result} />
      <MatchTabNav slug={slug} active={tab} />

      <div style={{ minWidth: 0 }}>
        {/* OVERVIEW (8/4) — Recent form → Match factors → Team features → Historical
            patterns; rail: Result → Venue form. */}
        {tab === 'overview' && (
          <div className="md:grid md:grid-cols-12 md:gap-4 space-y-4 md:space-y-0">
            <div className="md:col-span-8 space-y-4" style={{ minWidth: 0 }}>
              <RecentFormPanel detail={detail} />
              <MatchFactorList detail={detail} />
              <TeamFeatureCompare detail={detail} />
              <HistoricalResponse historicalResponse={detail.historicalResponse} homeName={homeName} awayName={awayName} />
            </div>
            <div className="md:col-span-4 space-y-4" style={{ minWidth: 0 }}>
              <ResultCard detail={detail} result={result} />
              <VenueFormRail homeName={homeName} awayName={awayName} home={detail.recentVenueForm.home} away={detail.recentVenueForm.away} />
            </div>
          </div>
        )}

        {/* LINEUPS (6/6) — per team formation → XI by position group → subs (collapsed);
            mobile team switcher. */}
        {tab === 'lineups' && (
          lineupsRes
            ? <LineupsTab lineups={lineupsRes.lineups} />
            : <EmptyState message="Lineup information is not available for this fixture yet." />
        )}

        {/* STATISTICS — period switch (Full / 1st / 2nd), grouped compare rows. */}
        {tab === 'statistics' && (
          stats && stats.coverage.teamStatistics !== 'absent' && stats.periods.length > 0
            ? <StatisticsTab stats={stats} homeName={homeName} awayName={awayName} />
            : <EmptyState message="No team statistics recorded for this fixture." />
        )}

        {/* INTELLIGENCE (7/5) — Locked summary → Edges → Module readings → Preparedness;
            rail: Cited evidence. Only the locked reading is shown here — never live
            module readings. */}
        {tab === 'intelligence' && (
          sealed ? (
            <div className="md:grid md:grid-cols-12 md:gap-4 space-y-4 md:space-y-0">
              <div className="md:col-span-7 space-y-4" style={{ minWidth: 0 }}>
                <IntelligenceSummary intelligence={sealed.intelligence} />
                <EdgeGrid verdict={sealed.intelligence.verdict} homeName={homeName} awayName={awayName} />
                <ModuleReadingList modules={sealed.intelligence.modules} homeTeamId={match.homeTeam.id} homeName={homeName} awayTeamId={match.awayTeam.id} awayName={awayName} />
                <PreparednessPanel preparedness={sealed.intelligence.preparedness} homeName={homeName} awayName={awayName} />
              </div>
              <div className="md:col-span-5 space-y-4" style={{ minWidth: 0 }}>
                <EvidenceTable citedEvidence={sealed.intelligence.citedEvidence} homeTeamId={match.homeTeam.id} homeName={homeName} awayTeamId={match.awayTeam.id} awayName={awayName} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <IntelligenceUnavailable />
              <HistoricalResponse historicalResponse={detail.historicalResponse} homeName={homeName} awayName={awayName} />
            </div>
          )
        )}

        {/* TIMELINE — status transitions merged with kickoff, intelligence lock and
            result confirmation. */}
        {tab === 'timeline' && (
          <LifecycleTimeline
            lifecycle={lifecycleRes?.lifecycle ?? null}
            kickoffAt={match.kickoffAt}
            lockedAt={sealed?.intelligence.provenance.sealedAt ?? null}
            confirmedAt={result?.confirmedAt ?? null}
          />
        )}
      </div>

      <MatchNav prev={prev} next={next} editionId={editionId} competitionName={match.competition.name} />
    </main>
  );
}
