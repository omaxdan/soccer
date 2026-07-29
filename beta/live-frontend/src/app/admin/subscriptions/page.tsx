import Link from "next/link";
import { requireAdmin } from "@/components/AdminGuard";
import { getAdminSummary } from "@/lib/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Subscriptions" };

interface EventRow {
  id: number;
  userEmail: string | null;
  eventType: string;
  oldPlan: string | null;
  newPlan: string | null;
  createdAt: string;
}

async function getRecentEvents(limit = 30): Promise<EventRow[]> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const { data } = await client
      .from("subscription_events")
      .select("id, event_type, old_plan, new_plan, created_at, user:user_profiles!subscription_events_user_id_fkey(email)")
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      userEmail: r.user?.email ?? null,
      eventType: r.event_type,
      oldPlan: r.old_plan,
      newPlan: r.new_plan,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created", upgraded: "Upgraded", downgraded: "Downgraded", renewed: "Renewed",
  cancelled: "Cancelled", expired: "Expired", payment_failed: "Payment failed", reactivated: "Reactivated",
};

export default async function AdminSubscriptionsPage() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;

  const [summary, events] = await Promise.all([getAdminSummary(), getRecentEvents()]);

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Subscriptions</h1>
      </header>

      {summary && (
        <section className="panel p-4">
          <h2 className="label-cap mb-2">By plan</h2>
          <div className="flex flex-wrap gap-4">
            {summary.planCounts.map((p) => (
              <div key={p.plan}>
                <div className="mono tnum text-xl font-semibold text-text">{p.count.toLocaleString()}</div>
                <div className="mono text-[0.6rem] uppercase tracking-widest text-faint">{p.plan}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-6 border-t border-line pt-3">
            <div>
              <div className="mono tnum text-lg font-semibold text-text">{summary.conversionPct}%</div>
              <div className="label-cap">Conversion</div>
            </div>
            <div>
              <div className="mono tnum text-lg font-semibold" style={{ color: "var(--risk)" }}>{summary.churnPct}%</div>
              <div className="label-cap">Churn</div>
            </div>
          </div>
        </section>
      )}

      <section className="panel p-4">
        <h2 className="label-cap mb-2">Recent lifecycle events</h2>
        {events.length === 0 ? (
          <p className="text-[0.72rem] text-muted">No subscription events recorded yet.</p>
        ) : (
          <table className="w-full border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Time</th>
                <th className="label-cap py-1.5 pr-3 text-left font-normal">User</th>
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Event</th>
                <th className="label-cap py-1.5 text-left font-normal">Plan change</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="mono py-1.5 pr-3 text-faint">
                    {new Date(e.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </td>
                  <td className="mono py-1.5 pr-3 truncate text-text">{e.userEmail ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-text">{EVENT_LABEL[e.eventType] ?? e.eventType}</td>
                  <td className="mono py-1.5 text-muted">
                    {e.oldPlan ?? "—"} → {e.newPlan ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[0.66rem] leading-relaxed text-faint">
        Every row here comes from subscription_events, written by applyPlanAction() when an admin changes a plan from{" "}
        <Link href="/admin/users" className="text-amber underline underline-offset-2">a user&rsquo;s detail page</Link>
        , and — once connected — by Stripe webhooks. Nothing is computed separately for this page.
      </p>
    </div>
  );
}
