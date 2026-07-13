import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  getTeamBySlug, getTeamIntel, getTeamUpcoming, getTeamSeasonStats, getFixtureDifficulty, getTeamKeyPlayers, getTeamRecentForm,
} from "@/lib/queries";
import { computePerformance } from "@/lib/performance";
import {
  computeTeamProfile, type MarketRead,
  motivationBandColor, motivationBandLabel, versatilityBandColor, versatilityBandLabel,
} from "@/lib/teamProfile";
import { Crest } from "@/components/Crest";
import { StatCell, FormString } from "@/components/Primitives";
import { BarMeter } from "@/components/Meters";
import { MatchCard } from "@/components/MatchCard";
import { Tabs } from "@/components/Tabs";
import { InsightList, SignalGrid } from "@/components/PerformanceIntel";
import { n0, n1, pct, km, money, dependencyVerdict, positionLabel, difficultyBand } from "@/lib/intel";
import { Explain } from "@/components/Explain";
import type { GlossaryKey } from "@/lib/glossary";

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

  const { intel, betting: bettingIntelRow, goalDep, injury, formQuality, venue, momentum, depth, motivation, versatility } = await getTeamIntel(team.id);
  const [upcoming, seasonStats, difficulty, keyPlayers, recentForm] = await Promise.all([
    getTeamUpcoming(team.id),
    getTeamSeasonStats(team.id),
    getFixtureDifficulty(team.id),
    getTeamKeyPlayers(team.id),
    getTeamRecentForm(team.id),
  ]);
  const perf = seasonStats ? computePerformance(seasonStats) : null;
  const profile = computeTeamProfile({ intel, betting: bettingIntelRow, formQuality, venue, goalDep, perf, motivation, versatility });
  const dep = dependencyVerdict(goalDep);
  const marketValue = depth.length > 0 ? depth.reduce((sum, d) => sum + (d.total_market_value ?? 0), 0) : null;

  // ── OVERVIEW ──
  const overview = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ScoreTile label="Team quality" value={profile.quality.overall} big explain="team_quality_score" />
        <ScoreTile label="Readiness" value={intel?.readiness_score ?? null} explain="readiness" />
        <ScoreTile label="Predictability" value={profile.predictability} />
        <ScoreTile label="Volatility" value={profile.volatility} invert />
      </div>
      <Panel title="Quality breakdown">
        <BarRow label="Attack" value={profile.quality.attack} color="var(--amber)" explain="attack_rating" />
        <BarRow label="Defence" value={profile.quality.defence} color="var(--cool)" explain="defence_rating" />
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
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4">
            <StatCell label="Home win%" value={pct(venue.home_win_pct)} color="var(--edge)" />
            <StatCell label="Away win%" value={pct(venue.away_win_pct)} color="var(--cool)" />
            <StatCell label="Home PPG" value={n1(venue.home_points_per_game)} />
            <StatCell label="Away PPG" value={n1(venue.away_points_per_game)} />
          </div>
        </Panel>
      )}
      {keyPlayers.length > 0 && (
        <Panel title="Key players">
          <p className="mono mb-2 text-[0.6rem] text-faint">Ranked by importance to the team (goal/assist share, minutes, rating) — not tied to any single fixture.</p>
          <ul className="space-y-2.5">
            {keyPlayers.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="mono w-6 shrink-0 text-center text-[0.7rem] text-faint tnum">{p.jersey_number ?? "—"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[0.8rem] font-medium">{p.short_name ?? p.name}</span>
                    {p.current_injury && <span className="mono shrink-0 rounded bg-risk/15 px-1.5 py-0.5 text-[0.55rem] font-semibold text-risk">OUT</span>}
                  </div>
                  <span className="mono text-[0.6rem] text-faint">{p.position ? positionLabel(p.position) : ""}</span>
                </div>
                {(p.goal_share_pct != null || p.assist_share_pct != null) && (
                  <span className="mono shrink-0 text-[0.62rem] text-muted">
                    {p.goal_share_pct != null && `${Math.round(p.goal_share_pct)}% goals`}
                    {p.goal_share_pct != null && p.assist_share_pct != null && " · "}
                    {p.assist_share_pct != null && `${Math.round(p.assist_share_pct)}% ast`}
                  </span>
                )}
                {p.readiness_score != null && (
                  <span className="mono shrink-0 text-[0.6rem] text-faint">RDY {n0(p.readiness_score)}</span>
                )}
                <div className="w-20 shrink-0"><BarMeter value={p.importance_score} max={100} color="var(--amber)" height={6} /></div>
                <span className="mono w-7 shrink-0 text-right text-[0.72rem] font-semibold text-amber tnum">{n0(p.importance_score)}</span>
              </li>
            ))}
          </ul>
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
      {(profile.bettingIntel.finishing != null || profile.bettingIntel.shotAccuracy != null ||
        profile.bettingIntel.conversion != null || profile.bettingIntel.bigChanceConversion != null ||
        profile.bettingIntel.goalCreation != null) && (
        <Panel title="Shot & finishing intelligence">
          {profile.bettingIntel.finishing != null && <BarRow label="Finishing" value={profile.bettingIntel.finishing} color="var(--amber)" explain="finishing_efficiency" />}
          {profile.bettingIntel.shotAccuracy != null && <BarRow label="Shot accuracy" value={profile.bettingIntel.shotAccuracy} color="var(--edge)" explain="shot_accuracy" />}
          {profile.bettingIntel.conversion != null && <BarRow label="Conversion" value={profile.bettingIntel.conversion} color="var(--amber)" explain="shot_conversion_rate" />}
          {profile.bettingIntel.bigChanceConversion != null && <BarRow label="Big chances" value={profile.bettingIntel.bigChanceConversion} color="var(--warn)" explain="big_chance_conversion" />}
          {profile.bettingIntel.goalCreation != null && <BarRow label="Goal creation" value={profile.bettingIntel.goalCreation} color="var(--edge)" explain="goal_creation_score" />}
        </Panel>
      )}
      {goalDep && (
        <Panel title="Goal distribution" explain="goal_dependency">
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
      {(profile.bettingIntel.goalPrevention != null || profile.bettingIntel.cleanSheet != null) && (
        <Panel title="Goal prevention">
          {profile.bettingIntel.goalPrevention != null && <BarRow label="Goal prevention" value={profile.bettingIntel.goalPrevention} color="var(--edge)" explain="goal_prevention_score" />}
          {profile.bettingIntel.cleanSheet != null && <BarRow label="Clean sheet" value={profile.bettingIntel.cleanSheet} color="var(--edge)" explain="clean_sheet_reliability" />}
        </Panel>
      )}
    </div>
  );

  // ── SQUAD ──
  const squad = (
    <div className="space-y-4">
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
                <span className="mono w-10 shrink-0 text-right text-[0.6rem] text-faint tnum">{d.player_count > 0 ? `${Math.round((d.available_count / d.player_count) * 100)}%` : "—"}</span>
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
            <ScoreTile label="Adjusted form" value={formQuality.opponent_adjusted_form} explain="opponent_adjusted_form" />
            <ScoreTile label="Sched strength" value={formQuality.strength_of_schedule} />
            <ScoreTile label="Giant-killer" value={formQuality.giant_killer_score} explain="giant_killer_score" />
            <ScoreTile label="Flat-track" value={formQuality.flat_track_bully_score} invert explain="flat_track_bully_score" />
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
      {profile.motivation && (
        <Panel title="Motivation">
          <div className="mb-2 flex items-center justify-between">
            <StatCell label="Overall" value={n0(profile.motivation.overall)} sub="/100" />
            <span className="mono text-[0.65rem] font-semibold uppercase tracking-wide" style={{ color: motivationBandColor(profile.motivation.band) }}>
              {motivationBandLabel(profile.motivation.band)}
            </span>
          </div>
          <p className="mono mb-2 text-[0.6rem] text-faint">League-table context (title race / relegation battle) — distinct from per-fixture motivation shown on the match page.</p>
          <div className="grid grid-cols-3 gap-3">
            <ScoreTile label="Momentum" value={profile.motivation.factors.momentum} />
            <ScoreTile label="Quality" value={profile.motivation.factors.quality} />
            <ScoreTile label="External" value={profile.motivation.factors.external} />
          </div>
        </Panel>
      )}
      {profile.versatility && (
        <Panel title="Tactical versatility">
          <div className="mb-2 flex items-center justify-between">
            <p className="mono text-[0.6rem] text-faint">From the most recently computed predicted lineup — a per-match snapshot, not a rolling average.</p>
            {profile.versatility.band && (
              <span className="mono shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide" style={{ color: versatilityBandColor(profile.versatility.band) }}>
                {versatilityBandLabel(profile.versatility.band)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ScoreTile label="Overall" value={profile.versatility.overall} />
            <ScoreTile label="Formation flex" value={profile.versatility.formationFlex} />
          </div>
          {profile.versatility.preferredFormations && profile.versatility.preferredFormations.length > 0 && (
            <div className="mono mt-3 flex flex-wrap gap-2 text-[0.65rem] text-muted">
              {profile.versatility.preferredFormations.map((f) => (
                <span key={f} className="rounded-term border border-line bg-raised px-2 py-0.5">{f}</span>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );

  // ── BETTING ──
  const betting = (
    <div className="space-y-4">
      <Panel title="Betting profile">
        <div className="space-y-3">
          <MarketRow label="Winner market" read={profile.betting.winner} explain="winner_market_score" />
          <MarketRow label="Goals market" read={profile.betting.goals} explain="goals_market_score" />
          <MarketRow label="BTTS" read={profile.betting.btts} explain="btts_score" />
          <MarketRow label="Cards" read={profile.betting.cards} explain="cards_market_score" />
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
      {recentForm.length > 0 && (
        <Panel title="Recent form">
          <ul className="space-y-2">
            {recentForm.map((m, idx) => {
              const resultColor = m.result === "W" ? "var(--edge)" : m.result === "L" ? "var(--risk)" : "var(--warn)";
              return (
                <li key={idx} className="flex items-center gap-3 border-b border-line py-1.5 last:border-0">
                  <span className="mono grid h-5 w-5 shrink-0 place-items-center rounded-[3px] text-[0.65rem] font-bold" style={{ color: resultColor, background: `color-mix(in srgb, ${resultColor} 16%, transparent)` }}>{m.result}</span>
                  <span className="mono w-16 shrink-0 text-[0.62rem] text-faint">{new Date(m.match_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  <span className="mono text-[0.55rem] uppercase text-faint">{m.is_home == null ? "" : m.is_home ? "H" : "A"}</span>
                  <span className="mono ml-auto text-[0.8rem] font-semibold tnum">{m.goals_for ?? "—"}–{m.goals_against ?? "—"}</span>
                  {m.half_time_score_for != null && m.half_time_score_against != null && (
                    <span className="mono text-[0.6rem] text-faint">(HT {m.half_time_score_for}-{m.half_time_score_against})</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mono mt-3 border-t border-line pt-2.5 text-[0.68rem] leading-relaxed text-muted">
            {(() => {
              const bttsCount = recentForm.filter((m) => m.btts === true).length;
              const bttsKnown = recentForm.filter((m) => m.btts != null).length;
              const cleanSheets = recentForm.filter((m) => (m.goals_against ?? 1) === 0).length;
              const parts: string[] = [];
              if (bttsKnown > 0) parts.push(`Both teams scored in ${bttsCount} of the last ${bttsKnown}`);
              parts.push(`${cleanSheets} clean sheet${cleanSheets === 1 ? "" : "s"} in the last ${recentForm.length}`);
              return parts.join(" · ");
            })()}
          </p>
        </Panel>
      )}
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
        <div className="mono mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-5 sm:gap-2">
          <StatCell label="Quality" value={profile.quality.overall} sub="/100" />
          <StatCell label="Market value" value={marketValue != null ? money(marketValue) : "—"} />
          <StatCell label="Readiness" value={n0(intel?.readiness_score)} sub="/100" explain="readiness" />
          <StatCell label="Form" value={n0(intel?.form_index)} sub="/100" />
          <StatCell label="Home win%" value={pct(venue?.home_win_pct)} />
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
function Panel({ title, children, explain }: { title: string; children: React.ReactNode; explain?: GlossaryKey }) {
  return (
    <section className="panel p-4">
      <h2 className="mono mb-3 flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">{title}{explain && <Explain metric={explain} />}</h2>
      {children}
    </section>
  );
}
function ScoreTile({ label, value, big, invert, suffix, subtitle, explain }: { label: string; value: number | null; big?: boolean; invert?: boolean; suffix?: string; subtitle?: string; explain?: GlossaryKey }) {
  const v = value ?? null;
  const color = v == null ? "var(--muted)" : (invert ? v <= 35 : v >= 65) ? "var(--edge)" : (invert ? v <= 60 : v >= 45) ? "var(--warn)" : "var(--risk)";
  return (
    <div className="panel-raised p-3">
      <div className="label-cap flex items-center">{label}{explain && <Explain metric={explain} />}</div>
      <div className={`mono mt-1 font-bold leading-none tnum ${big ? "text-2xl" : "text-xl"}`} style={{ color }}>{v == null ? "—" : `${v}${suffix ?? ""}`}</div>
      {subtitle && <div className="mono text-[0.55rem] text-faint">{subtitle}</div>}
    </div>
  );
}
function BarRow({ label, value, color, explain }: { label: string; value: number | null; color: string; explain?: GlossaryKey }) {
  return (
    <div className="mb-2.5 flex items-center gap-3 last:mb-0">
      <span className="mono flex w-24 shrink-0 items-center text-[0.65rem] uppercase tracking-wide text-muted">{label}{explain && <Explain metric={explain} />}</span>
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
function MarketRow({ label, read, explain }: { label: string; read: MarketRead; explain?: GlossaryKey }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-28 shrink-0 items-center text-[0.8rem]">{label}{explain && <Explain metric={explain} />}</span>
      <BarMeter value={read.score} color={read.color} height={7} />
      <span className="mono w-8 shrink-0 text-right text-[0.72rem] font-semibold tnum" style={{ color: read.color }}>{n0(read.score)}</span>
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
