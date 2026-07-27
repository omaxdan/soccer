import { requireAdmin } from "@/components/AdminGuard";
import { getAdminUsers } from "@/lib/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Users" };

export default async function AdminUsersPage() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;

  const users = await getAdminUsers();
  const when = (v: string | null) =>
    v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Users</h1>
        <p className="mono mt-2 text-[0.62rem] tracking-wide text-faint">
          {users.length.toLocaleString()} accounts
        </p>
      </header>

      {users.length === 0 ? (
        <div className="panel p-5 text-center">
          <p className="mono text-[0.72rem] text-muted">No accounts yet.</p>
          <p className="mt-1 text-[0.68rem] text-faint">
            Accounts are optional in beta, so this stays empty until people sign up.
          </p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap px-3 py-2 text-left font-normal">User</th>
                <th className="label-cap px-2 py-2 text-left font-normal">Role</th>
                <th className="label-cap px-2 py-2 text-left font-normal">Plan</th>
                <th className="label-cap px-2 py-2 text-left font-normal">Status</th>
                <th className="label-cap px-2 py-2 text-left font-normal">Expiry</th>
                <th className="label-cap px-2 py-2 text-left font-normal">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-t border-line">
                  <td className="px-3 py-1.5">
                    <span className="mono block truncate text-text">{u.displayName ?? "—"}</span>
                    <span className="mono block text-[0.56rem] text-faint">
                      {u.provider ?? "email"}
                    </span>
                  </td>
                  <td
                    className="mono px-2 py-1.5"
                    style={{ color: u.role === "admin" ? "var(--amber)" : "var(--muted)" }}
                  >
                    {u.role}
                  </td>
                  <td
                    className="mono px-2 py-1.5"
                    style={{ color: u.plan === "pro" ? "var(--amber)" : "var(--edge)" }}
                  >
                    {u.plan.toUpperCase()}
                  </td>
                  <td className="mono px-2 py-1.5 text-muted">{u.status ?? "—"}</td>
                  <td className="mono px-2 py-1.5 text-muted">{when(u.expiresAt)}</td>
                  <td className="mono px-2 py-1.5 text-muted">{when(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[0.66rem] leading-relaxed text-faint">
        Email addresses are not shown: they live in auth.users, which is not readable through
        the anon or authenticated role, and mirroring them into user_profiles would duplicate
        personal data for the sake of a column.
      </p>
    </div>
  );
}
