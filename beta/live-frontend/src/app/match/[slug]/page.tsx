import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getMatchBySlug, getLineups, getBettingCard, getMatchScoringProbs } from "@/lib/queries";
import { Crest } from "@/components/Crest";
import { StatCell, PickBadge } from "@/components/Primitives";
import { OpportunityRiskMeter, BarMeter, VersusBar } from "@/components/Meters";
import { PitchLineup } from "@/components/Pitch";
import { ModuleReport } from "@/components/ModuleReport";
import { currentTier } from "@/lib/tier";
import { teamSlug } from "@/lib/slug";
import {
  kickoff, n1, km, normProb, bestLean, normScorelines,
  n0, pct, pickTierByMatch,
} from "@/lib/intel";
import { Explain } from "@/components/Explain";
import type { GlossaryKey } from "@/lib/glossary";
import type { MatchRow, MatchScoringProbabilities } from "@/lib/types";

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

  const scorelines = normScorelines(i?.predicted_scorelines ?? null);
  const totalGoals = (i?.predicted_home_goals ?? 0) + (i?.predicted_away_goals ?? 0);

  const homeName = m.home.short_name || m.home.name;
  const awayName = m.away.short_name || m.away.name;

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

  // ── Standalone sections (no tabs) ──
  // Everything below used to be a tab body. The page is now one scroll:
  // hero, pick, modules, verdict, lineups, story.

  const card = bettingCard.singles.find((s) => s.match_id === m.id) ?? null;

  const pickBand = pick ? (
    <section className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <PickBadge tier={pick} />
      <span className="mono text-[0.78rem] font-semibold text-text">
        {card?.predicted_winner ?? (pick === "BANKER" ? "Banker pick" : "Strong pick")}
      </span>
      {card?.form_gap != null && (
        <span className="mono text-[0.68rem] text-muted">
          Form gap {card.form_gap > 0 ? "+" : ""}{n1(card.form_gap)}
        </span>
      )}
      {card?.historical_win_pct != null && (
        <span className="mono ml-auto text-[0.68rem] text-muted">
          Historical{" "}
          <span className="font-semibold text-text tnum">
            {n1(card.historical_win_pct)}%
          </span>{" "}
          <span className="text-faint">in this tier</span>
        </span>
      )}
    </section>
  ) : null;

  const lineupSection = (homeLineup.length > 0 || awayLineup.length > 0) ? (
    <section>
      <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
        Predicted lineups
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {homeLineup.length > 0 && (
          <div className="panel p-4"><PitchLineup team={m.home} players={homeLineup} /></div>
        )}
        {awayLineup.length > 0 && (
          <div className="panel p-4"><PitchLineup team={m.away} players={awayLineup} /></div>
        )}
      </div>
    </section>
  ) : null;

  const matchStory = matchStoryParts.length > 0 ? (
    <Panel title="Match story">
      <p className="text-[0.85rem] leading-relaxed text-text">{matchStoryParts.join(" ")}</p>
      <div className="mono mt-3 flex gap-4 border-t border-line pt-3 text-[0.62rem]">
        <Link href={`/team/${teamSlug(m.home)}`} className="text-muted transition-colors hover:text-amber">
          View {homeName} profile →
        </Link>
        <Link href={`/team/${teamSlug(m.away)}`} className="text-muted transition-colors hover:text-amber">
          View {awayName} profile →
        </Link>
      </div>
    </Panel>
  ) : null;

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

      {/* 2 — Pick badge */}
      {pickBand}

      {/* 3 — Module report: 12 modules, ordered green → amber → red → grey,
              with the verdict summary rendered inside it. */}
      <ModuleReport
        match={m}
        scoring={scoringProbs}
        viewer={currentTier()}
      />

      {/* 4 — Predicted lineups */}
      {lineupSection}

      {/* 5 — Match story */}
      {matchStory}
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
