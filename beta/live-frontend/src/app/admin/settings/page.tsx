import Link from "next/link";
import { getAccessContext, FEATURE_BY_MODULE } from "@/lib/access";
import { MODULES } from "@/lib/modules";
import { SubscriptionToggle } from "@/components/SubscriptionToggle";
import { IconGate, IconLock, IconUnverified } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin settings" };

export default async function AdminSettingsPage() {
  const ctx = await getAccessContext();

  // Route protection. RLS would reject the write regardless, but a non-admin
  // should not see the control at all — and an anonymous visitor should be
  // told to sign in rather than shown a denial.
  if (!ctx.isAdmin) {
    return (
      <div className="panel mx-auto max-w-lg p-6 text-center">
        <span className="text-faint">
          <IconLock size={20} />
        </span>
        <h1 className="mono mt-2 text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
          Access denied
        </h1>
        <p className="mt-2 text-[0.76rem] leading-relaxed text-muted">
          {ctx.authenticated
            ? "This area requires an admin role. Your account does not have one."
            : "Sign in with an admin account to reach the subscription controls."}
        </p>
        <Link
          href={ctx.authenticated ? "/app" : "/login"}
          className="mono mt-4 inline-block text-[0.64rem] tracking-widest text-amber"
        >
          {ctx.authenticated ? "BACK TO DASHBOARD" : "SIGN IN"} →
        </Link>
      </div>
    );
  }

  const on = ctx.subscriptionsEnabled;

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Subscription control
        </h1>
        <p className="mono mt-2 text-[0.66rem] text-faint">
          Signed in as {ctx.email ?? ctx.userId} · role {ctx.role}
        </p>
      </header>

      <section className="panel p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
            Subscription system
          </h2>
          <span
            className="mono rounded px-2 py-0.5 text-[0.6rem] font-bold tracking-widest"
            style={{
              color: on ? "var(--edge)" : "var(--warn)",
              background: `color-mix(in srgb, ${on ? "var(--edge)" : "var(--warn)"} 14%, transparent)`,
            }}
          >
            {on ? "ON" : "OFF"}
          </span>
          <span className="mono text-[0.6rem] text-faint">subscriptions_enabled</span>
        </div>

        <p className="mt-3 text-[0.78rem] leading-relaxed text-muted">
          {on
            ? "Production subscription enforcement active. Free accounts see the five open modules; Pro accounts see all thirteen."
            : "Beta mode. All features available to everyone, signed in or not."}
        </p>

        <div className="mt-4 border-t border-line pt-4">
          <SubscriptionToggle enabled={on} />
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mono mb-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          <IconGate size={14} />
          Feature access
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Feature</th>
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Required tier</th>
                <th className="label-cap py-1.5 text-left font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {MODULES.map((mod) => {
                const key = FEATURE_BY_MODULE[mod.key];
                const tier = key ? ctx.required[key] : undefined;
                const isPro = tier === "pro";
                return (
                  <tr key={mod.key} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-3 text-text">{mod.name}</td>
                    <td
                      className="mono py-1.5 pr-3"
                      style={{ color: isPro ? "var(--amber)" : "var(--edge)" }}
                    >
                      {tier ? tier.toUpperCase() : "—"}
                    </td>
                    <td className="mono py-1.5 text-muted">
                      {on ? (isPro ? "Enforced" : "Open") : "Open (beta)"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="mono mb-2 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          <IconUnverified size={14} />
          Not built yet
        </h2>
        <p className="text-[0.74rem] leading-relaxed text-muted">
          User subscription management — listing accounts with plan, status and expiry — needs
          a payment provider to produce those rows. Until Phase 2.2 the only subscription
          records would be ones an admin inserted by hand, which is not a list worth building
          a screen for.
        </p>
      </section>
    </div>
  );
}
