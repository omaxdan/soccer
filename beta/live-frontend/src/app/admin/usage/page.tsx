import { requireAdmin } from "@/components/AdminGuard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Usage" };

export default async function AdminUsagePage() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;

  return (
    <div className="space-y-4">
      <header className="panel p-4">
        <p className="eyebrow">Admin</p>
        <div className="flex items-center gap-2">
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Platform usage</h1>
          <span
            className="mono rounded px-1.5 py-0.5 text-[0.5rem] font-bold tracking-widest"
            style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 12%, transparent)" }}
          >
            NOT BUILT
          </span>
        </div>
      </header>

      <section className="panel p-4">
        <h2 className="label-cap mb-2">Before this page can show anything real</h2>
        <ul className="space-y-1.5">
          {[
            "An event-capture layer — matches viewed, teams viewed, modules opened, searches — nothing in the product writes these anywhere today.",
            "A sessions table with IP, browser, device and country, which needs middleware instrumentation on top of Supabase Auth's session, not something Auth exposes on its own.",
            "Daily/monthly active user counts need the event layer above; last_login_at alone only gives a single most-recent timestamp per user, not a usage history.",
          ].map((n) => (
            <li key={n} className="flex gap-2 text-[0.74rem] leading-relaxed text-muted">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--faint)" }} />
              {n}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-[0.7rem] leading-relaxed text-faint">
          Nothing is shown here rather than invented numbers. What is real today — account counts, plan mix,
          conversion, churn, last login per user — is on{" "}
          <a href="/admin/subscriptions" className="text-amber underline underline-offset-2">Subscriptions</a> and{" "}
          <a href="/admin/users" className="text-amber underline underline-offset-2">Users</a>.
        </p>
      </section>
    </div>
  );
}
