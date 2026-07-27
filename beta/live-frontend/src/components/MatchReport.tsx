// ─────────────────────────────────────────────────────────────────────────────
// MatchReport — print-friendly summary rendered below the module cards.
//
// Everything here is derived from the ModuleReading[] the page already built
// plus the MatchRow it already fetched. No new queries, no per-match prose,
// no fixed numbers: if a module's verdict or baseline changes, every table in
// this report follows it. The only fixed text is the section headings and the
// legal note, which is fixed on purpose.
//
// Server component — the "view full report" control is a plain anchor, so no
// client JavaScript is involved in getting here.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import {
  wilson,
  buildMarketProfiles,
  tally,
  overallVerdict,
  derivePickSide,
  MODULES,
  type ModuleReading,
  type Baseline,
} from "@/lib/modules";
import Link from "next/link";
import type { MatchRow } from "@/lib/types";
import { canSee, type Tier } from "@/lib/tier";
import { LockedModuleCard, UpgradePrompt, ProTeaser, LockedRow } from "./FeatureGate";
import { IconUnverified, IconSupports, IconContradicts, IconNeutral, IconLock } from "./icons/ModuleIcons";

// ── Formatting helpers ───────────────────────────────────

const pct = (v: number | null | undefined, dp = 1) =>
  v == null ? "—" : `${v.toFixed(dp)}%`;
const km = (v: number | null | undefined) =>
  v == null ? "—" : `${Math.round(v).toLocaleString()} km`;
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

/** A baseline rendered as one sentence-safe string, sample and interval intact. */
function fmtBaseline(b: Baseline | null): string {
  if (!b) return "—";
  if (b.sample == null) return `${b.rate.toFixed(1)}% (sample not carried)`;
  if (b.pooled) return `${b.rate.toFixed(1)}% (n=${b.sample.toLocaleString()} pooled)`;
  const [lo, hi] = wilson(b.rate, b.sample);
  return `${b.rate.toFixed(1)}% (n=${b.sample.toLocaleString()}, 95% CI ${lo.toFixed(1)}–${hi.toFixed(1)})`;
}

/** True when the interval is wide enough that the rate should not be leaned on. */
function isWide(b: Baseline | null): boolean {
  if (!b || b.sample == null || b.pooled) return false;
  const [lo, hi] = wilson(b.rate, b.sample);
  return hi - lo > 12;
}

// ── Table primitives, tuned for print ────────────────────

function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="mt-5 first:mt-0">
      <h3 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">
        {title}
      </h3>
      {children}
    </section>
  );
}

function KeyValueTable({
  rows,
  headers,
}: {
  rows: [string, React.ReactNode, React.ReactNode?][];
  headers?: [string, string, string?];
}) {
  const wide = rows.some((r) => r.length > 2 && r[2] !== undefined);
  return (
    <table className="w-full border-collapse text-[0.72rem]">
      {headers && (
        <thead>
          <tr className="border-b border-line">
            {headers.filter(Boolean).map((h) => (
              <th
                key={h}
                className="label-cap py-1.5 pr-3 text-left font-normal"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map(([label, a, b], idx) => (
          <tr key={`${label}-${idx}`} className="border-b border-line last:border-0">
            <td className="py-1.5 pr-3 align-top text-muted">{label}</td>
            <td className="mono py-1.5 pr-3 align-top text-text">{a}</td>
            {wide && <td className="mono py-1.5 align-top text-text">{b ?? ""}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusGlyph({ status }: { status: ModuleReading["status"] }) {
  if (status === "supports")
    return (
      <span style={{ color: "var(--edge)" }}>
        <IconSupports size={11} />
      </span>
    );
  if (status === "contradicts")
    return (
      <span style={{ color: "var(--risk)" }}>
        <IconContradicts size={11} />
      </span>
    );
  return (
    <span style={{ color: "var(--warn)" }}>
      <IconNeutral size={11} />
    </span>
  );
}

// ── Report ───────────────────────────────────────────────

export const MATCH_REPORT_ANCHOR = "match-report";

// ─────────────────────────────────────────────────────────────────────────────
// The report speaks football, not architecture.
//
// Module NAMES appear — "Rest Advantage" is a finding a reader can act on.
// Module NUMBERS do not. Nobody needs to know that M8 fired; they need to know
// the away side holds a form advantage. The modules stay the engine and stop
// being the subject.
//
// Everything below is derived from the readings the page already computed. No
// score is recalculated, and no sentence instructs anyone to stake anything.
// ─────────────────────────────────────────────────────────────────────────────

export function MatchReport({
  match: m,
  readings: allReadings,
  viewer,
}: {
  match: MatchRow;
  readings: ModuleReading[];
  viewer: Tier;
}) {
  const readings = allReadings.filter((r) => canSee(r.def, viewer));
  const gated = allReadings.filter((r) => !canSee(r.def, viewer));

  const i = m.intel;
  const sp = m.scoring;
  const homeName = m.home.short_name || m.home.name;
  const awayName = m.away.short_name || m.away.name;
  const pickSide = derivePickSide(m);
  const pickName = pickSide === "home" ? homeName : pickSide === "away" ? awayName : null;

  const t = tally(allReadings);
  const overall = overallVerdict(t);
  const supports = readings.filter((r) => r.status === "supports");
  const contradicts = readings.filter((r) => r.status === "contradicts");
  const neutral = readings.filter((r) => r.status === "neutral");
  const dormant = allReadings.filter((r) => r.status === "inactive");
  const firing = allReadings.filter((r) => r.status !== "inactive").length;

  const kickoffAt = new Date(m.date);
  const dateLine = kickoffAt.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const confidenceReading = readings.find((r) => r.def.n === 10) ?? null;
  const bandBaseline = confidenceReading?.baseline ?? null;

  // ── Instant verdict ───────────────────────────────────────────────────────
  interface VerdictRow {
    metric: string;
    home: string;
    away: string;
    edge: string;
    edgeColor: string;
    /** Shown on hover and marked with a dotted underline. */
    hint?: string;
  }
  const verdictRows: VerdictRow[] = [];
  const addRow = (
    metric: string,
    h: number | null,
    a: number | null,
    fmt: (v: number) => string,
    higherIsBetter = true,
    hint?: string
  ) => {
    if (h == null || a == null) return;
    const level = Math.abs(h - a) < 0.05;
    const homeAhead = higherIsBetter ? h > a : h < a;
    verdictRows.push({
      metric,
      home: fmt(h),
      away: fmt(a),
      // "Edge" names which side holds the stronger historical profile on that
      // metric. It is not an instruction.
      edge: level ? "Level" : homeAhead ? homeName : awayName,
      edgeColor: level ? "var(--muted)" : "var(--edge)",
      hint,
    });
  };
  // Ordered match expectation -> current condition -> quality of that form ->
  // recovery. Opponent-adjusted form sits ABOVE raw form deliberately: it is
  // the one that survives contact with a weak schedule, so a reader who stops
  // reading partway down has seen the more honest of the two.
  addRow("Expected goals", num(i?.predicted_home_goals), num(i?.predicted_away_goals), (v) => v.toFixed(1));
  addRow("Win probability", num(i?.win_probability_home), num(i?.win_probability_away), (v) => `${Math.round(v)}%`);
  addRow("Readiness", num(i?.home_readiness), num(i?.away_readiness), (v) => `${Math.round(v)}`);
  addRow(
    "Opponent-adjusted form",
    num(m.homeFormQuality?.opponent_adjusted_form),
    num(m.awayFormQuality?.opponent_adjusted_form),
    (v) => `${Math.round(v)}`,
    true,
    "Recent performance after accounting for the strength of opponents faced. A run of wins over weak sides scores lower here than the same run against strong ones."
  );
  addRow(
    "Form rating",
    num(m.homeIntel?.form_index),
    num(m.awayIntel?.form_index),
    (v) => v.toFixed(1),
    true,
    "Recent results on their own, with no adjustment for who they came against."
  );
  addRow("Rest days", num(i?.home_rest_days), num(i?.away_rest_days), (v) => `${v}`);
  // Optional, and only when the column already holds a value: a harder
  // schedule is credit, since it means the form above was earned against
  // better opposition rather than inflated by a soft run.
  addRow(
    "Schedule strength",
    num(m.homeFormQuality?.strength_of_schedule),
    num(m.awayFormQuality?.strength_of_schedule),
    (v) => `${Math.round(v)}`,
    true,
    "Average strength of opponents faced in the measured window. The higher figure indicates the tougher run, so its side's form was earned against better sides."
  );
  {
    const hc = num(sp?.home_concedes_pct);
    const ac = num(sp?.away_concedes_pct);
    if (hc != null && ac != null) addRow("Clean sheet rate", 100 - hc, 100 - ac, (v) => `${Math.round(v)}%`);
  }

  // ── Executive summary — the story, not the metric list ────────────────────
  const execSummary = (() => {
    if (!pickName)
      return "No readiness gap separates these sides, so the evidence produces no directional lean for this fixture.";

    const advantages = verdictRows.filter((r) => r.edge === pickName).map((r) => r.metric.toLowerCase());
    const side = pickSide === "home" ? "home" : "away";

    const parts = [`Historical evidence currently favours ${pickName}.`];
    if (advantages.length > 0)
      parts.push(
        `The ${side} side enters with advantages in ${
          advantages.length > 2
            ? `${advantages.slice(0, -1).join(", ")} and ${advantages[advantages.length - 1]}`
            : advantages.join(" and ")
        }.`
      );
    parts.push(
      supports.length > 0
        ? `${supports.length} independent evidence stream${supports.length === 1 ? "" : "s"} support${supports.length === 1 ? "s" : ""} that profile${
            contradicts.length ? `, while ${contradicts.length} run${contradicts.length === 1 ? "s" : ""} counter to it` : ""
          }.`
        : "No evidence stream currently supports that lean."
    );
    if (i?.confidence_band)
      parts.push(
        `Confidence remains capped by the ${i.confidence_band} calibration band${
          bandBaseline ? `, measured at ${bandBaseline.rate.toFixed(1)}% across ${bandBaseline.sample?.toLocaleString()} pre-kickoff matches` : ""
        }.`
      );
    return parts.slice(0, 4).join(" ");
  })();

  // ── Why confidence is limited ─────────────────────────────────────────────
  const limits: string[] = [];
  if (i?.confidence_band && ["Risky", "Avoid"].includes(i.confidence_band))
    limits.push(
      `Confidence calibration falls within the ${i.confidence_band} band${
        bandBaseline ? `, which has held at ${bandBaseline.rate.toFixed(1)}% historically` : ""
      }.`
    );
  for (const r of readings) {
    const b = r.baseline;
    if (b?.sample != null && !b.pooled && b.sample < 10)
      limits.push(`${r.def.name} rests on only ${b.sample} matches.`);
  }
  if (contradicts.length > 0)
    limits.push(
      `${contradicts.map((r) => r.def.name).join(" and ")} contradict${contradicts.length === 1 ? "s" : ""} the lean.`
    );
  if (dormant.length > 0)
    limits.push(`Only ${firing} of ${MODULES.length} evidence streams contributed to this fixture.`);
  if (gated.length > 0)
    limits.push(`${gated.length} stream${gated.length === 1 ? "" : "s"} are not available on this tier.`);

  // ── Evidence scorecard ────────────────────────────────────────────────────
  const strengthOf = (r: ModuleReading): string => {
    const b = r.baseline;
    if (b?.sample != null && !b.pooled && b.sample < 10) return "Small sample";
    if (r.status === "contradicts") return i?.confidence_band ?? "Against";
    if (b?.sample != null && b.sample >= 200) return "Strong";
    return "Moderate";
  };
  const scorecard = [...supports, ...contradicts].map((r) =>
    r.locked
      ? {
          evidence: r.def.name,
          direction: "PRO SIGNAL",
          directionColor: "var(--amber)",
          strength: "—",
          detail: "Direction, strength, historical rate and sample on Pro",
          locked: true,
        }
      : {
          evidence: r.def.name,
          direction: r.status === "contradicts" ? "Against" : pickName ?? "Lean",
          directionColor: r.status === "contradicts" ? "var(--risk)" : "var(--edge)",
          strength: strengthOf(r),
          detail: r.headline,
          locked: false,
        }
  );

  const lockedReadings = readings.filter((r) => r.locked);
  // One flag drives every gated block below, so the page cannot show a
  // consensus in one section and withhold it in the next.
  const full = lockedReadings.length === 0;

  // ── Market profiles ───────────────────────────────────────────────────────
  const profileFor = (label: string, keys: number[]) => {
    const rel = readings.filter((r) => keys.includes(r.def.n) && r.status !== "inactive");
    if (rel.length === 0) return null;
    const sup = rel.filter((r) => r.status === "supports");
    const con = rel.filter((r) => r.status === "contradicts");
    const stars = con.length > sup.length ? 1 : Math.min(4, Math.max(1, sup.length + 1));
    return {
      label,
      stars,
      drivers: (sup.length ? sup : rel).map((r) => r.def.name),
      caveat: con.length ? `${con.map((r) => r.def.name).join(" and ")} limits certainty.` : null,
    };
  };
  const markets = [
    profileFor("Match winner", [1, 2, 8, 10, 6]),
    profileFor("Draw no bet", [3, 10]),
    profileFor("Goals", [7, 9, 13]),
    profileFor("Both teams to score", [9, 12, 7]),
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <section id={MATCH_REPORT_ANCHOR} className="panel scroll-mt-20 p-4" aria-label="Match report">
      <header className="border-b border-line pb-3">
        <h2 className="mono text-[0.9rem] font-semibold tracking-tight text-text">
          {homeName} vs {awayName}
        </h2>
        <p className="mono mt-1 text-[0.66rem] text-muted">
          {m.competition ?? m.tournament?.name ?? "—"} · {dateLine}
          {m.venue ? ` · ${m.venue}` : ""}
        </p>
      </header>

      {/* 2 — Instant verdict */}
      <Section title="Instant verdict">
        <table className="w-full border-collapse text-[0.72rem]">
          <thead>
            <tr className="border-b border-line">
              <th className="label-cap py-1.5 pr-3 text-left font-normal">Metric</th>
              <th className="label-cap py-1.5 pr-3 text-left font-normal">{homeName}</th>
              <th className="label-cap py-1.5 pr-3 text-left font-normal">{awayName}</th>
              <th className="label-cap py-1.5 text-left font-normal">Edge</th>
            </tr>
          </thead>
          <tbody>
            {verdictRows.map((r) => (
              <tr key={r.metric} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-3 text-muted">
                  {r.hint ? (
                    <span
                      title={r.hint}
                      className="cursor-help decoration-dotted underline-offset-2"
                      style={{ textDecorationLine: "underline" }}
                    >
                      {r.metric}
                    </span>
                  ) : (
                    r.metric
                  )}
                </td>
                <td className="mono py-1.5 pr-3 text-text">{r.home}</td>
                <td className="mono py-1.5 pr-3 text-text">{r.away}</td>
                <td className="mono py-1.5" style={{ color: r.edgeColor }}>{r.edge}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3 border-t border-line pt-3">
          <div>
            <div className="label-cap">Historical advantage</div>
            <div className="mono text-[0.85rem] font-semibold text-text">{pickName ?? "No edge"}</div>
          </div>
          {i?.confidence_band && (
            <div>
              <div className="label-cap">Calibration band</div>
              <div className="mono text-[0.85rem] font-semibold" style={{ color: overall.color }}>
                {i.confidence_band}
              </div>
            </div>
          )}
          {i?.confidence_score != null && (
            <div>
              <div className="label-cap">Historical confidence</div>
              <div className="mono tnum text-[0.85rem] text-text">{Math.round(i.confidence_score)}%</div>
            </div>
          )}
          {bandBaseline && (
            <div>
              <div className="label-cap">Observed hit rate</div>
              <div className="mono tnum text-[0.85rem] text-text">
                {bandBaseline.rate.toFixed(1)}%
                <span className="ml-1 text-[0.6rem] text-faint">
                  n={bandBaseline.sample?.toLocaleString()}
                </span>
              </div>
            </div>
          )}
          <div>
            <div className="label-cap">
              {full ? "Evidence streams" : "Signals analysed"}
            </div>
            <div className="mono tnum text-[0.85rem] text-text">
              {firing}
              {full && <span className="text-[0.65rem] text-faint">/{MODULES.length}</span>}
            </div>
          </div>
          {full ? (
            <div>
              <div className="label-cap">Consensus</div>
              <div className="mono text-[0.85rem] font-semibold" style={{ color: overall.color }}>
                {overall.label}
                <span className="ml-1.5 text-[0.6rem] font-normal text-faint">
                  {t.supports}S {t.neutral}N {t.contradicts}C
                </span>
              </div>
            </div>
          ) : (
            <div>
              <div className="label-cap">Consensus strength</div>
              <div className="mono text-[0.8rem] font-semibold" style={{ color: "var(--amber)" }}>
                Available on Pro
              </div>
            </div>
          )}
        </div>
      </Section>

      {!full && <ProTeaser lockedCount={lockedReadings.length} />}

      {/* 3 — Executive summary */}
      <Section title="Executive summary">
        <p className="max-w-3xl text-[0.82rem] leading-relaxed text-text">{execSummary}</p>
      </Section>

      {/* 4 — Why confidence is limited */}
      {!full && (
        <Section title="Confidence limitations">
          <p className="text-[0.76rem] leading-relaxed text-muted">
            Some evidence streams for this fixture show uncertainty — thin samples,
            contradicting signals, or a calibration band that has historically underperformed.
          </p>
          <ul className="mt-2 space-y-0.5">
            {[
              "Why confidence is limited on this fixture",
              "Which streams contradict the lean",
              "Historical reliability of this band, with its sample",
            ].map((x) => (
              <li key={x} className="text-[0.72rem] text-faint">
                {x}
              </li>
            ))}
          </ul>
          <p className="mono mt-2 text-[0.62rem] tracking-widest" style={{ color: "var(--amber)" }}>
            AVAILABLE ON PRO
          </p>
        </Section>
      )}

      {full && limits.length > 0 && (
        <Section title="Why confidence is limited">
          <ul className="space-y-1">
            {limits.map((l) => (
              <li key={l} className="flex gap-2 text-[0.74rem] leading-relaxed text-muted">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--warn)" }} />
                {l}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 5 — Evidence scorecard */}
      {!full && (
        <Section title="Evidence scorecard">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <div className="label-cap">Supporting signals</div>
              <div className="mono tnum text-xl font-semibold" style={{ color: "var(--edge)" }}>
                {supports.length}
              </div>
            </div>
            <div>
              <div className="label-cap">Conflicting signals</div>
              <div className="mono tnum text-xl font-semibold" style={{ color: "var(--risk)" }}>
                {contradicts.length}
              </div>
            </div>
          </div>
          <p className="mt-3 text-[0.72rem] leading-relaxed text-muted">
            Which streams support and which conflict, with their strength, historical rate and
            sample, is on Pro.
          </p>
        </Section>
      )}

      {full && scorecard.length > 0 && (
        <Section title="Evidence scorecard">
          <table className="w-full border-collapse text-[0.72rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Evidence</th>
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Direction</th>
                <th className="label-cap py-1.5 pr-3 text-left font-normal">Strength</th>
                <th className="label-cap hidden py-1.5 text-left font-normal sm:table-cell">Observed</th>
              </tr>
            </thead>
            <tbody>
              {scorecard.map((r) => (
                <tr key={r.evidence} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3 text-text">{r.evidence}</td>
                  <td className="mono py-1.5 pr-3" style={{ color: r.directionColor }}>{r.direction}</td>
                  <td className="mono py-1.5 pr-3 text-muted">{r.strength}</td>
                  <td className="mono hidden py-1.5 text-faint sm:table-cell">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {lockedReadings.length > 0 && (
        <Section title={`${lockedReadings.length} intelligence modules detected`}>
          {/* One value card, then a compact row each. Repeating the full
              upgrade pitch eight times produced scrolling fatigue and made the
              page read as an advert rather than a report. */}
          <LockedModuleCard defs={lockedReadings.map((r) => r.def)} />
          <ul className="mt-2.5 grid gap-1 sm:grid-cols-2">
            {lockedReadings.map((r) => (
              <LockedRow key={r.def.key} def={r.def} />
            ))}
          </ul>
        </Section>
      )}

      {/* 6 — Historical market profiles */}
      {!full && (
        <Section title="Historical market profiles">
          <p className="text-[0.76rem] leading-relaxed text-muted">
            Which market profiles this fixture&rsquo;s history aligns with, how strongly, and
            which evidence streams drive each one.
          </p>
          <p className="mono mt-2 text-[0.62rem] tracking-widest" style={{ color: "var(--amber)" }}>
            AVAILABLE ON PRO
          </p>
        </Section>
      )}

      {full && markets.length > 0 && (
        <Section title="Historical market profiles">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {markets.map((mk) => (
              <article key={mk.label} className="panel p-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="mono text-[0.76rem] font-semibold text-text">{mk.label}</h3>
                  <span className="mono text-[0.72rem]" style={{ color: "var(--amber)" }}>
                    {"\u2605".repeat(mk.stars)}
                    <span className="text-faint">{"\u2606".repeat(4 - mk.stars)}</span>
                  </span>
                </div>
                <p className="mt-1.5 text-[0.68rem] leading-relaxed text-muted">
                  Driven by {mk.drivers.join(", ")}.
                </p>
                {mk.caveat && (
                  <p className="mt-1 text-[0.66rem] leading-relaxed" style={{ color: "var(--warn)" }}>
                    {mk.caveat}
                  </p>
                )}
              </article>
            ))}
          </div>
          <p className="mt-2 text-[0.64rem] leading-relaxed text-faint">
            Where the historical evidence aligns. Whether a market is worth taking depends on
            both sides and the price, which this page does not assess.
          </p>
        </Section>
      )}

      {/* 7 — Neutral signals */}
      {neutral.length > 0 && (
        <Section title="Neutral signals">
          <table className="w-full border-collapse text-[0.72rem]">
            <tbody>
              {neutral.map((r) => (
                <tr key={r.def.key} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3 text-muted">{r.def.name}</td>
                  <td
                    className="mono py-1.5"
                    style={{ color: r.locked ? "var(--amber)" : "var(--faint)" }}
                  >
                    {r.locked ? "PRO SIGNAL" : r.headline}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </section>
  );
}

/**
 * The legal note, exported so the page can place it last.
 */
export function ImportantNote() {
  return (
    <section className="panel p-4">
      <h2 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">
        Important note
      </h2>
      <p className="text-[0.72rem] leading-relaxed text-muted">
        PitchTerminal reports historical frequencies. It does not predict results, does not
        price markets, and does not tell you what to stake. A published rate means only that
        this pattern held at that frequency in the matches we counted, within the interval
        shown. Rules that fall below our sample gate are marked, not hidden. Betting involves
        risk of loss.
      </p>
    </section>
  );
}
