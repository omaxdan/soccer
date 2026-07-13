import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  getTeamBySlug, getTeamIntel, getTeamUpcoming, getTeamSeasonStats, getFixtureDifficulty,
  getKeyPlayers, getRecentForm,
} from "@/lib/queries";
import { computePerformance } from "@/lib/performance";
import { computeTeamProfile, type MarketRead } from "@/lib/teamProfile";
import { Crest } from "@/components/Crest";
import { StatCell, FormString } from "@/components/Primitives";
import { BarMeter } from "@/components/Meters";
import { MatchCard } from "@/components/MatchCard";
import { Tabs } from "@/components/Tabs";
import { InsightList, SignalGrid } from "@/components/PerformanceIntel";
import { n0, n1, pct, km, money, dependencyVerdict, positionLabel, difficultyBand, confidenceBand } from "@/lib/intel";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const t = await getTeamBySlug(slug);
  return { title: t ? t.name : "Team" };
}

export default async function TeamHub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) notFound();

  const { intel, betting: bettingIntelRow, motivation, goalDep, injury, formQuality, venue, momentum, depth } = await getTeamIntel(team.id);
  const [upcoming, seasonStats, difficulty, keyPlayers, recentForm] = await Promise.all([
    getTeamUpcoming(team.id),
    getTeamSeasonStats(team.id),
    getFixtureDifficulty(team.id),
    getKeyPlayers(team.id, 10),
    getRecentForm(team.id, 6),
  ]);
  const perf = seasonStats ? computePerformance(seasonStats) : null;
  const profile = computeTeamProfile({ intel, betting: bettingIntelRow, formQuality, venue, goalDep, perf });
  const dep = dependencyVerdict(goalDep);

  // ── OVERVIEW ──
  const overview = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ScoreTile label="Team quality" value={profile.quality.overall} big />
        <ScoreTile label="Readiness" value={intel?.readiness_score ?? null} />
        <ScoreTile label="Predictability" value={profile.predictability} />
        <ScoreTile label="Volatility" value={profile.volatility} invert />
      </div>
      <Panel title="Quality breakdown">
        <BarRow label="Attack" value={profile.quality.attack} color="var(--amber)" />
        <BarRow label="Defence" value={profile.quality.defence} color="var(--cool)" />
        <BarRow label="Squad depth" value={profile.quality.squad} color="var(--edge)" />
      </Panel>
      {perf?.style && (
        <Panel title="Style profile">
          <p className="mono text-sm font-semibold text-amber">{perf.style.identity}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {perf.style.traits.map((t) => (
              <span key={t} className="mono rounded border border-line px-2 py-0.5 text-[0.6rem] text-muted">{t}</span>
            ))}
          </div>
        </Panel>
      )}
      {venue && (
        <Panel title="Venue advantage">
          <div className="flex items-center justify-between">
            <StatCell label="Advantage score" value={n0(venue.venue_advantage_score)} sub="/100" color="var(--amber)" />
            {intel?.last_5_results && <div className="text-right"><div className="label-cap mb-1">Form</div><FormString results={intel.last_5_results} /></div>}
          </div>
        </Panel>
      )}
      {motivation && motivation.overall_motivation_score != null && (
        <Panel title="Motivation">
          <div className="flex items-center justify-between">
            <StatCell label="Overall" value={n0(motivation.overall_motivation_score)} sub="/100" color={confidenceBand(motivation.overall_motivation_score).color} />
            <StatCell label="Band" value={motivation.motivation_band ?? "—"} color={confidenceBand(motivation.overall_motivation_score).color} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {[
              ["Momentum", motivation.momentum_factor],
              ["Quality", motivation.quality_factor],
              ["Venue", motivation.venue_factor],
              ["Freshness", motivation.fatigue_factor],
              ["External", motivation.external_motivation],
            ].map(([lbl, v]) => (
              <div key={lbl as string} className="rounded border border-line bg-raised/40 p-2 text-center">
                <div className="mono text-[0.5rem] tracking-wide text-faint">{lbl}</div>
                <div className="mono text-[0.75rem] font-bold tnum">{n0(v as number | null)}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );

  // ── ATTACK ──
  const attack = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <ScoreTile label="Attack efficiency" value={perf?.attackEfficiency ?? null} big />
        <ScoreTile label="Goal dependency" value={dep.pct != null ? Math.round(dep.pct) : null} invert suffix="%" subtitle={dep.label} />
      </div>
      {perf && perf.attack.length > 0 ? (
        <Panel title="Attacking intelligence"><InsightList insights={perf.attack} /></Panel>
      ) : (
        <Empty note="shots" />
      )}
      {goalDep && (
        <Panel title="Goal distribution">
          <div className="mono grid grid-cols-3 gap-2 text-[0.7rem] text-muted">
            <span>Total <span className="text-text">{n0(goalDep.total_goals)}</span></span>
            <span>Top scorer <span className="text-text">{n0(goalDep.top_scorer_goals)}</span></span>
            <span>Top-2 <span className="text-text">{pct(goalDep.top_2_scorers_pct)}</span></span>
          </div>
          {goalDep.top_scorer_no_backup && (
            <p className="mono mt-2 rounded-term border border-risk/30 bg-risk/10 p-2 text-[0.7rem] text-risk">
              ⚠ One-man attack: no comparable backup if the top scorer misses.
            </p>
          )}
        </Panel>
      )}
    </div>
  );

  // ── DEFENCE ──
  const defence = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <ScoreTile label="Defence rating" value={profile.quality.defence} big />
        <div className="panel-raised p-3">
          <div className="label-cap">Fragility</div>
          <div className="mono mt-1 text-2xl font-bold" style={{ color: perf?.defenseFragility === "HIGH" ? "var(--risk)" : perf?.defenseFragility === "MEDIUM" ? "var(--warn)" : "var(--edge)" }}>
            {perf?.defenseFragility ?? "—"}
          </div>
          <div className="mono text-[0.55rem] text-faint">goal vulnerability</div>
        </div>
      </div>
      {perf && perf.defense.length > 0 ? (
        <Panel title="Defensive intelligence"><InsightList insights={perf.defense} /></Panel>
      ) : (
        <Empty note="shots against" />
      )}
    </div>
  );

  // ── SQUAD ──
  const squad = (
    <div className="space-y-4">
      {keyPlayers.length > 0 && (
        <Panel title="Key players">
          <div>
            {keyPlayers.map((p) => {
              const pi = p.intelligence;
              return (
                <div key={p.id} className="flex items-center gap-2.5 border-b border-line py-2 last:border-0">
                  <span className={`mono grid h-7 w-7 shrink-0 place-items-center rounded text-[0.62rem] font-bold ${p.current_injury ? "text-risk" : "text-muted"}`} style={{ background: "var(--raised)" }}>
                    {(p.position ?? "?").charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[0.8rem]">{p.short_name || p.name}</span>
                      {p.current_injury && <span className="mono shrink-0 text-[0.55rem] text-risk">{p.injury_status ?? "OUT"}</span>}
                    </div>
                    <div className="mono flex gap-3 text-[0.6rem] text-faint">
                      {pi?.importance_score != null && <span>Importance <span className="text-text">{n1(pi.importance_score)}</span></span>}
                      {pi?.readiness_score != null && <span>Readiness <span className="text-text">{n0(pi.readiness_score)}</span></span>}
                      {pi?.goal_share_pct != null && pi.goal_share_pct > 0 && <span>Goals <span className="text-text">{n0(pi.goal_share_pct)}%</span></span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      {injury && (injury.injured_count ?? 0) > 0 && (
        <Panel title="Availability impact">
          <div className="grid grid-cols-3 gap-3">
            <StatCell label="Players out" value={n0(injury.injured_count)} color="var(--risk)" />
            <StatCell label="Goals lost" value={n0(injury.goals_lost)} />
            <StatCell label="Importance lost" value={n0(injury.total_importance_lost)} color="var(--risk)" />
          </div>
        </Panel>
      )}
      {depth.length > 0 && (
        <Panel title="Squad depth by line">
          <ul className="space-y-3">
            {depth.map((d) => (
              <li key={d.position_code} className="flex items-center gap-3">
                <span className="mono w-24 shrink-0 text-[0.65rem] uppercase tracking-wide text-muted">{positionLabel(d.position_code)}</span>
                <BarMeter value={d.available_count} max={d.player_count || 1} color={d.injured_count > 0 ? "var(--warn)" : "var(--edge)"} height={8} />
                <span className="mono w-14 shrink-0 text-right text-[0.65rem] text-muted tnum">{d.available_count}/{d.player_count}</span>
                <span className="mono hidden w-14 shrink-0 text-right text-[0.6rem] text-faint sm:block">{money(d.total_market_value)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {intel && (
        <Panel title="Stability & load">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="Stability" value={n0(intel.squad_stability_score)} />
            <StatCell label="Rest avg" value={`${n1(intel.rest_days_avg)}d`} />
            <StatCell label="Travel 14d" value={km(intel.travel_load_km)} />
            <StatCell label="Congestion" value={n0(intel.congestion_score)} />
          </div>
        </Panel>
      )}
    </div>
  );

  // ── FORM ──
  const form = (
    <div className="space-y-4">
      {formQuality && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ScoreTile label="Adjusted form" value={formQuality.opponent_adjusted_form} />
            <ScoreTile label="Sched strength" value={formQuality.strength_of_schedule} />
            <ScoreTile label="Giant-killer" value={formQuality.giant_killer_score} />
            <ScoreTile label="Flat-track" value={formQuality.flat_track_bully_score} invert />
          </div>
          {profile.tier && (
            <Panel title="Performance by opponent tier">
              <div className="grid grid-cols-3 gap-3">
                <TierCell label="vs Top" ppg={profile.tier.top} />
                <TierCell label="vs Mid" ppg={profile.tier.mid} />
                <TierCell label="vs Bottom" ppg={profile.tier.bottom} />
              </div>
              <p className="mono mt-2 text-[0.55rem] text-faint">points per game vs each tier</p>
              {profile.tier.reading && <p className="mt-2 text-[0.8rem] leading-relaxed text-muted">{profile.tier.reading}</p>}
            </Panel>
          )}
          <Panel title="Sustainability">
            <div className="flex items-center justify-between">
              <StatCell label="Underlying" value={profile.sustainability.label} color={profile.sustainability.regressionRisk === "HIGH" ? "var(--warn)" : "var(--edge)"} />
              <StatCell label="Regression risk" value={profile.sustainability.regressionRisk} color={profile.sustainability.regressionRisk === "HIGH" ? "var(--risk)" : "var(--edge)"} />
              <StatCell label="xPts delta" value={`${(profile.sustainability.delta ?? 0) > 0 ? "+" : ""}${n1(profile.sustainability.delta)}`} color={(profile.sustainability.delta ?? 0) >= 0 ? "var(--edge)" : "var(--risk)"} />
            </div>
            <p className="mt-3 text-[0.8rem] leading-relaxed text-muted">{profile.sustainability.reading}</p>
          </Panel>
        </>
      )}
      {momentum && (
        <Panel title="Momentum">
          <div className="mono flex items-center gap-3 text-[0.75rem] text-muted">
            <span>Prior 5: <span className="text-text">{n0(momentum.prior_5_points)}</span></span><span>→</span>
            <span>Last 5: <span className="text-text">{n0(momentum.last_5_points)}</span></span>
            <span className="ml-auto font-semibold" style={{ color: momentum.trend === "rising" ? "var(--edge)" : momentum.trend === "falling" ? "var(--risk)" : "var(--warn)" }}>{(momentum.trend ?? "").toUpperCase()}</span>
          </div>
          <div className="mt-2"><BarMeter value={momentum.momentum_score} color="var(--edge)" height={8} /></div>
        </Panel>
      )}
      {recentForm.length > 0 && (
        <Panel title="Recent form">
          <div>
            {recentForm.map((m, idx) => {
              const dt = m.match_date ? new Date(m.match_date) : null;
              const resultColor = m.result === "W" ? "var(--edge)" : m.result === "L" ? "var(--risk)" : "var(--warn)";
              return (
                <div key={idx} className="flex items-center gap-3 border-b border-line py-2 text-[0.72rem] last:border-0">
                  <span
                    className="mono grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.65rem] font-bold text-ink"
                    style={{ background: resultColor }}
                  >
                    {m.result ?? "—"}
                  </span>
                  <span className="mono w-16 shrink-0 text-faint">{dt ? dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</span>
                  <span className="mono flex-1 text-muted">{m.is_home === true ? "Home" : m.is_home === false ? "Away" : "—"}</span>
                  <span className="mono shrink-0 font-semibold tnum">{m.goals_for ?? "–"}–{m.goals_against ?? "–"}</span>
                  {m.half_time_score_for != null && (
                    <span className="mono hidden w-14 shrink-0 text-right text-[0.6rem] text-faint sm:block">HT {m.half_time_score_for}-{m.half_time_score_against}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );

  // ── BETTING ──
  const betting = (
    <div className="space-y-4">
      <Panel title="Betting profile">
        <div className="space-y-3">
          <MarketRow label="Winner market" read={profile.betting.winner} />
          <MarketRow label="Goals market" read={profile.betting.goals} />
          <MarketRow label="BTTS" read={profile.betting.btts} />
          <MarketRow label="Cards" read={profile.betting.cards} />
        </div>
        <div className="mono mt-4 flex items-center justify-between border-t border-line pt-3 text-[0.7rem]">
          <span className="text-muted">Predictability <span className="text-text">{profile.predictability}</span></span>
          <span className="text-muted">Volatility <span className="text-text">{profile.volatility}</span></span>
        </div>
      </Panel>
      {perf && perf.signals.length > 0 && (
        <Panel title="Derived market signals">
          <SignalGrid signals={perf.signals} />
          <p className="mono mt-2 text-[0.55rem] text-faint">From season-long efficiency, not single-match form. Not betting advice.</p>
        </Panel>
      )}
    </div>
  );

  // ── FIXTURES ──
  const fixtures = (
    <div className="space-y-4">
      {difficulty && (difficulty.next_5_difficulty != null || difficulty.next_10_difficulty != null) && (
        <Panel title="Fixture difficulty">
          <div className="grid grid-cols-2 gap-3">
            <DifficultyCell label="Next 5" score={difficulty.next_5_difficulty} />
            <DifficultyCell label="Next 10" score={difficulty.next_10_difficulty} />
          </div>
        </Panel>
      )}
      {intel && (
        <Panel title="Load & burden">
          <div className="grid grid-cols-3 gap-3">
            <StatCell label="Congestion" value={n0(intel.congestion_score)} />
            <StatCell label="Travel 14d" value={km(intel.travel_load_km)} />
            <StatCell label="Rest avg" value={`${n1(intel.rest_days_avg)}d`} />
          </div>
        </Panel>
      )}
      {upcoming.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">{upcoming.map((m) => <MatchCard key={m.id} m={m} />)}</div>
      ) : (
        <p className="mono text-[0.7rem] text-muted">No upcoming fixtures on the board.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <Link href="/" className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text">← Board</Link>
      <section className="panel p-5">
        <div className="flex items-center gap-3">
          <Crest team={team} size={48} />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{team.name}</h1>
            <p className="mono text-[0.6rem] text-faint">
              {team.country ?? ""}{intel?.active_competitions ? ` · ${intel.active_competitions} active comp${intel.active_competitions > 1 ? "s" : ""}` : ""}
            </p>
          </div>
          <div className="mono ml-auto text-right">
            <div className="label-cap">Quality</div>
            <div className="text-2xl font-bold tnum" style={{ color: profile.quality.overall >= 65 ? "var(--edge)" : "var(--warn)" }}>{profile.quality.overall}</div>
          </div>
        </div>
      </section>

      <Tabs
        items={[
          { id: "overview", label: "Overview", content: overview },
          { id: "attack", label: "Attack", content: attack },
          { id: "defence", label: "Defence", content: defence },
          { id: "squad", label: "Squad", content: squad },
          { id: "form", label: "Form", content: form },
          { id: "betting", label: "Betting", content: betting },
          { id: "fixtures", label: "Fixtures", content: fixtures },
        ]}
      />
    </div>
  );
}

// ── local UI helpers ──
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">{title}</h2>
      {children}
    </section>
  );
}
function ScoreTile({ label, value, big, invert, suffix, subtitle }: { label: string; value: number | null; big?: boolean; invert?: boolean; suffix?: string; subtitle?: string }) {
  const v = value ?? null;
  const color = v == null ? "var(--muted)" : (invert ? v <= 35 : v >= 65) ? "var(--edge)" : (invert ? v <= 60 : v >= 45) ? "var(--warn)" : "var(--risk)";
  return (
    <div className="panel-raised p-3">
      <div className="label-cap">{label}</div>
      <div className={`mono mt-1 font-bold leading-none tnum ${big ? "text-2xl" : "text-xl"}`} style={{ color }}>{v == null ? "—" : `${v}${suffix ?? ""}`}</div>
      {subtitle && <div className="mono text-[0.55rem] text-faint">{subtitle}</div>}
    </div>
  );
}
function BarRow({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-3 last:mb-0">
      <span className="mono w-24 shrink-0 text-[0.65rem] uppercase tracking-wide text-muted">{label}</span>
      <BarMeter value={value} color={color} height={8} />
      <span className="mono w-8 text-right text-[0.7rem] text-text tnum">{n0(value)}</span>
    </div>
  );
}
function DifficultyCell({ label, score }: { label: string; score: number | null }) {
  const band = difficultyBand(score);
  return (
    <div className="rounded-term border border-line p-3 text-center">
      <div className="label-cap">{label}</div>
      <div className="mono mt-1 text-lg font-bold" style={{ color: band.color }}>{band.label}</div>
      {score != null && <div className="mono text-[0.55rem] text-faint tnum">{Math.round(score)}/100</div>}
    </div>
  );
}
function TierCell({ label, ppg }: { label: string; ppg: number | null }) {
  const v = ppg ?? null;
  const color = v == null ? "var(--muted)" : v >= 1.8 ? "var(--edge)" : v >= 1.2 ? "var(--warn)" : "var(--risk)";
  return (
    <div className="rounded-term border border-line p-3 text-center">
      <div className="label-cap">{label}</div>
      <div className="mono mt-1 text-xl font-bold tnum" style={{ color }}>{v == null ? "—" : n1(v)}</div>
    </div>
  );
}
function MarketRow({ label, read }: { label: string; read: MarketRead }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[0.8rem]">{label}</span>
      <BarMeter value={read.score} color={read.color} height={7} />
      <span className="mono w-20 shrink-0 text-right text-[0.65rem] font-semibold" style={{ color: read.color }}>{read.label}</span>
    </div>
  );
}
function Empty({ note }: { note: string }) {
  return (
    <p className="mono rounded-term border border-line bg-raised/40 p-3 text-[0.65rem] leading-relaxed text-faint">
      Shot-level inputs ({note}) aren&rsquo;t in the warehouse yet, so this read is limited. Add them to team_season_statistics and it fills in automatically.
    </p>
  );
}
