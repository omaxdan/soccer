// PUBLIC SUBSCRIPTION SUCCESS PAGE (B7) — presentational, static, DB-free (SSR).
//
// Adapts the Claude Design Subscription Success wireframe
// (docs/frontend-design/wireframes/project/SubscriptionSuccessPage.dc.html; spec
// "Subscription Success Page.dc.html") to a TRUTHFUL production state.
//
// CRITICAL: a /subscription-success URL is NOT evidence of a subscription. There is
// no billing/subscription/payment backend and no verified payment confirmation
// (reconfirmed: no provider dependency anywhere), and no authenticated account. So
// this page:
// - shows NO confirmed subscription and NO "active"/"success" claim,
// - fabricates NO plan, account, status, renewal date, receipt or transaction id,
// - reads NO query string as proof of payment,
// - makes NO network request and stores nothing.
// The prototype's "Your Pro subscription is confirmed" / fabricated
// analyst@example.com / "Status: Confirmed" states are deliberately NOT reproduced
// (the design itself annotates them "ACTIVATION SEMANTICS PENDING"). Instead it
// renders an honest "no subscription to confirm yet" state. The checkout-progress
// steps are omitted because showing Plan/Payment as done would falsely imply a
// completed payment.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { CTA_AMBER, MONO_CAP } from '@/components/v2/marketing';

export function SubscriptionSuccessPage() {
  // Honest status rows — no fabricated plan/account/renewal; just the true state.
  const rows: readonly { k: string; v: string }[] = [
    { k: 'Subscription', v: 'None' },
    { k: 'Payment', v: 'Not taken' },
    { k: 'Status', v: 'Not available' },
  ];
  return (
    <main style={{ flex: 1, padding: 'clamp(24px,6vw,88px) 16px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <section role="status" aria-labelledby="ss-h" className="panel" style={{ width: '100%', maxWidth: 480, padding: 32, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <span aria-hidden style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--warn)', borderRadius: 4, background: 'color-mix(in srgb, var(--warn) 12%, transparent)', font: "700 15px 'JetBrains Mono',monospace", color: 'var(--warn)' }}>!</span>
          <span style={{ font: "600 8.5px 'JetBrains Mono',monospace", letterSpacing: '.08em', color: 'var(--warn)', border: '1px dashed var(--warn)', borderRadius: 3, padding: '1px 4px' }}>SUBSCRIPTIONS · PENDING BACKEND</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ font: "400 10px 'JetBrains Mono',monospace", letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)' }}>Subscription · unavailable</span>
          <h1 id="ss-h" tabIndex={-1} style={{ margin: 0, font: '700 22px/1.2 Inter,sans-serif', color: 'var(--text)' }}>No subscription to confirm yet</h1>
          <p style={{ margin: 0, font: '400 14px/1.55 Inter,sans-serif', color: 'var(--text-secondary)' }}>
            Checkout and subscriptions aren’t available yet — no payment was taken and no subscription was created. This page will confirm a subscription once accounts and billing are set up. You can explore PitchTerminal without an account in the meantime.
          </p>
        </div>

        <dl style={{ margin: 0, borderTop: '1px solid var(--line)' }}>
          {rows.map((r) => (
            <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 40, borderBottom: '1px solid var(--line)' }}>
              <dt style={{ font: '400 13px Inter,sans-serif', color: 'var(--muted)' }}>{r.k}</dt>
              <dd style={{ margin: 0, font: "500 13px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>{r.v}</dd>
            </div>
          ))}
        </dl>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Link href={routes.leagues()} style={{ ...CTA_AMBER, height: 48, minHeight: 48, fontSize: 12 }}>Explore PitchTerminal</Link>
          <Link href={routes.home()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 4, ...MONO_CAP, color: 'var(--muted)', textDecoration: 'none' }}>Back to home</Link>
        </div>
      </section>
    </main>
  );
}
