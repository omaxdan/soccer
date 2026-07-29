import Link from "next/link";
import { getTeamDirectory } from "@/lib/queries";
import { teamSlug } from "@/lib/slug";
import { Crest } from "@/components/Crest";
import { AdminFilterBar } from "@/components/AdminFilterBar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams" };

const cell = (v: number | null, dp = 0) =>
  v == null ? <span className="text-faint">—</span> : v.toFixed(dp);

function tone(v: number | null): string {
  if (v == null) return "var(--faint)";
  if (v >= 70) return "var(--edge)";
  if (v >= 45) return "var(--warn)";
  return "var(--risk)";
}

function qs(params: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const page = sp.page ? Number(sp.page) : 1;
  const { rows, total, pageSize } = await getTeamDirectory({ q: sp.q, page });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const baseFilters = { q: sp.q };

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <p className="eyebrow">Intelligence</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Teams</h1>
        <p className="mt-2 max-w-2xl text-[0.82rem] leading-relaxed text-muted">
          Every side the platform tracks intelligence for, ordered by readiness. Adjusted form
          accounts for the strength of opponents faced; form rating does not.
        </p>
        <p className="mono mt-3 text-[0.6rem] tracking-wide text-faint">
          {total.toLocaleString()} teams
        </p>
      </header>

      <AdminFilterBar
        basePath="/teams"
        fields={[{ type: "search", name: "q", placeholder: "Search teams" }]}
      />

      {rows.length === 0 ? (
        <div className="panel p-4 text-center">
          <p className="mono text-[0.72rem] text-muted">
            {sp.q ? `No teams match "${sp.q}".` : "No team intelligence available."}
          </p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[38rem] border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap px-3 py-2 text-left font-normal">Team</th>
                <th className="label-cap px-2 py-2 text-right font-normal">Readiness</th>
                <th className="label-cap px-2 py-2 text-right font-normal">Adj. form</th>
                <th className="label-cap px-2 py-2 text-right font-normal">Form</th>
                <th className="label-cap px-2 py-2 text-right font-normal">Attack</th>
                <th className="label-cap px-2 py-2 text-right font-normal">Defence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-line transition-colors hover:bg-raised">
                  <td className="px-3 py-1.5">
                    <Link href={`/team/${teamSlug(t)}`} className="flex items-center gap-2">
                      <Crest team={t} size={20} />
                      <span className="min-w-0">
                        <span className="mono block truncate font-semibold text-text">
                          {t.short_name || t.name}
                        </span>
                        {t.country && (
                          <span className="mono block truncate text-[0.58rem] text-faint">
                            {t.country}
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="mono tnum px-2 py-1.5 text-right" style={{ color: tone(t.readiness) }}>
                    {cell(t.readiness)}
                  </td>
                  <td className="mono tnum px-2 py-1.5 text-right" style={{ color: tone(t.adjustedForm) }}>
                    {cell(t.adjustedForm)}
                  </td>
                  <td className="mono tnum px-2 py-1.5 text-right text-muted">{cell(t.form, 1)}</td>
                  <td className="mono tnum px-2 py-1.5 text-right text-muted">{cell(t.attack)}</td>
                  <td className="mono tnum px-2 py-1.5 text-right text-muted">{cell(t.defence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-center gap-1.5" aria-label="Pagination">
          {page > 1 && (
            <Link href={`/teams${qs({ ...baseFilters, page: page - 1 })}`} className="mono rounded-term border border-line px-2.5 py-1 text-[0.64rem] text-muted">
              ← Prev
            </Link>
          )}
          <span className="mono px-2 text-[0.64rem] text-faint">Page {page} of {pages}</span>
          {page < pages && (
            <Link href={`/teams${qs({ ...baseFilters, page: page + 1 })}`} className="mono rounded-term border border-line px-2.5 py-1 text-[0.64rem] text-muted">
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
