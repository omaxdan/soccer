// PUBLIC LEGAL WORKSPACE (B8) — presentational, static, DB-free (SSR).
//
// A faithful implementation of the Claude Design Legal wireframe
// (docs/frontend-design/wireframes/project/LegalPage.dc.html; spec
// "Legal Page.dc.html"), reusing the Phase A design system.
//
// LEGAL CONTENT DISCIPLINE: the design deliberately contains NO legal copy — its
// default document state is "◌ AWAITING APPROVED TEXT", and the effective/updated
// date is "shown only when supplied". No approved legal text exists in the repository
// either. So this page renders the honest AWAITING-APPROVED-TEXT state for each
// document and invents NO legal policy, company/contact details, dates, jurisdiction,
// or terms. The design's specimen/failed/missing states are design-only and are not
// used as production content. When approved copy is later connected, it replaces the
// pending panel here.
//
// Two documents (Terms, Privacy) → two real routes (/terms, /privacy); the sidebar
// navigates between them with real links.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';

export type LegalDoc = 'Terms' | 'Privacy';

const DOCS: readonly { doc: LegalDoc; href: string; fullName: string }[] = [
  { doc: 'Terms', href: routes.terms(), fullName: 'Terms of Service' },
  { doc: 'Privacy', href: routes.privacy(), fullName: 'Privacy Policy' },
];

export function LegalWorkspace({ active }: { active: LegalDoc }) {
  const current = DOCS.find((d) => d.doc === active) ?? DOCS[0];
  return (
    <main style={{ flex: 1, maxWidth: 1152, width: '100%', margin: '0 auto', padding: 'clamp(24px,5vw,48px) 16px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Legal</span>
        <h1 style={{ margin: 0, font: '700 28px/1.15 Inter,sans-serif', letterSpacing: '-.01em' }}>Legal</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]" style={{ gap: 'clamp(16px,3vw,48px)', alignItems: 'start' }}>
        {/* document nav — a row on mobile, a sticky sidebar on desktop */}
        <nav aria-label="Legal documents" className="flex flex-row md:flex-col md:sticky md:top-4" style={{ gap: 2 }}>
          <span className="hidden md:block" style={{ padding: '0 10px 8px', font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>Documents</span>
          {DOCS.map((d) => {
            const on = d.doc === active;
            return (
              <Link key={d.doc} href={d.href} aria-current={on ? 'page' : undefined}
                className="flex-1 md:flex-none"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 40, padding: '0 10px', borderRadius: 4, background: on ? 'var(--raised)' : 'transparent', border: `1px solid ${on ? 'var(--line)' : 'transparent'}`, fontFamily: 'Inter,sans-serif', fontSize: 14, fontWeight: on ? 600 : 400, color: on ? 'var(--text)' : 'var(--muted)', textDecoration: 'none' }}>
                {d.doc}<span aria-hidden style={{ font: "400 12px 'JetBrains Mono',monospace", color: 'var(--amber)' }}>{on ? '›' : ''}</span>
              </Link>
            );
          })}
        </nav>

        <article aria-labelledby="legal-doc-h" style={{ minWidth: 0, maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
            <h2 id="legal-doc-h" style={{ margin: 0, font: '700 22px/1.2 Inter,sans-serif', color: 'var(--text)' }}>{current.doc}</h2>
            {/* Effective/updated date is shown only when supplied — it is not, so it is omitted. */}
          </div>

          {/* Honest pending state — approved legal text is not published yet. */}
          <div role="status" className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ alignSelf: 'flex-start', font: "500 9px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--faint)', border: '1px dashed var(--faint)', borderRadius: 4, padding: '1px 6px' }}>◌ AWAITING APPROVED TEXT</span>
            <p style={{ margin: 0, font: '400 15px/1.7 Inter,sans-serif', color: 'var(--text-secondary)' }}>
              PitchTerminal’s {current.fullName} hasn’t been published yet. The approved document will appear here once it’s finalised.
            </p>
          </div>
        </article>
      </div>
    </main>
  );
}
