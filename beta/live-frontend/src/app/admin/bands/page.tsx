import Link from "next/link";
import { requireAdmin } from "@/components/AdminGuard";
import { getBandBacktests } from "@/lib/queries";
import { getLeagueBandCells, getLeagueBandSummary } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Confidence Bands" };

// Admin-only page. Deliberately no entry in components/Nav.tsx — reached by
// direct URL, same as every other /admin/* route this session.

const BAND_ORDER = ["Elite", "Strong", "Moderate", "Risky", "Avoid"];

const bandColor = (band: string) =>
  band === "Elite" ? "var(--edge)"
  : band === "Strong" ? "var(--cool)"
  : band === "Moderate" ? "var(--warn)"
  : band === "Risky" ? "var(--amber)"
  : "var(--risk)";

function n0(v: number | null | undefined) {
  return v == null ? "—" : Math.round(v).toLocaleString();
}
function pct1(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
function signedPct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default async function AdminBandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.ui;

  const sp = await searchParams;
  const leagueFilter = sp.league ?? "";
  const bandFilter = sp.band ?? "";

  // Every number on this page is a read of something already computed by the
  // shared confidence-band engine (beta/backend/src/lib/confidenceBand.ts) —
  // getBandBacktests() reuses the exact function the live Confidence
  // Calibration module already calls; getLeagueBandCells()/getLeagueBandSummary()
  // read league_gap_analytics/summary, written by the same shared engine via
  // jobs/archiveReadinessHistory.ts. Nothing here derives a rate, a lift, or
  // an interval from a raw match row.
  const [platform, cells, summaries] = await Promise.all([
    getBandBacktests(),
    getLeagueBandCells(),
    getLeagueBandSummary(),
  ]);

  const leagues = Array.from(new Set(cells.map((c) => c.leagueName))).sort();

  const filteredCells = cells.filter(
    (c) => (!leagueFilter || c.leagueName === leagueFilter) && (!bandFilter || c.band === bandFilter)
  );

  // Group filtered cells by league for the matrix table.
  const byLeague = new Map<string, typeof cells>();
  for (const c of filteredCells) {
    const list = byLeague.get(c.leagueName) ?? [];
    list.push(c);
    byLeague.set(c.leagueName, list);
  }
  const summaryByLeague = new Map(summaries.map((s) => [s.leagueName, s]));

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <p className="eyebrow">Admin · Internal analysis</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Confidence Band Analytics</h1>
        <p className="mt-2 max-w-2xl text-[0.76rem] leading-relaxed text-muted">
          Historical accuracy of Elite / Strong / Moderate / Risky / Avoid, platform-wide and by league.
          Every number below is read from precomputed tables — this page performs no calculation itself.
        </p>
      </header>

      {/* Platform section — one row per band, from signal_backtests via the
          exact function the live match report already uses. */}
      <section>
        <h2 className="label-cap mb-2 px-1">Platform — by band</h2>
        <div className="grid gap-2 sm:grid-cols-5">
          {BAND_ORDER.map((band) => {
            const b = platform[band];
            return (
              <div key={band} className="panel p-3">
                <p className="mono text-[0.66rem] font-semibold uppercase tracking-widest" style={{ color: bandColor(band) }}>
                  {band}
                </p>
                <p className="mono tnum mt-1 text-xl font-semibold text-text">{b ? pct1(b.rate) : "—"}</p>
                <p className="mono text-[0.6rem] text-faint">
                  {b ? `n=${n0(b.sample)} · ${n0(b.hits)}W / ${n0(b.sample - b.hits)}L` : "not yet measured"}
                </p>
                {b && (
                  <>
                    <p className="mono mt-1 text-[0.6rem] text-faint">
                      95% CI {b.ciLow != null && b.ciHigh != null ? `${b.ciLow.toFixed(1)}–${b.ciHigh.toFixed(1)}%` : "—"}
                    </p>
                    <p className="mono text-[0.6rem] text-faint">lift {b.lift.toFixed(2)}×</p>
                    <p
                      className="mono mt-1.5 text-[0.56rem] font-bold tracking-widest"
                      style={{ color: b.isCalibrated ? "var(--edge)" : "var(--faint)" }}
                    >
                      {b.isCalibrated ? "CALIBRATED" : "NOT CALIBRATED"}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Filters — plain GET form, results live in the URL. */}
      <form action="/admin/bands" method="get" className="panel flex flex-wrap items-end gap-2 p-3">
        <select name="league" defaultValue={leagueFilter} className="mono rounded-term border border-line bg-raised px-2 py-1.5 text-[0.68rem] text-text">
          <option value="">All leagues</option>
          {leagues.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select name="band" defaultValue={bandFilter} className="mono rounded-term border border-line bg-raised px-2 py-1.5 text-[0.68rem] text-text">
          <option value="">All bands</option>
          {BAND_ORDER.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <button type="submit" className="mono rounded-term px-3 py-1.5 text-[0.64rem] font-semibold tracking-widest" style={{ color: "var(--ink)", background: "var(--amber)" }}>
          FILTER
        </button>
        {(leagueFilter || bandFilter) && (
          <Link href="/admin/bands" className="mono text-[0.62rem] tracking-widest text-faint">
            CLEAR
          </Link>
        )}
      </form>

      {/* League section — league x band matrix, from league_gap_analytics. */}
      <section className="panel overflow-x-auto p-4">
        <h2 className="label-cap mb-2">League performance</h2>
        {byLeague.size === 0 ? (
          <p className="text-[0.72rem] text-muted">No league cells match this filter.</p>
        ) : (
          <table className="w-full min-w-[42rem] border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap py-1.5 pr-3 text-left font-normal">League</th>
                {BAND_ORDER.map((b) => (
                  <th key={b} className="label-cap px-2 py-1.5 text-right font-normal">{b}</th>
                ))}
                <th className="label-cap py-1.5 pl-2 text-right font-normal">Hit rate</th>
                <th className="label-cap py-1.5 pl-2 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...byLeague.entries()]
                .sort((a, b) => (summaryByLeague.get(b[0])?.totalPicks ?? 0) - (summaryByLeague.get(a[0])?.totalPicks ?? 0))
                .map(([league, leagueCells]) => {
                  const cellByBand = new Map(leagueCells.map((c) => [c.band, c]));
                  const summary = summaryByLeague.get(league);
                  return (
                    <tr key={league} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-3 text-text">{league}</td>
                      {BAND_ORDER.map((band) => {
                        const c = cellByBand.get(band);
                        return (
                          <td key={band} className="mono px-2 py-1.5 text-right text-muted">
                            {c ? c.totalPicks : "—"}
                          </td>
                        );
                      })}
                      <td className="mono py-1.5 pl-2 text-right text-text">{pct1(summary?.hitRateStrict)}</td>
                      <td className="mono py-1.5 pl-2 text-right text-faint">{summary?.bandStatus ?? "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </section>

      {/* Historical performance detail — one row per league x band cell. */}
      <section className="panel overflow-x-auto p-4">
        <h2 className="label-cap mb-2">Historical performance — detail</h2>
        {filteredCells.length === 0 ? (
          <p className="text-[0.72rem] text-muted">No cells match this filter.</p>
        ) : (
          <table className="w-full min-w-[46rem] border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap py-1.5 pr-3 text-left font-normal">League</th>
                <th className="label-cap px-2 py-1.5 text-left font-normal">Band</th>
                <th className="label-cap px-2 py-1.5 text-right font-normal">Matches</th>
                <th className="label-cap px-2 py-1.5 text-right font-normal">Hit rate</th>
                <th className="label-cap px-2 py-1.5 text-right font-normal">Lenient</th>
                <th className="label-cap px-2 py-1.5 text-right font-normal">Baseline</th>
                <th className="label-cap py-1.5 pl-2 text-right font-normal">Lift</th>
              </tr>
            </thead>
            <tbody>
              {filteredCells
                .sort((a, b) => b.totalPicks - a.totalPicks)
                .map((c) => (
                  <tr key={`${c.leagueName}::${c.band}`} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-3 text-text">{c.leagueName}</td>
                    <td className="mono px-2 py-1.5 font-semibold" style={{ color: bandColor(c.band) }}>{c.band}</td>
                    <td className="mono px-2 py-1.5 text-right text-muted">{c.totalPicks}</td>
                    <td className="mono px-2 py-1.5 text-right text-text">{pct1(c.hitRateStrict)}</td>
                    <td className="mono px-2 py-1.5 text-right text-muted">{pct1(c.hitRateLenient)}</td>
                    <td className="mono px-2 py-1.5 text-right text-faint">{pct1(c.baselineRate)}</td>
                    <td className="mono py-1.5 pl-2 text-right" style={{ color: (c.liftOverBaseline ?? 0) > 0 ? "var(--edge)" : "var(--faint)" }}>
                      {signedPct(c.liftOverBaseline)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[0.64rem] leading-relaxed text-faint">
        Platform figures from signal_backtests (CBAND_* rows), refreshed by backtest:bands. League figures from
        league_gap_analytics/league_gap_summary, refreshed by archive:readiness. Both are written by the shared
        scoring engine in lib/confidenceBand.ts — this page reads, it does not compute.
      </p>
    </div>
  );
}
