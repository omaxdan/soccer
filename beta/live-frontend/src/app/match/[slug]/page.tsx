import { notFound } from "next/navigation";
import { getBandBacktests, getMatchPlayerImpact, getPlayerVersatility } from "@/lib/queries";
import Link from "next/link";
import type { Metadata } from "next";
import { getMatchBySlug, getLineups, getBettingCard, getMatchScoringProbs } from "@/lib/queries";
import { Crest } from "@/components/Crest";
import { StatCell, PickBadge } from "@/components/Primitives";
import { OpportunityRiskMeter, BarMeter, VersusBar } from "@/components/Meters";
import { ModuleReport, buildMatchReadings } from "@/components/ModuleReport";
import { MatchReport, ImportantNote } from "@/components/MatchReport";
import { PredictedXI } from "@/components/PredictedXI";
import { KeyPlayerBattles } from "@/components/KeyPlayerBattles";
import { InjuryPanel } from "@/components/InjuryPanel";
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

  // Modules are evaluated once and shared with <ModuleReport />, which passes
  // the readings on to <MatchReport />.
  const [bandBacktests, playerImpacts] = await Promise.all([
    getBandBacktests(),
    getMatchPlayerImpact(m.id),
  ]);

  // Versatility only where player_versatility holds a row; absent players
  // simply render no versatility line.
  const versatility = await getPlayerVersatility([
    ...homeLineup.map((p) => p.player_id),
    ...awayLineup.map((p) => p.player_id),
  ]);
  const withVersatility = (rows: typeof homeLineup) =>
    rows.map((p) => ({ ...p, versatility_score: versatility[p.player_id] ?? null }));
  const moduleReadings = buildMatchReadings(m, scoringProbs, null, bandBacktests);

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

      {/* 3 — Module report: consensus bar, the full match report, data gaps,
              then the verdict summary. Per-module cards were removed; the
              report carries the same readings without duplicating them. */}
      <ModuleReport
        match={m}
        readings={moduleReadings}
        report={
          <MatchReport
            match={m}
            readings={moduleReadings}
            viewer={currentTier()}
          />
        }
      />

      {/* 4 — Predicted starting elevens */}
      <PredictedXI
        match={m}
        homeLineup={withVersatility(homeLineup)}
        awayLineup={withVersatility(awayLineup)}
      />

      {/* 5 — Key player battles */}
      <KeyPlayerBattles match={m} impacts={playerImpacts} />

      {/* 6 — Unavailable players, when either side has records */}
      <InjuryPanel match={m} />

      {/* 7 — Final disclaimer, after every analysis section */}
      <ImportantNote />

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
