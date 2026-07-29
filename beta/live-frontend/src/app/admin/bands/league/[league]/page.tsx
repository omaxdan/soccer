import Link from "next/link";
import { requireAdmin } from "@/components/AdminGuard";
import { getUpcomingMatchesByBand, type UpcomingBandMatch } from "@/lib/admin";
import { AdminFilterBar } from "@/components/AdminFilterBar";

export const dynamic = "force-dynamic";

const BAND_ORDER = ["Elite", "Strong", "Moderate", "Risky", "Avoid"];
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

export async function generateMetadata({ params }: { params: Promise<{ league: string }> }) {
  const { league } = await params;
  return { title: `Admin · ${decodeURIComponent(league)} upcoming fixtures` };
}

export default async function AdminLeagueDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ league: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;

  const { league: leagueParam } = await params;
  const league = decodeURIComponent(leagueParam);
  const sp = await searchParams;
  const daysAhead = sp.window ? Number(sp.window) : 7;

  // One query, no band filter — grouped by band here rather than fetched
  // once per band. Same function the /admin/bands/[band] page calls; this is
  // "one pipeline, many views" applied to live fixtures the same way the
  // historical engine already applies it to readiness_history.
  const matches = await getUpcomingMatchesByBand({ league, daysAhead });
  const byBand = new Map<string, UpcomingBandMatch[]>();
  for (const m of matches) {
    const key = m.band ?? "Unscored";
    const list = byBand.get(key) ?? [];
    list.push(m);
    byBand.set(key, list);
  }

  return (
    <div className="space-y-3">
      <Link href="/admin/bands" className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text">
        ← Confidence Band Analytics
      </Link>

      <header className="panel p-4">
        <p className="eyebrow">Admin · Internal analysis</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{league}</h1>
        <p className="mono mt-2 text-[0.62rem] tracking-wide text-faint">
          {matches.length} upcoming {matches.length === 1 ? "fixture" : "fixtures"}
        </p>
      </header>

      <AdminFilterBar
        basePath={`/admin/bands/league/${encodeURIComponent(league)}`}
        fields={[{ type: "select", name: "window", label: "Next 7 days", options: WINDOWS }]}
      />

      {matches.length === 0 ? (
        <div className="panel p-4 text-center">
          <p className="mono text-[0.72rem] text-muted">No upcoming fixtures for {league} in this window.</p>
        </div>
      ) : (
        [...BAND_ORDER, "Unscored"].map((band) => {
          const list = byBand.get(band);
          if (!list || list.length === 0) return null;
          return (
            <section key={band} className="panel p-4">
              <h2 className="mono mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em]" style={{ color: band === "Unscored" ? "var(--faint)" : bandColor(band) }}>
                {band} <span className="tnum text-faint">({list.length})</span>
              </h2>
              <ul className="space-y-1.5">
                {list.map((m) => (
                  <li key={m.matchId} className="mono flex items-center gap-3 text-[0.72rem]">
                    <span className="w-14 shrink-0 text-faint">
                      {new Date(m.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-text">{m.homeName} v {m.awayName}</span>
                    {m.confidenceScore != null && (
                      <span className="tnum shrink-0 text-faint">{Math.round(m.confidenceScore)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
