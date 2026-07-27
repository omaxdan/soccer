import Link from "next/link";
import { getAccessContext } from "@/lib/access";
import { db } from "@/lib/supabase";
import { MODULES } from "@/lib/modules";
import { FEATURE_BY_MODULE } from "@/lib/access";
import { IconLock, IconGate, IconUnverified } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

async function featureMap(): Promise<Record<string, string>> {
  const client = db();
  if (!client) return {};
  try {
    const { data } = await client.from("feature_permissions").select("feature_key, required_plan");
    const out: Record<string, string> = {};
    for (const r of ((data as any[]) ?? [])) out[r.feature_key] = r.required_plan;
    return out;
  } catch {
    return {};
  }
}

export default async function SettingsPage() {
  const [ctx, perms] = await Promise.all([getAccessContext(), featureMap()]);
  const on = ctx.subscriptionsEnabled;

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <p className="eyebrow">Account</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
      </header>

      {/* Subscription system */}
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
            {on ? "ACTIVE" : "TESTING MODE · OFF"}
          </span>
        </div>

        <p className="mt-3 text-[0.78rem] leading-relaxed text-muted">
          {on
            ? "Subscription system active. Free and Pro permissions are enforced."
            : "All users currently have full access. Subscription rules are configured but inactive."}
        </p>

        <Link
          href="/admin/settings"
          className="mono mt-4 inline-block rounded-term px-3 py-2 text-[0.64rem] font-semibold tracking-widest"
          style={{
            color: "var(--amber)",
            border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
          }}
        >
          OPEN ADMIN CONTROLS →
        </Link>
        <p className="mt-2 text-[0.68rem] leading-relaxed text-faint">
          The toggle lives behind an admin role. Sign in with an admin account to reach it.
        </p>
      </section>

      {/* Feature access overview */}
      <section className="panel p-5">
        <h2 className="mono mb-3 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          <IconGate size={14} />
          Feature access
        </h2>
        {Object.keys(perms).length === 0 ? (
          <p className="text-[0.74rem] text-muted">
            No permission rows found — migration 033 has not been applied to this database.
          </p>
        ) : (
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
                  const tier = key ? perms[key] : undefined;
                  const isPro = tier === "pro";
                  return (
                    <tr key={mod.key} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3 text-text">{mod.name}</td>
                      <td className="mono py-1.5 pr-3" style={{ color: isPro ? "var(--amber)" : "var(--edge)" }}>
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
        )}
      </section>

      {/* Account */}
      <section className="panel p-5">
        <h2 className="mono mb-2 flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          <IconLock size={14} />
          Account
        </h2>
        <p className="text-[0.74rem] leading-relaxed text-muted">
          {ctx.authenticated
            ? `Signed in as ${ctx.email ?? ctx.userId} · role ${ctx.role} · plan ${ctx.plan ?? "free"}.`
            : "Not signed in. Accounts are optional while the platform is in beta."}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {ctx.authenticated ? (
            <Link href="/logout" className="mono text-[0.64rem] tracking-widest text-amber">
              SIGN OUT →
            </Link>
          ) : (
            <>
              <Link href="/login" className="mono text-[0.64rem] tracking-widest text-amber">
                SIGN IN →
              </Link>
              <Link href="/signup" className="mono text-[0.64rem] tracking-widest text-muted">
                CREATE ACCOUNT →
              </Link>
            </>
          )}
        </div>
        <Link href="/subscription" className="mono mt-3 inline-block text-[0.64rem] tracking-widest text-amber">
          SEE PLANS →
        </Link>
      </section>
    </div>
  );
}
