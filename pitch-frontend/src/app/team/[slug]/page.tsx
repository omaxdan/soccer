import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  getTeamBySlug, getTeamIntel, getTeamUpcoming, getTeamSeasonStats, getFixtureDifficulty, getTeamKeyPlayers, getTeamRecentForm,
  getTeamStanding, getBettingCard,
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
import { SubTabs } from "@/components/SubTabs";
import { InsightList, SignalGrid } from "@/components/PerformanceIntel";
import { n0, n1, pct, km, money, dependencyVerdict, positionLabel, difficultyBand, pickTierByMatch } from "@/lib/intel";
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

  const {
    intel, betting: bettingIntelRow, goalDep, injury, formQuality, venue, momentum, depth, motivation, versatility,
    strengthDashboard, strengthRatings, playingStyle, strengths, weaknesses, tacticalVariations, transferIntel, injuries,
  } = await getTeamIntel(team.id);
  const [upcoming, seasonStats, difficulty, keyPlayers, recentForm, standing, bettingCard] = await Promise.all([
    getTeamUpcoming(team.id),
    getTeamSeasonStats(team.id),
    getFixtureDifficulty(team.id),
    getTeamKeyPlayers(team.id),
    getTeamRecentForm(team.id, 10),
    getTeamStanding(team.id),
    getBettingCard(),
  ]);
  const perf = seasonStats ? computePerformance(seasonStats) : null;
  const profile = computeTeamProfile({ intel, betting: bettingIntelRow, formQuality, venue, goalDep, perf, motivation, versatility });
  const dep = dependencyVerdict(goalDep);
  const depthMarketValue = depth.length > 0 ? depth.reduce((sum, d) => sum + (d.total_market_value ?? 0), 0) : null;
  const picks = pickTierByMatch(bettingCard.singles);
  const ppg = standing?.matches ? (standing.points ?? 0) / standing.matches : null;
  const winPctFallback = standing?.matches ? ((standing.wins ?? 0) / standing.matches) * 100 : null;

  // ── Hero numbers — prefer the precomputed strength tables, fall back to
  // what the page already derives elsewhere ──
  const overallRating = strengthDashboard?.overall_rating ?? bettingIntelRow?.team_quality_score ?? profile.quality.overall;
  const ppgValue = strengthRatings?.points_per_game ?? ppg;
  const winPctValue = strengthRatings?.win_percentage ?? winPctFallback;
  const marketValue = strengthRatings?.market_value_eur ?? depthMarketValue;
  const ratingColor = overallRating == null ? "var(--muted)" : overallRating >= 65 ? "var(--edge)" : overallRating >= 45 ? "var(--warn)" : "var(--risk)";

  // Most recent formation this team has actually lined up in, per
  // team_tactical_variations.formation_history (an array of {match_id,
  // formation, match_date}) — not a single stored "formation" field.
  const formation = tacticalVariations?.formation_history?.length
    ? [...tacticalVariations.formation_history].sort(
        (a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime()
      )[0].formation
    : null;

  const last5 = recentForm.slice(0, 5);
  const bttsKnown = last5.filter((m) => m.btts != null).length;
  const bttsCount = last5.filter((m) => m.btts === true).length;
  const cleanSheets = last5.filter((m) => (m.goals_against ?? 1) === 0).length;
  const topScorer = keyPlayers.find((p) => p.id === goalDep?.top_scorer_player_id);

  // ── PROFILE — the team's resume, told as one scrollable story ──
  const profileTab = (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Performance snapshot">
          <BarRow label="Attack" value={strengthDashboard?.attack_rating ?? profile.quality.attack} color="var(--amber)" explain="attack_rating" />
          <BarRow label="Midfield" value={strengthDashboard?.midfield_rating ?? null} color="var(--cool)" />
          <BarRow label="Defence" value={strengthDashboard?.defense_rating ?? profile.quality.defence} color="var(--edge)" explain="defence_rating" />
          <BarRow label="Set piece" value={strengthDashboard?.set_piece_rating ?? null} color="var(--warn)" />
        </Panel>
        <Panel title="Home vs away split">
          <div className="grid grid-cols-3 items-center gap-y-2 text-center">
            <span />
            <span className="label-cap">Home</span>
            <span className="label-cap">Away</span>
            <span className="text-left text-[0.65rem] text-muted">PPG</span>
            <span className="mono text-[0.8rem] font-semibold tnum">{n1(venue?.home_points_per_game)}</span>
            <span className="mono text-[0.8rem] font-semibold tnum">{n1(venue?.away_points_per_game)}</span>
            <span className="text-left text-[0.65rem] text-muted">Win%</span>
            <span className="mono text-[0.8rem] font-semibold tnum" style={{ color: "var(--edge)" }}>{pct(venue?.home_win_pct)}</span>
            <span className="mono text-[0.8rem] font-semibold tnum" style={{ color: "var(--cool)" }}>{pct(venue?.away_win_pct)}</span>
            <span className="text-left text-[0.65rem] text-muted">Goal diff</span>
            <span className="mono text-[0.8rem] text-faint">—</span>
            <span className="mono text-[0.8rem] text-faint">—</span>
          </div>
          {venue?.venue_advantage_score != null && (
            <p className="mono mt-3 border-t border-line pt-2.5 text-[0.65rem] text-muted">
              Venue advantage <span className="text-text">{n0(venue.venue_advantage_score)}/100</span>
            </p>
          )}
        </Panel>
      </div>

      {(playingStyle || strengths.length > 0 || weaknesses.length > 0) && (
        <Panel title="Identity">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="Playing style" value={playingStyle?.playing_style ?? "—"} />
            <StatCell label="Formation" value={formation ?? "—"} />
            <StatCell label="Passing style" value={playingStyle?.passing_style ?? "—"} />
            <StatCell label="Possession" value={playingStyle?.possession_score != null ? n0(playingStyle.possession_score) : "—"} sub={playingStyle?.possession_score != null ? "/100" : undefined} />
          </div>
          {(strengths.length > 0 || weaknesses.length > 0) && (
            <div className="mt-4 grid gap-4 border-t border-line pt-3 sm:grid-cols-2">
              {strengths.length > 0 && (
                <div>
                  <p className="label-cap mb-2" style={{ color: "var(--edge)" }}>Strengths</p>
                  <ul className="space-y-1.5">
                    {strengths.slice(0, 4).map((s) => (
                      <li key={s.strength_type} className="flex items-start gap-2 text-[0.78rem] leading-snug">
                        <span className="text-edge">+</span>
                        <span className="text-muted">{s.description ?? s.strength_type.replace(/_/g, " ").toLowerCase()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {weaknesses.length > 0 && (
                <div>
                  <p className="label-cap mb-2" style={{ color: "var(--risk)" }}>Weaknesses</p>
                  <ul className="space-y-1.5">
                    {weaknesses.slice(0, 4).map((w) => (
                      <li key={w.weakness_type} className="flex items-start gap-2 text-[0.78rem] leading-snug">
                        <span className="text-risk">−</span>
                        <span className="text-muted">{w.description ?? w.weakness_type.replace(/_/g, " ").toLowerCase()}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {(last5.length > 0 || intel?.last_5_results) && (
        <Panel title="Season story">
          {intel?.last_5_results && (
            <div className="mb-3 flex items-center justify-between">
              <span className="label-cap">Last 5</span>
              <FormString results={intel.last_5_results} />
            </div>
          )}
          {last5.length > 0 && (
            <ul className="space-y-1.5">
              {last5.map((m, idx) => {
                const resultColor = m.result === "W" ? "var(--edge)" : m.result === "L" ? "var(--risk)" : "var(--warn)";
                return (
                  <li key={idx} className="flex items-center gap-3 border-b border-line py-1.5 last:border-0">
                    <span className="mono grid h-5 w-5 shrink-0 place-items-center rounded-[3px] text-[0.65rem] font-bold" style={{ color: resultColor, background: `color-mix(in srgb, ${resultColor} 16%, transparent)` }}>{m.result}</span>
                    <span className="mono w-16 shrink-0 text-[0.62rem] text-faint">{new Date(m.match_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    <span className="mono text-[0.55rem] uppercase text-faint">{m.is_home == null ? "" : m.is_home ? "H" : "A"}</span>
                    <span className="mono ml-auto text-[0.8rem] font-semibold tnum">{m.goals_for ?? "—"}–{m.goals_against ?? "—"}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {last5.length > 0 && (
            <div className="mono mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[0.7rem] text-muted">
              <span>BTTS <span className="text-text">{bttsKnown > 0 ? `${Math.round((bttsCount / bttsKnown) * 100)}%` : "—"}</span></span>
              <span>Clean sheets <span className="text-text">{Math.round((cleanSheets / last5.length) * 100)}%</span></span>
            </div>
          )}
        </Panel>
      )}

      {(keyPlayers.length > 0 || goalDep || injuries.length > 0) && (
        <Panel title="Key players">
          {keyPlayers.length > 0 && (
            <ul className="space-y-2.5">
              {keyPlayers.slice(0, 3).map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="mono w-6 shrink-0 text-center text-[0.7rem] text-faint tnum">{p.jersey_number ?? "—"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[0.8rem] font-medium">{p.short_name ?? p.name}</span>
                      {p.current_injury && <span className="mono shrink-0 rounded bg-risk/15 px-1.5 py-0.5 text-[0.55rem] font-semibold text-risk">OUT</span>}
                    </div>
                    <span className="mono text-[0.6rem] text-faint">{p.position ? positionLabel(p.position) : ""}</span>
                  </div>
                  <div className="w-20 shrink-0"><BarMeter value={p.importance_score} max={100} color="var(--amber)" height={6} /></div>
                  <span className="mono w-7 shrink-0 text-right text-[0.72rem] font-semibold text-amber tnum">{n0(p.importance_score)}</span>
                </li>
              ))}
            </ul>
          )}
          {goalDep && (
            <div className="mono mt-3 flex items-center justify-between border-t border-line pt-3 text-[0.72rem] text-muted">
              <span className="label-cap">Top scorer</span>
              <span className="text-text">
                {topScorer?.short_name ?? topScorer?.name ?? "—"} · {n0(goalDep.top_scorer_goals)}g ({pct(goalDep.top_scorer_pct)} of team goals)
              </span>
            </div>
          )}
          {injuries.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="label-cap mb-2">Players out</p>
              <ul className="space-y-1.5">
                {injuries.slice(0, 5).map((p) => (
                  <li key={p.player_id} className="flex items-center justify-between gap-2 text-[0.72rem]">
                    <span className="truncate text-text">{p.short_name ?? p.name}</span>
                    <span className="mono shrink-0 text-faint">
                      {p.injury_reason ?? "—"}{p.expected_return_days != null ? ` · ~${p.expected_return_days}d return` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      {intel && (
        <Panel title="Context">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="Readiness" value={n0(intel.readiness_score)} sub="/100" explain="readiness" />
            <StatCell label="Rest days" value={intel.rest_days_avg != null ? `${n1(intel.rest_days_avg)}d` : "—"} />
            <StatCell label="Travel load" value={km(intel.travel_load_km)} />
            <StatCell label="Congestion" value={n0(intel.congestion_score)} />
          </div>
          {motivation && (
            <div className="mono mt-3 flex items-center justify-between border-t border-line pt-3 text-[0.72rem]">
              <span className="label-cap">Motivation</span>
              <span className="font-semibold" style={{ color: motivationBandColor(motivation.motivation_band) }}>
                {motivationBandLabel(motivation.motivation_band)}
              </span>
            </div>
          )}
        </Panel>
      )}
    </div>
  );

  // ── SCHEDULE ──
  const scheduleTab = (
    <div className="space-y-4">
      {upcoming.length > 0 ? (
        <Panel title="Upcoming fixtures">
          <div className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((m) => <MatchCard key={m.id} m={m} pick={picks.get(m.id)} />)}
          </div>
        </Panel>
      ) : (
        <p className="mono text-[0.7rem] text-muted">No upcoming fixtures on the board.</p>
      )}
      {difficulty && (difficulty.next_5_difficulty != null || difficulty.next_10_difficulty != null) && (
        <Panel title="Fixture difficulty">
          <div className="grid grid-cols-2 gap-3">
            <DifficultyCell label="Next 5" score={difficulty.next_5_difficulty} />
            <DifficultyCell label="Next 10" score={difficulty.next_10_difficulty} />
          </div>
        </Panel>
      )}
      {recentForm.length > 0 && (
        <Panel title="Recent form (last 10)">
          <ul className="space-y-1.5">
            {recentForm.map((m, idx) => {
              const resultColor = m.result === "W" ? "var(--edge)" : m.result === "L" ? "var(--risk)" : "var(--warn)";
              return (
                <li key={idx} className="flex items-center gap-3 border-b border-line py-1.5 last:border-0">
                  <span className="mono grid h-5 w-5 shrink-0 place-items-center rounded-[3px] text-[0.65rem] font-bold" style={{ color: resultColor, background: `color-mix(in srgb, ${resultColor} 16%, transparent)` }}>{m.result}</span>
                  <span className="mono w-16 shrink-0 text-[0.62rem] text-faint">{new Date(m.match_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  <span className="mono text-[0.55rem] uppercase text-faint">{m.is_home == null ? "" : m.is_home ? "H" : "A"}</span>
                  <span className="mono ml-auto text-[0.8rem] font-semibold tnum">{m.goals_for ?? "—"}–{m.goals_against ?? "—"}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );

  // ── FULL BREAKDOWN ──
  const squadTab = (
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

  const bettingProfileTab = (
    <div className="space-y-4">
      <Panel title="Market reads">
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
      <div className="grid grid-cols-2 gap-3">
        <ScoreTile label="Attack efficiency" value={perf?.attackEfficiency ?? null} />
        <ScoreTile label="Goal dependency" value={dep.pct != null ? Math.round(dep.pct) : null} invert suffix="%" subtitle={dep.label} />
      </div>
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
      {(profile.bettingIntel.goalPrevention != null || profile.bettingIntel.cleanSheet != null) && (
        <Panel title="Goal prevention">
          {profile.bettingIntel.goalPrevention != null && <BarRow label="Goal prevention" value={profile.bettingIntel.goalPrevention} color="var(--edge)" explain="goal_prevention_score" />}
          {profile.bettingIntel.cleanSheet != null && <BarRow label="Clean sheet" value={profile.bettingIntel.cleanSheet} color="var(--edge)" explain="clean_sheet_reliability" />}
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
              One-man attack: no comparable backup if the top scorer misses.
            </p>
          )}
        </Panel>
      )}
      {perf && perf.attack.length > 0 && <Panel title="Attacking intelligence"><InsightList insights={perf.attack} /></Panel>}
      {perf && perf.defense.length > 0 && <Panel title="Defensive intelligence"><InsightList insights={perf.defense} /></Panel>}
      {perf && perf.signals.length > 0 && (
        <Panel title="Derived market signals">
          <SignalGrid signals={perf.signals} />
          <p className="mono mt-2 text-[0.55rem] text-faint">From season-long efficiency, not single-match form. Not betting advice.</p>
        </Panel>
      )}
    </div>
  );

  const formQualityTab = (
    <div className="space-y-4">
      {formQuality ? (
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
      ) : (
        <p className="mono text-[0.7rem] text-muted">No form quality data available.</p>
      )}
    </div>
  );

  const tacticalTab = (
    <div className="space-y-4">
      {tacticalVariations ? (
        <>
          {tacticalVariations.system_effectiveness && tacticalVariations.system_effectiveness.length > 0 && (
            <Panel title="Formations used">
              <ul className="space-y-2.5">
                {tacticalVariations.system_effectiveness.map((s) => (
                  <li key={s.formation} className="flex items-center gap-3">
                    <span className="mono w-16 shrink-0 text-[0.75rem] font-semibold text-amber">{s.formation}</span>
                    <BarMeter value={s.effectiveness_score} color="var(--edge)" height={7} />
                    <span className="mono w-8 shrink-0 text-right text-[0.7rem] text-muted tnum">{n0(s.effectiveness_score)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {tacticalVariations.adaptability_score && (
            <Panel title="Adaptability">
              <BarRow label="Depth" value={tacticalVariations.adaptability_score.depth} color="var(--amber)" />
              <BarRow label="Width" value={tacticalVariations.adaptability_score.width} color="var(--cool)" />
              <BarRow label="Pressing" value={tacticalVariations.adaptability_score.pressing} color="var(--warn)" />
              <BarRow label="Counter-attack" value={tacticalVariations.adaptability_score.counter_attack} color="var(--edge)" />
            </Panel>
          )}
          {tacticalVariations.tactical_patterns && tacticalVariations.tactical_patterns.length > 0 && (
            <Panel title="Tactical patterns">
              <ul className="space-y-2">
                {tacticalVariations.tactical_patterns.map((p, idx) => (
                  <li key={idx}>
                    <span className="mono text-[0.7rem] font-semibold text-text">{p.pattern}</span>
                    <p className="mt-0.5 text-[0.75rem] leading-relaxed text-muted">{p.description}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {tacticalVariations.game_state_adaptations && tacticalVariations.game_state_adaptations.length > 0 && (
            <Panel title="Game-state adaptations">
              <div className="flex flex-wrap gap-1.5">
                {tacticalVariations.game_state_adaptations.map((g) => (
                  <span key={g} className="mono rounded border border-line px-2 py-0.5 text-[0.6rem] text-muted">{g}</span>
                ))}
              </div>
            </Panel>
          )}
        </>
      ) : (
        <p className="mono text-[0.7rem] text-muted">No tactical variation data available.</p>
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

  const transferTab = (
    <div className="space-y-4">
      {transferIntel ? (
        <Panel title="Transfer activity">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="In" value={n0(transferIntel.transfers_in)} color="var(--edge)" />
            <StatCell label="Out" value={n0(transferIntel.transfers_out)} color="var(--cool)" />
            <StatCell label="Retained" value={n0(transferIntel.retained_players)} />
            <StatCell label="Retention" value={pct(transferIntel.retention_percentage)} />
          </div>
          {transferIntel.transfer_activity_score != null && (
            <div className="mt-3 border-t border-line pt-3">
              <BarRow label="Activity" value={transferIntel.transfer_activity_score} color="var(--amber)" />
            </div>
          )}
        </Panel>
      ) : (
        <p className="mono text-[0.7rem] text-muted">No transfer activity data available.</p>
      )}
    </div>
  );

  const momentumTab = (
    <div className="space-y-4">
      {momentum ? (
        <Panel title="Momentum">
          <div className="mono flex items-center gap-3 text-[0.75rem] text-muted">
            <span>Prior 5: <span className="text-text">{n0(momentum.prior_5_points)}</span></span><span>→</span>
            <span>Last 5: <span className="text-text">{n0(momentum.last_5_points)}</span></span>
            <span className="ml-auto font-semibold" style={{ color: momentum.trend === "rising" ? "var(--edge)" : momentum.trend === "falling" ? "var(--risk)" : "var(--warn)" }}>{(momentum.trend ?? "").toUpperCase()}</span>
          </div>
          <div className="mt-2"><BarMeter value={momentum.momentum_score} color="var(--edge)" height={8} /></div>
        </Panel>
      ) : (
        <p className="mono text-[0.7rem] text-muted">No momentum data available.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <Link href="/" className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text">← Board</Link>
      <section className="panel p-5">
        <div className="flex items-center gap-3">
          <Crest team={team} size={48} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">{team.name}</h1>
            <p className="mono text-[0.6rem] text-faint">
              {team.country ?? ""}
              {standing?.position != null ? ` · League position ${standing.position}` : ""}
            </p>
          </div>
          <div className="mono text-right">
            <div className="label-cap">Overall rating</div>
            <div className="text-2xl font-bold tnum" style={{ color: ratingColor }}>{overallRating ?? "—"}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4">
          <StatCell label="PPG" value={ppgValue != null ? n1(ppgValue) : "—"} />
          <StatCell label="Win%" value={pct(winPctValue)} />
          <StatCell label="Form" value={intel?.last_5_results ? <FormString results={intel.last_5_results} /> : "—"} />
          <StatCell label="Market value" value={marketValue != null ? money(marketValue) : "—"} />
        </div>
      </section>

      <Tabs
        items={[
          { id: "profile", label: "Profile", content: profileTab },
          { id: "schedule", label: "Schedule", content: scheduleTab },
          {
            id: "breakdown",
            label: "Full Breakdown",
            content: (
              <SubTabs
                items={[
                  { id: "squad", label: "Squad", content: squadTab },
                  { id: "betting", label: "Betting", content: bettingProfileTab },
                  { id: "form", label: "Form quality", content: formQualityTab },
                  { id: "tactical", label: "Tactical", content: tacticalTab },
                  { id: "transfers", label: "Transfers", content: transferTab },
                  { id: "momentum", label: "Momentum", content: momentumTab },
                ]}
              />
            ),
          },
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
function ScoreTile({ label, value, big, invert, suffix, subtitle, explain, color: colorOverride }: { label: string; value: number | null; big?: boolean; invert?: boolean; suffix?: string; subtitle?: string; explain?: GlossaryKey; color?: string }) {
  const v = value ?? null;
  // color: explicit override wins (used for values not on a 0-100 scale,
  // e.g. league position, PPG, goal difference) — otherwise the usual
  // 0-100 score heuristic.
  const color = colorOverride ?? (v == null ? "var(--muted)" : (invert ? v <= 35 : v >= 65) ? "var(--edge)" : (invert ? v <= 60 : v >= 45) ? "var(--warn)" : "var(--risk)");
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
