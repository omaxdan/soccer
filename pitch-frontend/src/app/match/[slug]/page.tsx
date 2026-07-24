import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getMatchBySlug, getLineups, getBettingCard, getMatchScoringProbs } from "@/lib/queries";
import { Crest } from "@/components/Crest";
import { StatCell, PickBadge } from "@/components/Primitives";
import { OpportunityRiskMeter, RiskBadge, BarMeter, VersusBar } from "@/components/Meters";
import { ScorecardRow } from "@/components/Scorecard";
import { SignalRow, type SignalMatchContext } from "@/components/SignalLedger";
import { AvailabilityList } from "@/components/Lineups";
import { PitchLineup } from "@/components/Pitch";
import { PitchCoverage } from "@/components/PitchCoverage";
import { Tabs } from "@/components/Tabs";
import { SubTabs } from "@/components/SubTabs";
import { teamSlug } from "@/lib/slug";
import {
  kickoff, n1, km, normProb, bestLean, normScorelines,
  htFtLabel, confidenceBand, n0, pct, positionLabel, pickTierByMatch,
} from "@/lib/intel";
import { Explain, EvidenceDisclosure } from "@/components/Explain";
import { RadarChart } from "@/components/RadarChart";
import { lineOf } from "@/lib/formation";
import type { GlossaryKey } from "@/lib/glossary";
import type { MatchRow, MarketSignal, MatchScoringProbabilities } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const m = await getMatchBySlug(slug);
  if (!m) return { title: "Match" };
  return { title: `${m.home.short_name} v ${m.away.short_name}`, description: m.opportunity?.executive_brief ?? undefined };
}

export default async function MatchHub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await getMatchBySlug(slug);
  if (!m) notFound();
  const [lineups, bettingCard, scoringProbs] = await Promise.all([getLineups(m.id), getBettingCard(), getMatchScoringProbs(m.id)]);
  const homeLineup = lineups.filter((p) => p.team_id === m.home.id);
  const awayLineup = lineups.filter((p) => p.team_id === m.away.id);
  const pick = pickTierByMatch(bettingCard.singles).get(m.id);

  const k = kickoff(m.date);
  const i = m.intel;
  const lean = bestLean(m);

  // Real per-team numbers already fetched for this match — used only as a
  // fallback source of evidence when a signal's own `drivers` text is
  // empty. Nothing here is computed for this purpose; it's a reshuffle of
  // values already on the page.
  const matchContext: SignalMatchContext = {
  homeReadiness: i?.home_readiness ?? null,
  awayReadiness: i?.away_readiness ?? null,
  readinessGap: i?.readiness_gap ?? null,
  homeSquadStability: i?.home_squad_stability ?? null,
  awaySquadStability: i?.away_squad_stability ?? null,
  homeForm: m.homeIntel?.form_index ?? null,
  awayForm: m.awayIntel?.form_index ?? null,
  homeAttack: m.homeBetting?.attack_rating ?? null,
  awayAttack: m.awayBetting?.attack_rating ?? null,
  homeDefence: m.homeBetting?.defence_rating ?? null,
  awayDefence: m.awayBetting?.defence_rating ?? null,
  homeTravel: i?.home_travel_distance_km ?? null,
  awayTravel: i?.away_travel_distance_km ?? null,
  homeRest: i?.home_rest_days ?? null,
  awayRest: i?.away_rest_days ?? null,
  homeFatigue: m.homeIntel?.fatigue_index ?? null,
  awayFatigue: m.awayIntel?.fatigue_index ?? null,
  homeQuality: m.homeBetting?.team_quality_score ?? null,
  awayQuality: m.awayBetting?.team_quality_score ?? null,
  homeGoalsPerGame: m.homeSeasonStats?.goals_scored && m.homeSeasonStats?.matches
    ? m.homeSeasonStats.goals_scored / m.homeSeasonStats.matches : null,
  awayGoalsPerGame: m.awaySeasonStats?.goals_scored && m.awaySeasonStats?.matches
    ? m.awaySeasonStats.goals_scored / m.awaySeasonStats.matches : null,
  predictedHomeGoals: i?.predicted_home_goals ?? null,
  predictedAwayGoals: i?.predicted_away_goals ?? null,
  // ⬇️ THESE ARE THE CRITICAL FIELDS THAT WERE MISSING ⬇️
  overallHomeScore: m.performanceComparison?.overall_home_score ?? null,
  overallAwayScore: m.performanceComparison?.overall_away_score ?? null,
  homeWinProb: i?.win_probability_home != null ? normProb(i.win_probability_home) : null,
  awayWinProb: i?.win_probability_away != null ? normProb(i.win_probability_away) : null,
  mostLikelyScore: m.performanceComparison?.most_likely_score ?? null,
  homeXIStrength: i?.home_xi_strength ?? null,
  awayXIStrength: i?.away_xi_strength ?? null,
  homeBenchStrength: m.substitutionImpact?.home_bench_strength ?? null,
  awayBenchStrength: m.substitutionImpact?.away_bench_strength ?? null,
};
  const scorelines = normScorelines(i?.predicted_scorelines ?? null);
  const totalGoals = (i?.predicted_home_goals ?? 0) + (i?.predicted_away_goals ?? 0);

  // ── WHY? — the 3 headline reasons behind the prediction, in plain terms ──
  const homeName = m.home.short_name || m.home.name;
  const awayName = m.away.short_name || m.away.name;
  const whyLines: { text: string }[] = [];
  const whyFacts: { label: string; value: string }[] = [];
  if (matchContext.homeForm != null && matchContext.awayForm != null) {
    const gap = matchContext.homeForm - matchContext.awayForm;
    const favoured = gap >= 0 ? homeName : awayName;
    whyLines.push({ text: `${favoured} carry the form edge — ${n0(matchContext.homeForm)} vs ${n0(matchContext.awayForm)} form index.` });
    whyFacts.push({ label: "Form gap", value: `${gap > 0 ? "+" : ""}${n0(gap)}` });
  }
  if (i?.home_travel_distance_km != null && i?.away_travel_distance_km != null) {
    const diff = i.away_travel_distance_km - i.home_travel_distance_km;
    const traveled = diff >= 0 ? awayName : homeName;
    whyLines.push({ text: `${traveled} have travelled further into this fixture — ${km(i.home_travel_distance_km)} vs ${km(i.away_travel_distance_km)}.` });
    whyFacts.push({ label: "Travel", value: `${km(i.home_travel_distance_km)} · ${km(i.away_travel_distance_km)}` });
  }
  if (i?.home_venue_advantage != null || i?.away_venue_advantage != null) {
    const hv = i?.home_venue_advantage ?? 0, av = i?.away_venue_advantage ?? 0;
    const favoured = hv >= av ? homeName : awayName;
    whyLines.push({ text: `${favoured} hold the venue edge — ${n0(hv)} vs ${n0(av)} venue advantage score.` });
    whyFacts.push({ label: "Venue edge", value: `${n0(hv)} · ${n0(av)}` });
  }

  // ── MATCH STORY — plain-English paragraph connecting team identity to
  // fixture, tense-aware (upcoming fixture vs full-time result) ──
  const matchStoryParts: string[] = [];
  {
    const isFinished = m.status === "finished" || (m.home_score != null && m.away_score != null);
    const hosted = isFinished ? "hosted" : "hosts";
    const gave = isFinished ? "gave" : "gives";
    const predicted = isFinished ? "predicted" : "predicts";
    const was = isFinished ? "was" : "is";
    const favored = isFinished ? "favored" : "favors";
    const added = isFinished ? "added to" : "adds to";

    const hf = m.homeIntel?.last_5_results;
    const hfi = m.homeIntel?.form_index;
    matchStoryParts.push(
      hf && hfi != null
        ? `${homeName} ${hosted} ${awayName} with ${hf} form (${n0(hfi)}/100).`
        : `${homeName} ${hosted} ${awayName}.`
    );

    if (i?.home_strength_rating != null && i?.away_strength_rating != null) {
      const hs = i.home_strength_rating, as_ = i.away_strength_rating;
      const cmp =
        hs < as_ ? `a lower overall strength rating (${n0(hs)} vs ${n0(as_)})`
        : hs > as_ ? `a higher overall strength rating (${n0(hs)} vs ${n0(as_)})`
        : `an even strength rating (${n0(hs)} vs ${n0(as_)})`;
      const advBits: string[] = [];
      if (i.home_venue_advantage != null) advBits.push(`strong home advantage (${n0(i.home_venue_advantage)}/100)`);
      if (i.home_travel_distance_km != null && i.away_travel_distance_km != null) {
        const diff = i.away_travel_distance_km - i.home_travel_distance_km;
        if (diff > 0) advBits.push(`${km(diff)} less travel`);
        else if (diff < 0) advBits.push(`${km(Math.abs(diff))} more travel`);
      }
      if (advBits.length > 0) {
        matchStoryParts.push(`Despite ${cmp}, ${homeName}’s ${advBits.join(" and ")} ${gave} them the edge.`);
      }
    }

    const topBattle = m.keyBattles?.[0];
    if (topBattle?.home_player_name && topBattle?.away_player_name) {
      matchStoryParts.push(`The ${topBattle.title} between ${topBattle.home_player_name} and ${topBattle.away_player_name} ${was} ${topBattle.battle_outcome_prediction ?? "closely matched"}.`);
    }

    if (i?.predicted_home_goals != null && i?.predicted_away_goals != null) {
      const confStr = i.confidence_score != null ? ` (confidence: ${Math.round(i.confidence_score)}%)` : "";
      matchStoryParts.push(`The model ${predicted} ${n1(i.predicted_home_goals)}–${n1(i.predicted_away_goals)}${confStr}.`);
    }

    if (m.weather?.temperature_c != null) {
      const restEdgeHome = i?.home_rest_days != null && i?.away_rest_days != null && i.home_rest_days > i.away_rest_days;
      const travelBurdenAway = i?.home_travel_distance_km != null && i?.away_travel_distance_km != null && i.away_travel_distance_km > i.home_travel_distance_km;
      const impact = restEdgeHome ? `${favored} the well-rested home team` : travelBurdenAway ? `${added} the away team’s travel burden` : `${was} a neutral factor`;
      matchStoryParts.push(`Weather (${Math.round(m.weather.temperature_c)}°C${m.weather.weather_condition ? `, ${m.weather.weather_condition}` : ""}) ${impact}.`);
    }
  }

  // ── PERFORMANCE ZONES — summary stats explaining the zone-by-zone radar
  // (full radar + advantage grid stays in Full Breakdown → Teams, unchanged) ──
  const pc = m.performanceComparison;
  const zones = pc ? [
    { label: "Attack", adv: pc.attacking_advantage, home: pc.attacking_home_score, away: pc.attacking_away_score },
    { label: "Defence", adv: pc.defensive_advantage, home: pc.defensive_home_score, away: pc.defensive_away_score },
    { label: "Midfield", adv: pc.midfield_advantage, home: pc.midfield_home_score, away: pc.midfield_away_score },
    { label: "Tactical", adv: pc.tactical_advantage, home: pc.tactical_home_score, away: pc.tactical_away_score },
    { label: "Set piece", adv: pc.set_piece_advantage, home: pc.set_piece_home_score, away: pc.set_piece_away_score },
    { label: "Form", adv: pc.form_advantage, home: pc.form_home_score, away: pc.form_away_score },
  ].filter((z): z is { label: string; adv: number; home: number | null; away: number | null } => z.adv != null) : [];
  const biggestZone = zones.length > 0 ? zones.reduce((a, b) => Math.abs(b.adv) > Math.abs(a.adv) ? b : a) : null;
  const closestZone = zones.length > 0 ? zones.reduce((a, b) => Math.abs(b.adv) < Math.abs(a.adv) ? b : a) : null;

  // ── OVERVIEW ──
const overview = (
  <div className="space-y-4">
    {pick && (
      <div className="flex items-center gap-2">
        <PickBadge tier={pick} />
        <span className="mono text-[0.6rem] text-muted">This fixture is in today&rsquo;s Form Index Picks</span>
      </div>
    )}
    {(m.opportunity || m.risk) && (
      <Panel title="Executive decision">
        {lean && (
          <div className="mt-3 flex items-center gap-2 rounded-term border border-line bg-raised p-3">
            <span className="label-cap">Best lean</span>
            <span className="mono text-sm font-semibold text-amber">{lean.pick}</span>
          </div>
        )}
        {i?.home_rest_days != null && i?.away_rest_days != null && (
          <div className="mono mt-3 flex items-center justify-between rounded-term border border-line bg-raised p-3 text-[0.72rem]">
            <span className="label-cap">Rest days</span>
            <span className="text-text">
              {n0(i.home_rest_days)}d vs {n0(i.away_rest_days)}d
              {i.home_rest_days !== i.away_rest_days && (
                <span className="ml-2 font-semibold text-amber">
                  {i.home_rest_days > i.away_rest_days
                    ? `+${n0(i.home_rest_days - i.away_rest_days)} ${homeName}`
                    : `+${n0(i.away_rest_days - i.home_rest_days)} ${awayName}`}
                </span>
              )}
            </span>
          </div>
        )}
        {m.opportunity?.executive_brief && (
          <p className="mt-3 text-[0.85rem] leading-relaxed text-text">{m.opportunity.executive_brief}</p>
        )}
        <EvidenceDisclosure label="this prediction" lines={whyLines} facts={whyFacts} />
      </Panel>
    )}

    {matchStoryParts.length > 0 && (
      <Panel title="Match story">
        <p className="text-[0.85rem] leading-relaxed text-text">{matchStoryParts.join(" ")}</p>
        <div className="mono mt-3 flex gap-4 border-t border-line pt-3 text-[0.62rem]">
          <Link href={`/team/${teamSlug(m.home)}`} className="text-muted transition-colors hover:text-amber">View {homeName} profile →</Link>
          <Link href={`/team/${teamSlug(m.away)}`} className="text-muted transition-colors hover:text-amber">View {awayName} profile →</Link>
        </div>
      </Panel>
    )}

    {pc && zones.length > 0 && (
      <Panel title="Performance zones">
        <RadarChart
          axes={zones.map((z) => z.label)}
          homeValues={zones.map((z) => z.home ?? 0)}
          awayValues={zones.map((z) => z.away ?? 0)}
          homeLabel={homeName}
          awayLabel={awayName}
        />
        <div className="mono mt-3 space-y-1.5 border-t border-line pt-3 text-[0.68rem] text-muted">
          {biggestZone && (
            <div className="flex items-center justify-between">
              <span>Biggest advantage</span>
              <span className="text-text">
                {biggestZone.label} {biggestZone.adv >= 0 ? "+" : ""}{biggestZone.adv} — {biggestZone.adv >= 0 ? homeName : awayName} {Math.abs(biggestZone.adv) >= 15 ? "dominated" : "edged it"}
              </span>
            </div>
          )}
          {closestZone && (
            <div className="flex items-center justify-between">
              <span>Closest zone</span>
              <span className="text-text">{closestZone.label} even at {n0(closestZone.home)}-{n0(closestZone.away)}</span>
            </div>
          )}
          {pc.overall_advantage != null && (
            <div className="flex items-center justify-between">
              <span>Overall verdict</span>
              <span className="font-semibold" style={{ color: pc.overall_advantage >= 0 ? "var(--edge)" : "var(--cool)" }}>
                {pc.overall_advantage >= 0 ? homeName : awayName} {pc.overall_advantage >= 0 ? "+" : ""}{pc.overall_advantage} overall
              </span>
            </div>
          )}
        </div>
      </Panel>
    )}

    {m.opportunity && m.opportunity.signals && m.opportunity.signals.length > 0 && (
      <Panel title="Top signals">
        <ul className="space-y-2">
          {m.opportunity.signals.slice(0, 3).map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-[0.8rem] leading-snug">
              <span className="text-edge">+</span>
              <span className="text-muted">{s.text}</span>
            </li>
          ))}
        </ul>
      </Panel>
    )}
    
    {m.opportunity?.score_components && Object.keys(m.opportunity.score_components).length > 0 && (
      <Panel title="Where the edge comes from">
        <ul className="space-y-2.5">
          {Object.entries(m.opportunity.score_components)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([key, v]) => (
              <li key={key} className="flex items-center gap-3">
                <span className="mono w-36 shrink-0 text-[0.65rem] uppercase tracking-wide text-muted">
                  {key.replace(/_/g, " ")}
                </span>
                <BarMeter value={v} max={30} color="var(--amber)" height={6} />
                <span className="mono w-6 text-right text-[0.7rem] text-text tnum">{v}</span>
              </li>
            ))}
        </ul>
      </Panel>
    )}
    
    {!m.opportunity && !m.risk && !i && (
      <div className="panel p-4 text-center">
        <p className="mono text-[0.7rem] text-muted">No intelligence available for this match yet.</p>
      </div>
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
          <div>{list.map((s, idx) => <SignalRow key={s.id ?? idx} signal={s} matchConfidence={{ score: i?.confidence_score ?? null, band: i?.confidence_band ?? null }} matchContext={matchContext} />)}</div>
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
          <p className="mono mb-2 text-[0.6rem] text-faint">A separate model view — attack/defence above compares strength ratings; this breaks the match into six tactical zones.</p>
          <RadarChart
            axes={["Attacking", "Defensive", "Midfield", "Tactical", "Set Piece", "Form"]}
            homeValues={[
              m.performanceComparison.attacking_home_score ?? 0,
              m.performanceComparison.defensive_home_score ?? 0,
              m.performanceComparison.midfield_home_score ?? 0,
              m.performanceComparison.tactical_home_score ?? 0,
              m.performanceComparison.set_piece_home_score ?? 0,
              m.performanceComparison.form_home_score ?? 0,
            ]}
            awayValues={[
              m.performanceComparison.attacking_away_score ?? 0,
              m.performanceComparison.defensive_away_score ?? 0,
              m.performanceComparison.midfield_away_score ?? 0,
              m.performanceComparison.tactical_away_score ?? 0,
              m.performanceComparison.set_piece_away_score ?? 0,
              m.performanceComparison.form_away_score ?? 0,
            ]}
            homeLabel={m.home.short_name || m.home.name}
            awayLabel={m.away.short_name || m.away.name}
          />
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-3 sm:grid-cols-3">
            <AdvChip value={m.performanceComparison.attacking_advantage} label="Attacking" />
            <AdvChip value={m.performanceComparison.defensive_advantage} label="Defensive" />
            <AdvChip value={m.performanceComparison.midfield_advantage} label="Midfield" />
            <AdvChip value={m.performanceComparison.tactical_advantage} label="Tactical" />
            <AdvChip value={m.performanceComparison.set_piece_advantage} label="Set piece" />
            <AdvChip value={m.performanceComparison.form_advantage} label="Form" />
          </div>
          <div className="mono mt-3 space-y-1.5 border-t border-line pt-3 text-[0.68rem] text-muted">
            <div className="flex items-center justify-between">
              <span>Overall advantage <span className="text-text">{n0(m.performanceComparison.overall_advantage)}</span></span>
              {m.performanceComparison.predicted_winner_id != null && (
                <span>
                  Model favours{" "}
                  <span className="text-text">
                    {m.performanceComparison.predicted_winner_id === m.home.id ? m.home.short_name || m.home.name
                      : m.performanceComparison.predicted_winner_id === m.away.id ? m.away.short_name || m.away.name
                      : "—"}
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center justify-between">
              {m.performanceComparison.prediction_confidence != null && (
                <span>Prediction confidence <span className="text-text">{Math.round(m.performanceComparison.prediction_confidence)}%</span></span>
              )}
              {m.performanceComparison.match_significance != null && (
                <span>Match significance <span className="text-text">{n0(m.performanceComparison.match_significance)}</span></span>
              )}
              {m.performanceComparison.expected_goal_difference != null && (
                <span>Expected goal diff <span className="text-text">{n1(m.performanceComparison.expected_goal_difference)}</span></span>
              )}
            </div>
          </div>
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
        <ScorecardRow label="XI strength" home={i.home_xi_strength} away={i.away_xi_strength} explain="xi_strength" />
        <ScorecardRow label="Strength rating" home={i.home_strength_rating} away={i.away_strength_rating} />
        <ScorecardRow label="Venue advantage" home={i.home_venue_advantage} away={i.away_venue_advantage} />
        {(i.motivation_gap != null || i.congestion_factor != null || i.travel_advantage_score != null) && (
          <div className="mono mt-3 flex items-center justify-between border-t border-line pt-3 text-[0.68rem] text-muted">
            {i.motivation_gap != null && <span>Motivation gap <span className="text-text">{n0(i.motivation_gap)}</span></span>}
            {i.congestion_factor != null && <span>Congestion factor <span className="text-text">{n0(i.congestion_factor)}</span></span>}
            {i.travel_advantage_score != null && <span>Travel advantage <span className="text-text">{n0(i.travel_advantage_score)}</span></span>}
          </div>
        )}
      </Panel>

      {(m.homeBetting || m.awayBetting) && (
        <Panel title="Betting profile comparison">
          <div className="mb-3 flex items-center justify-between">
            <span className="mono flex items-center gap-1.5 text-[0.65rem] text-edge"><Crest team={m.home} size={16} /> {m.home.short_name || m.home.name}</span>
            <span className="mono flex items-center gap-1.5 text-[0.65rem] text-cool">{m.away.short_name || m.away.name} <Crest team={m.away} size={16} /></span>
          </div>
          {([
            ["Attack rating", "attack_rating", "attack_rating"],
            ["Defence rating", "defence_rating", "defence_rating"],
            ["Team quality", "team_quality_score", "team_quality_score"],
            ["Finishing efficiency", "finishing_efficiency", "finishing_efficiency"],
            ["Shot accuracy", "shot_accuracy", "shot_accuracy"],
            ["Shot conversion", "shot_conversion_rate", "shot_conversion_rate"],
            ["Big-chance conversion", "big_chance_conversion", "big_chance_conversion"],
            ["Goal creation", "goal_creation_score", "goal_creation_score"],
            ["Goal prevention", "goal_prevention_score", "goal_prevention_score"],
            ["Clean sheet reliability", "clean_sheet_reliability", "clean_sheet_reliability"],
            ["Consistency", "consistency_score", "consistency_score"],
            ["Winner market", "winner_market_score", "winner_market_score"],
            ["Goals market", "goals_market_score", "goals_market_score"],
            ["BTTS", "btts_score", "btts_score"],
            ["Cards market", "cards_market_score", "cards_market_score"],
          ] as [string, keyof NonNullable<MatchRow["homeBetting"]>, GlossaryKey][])
            .filter(([, key]) => m.homeBetting?.[key] != null || m.awayBetting?.[key] != null)
            .map(([label, key, explain]) => (
              <ScorecardRow
                key={key}
                label={label}
                home={m.homeBetting?.[key] as number | null}
                away={m.awayBetting?.[key] as number | null}
                explain={explain}
              />
            ))}
        </Panel>
      )}
      {(m.teamImpact?.home || m.teamImpact?.away) && (
        <Panel title="Team match impact">
          <StatCell label="Overall impact" value={`${n0(m.teamImpact.home?.overall_impact_score)} vs ${n0(m.teamImpact.away?.overall_impact_score)}`} />
          <div className="mt-3">
            <RadarChart
              axes={["Attack", "Midfield", "Defence", "Versatility", "Experience", "Set Piece"]}
              homeValues={[
                m.teamImpact.home?.attack_strength ?? 0,
                m.teamImpact.home?.midfield_control ?? 0,
                m.teamImpact.home?.defensive_strength ?? 0,
                m.teamImpact.home?.tactical_versatility ?? 0,
                m.teamImpact.home?.experience_level ?? 0,
                m.teamImpact.home?.set_piece_threat ?? 0,
              ]}
              awayValues={[
                m.teamImpact.away?.attack_strength ?? 0,
                m.teamImpact.away?.midfield_control ?? 0,
                m.teamImpact.away?.defensive_strength ?? 0,
                m.teamImpact.away?.tactical_versatility ?? 0,
                m.teamImpact.away?.experience_level ?? 0,
                m.teamImpact.away?.set_piece_threat ?? 0,
              ]}
              homeLabel={m.home.short_name || m.home.name}
              awayLabel={m.away.short_name || m.away.name}
            />
          </div>
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
              <ScorecardRow label="Bench depth score" home={m.substitutionImpact.home_depth_score} away={m.substitutionImpact.away_depth_score} />
              <ScorecardRow label="Tactical sub options" home={m.substitutionImpact.home_tactical_sub_options} away={m.substitutionImpact.away_tactical_sub_options} />
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
      <div className="grid gap-4 lg:grid-cols-2">
        {homeLineup.length > 0 && <div className="panel p-4"><PitchLineup team={m.home} players={homeLineup} /></div>}
        {awayLineup.length > 0 && <div className="panel p-4"><PitchLineup team={m.away} players={awayLineup} /></div>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {homeLineup.length > 0 && <Panel title={`${m.home.short_name || m.home.name} — pitch versatility`}><PitchCoverage players={homeLineup} /></Panel>}
        {awayLineup.length > 0 && <Panel title={`${m.away.short_name || m.away.name} — pitch versatility`}><PitchCoverage players={awayLineup} /></Panel>}
      </div>
      {m.keyBattles && m.keyBattles.length > 0 && (
        <Panel title="Key battles">
          <ul className="space-y-3">
            {m.keyBattles.slice(0, 3).map((b) => (
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
      <Panel title="Fitness watch"><AvailabilityList players={lineups} /></Panel>
    </div>
  ) : <Empty text="Predicted lineups not published yet." />;

  // ── GOALS ──
  const bttsSignal = (m.signals ?? []).find((s) => s.market === "BTTS");
  const overSignal = (m.signals ?? []).find((s) => s.market === "Total Goals O/U");
  const goalLean = totalGoals >= 2.8 ? "Goal-friendly" : totalGoals > 0 && totalGoals <= 2.1 ? "Low-scoring" : "Balanced";
  const goals = i ? (
    <div className="space-y-4">
      <Panel title="Goal market signals">
        <div className="grid grid-cols-3 gap-3">
          <StatCell
            label="BTTS"
            value={bttsSignal?.signal_text ?? "—"}
            color={signalColor(bttsSignal?.signal_text)}
            sub={bttsSignal ? `strength ${bttsSignal.strength}` : undefined}
          />
          <StatCell
            label="Over 2.5"
            value={overSignal?.signal_text ?? "—"}
            color={signalColor(overSignal?.signal_text)}
            sub={overSignal ? `strength ${overSignal.strength}` : undefined}
          />
          <StatCell
            label="Total goals"
            value={n1(totalGoals)}
            color={totalGoals >= 2.8 ? "var(--amber)" : "var(--muted)"}
          />
        </div>
        <div className="mono mt-3 flex items-center justify-between border-t border-line pt-3 text-[0.65rem] text-muted">
          <span>xG {n1(i.predicted_home_goals)} – {n1(i.predicted_away_goals)}</span>
          <span>{goalLean}</span>
        </div>
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
          <RadarChart
            axes={["GK", "DEF", "MID", "ATT"]}
            homeValues={groupByLine(m.positionalMatchups, "home_impact_score")}
            awayValues={groupByLine(m.positionalMatchups, "away_impact_score")}
            homeLabel={m.home.short_name || m.home.name}
            awayLabel={m.away.short_name || m.away.name}
          />
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            {m.positionalMatchups.map((p) => (
              <ScorecardRow key={p.position_code} label={positionLabel(p.position_code)}
                home={p.home_impact_score} away={p.away_impact_score}
                why={p.matchup_description ?? undefined} />
            ))}
          </div>
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
        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
          <Meta label="Venue" value={m.venue ?? "—"} />
          {m.weather?.temperature_c != null && (
            <Meta
              label="Weather"
              value={`${Math.round(m.weather.temperature_c)}°C${m.weather.weather_condition ? ` · ${m.weather.weather_condition}` : ""}`}
            />
          )}
          <Meta label="Countdown" value={k.rel} />
        </div>
        {i?.predicted_home_goals != null && i?.predicted_away_goals != null && (
              <div className="mono mt-1 text-[0.6rem] text-muted justify-center flex items-center gap-1 pt-2">
                Expected Goals: {n1(i.predicted_home_goals)} – {n1(i.predicted_away_goals)}
              </div>
            )}
        {scoringProbs && <ScoringProbsCard probs={scoringProbs} homeName={homeName} awayName={awayName} />}
        {(m.opportunity || m.risk) && (
          <div className="mt-4 border-t border-line pt-3"><OpportunityRiskMeter opportunity={m.opportunity?.opportunity_score} risk={m.risk?.risk_score} /></div>
        )}
        {i && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-3">
            <StatCell
              label="Readiness gap"
              value={i.readiness_gap != null ? `${i.readiness_gap > 0 ? "+" : ""}${n0(i.readiness_gap)}` : "—"}
              color={(i.readiness_gap ?? 0) !== 0 ? "var(--amber)" : undefined}
            />
            <StatCell
              label="Confidence"
              value={i.confidence_score != null ? `${Math.round(i.confidence_score)}%` : "—"}
              sub={i.confidence_band ?? ""}
            />
            <StatCell label="Predictability" value={pct(m.risk?.predictability_score)} />
            <StatCell
              label="Winner market"
              value={<CompareValue home={m.homeBetting?.winner_market_score} away={m.awayBetting?.winner_market_score} />}
              explain="winner_market_score"
            />
            <StatCell
              label="Adjusted form"
              value={<CompareValue home={m.homeFormQuality?.opponent_adjusted_form} away={m.awayFormQuality?.opponent_adjusted_form} />}
              explain="opponent_adjusted_form"
            />
            <StatCell
              label="Giant-killer"
              value={<CompareValue home={m.homeFormQuality?.giant_killer_score} away={m.awayFormQuality?.giant_killer_score} />}
              explain="giant_killer_score"
            />
          </div>
        )}
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
          { id: "goals", label: "Goals", content: goals },
          { id: "players", label: "Players", content: players },
          {
            id: "breakdown",
            label: "Full Breakdown",
            content: (
              <SubTabs
                items={[
                  { id: "signals", label: "Signals", content: signalsTab },
                  { id: "teams", label: "Teams", content: teams },
                  { id: "matchups", label: "Matchups", content: matchups },
                  { id: "risk", label: "Risk", content: risk },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

// ── helpers ──
function Panel({ title, children, explain }: { title: string; children: React.ReactNode; explain?: GlossaryKey }) {
  return (
    <section className="panel p-4">
      <h2 className="mono mb-3 flex items-center text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
        {title}
        {explain && <Explain metric={explain} />}
      </h2>
      {children || <p className="mono text-[0.6rem] text-muted">No data available</p>}
    </section>
  );
}
function TeamHead({ team, align }: { team: MatchRow["home"]; align: "left" | "right" }) {
  return (
    <Link href={`/team/${teamSlug(team)}`} className={`flex items-center gap-2 rounded-term p-1 transition-colors hover:bg-raised ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <Crest team={team} size={40} />
      <div className={align === "right" ? "text-right" : ""}>
        <div className="text-sm font-semibold leading-tight tracking-tight">{team.short_name}</div>
        {team.country && <div className="mono text-[0.55rem] text-faint">{team.country}</div>}
      </div>
    </Link>
  );
}
function CompareValue({ home, away }: { home: number | null | undefined; away: number | null | undefined }) {
  return (
    <>
      <span style={{ color: "var(--edge)" }}>{pct(home)}</span>
      <span className="text-faint"> / </span>
      <span style={{ color: "var(--cool)" }}>{pct(away)}</span>
    </>
  );
}
// mv_match_scoring_probabilities returns percentages as strings — parse
// once, format everywhere.
function scoringNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const num = typeof v === "number" ? v : parseFloat(v);
  return Number.isNaN(num) ? null : num;
}
function scoringPct(v: string | number | null | undefined): string {
  const n = scoringNum(v);
  return n == null ? "—" : `${Math.round(n)}%`;
}
function ScoringProbsCard({ probs, homeName, awayName }: { probs: MatchScoringProbabilities; homeName: string; awayName: string }) {
  const btts = scoringNum(probs.btts_pct);
  const bttsColor = btts != null && btts >= 55 ? "var(--amber)" : "var(--text)";
  const partial = probs.components_available != null && probs.components_available < 4;
  return (
    <div className="mt-3 rounded-term border border-line bg-raised/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono text-sm font-bold tnum" style={{ color: bttsColor }}>BTTS: {scoringPct(probs.btts_pct)}</span>
        {probs.btts_verdict && <span className="mono text-[0.6rem] text-muted">{probs.btts_verdict}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center">
          <div className="label-cap">Home to score</div>
          <div className="mono text-lg font-bold tnum" style={{ color: "var(--edge)" }}>{scoringPct(probs.home_to_score_pct)}</div>
          <div className="mono mt-1 text-[0.55rem] text-faint">
            Scores in {scoringPct(probs.home_scores_pct)} of home games ({probs.home_sample ?? "—"})
          </div>
          <div className="mono text-[0.55rem] text-faint">
            vs {awayName} concedes in {scoringPct(probs.away_concedes_pct)} of away games ({probs.away_concede_sample ?? "—"})
          </div>
        </div>
        <div className="text-center">
          <div className="label-cap">Away to score</div>
          <div className="mono text-lg font-bold tnum" style={{ color: "var(--cool)" }}>{scoringPct(probs.away_to_score_pct)}</div>
          <div className="mono mt-1 text-[0.55rem] text-faint">
            Scores in {scoringPct(probs.away_scores_pct)} of away games ({probs.away_sample ?? "—"})
          </div>
          <div className="mono text-[0.55rem] text-faint">
            vs {homeName} concedes in {scoringPct(probs.home_concedes_pct)} of home games ({probs.home_concede_sample ?? "—"})
          </div>
        </div>
      </div>
      <div className="mono mt-3 border-t border-line pt-2.5 text-center text-[0.55rem] text-muted">
        H2H BTTS {scoringPct(probs.historical_btts_pct)} · League BTTS {scoringPct(probs.league_btts_pct)}
      </div>
      {partial && (
        <p className="mono mt-2 text-center text-[0.55rem] text-faint">
          Partial data — some teams have fewer than 5 matches in sample.
        </p>
      )}
    </div>
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
function AdvChip({ value, label }: { value: number | null | undefined; label?: string }) {
  if (value == null || value === 0) return null;
  const home = value >= 0;
  return (
    <span className="mono flex items-center justify-between gap-2 text-[0.65rem]">
      {label && <span className="text-faint">{label}</span>}
      <span className="font-semibold" style={{ color: home ? "var(--edge)" : "var(--cool)" }}>
        {home ? "+" : "−"}{Math.abs(value)} {home ? "Home" : "Away"}
      </span>
    </span>
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
function signalColor(text: string | null | undefined): string {
  if (!text || text === "No Edge") return "var(--muted)";
  return "var(--amber)";
}
// Averages per-position matchup scores into the 4 broad lines (GK/DEF/MID/
// ATT) for the position-matchups radar — several DEF/MID entries collapse
// into a single axis value each.
function groupByLine(
  matchups: { position_code: string; home_impact_score: number | null; away_impact_score: number | null }[],
  key: "home_impact_score" | "away_impact_score"
): number[] {
  const lines = ["GK", "DEF", "MID", "FWD"] as const;
  return lines.map((line) => {
    const vals = matchups
      .filter((p) => lineOf(p.position_code) === line)
      .map((p) => p[key])
      .filter((v): v is number => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  });
}
