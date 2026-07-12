import { getLeagues, getLeagueGap } from "@/lib/queries";
import { Section, StatCell } from "@/components/Primitives";
import { BarMeter } from "@/components/Meters";
import { n0, n1, km, pct } from "@/lib/intel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Leagues" };

export default async function LeaguesPage() {
  const [leagues, gaps] = await Promise.all([getLeagues(), getLeagueGap()]);

  const gapByName = new Map(gaps.map((g) => [g.league_name.toLowerCase(), g]));

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <p className="eyebrow">League intelligence</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Where the engine is calibrated — and where it isn&rsquo;t.
        </h1>
        <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-muted">
          Coverage quality varies by competition. These are the league-level
          conditions and the model&rsquo;s measured hit rate against baseline,
          so you know which reads to trust.
        </p>
      </header>

      {/* League conditions */}
      <Section index="01" title="League conditions">
        <div className="grid gap-3 sm:grid-cols-2">
          {leagues.map((l) => {
            const name = l.tournament?.name ?? `League ${l.tournament_id}`;
            return (
              <div key={l.tournament_id} className="panel-raised p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold tracking-tight">{name}</h3>
                  <span className="mono text-[0.6rem] text-faint">
                    {l.team_count} teams
                  </span>
                </div>
                <div className="space-y-2">
                  <CondBar label="Avg readiness" value={l.avg_readiness} color="var(--edge)" />
                  <CondBar label="Avg form" value={l.avg_form} color="var(--cool)" />
                  <CondBar label="Congestion" value={l.avg_congestion} color="var(--warn)" />
                </div>
                <div className="mono mt-3 flex items-center justify-between border-t border-line pt-2 text-[0.6rem] text-muted">
                  <span>Rest {n1(l.avg_rest_days)}d</span>
                  <span>Travel 14d {km(l.avg_travel_14d)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Model performance */}
      {gaps.length > 0 && (
        <Section index="02" title="Model performance by league">
          <p className="mb-3 text-[0.75rem] leading-relaxed text-muted">
            Hit rate is the share of strong picks that landed; lift is the edge
            over a naive baseline. Leagues below the sample gate are still
            gathering evidence — treat their reads with more caution.
          </p>
          <div className="space-y-2.5">
            {gaps.map((g) => {
              const strict = g.hit_rate_strict != null ? g.hit_rate_strict * 100 : null;
              const lift = g.lift_over_baseline != null ? g.lift_over_baseline * 100 : null;
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
                          {lift > 0 ? "+" : ""}{Math.round(lift)}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

function CondBar({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="mono w-24 shrink-0 text-[0.6rem] uppercase tracking-wide text-muted">{label}</span>
      <BarMeter value={value} color={color} height={6} />
      <span className="mono w-7 text-right text-[0.65rem] text-text tnum">{n0(value)}</span>
    </div>
  );
}
