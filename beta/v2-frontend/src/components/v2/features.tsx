// PUBLIC FEATURES / INTELLIGENCE PAGE (B2) — presentational, static, DB-free (SSR).
//
// A faithful implementation of the Claude Design Features wireframe
// (docs/frontend-design/wireframes/project/FeaturesPage.dc.html; spec
// "Features Page.dc.html" for intent). It reuses the Phase A design system and the
// shared marketing primitives (components/v2/marketing.tsx) — no new palette, no
// second design language. It is a public explanatory page: no API calls, no runtime
// calculation, no invented metrics. Product illustrations use recorded reference
// data (a picture of the real UI grammar), never fabricated live figures.
//
// Positioning is football INTELLIGENCE — evidence-first, pre-match. The framework
// vocabulary (Fixture / Performance / Readiness / Context / History / Intelligence,
// with Evidence under every step) is the design's own; no module is invented or
// renamed. "Readings interpret evidence. They do not predict results."
//
// The "In practice" workflow references the SHIPPED 5-tab Match workspace (Overview
// absorbed the former Comparison/Form/H2H; Venue folds into Overview/header), not the
// wireframe's older tab names.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { EYEBROW, MONO_CAP, CTA_AMBER, CTA_GHOST, FormBadgeRow, MarketingFooter } from '@/components/v2/marketing';

// ── static content (design reference data) ───────────────────────────────────────

const FRAMEWORK: readonly { label: string; q: string }[] = [
  { label: 'Fixture', q: 'What is the match?' },
  { label: 'Performance', q: 'How have they been playing?' },
  { label: 'Readiness', q: 'How ready are they?' },
  { label: 'Context', q: 'What surrounds it?' },
  { label: 'History', q: 'What has happened before?' },
  { label: 'Intelligence', q: 'What does it add up to?' },
];

const INDEX: readonly { label: string; href: string }[] = [
  { label: 'Fixtures & results', href: '#fixtures' },
  { label: 'Team performance', href: '#performance' },
  { label: 'Readiness', href: '#readiness' },
  { label: 'Match context', href: '#context' },
  { label: 'Historical patterns', href: '#history' },
  { label: 'Statistical attributes', href: '#attributes' },
  { label: 'Match intelligence', href: '#intelligence' },
];

const FX_POINTS = [
  'A date strip to step backwards through results or forwards through the schedule.',
  'Matches grouped by competition, with status in words as well as colour.',
  'Every fixture opens into its match workspace.',
];
const FX_DATES: readonly { label: string; on: boolean }[] = [
  { label: 'Sat 5 Sep', on: false }, { label: 'Sun 6 Sep', on: true }, { label: 'Mon 7 Sep', on: false }, { label: 'Sat 12 Sep', on: false },
];
type FxRow = { time: string; home: string; away: string; hs: number | null; as: number | null; status: string };
const FX_GROUPS: readonly { label: string; count: string; rows: FxRow[] }[] = [
  { label: 'Brasileirão Betano · Sun 6 Sep', count: '6', rows: [
    { time: '16:00', home: 'Internacional', away: 'Santos', hs: 2, as: 3, status: 'FT' },
    { time: '16:00', home: 'Cruzeiro', away: 'Athletico', hs: 3, as: 1, status: 'FT' },
    { time: '18:30', home: 'Botafogo', away: 'Palmeiras', hs: 0, as: 0, status: 'FT' },
  ] },
  { label: 'Brasileirão Betano · Sat 12 Sep', count: '6', rows: [
    { time: '16:00', home: 'Grêmio', away: 'Vasco da Gama', hs: null, as: null, status: 'SCHEDULED' },
    { time: '18:30', home: 'Palmeiras', away: 'São Paulo', hs: null, as: null, status: 'SCHEDULED' },
  ] },
];

const READINESS: readonly { k: string; a: string; b: string; faint?: boolean }[] = [
  { k: 'Days since last match', a: '13', b: '14' },
  { k: 'Matches in previous 28 days', a: '2', b: '2' },
  { k: 'Travel', a: '—', b: '—', faint: true },
];
const VENUE_FORM: readonly { team: string; label: string; seq: string }[] = [
  { team: 'Botafogo', label: 'Last 5 at home', seq: 'WWDDL' },
  { team: 'Palmeiras', label: 'Last 5 away', seq: 'DWWWL' },
];

type HistCell = { w: number; d: number; l: number };
const HISTORY: readonly { team: string; afterWin: HistCell; afterLoss: HistCell }[] = [
  { team: 'Botafogo', afterWin: { w: 1, d: 5, l: 2 }, afterLoss: { w: 3, d: 1, l: 4 } },
  { team: 'Palmeiras', afterWin: { w: 9, d: 3, l: 2 }, afterLoss: { w: 3, d: 0, l: 0 } },
];

const ATTRS: readonly { label: string; a: string; b: string }[] = [
  { label: 'Goals scored per match', a: '1.67', b: '1.73' },
  { label: 'Goals conceded per match', a: '1.57', b: '0.73' },
];
const FACTORS = ['Form', 'Readiness', 'Context', 'History'];

const TRUST: readonly { kind: string; title: string; body: string; example: string; amber?: boolean }[] = [
  { kind: 'OBSERVED', title: 'What happened', body: 'Recorded facts: fixtures, kickoffs, results and tables.', example: 'Palmeiras 4 – 1 Vasco da Gama · 23 Aug' },
  { kind: 'DERIVED', title: 'Worked out from it', body: 'Simple calculations on those facts, shown with how they were made.', example: 'Last 5: W D L W D' },
  { kind: 'CONTEXT', title: 'Placed against the match', body: 'The same facts read for one fixture: rest, venue and standing.', example: '14 days since last match' },
  { kind: 'INTELLIGENCE', title: 'What it means', body: 'An interpretation, always labelled and always citing the evidence above.', example: 'Reading · Form · cites 5 results', amber: true },
];

// "where" references reconciled to the shipped 5-tab Match workspace.
const WORKFLOW: readonly { step: string; body: string; where: string }[] = [
  { step: 'Find a fixture', body: 'Choose a day and a competition.', where: 'Fixtures' },
  { step: 'Review the teams', body: 'Open the match to see both sides.', where: 'Match · Overview' },
  { step: 'Check recent performance', body: 'Compare form result by result.', where: 'Match · Overview' },
  { step: 'Understand readiness and context', body: 'Rest, schedule, venue and standing.', where: 'Match · Overview' },
  { step: 'Review historical patterns', body: 'Previous meetings and how each side responds.', where: 'Match · Overview' },
  { step: 'Explore match intelligence', body: 'Readings with their evidence.', where: 'Match · Intelligence' },
];

const AUDIENCE: readonly { who: string; what: string }[] = [
  { who: 'Analysts', what: 'Compare two sides on form, rest and history in one place, with the numbers behind each view.' },
  { who: 'Scouts', what: 'See a team’s tendencies in context: at home, away, after a win or a loss.' },
  { who: 'Journalists', what: 'Check a claim against recorded results before it goes into a preview.' },
  { who: 'Serious followers', what: 'Go past the score to understand why a match might unfold the way it does.' },
];

// ── small local renderers ────────────────────────────────────────────────────────

function HistoryBar({ cell }: { cell: HistCell }) {
  const n = cell.w + cell.d + cell.l;
  const pct = (x: number) => (n === 0 ? '0%' : `${(x / n) * 100}%`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', height: 8, borderRadius: 2, overflow: 'hidden', background: 'var(--raised)' }} aria-hidden>
        <span style={{ width: pct(cell.w), background: 'var(--edge)' }} />
        <span style={{ width: pct(cell.d), background: 'var(--muted)' }} />
        <span style={{ width: pct(cell.l), background: 'var(--risk)' }} />
      </div>
      <div style={{ display: 'flex', gap: 10, font: "500 12px 'JetBrains Mono',monospace", color: 'var(--text-secondary)' }}>
        <span>W {cell.w}</span><span>D {cell.d}</span><span>L {cell.l}</span><span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>n {n}</span>
      </div>
    </div>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────

export function FeaturesPage() {
  const appHref = routes.leagues();
  return (
    <main>
      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="f-hero" className="grid grid-cols-1 md:grid-cols-[7fr_5fr] items-end"
        style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(40px,6vw,88px) 16px clamp(36px,5vw,64px)', gap: 'clamp(28px,4vw,64px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <span style={EYEBROW}>Features · how PitchTerminal works</span>
          <h1 id="f-hero" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(34px,6vw,56px)', lineHeight: 1.04, letterSpacing: '-.025em', textWrap: 'balance' }}>Understand the match before the match.</h1>
          <p style={{ margin: 0, font: '400 16px/1.6 Inter,sans-serif', color: 'var(--text-secondary)', maxWidth: 560 }}>A fixture is where the story starts. PitchTerminal connects it to how each team has been playing, how ready they are, what surrounds the game and what has happened before, all in one workspace.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Link href={appHref} style={CTA_AMBER}>Explore fixtures</Link>
            <a href="#framework" style={CTA_GHOST}>See how it works</a>
          </div>
        </div>
        <nav aria-label="On this page" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 4, padding: '6px 8px' }}>
          <div style={{ padding: '8px 8px 6px', font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>On this page</div>
          {INDEX.map((i, n) => (
            <a key={i.href} href={i.href} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 10, alignItems: 'center', minHeight: 40, padding: '0 8px', borderRadius: 4, textDecoration: 'none' }}>
              <span style={{ font: "500 10px 'JetBrains Mono',monospace", color: 'var(--muted)' }}>{String(n + 1).padStart(2, '0')}</span>
              <span style={{ font: '500 14px Inter,sans-serif', color: 'var(--text)' }}>{i.label}</span>
              <span aria-hidden style={{ font: "400 12px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>↓</span>
            </a>
          ))}
        </nav>
      </section>

      {/* ── FRAMEWORK ────────────────────────────────────────────────────────── */}
      <section id="framework" aria-labelledby="f-fw" style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(40px,5vw,72px) 16px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
            <span style={EYEBROW}>The framework</span>
            <h2 id="f-fw" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,34px)', lineHeight: 1.15, letterSpacing: '-.015em' }}>Six questions, in order</h2>
            <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>Football produces more information than anyone can read raw. PitchTerminal organises it into six questions you can answer one after another, so each layer builds on the one before.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ol className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-6" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
              {FRAMEWORK.map((s, i) => {
                const last = i === FRAMEWORK.length - 1;
                return (
                  <li key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 4, background: last ? 'var(--raised)' : 'var(--ink)', border: `1px solid ${last ? 'var(--amber-dim)' : 'var(--line)'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ font: "600 10px 'JetBrains Mono',monospace", letterSpacing: '.12em', textTransform: 'uppercase', color: last ? 'var(--amber)' : 'var(--muted)' }}>{String(i + 1).padStart(2, '0')} · {s.label}</span>
                      <span aria-hidden style={{ font: "400 13px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>{last ? '' : '→'}</span>
                    </div>
                    <h3 style={{ margin: 0, font: '600 15px/1.3 Inter,sans-serif', color: 'var(--text)' }}>{s.q}</h3>
                  </li>
                );
              })}
            </ol>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', border: '1px dashed var(--line)', borderRadius: 4, background: 'var(--ink)' }}>
              <span style={{ font: "600 10px 'JetBrains Mono',monospace", letterSpacing: '.12em', color: 'var(--cool)' }}>EVIDENCE</span>
              <span style={{ font: '400 13px Inter,sans-serif', color: 'var(--text-secondary)' }}>runs under every step: each layer shows the recorded matches it comes from.</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 01 FIXTURES & RESULTS ────────────────────────────────────────────── */}
      <section id="fixtures" aria-labelledby="f-c1" className="grid grid-cols-1 md:grid-cols-[5fr_7fr] items-center"
        style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(48px,6vw,88px) 16px clamp(24px,3vw,40px)', gap: 'clamp(24px,4vw,56px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ ...MONO_CAP, fontWeight: 600, letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'none' }}>01 · FIXTURE</span>
          <h2 id="f-c1" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,32px)', lineHeight: 1.15, letterSpacing: '-.015em' }}>Fixtures &amp; results</h2>
          <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>Move through the calendar a day at a time. Each day groups matches by competition, with kickoff time, status and the final score once the match is played.</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FX_POINTS.map((p) => (
              <li key={p} style={{ display: 'flex', gap: 10, font: '400 14px/1.5 Inter,sans-serif', color: 'var(--text-secondary)' }}>
                <span aria-hidden style={{ color: 'var(--faint)', fontFamily: "'JetBrains Mono',monospace" }}>—</span>{p}
              </li>
            ))}
          </ul>
        </div>
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div className="panel" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 6, padding: 10, borderBottom: '1px solid var(--line)', overflowX: 'auto' }} className="no-scrollbar">
              {FX_DATES.map((d) => (
                <span key={d.label} style={{ flex: 'none', ...MONO_CAP, padding: '5px 10px', borderRadius: 4, background: d.on ? 'var(--amber)' : 'transparent', color: d.on ? 'var(--ink)' : 'var(--muted)', border: `1px solid ${d.on ? 'var(--amber)' : 'var(--line)'}` }}>{d.label}</span>
              ))}
            </div>
            {FX_GROUPS.map((g) => (
              <div key={g.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 14px', background: 'var(--raised)', borderBottom: '1px solid var(--line)', borderTop: '1px solid var(--line)', font: "400 9.6px 'JetBrains Mono',monospace", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                  <span>{g.label}</span><span style={{ color: 'var(--faint)' }}>{g.count}</span>
                </div>
                {g.rows.map((r) => {
                  const done = r.hs !== null && r.as !== null;
                  const statusColor = r.status === 'FT' ? 'var(--muted)' : 'var(--cool)';
                  return (
                    <div key={`${r.home}-${r.time}`} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) 52px minmax(0,1fr) 82px', gap: 10, alignItems: 'center', height: 38, padding: '0 14px', borderTop: '1px solid var(--line)' }}>
                      <span style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--muted)' }}>{r.time}</span>
                      <span style={{ fontFamily: 'Inter,sans-serif', fontSize: 13, textAlign: 'right', fontWeight: done && (r.hs as number) > (r.as as number) ? 600 : 500, color: done && (r.hs as number) < (r.as as number) ? 'var(--text-secondary)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.home}</span>
                      <span style={{ textAlign: 'center', font: "600 12px 'JetBrains Mono',monospace", color: done ? 'var(--text)' : 'var(--faint)' }}>{done ? `${r.hs} – ${r.as}` : '–'}</span>
                      <span style={{ fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: done && (r.as as number) > (r.hs as number) ? 600 : 500, color: done && (r.as as number) < (r.hs as number) ? 'var(--text-secondary)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.away}</span>
                      <span style={{ justifySelf: 'end', font: "500 9px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: statusColor, border: `1px solid ${statusColor}`, borderRadius: 4, padding: '1px 5px' }}>{r.status}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <figcaption style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>Recorded fixtures · Brasileirão Betano 2026 · times BRT</figcaption>
        </figure>
      </section>

      {/* ── 02 TEAM PERFORMANCE ──────────────────────────────────────────────── */}
      <section id="performance" aria-labelledby="f-c2" className="grid grid-cols-1 md:grid-cols-[7fr_5fr] items-center"
        style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(24px,3vw,40px) 16px', gap: 'clamp(24px,4vw,56px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} className="md:order-2">
          <span style={{ ...MONO_CAP, fontWeight: 600, letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'none' }}>02 · PERFORMANCE</span>
          <h2 id="f-c2" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,32px)', lineHeight: 1.15, letterSpacing: '-.015em' }}>Team performance</h2>
          <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>See how each side has actually been playing, set side by side. Recent form is shown result by result, with the home side on the left and the away side on the right, so a comparison reads at a glance.</p>
          <p style={{ margin: 0, font: '400 13px/1.5 Inter,sans-serif', color: 'var(--muted)' }}>Each result carries its word as well as its colour: Win, Draw, Loss.</p>
        </div>
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }} className="md:order-1">
          <div className="panel" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--line)', font: '600 13px Inter,sans-serif' }}>
              <span style={{ textAlign: 'right' }}>Botafogo</span>
              <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--faint)', alignSelf: 'center' }}>V</span>
              <span>Palmeiras</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px minmax(0,1fr)', gap: 12, alignItems: 'center', minHeight: 48, padding: '0 14px', borderTop: '1px solid var(--line)' }}>
              <FormBadgeRow seq="WDLLD" align="right" />
              <span style={{ textAlign: 'center', ...MONO_CAP, fontWeight: 400, color: 'var(--muted)' }}>Last 5</span>
              <FormBadgeRow seq="WDLWD" />
            </div>
          </div>
          <figcaption style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>Oldest → latest · recorded results to 6 Sep 2026</figcaption>
        </figure>
      </section>

      {/* ── 03/04 READINESS + CONTEXT ────────────────────────────────────────── */}
      <section aria-label="Readiness and match context" className="grid grid-cols-1 md:grid-cols-2"
        style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(24px,3vw,40px) 16px', gap: 12 }}>
        <article id="readiness" aria-labelledby="f-c3" className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ ...MONO_CAP, fontWeight: 600, letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'none' }}>03 · READINESS</span>
          <h2 id="f-c3" style={{ margin: 0, font: '700 22px/1.2 Inter,sans-serif' }}>Readiness</h2>
          <p style={{ margin: 0, font: '400 14px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>How much a team has had to carry into a match: the rest since its last game, how crowded its recent schedule has been and how far it has had to travel.</p>
          <dl style={{ margin: '4px 0 0', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 72px 72px', gap: 8, padding: '0 0 8px', font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>
              <span /><span style={{ textAlign: 'right' }}>BOT</span><span style={{ textAlign: 'right' }}>PAL</span>
            </div>
            {READINESS.map((r) => (
              <div key={r.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 72px 72px', gap: 8, alignItems: 'center', minHeight: 38, borderTop: '1px solid var(--line)' }}>
                <dt style={{ font: '400 13px Inter,sans-serif', color: 'var(--muted)' }}>{r.k}</dt>
                <dd style={{ margin: 0, textAlign: 'right', font: "500 13px 'JetBrains Mono',monospace", color: r.faint ? 'var(--faint)' : 'var(--text)' }}>{r.a}</dd>
                <dd style={{ margin: 0, textAlign: 'right', font: "500 13px 'JetBrains Mono',monospace", color: r.faint ? 'var(--faint)' : 'var(--text)' }}>{r.b}</dd>
              </div>
            ))}
          </dl>
          <span style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>Before Botafogo v Palmeiras, 6 Sep · travel shown as — until covered</span>
        </article>
        <article id="context" aria-labelledby="f-c4" className="panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ ...MONO_CAP, fontWeight: 600, letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'none' }}>04 · CONTEXT</span>
          <h2 id="f-c4" style={{ margin: 0, font: '700 22px/1.2 Inter,sans-serif' }}>Match context</h2>
          <p style={{ margin: 0, font: '400 14px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>What surrounds the score: how each side does at this kind of venue, where they sit in the competition and the circumstances of the fixture.</p>
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column' }}>
            {VENUE_FORM.map((v) => (
              <div key={v.team} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center', minHeight: 48, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ font: '500 13px Inter,sans-serif', color: 'var(--text)' }}>{v.team}</span>
                  <span style={{ ...MONO_CAP, fontWeight: 400, color: 'var(--muted)' }}>{v.label}</span>
                </div>
                <FormBadgeRow seq={v.seq} />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center', minHeight: 48, borderTop: '1px solid var(--line)' }}>
              <span style={{ font: '400 13px Inter,sans-serif', color: 'var(--muted)' }}>Table position · as of 11 Aug</span>
              <span style={{ font: "500 13px 'JetBrains Mono',monospace", color: 'var(--text)' }}>9th · 1st</span>
            </div>
          </div>
          <span style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>Last 5 home / last 5 away · oldest → latest</span>
        </article>
      </section>

      {/* ── 05 HISTORICAL PATTERNS ───────────────────────────────────────────── */}
      <section id="history" aria-labelledby="f-c5" className="grid grid-cols-1 md:grid-cols-[5fr_7fr] items-center"
        style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(24px,3vw,40px) 16px', gap: 'clamp(24px,4vw,56px)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ ...MONO_CAP, fontWeight: 600, letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'none' }}>05 · HISTORY</span>
          <h2 id="f-c5" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,32px)', lineHeight: 1.15, letterSpacing: '-.015em' }}>Historical patterns</h2>
          <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>How a team has responded before. After a win, did it keep going? After a loss, did it recover? PitchTerminal counts what actually followed, match by match.</p>
          <p style={{ margin: 0, font: '400 13px/1.5 Inter,sans-serif', color: 'var(--muted)' }}>These are counts of what happened, with the number of matches behind them. They describe the past; they are not forecasts.</p>
        </div>
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div className="panel" style={{ padding: '6px 14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr) minmax(0,1fr)', gap: 16, padding: '8px 0', font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              <span /><span>Next match after a win</span><span>Next match after a loss</span>
            </div>
            {HISTORY.map((h) => (
              <div key={h.team} style={{ display: 'grid', gridTemplateColumns: '96px minmax(0,1fr) minmax(0,1fr)', gap: 16, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ font: '600 13px Inter,sans-serif', color: 'var(--text)' }}>{h.team}</span>
                <HistoryBar cell={h.afterWin} />
                <HistoryBar cell={h.afterLoss} />
              </div>
            ))}
          </div>
          <figcaption style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>This season&apos;s recorded results up to 6 Sep 2026 · n = matches counted</figcaption>
        </figure>
      </section>

      {/* ── 06 STATISTICAL ATTRIBUTES ────────────────────────────────────────── */}
      <section id="attributes" aria-labelledby="f-c6" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(24px,3vw,40px) 16px clamp(40px,5vw,72px)' }}>
        <div className="grid grid-cols-1 md:grid-cols-[4fr_5fr_3fr] items-center" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', padding: '24px 0', gap: '20px 32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ ...MONO_CAP, fontWeight: 600, letterSpacing: '.12em', color: 'var(--muted)', textTransform: 'none' }}>SUPPORTS 02–04</span>
            <h2 id="f-c6" style={{ margin: 0, font: '700 22px/1.2 Inter,sans-serif' }}>Statistical attributes</h2>
            <p style={{ margin: 0, font: '400 14px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>Descriptive tendencies that characterise a team, set against the same measure for its opponent.</p>
          </div>
          <div className="grid grid-cols-2" style={{ gap: 8 }}>
            {ATTRS.map((a) => (
              <div key={a.label} className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>{a.label}</span>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ font: "600 20px 'JetBrains Mono',monospace", color: 'var(--text)' }}>{a.a}</span>
                  <span style={{ font: "400 10px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>BOT · PAL</span>
                  <span style={{ font: "600 20px 'JetBrains Mono',monospace", color: 'var(--text)' }}>{a.b}</span>
                </div>
              </div>
            ))}
          </div>
          <span style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>From the table as of 11 Aug 2026 · goals ÷ matches played</span>
        </div>
      </section>

      {/* ── 07 MATCH INTELLIGENCE ────────────────────────────────────────────── */}
      <section id="intelligence" aria-labelledby="f-c7" style={{ background: 'var(--raised)', borderTop: '1px solid var(--amber-dim)', borderBottom: '1px solid var(--line)' }}>
        <div className="grid grid-cols-1 md:grid-cols-[5fr_7fr] items-center" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(48px,6vw,88px) 16px', gap: 'clamp(24px,4vw,56px)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ ...MONO_CAP, fontWeight: 600, letterSpacing: '.12em', color: 'var(--amber)', textTransform: 'none' }}>06 · INTELLIGENCE</span>
            <h2 id="f-c7" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(26px,4vw,38px)', lineHeight: 1.1, letterSpacing: '-.02em' }}>Match intelligence</h2>
            <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>Everything above comes together here. Each factor (form, readiness, context, history) gets a reading that states which way its evidence points, a short plain-language verdict and the matches it rests on.</p>
            <p style={{ margin: 0, font: '400 14px/1.6 Inter,sans-serif', color: 'var(--muted)' }}>Readings interpret evidence. They do not predict results.</p>
          </div>
          <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <div className="panel" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {FACTORS.map((f) => (
                <div key={f} style={{ background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4, padding: 12, display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) auto', gap: 12, alignItems: 'center' }}>
                  <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>{f}</span>
                  <span style={{ height: 8, borderRadius: 2, background: 'var(--line)' }} aria-hidden />
                  <span style={{ font: "500 9px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--faint)', border: '1px dashed var(--faint)', borderRadius: 4, padding: '1px 5px' }}>DIRECTION</span>
                </div>
              ))}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', padding: '8px 4px 2px', font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>
                <span>Direction:</span><span style={{ color: 'var(--edge)' }}>SUPPORTS</span><span style={{ color: 'var(--muted)' }}>NEUTRAL</span><span style={{ color: 'var(--risk)' }}>CONTRADICTS</span><span>· each with verdict, sample and “Why?”</span>
              </div>
            </div>
            <figcaption style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>Structure of a match reading · values appear in the product</figcaption>
          </figure>
        </div>
      </section>

      {/* ── EVIDENCE ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="f-trust" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(48px,6vw,88px) 16px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 700 }}>
          <span style={EYEBROW}>Evidence</span>
          <h2 id="f-trust" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(26px,4vw,38px)', lineHeight: 1.1, letterSpacing: '-.02em', textWrap: 'balance' }}>What happened, kept apart from what it means.</h2>
          <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>PitchTerminal always shows which kind of information you&apos;re looking at. Recorded facts come first. Anything worked out from them is labelled as such.</p>
        </div>
        <ol className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 1, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
          {TRUST.map((t, i) => {
            const last = i === TRUST.length - 1;
            return (
              <li key={t.kind} style={{ background: t.amber ? 'var(--panel)' : 'var(--ink)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ font: "600 10px 'JetBrains Mono',monospace", letterSpacing: '.12em', color: t.amber ? 'var(--amber)' : 'var(--text-secondary)' }}>{t.kind}</span>
                  <span aria-hidden style={{ font: "400 13px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>{last ? '' : '→'}</span>
                </div>
                <h3 style={{ margin: 0, font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>{t.title}</h3>
                <p style={{ margin: 0, font: '400 13px/1.5 Inter,sans-serif', color: 'var(--text-secondary)' }}>{t.body}</p>
                <div style={{ marginTop: 'auto', padding: '8px 10px', borderRadius: 4, background: 'var(--ink)', border: '1px solid var(--line)', font: "500 12px 'JetBrains Mono',monospace", color: 'var(--text)' }}>{t.example}</div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── WORKFLOW ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="f-flow" style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <div className="grid grid-cols-1 md:grid-cols-[4fr_8fr] items-start" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(48px,6vw,80px) 16px', gap: 'clamp(24px,4vw,56px)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={EYEBROW}>In practice</span>
            <h2 id="f-flow" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,32px)', lineHeight: 1.15, letterSpacing: '-.015em' }}>One match, six clicks deep</h2>
            <p style={{ margin: 0, font: '400 15px/1.6 Inter,sans-serif', color: 'var(--text-secondary)' }}>A typical route from the fixture list to a full read of a match.</p>
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {WORKFLOW.map((w, i) => {
              const last = i === WORKFLOW.length - 1;
              return (
                <li key={w.step} className="grid grid-cols-[36px_minmax(0,1fr)] md:grid-cols-[36px_minmax(0,1fr)_200px]" style={{ gap: '6px 16px', alignItems: 'baseline', padding: '14px 0', borderTop: '1px solid var(--line)' }}>
                  <span style={{ font: "600 11px 'JetBrains Mono',monospace", color: last ? 'var(--amber)' : 'var(--muted)' }}>{String(i + 1).padStart(2, '0')}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>{w.step}</span>
                    <span style={{ font: '400 13px/1.5 Inter,sans-serif', color: 'var(--text-secondary)' }}>{w.body}</span>
                  </div>
                  <span className="col-start-2 md:col-start-3" style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>{w.where}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* ── AUDIENCE ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="f-aud" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(48px,6vw,80px) 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h2 id="f-aud" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(22px,2.6vw,28px)', letterSpacing: '-.01em' }}>How people use it</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2" style={{ margin: 0, gap: '0 40px' }}>
          {AUDIENCE.map((a) => (
            <div key={a.who} className="grid grid-cols-1 md:grid-cols-[110px_minmax(0,1fr)]" style={{ gap: '4px 20px', padding: '16px 0', borderTop: '1px solid var(--line)' }}>
              <dt style={{ font: "500 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text)', paddingTop: 3 }}>{a.who}</dt>
              <dd style={{ margin: 0, font: '400 14px/1.55 Inter,sans-serif', color: 'var(--text-secondary)' }}>{a.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="f-cta" style={{ background: 'var(--panel)', borderTop: '1px solid var(--amber-dim)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(56px,7vw,104px) 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 18 }}>
          <h2 id="f-cta" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(32px,5vw,52px)', lineHeight: 1.05, letterSpacing: '-.025em', textWrap: 'balance' }}>Choose a fixture. Follow the evidence.</h2>
          <p style={{ margin: 0, font: '400 16px/1.6 Inter,sans-serif', color: 'var(--text-secondary)', maxWidth: 520 }}>Every layer on this page starts from the fixture list.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            <Link href={appHref} style={{ ...CTA_AMBER, minHeight: 48, padding: '0 24px', fontSize: 12 }}>Explore fixtures</Link>
            {/* Pricing (B3) not built yet — non-interactive until that phase. */}
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '0 24px', background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, ...MONO_CAP, fontWeight: 500, fontSize: 12, color: 'var(--faint)', cursor: 'default' }}>View pricing</span>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
