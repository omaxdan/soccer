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
import { RecentVenueForm, ReadingCard, TeamIntelligencePanel } from '@/components/v2/ui';
import { ProvenanceBar, VerdictBand, ModulesBand, PreparednessBand, CitedEvidencePanel, IntelligenceUnavailable } from '@/components/v2/intelligence';
import {
  MatchResultPanel, MatchTeamStatisticsPanel, MatchLineupsPanel, MatchVenuePanel, MatchLifecyclePanel, MatchCoverage,
} from '@/components/v2/match';
import { MatchHeader, MatchBrief, MatchTabNav, Collapsible, MATCH_MAIN_CLASS, type CoverageFlag } from '@/components/v2/matchWorkspace';
import type {
  ApiTeamIntelligence, ApiEditionFixture, MatchDetailResponse, MatchIntelligence,
  MatchResultResponse, MatchLineupsResponse, MatchTeamStatisticsResponse, MatchLifecycleResponse, MatchVenueResponse,
} from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

/** Live (non-sealed) module readings for one team — context, not sealed substrate. */
function TeamLiveReadings({ name, intel }: { name: string; intel: ApiTeamIntelligence }) {
  return (
    <section className="space-y-2" aria-label={`${name} live readings`}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{name}</h3>
      <ReadingCard title="Form Momentum / Trajectory" reading={intel.readiness} />
      <ReadingCard title="Home / Away Split" reading={intel.homeAwaySplit} />
    </section>
  );
}

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

  // Prev/next within the same edition — from the existing fixtures read, never fabricated.
  let prev: ApiEditionFixture | null = null;
  let next: ApiEditionFixture | null = null;
  const editionData = await fetchEditionFixtures(editionId);
  if (editionData) ({ prev, next } = findAdjacentFixtures(editionData.fixtures, id));

  const coverage: CoverageFlag[] = [
    ['match', 'present'],
    ['result', resultRes?.coverage.result ?? 'absent'],
    ['intelligence', sealed ? 'present' : 'absent'],
    ['statistics', statsRes?.teamStatistics.coverage.teamStatistics ?? 'absent'],
    ['lineups', lineupsRes?.lineups.coverage.lineups ?? 'absent'],
    ['venue', venueRes?.coverage.venue ?? 'absent'],
    ['lifecycle', lifecycleRes?.lifecycle.coverage.transitions ?? 'absent'],
    ['weather', 'not-supported'],
    ['h2h', 'not-supported'],
  ];

  const crumbs = [
    { label: 'Leagues', href: routes.leagues() },
    { label: `${match.competition.name} · ${match.edition.seasonLabel}`, href: editionHref },
    { label: `${homeName} v ${awayName}` },
  ];

  return (
    <main className={MATCH_MAIN_CLASS}>
      <Breadcrumb items={crumbs} />
      <MatchHeader context={detail} venue={venueRes?.venue ?? null} />

      <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-4">
        <MatchBrief match={match} result={resultRes?.result ?? null} venue={venueRes?.venue ?? null} coverage={coverage} />

        <div className="space-y-4" style={{ minWidth: 0 }}>
          <MatchTabNav slug={slug} active={tab} />

          {/* TAB 1 — INTELLIGENCE (governed, primary) */}
          {tab === 'intelligence' && (
            sealed
              ? <div className="space-y-4">
                  <ProvenanceBar provenance={sealed.intelligence.provenance} />
                  <VerdictBand verdict={sealed.intelligence.verdict} />
                  <ModulesBand intelligence={sealed.intelligence} homeName={homeName} awayName={awayName} />
                  <PreparednessBand intelligence={sealed.intelligence} homeName={homeName} awayName={awayName} />
                  <Collapsible summary="Cited by calculation">
                    <CitedEvidencePanel citedEvidence={sealed.intelligence.citedEvidence} />
                  </Collapsible>
                </div>
              : <IntelligenceUnavailable />
          )}

          {/* TAB 2 — EVIDENCE (context, not calculation substrate) */}
          {tab === 'evidence' && (
            <div className="space-y-4">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <p className="eyebrow" style={{ color: 'var(--cool)' }}>Context · not part of calculation</p>
              </div>
              <section className="space-y-2">
                <p className="label-cap" style={{ color: 'var(--muted)' }}>Recent venue form</p>
                <RecentVenueForm homeName={homeName} awayName={awayName} home={detail.recentVenueForm.home} away={detail.recentVenueForm.away} />
              </section>
              <section className="space-y-2">
                <p className="label-cap" style={{ color: 'var(--muted)' }}>Team comparison</p>
                <TeamIntelligencePanel home={detail.teamFeatures.home} away={detail.teamFeatures.away} homeName={homeName} awayName={awayName} />
              </section>
              <section className="space-y-2">
                <p className="label-cap" style={{ color: 'var(--muted)' }}>Live module readings</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <TeamLiveReadings name={homeName} intel={detail.intelligence.home} />
                  <TeamLiveReadings name={awayName} intel={detail.intelligence.away} />
                </div>
              </section>
            </div>
          )}

          {/* TAB 3 — MATCH DATA (observed) */}
          {tab === 'match-data' && (
            <div className="space-y-4">
              {resultRes && <MatchResultPanel result={resultRes.result} coverage={resultRes.coverage} homeName={homeName} awayName={awayName} />}
              {statsRes && <MatchTeamStatisticsPanel teamStatistics={statsRes.teamStatistics} homeName={homeName} awayName={awayName} />}
              {lineupsRes && <MatchLineupsPanel lineups={lineupsRes.lineups} />}
            </div>
          )}

          {/* TAB 4 — CONTEXT (venue / lifecycle / coverage) */}
          {tab === 'context' && (
            <div className="space-y-4">
              {venueRes && <MatchVenuePanel matchVenue={{ venue: venueRes.venue, isNeutralVenue: venueRes.isNeutralVenue, coverage: venueRes.coverage }} />}
              {lifecycleRes && <MatchLifecyclePanel lifecycle={lifecycleRes.lifecycle} />}
              <MatchCoverage flags={coverage} />
            </div>
          )}
        </div>
      </div>

      <MatchNav prev={prev} next={next} editionId={editionId} competitionName={match.competition.name} />
    </main>
  );
}
