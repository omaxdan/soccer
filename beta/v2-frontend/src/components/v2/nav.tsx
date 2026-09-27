'use client';
// V2 SHELL NAVIGATION — presentational continuity components (read-only, SSR-safe).
//
// The stable navigation primitives the V2 shell and pages share: primary nav,
// breadcrumb (current location), and match prev/next. They render links exclusively
// through the centralized route helpers, so they carry no hardcoded /v2 (or /pitch)
// and flatten cleanly at the root-domain cutover. No data fetching, no calculation.
//
// This module is a client component only so PrimaryNav can mark the active section
// from the current pathname (the AppHeader design's amber-underline active state).
// `usePathname()` returns null outside a router (e.g. static-markup unit tests), in
// which case no item is marked active and every link still renders.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { routes } from '@/lib/v2/routes';
import type { ApiEditionFixture } from '@/lib/v2/types';

// ── primary navigation (in the shell header) ────────────────────────────────────

/** The primary application navigation — the four major exploration surfaces, shared
 *  by the whole product (the header is global, never page-specific). Each item owns a
 *  route FAMILY, so the active state is derived from the route hierarchy, not a single
 *  path. The active section is marked with the design's amber underline.
 *
 *  Route model: Fixtures is the collection/calendar (/fixtures, /fixtures/YYYY-MM-DD);
 *  an individual match (/v2/matches/{slug}) is reached FROM Fixtures/Competitions/
 *  Teams/Search and shows Fixtures as its active section (matches belong to the
 *  fixtures domain). Competitions is the leagues/editions index (/v2 + edition/
 *  competition/country/venue surfaces). '/' is the public landing (home) and
 *  activates NO section. */
const PRIMARY_NAV: readonly { label: string; href: string; isActive: (p: string) => boolean }[] = [
  { label: 'Fixtures', href: routes.fixtures(), isActive: (p) => p === '/fixtures' || p.startsWith('/fixtures/') || p.startsWith('/v2/matches') },
  { label: 'Competitions', href: routes.leagues(), isActive: (p) => p === '/v2' || p.startsWith('/v2/editions') || p.startsWith('/v2/competitions') || p.startsWith('/v2/countries') || p.startsWith('/v2/venues') },
  { label: 'Teams', href: routes.teams(), isActive: (p) => p.startsWith('/v2/teams') },
  { label: 'Players', href: routes.players(), isActive: (p) => p.startsWith('/v2/players') },
];

/** The primary nav. `desktop` is the inline header bar; `mobile` is the compact
 *  horizontally-scrollable second row. Both share the active-state logic. */
export function PrimaryNav({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const pathname = usePathname() ?? '';
  const mobile = variant === 'mobile';
  return (
    <nav
      aria-label="primary"
      className={mobile ? 'no-scrollbar' : undefined}
      style={{
        display: 'flex',
        gap: mobile ? 22 : 20,
        alignSelf: mobile ? undefined : 'stretch',
        height: mobile ? 40 : undefined,
        overflowX: mobile ? 'auto' : undefined,
      }}
    >
      {PRIMARY_NAV.map((it) => {
        const on = it.isActive(pathname);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={on ? 'page' : undefined}
            className="label-cap"
            style={{
              flex: mobile ? 'none' : undefined,
              display: 'flex',
              alignItems: 'center',
              color: on ? 'var(--text)' : 'var(--muted)',
              borderBottom: `2px solid ${on ? 'var(--amber)' : 'transparent'}`,
              marginBottom: -1,
              textDecoration: 'none',
            }}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ── breadcrumb (current location) ────────────────────────────────────────────────

export interface Crumb {
  readonly label: string;
  /** Omit href for the current (last) location. */
  readonly href?: string;
}

/** A compact breadcrumb trail. The final crumb is the current page (no link). */
export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            {c.href && !last ? (
              <Link href={c.href} className="label-cap" style={{ color: 'var(--cool)', textDecoration: 'none' }}>{c.label}</Link>
            ) : (
              <span className="label-cap" style={{ color: last ? 'var(--muted)' : 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60vw' }} aria-current={last ? 'page' : undefined}>
                {c.label}
              </span>
            )}
            {!last && <span className="label-cap" style={{ color: 'var(--faint)' }}>/</span>}
          </span>
        );
      })}
    </nav>
  );
}

// ── match prev/next (within the competition edition) ─────────────────────────────

/** One side of the prev/next pair, or a disabled placeholder when there is no
 *  neighbour (honest — no fabricated link). */
function NavCell({ fixture, direction }: { fixture: ApiEditionFixture | null; direction: 'prev' | 'next' }) {
  const isPrev = direction === 'prev';
  const align = isPrev ? 'flex-start' : 'flex-end';
  if (!fixture) {
    return (
      <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, display: 'flex', justifyContent: align }}>
        {isPrev ? '' : ''}
      </span>
    );
  }
  const label = `${fixture.homeTeam.name} v ${fixture.awayTeam.name}`;
  return (
    <Link
      href={routes.match(fixture)}
      className="panel"
      style={{ display: 'flex', flexDirection: 'column', alignItems: align, gap: 2, padding: '8px 12px', textDecoration: 'none', color: 'inherit', minWidth: 0 }}
    >
      <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{isPrev ? '← Previous' : 'Next →'}</span>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40vw', textAlign: isPrev ? 'left' : 'right' }}>{label}</span>
    </Link>
  );
}

/**
 * Prev/next navigation between matches in the same competition edition, plus a link
 * back to the full fixture list. Renders nothing at all when neither neighbour nor a
 * list link exists, so an isolated match never shows an empty control.
 */
export function MatchNav({ prev, next, editionId, competitionName }: {
  prev: ApiEditionFixture | null;
  next: ApiEditionFixture | null;
  editionId: string | null;
  competitionName: string | null;
}) {
  if (!prev && !next && !editionId) return null;
  return (
    <nav aria-label="match navigation" className="space-y-2">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <NavCell fixture={prev} direction="prev" />
        <NavCell fixture={next} direction="next" />
      </div>
      {editionId && (
        <p style={{ textAlign: 'center' }}>
          <Link href={routes.edition(editionId)} className="label-cap" style={{ color: 'var(--cool)' }}>
            All {competitionName ?? 'competition'} fixtures →
          </Link>
        </p>
      )}
    </nav>
  );
}
