import { getFavouriteLeagueIds } from "@/lib/preferences";
import { getLeagues, getLeagueGap } from "@/lib/queries";
import { BarMeter } from "@/components/Meters";
import { Collapsible } from "@/components/Collapsible";
import { LeaguesByRegion, type LeagueCard } from "@/components/LeaguesByRegion";
import { leagueSlug } from "@/lib/slug";
import { regionOf, REGIONS } from "@/lib/region";

export const dynamic = "force-dynamic";

export const metadata = { title: "Leagues" };

export default async function LeaguesPage() {
  const [leagues, gaps, favIds] = await Promise.all([
    getLeagues(),
    getLeagueGap(),
    getFavouriteLeagueIds(),
  ]);
  const favourites = new Set(favIds);
  // Favourites float to the top; everything else keeps its existing order.
  const ordered = [...leagues].sort(
    (a, b) =>
      Number(favourites.has(b.tournament_id)) - Number(favourites.has(a.tournament_id))
  );

  const gapByName = new Map(gaps.map((g) => [g.league_name.toLowerCase(), g]));

  const cards: LeagueCard[] = ordered.map((l) => {
    const name = l.tournament?.name ?? `League ${l.tournament_id}`;
    const gap = gapByName.get(name.toLowerCase());
    return {
      id: l.tournament_id,
      name,
      href: l.tournament ? `/league/${leagueSlug(l.tournament)}` : "#",
      teamCount: l.team_count ?? null,
      region: regionOf(l.tournament?.country),
      calibrated: gap ? gap.meets_sample_gate : null,
    };
  });
  const regionsPresent = REGIONS.filter((r) => cards.some((c) => c.region === r));

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <p className="eyebrow">League intelligence</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Where the engine is calibrated — and where it isn&rsquo;t.
        </h1>
        <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-muted">
          Coverage quality varies by competition. Pick a region to narrow the
          list — full conditions and calibration detail live on each league&rsquo;s
          own page.
        </p>
      </header>

      <LeaguesByRegion leagues={cards} regions={regionsPresent} />

      {/* Model performance — detail power users want, collapsed by default */}
      {gaps.length > 0 && (
        <Collapsible title="Model performance by league">
          <p className="mb-3 text-[0.75rem] leading-relaxed text-muted">
            Hit rate is the share of strong picks that landed; lift is the edge
            over a naive baseline. Leagues below the sample gate are still
            gathering evidence — treat their reads with more caution.
          </p>
          <div className="space-y-2.5">
            {gaps.map((g) => {
              // league_gap_summary stores these ready to display — 37.5 means
              // 37.5%. Multiplying produced 3750% and a lift of -2500.
              const strict = g.hit_rate_strict ?? null;
              const lift = g.lift_over_baseline ?? null;
              return (
                <div key={g.league_name} className="rounded-term border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[0.8rem] font-medium">{g.league_name}</span>
                    {g.meets_sample_gate ? (
                      <span className="mono shrink-0 rounded bg-edge/15 px-1.5 py-0.5 text-[0.5rem] font-bold tracking-wider text-edge">
                        CALIBRATED
                      </span>
                    ) : (
                      <span className="mono shrink-0 rounded bg-warn/15 px-1.5 py-0.5 text-[0.5rem] font-bold tracking-wider text-warn">
                        MONITORING
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="mono w-12 shrink-0 text-lg font-bold tnum" style={{ color: (strict ?? 0) >= 55 ? "var(--edge)" : "var(--warn)" }}>
                      {strict != null ? `${Math.round(strict)}%` : "—"}
                    </span>
                    <BarMeter value={strict} color={(strict ?? 0) >= 55 ? "var(--edge)" : "var(--warn)"} height={6} />
                    <span className="mono w-24 shrink-0 text-right text-[0.6rem] text-muted">
                      {g.total_picks} picks
                      {lift != null && (
                        <span className="ml-1" style={{ color: lift > 0 ? "var(--edge)" : "var(--risk)" }}>
                          {lift > 0 ? "+" : ""}{Math.round(lift)}%
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Collapsible>
      )}
    </div>
  );
}
