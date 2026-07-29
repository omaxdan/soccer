import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/components/AdminGuard";
import { getUpcomingMatchesByBand } from "@/lib/admin";
import { AdminFilterBar } from "@/components/AdminFilterBar";

export const dynamic = "force-dynamic";

const BANDS = ["Elite", "Strong", "Moderate", "Risky", "Avoid"];
const WINDOWS = [
  { value: "1", label: "Today" },
  { value: "3", label: "Next 3 days" },
  { value: "5", label: "Next 5 days" },
  { value: "7", label: "Next 7 days" },
  { value: "30", label: "Next 30 days" },
];

const bandColor = (band: string) =>
  band === "Elite" ? "var(--edge)"
  : band === "Strong" ? "var(--cool)"
  : band === "Moderate" ? "var(--warn)"
  : band === "Risky" ? "var(--amber)"
  : "var(--risk)";

export async function generateMetadata({ params }: { params: Promise<{ band: string }> }) {
  const { band } = await params;
  return { title: `Admin · ${decodeURIComponent(band)} fixtures` };
}

export default async function AdminBandDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ band: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;

  const { band: bandParam } = await params;
  const band = decodeURIComponent(bandParam);
  if (!BANDS.includes(band)) notFound();

  const sp = await searchParams;
  const daysAhead = sp.window ? Number(sp.window) : 7;
  const matches = await getUpcomingMatchesByBand({ band, daysAhead });

  return (
    <div className="space-y-3">
      <Link href="/admin/bands" className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text">
        ← Confidence Band Analytics
      </Link>

      <header className="panel p-4">
        <p className="eyebrow">Admin · Internal analysis</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl" style={{ color: bandColor(band) }}>
          {band} — upcoming fixtures
        </h1>
        <p className="mono mt-2 text-[0.62rem] tracking-wide text-faint">
          {matches.length} {matches.length === 1 ? "match" : "matches"} · current confidence_band
        </p>
      </header>

      <AdminFilterBar
        basePath={`/admin/bands/${encodeURIComponent(band)}`}
        fields={[{ type: "select", name: "window", label: "Next 7 days", options: WINDOWS }]}
      />

      {matches.length === 0 ? (
        <div className="panel p-4 text-center">
          <p className="mono text-[0.72rem] text-muted">No {band} fixtures in this window.</p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap py-1.5 pl-3 pr-2 text-left font-normal">Date</th>
                <th className="label-cap px-2 py-1.5 text-left font-normal">League</th>
                <th className="label-cap px-2 py-1.5 text-left font-normal">Fixture</th>
                <th className="label-cap py-1.5 pl-2 pr-3 text-right font-normal">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.matchId} className="border-b border-line last:border-0">
                  <td className="mono py-1.5 pl-3 pr-2 text-faint">
                    {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </td>
                  <td className="px-2 py-1.5 text-muted">{m.leagueName ?? "—"}</td>
                  <td className="px-2 py-1.5 text-text">{m.homeName} v {m.awayName}</td>
                  <td className="mono tnum py-1.5 pl-2 pr-3 text-right" style={{ color: bandColor(band) }}>
                    {m.confidenceScore != null ? Math.round(m.confidenceScore) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
