// COMPETITION (EDITION) WORKSPACE — presentational components (read-only, SSR).
//
// The competition-page surfaces: identity header + season, tab navigation, fixture
// grouping/cards, derived team discovery, and honest unavailable states for
// capabilities the backend does not (yet) serve — notably standings and
// competition-level governed intelligence. Every link is built through the
// centralized route helpers (namespace-neutral). No data fetching, no calculation,
// no fabrication, no betting language.

import Link from 'next/link';
import { routes, type V2EditionRef } from '@/lib/v2/routes';
import {
  EDITION_TABS, editionTabHref, groupFixturesByDay,
  type EditionTab, type GroupedFixtures,
} from '@/lib/v2/competition';
import type { ApiEditionFixture, ApiEditionSummary, ApiTeam, EditionStandings } from '@/lib/v2/types';
import { Kickoff, StatusChip, Score, EmptyState } from '@/components/v2/ui';

// ── identity + season ────────────────────────────────────────────────────────────

/** A neutral competition monogram (initials) — the V2 surface carries no competition
 *  logo, so this is an honest compact mark, never an invented image. */
function CompetitionMonogram({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '•';
  return (
    <span aria-hidden className="mono" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 44, height: 44, borderRadius: 8, fontSize: 15, fontWeight: 700, flexShrink: 0,
      color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, var(--panel))',
      border: '1px solid var(--line)',
    }}>{initials}</span>
  );
}

/** Season selector — only rendered when more than one season of the competition is
 *  tracked. Otherwise the caller shows the plain season label. Real seasons only. */
function SeasonSelector({ seasons, currentEditionId }: { seasons: readonly ApiEditionSummary[]; currentEditionId: string }) {
  if (seasons.length <= 1) return null;
  return (
    <nav aria-label="season" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {seasons.map((s) => {
        const active = s.id === currentEditionId;
        return (
          <Link key={s.id} href={routes.edition({ id: s.id, competition: { slug: s.competition.slug }, seasonLabel: s.seasonLabel })} aria-current={active ? 'true' : undefined}
            className="label-cap tnum" style={{
              padding: '2px 8px', borderRadius: 4, textDecoration: 'none',
              color: active ? 'var(--text)' : 'var(--muted)',
              border: `1px solid ${active ? 'var(--amber)' : 'var(--line)'}`,
              background: active ? 'color-mix(in srgb, var(--amber) 10%, transparent)' : 'transparent',
            }}>{s.seasonLabel}</Link>
        );
      })}
    </nav>
  );
}

export function CompetitionHeader({ competitionName, seasonLabel, seasons, currentEditionId, teamCount, fixtureCount }: {
  competitionName: string; seasonLabel: string; seasons: readonly ApiEditionSummary[];
  currentEditionId: string; teamCount: number; fixtureCount: number;
}) {
  return (
    <header className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <CompetitionMonogram name={competitionName} />
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Competition</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{competitionName}</h1>
          <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 2 }}>Season {seasonLabel}</p>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12, alignItems: 'center' }}>
        <span className="label-cap tnum" style={{ color: 'var(--faint)' }}>{fixtureCount} fixtures</span>
        <span className="label-cap tnum" style={{ color: 'var(--faint)' }}>{teamCount} teams</span>
        <div style={{ marginLeft: 'auto' }}><SeasonSelector seasons={seasons} currentEditionId={currentEditionId} /></div>
      </div>
    </header>
  );
}

// ── tab navigation ───────────────────────────────────────────────────────────────

export function EditionTabNav({ edition, active }: { edition: string | V2EditionRef; active: EditionTab }) {
  return (
    <nav aria-label="competition sections" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
      {EDITION_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link key={t.key} href={editionTabHref(edition, t.key)} aria-current={isActive ? 'page' : undefined}
            className="label-cap" style={{
              padding: '8px 12px', textDecoration: 'none', whiteSpace: 'nowrap',
              color: isActive ? 'var(--text)' : 'var(--muted)',
              borderBottom: `2px solid ${isActive ? 'var(--amber)' : 'transparent'}`,
              marginBottom: -1,
            }}>{t.label}</Link>
        );
      })}
    </nav>
  );
}

// ── fixtures ─────────────────────────────────────────────────────────────────────

/** One polished fixture row. Home (right) · score/time · away (left) + status. */
export function FixtureRow({ fixture }: { fixture: ApiEditionFixture }) {
  return (
    <Link href={routes.match(fixture)} className="panel" style={{
      display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, padding: '10px 12px',
      alignItems: 'center', textDecoration: 'none', color: 'inherit',
    }}>
      <span style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{fixture.homeTeam.name}</span>
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 64 }}>
        {fixture.score
          ? <Score score={fixture.score} />
          : <span className="label-cap tnum" style={{ color: 'var(--muted)' }}><Kickoff iso={fixture.kickoffAt} /></span>}
        <StatusChip status={fixture.status} />
      </span>
      <span style={{ textAlign: 'left', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{fixture.awayTeam.name}</span>
    </Link>
  );
}

/** A friendly UTC day header, e.g. "Sat 13 Sep 2026". */
function dayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A titled fixture section grouped by day, or an honest empty state. */
export function FixtureSection({ title, fixtures, emptyMessage }: {
  title: string; fixtures: readonly ApiEditionFixture[]; emptyMessage: string;
}) {
  const days = groupFixturesByDay(fixtures);
  return (
    <section className="space-y-2" aria-label={title}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">{title}</p>
        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{fixtures.length}</span>
      </div>
      {fixtures.length === 0 ? (
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11 }}>{emptyMessage}</p>
      ) : (
        <div className="space-y-3">
          {days.map((day) => (
            <div key={day.dayKey} className="space-y-1">
              <p className="label-cap" style={{ color: 'var(--muted)' }}>{dayLabel(day.dayKey)}</p>
              <div className="space-y-1">
                {day.fixtures.map((f) => <FixtureRow key={f.fixtureId} fixture={f} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The full Matches tab: live (if any), upcoming, recent. */
export function MatchesPanel({ grouped }: { grouped: GroupedFixtures }) {
  const empty = grouped.live.length === 0 && grouped.upcoming.length === 0 && grouped.recent.length === 0;
  if (empty) return <EmptyState message="No fixtures are currently available for this competition." />;
  return (
    <div className="space-y-5">
      {grouped.live.length > 0 && <FixtureSection title="Live" fixtures={grouped.live} emptyMessage="No live matches." />}
      <FixtureSection title="Upcoming" fixtures={grouped.upcoming} emptyMessage="No upcoming fixtures scheduled." />
      <FixtureSection title="Recent results" fixtures={grouped.recent} emptyMessage="No completed matches yet." />
    </div>
  );
}

// ── teams (derived) ──────────────────────────────────────────────────────────────

export function TeamsPanel({ teams }: { teams: readonly ApiTeam[] }) {
  if (teams.length === 0) return <EmptyState message="No teams are available for this competition yet." />;
  return (
    <section aria-label="teams" className="space-y-2">
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>Teams appearing in this competition’s fixtures.</p>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {teams.map((t) => (
          <li key={t.id}>
            <Link href={routes.team(t)} className="panel" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, textDecoration: 'none', color: 'inherit' }}>
              <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <span className="label-cap" style={{ color: 'var(--faint)', marginLeft: 'auto' }}>→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── standings (governed observed snapshot) ─────────────────────────────────────────

const stTh: React.CSSProperties = { textAlign: 'right', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' };
const stTd: React.CSSProperties = { textAlign: 'right', padding: '4px 6px', color: 'var(--text)', whiteSpace: 'nowrap' };

/**
 * The edition's governed standings snapshot (position/P/W/D/L/GF/GA/GD/Pts), rendered
 * from the backend read — never client-computed. Shows the TOTAL variant; goal
 * difference is a labelled read-layer derivation. `limit` renders a top-N preview
 * (Overview). An honest empty state when no standings snapshot is ingested yet.
 */
export function StandingsTable({ standings, limit }: { standings: EditionStandings; limit?: number }) {
  const table = standings.tables.find((t) => t.variant === 'TOTAL') ?? standings.tables[0] ?? null;
  if (standings.coverage.standings === 'absent' || !table || table.rows.length === 0) {
    return (
      <section className="panel" aria-label="standings" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p className="eyebrow">Standings</p>
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, border: '1px solid var(--faint)', borderRadius: 4, padding: '0 5px' }}>absent</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>No standings snapshot has been ingested for this edition yet.</p>
      </section>
    );
  }
  const rows = typeof limit === 'number' ? table.rows.slice(0, limit) : table.rows;
  return (
    <section className="space-y-2" aria-label="standings">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Standings</p>
        <span className="label-cap" style={{ color: 'var(--cool)', fontSize: 9 }}>{table.variant}</span>
        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>as of {table.asOf}</span>
      </div>
      <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
        <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead><tr>
            <th style={{ ...stTh, textAlign: 'left' }}>#</th>
            <th style={{ ...stTh, textAlign: 'left' }}>Team</th>
            <th style={stTh}>P</th><th style={stTh}>W</th><th style={stTh}>D</th><th style={stTh}>L</th>
            <th style={stTh}>GF</th><th style={stTh}>GA</th><th style={stTh}>GD</th><th style={stTh}>Pts</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.team.id}>
                <td style={{ ...stTd, textAlign: 'left', color: 'var(--faint)' }}>{r.position}</td>
                <td style={{ ...stTd, textAlign: 'left', whiteSpace: 'normal' }}><Link href={routes.team(r.team)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{r.team.name}</Link></td>
                <td style={stTd}>{r.played}</td><td style={stTd}>{r.won}</td><td style={stTd}>{r.drawn}</td><td style={stTd}>{r.lost}</td>
                <td style={stTd}>{r.goalsFor}</td><td style={stTd}>{r.goalsAgainst}</td>
                <td style={stTd}>{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                <td style={{ ...stTd, fontWeight: 700 }}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Observed standings snapshot. GD is a read-layer derivation (GF − GA).{standings.coverage.variantsPresent.length > 1 ? ` Variants: ${standings.coverage.variantsPresent.join(' · ')}.` : ''}
        {typeof limit === 'number' && table.rows.length > limit ? ` Showing top ${limit} of ${table.rows.length}.` : ''}
      </p>
    </section>
  );
}

// ── honest unavailable states ────────────────────────────────────────────────────

/** Standings fallback when the governed read is genuinely unavailable (kept for the
 *  edition-not-exposed / null path). Honest unavailable state — never client-computed. */
export function StandingsUnavailable() {
  return (
    <section className="panel" aria-label="standings" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Standings</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, border: '1px solid var(--faint)', borderRadius: 4, padding: '0 5px' }}>not available</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>
        A league table is not published for this competition yet.
      </p>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 6 }}>
        PitchTerminal shows standings only from a governed backend read — it never computes a table on the fly. When the
        governed standings read is available, it will appear here.
      </p>
    </section>
  );
}

/**
 * Competition-level governed intelligence is not produced — PitchTerminal's sealed
 * intelligence is per match. This panel frames that honestly and routes the user to
 * matches, without fabricating a competition metric.
 */
export function CompetitionIntelligenceNote({ hasMatches }: { hasMatches: boolean }) {
  return (
    <section className="panel" aria-label="competition intelligence" style={{ padding: 20, borderColor: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 5%, var(--panel))' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow" style={{ color: 'var(--amber)' }}>Intelligence</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, border: '1px solid var(--faint)', borderRadius: 4, padding: '0 5px' }}>per match</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>
        Governed Match Intelligence is sealed per fixture — evidence, readiness and provenance for one match, as of its
        snapshot. There is no competition-wide governed score.
      </p>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 6 }}>
        {hasMatches ? 'Open a fixture from the Matches tab to see its sealed Match Intelligence.' : 'Intelligence appears once this competition has fixtures with sealed snapshots.'}
      </p>
    </section>
  );
}
