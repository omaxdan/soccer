import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/components/AdminGuard";
import { getUserDetail, getUserActivity, getUserNotes, getOwnRole } from "@/lib/admin";
import { RoleActions, SuspendAction, PlanActions, NoteForm } from "@/components/AdminUserActions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getUserDetail(id);
  return { title: u ? `Admin · ${u.displayName ?? u.email ?? "User"}` : "Admin · User" };
}

function when(v: string | null, withTime = false) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

const ACTION_LABEL: Record<string, string> = {
  role_changed: "Role changed",
  suspended: "Suspended",
  unsuspended: "Unsuspended",
  plan_upgraded: "Plan upgraded",
  plan_downgraded: "Plan downgraded",
  plan_cancelled: "Subscription cancelled",
  plan_extended: "Subscription extended",
  plan_reset: "Subscription reset",
  note_added: "Note added",
};

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;

  const { id } = await params;
  const [user, activity, notes, actor] = await Promise.all([
    getUserDetail(id),
    getUserActivity(id),
    getUserNotes(id),
    getOwnRole(),
  ]);
  if (!user) notFound();

  return (
    <div className="space-y-3">
      <Link href="/admin/users" className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text">
        ← Users
      </Link>

      {/* Overview */}
      <header className="panel p-4">
        <div className="flex items-start gap-3">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span
              className="mono flex h-10 w-10 items-center justify-center rounded-full text-[0.9rem] font-semibold"
              style={{ background: "var(--raised)", color: "var(--amber)" }}
            >
              {(user.displayName ?? user.email ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
              {user.displayName ?? "Unnamed account"}
            </h1>
            <p className="mono truncate text-[0.72rem] text-muted">{user.email ?? "—"}</p>
          </div>
          {user.suspended && (
            <span
              className="mono shrink-0 rounded px-2 py-1 text-[0.6rem] font-bold tracking-widest"
              style={{ color: "var(--risk)", background: "color-mix(in srgb, var(--risk) 14%, transparent)" }}
            >
              SUSPENDED
            </span>
          )}
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          {[
            ["Role", user.role],
            ["Provider", user.provider ?? "—"],
            ["Verified", user.verified ? "Yes" : "No"],
            ["Created", when(user.createdAt)],
            ["Last login", when(user.lastLoginAt, true)],
            ["Current plan", user.plan.toUpperCase()],
            ["Status", user.suspended ? "Suspended" : "Active"],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="label-cap">{label}</dt>
              <dd className="mono text-[0.78rem] text-text">{value}</dd>
            </div>
          ))}
        </dl>

        {user.suspended && user.suspendedReason && (
          <p className="mt-3 border-t border-line pt-3 text-[0.72rem] text-muted">
            <span className="text-faint">Suspension reason: </span>
            {user.suspendedReason}
            {user.suspendedAt && <span className="text-faint"> · {when(user.suspendedAt, true)}</span>}
          </p>
        )}
      </header>

      {/* Permissions */}
      <section className="panel p-4">
        <h2 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">Permissions</h2>
        <p className="mb-2 text-[0.72rem] leading-relaxed text-muted">
          Owner cannot be modified. You can only grant roles below your own ({actor.role}), and only act on accounts
          ranked below yours.
        </p>
        <RoleActions userId={user.userId} currentRole={user.role} actorRank={actor.rank} />
      </section>

      {/* Subscription */}
      <section className="panel p-4">
        <h2 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">Subscription</h2>
        {user.subscription ? (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
            {[
              ["Plan", user.subscription.plan.toUpperCase()],
              ["Status", user.subscription.status ?? "—"],
              ["Billing provider", user.subscription.provider],
              ["Started", when(user.subscription.startedAt)],
              ["Renews", when(user.subscription.renewsAt)],
              ["Cancel at period end", user.subscription.cancelAtPeriodEnd ? "Yes" : "No"],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="label-cap">{label}</dt>
                <dd className="mono text-[0.76rem] text-text">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[0.74rem] text-muted">No active subscription — this account is on Free.</p>
        )}
        {user.subscription?.provider === "stripe" ? (
          <p className="mono mt-3 text-[0.62rem] tracking-wide" style={{ color: "var(--warn)" }}>
            Stripe-owned subscription: admin plan actions here will be reverted by the next webhook. Manage this one
            in the Stripe dashboard once billing is connected.
          </p>
        ) : (
          <div className="mt-3 border-t border-line pt-3">
            <PlanActions userId={user.userId} currentPlan={user.plan} />
          </div>
        )}
      </section>

      {/* Suspension */}
      <section className="panel p-4">
        <h2 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">Account status</h2>
        <SuspendAction userId={user.userId} suspended={user.suspended} />
      </section>

      {/* Notes */}
      <section className="panel p-4">
        <h2 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">Internal notes</h2>
        {notes.length > 0 && (
          <ul className="mb-3 space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-term p-2.5" style={{ background: "var(--raised)" }}>
                <div className="flex items-center gap-2">
                  <span className="mono text-[0.6rem] text-faint">{n.authorName ?? "Admin"} · {when(n.createdAt, true)}</span>
                  {n.flag && (
                    <span
                      className="mono rounded px-1.5 py-0.5 text-[0.52rem] font-bold tracking-widest"
                      style={{ color: "var(--warn)", background: "color-mix(in srgb, var(--warn) 14%, transparent)" }}
                    >
                      {n.flag.toUpperCase().replace("_", " ")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[0.74rem] text-text">{n.note}</p>
              </li>
            ))}
          </ul>
        )}
        <NoteForm userId={user.userId} />
      </section>

      {/* Activity — real, from admin_actions. Cannot show history predating
          this migration; an audit trail has a start date like any other. */}
      <section className="panel p-4">
        <h2 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">Activity</h2>
        {activity.length === 0 ? (
          <p className="text-[0.72rem] text-muted">
            No recorded admin actions for this account yet. This log starts from when it was introduced — it cannot
            show history from before.
          </p>
        ) : (
          <table className="w-full border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Time</th>
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Action</th>
                <th className="label-cap py-1.5 text-left font-normal">Detail</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="mono py-1.5 pr-3 text-faint">{when(a.createdAt, true)}</td>
                  <td className="py-1.5 pr-3 text-text">{ACTION_LABEL[a.action] ?? a.action}</td>
                  <td className="mono py-1.5 text-muted">
                    {a.detail ?? "—"}
                    {a.actorName && <span className="text-faint"> · by {a.actorName}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Usage and sessions — not fabricated */}
      <section className="panel p-4">
        <h2 className="mono mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">
          Usage and sessions
        </h2>
        <p className="text-[0.72rem] leading-relaxed text-muted">
          Matches viewed, module opens, searches, and per-login IP/device/browser history need an event-capture
          layer nothing in the product writes to yet. Building this table without a writer would mean showing
          numbers nobody measured. <span className="text-text">last_login_at</span> above is the one login signal
          that is real today.
        </p>
      </section>
    </div>
  );
}
