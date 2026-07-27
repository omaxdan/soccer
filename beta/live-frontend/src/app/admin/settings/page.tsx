import Link from "next/link";
import { FEATURE_BY_MODULE, getPlatformStats } from "@/lib/access";
import { requireAdmin } from "@/components/AdminGuard";
import { MODULES } from "@/lib/modules";
import { SubscriptionToggle } from "@/components/SubscriptionToggle";
import { IconGate } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin settings" };

export default async function AdminSettingsPage() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;
  const ctx = guard.ctx;
  const stats = await getPlatformStats();

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

      {stats && (
        <section className="panel p-5">
          <h2 className="mono mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
            Platform
          </h2>
          <dl className="flex flex-wrap gap-x-8 gap-y-3">
            {[
              ["Users", stats.users],
              ["Admins", stats.admins],
              ["Free", stats.freeUsers],
              ["Pro", stats.proUsers],
              ["Active subscriptions", stats.activeSubscriptions],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="label-cap">{label}</dt>
                <dd className="mono tnum text-xl font-semibold text-text">
                  {Number(value).toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>

          {stats.plans.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="label-cap mb-1.5">Plans</h3>
              <ul className="flex flex-wrap gap-x-6 gap-y-1">
                {stats.plans.map((p) => (
                  <li key={p.slug} className="mono text-[0.72rem] text-text">
                    {p.name}
                    <span className="ml-1.5 text-faint">
                      {p.price > 0 ? `$${p.price}/mo` : "free"}
                      {p.active ? "" : " · inactive"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Link href="/admin/users" className="mono mt-3 inline-block text-[0.64rem] tracking-widest text-amber">
            MANAGE USERS →
          </Link>
        </section>
      )}

      <section id="features" className="panel scroll-mt-20 p-5">
        <h2 className="mono mb-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          <IconGate size={14} />
          Feature flags
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

    </div>
  );
}
