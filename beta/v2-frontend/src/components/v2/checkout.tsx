// PUBLIC CHECKOUT PAGE (B6) — presentational, static, DB-free (SSR).
//
// A faithful, TRUTHFUL implementation of the Claude Design Checkout wireframe
// (docs/frontend-design/wireframes/project/CheckoutPage.dc.html; spec
// "Checkout Page.dc.html"), reusing the Phase A design system and shared marketing
// primitives — no new palette, no ecommerce visual language.
//
// Honesty guarantees (the design itself marks everything pending):
// - There is NO payment provider and NO billing backend (reconfirmed: no Stripe/etc.
//   dependency anywhere), and NO authentication (B4/B5 are UI-only). So this page
//   collects NO payment details, makes NO network request, creates NO checkout
//   session/subscription, charges NOTHING, and fabricates NO signed-in user.
// - Prices stay as B3 left them — TBD. No monetary amount is invented.
// - The prototype's simulated processing → failure → "Payment complete" success is
//   deliberately NOT reproduced (all fakes). The "Complete purchase" CTA is an honest
//   disabled/unavailable control, and the payment section is a "provider pending"
//   panel rather than fake card fields (nothing that could look like collecting card
//   data). "Change plan" links to the real Pricing page.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { EYEBROW, MONO_CAP } from '@/components/v2/marketing';

export type CheckoutPlan = 'Pro' | 'Elite';

const PLAN_INFO: Record<CheckoutPlan, { level: number; intent: string }> = {
  Pro: { level: 3, intent: 'Deeper analytical and intelligence access.' },
  Elite: { level: 4, intent: 'The highest level of product access.' },
};

function PendingBadge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ font: "600 8.5px 'JetBrains Mono',monospace", letterSpacing: '.08em', color: 'var(--warn)', border: '1px dashed var(--warn)', borderRadius: 3, padding: '1px 4px' }}>{children}</span>
  );
}

function DepthBars({ level }: { level: number }) {
  return (
    <span role="img" aria-label={`Access depth ${level} of 4`} style={{ display: 'flex', gap: 3, width: 96 }}>
      {[0, 1, 2, 3].map((k) => (
        <span key={k} style={{ flex: 1, height: 4, borderRadius: 1, background: k < level ? 'var(--muted)' : 'var(--line)' }} />
      ))}
    </span>
  );
}

const SECTION_H: React.CSSProperties = { margin: 0, font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' };

export function CheckoutPage({ plan }: { plan: CheckoutPlan }) {
  const info = PLAN_INFO[plan];
  const summary: readonly { k: string; v: string }[] = [
    { k: 'Plan', v: plan },
    { k: 'Billing period', v: 'Not yet specified' },
    { k: 'Subtotal', v: 'TBD' },
    { k: 'Taxes and fees', v: 'Pending' },
  ];
  const steps: readonly { label: string; state: 'done' | 'now' | 'todo' }[] = [
    { label: 'Plan', state: 'done' }, { label: 'Payment', state: 'now' }, { label: 'Confirmation', state: 'todo' },
  ];

  return (
    <main style={{ padding: 'clamp(24px,4vw,40px) 16px 64px' }}>
      <div style={{ maxWidth: 1008, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* top row: change-plan + progress */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <Link href={routes.pricing()} style={{ display: 'flex', alignItems: 'center', minHeight: 36, ...MONO_CAP, color: 'var(--muted)', textDecoration: 'none' }}>← Change plan</Link>
          <ol aria-label="Checkout progress" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, alignItems: 'center', ...MONO_CAP }}>
            {steps.map((s, i) => {
              const color = s.state === 'now' ? 'var(--text)' : s.state === 'done' ? 'var(--muted)' : 'var(--faint)';
              const border = s.state === 'now' ? 'var(--amber)' : 'var(--line)';
              return (
                <li key={s.label} aria-current={s.state === 'now' ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6, color }}>
                  <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${border}`, borderRadius: 3, fontSize: 9 }}>{s.state === 'done' ? '✓' : String(i + 1)}</span>
                  {s.label}{i < 2 && <span aria-hidden style={{ color: 'var(--line)', marginLeft: 2 }}>—</span>}
                </li>
              );
            })}
          </ol>
        </div>

        {/* honest unavailable banner — ties together the account, pricing and payment gaps */}
        <div role="note" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', border: '1px solid var(--warn)', borderRadius: 4, background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>
          <span aria-hidden style={{ flex: 'none', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--warn)', borderRadius: 3, font: "700 11px 'JetBrains Mono',monospace", color: 'var(--warn)' }}>!</span>
          <span style={{ font: '400 13px/1.5 Inter,sans-serif', color: 'var(--text)' }}>Checkout isn’t available yet. Accounts, prices and the payment provider are still being set up — nothing is charged and no payment details are collected here.</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[7fr_5fr]" style={{ gap: 16, alignItems: 'start' }}>
          {/* left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={EYEBROW}>Checkout</span>
                <PendingBadge>COMMERCIAL VALUES PENDING</PendingBadge>
              </div>
              <h1 style={{ margin: 0, font: '700 22px/1.2 Inter,sans-serif' }}>Review and pay</h1>
            </div>

            {/* 1 · Your plan */}
            <section aria-labelledby="co-plan" className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <h2 id="co-plan" style={SECTION_H}>1 · Your plan</h2>
                <Link href={routes.pricing()} style={{ font: '500 12px Inter,sans-serif', color: 'var(--cool)', textDecoration: 'none' }}>Change</Link>
              </div>
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '8px 16px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ font: '700 18px Inter,sans-serif', color: 'var(--text)' }}>{plan}</span>
                  <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--faint)' }}>LEVEL {info.level}</span>
                </div>
                <DepthBars level={info.level} />
                <span style={{ gridColumn: '1 / -1', font: '400 14px/1.5 Inter,sans-serif', color: 'var(--text-secondary)' }}>{info.intent}</span>
              </div>
            </section>

            {/* 2 · Payment details — provider pending (no fake card fields) */}
            <section aria-labelledby="co-pay" className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                <h2 id="co-pay" style={SECTION_H}>2 · Payment details</h2>
                <PendingBadge>PAYMENT PROVIDER PENDING</PendingBadge>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, font: '400 14px/1.5 Inter,sans-serif', color: 'var(--text-secondary)' }}>
                  Payment is handled by a payment provider that hasn’t been connected yet. When it is, its secure fields appear here — PitchTerminal never collects or stores card details itself.
                </p>
                <div role="note" style={{ border: '1px dashed var(--line)', borderRadius: 4, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, background: 'repeating-linear-gradient(135deg, transparent 0 8px, rgba(255,255,255,.015) 8px 16px)' }}>
                  <span style={{ font: "600 9px 'JetBrains Mono',monospace", letterSpacing: '.1em', color: 'var(--faint)' }}>◌ BILLING TERMS · PENDING</span>
                  <span style={{ font: '400 12px/1.5 Inter,sans-serif', color: 'var(--muted)' }}>Reserved for the confirmed renewal, cancellation and payment disclosure, with links to Terms (arriving in a later release).</span>
                </div>
              </div>
            </section>
          </div>

          {/* right column — order summary */}
          <aside aria-labelledby="co-sum" className="panel md:sticky md:top-4" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 id="co-sum" style={{ ...SECTION_H, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>3 · Order summary</h2>
            <dl style={{ margin: 0, padding: '4px 16px' }}>
              {summary.map((r) => (
                <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <dt style={{ font: '400 13px Inter,sans-serif', color: 'var(--muted)' }}>{r.k}</dt>
                  <dd style={{ margin: 0, textAlign: 'right', font: "500 13px 'JetBrains Mono',monospace", color: r.k === 'Plan' ? 'var(--text)' : 'var(--faint)' }}>{r.v}</dd>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '14px 0 10px' }}>
                <dt style={{ font: '600 14px Inter,sans-serif', color: 'var(--text)' }}>Amount due</dt>
                <dd style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span style={{ font: "600 20px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>TBD</span>
                  <span style={{ font: "400 10px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>shown once pricing is set</span>
                </dd>
              </div>
            </dl>
            <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" disabled aria-disabled="true" aria-describedby="co-why"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48, background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4, font: "600 12px 'JetBrains Mono',monospace", letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', cursor: 'not-allowed' }}>
                Complete purchase
              </button>
              <span id="co-why" style={{ font: '400 12px Inter,sans-serif', color: 'var(--faint)', textAlign: 'center' }}>Checkout isn’t available yet — nothing is charged.</span>
              <Link href={routes.pricing()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 4, ...MONO_CAP, color: 'var(--muted)', textDecoration: 'none' }}>Change plan</Link>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
