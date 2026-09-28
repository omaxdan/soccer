import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  fetchTeam, fetchTeamPerformance, fetchTeamReadiness, fetchTeamGovernedIntelligence,
  fetchTeamAttributes, fetchTeamObservations, fetchTeamPlayerObservations,
  fetchTeamPerformanceSignals, fetchTeamTemporalPerformance, fetchCountry,
} from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { resolveTeamTab } from '@/lib/v2/teamTabs';
import { Breadcrumb } from '@/components/v2/nav';
import {
  TeamIdentityHeader, TeamTabNav, TeamCurrentForm, TeamReadinessPanel, TeamHomeAwaySplitPanel,
  TeamConsistencyPanel, TeamCompetitionContext, TeamAvailabilityBoard, TeamSquadSnapshot,
  TeamStatisticalAttributes, TeamResultAttributes, TeamRecentResults, TeamSquadRoster,
  TeamPerformanceIndicators,
} from '@/components/v2/team';
import { TeamPerformanceSignals } from '@/components/v2/teamPerformanceSignals';
import { TeamHistory } from '@/components/v2/teamHistory';
import type { TeamPerformanceOverall } from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

const EMPTY_OVERALL: TeamPerformanceOverall = {
  homeForm: null, awayForm: null, momentum: null, goalMarginVolatility: null, giantKillerPpg: null,
};

/** Await a read, distinguishing a real failure (threw) from a real absence (null). */
async function guarded<T>(p: Promise<T | null>): Promise<{ value: T | null; errored: boolean }> {
  try { return { value: await p, errored: false }; }
  catch { return { value: null, errored: true }; }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const id = idFromParam(slug);
  if (id === null) return { title: 'Team' };
  const { value } = await guarded(fetchTeam(String(id)));
  return { title: value ? value.team.name : 'Team' };
}

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

  // Identity/context is the page's spine. A thrown error → an honest workspace-level
  // failure; null → the team does not exist. Every OTHER read is secondary and guarded, so
  // one failing endpoint never blanks the whole page.
  const detailRead = await guarded(fetchTeam(id));
  if (detailRead.errored) {
    return (
      <main className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(16px,3vw,28px) 16px' }}>
        <div role="alert" className="panel" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <span aria-hidden className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--risk)' }}>■ Unavailable</span>
          <h1 style={{ margin: 0, fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>Team couldn’t be loaded</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>This team could not be reached. Please try again.</p>
        </div>
      </main>
    );
  }
  if (!detailRead.value) notFound();
  const { team, competitions, recentResults, intelligence } = detailRead.value;

  // Secondary reads — all guarded and fetched together. `history`/`squad`/`performance`
  // reads are only NEEDED for their tab, but fetching together keeps the page a single
  // server round and lets the header show the next-fixture line regardless of tab.
  const [performance, readiness, governed, attributes, observations, playerObs, signals, temporal, countryRead] = await Promise.all([
    guarded(fetchTeamPerformance(id)),
    guarded(fetchTeamReadiness(id)),
    guarded(fetchTeamGovernedIntelligence(id)),
    guarded(fetchTeamAttributes(id)),
    guarded(fetchTeamObservations(id)),
    guarded(fetchTeamPlayerObservations(id)),
    guarded(fetchTeamPerformanceSignals(id)),
    guarded(fetchTeamTemporalPerformance(id)),
    team.countryCode ? guarded(fetchCountry(team.countryCode)) : Promise.resolve({ value: null, errored: false }),
  ]);

  const countryName = countryRead.value?.country.name ?? null;
  const latestMatchAt = recentResults[0]?.kickoffAt ?? intelligence.fixtures.recent[0]?.kickoffAt ?? null;
  const attr = attributes.value;

  return (
    <>
      <main className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(12px,2.5vw,20px) 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Breadcrumb items={[
          { label: 'Teams', href: routes.teams() },
          ...(team.countryCode ? [{ label: countryName ?? team.countryCode, href: routes.country({ code: team.countryCode }) }] : []),
          { label: team.name },
        ]} />

        <TeamIdentityHeader team={team} competitions={competitions} latestMatchAt={latestMatchAt} nextFixture={intelligence.nextFixture} />

        <TeamTabNav slug={slug} active={tab} />

        <div style={{ minWidth: 0 }}>
          {/* OVERVIEW — current readings + team attributes + recent results, with a rail of
              competitions this season and current unavailability. */}
          {tab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]" style={{ gap: 16, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
                <div className="space-y-2">
                  <p className="eyebrow">Current readings</p>
                  <TeamReadinessPanel readiness={readiness.value?.readiness ?? null} coverage={readiness.value?.coverage ?? { readiness: 'absent', readinessIsGoverned: true }} />
                  <TeamHomeAwaySplitPanel readings={governed.value?.homeAwaySplit ?? []} />
                  <TeamConsistencyPanel reading={governed.value?.consistency ?? null} />
                </div>
                <TeamResultAttributes strengths={attr?.strengths} weaknesses={attr?.weaknesses} tendencies={attr?.tendencies} insufficientSample={attr?.insufficientSample} />
                <TeamStatisticalAttributes block={attr?.statistical ?? null} />
                <TeamRecentResults recent={intelligence.fixtures.recent} teamName={team.name} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <TeamCompetitionContext participation={intelligence.participation} />
                <TeamAvailabilityBoard availability={intelligence.availability} />
              </div>
            </div>
          )}

          {/* SQUAD — the tri-state snapshot + the enriched roster (minutes / started / goals /
              value / availability) with the also-appeared list. */}
          {tab === 'squad' && (
            <div className="space-y-4">
              <TeamSquadSnapshot squad={intelligence.squad} availability={intelligence.availability} />
              <TeamSquadRoster
                squad={intelligence.squad}
                playerObservations={playerObs.value?.players ?? []}
                valuations={intelligence.valuations}
                availability={intelligence.availability}
              />
            </div>
          )}

          {/* PERFORMANCE — descriptive indicators + recent home/away split + signals. */}
          {tab === 'performance' && (
            <div className="space-y-4">
              <TeamPerformanceIndicators
                overall={performance.value?.overall ?? EMPTY_OVERALL}
                byCompetition={performance.value?.byCompetition ?? []}
                coverage={performance.value?.coverage.overall ?? 'absent'}
              />
              <TeamCurrentForm
                recent={intelligence.fixtures.recent}
                home={intelligence.homeAwayContext.home}
                away={intelligence.homeAwayContext.away}
                teamName={team.name}
              />
              {signals.value
                ? <TeamPerformanceSignals windows={signals.value.windows} />
                : <div className="panel" style={{ padding: 20, textAlign: 'center' }}><p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>Performance signals not available yet.</p></div>}
            </div>
          )}

          {/* HISTORY — the whole recorded period. */}
          {tab === 'history' && (
            <TeamHistory
              observations={observations.value?.observations ?? []}
              season={temporal.value?.season ?? null}
              teamName={team.name}
            />
          )}
        </div>
      </main>
    </>
  );
}
