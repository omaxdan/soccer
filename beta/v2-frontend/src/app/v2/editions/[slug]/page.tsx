import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  fetchEditionFixtures, fetchEditionStandings, fetchCompetition, fetchCountry,
} from '@/lib/v2/api';
import { routes, type V2EditionRef } from '@/lib/v2/routes';
import { idFromParam } from '@/lib/v2/slug';
import {
  resolveEditionTab, editionFixtureFacts, sortSeasonsDesc, formatAsOf, fixtureShortDate,
} from '@/lib/v2/competition';
import {
  CompetitionHeader, StandingsTable, StandingsEmpty, StandingsUnavailable,
  QualificationZonesNote, EditionFactsRail, DataAvailableRail, FixtureStrip, standingsVariantLabel,
  type DataAvailabilityItem,
} from '@/components/v2/competition';
import { EditionFixturesTab } from '@/components/v2/editionFixtures';
import type {
  ApiEditionSummary, EditionStandings, StandingTable,
} from '@/lib/v2/types';

// The Competition / Edition workspace (/v2/editions/{slug}). One workspace, three tabs:
// Overview · Table · Fixtures. Identity + standings + fixtures come from real governed
// reads; the country/competition breadcrumb is resolved from the competition and country
// reads. Advanced edition reads (observations, position-trajectory, temporal-performance,
// table-context) exist in the backend but the design specifies no surface for them, so
// they are intentionally not fetched or rendered here.
export const dynamic = 'force-dynamic';

/** Await a read, distinguishing an honest failure (threw) from an honest absence (null). */
async function guarded<T>(p: Promise<T | null>): Promise<{ value: T | null; errored: boolean }> {
  try { return { value: await p, errored: false }; }
  catch { return { value: null, errored: true }; }
}

/** Resolve the TOTAL standings table (fallback: first table). */
function resolveTable(standings: EditionStandings | null): StandingTable | null {
  if (!standings) return null;
  return standings.tables.find((t) => t.variant === 'TOTAL') ?? standings.tables[0] ?? null;
}

type StandingsState =
  | { kind: 'ok'; table: StandingTable; label: string; asOf: string; variantsPresent: string[] }
  | { kind: 'empty' }
  | { kind: 'unavailable' };

function standingsState(standings: EditionStandings | null, errored: boolean): StandingsState {
  if (errored) return { kind: 'unavailable' };
  if (!standings || standings.coverage.standings === 'absent') return { kind: 'unavailable' };
  const table = resolveTable(standings);
  if (!table || table.rows.length === 0) return { kind: 'empty' };
  return { kind: 'ok', table, label: standingsVariantLabel(table.variant), asOf: table.asOf, variantsPresent: standings.coverage.variantsPresent };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const id = idFromParam(slug);
  if (id === null) return { title: 'Competition' };
  const { value } = await guarded(fetchEditionFixtures(String(id)));
  if (!value) return { title: 'Competition' };
  return { title: `${value.edition.competition.name} · ${value.edition.seasonLabel}` };
}

export default async function V2EditionPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab = resolveEditionTab(typeof sp.tab === 'string' ? sp.tab : undefined);

  const editionId = idFromParam(slug);
  if (editionId === null) notFound();
  const id = String(editionId);

  // Identity + fixtures (one read). null → the edition does not exist; a thrown error →
  // the workspace cannot be built, so show an honest workspace-level failure.
  const fixturesRead = await guarded(fetchEditionFixtures(id));
  if (fixturesRead.errored) {
    return (
      <main className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(16px,3vw,28px) 16px' }}>
        <div role="alert" className="panel" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <span aria-hidden className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--risk)' }}>■ Unavailable</span>
          <h1 style={{ margin: 0, fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>Competition couldn’t be loaded</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>This competition edition could not be reached. Please try again.</p>
        </div>
      </main>
    );
  }
  if (!fixturesRead.value) notFound();
  const { edition, fixtures } = fixturesRead.value;

  const editionRef: V2EditionRef = { id: edition.id, competition: { slug: edition.competition.slug }, seasonLabel: edition.seasonLabel };

  // Standings + competition (for the switcher, fixture count and country link), guarded.
  const [standingsRead, competitionRead] = await Promise.all([
    guarded(fetchEditionStandings(id)),
    guarded(fetchCompetition(edition.competition.id)),
  ]);
  const competition = competitionRead.value?.competition ?? { id: edition.competition.id, name: edition.competition.name, slug: edition.competition.slug, countryCode: null };
  const countryCode = competition.countryCode;
  const countryRead = countryCode ? await guarded(fetchCountry(countryCode)) : { value: null, errored: false };
  const country = countryRead.value?.country ?? null;

  // Editions for the switcher, and the authoritative fixture count for this edition.
  const editions: ApiEditionSummary[] = competitionRead.value
    ? sortSeasonsDesc(competitionRead.value.editions)
    : [{ id: edition.id, seasonLabel: edition.seasonLabel, competition: edition.competition, fixtureCount: fixtures.length }];
  const thisSummary = editions.find((e) => e.id === edition.id);
  const fixtureCount = thisSummary?.fixtureCount ?? fixtures.length;

  const st = standingsState(standingsRead.value?.standings ?? null, standingsRead.errored);
  const asOf = st.kind === 'ok' ? st.asOf : null;
  const headerVariant = st.kind === 'ok' ? st.label : null;

  // Rails / facts (all from real data; missing values shown honestly, never zero-filled).
  const facts = editionFixtureFacts(fixtures);
  const editionFacts = [
    { k: 'Season', v: edition.seasonLabel },
    { k: 'Competition', v: edition.competition.name },
    { k: 'Country', v: country?.name ?? '—' },
    { k: 'Fixtures', v: String(fixtureCount) },
    { k: 'Table as of', v: asOf ? formatAsOf(asOf) : '—' },
  ];
  const dataAvailable: DataAvailabilityItem[] = [
    { k: 'Competition', v: 'Available', present: true },
    { k: 'Edition', v: 'Available', present: true },
    {
      k: 'Standings',
      v: st.kind === 'ok' ? (st.variantsPresent.length > 1 ? st.variantsPresent.map(standingsVariantLabel).join(' · ') : 'Overall only') : 'Not available',
      present: st.kind === 'ok',
    },
    { k: 'Fixture list', v: fixtures.length > 0 ? 'Available' : 'None yet', present: fixtures.length > 0 },
  ];

  const fixtureFacts = [
    { k: 'Fixtures', v: String(fixtureCount) },
    { k: 'First kickoff', v: facts.firstKickoff ? fixtureShortDate(facts.firstKickoff) : '—' },
    { k: 'Last kickoff', v: facts.lastKickoff ? fixtureShortDate(facts.lastKickoff) : '—' },
    { k: 'Latest result', v: facts.latestResult ? fixtureShortDate(facts.latestResult) : '—' },
    { k: 'Table as of', v: asOf ? formatAsOf(asOf) : '—' },
  ];
  const tableVsResults =
    asOf && facts.latestResult && asOf < facts.latestResult.slice(0, 10)
      ? `The table is dated ${formatAsOf(asOf)}. Results run to ${fixtureShortDate(facts.latestResult)}. The table is shown as published and is not recalculated from results.`
      : null;

  return (
    <>
      <CompetitionHeader
        country={country ? { code: country.code, name: country.name, alpha3Code: country.alpha3Code } : null}
        competition={{ id: competition.id, name: competition.name, slug: competition.slug }}
        seasonLabel={edition.seasonLabel}
        editions={editions}
        currentEditionId={edition.id}
        editionRef={editionRef}
        fixtureCount={fixtureCount}
        asOf={asOf}
        variantLabel={headerVariant}
        activeTab={tab}
      />

      <main className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(16px,3vw,28px) 16px' }}>
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]" style={{ gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {st.kind === 'ok'
                ? <StandingsTable table={st.table} asOf={st.asOf} label={st.label} mode="preview" previewCount={5} editionRef={editionRef} />
                : st.kind === 'empty' ? <StandingsEmpty seasonLabel={edition.seasonLabel} /> : <StandingsUnavailable />}
              <FixtureStrip fixtures={fixtures} editionRef={editionRef} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <EditionFactsRail facts={editionFacts} />
              <DataAvailableRail items={dataAvailable} />
            </div>
          </div>
        )}

        {tab === 'table' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {st.kind === 'ok'
              ? <StandingsTable table={st.table} asOf={st.asOf} label={st.label} mode="full" />
              : st.kind === 'empty' ? <StandingsEmpty seasonLabel={edition.seasonLabel} /> : <StandingsUnavailable />}
            {st.kind === 'ok' && <QualificationZonesNote />}
          </div>
        )}

        {tab === 'fixtures' && (
          <EditionFixturesTab fixtures={fixtures} facts={fixtureFacts} tableVsResults={tableVsResults} />
        )}
      </main>
    </>
  );
}
