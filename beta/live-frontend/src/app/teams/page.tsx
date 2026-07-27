import Link from "next/link";
import { getTeamDirectory } from "@/lib/queries";
import { teamSlug } from "@/lib/slug";
import { Crest } from "@/components/Crest";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams" };

const cell = (v: number | null, dp = 0) =>
  v == null ? <span className="text-faint">—</span> : v.toFixed(dp);

/** Colour a 0–100 rating without asserting a band it does not have. */
function tone(v: number | null): string {
  if (v == null) return "var(--faint)";
  if (v >= 70) return "var(--edge)";
  if (v >= 45) return "var(--warn)";
  return "var(--risk)";
}

export default async function TeamsPage() {
  const teams = await getTeamDirectory();
  const sorted = [...teams].sort((a, b) => (b.readiness ?? -1) - (a.readiness ?? -1));

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
          {sorted.length.toLocaleString()} teams
        </p>
      </header>

      {sorted.length === 0 ? (
        <div className="panel p-4 text-center">
          <p className="mono text-[0.72rem] text-muted">No team intelligence available.</p>
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
              {sorted.map((t) => (
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
    </div>
  );
}
