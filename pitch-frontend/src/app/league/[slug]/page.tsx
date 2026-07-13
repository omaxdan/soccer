import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getLeagueBySlug, getLeagueTeams, getLeagueStandings, getFixtureDifficultyMap } from "@/lib/queries";
import { Crest } from "@/components/Crest";
import { StatCell } from "@/components/Primitives";
import { BarMeter } from "@/components/Meters";
import { Tabs } from "@/components/Tabs";
import { teamSlug } from "@/lib/slug";
import { n0, n1, km, pct, difficultyBand } from "@/lib/intel";
import { Explain } from "@/components/Explain";
import type { GlossaryKey } from "@/lib/glossary";
import type { TeamIntelligence, TeamLite, TournamentStanding } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const l = await getLeagueBySlug(slug);
  return { title: l ? l.tournament.name : "League" };
}

type Row = { team: TeamLite; intel: TeamIntelligence | null; betting: import("@/lib/types").TeamBettingIntelligence | null };

export default async function LeagueHub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const league = await getLeagueBySlug(slug);
  if (!league) notFound();
  const { tournament, intel, gap } = league;
  const [teams, table] = await Promise.all([
    getLeagueTeams(tournament.id),
    getLeagueStandings(tournament.id),
  ]);
  const diffMap = await getFixtureDifficultyMap(teams.map((r) => r.team.id));

  const rankBy = (key: (r: Row) => number | null | undefined) =>
    [...teams].filter((r) => key(r) != null).sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0));

  const powerRanking = rankBy((r) => r.intel?.form_index);
  const readinessRanking = rankBy((r) => r.intel?.readiness_score);
  const qualityRanking = rankBy((r) => r.betting?.team_quality_score);

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

  // ── STANDINGS (real league table from tournament_standings) ──
  const standingsTab = table.length > 0 ? (
    <div className="space-y-2">
      <div className="panel overflow-hidden p-0">
        <div className="mono grid grid-cols-[1.5rem_1fr_repeat(4,1.6rem)_2rem] items-center gap-1 border-b border-line px-3 py-2 text-[0.55rem] uppercase tracking-wide text-faint sm:grid-cols-[1.5rem_1fr_repeat(7,1.7rem)_2rem]">
          <span>#</span><span>Team</span>
          <span className="text-right">P</span>
          <span className="hidden text-right sm:block">W</span>
          <span className="hidden text-right sm:block">D</span>
          <span className="hidden text-right sm:block">L</span>
          <span className="text-right">GF</span>
          <span className="text-right">GA</span>
          <span className="text-right">GD</span>
          <span className="text-right text-amber">Pts</span>
        </div>
        {table.map((s) => {
          const gd = (s.scores_for ?? 0) - (s.scores_against ?? 0);
          return (
            <Link key={s.team.id} href={`/team/${teamSlug(s.team)}`} className="mono grid grid-cols-[1.5rem_1fr_repeat(4,1.6rem)_2rem] items-center gap-1 px-3 py-2 text-[0.72rem] transition-colors odd:bg-raised/30 hover:bg-raised sm:grid-cols-[1.5rem_1fr_repeat(7,1.7rem)_2rem]">
              <span className="text-faint tnum">{s.position ?? "—"}</span>
              <span className="flex min-w-0 items-center gap-1.5"><Crest team={s.team} size={18} /><span className="truncate">{s.team.short_name || s.team.name}</span></span>
              <span className="text-right tnum">{n0(s.matches)}</span>
              <span className="hidden text-right tnum sm:block">{n0(s.wins)}</span>
              <span className="hidden text-right tnum sm:block">{n0(s.draws)}</span>
              <span className="hidden text-right tnum sm:block">{n0(s.losses)}</span>
              <span className="text-right tnum">{n0(s.scores_for)}</span>
              <span className="text-right tnum">{n0(s.scores_against)}</span>
              <span className="text-right tnum" style={{ color: gd > 0 ? "var(--edge)" : gd < 0 ? "var(--risk)" : "var(--muted)" }}>{gd > 0 ? "+" : ""}{gd}</span>
              <span className="text-right font-bold text-amber tnum">{n0(s.points)}</span>
            </Link>
          );
        })}
      </div>
      <p className="mono text-[0.55rem] text-faint">Official table from tournament_standings.</p>
    </div>
  ) : <Empty text="Standings unavailable for this league yet." />;

  // ── TEAMS (league-scoped roster) ──
  const teamsTab = teams.length > 0 ? (
    <Panel title={`Clubs in ${tournament.name}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {teams.map((r) => {
          const band = difficultyBand(diffMap[r.team.id]?.next_5_difficulty);
          return (
            <Link key={r.team.id} href={`/team/${teamSlug(r.team)}`} className="flex items-center gap-2 rounded-term border border-line p-2.5 transition-colors hover:border-faint hover:bg-raised">
              <Crest team={r.team} size={24} />
              <span className="min-w-0 flex-1 truncate text-[0.78rem]">{r.team.short_name || r.team.name}</span>
              {diffMap[r.team.id]?.next_5_difficulty != null && (
                <span className="mono shrink-0 text-[0.5rem] font-semibold uppercase" style={{ color: band.color }} title="Next-5 fixture difficulty">{band.label}</span>
              )}
            </Link>
          );
        })}
      </div>
    </Panel>
  ) : <Empty text="No teams found for this league." />;

  // ── POWER RANKINGS (intelligence, league-scoped) ──
  const powerTab = powerRanking.length > 0 ? (
    <div className="space-y-4">
      <p className="mono text-[0.6rem] leading-relaxed text-faint">Intelligence rankings — distinct from the official table. Scoped to this league only.</p>
      <RankPanel title="Power ranking (form index)" rows={powerRanking} value={(r) => r.intel?.form_index} explain="power_ranking" />
      <RankPanel title="Readiness ranking" rows={readinessRanking} value={(r) => r.intel?.readiness_score} color="var(--edge)" explain="readiness" />
      {qualityRanking.length > 0 && (
        <RankPanel title="Quality ranking (attack + defence)" rows={qualityRanking} value={(r) => r.betting?.team_quality_score} color="var(--warn)" explain="team_quality_score" />
      )}
    </div>
  ) : <Empty text="Intelligence rankings still processing for this league." />;

  // ── FIXTURES (next-5 difficulty, league-wide) ──
  const withDifficulty = teams.filter((r) => diffMap[r.team.id]?.next_5_difficulty != null);
  const hardestFixtures = [...withDifficulty].sort((a, b) => (diffMap[b.team.id].next_5_difficulty ?? 0) - (diffMap[a.team.id].next_5_difficulty ?? 0)).slice(0, 5);
  const easiestFixtures = [...withDifficulty].sort((a, b) => (diffMap[a.team.id].next_5_difficulty ?? 0) - (diffMap[b.team.id].next_5_difficulty ?? 0)).slice(0, 5);
  const fixturesTab = withDifficulty.length > 0 ? (
    <div className="space-y-4">
      <Panel title="Hardest run of fixtures (next 5)" explain="fixture_difficulty">
        <ol className="space-y-2">
          {hardestFixtures.map((r, idx) => {
            const band = difficultyBand(diffMap[r.team.id]?.next_5_difficulty);
            return (
              <li key={r.team.id} className="flex items-center gap-2.5">
                <span className="mono w-5 shrink-0 text-[0.7rem] text-faint tnum">{idx + 1}</span>
                <Link href={`/team/${teamSlug(r.team)}`} className="flex min-w-0 flex-1 items-center gap-2 hover:text-amber">
                  <Crest team={r.team} size={20} />
                  <span className="truncate text-[0.8rem]">{r.team.name}</span>
                </Link>
                <span className="mono shrink-0 text-[0.65rem] font-semibold" style={{ color: band.color }}>{band.label}</span>
                <span className="mono w-10 shrink-0 text-right text-[0.65rem] text-faint tnum">{n1(diffMap[r.team.id]?.next_5_difficulty)}</span>
              </li>
            );
          })}
        </ol>
      </Panel>
      <Panel title="Easiest run of fixtures (next 5)">
        <ol className="space-y-2">
          {easiestFixtures.map((r, idx) => {
            const band = difficultyBand(diffMap[r.team.id]?.next_5_difficulty);
            return (
              <li key={r.team.id} className="flex items-center gap-2.5">
                <span className="mono w-5 shrink-0 text-[0.7rem] text-faint tnum">{idx + 1}</span>
                <Link href={`/team/${teamSlug(r.team)}`} className="flex min-w-0 flex-1 items-center gap-2 hover:text-amber">
                  <Crest team={r.team} size={20} />
                  <span className="truncate text-[0.8rem]">{r.team.name}</span>
                </Link>
                <span className="mono shrink-0 text-[0.65rem] font-semibold" style={{ color: band.color }}>{band.label}</span>
                <span className="mono w-10 shrink-0 text-right text-[0.65rem] text-faint tnum">{n1(diffMap[r.team.id]?.next_5_difficulty)}</span>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  ) : <Empty text="Fixture difficulty not yet computed for this league's teams." />;

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
          { id: "standings", label: "Standings", content: standingsTab },
          { id: "teams", label: "Teams", content: teamsTab },
          { id: "power", label: "Power Rankings", content: powerTab },
          { id: "fixtures", label: "Fixtures", content: fixturesTab },
          { id: "goals", label: "Goals", content: goals },
          { id: "markets", label: "Markets", content: markets },
        ]}
      />
    </div>
  );
}

function Panel({ title, children, explain }: { title: string; children: React.ReactNode; explain?: GlossaryKey }) {
  return (
    <section className="panel p-4">
      <h2 className="mono mb-3 flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">{title}{explain && <Explain metric={explain} />}</h2>
      {children}
    </section>
  );
}
function RankPanel({ title, rows, value, color = "var(--amber)", explain }: { title: string; rows: Row[]; value: (r: Row) => number | null | undefined; color?: string; explain?: GlossaryKey }) {
  const max = Math.max(...rows.map((r) => value(r) ?? 0), 1);
  return (
    <Panel title={title} explain={explain}>
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
