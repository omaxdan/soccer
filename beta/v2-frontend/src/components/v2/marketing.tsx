// SHARED MARKETING PRIMITIVES — small presentational pieces reused across the
// public pages (B1 Landing, B2 Features …). DB-free, static, SSR. They reuse the
// Phase A design system tokens exclusively; they are NOT product/API components
// (the app uses the ApiTeam/ApiFormFixture-typed primitives in ui.tsx for real
// data). Extracted so the public pages share one implementation instead of each
// copying the same W/D/L badge, CTA button and "coming soon" label.

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { routes } from '@/lib/v2/routes';

export const EYEBROW: CSSProperties = { font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' };
export const MONO_CAP: CSSProperties = { font: "500 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase' };

export const CTA_AMBER: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 20px',
  background: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4,
  font: "600 11px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)', textDecoration: 'none',
};
export const CTA_GHOST: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 20px',
  background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4,
  font: "500 11px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text)', textDecoration: 'none',
};

// Recent-form result → colour + full word. Text + colour (never colour alone), so
// each badge carries its meaning for assistive tech.
const RESULT: Record<string, readonly [string, string]> = {
  W: ['var(--edge)', 'Win'], D: ['var(--muted)', 'Draw'], L: ['var(--risk)', 'Loss'],
};

/** A left-to-right strip of W/D/L badges (marketing illustration, oldest → latest). */
export function FormBadgeRow({ seq, align = 'left' }: { seq: string; align?: 'left' | 'right' }) {
  return (
    <div style={{ display: 'flex', gap: 4, justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }} role="list" aria-label="recent form">
      {seq.split('').map((r, i) => {
        const [c, word] = RESULT[r] ?? ['var(--faint)', 'No result'];
        return (
          <span key={i} role="listitem" title={word} aria-label={word}
            style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', font: "700 11px 'JetBrains Mono',monospace", color: c, background: `color-mix(in srgb, ${c} 15%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`, borderRadius: 4 }}>
            {r}
          </span>
        );
      })}
    </div>
  );
}

/** A marketing label whose destination is a later roadmap phase — rendered as
 *  non-interactive muted text (not a link) so the public page never 404s. */
export function SoonText({ children }: { children: React.ReactNode }) {
  return <span style={{ font: '400 13px Inter,sans-serif', color: 'var(--faint)', cursor: 'default' }}>{children}</span>;
}

const FOOT_LINK: CSSProperties = { font: '400 13px Inter,sans-serif', color: 'var(--text-secondary)', textDecoration: 'none' };
const FOOT_GROUP_LABEL: CSSProperties = { font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' };

/** The shared public-site footer (appears on every Phase B page). Explore links go to
 *  the live /v2 app surfaces; destinations that belong to later roadmap phases
 *  (Pricing B3, Log in/Sign up B4/B5, Terms/Privacy B8) are non-interactive until then.
 *  Features (B2) is live and linked. */
export function MarketingFooter() {
  return (
    <footer style={{ maxWidth: 1152, margin: '0 auto', padding: '40px 16px 32px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]" style={{ gap: '28px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="col-span-2 md:col-span-1">
          <span style={{ font: '700 15px Inter,sans-serif', color: 'var(--text)' }}>Pitch<span style={{ color: 'var(--amber)' }}>Terminal</span></span>
          <span style={EYEBROW}>Football Intelligence</span>
        </div>
        <nav aria-label="Product" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={FOOT_GROUP_LABEL}>Product</span>
          <Link href={routes.features()} style={FOOT_LINK}>Features</Link>
          <Link href={routes.pricing()} style={FOOT_LINK}>Pricing</Link>
        </nav>
        <nav aria-label="Explore" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={FOOT_GROUP_LABEL}>Explore</span>
          <Link href={routes.fixtures()} style={FOOT_LINK}>Fixtures</Link>
          <Link href={routes.leagues()} style={FOOT_LINK}>Competitions</Link>
          <Link href={routes.teams()} style={FOOT_LINK}>Teams</Link>
          <Link href={routes.players()} style={FOOT_LINK}>Players</Link>
        </nav>
        <nav aria-label="Account" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={FOOT_GROUP_LABEL}>Account</span>
          <Link href={routes.login()} style={FOOT_LINK}>Log in</Link>
          <Link href={routes.signup()} style={FOOT_LINK}>Sign up</Link>
        </nav>
        <nav aria-label="Legal" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={FOOT_GROUP_LABEL}>Legal</span>
          <Link href={routes.terms()} style={FOOT_LINK}>Terms</Link>
          <Link href={routes.privacy()} style={FOOT_LINK}>Privacy</Link>
        </nav>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, paddingTop: 16, borderTop: '1px solid var(--line)', font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>
        <span>© PitchTerminal</span><span>Football intelligence. Not betting advice.</span>
      </div>
    </footer>
  );
}
