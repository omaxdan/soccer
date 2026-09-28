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
import { TeamIntelligencePanel, EmptyState } from '@/components/v2/ui';
import {
  ReadingAtKickoff, ModuleReadings, CitedEvidenceTable, HistoricalResponse, NearFutureNote,
  IntelligenceUnavailable,
} from '@/components/v2/intelligence';
import { MatchLineupsPanel, MatchLifecyclePanel } from '@/components/v2/match';
import { MatchTabNav, MATCH_MAIN_CLASS, type CoverageFlag } from '@/components/v2/matchWorkspace';
import {
  MatchHeader, IntelligenceAtKickoff, IntelligenceBoard, KeySignals, MatchStatePanel, KeyMatchEvidence, MatchProgression,
  CompactForm, CompactVenue, AvailabilityFooter, MatchStatisticsFull,
  LineupsUnavailable, MatchGovernedSignals,
} from '@/components/v2/matchOverview';
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
  const completed = match.status === 'COMPLETED';

  // Prev/next within the same edition — from the existing fixtures read, never fabricated.
  let prev: ApiEditionFixture | null = null;
  let next: ApiEditionFixture | null = null;
  const editionData = await fetchEditionFixtures(editionId);
  if (editionData) ({ prev, next } = findAdjacentFixtures(editionData.fixtures, id));

  const coverage: CoverageFlag[] = [
    ['Result', resultRes?.coverage.result ?? 'absent'],
    ['Statistics', statsRes?.teamStatistics.coverage.teamStatistics ?? 'absent'],
    ['Lineups', lineupsRes?.lineups.coverage.lineups ?? 'absent'],
    ['Venue', venueRes?.coverage.venue ?? 'absent'],
    ['Recent form', 'present'],
    ['Intelligence', sealed ? 'present' : 'absent'],
  ];

  // Breadcrumb: Fixtures (by the match's UTC date, per the Fixtures workspace) →
  // Competition · Season (the Edition workspace) → this match.
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

      <div className="space-y-4" style={{ minWidth: 0 }}>
        {/* OVERVIEW — "what matters about this match?" The design consolidates the
            former Comparison / Form / H2H / Venue tabs here: the team comparison,
            a compact recent-form summary and a compact venue card all live in the
            Overview landing, with venue also in the match header. */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <MatchStatePanel detail={detail} result={result} />
            {sealed && <IntelligenceAtKickoff intelligence={sealed.intelligence} slug={slug} />}
            <IntelligenceBoard detail={detail} />
            <KeySignals detail={detail} stats={stats} />
            <MatchGovernedSignals modules={detail.matchModules} />
            {completed && stats && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <KeyMatchEvidence stats={stats} slug={slug} />
                <MatchProgression stats={stats} result={result} />
              </div>
            )}
            {/* Team comparison — folded in from the former Comparison tab. */}
            <section className="space-y-2">
              <p className="eyebrow">Team comparison</p>
              <TeamIntelligencePanel home={detail.teamFeatures.home} away={detail.teamFeatures.away} homeName={homeName} awayName={awayName} />
            </section>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CompactForm detail={detail} />
              <CompactVenue venue={venue} />
            </div>
            <AvailabilityFooter flags={coverage} />
          </div>
        )}

        {/* LINEUPS — "who is playing / who played?" — honest empty state when the read
            itself is unavailable (MatchLineupsPanel handles absent/partial coverage). */}
        {tab === 'lineups' && (lineupsRes ? <MatchLineupsPanel lineups={lineupsRes.lineups} /> : <LineupsUnavailable />)}

        {/* STATISTICS — "what actually happened on the pitch?" Uses the observed
            team-statistics read (ALL / 1ST / 2ND, grouped home vs away). */}
        {tab === 'statistics' && (
          stats
            ? <MatchStatisticsFull stats={stats} homeName={homeName} awayName={awayName} />
            : <MatchStatePanel detail={detail} result={result} />
        )}

        {/* INTELLIGENCE — the reading taken at kickoff. Only the locked reading is shown
            here (never the live-context module readings): the reading at kickoff, the
            module readings behind it, the evidence it cited, how each side has responded
            historically, and an honest near-future note. */}
        {tab === 'intelligence' && (
          <div className="space-y-4">
            {sealed ? (
              <>
                <ReadingAtKickoff intelligence={sealed.intelligence} />
                <ModuleReadings modules={sealed.intelligence.modules} homeTeamId={match.homeTeam.id} homeName={homeName} awayTeamId={match.awayTeam.id} awayName={awayName} />
                <CitedEvidenceTable citedEvidence={sealed.intelligence.citedEvidence} homeTeamId={match.homeTeam.id} homeName={homeName} awayTeamId={match.awayTeam.id} awayName={awayName} />
                <HistoricalResponse historicalResponse={detail.historicalResponse} homeName={homeName} awayName={awayName} />
                <NearFutureNote />
              </>
            ) : (
              <>
                <IntelligenceUnavailable />
                <HistoricalResponse historicalResponse={detail.historicalResponse} homeName={homeName} awayName={awayName} />
              </>
            )}
          </div>
        )}

        {/* TIMELINE — "how did this fixture's state progress?" The observed status
            history (lifecycle transitions). Minute-by-minute match events are not part
            of the payload, so that surface is an honest unavailable state, never faked. */}
        {tab === 'timeline' && (
          <div className="space-y-4">
            {lifecycleRes
              ? <MatchLifecyclePanel lifecycle={lifecycleRes.lifecycle} />
              : <EmptyState message="No status history is available for this fixture yet." />}
            <section className="space-y-2">
              <p className="eyebrow">Match events</p>
              <EmptyState message="Minute-by-minute match events are not available for this fixture." />
            </section>
          </div>
        )}
      </div>

      <MatchNav prev={prev} next={next} editionId={editionId} competitionName={match.competition.name} />
    </main>
  );
}
