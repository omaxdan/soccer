// ENTITY KEYSTONES — Competition / Country / Venue presentational components.
//
// Layer-1 navigation/context surfaces (read-only, SSR). They render ONLY the
// identity + canonical relationships the backend supplies, and lead naturally into
// the next hierarchy level:
//   Competition → its Editions
//   Country     → its Competitions and Teams
//   Venue       → its canonical Home Teams (+ location EVIDENCE)
//
// Every link goes through the centralized route helpers (namespace-neutral). No data
// fetching, no calculation, no fabrication. Geographic fields are EVIDENCE/CONTEXT
// ONLY — no travel distance/impact/fatigue, no maps, no prediction, no betting.
// Nullable fields render as an explicit em dash, never zero-filled.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { EmptyState } from '@/components/v2/ui';
import type {
  ApiCompetitionSummary, ApiEditionSummary, ApiTeamSummary, CompetitionResponse, CountryResponse, VenueResponse,
} from '@/lib/v2/types';

/** A small "context" tag, matching the existing entity surfaces. */
function ContextTag() {
  return <span className="label-cap" style={{ color: 'var(--cool)', border: '1px solid var(--cool)', borderRadius: 4, padding: '0 5px', fontSize: 9 }}>context</span>;
}

function SectionEyebrow({ label, count }: { label: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <p className="eyebrow">{label}</p>
      <ContextTag />
      {typeof count === 'number' && <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{count}</span>}
    </div>
  );
}

/** Nullable-aware display: an explicit em dash when absent (never zero-filled). */
function orDash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

// ── shared: a team-summary link (canonical stored slug + DB id) ───────────────────

function TeamLinks({ teams }: { teams: readonly ApiTeamSummary[] }) {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {teams.map((t) => (
        <li key={t.id}>
          <Link href={routes.team(t)} className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 12, textDecoration: 'none', color: 'inherit' }}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text)' }}>{t.name}</span>
            {t.shortName && <span className="label-cap" style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{t.shortName}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ═══ COMPETITION ══════════════════════════════════════════════════════════════════

export function CompetitionHeaderPanel({ competition }: { competition: CompetitionResponse['competition'] }) {
  return (
    <header className="panel" style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{competition.name}</h1>
      <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 4 }}>
        {competition.slug}{competition.countryCode ? ` · ${competition.countryCode}` : ''}
      </p>
    </header>
  );
}

/** Editions of the competition — the natural next step. Each links to the established
 *  edition public URL; fixtureCount is displayed exactly as supplied (never computed). */
export function CompetitionEditionsPanel({ editions }: { editions: readonly ApiEditionSummary[] }) {
  return (
    <section className="space-y-2">
      <SectionEyebrow label="Editions" count={editions.length} />
      {editions.length === 0 ? (
        <EmptyState message="No governed editions are available for this competition yet." />
      ) : (
        <ul className="grid grid-cols-1 gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {editions.map((e) => (
            <li key={e.id}>
              <Link
                href={routes.edition({ id: e.id, competition: { slug: e.competition.slug }, seasonLabel: e.seasonLabel })}
                className="panel"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 12, textDecoration: 'none', color: 'inherit' }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text)' }}>{e.seasonLabel}</span>
                <span className="label-cap tnum" style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{e.fixtureCount} fixtures</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ═══ COUNTRY ══════════════════════════════════════════════════════════════════════

export function CountryHeaderPanel({ country }: { country: CountryResponse['country'] }) {
  return (
    <header className="panel" style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{country.name}</h1>
      <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 4 }}>
        {country.code}{country.alpha3Code ? ` · ${country.alpha3Code}` : ''}
      </p>
    </header>
  );
}

export function CountryCompetitionsPanel({ competitions }: { competitions: readonly ApiCompetitionSummary[] }) {
  return (
    <section className="space-y-2">
      <SectionEyebrow label="Competitions" count={competitions.length} />
      {competitions.length === 0 ? (
        <EmptyState message="No governed competitions for this country yet." />
      ) : (
        <ul className="grid grid-cols-1 gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {competitions.map((c) => (
            <li key={c.id}>
              <Link href={routes.competition(c)} className="panel" style={{ display: 'block', padding: 12, textDecoration: 'none', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CountryTeamsPanel({ teams }: { teams: readonly ApiTeamSummary[] }) {
  return (
    <section className="space-y-2">
      <SectionEyebrow label="Teams" count={teams.length} />
      {teams.length === 0 ? (
        <EmptyState message="No governed teams for this country yet." />
      ) : (
        <TeamLinks teams={teams} />
      )}
    </section>
  );
}

// ═══ VENUE ══════════════════════════════════════════════════════════════════════════

export function VenueHeaderPanel({ venue }: { venue: VenueResponse['venue'] }) {
  return (
    <header className="panel" style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{venue.name}</h1>
      <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 4 }}>
        {orDash(venue.city)}{venue.countryCode ? ` · ${venue.countryCode}` : ''}
      </p>
    </header>
  );
}

function GeoField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</span>
      <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 12 }}>{value}</span>
    </div>
  );
}

/** Location EVIDENCE — coordinates, elevation, timezone, capacity, surface, exactly as
 *  stored. Nullable fields show an em dash. This is context, NOT a travel/map/distance
 *  calculation and never becomes one. */
export function VenueGeographyPanel({ venue }: { venue: VenueResponse['venue'] }) {
  const coordinates = venue.latitude !== null && venue.longitude !== null ? `${venue.latitude}, ${venue.longitude}` : '—';
  return (
    <section className="space-y-2">
      <SectionEyebrow label="Location evidence" />
      <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        <GeoField label="Coordinates" value={coordinates} />
        <GeoField label="Elevation (m)" value={orDash(venue.elevationMetres)} />
        <GeoField label="Timezone" value={orDash(venue.timezoneName)} />
        <GeoField label="Capacity" value={orDash(venue.capacity)} />
        <GeoField label="Surface" value={orDash(venue.surface)} />
      </div>
    </section>
  );
}

export function VenueHomeTeamsPanel({ homeTeams }: { homeTeams: readonly ApiTeamSummary[] }) {
  return (
    <section className="space-y-2">
      <SectionEyebrow label="Home teams" count={homeTeams.length} />
      {homeTeams.length === 0 ? (
        <EmptyState message="No canonical home teams for this venue." />
      ) : (
        <TeamLinks teams={homeTeams} />
      )}
    </section>
  );
}
