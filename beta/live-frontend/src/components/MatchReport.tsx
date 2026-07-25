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
  tally,
  overallVerdict,
  derivePickSide,
  MODULES,
  type ModuleReading,
  type Baseline,
} from "@/lib/modules";
import type { MatchRow, PredictedLineupPlayer } from "@/lib/types";
import { getFormationName, unitConfidence } from "@/lib/formation";
import { IconUnverified, IconSupports, IconContradicts, IconNeutral } from "./icons/ModuleIcons";

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
          <tr key={`${label}-${idx}`} className="border-b border-line/60 last:border-0">
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

export function MatchReport({
  match: m,
  readings,
  homeLineup,
  awayLineup,
}: {
  match: MatchRow;
  readings: ModuleReading[];
  homeLineup: PredictedLineupPlayer[];
  awayLineup: PredictedLineupPlayer[];
}) {
  const i = m.intel;
  const homeName = m.home.short_name || m.home.name;
  const awayName = m.away.short_name || m.away.name;
  const pickSide = derivePickSide(m);
  const pickName = pickSide === "home" ? homeName : pickSide === "away" ? awayName : null;

  const t = tally(readings);
  const overall = overallVerdict(t);
  const supports = readings.filter((r) => r.status === "supports");
  const contradicts = readings.filter((r) => r.status === "contradicts");
  const neutral = readings.filter((r) => r.status === "neutral");
  const dormant = readings.filter((r) => r.status === "inactive");
  const teamModules = readings.filter((r) => r.def.scope === "team");

  const finished = m.status === "finished" || (m.home_score != null && m.away_score != null);
  const kickoff = new Date(m.date);
  const dateLine = kickoff.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // ── Snapshot rows — only what this fixture actually carries ─────────────
  const snapshot: [string, React.ReactNode, React.ReactNode?][] = [];
  if (finished && m.home_score != null && m.away_score != null) {
    snapshot.push(["Observed score", m.home_score, m.away_score]);
  } else {
    snapshot.push([
      "Kick-off",
      kickoff.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      "",
    ]);
  }
  if (i?.predicted_home_goals != null && i?.predicted_away_goals != null)
    snapshot.push([
      "Expected goals (model estimate)",
      i.predicted_home_goals.toFixed(1),
      i.predicted_away_goals.toFixed(1),
    ]);
  if (i?.win_probability_home != null && i?.win_probability_away != null)
    snapshot.push([
      "Win probability",
      pct(i.win_probability_home, 0),
      pct(i.win_probability_away, 0),
    ]);
  if (m.home_form || m.away_form)
    snapshot.push(["Form (last 5)", m.home_form ?? "—", m.away_form ?? "—"]);
  const awayTrip = num(m.travel?.away_trip_km) ?? i?.away_travel_distance_km ?? null;
  if (awayTrip != null) snapshot.push(["Travel distance", km(0), km(awayTrip)]);
  if (i?.home_rest_days != null && i?.away_rest_days != null)
    snapshot.push([
      "Rest days",
      `${i.home_rest_days} days`,
      `${i.away_rest_days} days`,
    ]);

  const confidenceReading = readings.find((r) => r.def.n === 10) ?? null;
  const bandRate = confidenceReading?.baseline?.rate ?? null;

  // ── Key patterns — one row per firing module, straight from its reading ──
  const keyPatterns: [string, React.ReactNode][] = readings
    .filter((r) => r.status !== "inactive")
    .map((r) => [
      r.def.name,
      <>
        {r.headline}
        {r.baseline && (
          <span className="text-muted"> · {fmtBaseline(r.baseline)}</span>
        )}
      </>,
    ]);

  // ── BTTS block — only when scoring probabilities are present ────────────
  const sp = m.scoring;
  const bttsRows: [string, React.ReactNode][] = [];
  if (sp) {
    const push = (label: string, v: unknown, sample?: unknown) => {
      const n = num(v);
      if (n == null) return;
      const s = num(sample);
      bttsRows.push([label, `${n.toFixed(0)}%${s != null ? ` (n=${s})` : ""}`]);
    };
    push(`${homeName} scores at home`, sp.home_scores_pct, sp.home_sample);
    push(`${awayName} concedes away`, sp.away_concedes_pct, sp.away_concede_sample);
    push(`${awayName} scores away`, sp.away_scores_pct, sp.away_sample);
    push(`${homeName} concedes at home`, sp.home_concedes_pct, sp.home_concede_sample);
    push(`${homeName} to score (combined)`, sp.home_to_score_pct);
    push(`${awayName} to score (combined)`, sp.away_to_score_pct);
    push("Both teams to score", sp.btts_pct);
    push("Historical BTTS", sp.historical_btts_pct);
    push("League BTTS", sp.league_btts_pct);
  }

  // ── Takeaways — chosen by distance from an even split, not written out ──
  const spread = (r: ModuleReading) =>
    r.baseline ? Math.abs(r.baseline.rate - 50) : -1;
  const strongest = supports.length
    ? supports.reduce((a, b) => (spread(b) > spread(a) ? b : a))
    : null;
  const weakest = contradicts.length
    ? contradicts.reduce((a, b) =>
        (b.baseline?.rate ?? 100) < (a.baseline?.rate ?? 100) ? b : a
      )
    : null;

  const takeaways: [string, React.ReactNode][] = [];
  if (strongest)
    takeaways.push([
      "Strongest supporting pattern",
      `${strongest.def.name} — ${strongest.headline}${
        strongest.baseline ? ` · ${fmtBaseline(strongest.baseline)}` : ""
      }`,
    ]);
  if (weakest)
    takeaways.push([
      "Strongest contradicting pattern",
      `${weakest.def.name} — ${weakest.headline}${
        weakest.baseline ? ` · ${fmtBaseline(weakest.baseline)}` : ""
      }`,
    ]);
  takeaways.push([
    "Module consensus",
    `${overall.label} — ${t.supports} support, ${t.neutral} neutral, ${t.contradicts} contradict`,
  ]);
  if (bandRate != null)
    takeaways.push([
      "Historical upset rate in this band",
      `${(100 - bandRate).toFixed(1)}% of the time the favoured side did not win`,
    ]);
  takeaways.push([
    "Data quality",
    `${readings.length - dormant.length} of ${MODULES.length} modules firing`,
  ]);
  const widest = readings.filter((r) => isWide(r.baseline));
  if (widest.length)
    takeaways.push([
      "Treat as informational",
      `${widest.map((r) => r.def.name).join(", ")} — interval too wide to lean on`,
    ]);

  return (
    <section
      id={MATCH_REPORT_ANCHOR}
      className="panel scroll-mt-20 p-5"
      aria-label="Match report"
    >
      {/* Header */}
      <header className="border-b border-line pb-3">
        <h2 className="mono text-[0.9rem] font-semibold tracking-tight text-text">
          Match report: {homeName} vs {awayName}
        </h2>
        <p className="mono mt-1 text-[0.66rem] text-muted">
          {m.competition ?? m.tournament?.name ?? "—"} · {dateLine}
          {m.venue ? ` · ${m.venue}` : ""}
        </p>
        <p className="mt-1.5 text-[0.66rem] leading-relaxed" style={{ color: "var(--warn)" }}>
          Historical pattern report — not a prediction. Betting involves risk of loss.
        </p>
      </header>

      <Section title="Historical pattern snapshot">
        <KeyValueTable rows={snapshot} headers={["", homeName, awayName]} />
        {pickName && (
          <p className="mt-2 text-[0.7rem] text-muted">
            Pattern observed toward <span className="mono text-text">{pickName}</span>
            {i?.confidence_score != null && (
              <>
                {" "}· historical confidence {Math.round(i.confidence_score)}%
                {i.confidence_band ? ` (${i.confidence_band} band)` : ""}
              </>
            )}
          </p>
        )}
      </Section>

      <Section title="What the historical data shows">
        {supports.length === 0 && contradicts.length === 0 ? (
          <p className="text-[0.72rem] text-faint">
            No module produced a directional reading for this fixture.
          </p>
        ) : (
          <div className="space-y-3">
            {[...supports, ...contradicts].map((r) => (
              <div key={r.def.key} className="border-l-2 pl-3" style={{
                borderColor: r.status === "supports" ? "var(--edge)" : "var(--risk)",
              }}>
                <div className="mono flex items-center gap-1.5 text-[0.72rem] font-semibold text-text">
                  <StatusGlyph status={r.status} />
                  {r.def.name} (Module {r.def.n}) —{" "}
                  {r.status === "supports" ? "supports" : "contradicts"}
                  {pickName ? ` ${pickName}` : " the pick"}
                </div>
                <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  {r.rows.map((row) => (
                    <div key={row.label} className="flex justify-between gap-2 text-[0.68rem]">
                      <dt className="text-muted">{row.label}</dt>
                      <dd className="mono text-text">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                {r.baseline && (
                  <p className="mt-1 text-[0.68rem] text-muted">
                    Historical rate: {fmtBaseline(r.baseline)}
                    {r.baseline.provenance === "unreplayed" && (
                      <span style={{ color: "var(--warn)" }}> · unreplayed</span>
                    )}
                  </p>
                )}
                <p className="mt-0.5 text-[0.68rem] text-faint">
                  Interpretation: {r.verdict}
                </p>
              </div>
            ))}
          </div>
        )}
        {neutral.length > 0 && (
          <p className="mt-3 text-[0.68rem] leading-relaxed text-faint">
            Neutral ({neutral.length}):{" "}
            {neutral.map((r) => `${r.def.name} (M${r.def.n})`).join(", ")} — no clear edge
            detected.
          </p>
        )}
      </Section>

      <Section title="Module summary">
        <KeyValueTable
          headers={["Module", "Finding", "Historical context"]}
          rows={readings
            .filter((r) => r.status !== "inactive")
            .map((r) => [
              r.def.name,
              <span key="f" className="inline-flex items-center gap-1.5">
                <StatusGlyph status={r.status} />
                {r.status === "supports"
                  ? `Supports${pickName ? ` ${pickName}` : ""}`
                  : r.status === "contradicts"
                    ? `Contradicts${pickName ? ` ${pickName}` : ""}`
                    : "Neutral"}
                {r.def.scope === "team" && (
                  <span className="text-faint"> · context</span>
                )}
              </span>,
              r.baseline ? fmtBaseline(r.baseline) : r.headline,
            ])}
        />
        <p className="mt-2 text-[0.7rem] text-muted">
          Consensus:{" "}
          <span className="mono font-semibold" style={{ color: overall.color }}>
            {overall.label}
          </span>{" "}
          — {t.supports} support, {t.neutral} neutral, {t.contradicts} contradict.
        </p>
      </Section>

      <Section title="Key historical patterns">
        <KeyValueTable headers={["Factor", "Observed pattern"]} rows={keyPatterns} />
      </Section>

      {bttsRows.length > 0 && (
        <Section title="Both teams to score">
          <KeyValueTable headers={["Factor", "Rate"]} rows={bttsRows} />
        </Section>
      )}

      {(homeLineup.length > 0 || awayLineup.length > 0) && (
        <Section title="Predicted lineups">
          <KeyValueTable
            headers={["Team", "Shape and unit confidence"]}
            rows={[
              ...(homeLineup.length
                ? ([[homeName, unitLine(homeLineup)]] as [string, React.ReactNode][])
                : []),
              ...(awayLineup.length
                ? ([[awayName, unitLine(awayLineup)]] as [string, React.ReactNode][])
                : []),
            ]}
          />
        </Section>
      )}

      <Section title="Important note">
        <p className="text-[0.68rem] leading-relaxed text-muted">
          PitchTerminal reports historical frequencies. It does not predict results, does not
          price markets, and does not tell you what to stake. A published rate means only that
          this pattern held at that frequency in the matches we counted, within the interval
          shown. Rules that fall below our sample gate are marked, not hidden. Betting involves
          risk of loss.
        </p>
      </Section>

      <Section title="Data notes">
        <KeyValueTable
          headers={["Module", "Status"]}
          rows={[
            ...dormant.map(
              (r) => [r.def.name, r.headline] as [string, React.ReactNode]
            ),
            ...(teamModules.length
              ? ([
                  [
                    `Team modules (${teamModules.map((r) => `M${r.def.n}`).join(", ")})`,
                    "Counted toward consensus, reported as context",
                  ],
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />
      </Section>

      <Section title="Key takeaways">
        <KeyValueTable headers={["Takeaway", "Detail"]} rows={takeaways} />
      </Section>

      <p className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-[0.64rem] text-faint">
        <span className="mt-px" style={{ color: "var(--warn)" }}>
          <IconUnverified size={12} />
        </span>
        Rates marked unreplayed come from an analysis that scored finished matches using
        current team form. The counts are real; the rates await the point-in-time replay.
      </p>
    </section>
  );
}

function unitLine(players: PredictedLineupPlayer[]): string {
  const u = unitConfidence(players);
  const bits = [
    u.defence != null ? `DEF ${u.defence}%` : null,
    u.midfield != null ? `MID ${u.midfield}%` : null,
    u.attack != null ? `ATT ${u.attack}%` : null,
  ].filter(Boolean);
  return `${getFormationName(players)}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
}
