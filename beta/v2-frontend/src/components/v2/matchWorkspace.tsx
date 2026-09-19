// MATCH HUB workspace shell — compact left Match Brief + tab navigation + a
// progressive-disclosure primitive. Presentational, SSR, no calculation.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { Kickoff, StatusChip } from '@/components/v2/ui';
import { MATCH_TABS, matchTabHref, type MatchTab } from '@/lib/v2/matchTabs';
import type { ApiMatchHeader, MatchResult, MatchVenueInfo } from '@/lib/v2/types';

export type CoverageFlag = readonly [string, 'present' | 'absent' | 'partial' | 'not-supported'];

/** The Match Hub outer boundary — aligned with the global header's max-w-6xl (72rem). */
export const MATCH_MAIN_CLASS = 'space-y-4 mx-auto w-full max-w-6xl px-4 py-4';

// The permanent, state-aware Match header lives in `matchOverview.tsx` (MatchHeader).

// ── left rail: compact Match Brief / Match State (retained primitive) ───────────────

export function MatchBrief({ match, result, venue, coverage }: {
  match: ApiMatchHeader;
  result: MatchResult | null;
  venue: MatchVenueInfo | null;
  coverage: readonly CoverageFlag[];
}) {
  const completed = match.status === 'COMPLETED';
  const score = match.score;
  return (
    <aside className="panel" style={{ padding: 14, alignSelf: 'start' }} aria-label="match brief">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <p className="eyebrow">Match brief</p>
        <StatusChip status={match.status} />
      </div>

      <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 10 }}>
        <Link href={routes.competition(match.competition)} style={{ color: 'var(--cool)' }}>{match.competition.name}</Link>
      </p>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>{match.edition.seasonLabel}</p>

      {/* teams + result / vs */}
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, alignItems: 'center' }}>
        <Link href={routes.team(match.homeTeam)} style={{ color: 'var(--text)', fontWeight: 700, textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{match.homeTeam.name}</Link>
        <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700 }}>{completed && score ? score.home : ''}</span>
        <Link href={routes.team(match.awayTeam)} style={{ color: 'var(--text)', fontWeight: 700, textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{match.awayTeam.name}</Link>
        <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700 }}>{completed && score ? score.away : ''}</span>
      </div>
      {!completed && <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 4 }}>vs · not yet played</p>}

      <p className="label-cap tnum" style={{ color: 'var(--muted)', fontSize: 10, marginTop: 10 }}><Kickoff iso={match.kickoffAt} /></p>

      {/* venue */}
      <div style={{ marginTop: 12 }}>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Venue</p>
        {venue
          ? <p style={{ fontSize: 12, marginTop: 2 }}><Link href={routes.venue(venue)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{venue.name}</Link>{venue.city ? <span style={{ color: 'var(--faint)' }}> · {venue.city}</span> : null}</p>
          : <p style={{ color: 'var(--faint)', fontSize: 12, marginTop: 2 }}>—</p>}
      </div>

      {/* match state */}
      <div style={{ marginTop: 12 }}>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Match state</p>
        <p style={{ fontSize: 12, marginTop: 2, color: 'var(--text)' }}>{match.status.replace(/_/g, ' ').toLowerCase()}</p>
        {completed && result?.confirmedAt && <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>confirmed <Kickoff iso={result.confirmedAt} /></p>}
      </div>

      {/* coverage summary */}
      <div style={{ marginTop: 12 }}>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Data coverage</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {coverage.map(([label, state]) => (
            <span key={label} className="label-cap" style={{ fontSize: 9, color: state === 'present' ? 'var(--edge)' : 'var(--faint)' }}>{label} {state === 'present' ? '✓' : state === 'not-supported' ? 'N/S' : '—'}</span>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── main: tab navigation ────────────────────────────────────────────────────────────

export function MatchTabNav({ slug, active }: { slug: string; active: MatchTab }) {
  return (
    <nav aria-label="match sections" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
      {MATCH_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link key={t.key} href={matchTabHref(slug, t.key)} aria-current={isActive ? 'page' : undefined}
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

// ── progressive disclosure (native <details>, no client JS) ─────────────────────────

export function Collapsible({ summary, count, children, open = false }: {
  summary: string;
  count?: number;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="panel" style={{ padding: 12 }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
        <span className="eyebrow">{summary}</span>
        {typeof count === 'number' && <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginLeft: 8 }}>{count}</span>}
        <span className="label-cap" style={{ color: 'var(--cool)', fontSize: 9, marginLeft: 8 }}>toggle →</span>
      </summary>
      <div style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}
