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
import { teamSlug } from "@/lib/slug";
import {
  kickoff, n1, km, normProb, opportunityColor, bestLean, normScorelines,
} from "@/lib/intel";
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

  // group signals by market group
  const groups = new Map<string, MarketSignal[]>();
  (m.signals ?? []).forEach((s) => {
    const g = s.signal_group || "other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  });

  // ── OVERVIEW ──
  const overview = (
    <div className="space-y-4">
      {(m.opportunity || m.risk) && (
        <Panel title="Executive decision">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell label="Opportunity" value={`${m.opportunity?.opportunity_score ?? "—"}`} color={opportunityColor(m.opportunity?.opportunity_score)} sub="/100" />
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

  // ── SIGNALS ──
  const GROUP_LABELS: Record<string, string> = { "1x2": "Match result", goals: "Goals", btts: "Both teams to score", cards: "Cards", competition: "Competition", halftime: "Half-time" };
  const signalsTab = (m.signals && m.signals.length > 0) ? (
    <div className="space-y-4">
      {[...groups.entries()].map(([g, list]) => (
        <Panel key={g} title={GROUP_LABELS[g] ?? g}>
          <div>{list.map((s, idx) => <SignalRow key={s.id ?? idx} signal={s} />)}</div>
        </Panel>
      ))}
    </div>
  ) : <Empty text="No market signals published for this fixture yet." />;

  // ── TEAMS ──
  const teams = i ? (
    <div className="space-y-4">
      <Panel title="Attack vs defence battle">
        <BattleRow label="Home attack → Away defence" home={i.home_strength_rating} away={i.away_strength_rating} />
        <BattleRow label="Away attack → Home defence" home={i.away_strength_rating} away={i.home_strength_rating} flip />
      </Panel>
      <Panel title="Head-to-head intelligence">
        <div className="mb-3 flex items-center justify-between">
          <span className="mono flex items-center gap-1.5 text-[0.65rem] text-edge"><Crest team={m.home} size={16} /> {m.home.short_name || m.home.name}</span>
          <span className="mono flex items-center gap-1.5 text-[0.65rem] text-cool">{m.away.short_name || m.away.name} <Crest team={m.away} size={16} /></span>
        </div>
        <ScorecardRow label="Readiness" home={i.home_readiness} away={i.away_readiness} />
        <ScorecardRow label="Squad stability" home={i.home_squad_stability} away={i.away_squad_stability} />
        <ScorecardRow label="Positional depth" home={i.home_positional_depth} away={i.away_positional_depth} />
        <ScorecardRow label="Injury burden" home={i.home_injury_score} away={i.away_injury_score} invert />
        <ScorecardRow label="Travel load" home={i.home_travel_distance_km} away={i.away_travel_distance_km} format={(v) => km(v)} invert max={2000} />
        <ScorecardRow label="XI strength" home={i.home_xi_strength} away={i.away_xi_strength} />
        <ScorecardRow label="Strength rating" home={i.home_strength_rating} away={i.away_strength_rating} />
      </Panel>
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

      <Tabs
        items={[
          { id: "overview", label: "Overview", content: overview },
          { id: "signals", label: "Signals", content: signalsTab },
          { id: "teams", label: "Teams", content: teams },
          { id: "players", label: "Players", content: players },
          { id: "goals", label: "Goals", content: goals },
          { id: "risk", label: "Risk", content: risk },
        ]}
      />
    </div>
  );
}

// ── helpers ──
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">{title}</h2>
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
