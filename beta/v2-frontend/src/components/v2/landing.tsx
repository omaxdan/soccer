// PUBLIC LANDING PAGE (B1) — presentational, static, DB-free (SSR).
//
// A faithful implementation of the Claude Design Landing wireframe
// (docs/frontend-design/wireframes/project/LandingPage.dc.html, with the
// "Landing Page.dc.html" spec as intent). It reuses the Phase A design system
// (globals.css tokens + utilities) exclusively — no new palette, no second design
// language. It is pure marketing content: no API calls, no runtime calculation, no
// invented metrics. The product-preview is a static illustration of the real UI
// grammar (allowed by the design spec), NOT fabricated live data.
//
// Positioning: football INTELLIGENCE — evidence-first, pre-match, historical
// patterns. Never betting/odds/tips/picks. The design's own trust line ("No odds,
// no picks") and footer ("Not betting advice") are preserved verbatim.
//
// Links: destinations that exist today are real (the app under /v2 via the route
// helpers, and the in-page #how anchor). Destinations that belong to later roadmap
// phases (Features B2, Pricing B3, Login/Sign up B4/B5, Legal B8) are rendered as
// non-interactive text so the public page never links to a route that 404s. They
// become real links in their own phase.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';

// ── shared tokens for this page (design grammar) ─────────────────────────────────
const EYEBROW: React.CSSProperties = { font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' };
const MONO_CAP: React.CSSProperties = { font: "500 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase' };
const SECTION_PAD = 'clamp(40px,6vw,88px) 16px';

// Recent-form result → colour + full word (design's RC map).
const RESULT: Record<string, readonly [string, string]> = {
  W: ['var(--edge)', 'Win'], D: ['var(--muted)', 'Draw'], L: ['var(--risk)', 'Loss'],
};
function FormRow({ seq }: { seq: string }) {
  return (
    <div style={{ display: 'flex', gap: 4 }} role="list" aria-label="recent form, most recent first">
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

/** A footer/marketing label whose destination is a later roadmap phase — rendered as
 *  non-interactive muted text (not a link) so the public page never 404s. */
function SoonText({ children }: { children: React.ReactNode }) {
  return <span style={{ font: '400 13px Inter,sans-serif', color: 'var(--faint)', cursor: 'default' }}>{children}</span>;
}

const CTA_AMBER: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 20px',
  background: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4,
  font: "600 11px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)', textDecoration: 'none',
};
const CTA_GHOST: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 20px',
  background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4,
  font: "500 11px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text)', textDecoration: 'none',
};

// The reconciled Match workspace tabs (Overview active) — the preview reflects the
// SHIPPED product (5 tabs), not the wireframe's older 8-tab mock.
const PREVIEW_TABS = ['Overview', 'Lineups', 'Statistics', 'Intelligence', 'Timeline'];

// Static illustrative fixture board (design's reference data — a picture of the UI,
// not live data). The Botafogo v Palmeiras row is the "selected" one.
const PREVIEW_ROWS: readonly { time: string; home: string; away: string; hs: number; as: number; sel: boolean }[] = [
  { time: '11:00', home: 'Coritiba', away: 'Mirassol', hs: 1, as: 2, sel: false },
  { time: '16:00', home: 'Remo', away: 'Flamengo', hs: 0, as: 1, sel: false },
  { time: '16:00', home: 'Internacional', away: 'Santos', hs: 2, as: 3, sel: false },
  { time: '16:00', home: 'Cruzeiro', away: 'Athletico', hs: 3, as: 1, sel: false },
  { time: '18:30', home: 'Botafogo', away: 'Palmeiras', hs: 0, as: 0, sel: true },
  { time: '19:30', home: 'Corinthians', away: 'Chapecoense', hs: 1, as: 2, sel: false },
];

const CAPABILITIES = [
  { n: '01', title: 'Fixtures & results', body: 'Every match by country and competition, with kickoff, status and final score.' },
  { n: '02', title: 'Team form & readiness', body: 'How each side has been playing going into a match, result by result.' },
  { n: '03', title: 'Match intelligence', body: 'Readings that say whether the evidence supports or contradicts a side, with the evidence attached.' },
];

// Supporting rows — "where" references point at the SHIPPED match workspace (Overview
// absorbed the former Comparison/H2H; venue folds into Overview), not removed tabs.
const SUPPORTING = [
  { title: 'Match context', body: 'Competition, standing and venue around each fixture, so a result is never read in isolation.', where: 'Match · Overview' },
  { title: 'Historical patterns', body: 'Previous meetings and recurring patterns, shown alongside the match they relate to.', where: 'Match · Overview' },
  { title: 'Performance', body: 'Side-by-side comparison of how two teams have been performing.', where: 'Match · Overview' },
  { title: 'Statistical attributes', body: 'Descriptive team and player attributes drawn from recorded matches.', where: 'Match · Statistics' },
];

const FLOW = [
  { title: 'Fixture', body: 'The match itself: teams, kickoff, status and result.' },
  { title: 'Context', body: 'Where it sits: the competition, the table, the venue.' },
  { title: 'Team performance', body: 'How each side has been playing: form, readiness and attributes.' },
  { title: 'Historical patterns', body: 'What has happened before between these sides and in similar matches.' },
  { title: 'Match intelligence', body: 'Readings on which way the evidence points, with the evidence attached.' },
];

const PRINCIPLES = [
  { title: 'Observed, not assumed', body: 'Readings are built from recorded match data, not opinion or tips.' },
  { title: 'Missing stays missing', body: 'Where data does not exist you see a dash. Never a zero, never a guess.' },
  { title: 'Sample size on show', body: 'Each reading states how much evidence it rests on.' },
  { title: 'Direction, not certainty', body: 'Readings say whether the evidence supports or contradicts. They do not tell you what will happen.' },
];

const AUDIENCE = [
  { who: 'Analysts', what: 'Structured, comparable data across teams and competitions.' },
  { who: 'Scouts', what: 'Form and attributes in context, not in isolation.' },
  { who: 'Journalists', what: 'Checkable facts and patterns behind a story.' },
  { who: 'Serious fans', what: 'A deeper read of the match before kickoff.' },
];

const TIERS = [
  { chip: '○ OPEN', chipColor: 'var(--cool)', chipBg: 'transparent', chipBorder: 'var(--cool)', name: 'Explore', body: 'Browse fixtures, results and competitions.' },
  { chip: '■ SUBSCRIBER', chipColor: 'var(--amber)', chipBg: 'var(--amber-dim)', chipBorder: 'transparent', name: 'Go deeper', body: 'Unlock the deeper intelligence layers of each match.' },
];

export function LandingPage() {
  const appHref = routes.leagues(); // the live app entry (leagues / fixtures index)
  return (
    // No opaque background here: the shell body already paints --ink + the subtle
    // terminal grid, which should remain visible on the landing's ink sections
    // (the panel-coloured sections set their own background to cover it, by design).
    <main>
      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-h" className="grid grid-cols-1 md:grid-cols-[5fr_7fr] items-center"
        style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(40px,6vw,88px) 16px clamp(40px,5vw,72px)', gap: 'clamp(32px,4vw,56px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <span style={EYEBROW}>Football intelligence</span>
          <h1 id="hero-h" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(34px,6vw,54px)', lineHeight: 1.04, letterSpacing: '-.025em', color: 'var(--text)', textWrap: 'balance' }}>
            The evidence behind every fixture.
          </h1>
          <p style={{ margin: 0, font: '400 16px/1.6 Inter,sans-serif', color: 'var(--text-secondary)', maxWidth: 480 }}>
            PitchTerminal brings fixtures, team form, match context and historical patterns into one structured view, so you can read a match from the evidence up.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 4 }}>
            <Link href={appHref} style={CTA_AMBER}>Explore fixtures</Link>
            <a href="#how" style={CTA_GHOST}>How it works</a>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>
            <span>Observed match data</span><span>·</span><span>Evidence on every reading</span><span>·</span><span>No odds, no picks</span>
          </div>
        </div>

        {/* Product preview — static illustration of the real UI grammar. */}
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div className="panel" style={{ overflow: 'hidden', boxShadow: '0 1px 0 0 rgba(255,255,255,.02) inset, 0 8px 24px -12px rgba(0,0,0,.6)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--line)', ...MONO_CAP, fontWeight: 400 }}>
              <span style={{ color: 'var(--cool)' }}>Brazil</span><span style={{ color: 'var(--faint)' }}>/</span>
              <span style={{ color: 'var(--cool)' }}>Brasileirão Betano</span><span style={{ color: 'var(--faint)' }}>/</span>
              <span style={{ color: 'var(--muted)' }}>Botafogo v Palmeiras</span>
            </div>
            <div style={{ padding: '16px 14px 12px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 12, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', minWidth: 0 }}>
                <span style={{ font: '600 15px Inter,sans-serif', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Botafogo</span>
                <span aria-hidden style={{ width: 32, height: 32, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: 4, font: "700 10px 'JetBrains Mono',monospace", color: 'var(--muted)' }}>BOT</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ font: "700 24px 'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>0<span style={{ color: 'var(--faint)', margin: '0 6px' }}>–</span>0</span>
                <span style={{ ...MONO_CAP, fontWeight: 500, color: 'var(--muted)', border: '1px solid var(--muted)', borderRadius: 4, padding: '1px 6px' }}>FT</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span aria-hidden style={{ width: 32, height: 32, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: 4, font: "700 10px 'JetBrains Mono',monospace", color: 'var(--muted)' }}>PAL</span>
                <span style={{ font: '600 15px Inter,sans-serif', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Palmeiras</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 2, padding: '0 8px', borderBottom: '1px solid var(--line)', overflowX: 'auto' }} className="no-scrollbar">
              {PREVIEW_TABS.map((label, i) => (
                <span key={label} style={{ flex: 'none', padding: '8px 8px', font: "500 9.5px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: i === 0 ? 'var(--text)' : 'var(--muted)', borderBottom: `2px solid ${i === 0 ? 'var(--amber)' : 'transparent'}`, marginBottom: -1 }}>{label}</span>
              ))}
            </div>
            <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 12, alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}><FormRow seq="WDLLD" /></div>
              <span style={{ ...MONO_CAP, fontWeight: 400, color: 'var(--muted)', textAlign: 'center' }}>Last 5</span>
              <div style={{ display: 'flex' }}><FormRow seq="WDLWD" /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 14px', background: 'var(--raised)', borderBottom: '1px solid var(--line)', font: "400 9.6px 'JetBrains Mono',monospace", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              <span>Brasileirão Betano · Sun 6 Sep</span><span style={{ color: 'var(--faint)' }}>6</span>
            </div>
            <div style={{ padding: '4px 6px 6px' }}>
              {PREVIEW_ROWS.map((r) => (
                <div key={r.home} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) 52px minmax(0,1fr) 34px', gap: 10, alignItems: 'center', height: 34, padding: '0 8px', borderRadius: 4, background: r.sel ? 'var(--raised)' : 'transparent', border: `1px solid ${r.sel ? 'var(--amber-dim)' : 'transparent'}` }}>
                  <span style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--muted)' }}>{r.time}</span>
                  <span style={{ fontFamily: 'Inter,sans-serif', fontSize: 13, textAlign: 'right', fontWeight: r.hs > r.as ? 600 : 500, color: r.hs < r.as ? 'var(--text-secondary)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.home}</span>
                  <span style={{ textAlign: 'center', font: "600 12px 'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{r.hs}<span style={{ color: 'var(--faint)' }}> – </span>{r.as}</span>
                  <span style={{ fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: r.as > r.hs ? 600 : 500, color: r.as < r.hs ? 'var(--text-secondary)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.away}</span>
                  <span style={{ justifySelf: 'end', font: "500 9px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--muted)' }}>FT</span>
                </div>
              ))}
            </div>
          </div>
          <figcaption style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>Product UI with recorded data · Brasileirão Betano, 6 Sep 2026 (BRT)</figcaption>
        </figure>
      </section>

      {/* ── CAPABILITIES ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="cap-h" style={{ maxWidth: 1152, margin: '0 auto', padding: SECTION_PAD, display: 'flex', flexDirection: 'column', gap: 28, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
          <span style={EYEBROW}>What you get</span>
          <h2 id="cap-h" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,32px)', lineHeight: 1.15, letterSpacing: '-.015em' }}>What you can read in PitchTerminal</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 12 }}>
          {CAPABILITIES.map((c) => (
            <article key={c.n} className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={{ font: "500 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--amber)' }}>{c.n}</span>
              <h3 style={{ margin: 0, font: '600 17px Inter,sans-serif', color: 'var(--text)' }}>{c.title}</h3>
              <p style={{ margin: 0, font: '400 14px/1.55 Inter,sans-serif', color: 'var(--text-secondary)' }}>{c.body}</p>
              <div style={{ marginTop: 'auto', minHeight: 34, display: 'flex', alignItems: 'center' }}>
                {c.n === '01' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 52px minmax(0,1fr) 30px', gap: 8, alignItems: 'center', width: '100%', height: 34, padding: '0 10px', borderRadius: 4, background: 'color-mix(in srgb, var(--raised) 40%, transparent)' }}>
                    <span style={{ font: '600 13px Inter,sans-serif', textAlign: 'right', color: 'var(--text)' }}>Cruzeiro</span>
                    <span style={{ textAlign: 'center', font: "600 12px 'JetBrains Mono',monospace", color: 'var(--text)' }}>3<span style={{ color: 'var(--faint)' }}> – </span>1</span>
                    <span style={{ font: '500 13px Inter,sans-serif', color: 'var(--text-secondary)' }}>Athletico</span>
                    <span style={{ font: "500 9px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--muted)' }}>FT</span>
                  </div>
                )}
                {c.n === '02' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ font: '500 13px Inter,sans-serif', color: 'var(--text)' }}>Palmeiras</span>
                    <FormRow seq="WDLWD" />
                  </div>
                )}
                {c.n === '03' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <span style={{ ...MONO_CAP, fontWeight: 500, color: 'var(--edge)', border: '1px solid var(--edge)', borderRadius: 4, padding: '1px 6px' }}>SUPPORTS</span>
                    <span style={{ ...MONO_CAP, fontWeight: 500, color: 'var(--muted)', border: '1px solid var(--muted)', borderRadius: 4, padding: '1px 6px' }}>NEUTRAL</span>
                    <span style={{ ...MONO_CAP, fontWeight: 500, color: 'var(--risk)', border: '1px solid var(--risk)', borderRadius: 4, padding: '1px 6px' }}>CONTRADICTS</span>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {SUPPORTING.map((s) => (
            <div key={s.title} className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)_260px]" style={{ gap: '8px 24px', alignItems: 'baseline', padding: '16px 4px', borderTop: '1px solid var(--line)' }}>
              <h3 style={{ margin: 0, font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>{s.title}</h3>
              <p style={{ margin: 0, font: '400 14px/1.55 Inter,sans-serif', color: 'var(--text-secondary)' }}>{s.body}</p>
              <span style={{ ...MONO_CAP, fontWeight: 400, color: 'var(--faint)' }}>{s.where}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────────── */}
      <section id="how" aria-labelledby="how-h" style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: SECTION_PAD, display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
            <span style={EYEBROW}>How it works</span>
            <h2 id="how-h" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,32px)', lineHeight: 1.15, letterSpacing: '-.015em' }}>From fixture to intelligence</h2>
            <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>A score tells you what happened. PitchTerminal layers what surrounds it, step by step.</p>
          </div>
          <ol className="grid grid-cols-1 md:grid-cols-5" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 12 }}>
            {FLOW.map((s, i) => {
              const last = i === FLOW.length - 1;
              return (
                <li key={s.title} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 4, background: last ? 'var(--raised)' : 'var(--ink)', border: `1px solid ${last ? 'var(--amber-dim)' : 'var(--line)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ font: "600 11px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: last ? 'var(--amber)' : 'var(--muted)' }}>{String(i + 1).padStart(2, '0')}</span>
                    <span aria-hidden style={{ font: "400 14px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>{last ? '' : '→'}</span>
                  </div>
                  <h3 style={{ margin: 0, font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>{s.title}</h3>
                  <p style={{ margin: 0, font: '400 13px/1.5 Inter,sans-serif', color: 'var(--text-secondary)' }}>{s.body}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* ── EVIDENCE ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="ev-h" className="grid grid-cols-1 md:grid-cols-[5fr_7fr] items-start" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(48px,6vw,88px) 16px', gap: 'clamp(28px,4vw,56px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={EYEBROW}>Evidence first</span>
          <h2 id="ev-h" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(28px,4vw,40px)', lineHeight: 1.1, letterSpacing: '-.02em', textWrap: 'balance' }}>Every reading shows its working.</h2>
          <div style={{ marginTop: 8, background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={EYEBROW}>Reading</span>
              <span style={{ ...MONO_CAP, fontWeight: 500, color: 'var(--faint)', border: '1px dashed var(--faint)', borderRadius: 4, padding: '1px 6px' }}>STATUS</span>
            </div>
            <span style={{ font: '400 14px Inter,sans-serif', color: 'var(--faint)' }}>Not enough data yet</span>
            <div style={{ paddingTop: 10, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>
              <span>Why? · evidence</span><span>sample —</span>
            </div>
          </div>
          <span style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>A reading with too little evidence says so, instead of guessing.</span>
        </div>
        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)]" style={{ gap: '6px 24px', padding: '18px 0', borderTop: '1px solid var(--line)' }}>
              <dt style={{ font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>{p.title}</dt>
              <dd style={{ margin: 0, font: '400 14px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>{p.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── AUDIENCE ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="aud-h" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(36px,4vw,56px) 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <h2 id="aud-h" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(22px,2.6vw,28px)', letterSpacing: '-.01em' }}>Built for people who read football closely</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 1, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
            {AUDIENCE.map((a) => (
              <li key={a.who} style={{ background: 'var(--ink)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ ...MONO_CAP, fontWeight: 500, color: 'var(--text)' }}>{a.who}</span>
                <span style={{ font: '400 14px/1.5 Inter,sans-serif', color: 'var(--text-secondary)' }}>{a.what}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── PRICING BRIDGE ───────────────────────────────────────────────────── */}
      <section aria-labelledby="price-h" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(48px,6vw,88px) 16px' }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[1.3fr_1fr_1fr]" style={{ gap: 12, alignItems: 'stretch' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 12px 4px 0' }}>
            <span style={EYEBROW}>Access</span>
            <h2 id="price-h" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,32px)', lineHeight: 1.15, letterSpacing: '-.015em' }}>Choose how deep you go</h2>
            <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>Different levels of access open different depths of the product. Plans and details are on the pricing page.</p>
            {/* Pricing page (B3) is not built yet — non-interactive until that phase. */}
            <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 16px', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4, ...MONO_CAP, fontWeight: 500, color: 'var(--faint)', cursor: 'default' }}>View pricing →</span>
          </div>
          {TIERS.map((t) => (
            <div key={t.name} className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ alignSelf: 'flex-start', ...MONO_CAP, fontWeight: 500, color: t.chipColor, background: t.chipBg, border: `1px solid ${t.chipBorder}`, borderRadius: 4, padding: '1px 6px' }}>{t.chip}</span>
              <h3 style={{ margin: 0, font: '600 17px Inter,sans-serif', color: 'var(--text)' }}>{t.name}</h3>
              <p style={{ margin: 0, font: '400 14px/1.55 Inter,sans-serif', color: 'var(--text-secondary)' }}>{t.body}</p>
              <span style={{ marginTop: 'auto', font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>Price and inclusions defined in Pricing</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="cta-h" style={{ background: 'var(--panel)', borderTop: '1px solid var(--amber-dim)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(56px,7vw,104px) 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 18 }}>
          <h2 id="cta-h" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(32px,5vw,52px)', lineHeight: 1.05, letterSpacing: '-.025em', textWrap: 'balance' }}>See what the evidence says.</h2>
          <p style={{ margin: 0, font: '400 16px/1.6 Inter,sans-serif', color: 'var(--text-secondary)', maxWidth: 520 }}>Start with the fixtures and follow the evidence into any match.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            <Link href={appHref} style={{ ...CTA_AMBER, minHeight: 48, padding: '0 24px', fontSize: 12 }}>Explore fixtures</Link>
            {/* Pricing (B3) not built yet — non-interactive until that phase. */}
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '0 24px', background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, ...MONO_CAP, fontWeight: 500, fontSize: 12, color: 'var(--faint)', cursor: 'default' }}>View pricing</span>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer style={{ maxWidth: 1152, margin: '0 auto', padding: '40px 16px 32px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div className="grid grid-cols-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]" style={{ gap: '28px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="col-span-2 md:col-span-1">
            <span style={{ font: '700 15px Inter,sans-serif', color: 'var(--text)' }}>Pitch<span style={{ color: 'var(--amber)' }}>Terminal</span></span>
            <span style={EYEBROW}>Football Intelligence</span>
          </div>
          {/* Product (Features/Pricing) → B2/B3, not built: non-interactive. */}
          <nav aria-label="Product" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>Product</span>
            <SoonText>Features</SoonText>
            <SoonText>Pricing</SoonText>
          </nav>
          {/* Explore → live app surfaces (real links). */}
          <nav aria-label="Explore" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>Explore</span>
            <Link href={appHref} style={{ font: '400 13px Inter,sans-serif', color: 'var(--text-secondary)', textDecoration: 'none' }}>Fixtures</Link>
            <Link href={appHref} style={{ font: '400 13px Inter,sans-serif', color: 'var(--text-secondary)', textDecoration: 'none' }}>Competitions</Link>
            <Link href={routes.teams()} style={{ font: '400 13px Inter,sans-serif', color: 'var(--text-secondary)', textDecoration: 'none' }}>Teams</Link>
            <Link href={routes.players()} style={{ font: '400 13px Inter,sans-serif', color: 'var(--text-secondary)', textDecoration: 'none' }}>Players</Link>
          </nav>
          {/* Account (Log in/Sign up) → B4/B5, not built: non-interactive. */}
          <nav aria-label="Account" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>Account</span>
            <SoonText>Log in</SoonText>
            <SoonText>Sign up</SoonText>
          </nav>
          {/* Legal (Terms/Privacy) → B8, not built: non-interactive. */}
          <nav aria-label="Legal" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>Legal</span>
            <SoonText>Terms</SoonText>
            <SoonText>Privacy</SoonText>
          </nav>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, paddingTop: 16, borderTop: '1px solid var(--line)', font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>
          <span>© PitchTerminal</span><span>Football intelligence. Not betting advice.</span>
        </div>
      </footer>
    </main>
  );
}
