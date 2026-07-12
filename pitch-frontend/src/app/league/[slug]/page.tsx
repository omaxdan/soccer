import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getLeagueBySlug, getLeagueTeams } from "@/lib/queries";
import { Crest } from "@/components/Crest";
import { StatCell, FormString } from "@/components/Primitives";
import { BarMeter } from "@/components/Meters";
import { Tabs } from "@/components/Tabs";
import { teamSlug } from "@/lib/slug";
import { n0, n1, km, pct } from "@/lib/intel";
import type { TeamIntelligence, TeamLite } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const l = await getLeagueBySlug(slug);
  return { title: l ? l.tournament.name : "League" };
}

type Row = { team: TeamLite; intel: TeamIntelligence | null };

export default async function LeagueHub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const league = await getLeagueBySlug(slug);
  if (!league) notFound();
  const { tournament, intel, gap } = league;
  const teams = await getLeagueTeams(tournament.id);

  const rankBy = (key: (r: Row) => number | null | undefined) =>
    [...teams].filter((r) => key(r) != null).sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0));

  const powerRanking = rankBy((r) => r.intel?.form_index);
  const readinessRanking = rankBy((r) => r.intel?.readiness_score);

  // ── OVERVIEW ──
  const overview = (
    <div className="space-y-4">
      {intel && (
        <Panel title="League conditions">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="Teams" value={n0(intel.team_count)} />
            <StatCell label="Avg readiness" value={n0(intel.avg_readiness)} color="var(--edge)" />
            <StatCell label="Avg form" value={n0(intel.avg_form)} />
            <StatCell label="Avg congestion" value={n0(intel.avg_congestion)} color="var(--warn)" />
          </div>
          <div className="mono mt-4 flex items-center justify-between border-t border-line pt-3 text-[0.7rem] text-muted">
            <span>Avg rest <span className="text-text">{n1(intel.avg_rest_days)}d</span></span>
            <span>Avg travel 14d <span className="text-text">{km(intel.avg_travel_14d)}</span></span>
          </div>
        </Panel>
      )}
      {gap && (
        <Panel title="Model calibration">
          <div className="flex items-center justify-between">
            <StatCell label="Hit rate" value={pct(gap.hit_rate_strict)} color={(gap.hit_rate_strict ?? 0) >= 0.55 ? "var(--edge)" : "var(--warn)"} />
            <StatCell label="Lift vs baseline" value={gap.lift_over_baseline != null ? `+${Math.round(gap.lift_over_baseline * 100)}` : "—"} color="var(--edge)" />
            <StatCell label="Sample" value={`${gap.total_picks}`} sub="picks" />
          </div>
          <p className="mono mt-3 text-[0.65rem] text-muted">
            {gap.meets_sample_gate ? "Calibrated — reads in this league carry a measured edge." : "Monitoring — still gathering evidence; treat reads with more caution."}
          </p>
        </Panel>
      )}
    </div>
  );

  // ── TEAMS (rankings) ──
  const teamsTab = (
    <div className="space-y-4">
      <RankPanel title="Power ranking (form)" rows={powerRanking} value={(r) => r.intel?.form_index} />
      <RankPanel title="Readiness ranking" rows={readinessRanking} value={(r) => r.intel?.readiness_score} color="var(--edge)" />
    </div>
  );

  // ── GOALS ──
  const bestForm = powerRanking.slice(0, 5);
  const goals = (
    <div className="space-y-4">
      <RankPanel title="In-form attacks" rows={bestForm} value={(r) => r.intel?.form_index} color="var(--amber)" />
      {intel && (
        <Panel title="Goal environment (league)">
          <p className="text-[0.8rem] leading-relaxed text-muted">
            League-average congestion sits at {n0(intel.avg_congestion)} and readiness at {n0(intel.avg_readiness)}.
            {(intel.avg_readiness ?? 0) >= 72 ? " Fresh legs across the division tend to support open, higher-scoring games." : " Heavier legs across the division can suppress scoring in congested weeks."}
          </p>
        </Panel>
      )}
    </div>
  );

  // ── STANDINGS (intelligence ranking) ──
  const standings = (
    <div className="space-y-3">
      <p className="mono text-[0.62rem] leading-relaxed text-faint">
        Intelligence ranking — ordered by form index, not official points. Enhanced standings (adjusted strength, expected position) populate from tournament_standings when available.
      </p>
      <Panel title="Enhanced ranking">
        <ol className="space-y-1">
          {powerRanking.map((r, idx) => (
            <li key={r.team.id}>
              <Link href={`/team/${teamSlug(r.team)}`} className="flex items-center gap-2.5 rounded px-2 py-2 transition-colors hover:bg-raised odd:bg-raised/30">
                <span className="mono w-5 shrink-0 text-[0.7rem] text-faint tnum">{idx + 1}</span>
                <Crest team={r.team} size={22} />
                <span className="truncate text-[0.82rem]">{r.team.name}</span>
                {r.intel?.last_5_results && <span className="ml-auto hidden sm:block"><FormString results={r.intel.last_5_results} /></span>}
                <span className="mono ml-auto shrink-0 text-[0.72rem] font-semibold text-amber tnum sm:ml-3">{n0(r.intel?.form_index)}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );

  // ── MARKETS ──
  const markets = (
    <div className="space-y-4">
      {gap ? (
        <Panel title="League betting tendencies">
          <div className="grid grid-cols-2 gap-3">
            <StatCell label="Strict hit rate" value={pct(gap.hit_rate_strict)} />
            <StatCell label="Lenient hit rate" value={pct(gap.hit_rate_lenient)} />
            <StatCell label="Baseline" value={pct(gap.baseline_rate)} />
            <StatCell label="Edge (lift)" value={gap.lift_over_baseline != null ? `+${Math.round(gap.lift_over_baseline * 100)}%` : "—"} color="var(--edge)" />
          </div>
        </Panel>
      ) : <Empty text="No market calibration data for this league yet." />}
      <Panel title="Predictability">
        <p className="text-[0.8rem] leading-relaxed text-muted">
          {intel && (intel.avg_readiness ?? 0) >= 72 ? "Higher average readiness tends to make favourites more reliable here." : "Variable readiness raises upset potential — favourites are less dependable."}
        </p>
      </Panel>
    </div>
  );

  return (
    <div className="space-y-4">
      <Link href="/leagues" className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text">← Leagues</Link>
      <section className="panel p-5">
        <div className="flex items-center gap-3">
          {tournament.logo_storage_path && <Crest team={{ id: tournament.id, name: tournament.name, short_name: null, crest_storage_path: tournament.logo_storage_path }} size={40} />}
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{tournament.name}</h1>
            <p className="mono text-[0.6rem] text-faint">{tournament.country ?? ""}</p>
          </div>
        </div>
      </section>
      <Tabs
        items={[
          { id: "overview", label: "Overview", content: overview },
          { id: "teams", label: "Teams", content: teamsTab },
          { id: "goals", label: "Goals", content: goals },
          { id: "standings", label: "Standings", content: standings },
          { id: "markets", label: "Markets", content: markets },
        ]}
      />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">{title}</h2>
      {children}
    </section>
  );
}
function RankPanel({ title, rows, value, color = "var(--amber)" }: { title: string; rows: Row[]; value: (r: Row) => number | null | undefined; color?: string }) {
  const max = Math.max(...rows.map((r) => value(r) ?? 0), 1);
  return (
    <Panel title={title}>
      <ol className="space-y-2">
        {rows.map((r, idx) => (
          <li key={r.team.id} className="flex items-center gap-2.5">
            <span className="mono w-5 shrink-0 text-[0.7rem] text-faint tnum">{idx + 1}</span>
            <Link href={`/team/${teamSlug(r.team)}`} className="flex min-w-0 flex-1 items-center gap-2 hover:text-amber">
              <Crest team={r.team} size={20} />
              <span className="truncate text-[0.8rem]">{r.team.name}</span>
            </Link>
            <div className="w-24 shrink-0"><BarMeter value={value(r)} max={max} color={color} height={6} /></div>
            <span className="mono w-8 shrink-0 text-right text-[0.72rem] font-semibold tnum" style={{ color }}>{n0(value(r))}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="mono panel p-6 text-center text-[0.7rem] text-muted">{text}</p>;
}
