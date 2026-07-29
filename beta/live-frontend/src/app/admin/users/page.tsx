import Link from "next/link";
import { requireAdmin } from "@/components/AdminGuard";
import { listUsers, type UserListFilters } from "@/lib/admin";
import { NavSearch } from "@/components/icons/NavIcons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Users" };

const ROLES = ["user", "support", "moderator", "admin", "owner"];
const PROVIDERS = ["email", "google"];

function when(v: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function qs(params: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;

  const sp = await searchParams;
  const filters: UserListFilters = {
    q: sp.q,
    role: sp.role,
    plan: sp.plan,
    provider: sp.provider,
    status: sp.status === "suspended" || sp.status === "active" ? sp.status : undefined,
    page: sp.page ? Number(sp.page) : 1,
    pageSize: sp.pageSize ? Number(sp.pageSize) : 25,
  };
  const { rows, total, page, pageSize } = await listUsers(filters);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const baseFilters = { q: sp.q, role: sp.role, plan: sp.plan, provider: sp.provider, status: sp.status, pageSize: sp.pageSize };
  const exportHref = `/admin/users/export${qs(baseFilters)}`;

  const roleColor = (r: string) =>
    r === "owner" || r === "admin" ? "var(--amber)" : r === "moderator" || r === "support" ? "var(--cool)" : "var(--muted)";

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="eyebrow">Admin</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Users</h1>
          </div>
          <a
            href={exportHref}
            className="mono rounded-term px-3 py-1.5 text-[0.62rem] font-semibold tracking-widest"
            style={{ color: "var(--amber)", border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)" }}
          >
            EXPORT CSV
          </a>
        </div>
        <p className="mono mt-2 text-[0.62rem] tracking-wide text-faint">{total.toLocaleString()} accounts</p>
      </header>

      {/* Search + filters — plain GET form, so results live in the URL. */}
      <form action="/admin/users" method="get" className="panel flex flex-wrap items-end gap-2 p-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search by email or name</span>
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">
            <NavSearch size={13} />
          </span>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Email or name"
            autoComplete="off"
            className="mono w-full rounded-term border border-line bg-raised py-1.5 pl-7 pr-2 text-[0.7rem] text-text outline-none focus:border-amber"
          />
        </label>
        <select name="role" defaultValue={sp.role ?? ""} className="mono rounded-term border border-line bg-raised px-2 py-1.5 text-[0.68rem] text-text">
          <option value="">Any role</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select name="plan" defaultValue={sp.plan ?? ""} className="mono rounded-term border border-line bg-raised px-2 py-1.5 text-[0.68rem] text-text">
          <option value="">Any plan</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </select>
        <select name="provider" defaultValue={sp.provider ?? ""} className="mono rounded-term border border-line bg-raised px-2 py-1.5 text-[0.68rem] text-text">
          <option value="">Any provider</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="mono rounded-term border border-line bg-raised px-2 py-1.5 text-[0.68rem] text-text">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <button
          type="submit"
          className="mono rounded-term px-3 py-1.5 text-[0.64rem] font-semibold tracking-widest"
          style={{ color: "var(--ink)", background: "var(--amber)" }}
        >
          FILTER
        </button>
        {(sp.q || sp.role || sp.plan || sp.provider || sp.status) && (
          <Link href="/admin/users" className="mono text-[0.62rem] tracking-widest text-faint">
            CLEAR
          </Link>
        )}
      </form>

      {/* Desktop table */}
      <div className="panel hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[46rem] border-collapse text-[0.72rem]">
          <thead>
            <tr className="border-b border-line">
              <th className="label-cap px-3 py-2 text-left font-normal">User</th>
              <th className="label-cap px-2 py-2 text-left font-normal">Role</th>
              <th className="label-cap px-2 py-2 text-left font-normal">Plan</th>
              <th className="label-cap px-2 py-2 text-left font-normal">Status</th>
              <th className="label-cap px-2 py-2 text-left font-normal">Created</th>
              <th className="label-cap px-2 py-2 text-left font-normal">Last login</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.userId} className="border-t border-line transition-colors hover:bg-raised">
                <td className="px-3 py-2">
                  <Link href={`/admin/users/${u.userId}`} className="block">
                    <span className="mono block truncate font-semibold text-text">{u.displayName ?? u.email ?? u.userId}</span>
                    <span className="mono block truncate text-[0.6rem] text-faint">{u.email ?? "—"}</span>
                  </Link>
                </td>
                <td className="mono px-2 py-2 font-semibold" style={{ color: roleColor(u.role) }}>
                  {u.role}
                </td>
                <td className="mono px-2 py-2" style={{ color: u.plan === "pro" ? "var(--amber)" : "var(--edge)" }}>
                  {u.plan.toUpperCase()}
                </td>
                <td className="mono px-2 py-2" style={{ color: u.suspended ? "var(--risk)" : "var(--edge)" }}>
                  {u.suspended ? "Suspended" : "Active"}
                </td>
                <td className="mono px-2 py-2 text-muted">{when(u.createdAt)}</td>
                <td className="mono px-2 py-2 text-muted">{when(u.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards — the same rows, collapsed */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((u) => (
          <li key={u.userId}>
            <Link href={`/admin/users/${u.userId}`} className="panel block p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="mono truncate text-[0.78rem] font-semibold text-text">{u.displayName ?? u.email ?? u.userId}</span>
                <span className="mono shrink-0 text-[0.6rem] font-semibold" style={{ color: roleColor(u.role) }}>
                  {u.role}
                </span>
              </div>
              <p className="mono truncate text-[0.62rem] text-faint">{u.email ?? "—"}</p>
              <div className="mono mt-1.5 flex items-center gap-3 text-[0.62rem]">
                <span style={{ color: u.plan === "pro" ? "var(--amber)" : "var(--edge)" }}>{u.plan.toUpperCase()}</span>
                <span style={{ color: u.suspended ? "var(--risk)" : "var(--edge)" }}>{u.suspended ? "Suspended" : "Active"}</span>
                <span className="text-faint">Last seen {when(u.lastLoginAt)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <div className="panel p-5 text-center">
          <p className="mono text-[0.72rem] text-muted">No accounts match this filter.</p>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <nav className="flex items-center justify-center gap-1.5" aria-label="Pagination">
          {page > 1 && (
            <Link href={`/admin/users${qs({ ...baseFilters, page: page - 1 })}`} className="mono rounded-term border border-line px-2.5 py-1 text-[0.64rem] text-muted">
              ← Prev
            </Link>
          )}
          <span className="mono px-2 text-[0.64rem] text-faint">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={`/admin/users${qs({ ...baseFilters, page: page + 1 })}`} className="mono rounded-term border border-line px-2.5 py-1 text-[0.64rem] text-muted">
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
