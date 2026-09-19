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
import { RecentVenueForm, TeamIntelligencePanel, ReadingCard, FormStrip } from '@/components/v2/ui';
import { ProvenanceBar, VerdictBand, ModulesBand, PreparednessBand, CitedEvidencePanel, IntelligenceUnavailable } from '@/components/v2/intelligence';
import { MatchLineupsPanel, MatchVenuePanel, MatchLifecyclePanel } from '@/components/v2/match';
import { MatchTabNav, Collapsible, MATCH_MAIN_CLASS, type CoverageFlag } from '@/components/v2/matchWorkspace';
import {
  MatchHeader, IntelligenceBoard, KeySignals, MatchStatePanel, KeyMatchEvidence, MatchProgression,
  CompactForm, CompactVenue, AvailabilityFooter, HeadToHeadUnavailable, MatchStatisticsFull,
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

  const crumbs = [
    { label: 'Matches', href: routes.leagues() },
    { label: `${match.competition.name} · ${match.edition.seasonLabel}`, href: editionHref },
    { label: `${homeName} vs ${awayName}` },
  ];

  return (
    <main className={MATCH_MAIN_CLASS}>
      <Breadcrumb items={crumbs} />
      <MatchHeader context={detail} venue={venue} />
      <MatchTabNav slug={slug} active={tab} />

      <div className="space-y-4" style={{ minWidth: 0 }}>
        {/* OVERVIEW — "what matters about this match?" */}
        {tab === 'overview' && (
          <div className="space-y-4">
            <IntelligenceBoard detail={detail} />
            <KeySignals detail={detail} stats={stats} />
            <MatchStatePanel detail={detail} result={result} />
            {completed && stats && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <KeyMatchEvidence stats={stats} slug={slug} />
                <MatchProgression stats={stats} result={result} />
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CompactForm detail={detail} slug={slug} />
              <CompactVenue venue={venue} slug={slug} />
            </div>
            <AvailabilityFooter flags={coverage} />
          </div>
        )}

        {/* COMPARISON — "how do the two teams compare?" */}
        {tab === 'comparison' && (
          <section className="space-y-2">
            <p className="eyebrow">Team comparison</p>
            <TeamIntelligencePanel home={detail.teamFeatures.home} away={detail.teamFeatures.away} homeName={homeName} awayName={awayName} />
          </section>
        )}

        {/* FORM — "what has each team done recently?" */}
        {tab === 'form' && (
          <div className="space-y-4">
            <section className="space-y-2">
              <p className="eyebrow">Recent results</p>
              <div className="panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
                <div><p className="label-cap" style={{ color: 'var(--muted)', marginBottom: 4 }}>{homeName}</p><FormStrip fixtures={detail.form.home} /></div>
                <div><p className="label-cap" style={{ color: 'var(--muted)', marginBottom: 4 }}>{awayName}</p><FormStrip fixtures={detail.form.away} /></div>
              </div>
            </section>
            <section className="space-y-2">
              <p className="eyebrow">Recent venue form</p>
              <RecentVenueForm homeName={homeName} awayName={awayName} home={detail.recentVenueForm.home} away={detail.recentVenueForm.away} />
            </section>
          </div>
        )}

        {/* LINEUPS — "who is playing / who played?" */}
        {tab === 'lineups' && lineupsRes && <MatchLineupsPanel lineups={lineupsRes.lineups} />}

        {/* H2H — "what has happened between these teams historically?" */}
        {tab === 'h2h' && <HeadToHeadUnavailable />}

        {/* STATISTICS — "what actually happened on the pitch?" */}
        {tab === 'statistics' && (
          stats
            ? <MatchStatisticsFull stats={stats} homeName={homeName} awayName={awayName} />
            : <MatchStatePanel detail={detail} result={result} />
        )}

        {/* VENUE — "what venue / location context surrounds this fixture?" */}
        {tab === 'venue' && (
          <div className="space-y-4">
            {venueRes && <MatchVenuePanel matchVenue={{ venue: venueRes.venue, isNeutralVenue: venueRes.isNeutralVenue, coverage: venueRes.coverage }} />}
            {lifecycleRes && <MatchLifecyclePanel lifecycle={lifecycleRes.lifecycle} />}
          </div>
        )}

        {/* INTELLIGENCE — "why does PitchTerminal see it that way?" */}
        {tab === 'intelligence' && (
          <div className="space-y-4">
            {sealed && (
              <>
                <ProvenanceBar provenance={sealed.intelligence.provenance} />
                <VerdictBand verdict={sealed.intelligence.verdict} />
                <ModulesBand intelligence={sealed.intelligence} homeName={homeName} awayName={awayName} />
                <PreparednessBand intelligence={sealed.intelligence} homeName={homeName} awayName={awayName} />
                <Collapsible summary="Supporting data">
                  <CitedEvidencePanel citedEvidence={sealed.intelligence.citedEvidence} />
                </Collapsible>
              </>
            )}
            <section className="space-y-2">
              <p className="eyebrow">Current signals</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <p className="label-cap" style={{ color: 'var(--muted)' }}>{homeName}</p>
                  <ReadingCard title="Form momentum / trajectory" reading={detail.intelligence.home.readiness} />
                  <ReadingCard title="Home / away split" reading={detail.intelligence.home.homeAwaySplit} />
                </div>
                <div className="space-y-2">
                  <p className="label-cap" style={{ color: 'var(--muted)' }}>{awayName}</p>
                  <ReadingCard title="Form momentum / trajectory" reading={detail.intelligence.away.readiness} />
                  <ReadingCard title="Home / away split" reading={detail.intelligence.away.homeAwaySplit} />
                </div>
              </div>
            </section>
            <section className="space-y-2">
              <p className="eyebrow">Supporting data</p>
              <RecentVenueForm homeName={homeName} awayName={awayName} home={detail.recentVenueForm.home} away={detail.recentVenueForm.away} />
            </section>
            {!sealed && <IntelligenceUnavailable />}
          </div>
        )}
      </div>

      <MatchNav prev={prev} next={next} editionId={editionId} competitionName={match.competition.name} />
    </main>
  );
}
