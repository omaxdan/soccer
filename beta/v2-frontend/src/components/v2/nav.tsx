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

// ── mobile bottom navigation ─────────────────────────────────────────────────────

// Simple inline SVG icons (no icon library). Decorative — each item also has a
// visible text label, so the icon is aria-hidden.
const ICON: Record<string, React.ReactNode> = {
  Fixtures: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <rect x="3" y="4" width="14" height="13" rx="1.5" /><line x1="3" y1="8" x2="17" y2="8" /><line x1="7" y1="2.5" x2="7" y2="5" /><line x1="13" y1="2.5" x2="13" y2="5" />
    </svg>
  ),
  Competitions: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M6 3h8v3a4 4 0 0 1-8 0V3z" /><path d="M6 4.5H4v1a2 2 0 0 0 2 2" /><path d="M14 4.5h2v1a2 2 0 0 1-2 2" /><line x1="10" y1="10" x2="10" y2="14" /><line x1="7" y1="16.5" x2="13" y2="16.5" />
    </svg>
  ),
  Teams: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path d="M10 2.5l6 2v4.5c0 4-3 6-6 7-3-1-6-3-6-7V4.5l6-2z" />
    </svg>
  ),
  Players: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <circle cx="10" cy="6.5" r="3" /><path d="M4 17c0-3.2 2.7-5.5 6-5.5s6 2.3 6 5.5" />
    </svg>
  ),
};

/** The persistent mobile bottom navigation — the primary product navigation on
 *  mobile (the top bar keeps only brand + Search + access). Fixed to the bottom with
 *  a safe-area inset; active item uses the amber colour AND a top border + bolder
 *  label (never colour alone). Hidden from `md` up (desktop uses the header nav). */
export function BottomNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {PRIMARY_NAV.map((it) => {
          const on = it.isActive(pathname);
          return (
            <li key={it.href}>
              <Link href={it.href} aria-current={on ? 'page' : undefined}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 56, textDecoration: 'none', color: on ? 'var(--amber)' : 'var(--muted)', borderTop: `2px solid ${on ? 'var(--amber)' : 'transparent'}`, marginTop: -1 }}>
                {ICON[it.label]}
                <span className="mono" style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: on ? 600 : 400 }}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
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
