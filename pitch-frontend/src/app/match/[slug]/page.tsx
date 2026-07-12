import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getMatchBySlug, getLineups } from "@/lib/queries";
import { Crest } from "@/components/Crest";
import { StatCell } from "@/components/Primitives";
import { OpportunityRiskMeter, RiskBadge, BarMeter, VersusBar } from "@/components/Meters";
import { ScorecardRow } from "@/components/Scorecard";
import { SignalRow } from "@/components/SignalLedger";
import { AvailabilityList } from "@/components/Lineups";
import { PitchLineup } from "@/components/Pitch";
import { PitchCoverage } from "@/components/PitchCoverage";
import { Tabs } from "@/components/Tabs";
import { SubTabs } from "@/components/SubTabs";
import { teamSlug } from "@/lib/slug";
import {
  kickoff, n1, km, normProb, opportunityColor, bestLean, normScorelines,
  htFtLabel, confidenceBand, n0, positionLabel,
} from "@/lib/intel";
import { Explain } from "@/components/Explain";
import type { GlossaryKey } from "@/lib/glossary";
import type { MatchRow, MarketSignal } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const m = await getMatchBySlug(slug);
  if (!m) return { title: "Match" };
  return { title: `${m.home.name} v ${m.away.name}`, description: m.opportunity?.executive_brief ?? undefined };
}

export default async function MatchHub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await getMatchBySlug(slug);
  if (!m) notFound();
  const lineups = await getLineups(m.id);
  const homeLineup = lineups.filter((p) => p.team_id === m.home.id);
  const awayLineup = lineups.filter((p) => p.team_id === m.away.id);

  const k = kickoff(m.date);
  const i = m.intel;
  const lean = bestLean(m);
  const scorelines = normScorelines(i?.predicted_scorelines ?? null);
  const totalGoals = (i?.predicted_home_goals ?? 0) + (i?.predicted_away_goals ?? 0);

  // ── OVERVIEW ──
  const overview = (
    <div className="space-y-4">
      {(m.opportunity || m.risk) && (
        <Panel title="Executive decision">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="Opportunity" value={`${m.opportunity?.opportunity_score ?? "—"}`} color={opportunityColor(m.opportunity?.opportunity_score)} sub="/100" explain="opportunity_score" />
            <StatCell label="Risk" value={m.risk ? `${m.risk.risk_score}` : "—"} sub={m.risk?.risk_band ?? ""} />
            <StatCell label="Predictability" value={m.risk ? `${m.risk.predictability_score}` : "—"} sub="/100" />
            <StatCell label="Confidence" value={i?.confidence_score != null ? `${Math.round(i.confidence_score)}%` : "—"} sub={i?.confidence_band ?? ""} />
          </div>
          <div className="mt-3"><OpportunityRiskMeter opportunity={m.opportunity?.opportunity_score} risk={m.risk?.risk_score} /></div>
          {lean && (
            <div className="mt-3 flex items-center gap-2 rounded-term border border-line bg-raised p-3">
              <span className="label-cap">Best lean</span>
              <span className="mono text-sm font-semibold text-amber">{lean.pick}</span>
            </div>
          )}
          {m.opportunity?.executive_brief && <p className="mt-3 text-[0.85rem] leading-relaxed text-text">{m.opportunity.executive_brief}</p>}
        </Panel>
      )}
      {m.opportunity && m.opportunity.signals.length > 0 && (
        <Panel title="Top signals">
          <ul className="space-y-2">
            {m.opportunity.signals.slice(0, 3).map((s) => (
              <li key={s.key} className="flex items-start gap-2 text-[0.8rem] leading-snug"><span className="text-edge">+</span><span className="text-muted">{s.text}</span></li>
            ))}
          </ul>
        </Panel>
      )}
      {m.opportunity && Object.keys(m.opportunity.score_components).length > 0 && (
        <Panel title="Where the edge comes from">
          <ul className="space-y-2.5">
            {Object.entries(m.opportunity.score_components).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([key, v]) => (
              <li key={key} className="flex items-center gap-3">
                <span className="mono w-36 shrink-0 text-[0.65rem] uppercase tracking-wide text-muted">{key.replace(/_/g, " ")}</span>
                <BarMeter value={v} max={30} color="var(--amber)" height={6} />
                <span className="mono w-6 text-right text-[0.7rem] text-text tnum">{v}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );

  // ── SIGNALS (4 categories: Match Result, Half-Time, Goals & Cards, Competition) ──
  const byGroup = (keys: string[]) => (m.signals ?? []).filter((s) => keys.includes(s.signal_group));
  const resultSignals = byGroup(["1x2"]);
  const halftimeSignals = byGroup(["halftime"]);
  const goalsCardsSignals = byGroup(["goals", "cards"]);
  const competitionSignals = byGroup(["competition"]);

  function SignalGroupPanel({ title, list, emptyText }: { title: string; list: MarketSignal[]; emptyText: string }) {
    return (
      <Panel title={title}>
        {list.length > 0 ? (
          <div>{list.map((s, idx) => <SignalRow key={s.id ?? idx} signal={s} matchConfidence={{ score: i?.confidence_score ?? null, band: i?.confidence_band ?? null }} />)}</div>
        ) : (
          <p className="mono py-2 text-[0.68rem] leading-relaxed text-faint">{emptyText}</p>
        )}
      </Panel>
    );
  }

  const ht = m.halfTime;
  const signalsTab = (
    <SubTabs
      items={[
        {
          id: "result",
          label: "Match Result",
          count: resultSignals.length || undefined,
          content: <SignalGroupPanel title="Match result" list={resultSignals} emptyText="No 1X2 signals published for this fixture yet." />,
        },
        {
          id: "halftime",
          label: "Half-Time",
          count: halftimeSignals.length || undefined,
          content: (
            <div className="space-y-4">
              {ht && (
                <Panel title="Half-time intelligence">
                  <div className="grid grid-cols-3 gap-3">
                    <StatCell label="Home HT win" value={ht.home_ht_win_prob != null ? `${Math.round(ht.home_ht_win_prob)}%` : "—"} />
                    <StatCell label="Draw HT" value={ht.draw_ht_prob != null ? `${Math.round(ht.draw_ht_prob)}%` : "—"} />
                    <StatCell label="Away HT win" value={ht.away_ht_win_prob != null ? `${Math.round(ht.away_ht_win_prob)}%` : "—"} />
                  </div>
                  <div className="mono mt-3 flex items-center justify-between border-t border-line pt-3 text-[0.68rem] text-muted">
                    <span>HT/FT lean <span className="text-text">{htFtLabel(ht.hh_prob, ht.dh_prob, ht.dd_prob, ht.aa_prob)}</span></span>
                    {ht.confidence_score != null && (
                      <span style={{ color: confidenceBand(ht.confidence_score).color }}>{confidenceBand(ht.confidence_score).label}</span>
                    )}
                  </div>
                  {(ht.home_2h_goals != null || ht.away_2h_goals != null) && (
                    <div className="mono mt-2 flex gap-4 text-[0.68rem] text-muted">
                      <span>2H goals <span className="text-text">{n1(ht.home_2h_goals)}–{n1(ht.away_2h_goals)}</span></span>
                      {ht.btts_2h_prob != null && <span>2H BTTS <span className="text-text">{Math.round(ht.btts_2h_prob)}%</span></span>}
                    </div>
                  )}
                </Panel>
              )}
              <SignalGroupPanel title="Half-time signals" list={halftimeSignals} emptyText="No half-time signals published for this fixture yet." />
            </div>
          ),
        },
        {
          id: "goalscards",
          label: "Goals / Cards",
          count: goalsCardsSignals.length || undefined,
          content: <SignalGroupPanel title="Goals & cards" list={goalsCardsSignals} emptyText="No goals or cards signals published for this fixture yet." />,
        },
        {
          id: "competition",
          label: "Competition",
          count: competitionSignals.length || undefined,
          content: <SignalGroupPanel title="Competition" list={competitionSignals} emptyText="No competition-context signals published for this fixture yet." />,
        },
      ]}
    />
  );

  // ── TEAMS ──
  const teams = i ? (
    <div className="space-y-4">
      <Panel title="Attack vs defence battle">
        <BattleRow label="Home attack → Away defence" home={i.home_strength_rating} away={i.away_strength_rating} />
        <BattleRow label="Away attack → Home defence" home={i.away_strength_rating} away={i.home_strength_rating} flip />
      </Panel>
      {m.performanceComparison && (
        <Panel title="Zone-by-zone comparison">
          <p className="mono mb-2 text-[0.6rem] text-faint">A separate model view — attack/defence above compares strength ratings; this breaks the match into five tactical zones.</p>
          <ScorecardRow label="Attacking" home={m.performanceComparison.attacking_home_score} away={m.performanceComparison.attacking_away_score} />
          <ScorecardRow label="Defensive" home={m.performanceComparison.defensive_home_score} away={m.performanceComparison.defensive_away_score} />
          <ScorecardRow label="Midfield" home={m.performanceComparison.midfield_home_score} away={m.performanceComparison.midfield_away_score} />
          <ScorecardRow label="Tactical" home={m.performanceComparison.tactical_home_score} away={m.performanceComparison.tactical_away_score} />
          <ScorecardRow label="Set piece" home={m.performanceComparison.set_piece_home_score} away={m.performanceComparison.set_piece_away_score} />
          {m.performanceComparison.most_likely_score && (
            <div className="mono mt-3 flex items-center justify-between border-t border-line pt-3 text-[0.68rem] text-muted">
              <span>Model score lean <span className="text-text">{m.performanceComparison.most_likely_score}</span></span>
              {m.performanceComparison.confidence_band && <span className="text-text">{m.performanceComparison.confidence_band}</span>}
            </div>
          )}
        </Panel>
      )}
      <Panel title="Head-to-head intelligence">
        <div className="mb-3 flex items-center justify-between">
          <span className="mono flex items-center gap-1.5 text-[0.65rem] text-edge"><Crest team={m.home} size={16} /> {m.home.short_name || m.home.name}</span>
          <span className="mono flex items-center gap-1.5 text-[0.65rem] text-cool">{m.away.short_name || m.away.name} <Crest team={m.away} size={16} /></span>
        </div>
        <ScorecardRow label="Readiness" home={i.home_readiness} away={i.away_readiness} explain="readiness" />
        <ScorecardRow label="Squad stability" home={i.home_squad_stability} away={i.away_squad_stability} />
        <ScorecardRow label="Positional depth" home={i.home_positional_depth} away={i.away_positional_depth} />
        <ScorecardRow label="Injury burden" home={i.home_injury_score} away={i.away_injury_score} invert />
        <ScorecardRow label="Travel load" home={i.home_travel_distance_km} away={i.away_travel_distance_km} format={(v) => km(v)} invert max={2000} />
        <ScorecardRow label="XI strength" home={i.home_xi_strength} away={i.away_xi_strength} />
        <ScorecardRow label="Strength rating" home={i.home_strength_rating} away={i.away_strength_rating} />
      </Panel>
      {(m.teamImpact?.home || m.teamImpact?.away) && (
        <Panel title="Team match impact">
          <ScorecardRow label="Overall impact" home={m.teamImpact.home?.overall_impact_score} away={m.teamImpact.away?.overall_impact_score} />
          <ScorecardRow label="Attack strength" home={m.teamImpact.home?.attack_strength} away={m.teamImpact.away?.attack_strength} explain="attack_rating" />
          <ScorecardRow label="Midfield control" home={m.teamImpact.home?.midfield_control} away={m.teamImpact.away?.midfield_control} />
          <ScorecardRow label="Defensive strength" home={m.teamImpact.home?.defensive_strength} away={m.teamImpact.away?.defensive_strength} explain="defence_rating" />
          <ScorecardRow label="Tactical versatility" home={m.teamImpact.home?.tactical_versatility} away={m.teamImpact.away?.tactical_versatility} />
          {m.impactAdvantage && (
            <div className="mono mt-3 border-t border-line pt-3 text-[0.68rem] text-muted">
              <div className="mb-1.5 flex items-center justify-between">
                <span>Advantage margin <span className="text-text">{n0(m.impactAdvantage.advantage_margin)}</span></span>
                {m.impactAdvantage.confidence_score != null && <span>Confidence <span className="text-text">{Math.round(m.impactAdvantage.confidence_score)}%</span></span>}
              </div>
              {m.impactAdvantage.key_advantages && m.impactAdvantage.key_advantages.filter((a) => a !== "No clear advantages").length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {m.impactAdvantage.key_advantages.map((a, idx) => (
                    <li key={idx} className="text-edge">+ {a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>
      )}
      {(m.substitutionImpact || m.squadDepthComparison) && (
        <Panel title="Bench & squad depth">
          {m.substitutionImpact && (
            <>
              <ScorecardRow label="Bench strength" home={m.substitutionImpact.home_bench_strength} away={m.substitutionImpact.away_bench_strength} />
              <ScorecardRow label="Substitution quality" home={m.substitutionImpact.home_substitution_quality} away={m.substitutionImpact.away_substitution_quality} />
            </>
          )}
          {m.squadDepthComparison && (
            <ScorecardRow label="Squad depth" home={m.squadDepthComparison.home_overall_depth_score} away={m.squadDepthComparison.away_overall_depth_score}
              why={m.squadDepthComparison.depth_advantage_band ? `Depth advantage: ${m.squadDepthComparison.depth_advantage_band}` : undefined} />
          )}
        </Panel>
      )}
    </div>
  ) : <Empty text="No comparative intelligence available." />;

  // ── PLAYERS (pitch) ──
  const players = (homeLineup.length > 0 || awayLineup.length > 0) ? (
    <div className="space-y-4">
      <Panel title="Fitness watch"><AvailabilityList players={lineups} /></Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        {homeLineup.length > 0 && <div className="panel p-4"><PitchLineup team={m.home} players={homeLineup} /></div>}
        {awayLineup.length > 0 && <div className="panel p-4"><PitchLineup team={m.away} players={awayLineup} /></div>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {homeLineup.length > 0 && <Panel title={`${m.home.short_name || m.home.name} — pitch versatility`}><PitchCoverage players={homeLineup} /></Panel>}
        {awayLineup.length > 0 && <Panel title={`${m.away.short_name || m.away.name} — pitch versatility`}><PitchCoverage players={awayLineup} /></Panel>}
      </div>
    </div>
  ) : <Empty text="Predicted lineups not published yet." />;

  // ── GOALS ──
  const goals = i ? (
    <div className="space-y-4">
      <Panel title="Goal environment">
        <div className="grid grid-cols-3 gap-3">
          <StatCell label="xG home" value={n1(i.predicted_home_goals)} color="var(--edge)" />
          <StatCell label="xG away" value={n1(i.predicted_away_goals)} color="var(--cool)" />
          <StatCell label="Total" value={n1(totalGoals)} color={totalGoals >= 2.8 ? "var(--amber)" : "var(--muted)"} />
        </div>
        <p className="mt-3 text-[0.8rem] leading-relaxed text-muted">
          {totalGoals >= 2.8 ? "Goal-friendly projection — leans toward the over and BTTS." : totalGoals > 0 && totalGoals <= 2.1 ? "Low-scoring projection — leans under." : "A balanced goal environment with no strong lean."}
        </p>
      </Panel>
      {scorelines.length > 0 && (
        <Panel title="Most likely scores">
          <ul className="space-y-1.5">
            {scorelines.map((s) => (
              <li key={s.score} className="flex items-center gap-2">
                <span className="mono w-10 text-sm font-semibold tnum">{s.score}</span>
                <BarMeter value={s.probability} max={scorelines[0].probability} color="var(--amber)" height={6} />
                <span className="mono w-8 text-right text-[0.7rem] text-muted tnum">{Math.round(s.probability)}%</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Win probability">
        <ProbRow label={m.home.short_name || m.home.name} v={normProb(i.win_probability_home)} color="var(--edge)" />
        <ProbRow label="Draw" v={normProb(i.win_probability_draw)} color="var(--warn)" />
        <ProbRow label={m.away.short_name || m.away.name} v={normProb(i.win_probability_away)} color="var(--cool)" />
      </Panel>
    </div>
  ) : <Empty text="No goal model available." />;

  // ── RISK ──
  const risk = (m.risk && m.risk.risk_factors.length > 0) ? (
    <div className="space-y-4">
      <Panel title="Risk breakdown">
        <div className="mb-3 flex items-center justify-between">
          <StatCell label="Risk score" value={`${m.risk.risk_score}`} sub="/100" />
          <RiskBadge band={m.risk.risk_band} />
        </div>
        <ul className="space-y-2">
          {m.risk.risk_factors.map((f) => (
            <li key={f.key} className="flex items-start gap-3">
              <span className="mono mt-0.5 w-7 shrink-0 text-right text-[0.7rem] font-semibold text-risk tnum">+{f.points}</span>
              <span className="text-[0.8rem] leading-snug text-muted">{f.label}</span>
            </li>
          ))}
        </ul>
      </Panel>
      {m.opportunity && m.opportunity.warnings.length > 0 && (
        <Panel title="Warnings">
          <ul className="space-y-2">
            {m.opportunity.warnings.map((w) => (
              <li key={w.key} className="flex items-start gap-2 text-[0.8rem] leading-snug"><span className="text-risk">!</span><span className="text-muted">{w.text}</span></li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  ) : <Empty text="No decomposed risk factors for this fixture." />;

  // ── MATCHUPS (key battles, positional grid, tactical advantages) ──
  const hasMatchupData = (m.keyBattles?.length ?? 0) > 0 || (m.positionalMatchups?.length ?? 0) > 0 || (m.tacticalAdvantages?.length ?? 0) > 0;
  const matchups = hasMatchupData ? (
    <div className="space-y-4">
      {m.keyBattles && m.keyBattles.length > 0 && (
        <Panel title="Key battles">
          <ul className="space-y-3">
            {m.keyBattles.map((b) => (
              <li key={b.battle_id} className="rounded-term border border-line bg-raised p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[0.8rem] font-semibold text-text">{b.title}</span>
                  <span className="mono text-[0.6rem] uppercase tracking-wide text-muted">{b.expected_impact} impact</span>
                </div>
                <VersusBar home={b.home_advantage_score ?? 50} away={b.away_advantage_score ?? 50} />
                <div className="mono mt-1.5 flex items-center justify-between text-[0.65rem] text-muted">
                  <span className="text-edge">{b.home_player_name ?? "Home"}</span>
                  <span className="text-faint">{b.battle_outcome_prediction}</span>
                  <span className="text-cool">{b.away_player_name ?? "Away"}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {m.positionalMatchups && m.positionalMatchups.length > 0 && (
        <Panel title="Position-by-position">
          {m.positionalMatchups.map((p) => (
            <ScorecardRow key={p.position_code} label={positionLabel(p.position_code)}
              home={p.home_impact_score} away={p.away_impact_score}
              why={p.matchup_description ?? undefined} />
          ))}
        </Panel>
      )}
      {m.tacticalAdvantages && m.tacticalAdvantages.length > 0 && (
        <Panel title="Tactical advantages">
          <ul className="space-y-3">
            {m.tacticalAdvantages.map((t) => (
              <li key={t.advantage_type}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="mono text-[0.65rem] uppercase tracking-wide text-muted">{t.advantage_type.replace(/_/g, " ")}</span>
                  <span className="mono text-[0.6rem]" style={{ color: (t.net_advantage ?? 0) >= 0 ? "var(--edge)" : "var(--cool)" }}>
                    {(t.net_advantage ?? 0) >= 0 ? "Home" : "Away"} +{Math.abs(t.net_advantage ?? 0)}
                  </span>
                </div>
                <VersusBar home={t.home_advantage_score ?? 50} away={t.away_advantage_score ?? 50} />
                {t.tactical_notes && <p className="mt-1 text-[0.72rem] leading-relaxed text-muted">{t.tactical_notes}</p>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  ) : <Empty text="No player or tactical matchup data published for this fixture yet." />;

  return (
    <div className="space-y-4">
      <Link href="/" className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text">← Board</Link>

      {/* Hero */}
      <section className="panel p-5">
        <div className="flex items-center justify-between">
          <span className="mono text-[0.6rem] uppercase tracking-widest text-muted">{m.tournament?.name ?? m.competition}</span>
          <span className="mono text-[0.55rem] text-faint">#{m.external_match_id}</span>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamHead team={m.home} align="right" />
          <div className="text-center">
            {m.home_score != null && m.away_score != null ? (
              <div className="mono text-2xl font-bold tnum">{m.home_score}–{m.away_score}</div>
            ) : (
              <div className="mono text-lg font-semibold text-amber">{k.time}</div>
            )}
            <div className="mono mt-0.5 text-[0.55rem] uppercase tracking-widest text-faint">{k.day}</div>
          </div>
          <TeamHead team={m.away} align="left" />
        </div>
        {(m.opportunity || m.risk) && (
          <div className="mt-4 border-t border-line pt-3"><OpportunityRiskMeter opportunity={m.opportunity?.opportunity_score} risk={m.risk?.risk_score} /></div>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Meta label="Venue" value={m.venue ?? "—"} />
          {m.weather?.temperature_c != null && <Meta label="Weather" value={`${Math.round(m.weather.temperature_c)}°C`} />}
          <Meta label="Countdown" value={k.rel} />
        </div>
      </section>

      {!i && !m.opportunity && !m.risk && (
        <div className="rounded-term border border-line bg-raised/50 p-4 text-center">
          <p className="mono text-[0.7rem] font-semibold text-amber">Intelligence pending</p>
          <p className="mono mt-1 text-[0.62rem] leading-relaxed text-muted">
            This fixture is on the board — the model hasn&rsquo;t finished processing readiness, signals and risk yet. Check back closer to kickoff.
          </p>
        </div>
      )}

      <Tabs
        items={[
          { id: "overview", label: "Overview", content: overview },
          { id: "signals", label: "Signals", content: signalsTab },
          { id: "teams", label: "Teams", content: teams },
          { id: "matchups", label: "Matchups", content: matchups },
          { id: "players", label: "Players", content: players },
          { id: "goals", label: "Goals", content: goals },
          { id: "risk", label: "Risk", content: risk },
        ]}
      />
    </div>
  );
}

// ── helpers ──
function Panel({ title, children, explain }: { title: string; children: React.ReactNode; explain?: GlossaryKey }) {
  return (
    <section className="panel p-4">
      <h2 className="mono mb-3 flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">{title}{explain && <Explain metric={explain} />}</h2>
      {children}
    </section>
  );
}
function TeamHead({ team, align }: { team: MatchRow["home"]; align: "left" | "right" }) {
  return (
    <Link href={`/team/${teamSlug(team)}`} className={`flex items-center gap-2 rounded-term p-1 transition-colors hover:bg-raised ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <Crest team={team} size={40} />
      <div className={align === "right" ? "text-right" : ""}>
        <div className="text-sm font-semibold leading-tight tracking-tight">{team.name}</div>
        {team.country && <div className="mono text-[0.55rem] text-faint">{team.country}</div>}
      </div>
    </Link>
  );
}
function Meta({ label, value }: { label: string; value: string }) {
  return <div className="text-center"><div className="label-cap">{label}</div><div className="mono text-[0.7rem] text-text">{value}</div></div>;
}
function ProbRow({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 last:mb-0">
      <span className="w-24 truncate text-[0.75rem]">{label}</span>
      <BarMeter value={v} color={color} height={8} />
      <span className="mono w-9 text-right text-sm font-semibold tnum" style={{ color }}>{Math.round(v)}%</span>
    </div>
  );
}
function BattleRow({ label, home, away, flip }: { label: string; home: number | null; away: number | null; flip?: boolean }) {
  const h = home ?? 0, a = away ?? 0;
  const advHome = flip ? a > h : h > a;
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="label-cap">{label}</span>
        <span className="mono text-[0.6rem] font-semibold" style={{ color: advHome ? "var(--edge)" : "var(--cool)" }}>
          ADV {advHome ? "HOME" : "AWAY"}
        </span>
      </div>
      <VersusBar home={flip ? a : h} away={flip ? h : a} />
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="mono panel p-6 text-center text-[0.7rem] text-muted">{text}</p>;
}
