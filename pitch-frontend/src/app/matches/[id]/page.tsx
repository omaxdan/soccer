import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getMatch, getLineups } from "@/lib/queries";
import { Crest } from "@/components/Crest";
import { Section, StatCell } from "@/components/Primitives";
import { OpportunityRiskMeter, RiskBadge, BarMeter } from "@/components/Meters";
import { ScorecardRow } from "@/components/Scorecard";
import { SignalRow } from "@/components/SignalLedger";
import { TeamLineup, AvailabilityList } from "@/components/Lineups";
import {
  kickoff, n1, km, normProb, opportunityColor, bestLean,
  normScorelines, readinessTier, fatigueTier,
} from "@/lib/intel";
import type { MatchRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const m = await getMatch(Number(id));
  if (!m) return { title: "Match" };
  return {
    title: `${m.home.name} v ${m.away.name}`,
    description: m.opportunity?.executive_brief ?? undefined,
  };
}

export default async function MatchHub({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const m = await getMatch(Number(id));
  if (!m) notFound();
  const lineups = await getLineups(m.id);
  const homeLineup = lineups.filter((p) => p.team_id === m.home.id);
  const awayLineup = lineups.filter((p) => p.team_id === m.away.id);

  const k = kickoff(m.date);
  const i = m.intel;
  const lean = bestLean(m);
  const scorelines = normScorelines(i?.predicted_scorelines ?? null);
  const totalGoals =
    (i?.predicted_home_goals ?? 0) + (i?.predicted_away_goals ?? 0);

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text"
      >
        ← Board
      </Link>

      {/* ── 1 · Match identity ─────────────────────────── */}
      <section className="panel p-5">
        <div className="flex items-center justify-between">
          <span className="mono text-[0.6rem] uppercase tracking-widest text-muted">
            {m.tournament?.name ?? m.competition}
          </span>
          <span className="mono text-[0.55rem] text-faint">
            #{m.external_match_id}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamHead team={m.home} align="right" />
          <div className="text-center">
            {m.home_score != null && m.away_score != null ? (
              <div className="mono text-2xl font-bold tnum">
                {m.home_score}–{m.away_score}
              </div>
            ) : (
              <div className="mono text-lg font-semibold text-amber">{k.time}</div>
            )}
            <div className="mono mt-0.5 text-[0.55rem] uppercase tracking-widest text-faint">
              {k.day}
            </div>
          </div>
          <TeamHead team={m.away} align="left" />
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-line pt-3">
          <Meta label="Venue" value={m.venue ?? "—"} />
          <Meta label="City" value={m.city ?? "—"} />
          {m.weather?.temperature_c != null && (
            <Meta
              label="Weather"
              value={`${Math.round(m.weather.temperature_c)}°C ${m.weather.weather_condition ?? ""}`.trim()}
            />
          )}
          <Meta label="Countdown" value={k.rel} />
        </div>
      </section>

      {/* ── 2 · Executive decision ─────────────────────── */}
      {(m.opportunity || m.risk) && (
        <Section index="01" title="Executive decision">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCell
              label="Opportunity"
              value={`${m.opportunity?.opportunity_score ?? "—"}`}
              color={opportunityColor(m.opportunity?.opportunity_score)}
              sub="/100"
            />
            <StatCell
              label="Risk"
              value={m.risk ? `${m.risk.risk_score}` : "—"}
              sub={m.risk ? m.risk.risk_band : ""}
              color={m.risk ? "var(--text)" : undefined}
            />
            <StatCell
              label="Predictability"
              value={m.risk ? `${m.risk.predictability_score}` : "—"}
              sub="/100"
            />
            <StatCell
              label="Confidence"
              value={i?.confidence_score != null ? `${Math.round(i.confidence_score)}%` : "—"}
              sub={i?.confidence_band ?? ""}
            />
          </div>

          <div className="mt-3">
            <OpportunityRiskMeter
              opportunity={m.opportunity?.opportunity_score}
              risk={m.risk?.risk_score}
            />
          </div>

          {lean && (
            <div className="mt-3 flex items-center gap-2 rounded-term border border-line bg-raised p-3">
              <span className="label-cap">Best lean</span>
              <span className="mono text-sm font-semibold text-amber">
                {lean.pick}
              </span>
            </div>
          )}

          {m.opportunity?.executive_brief && (
            <p className="mt-3 text-[0.85rem] leading-relaxed text-text">
              {m.opportunity.executive_brief}
            </p>
          )}
        </Section>
      )}

      {/* ── 3 · Win probability + scores ───────────────── */}
      {i && (
        <Section index="02" title="Prediction center">
          <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="label-cap mb-2">Win probability</p>
              <ProbRow label={m.home.short_name || m.home.name} v={normProb(i.win_probability_home)} color="var(--edge)" />
              <ProbRow label="Draw" v={normProb(i.win_probability_draw)} color="var(--warn)" />
              <ProbRow label={m.away.short_name || m.away.name} v={normProb(i.win_probability_away)} color="var(--cool)" />
              <div className="mono mt-3 flex items-center justify-between text-[0.7rem] text-muted">
                <span>Expected goals</span>
                <span>
                  <span className="text-edge">{n1(i.predicted_home_goals)}</span>
                  {" – "}
                  <span className="text-cool">{n1(i.predicted_away_goals)}</span>
                  <span className="ml-2 text-faint">Σ {n1(totalGoals)}</span>
                </span>
              </div>
            </div>

            {scorelines.length > 0 && (
              <div>
                <p className="label-cap mb-2">Most likely scores</p>
                <ul className="space-y-1.5">
                  {scorelines.map((s) => (
                    <li key={s.score} className="flex items-center gap-2">
                      <span className="mono w-10 text-sm font-semibold tnum">{s.score}</span>
                      <BarMeter value={s.probability} max={scorelines[0].probability} color="var(--amber)" height={6} />
                      <span className="mono w-8 text-right text-[0.7rem] text-muted tnum">
                        {Math.round(s.probability)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── 4 · Intelligence scorecards ────────────────── */}
      {i && (
        <Section index="03" title="Head-to-head intelligence">
          <div className="mb-3 flex items-center justify-between">
            <span className="mono flex items-center gap-1.5 text-[0.65rem] text-edge">
              <Crest team={m.home} size={16} /> {m.home.short_name || m.home.name}
            </span>
            <span className="mono flex items-center gap-1.5 text-[0.65rem] text-cool">
              {m.away.short_name || m.away.name} <Crest team={m.away} size={16} />
            </span>
          </div>
          <ScorecardRow
            label="Readiness"
            home={i.home_readiness}
            away={i.away_readiness}
            why={readinessWhy(i.home_readiness, i.away_readiness, m)}
          />
          <ScorecardRow
            label="Fatigue"
            home={i.home_injury_score != null ? invFatigue(m, true) : null}
            away={i.away_injury_score != null ? invFatigue(m, false) : null}
            invert
            why={fatigueWhy(m)}
          />
          <ScorecardRow label="Squad stability" home={i.home_squad_stability} away={i.away_squad_stability} />
          <ScorecardRow label="Positional depth" home={i.home_positional_depth} away={i.away_positional_depth} />
          <ScorecardRow
            label="Injury burden"
            home={i.home_injury_score}
            away={i.away_injury_score}
            invert
            why={injuryWhy(m)}
          />
          <ScorecardRow
            label="Travel load"
            home={i.home_travel_distance_km}
            away={i.away_travel_distance_km}
            format={(v) => km(v)}
            invert
            max={2000}
          />
          <ScorecardRow label="XI strength" home={i.home_xi_strength} away={i.away_xi_strength} />
        </Section>
      )}

      {/* ── 5 · Market signals ─────────────────────────── */}
      {m.signals && m.signals.length > 0 && (
        <Section index="04" title="Market signals" action={<span className="mono text-[0.6rem] text-faint">{m.signals.length} active</span>}>
          <div>
            {m.signals.map((s, idx) => (
              <SignalRow key={s.id ?? idx} signal={s} />
            ))}
          </div>
        </Section>
      )}

      {/* ── 6 · Availability + lineups ─────────────────── */}
      {(homeLineup.length > 0 || awayLineup.length > 0) && (
        <Section index="05" title="Availability center">
          <div className="mb-4">
            <p className="label-cap mb-2">Fitness watch</p>
            <AvailabilityList players={lineups} />
          </div>
          <div className="grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
            {homeLineup.length > 0 && <TeamLineup team={m.home} players={homeLineup} />}
            {awayLineup.length > 0 && <TeamLineup team={m.away} players={awayLineup} />}
          </div>
        </Section>
      )}

      {/* ── 7 · Risk factors ───────────────────────────── */}
      {m.risk && m.risk.risk_factors.length > 0 && (
        <Section
          index="06"
          title="Risk engine"
          action={<RiskBadge band={m.risk.risk_band} />}
        >
          <ul className="space-y-2">
            {m.risk.risk_factors.map((f) => (
              <li key={f.key} className="flex items-start gap-3">
                <span className="mono mt-0.5 w-7 shrink-0 text-right text-[0.7rem] font-semibold text-risk tnum">
                  +{f.points}
                </span>
                <span className="text-[0.8rem] leading-snug text-muted">{f.label}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── 8 · Opportunity drivers ────────────────────── */}
      {m.opportunity && Object.keys(m.opportunity.score_components).length > 0 && (
        <Section index="07" title="Where the edge comes from">
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
        </Section>
      )}

      {/* ── AI analyst close ───────────────────────────── */}
      {m.opportunity?.executive_brief && (
        <section className="panel border-l-2 border-l-amber p-5">
          <p className="eyebrow mb-1">AI analyst</p>
          <p className="text-[0.85rem] leading-relaxed text-text">
            {analystNarrative(m)}
          </p>
          <p className="mono mt-3 text-[0.6rem] text-faint">
            Synthesised from precomputed warehouse intelligence · read-only ·
            not betting advice.
          </p>
        </section>
      )}
    </div>
  );
}

// ── sub-components ───────────────────────────────────────
function TeamHead({ team, align }: { team: MatchRow["home"]; align: "left" | "right" }) {
  return (
    <Link
      href={`/teams/${team.id}`}
      className={`flex items-center gap-2 rounded-term p-1 transition-colors hover:bg-raised ${align === "right" ? "flex-row-reverse text-right" : ""}`}
    >
      <Crest team={team} size={40} />
      <div className={align === "right" ? "text-right" : ""}>
        <div className="text-sm font-semibold leading-tight tracking-tight">{team.name}</div>
        {team.country && (
          <div className="mono text-[0.55rem] text-faint">{team.country}</div>
        )}
      </div>
    </Link>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="label-cap">{label}</div>
      <div className="mono text-[0.7rem] text-text">{value}</div>
    </div>
  );
}

function ProbRow({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-24 truncate text-[0.75rem]">{label}</span>
      <BarMeter value={v} color={color} height={8} />
      <span className="mono w-9 text-right text-sm font-semibold tnum" style={{ color }}>
        {Math.round(v)}%
      </span>
    </div>
  );
}

// ── narrative helpers (translate intel to plain language) ─
function invFatigue(m: MatchRow, home: boolean): number {
  // derive a fatigue proxy from rest days + travel when no explicit field
  const i = m.intel!;
  const rest = home ? i.home_rest_days : i.away_rest_days;
  const travel = home ? i.home_travel_distance_km : i.away_travel_distance_km;
  const restPenalty = rest != null ? Math.max(0, (5 - rest) * 12) : 0;
  const travelPenalty = travel != null ? Math.min(40, travel / 40) : 0;
  return Math.min(100, restPenalty + travelPenalty);
}

function readinessWhy(h: number | null | undefined, a: number | null | undefined, m: MatchRow) {
  if (h == null || a == null) return undefined;
  const gap = Math.round(h - a);
  if (Math.abs(gap) < 5) return "Readiness is near-level between the sides.";
  const side = gap > 0 ? m.home.short_name || m.home.name : m.away.short_name || m.away.name;
  const t = readinessTier(Math.max(h, a));
  return `${side} arrive the better-prepared side (${Math.abs(gap)} pts, ${t.label.toLowerCase()}).`;
}

function fatigueWhy(m: MatchRow) {
  const i = m.intel!;
  const hr = i.home_rest_days, ar = i.away_rest_days;
  if (hr == null || ar == null) return undefined;
  if (Math.abs(hr - ar) < 1) return undefined;
  const tired = hr < ar ? m.home.short_name || m.home.name : m.away.short_name || m.away.name;
  const t = fatigueTier(Math.max(invFatigue(m, true), invFatigue(m, false)));
  return `${tired} carry the heavier legs — ${t.label.toLowerCase()} load on short rest.`;
}

function injuryWhy(m: MatchRow) {
  const i = m.intel!;
  if (i.home_injury_score == null || i.away_injury_score == null) return undefined;
  const diff = Math.abs(i.home_injury_score - i.away_injury_score);
  if (diff < 10) return undefined;
  const worse = i.home_injury_score > i.away_injury_score ? m.away : m.home;
  return `${worse.short_name || worse.name} have the cleaner treatment room.`;
}

function analystNarrative(m: MatchRow): string {
  const parts: string[] = [];
  const i = m.intel;
  const sig = m.opportunity?.signals?.[0]?.text;
  const warn = m.opportunity?.warnings?.[0]?.text;
  const lean = bestLean(m);
  if (sig) parts.push(sig + ".");
  if (i) {
    const h = Math.round(normProb(i.win_probability_home));
    parts.push(
      `The model puts the home win at ${h}% with ${n1((i.predicted_home_goals ?? 0) + (i.predicted_away_goals ?? 0))} total goals projected.`
    );
  }
  if (warn) parts.push(`The main caveat: ${warn.charAt(0).toLowerCase()}${warn.slice(1)}.`);
  if (lean && lean.pick !== "No clear market edge")
    parts.push(`Cleanest expression of the read is ${lean.pick}.`);
  return parts.join(" ");
}
