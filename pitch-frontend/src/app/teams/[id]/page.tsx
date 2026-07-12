import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getTeam, getTeamIntel, getTeamUpcoming } from "@/lib/queries";
import { Crest } from "@/components/Crest";
import { Section, StatCell, FormString } from "@/components/Primitives";
import { BarMeter } from "@/components/Meters";
import { MatchCard } from "@/components/MatchCard";
import {
  n0, n1, pct, km, money, readinessTier, fatigueTier,
  dependencyVerdict, positionLabel,
} from "@/lib/intel";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const t = await getTeam(Number(id));
  return { title: t ? t.name : "Team" };
}

export default async function TeamHub({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const teamId = Number(id);
  const team = await getTeam(teamId);
  if (!team) notFound();

  const { intel, goalDep, injury, formQuality, venue, momentum, depth } =
    await getTeamIntel(teamId);
  const upcoming = await getTeamUpcoming(teamId);

  const rt = readinessTier(intel?.readiness_score);
  const ft = fatigueTier(intel?.fatigue_index);
  const dep = dependencyVerdict(goalDep);

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text"
      >
        ← Board
      </Link>

      {/* Identity */}
      <section className="panel p-5">
        <div className="flex items-center gap-3">
          <Crest team={team} size={48} />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{team.name}</h1>
            <p className="mono text-[0.6rem] text-faint">
              {team.country ?? ""}
              {intel?.active_competitions
                ? ` · ${intel.active_competitions} active competition${intel.active_competitions > 1 ? "s" : ""}`
                : ""}
            </p>
          </div>
          {intel?.last_5_results && (
            <div className="ml-auto">
              <div className="label-cap mb-1 text-right">Form</div>
              <FormString results={intel.last_5_results} />
            </div>
          )}
        </div>
      </section>

      {/* Readiness snapshot */}
      {intel && (
        <Section index="01" title="Readiness snapshot">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="Readiness" value={n0(intel.readiness_score)} sub={rt.label} color={rt.color} />
            <StatCell label="Fatigue" value={n0(intel.fatigue_index)} sub={ft.label} color={ft.color} />
            <StatCell label="Form index" value={n0(intel.form_index)} />
            <StatCell label="Stability" value={n0(intel.squad_stability_score)} sub="squad" />
          </div>
          <div className="mt-4 space-y-2.5">
            <LabeledBar label="Readiness" value={intel.readiness_score} color={rt.color} />
            <LabeledBar label="Squad depth" value={intel.squad_depth_score} color="var(--cool)" />
            <LabeledBar label="Congestion load" value={intel.congestion_score} color="var(--warn)" />
          </div>
          <div className="mono mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[0.65rem] text-muted">
            <span>Rest avg <span className="text-text">{n1(intel.rest_days_avg)}d</span></span>
            <span>Travel 14d <span className="text-text">{km(intel.travel_load_km)}</span></span>
            <span>Last-5 pts <span className="text-text">{n0(intel.last_5_points)}</span></span>
          </div>
        </Section>
      )}

      {/* Attack profile / goal dependency */}
      {goalDep && (
        <Section index="02" title="Attacking profile">
          <div className="flex items-center justify-between">
            <div>
              <div className="label-cap">Goal dependency</div>
              <div className="mono mt-0.5 text-lg font-semibold" style={{ color: dep.color }}>
                {dep.label}
              </div>
            </div>
            <div className="text-right">
              <div className="label-cap">Top scorer share</div>
              <div className="mono mt-0.5 text-2xl font-bold tnum" style={{ color: dep.color }}>
                {dep.pct != null ? `${Math.round(dep.pct)}%` : "—"}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <BarMeter value={dep.pct} color={dep.color} height={8} />
          </div>
          <div className="mono mt-3 grid grid-cols-3 gap-2 text-[0.65rem] text-muted">
            <span>Total goals <span className="text-text">{n0(goalDep.total_goals)}</span></span>
            <span>Top scorer <span className="text-text">{n0(goalDep.top_scorer_goals)}</span></span>
            <span>Top-2 share <span className="text-text">{pct(goalDep.top_2_scorers_pct)}</span></span>
          </div>
          {goalDep.top_scorer_no_backup && (
            <p className="mono mt-3 rounded-term border border-risk/30 bg-risk/10 p-2 text-[0.7rem] text-risk">
              ⚠ One-man attack: no comparable backup if the top scorer misses.
            </p>
          )}
        </Section>
      )}

      {/* Form quality */}
      {formQuality && (
        <Section index="03" title="Form quality">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="Opp-adj form" value={n0(formQuality.opponent_adjusted_form)} />
            <StatCell label="Sched strength" value={n0(formQuality.strength_of_schedule)} />
            <StatCell label="Giant-killer" value={n0(formQuality.giant_killer_score)} color={((formQuality.giant_killer_score ?? 0) >= 55) ? "var(--amber)" : undefined} />
            <StatCell
              label="xPts delta"
              value={`${(formQuality.performance_delta ?? 0) > 0 ? "+" : ""}${n1(formQuality.performance_delta)}`}
              color={(formQuality.performance_delta ?? 0) >= 0 ? "var(--edge)" : "var(--risk)"}
            />
          </div>
          <p className="mt-3 text-[0.8rem] leading-relaxed text-muted">
            {formDeltaNarrative(formQuality.performance_delta, formQuality.expected_points, formQuality.actual_points, team.short_name || team.name)}
          </p>
        </Section>
      )}

      {/* Venue + momentum split */}
      <div className="grid gap-4 sm:grid-cols-2">
        {venue && (
          <Section index="04" title="Venue splits">
            <div className="space-y-3">
              <SplitRow label="Home win %" home={venue.home_win_pct} away={venue.away_win_pct} />
              <SplitRow label="Points/game" home={venue.home_points_per_game} away={venue.away_points_per_game} fmt={(v) => n1(v)} />
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <StatCell label="Venue advantage" value={n0(venue.venue_advantage_score)} sub="/100" color="var(--amber)" />
            </div>
          </Section>
        )}
        {momentum && (
          <Section index="05" title="Momentum">
            <StatCell
              label="Trend"
              value={momentum.trend ? momentum.trend.toUpperCase() : "—"}
              color={momentum.trend === "rising" ? "var(--edge)" : momentum.trend === "falling" ? "var(--risk)" : "var(--warn)"}
            />
            <div className="mono mt-3 flex items-center gap-3 text-[0.7rem] text-muted">
              <span>Prior 5: <span className="text-text">{n0(momentum.prior_5_points)}</span></span>
              <span>→</span>
              <span>Last 5: <span className="text-text">{n0(momentum.last_5_points)}</span></span>
            </div>
            <div className="mt-3">
              <BarMeter value={momentum.momentum_score} color="var(--edge)" height={8} />
            </div>
          </Section>
        )}
      </div>

      {/* Injury impact */}
      {injury && (injury.injured_count ?? 0) > 0 && (
        <Section index="06" title="Injury impact">
          <div className="grid grid-cols-3 gap-3">
            <StatCell label="Players out" value={n0(injury.injured_count)} color="var(--risk)" />
            <StatCell label="Goals lost" value={n0(injury.goals_lost)} />
            <StatCell label="Assists lost" value={n0(injury.assists_lost)} />
          </div>
          <p className="mono mt-3 text-[0.7rem] text-muted">
            Importance lost: <span className="text-risk">{n0(injury.total_importance_lost)}</span> pts
          </p>
        </Section>
      )}

      {/* Position depth */}
      {depth.length > 0 && (
        <Section index="07" title="Squad depth by line">
          <ul className="space-y-3">
            {depth.map((d) => (
              <li key={d.position_code} className="flex items-center gap-3">
                <span className="mono w-24 shrink-0 text-[0.65rem] uppercase tracking-wide text-muted">
                  {positionLabel(d.position_code)}
                </span>
                <BarMeter
                  value={d.available_count}
                  max={d.player_count || 1}
                  color={d.injured_count > 0 ? "var(--warn)" : "var(--edge)"}
                  height={8}
                />
                <span className="mono w-16 shrink-0 text-right text-[0.65rem] text-muted tnum">
                  {d.available_count}/{d.player_count}
                </span>
                <span className="mono hidden w-14 shrink-0 text-right text-[0.6rem] text-faint sm:block">
                  {money(d.total_market_value)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <Section index="08" title="Next fixtures">
          <div className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function LabeledBar({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="mono w-28 shrink-0 text-[0.65rem] uppercase tracking-wide text-muted">{label}</span>
      <BarMeter value={value} color={color} height={8} />
      <span className="mono w-8 text-right text-[0.7rem] text-text tnum">{n0(value)}</span>
    </div>
  );
}

function SplitRow({
  label, home, away, fmt = (v) => `${Math.round(v ?? 0)}`,
}: {
  label: string;
  home: number | null | undefined;
  away: number | null | undefined;
  fmt?: (v: number | null | undefined) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label-cap">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="mono w-10 text-right text-[0.75rem] font-semibold text-edge tnum">{fmt(home)}</span>
        <div className="flex-1"><BarMeter value={home} max={Math.max(home ?? 0, away ?? 0, 1) * (label.includes("%") ? 1 : 1) || 100} color="var(--edge)" height={6} /></div>
        <span className="mono w-8 text-[0.55rem] text-faint">HOME</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="mono w-10 text-right text-[0.75rem] font-semibold text-cool tnum">{fmt(away)}</span>
        <div className="flex-1"><BarMeter value={away} max={Math.max(home ?? 0, away ?? 0, 1) || 100} color="var(--cool)" height={6} /></div>
        <span className="mono w-8 text-[0.55rem] text-faint">AWAY</span>
      </div>
    </div>
  );
}

function formDeltaNarrative(
  delta: number | null, xp: number | null, ap: number | null, name: string
): string {
  if (delta == null) return "";
  if (delta >= 2)
    return `${name} are outperforming the underlying numbers — banking ${n1(ap)} points against an expected ${n1(xp)}. That over-performance often regresses, a mispricing angle worth watching.`;
  if (delta <= -2)
    return `${name} are underperforming their process — ${n1(ap)} points won versus ${n1(xp)} expected. The performances suggest better results are due.`;
  return `${name} are tracking close to their expected points (${n1(ap)} actual vs ${n1(xp)} expected) — results are earned, not lucky.`;
}
