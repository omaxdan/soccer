// PUBLIC PRICING PAGE (B3) — presentational, static, DB-free (SSR).
//
// A faithful implementation of the Claude Design Pricing wireframe
// (docs/frontend-design/wireframes/project/PricingPage.dc.html; spec
// "Pricing Page.dc.html" for intent), reusing the Phase A design system and the
// shared marketing primitives — no new palette, no second design language.
//
// STRICT DATA DISCIPLINE: the wireframe is deliberately price-less. Guest is "No
// account"; Free/Pro/Elite are "Price TBD" with the billing period unspecified;
// every comparison entitlement is "◌ TBD"; commercial terms are "◌ PENDING"; FAQ
// answers are "◌ COMMERCIALLY PENDING". All of that is preserved verbatim. No price,
// discount, trial, billing term, feature limit, guarantee or payment provider is
// invented. No betting/odds/tips language.
//
// CTAs: Guest's "Explore" links to the live app; the paid plans' actions and the
// billing toggle depend on Sign up / Checkout (B5 / B6), which do not exist yet, so
// they are honest non-interactive "coming soon" states — never a fabricated flow.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { EYEBROW, MONO_CAP, CTA_AMBER, MarketingFooter } from '@/components/v2/marketing';

// ── static content (design source; entitlements intentionally unspecified) ────────

type Plan = { name: string; level: string; intent: string; cta: string; filled: number; guest?: boolean };
const PLANS: readonly Plan[] = [
  { name: 'Guest', level: 'LEVEL 1', intent: 'Look around PitchTerminal and its public football information without an account.', cta: 'Explore', filled: 1, guest: true },
  { name: 'Free', level: 'LEVEL 2', intent: 'A broader set of football information with a free account.', cta: 'Create account', filled: 2 },
  { name: 'Pro', level: 'LEVEL 3', intent: 'Deeper analytical and intelligence access.', cta: 'Choose Pro', filled: 3 },
  { name: 'Elite', level: 'LEVEL 4', intent: 'The highest level of product access.', cta: 'Choose Elite', filled: 4 },
];

const GROUPS: readonly { name: string; rows: { cap: string; future?: boolean }[] }[] = [
  { name: 'Football discovery', rows: [{ cap: 'Fixtures & results' }, { cap: 'Competitions & tables' }, { cap: 'Teams' }] },
  { name: 'Team & player analysis', rows: [{ cap: 'Team form & performance' }, { cap: 'Readiness' }, { cap: 'Statistical attributes' }, { cap: 'Player data' }] },
  { name: 'Match intelligence', rows: [{ cap: 'Match context' }, { cap: 'Match intelligence readings' }] },
  { name: 'Historical intelligence', rows: [{ cap: 'Historical patterns' }, { cap: 'Head-to-head' }] },
  { name: 'Advanced access', rows: [{ cap: 'Advanced analysis' }, { cap: 'API access', future: true }] },
];
const GROUP_NAMES = GROUPS.map((g) => g.name);

const TERMS = ['Billing frequency', 'Renewal', 'Cancellation', 'Payment', 'Access changes'];
const FAQ = [
  'What is included in each level?',
  'Is there a free option?',
  'Can I change level later?',
  'When does access change after I switch?',
  'How does billing work?',
  'Is API access included?',
];

const MATRIX_COLS = 'minmax(0,34fr) repeat(4, minmax(0,16.5fr))';

// ── small badges (design's dashed placeholder pills) ─────────────────────────────

function Tbd({ label = 'To be confirmed', text = '◌ TBD' }: { label?: string; text?: string }) {
  return (
    <span aria-label={label} style={{ font: "500 9px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--faint)', border: '1px dashed var(--faint)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>{text}</span>
  );
}

function DepthBars({ filled, label }: { filled: number; label: string }) {
  return (
    <span role="img" aria-label={label} style={{ display: 'flex', gap: 3 }}>
      {[0, 1, 2, 3].map((k) => (
        <span key={k} style={{ flex: 1, height: 4, borderRadius: 1, background: k < filled ? 'var(--muted)' : 'var(--line)' }} />
      ))}
    </span>
  );
}

const CARD_CTA_BASE: React.CSSProperties = {
  marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44,
  borderRadius: 4, font: "500 11px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', textDecoration: 'none',
};

// ── page ───────────────────────────────────────────────────────────────────────

export function PricingPage() {
  const appHref = routes.leagues();
  return (
    <main>
      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="p-hero" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(40px,5vw,72px) 16px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
        <span style={EYEBROW}>Pricing · access levels</span>
        <h1 id="p-hero" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(32px,5vw,50px)', lineHeight: 1.05, letterSpacing: '-.025em', textWrap: 'balance', maxWidth: 760 }}>Choose how deeply you explore the game.</h1>
        <p style={{ margin: 0, font: '400 16px/1.6 Inter,sans-serif', color: 'var(--text-secondary)', maxWidth: 560 }}>Four access levels, from a first look to the full depth of match intelligence. Each one is described in the same terms, so the differences are easy to see.</p>
        {/* Billing toggle is a placeholder until billing periods are specified (B6). */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 8 }}>
          <div role="radiogroup" aria-label="Billing period" aria-disabled="true" style={{ display: 'flex', border: '1px dashed var(--line)', borderRadius: 4, overflow: 'hidden', opacity: 0.7 }}>
            <span role="radio" aria-checked="true" style={{ ...MONO_CAP, padding: '7px 14px', color: 'var(--faint)', background: 'var(--panel)' }}>Period A</span>
            <span role="radio" aria-checked="false" style={{ ...MONO_CAP, padding: '7px 14px', color: 'var(--faint)', borderLeft: '1px dashed var(--line)' }}>Period B</span>
          </div>
          <span style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>Billing periods are shown once they are specified.</span>
        </div>
      </section>

      {/* ── PLANS ────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="p-plans" style={{ maxWidth: 1152, margin: '0 auto', padding: '0 16px clamp(40px,5vw,64px)' }}>
        <h2 id="p-plans" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Plans</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 12 }}>
          {PLANS.map((p) => (
            <li key={p.name} className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, font: '700 18px Inter,sans-serif', color: 'var(--text)' }}>{p.name}</h3>
                <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--faint)' }}>{p.level}</span>
              </div>
              <DepthBars filled={p.filled} label={`Access depth ${p.filled} of 4`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
                <span style={{ font: "600 22px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>{p.guest ? 'No account' : 'Price TBD'}</span>
                <span style={{ font: "400 11px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>{p.guest ? 'Access without signing up' : 'Billing period not yet specified'}</span>
              </div>
              <p style={{ margin: 0, font: '400 14px/1.5 Inter,sans-serif', color: 'var(--text-secondary)', minHeight: 42 }}>{p.intent}</p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {GROUP_NAMES.map((g) => (
                  <li key={g} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, font: '400 13px Inter,sans-serif', color: 'var(--text-secondary)' }}>
                    {g}<Tbd />
                  </li>
                ))}
              </ul>
              {p.guest ? (
                <Link href={appHref} style={{ ...CARD_CTA_BASE, background: 'var(--raised)', border: '1px solid var(--line)', color: 'var(--text)' }}>{p.cta}</Link>
              ) : (
                <span aria-disabled="true" style={{ ...CARD_CTA_BASE, background: 'var(--raised)', border: '1px dashed var(--line)', color: 'var(--faint)', cursor: 'default' }}>{p.cta}</span>
              )}
              <span style={{ font: "400 10px 'JetBrains Mono',monospace", color: 'var(--faint)', textAlign: 'center' }}>{p.guest ? 'Fixtures · no account' : 'Available soon'}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── COMPARISON ───────────────────────────────────────────────────────── */}
      <section aria-labelledby="p-cmp" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(40px,5vw,64px) 16px', display: 'flex', flexDirection: 'column', gap: 20, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={EYEBROW}>Compare</span>
            <h2 id="p-cmp" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-.015em' }}>What each level includes</h2>
          </div>
          <div aria-label="Legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, font: '400 12px Inter,sans-serif', color: 'var(--muted)' }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ font: "600 12px 'JetBrains Mono',monospace", color: 'var(--text)' }}>✓</span>Included</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ font: "600 12px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>—</span>Not included</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Tbd />To be confirmed</span>
          </div>
        </div>
        <div className="panel" style={{ overflowX: 'auto' }}>
          <div role="table" aria-label="Capabilities by access level. All entitlements to be confirmed." style={{ minWidth: 680 }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: MATRIX_COLS, alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
              <span role="columnheader" style={{ padding: '12px 16px', font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Capability</span>
              {PLANS.map((p) => (
                <span key={p.name} role="columnheader" style={{ textAlign: 'center', padding: '12px 8px', font: '600 13px Inter,sans-serif', color: 'var(--text)' }}>{p.name}</span>
              ))}
            </div>
            {GROUPS.map((g) => (
              <div role="rowgroup" key={g.name}>
                <div role="row" style={{ borderTop: '1px solid var(--line)', background: 'var(--raised)' }}>
                  <span role="rowheader" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', font: "500 10px 'JetBrains Mono',monospace", letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                    {g.name}<span style={{ color: 'var(--faint)' }}>{g.rows.length}</span>
                  </span>
                </div>
                {g.rows.map((r) => (
                  <div role="row" key={r.cap} style={{ display: 'grid', gridTemplateColumns: MATRIX_COLS, alignItems: 'center', borderTop: '1px solid var(--line)' }}>
                    <span role="rowheader" style={{ padding: '11px 16px', font: '400 14px Inter,sans-serif', color: 'var(--text-secondary)' }}>
                      {r.cap}{r.future && <span style={{ marginLeft: 8, font: "500 9px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--faint)' }}>FUTURE</span>}
                    </span>
                    {PLANS.map((p) => (
                      <span role="cell" key={p.name} style={{ textAlign: 'center', padding: '11px 8px' }}><Tbd label={`${p.name}: to be confirmed`} /></span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLAN EXPLANATIONS ────────────────────────────────────────────────── */}
      <section aria-labelledby="p-exp" className="grid grid-cols-1 md:grid-cols-[4fr_8fr]" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(24px,3vw,40px) 16px clamp(40px,5vw,64px)', gap: '24px 48px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={EYEBROW}>Levels explained</span>
          <h2 id="p-exp" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(22px,2.6vw,28px)', letterSpacing: '-.01em' }}>Which level fits how you use it</h2>
        </div>
        <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
          {PLANS.map((p) => (
            <div key={p.name} className="grid grid-cols-1 md:grid-cols-[140px_minmax(0,1fr)]" style={{ gap: '4px 20px', padding: '16px 0', borderTop: '1px solid var(--line)' }}>
              <dt style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>{p.name}</span>
                <span style={{ width: 48 }}><DepthBars filled={p.filled} label={`Access depth ${p.filled} of 4`} /></span>
              </dt>
              <dd style={{ margin: 0, font: '400 14px/1.55 Inter,sans-serif', color: 'var(--text-secondary)' }}>{p.intent}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── COMMERCIAL DETAILS ───────────────────────────────────────────────── */}
      <section aria-labelledby="p-terms" style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <div className="grid grid-cols-1 md:grid-cols-[4fr_8fr]" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(40px,5vw,64px) 16px', gap: '24px 48px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={EYEBROW}>The details</span>
            <h2 id="p-terms" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(22px,2.6vw,28px)', letterSpacing: '-.01em' }}>Billing and access, in plain terms</h2>
            <p style={{ margin: 0, font: '400 14px/1.6 Inter,sans-serif', color: 'var(--muted)' }}>Each policy will be stated here in one or two sentences, with a link to the full terms.</p>
          </div>
          <dl className="grid grid-cols-1 md:grid-cols-2" style={{ margin: 0, gap: 1, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
            {TERMS.map((t) => (
              <div key={t} style={{ background: 'var(--ink)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <dt style={{ font: "500 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text)' }}>{t}</dt>
                <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, font: '400 13px Inter,sans-serif', color: 'var(--faint)' }}>
                  <Tbd label="pending" text="◌ PENDING" />Not yet specified
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── FAQ (native details/summary — accessible, no client JS) ───────────── */}
      <section aria-labelledby="p-faq" className="grid grid-cols-1 md:grid-cols-[4fr_8fr]" style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(40px,5vw,64px) 16px', gap: '24px 48px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={EYEBROW}>Questions</span>
          <h2 id="p-faq" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(22px,2.6vw,28px)', letterSpacing: '-.01em' }}>Pricing questions</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--line)' }}>
          {FAQ.map((q) => (
            <details key={q} style={{ borderTop: '1px solid var(--line)' }}>
              <summary style={{ listStyle: 'none', minHeight: 52, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '0 4px', font: '500 15px Inter,sans-serif', color: 'var(--text)', cursor: 'pointer' }}>
                {q}
              </summary>
              <div style={{ padding: '0 4px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Tbd label="commercially pending" text="◌ COMMERCIALLY PENDING" />
                <span style={{ font: '400 13px Inter,sans-serif', color: 'var(--faint)' }}>Answer written once the policy is set.</span>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="p-cta" style={{ background: 'var(--panel)', borderTop: '1px solid var(--amber-dim)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: 'clamp(48px,6vw,88px) 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <h2 id="p-cta" style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(28px,4vw,44px)', lineHeight: 1.1, letterSpacing: '-.02em', textWrap: 'balance' }}>Not sure yet? Start with the fixtures.</h2>
          <p style={{ margin: 0, font: '400 16px/1.6 Inter,sans-serif', color: 'var(--text-secondary)', maxWidth: 520 }}>Look around first, then choose the level that fits.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            <Link href={appHref} style={{ ...CTA_AMBER, minHeight: 48, padding: '0 24px', fontSize: 12 }}>Explore fixtures</Link>
            <Link href={routes.features()} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '0 24px', background: 'transparent', border: '1px solid var(--line)', borderRadius: 4, ...MONO_CAP, fontWeight: 500, fontSize: 12, color: 'var(--text)', textDecoration: 'none' }}>How it works</Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
