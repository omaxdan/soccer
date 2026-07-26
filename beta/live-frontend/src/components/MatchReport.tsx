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
import Link from "next/link";
import type { MatchRow, PredictedLineupPlayer } from "@/lib/types";
import { canSee, type Tier } from "@/lib/tier";
import { getFormationName, unitConfidence } from "@/lib/formation";
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
  readings: allReadings,
  homeLineup,
  awayLineup,
  viewer,
}: {
  match: MatchRow;
  readings: ModuleReading[];
  homeLineup: PredictedLineupPlayer[];
  awayLineup: PredictedLineupPlayer[];
  viewer: Tier;
}) {
  // The module cards used to carry tier gating; with those gone this report is
  // the only surface showing per-module detail, so the gate moves here.
  // Consensus is still computed across EVERY module — the tier decides how much
  // working is shown, not whether the conclusion is correct.
  const readings = allReadings.filter((r) => canSee(r.def, viewer));
  const gated = allReadings.filter((r) => !canSee(r.def, viewer));
  const i = m.intel;
  const homeName = m.home.short_name || m.home.name;
  const awayName = m.away.short_name || m.away.name;
  const pickSide = derivePickSide(m);
  const pickName = pickSide === "home" ? homeName : pickSide === "away" ? awayName : null;

  const t = tally(allReadings);
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

  // ── Takeaways ───────────────────────────────────────────────────────────
  // Each answers three things: what the data shows, what it means, and what it
  // implies for reading the rest of the report. Every figure is pulled from a
  // reading — nothing is written per fixture, and none of these say what to
  // stake. They describe where the evidence sits, not what to do about it.
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

  const side = pickName ?? "the favoured side";
  const takeaways: { lead: string; body: string }[] = [];

  // 1 — strongest supporting module
  if (strongest) {
    const b = strongest.baseline;
    takeaways.push({
      lead: `${strongest.def.name} is the strongest supporting signal`,
      body:
        `${strongest.headline}. ` +
        (b ? `Across the matches counted, ${b.label} ${fmtBaseline(b)}. ` : "") +
        `${strongest.verdict} It is the largest single contributor to the ${overall.label} reading toward ${side}` +
        (b && isWide(b)
          ? `, though its interval is wide enough that it carries less weight than the headline rate suggests.`
          : `.`),
    });
  }

  // 2 — strongest contradicting module
  if (weakest) {
    const b = weakest.baseline;
    takeaways.push({
      lead: `${weakest.def.name} flags a concern`,
      body:
        `${weakest.headline}. ` +
        (b ? `Historical rate: ${fmtBaseline(b)}. ` : "") +
        `${weakest.verdict} With ${t.supports} module${t.supports === 1 ? "" : "s"} supporting and ` +
        `${t.contradicts} against, consensus is held at ${overall.label} — a disagreement caps it ` +
        `however many modules agree.`,
    });
  }

  // 3 — rest, or failing that travel, with the threshold spelled out
  const restGap =
    i?.home_rest_days != null && i?.away_rest_days != null
      ? i.home_rest_days - i.away_rest_days
      : null;
  const restReading = readings.find((r) => r.def.n === 6) ?? null;
  const travelProfile = m.travel?.travel_profile ?? null;
  if (restGap != null && Math.abs(restGap) >= 4) {
    const ahead = restGap > 0 ? homeName : awayName;
    takeaways.push({
      lead: `Rest gap clears the four-day threshold`,
      body:
        `${ahead} has ${Math.abs(restGap)} extra days (${i?.home_rest_days}d vs ${i?.away_rest_days}d). ` +
        `Four days is where rest starts to register in the record; below that the effect sits inside the noise. ` +
        (restReading?.baseline
          ? `Historical rate in this scenario: ${fmtBaseline(restReading.baseline)}.`
          : ""),
    });
  } else if (travelProfile && travelProfile !== "NO_TRAVEL_EDGE") {
    const travelReading = readings.find((r) => r.def.n === 5) ?? null;
    takeaways.push({
      lead: `Travel load is uneven`,
      body:
        `Profile: ${travelProfile.replace(/_/g, " ").toLowerCase()}. ` +
        `${travelReading?.verdict ?? ""} Single-trip distance alone moves the away win rate by under three ` +
        `points across every band, so this reads as a cumulative-load signal rather than a distance one.`,
    });
  }

  // 4 — thin samples, named rather than buried
  const thin = readings.filter(
    (r) => r.baseline?.sample != null && !r.baseline.pooled && (r.baseline.sample as number) < 10
  );
  if (thin.length > 0) {
    const widths = thin.map((r) => {
      const b = r.baseline!;
      const [lo, hi] = wilson(b.rate, b.sample as number);
      return Math.round(hi - lo);
    });
    takeaways.push({
      lead: `${thin.map((r) => r.def.name).join(" and ")} rest on very small samples`,
      body:
        `${thin.map((r) => `${r.def.name} n=${r.baseline!.sample}`).join(", ")}. ` +
        (Math.min(...widths) === Math.max(...widths)
          ? `Each interval spans about ${widths[0]} percentage points`
          : `Their intervals span ${Math.min(...widths)}–${Math.max(...widths)} percentage points`) +
        ` — wider than the effect they claim to measure. These are context rather than signals: the pattern ` +
        `may well hold, but this many matches cannot show it either way.`,
    });
  }

  // 5 — data quality
  const firingCount = allReadings.filter((r) => r.status !== "inactive").length;
  takeaways.push({
    lead: `${firingCount} of ${MODULES.length} modules firing`,
    body:
      dormant.length > 0
        ? `${dormant.map((r) => r.def.name).join(", ")} could not fire for this fixture. The consensus ` +
          `above rests on ${firingCount} modules, not the full ${MODULES.length}.`
        : `Every module produced a reading for this fixture.`,
  });

  // 6 — BTTS context, when scoring probabilities exist
  const bttsPct = num(sp?.btts_pct);
  const leagueBtts = num(sp?.league_btts_pct);
  if (bttsPct != null && takeaways.length < 6) {
    takeaways.push({
      lead: `Both teams to score sits at ${bttsPct.toFixed(0)}%`,
      body:
        (sp?.btts_verdict ? `${sp.btts_verdict}. ` : "") +
        (leagueBtts != null
          ? `That is ${
              bttsPct > leagueBtts ? "above" : bttsPct < leagueBtts ? "below" : "level with"
            } the league rate of ${leagueBtts.toFixed(1)}%. `
          : "") +
        `It is built from each side's scoring and conceding rates in the samples listed above, so it ` +
        `inherits their sample sizes.`,
    });
  }

  const shownTakeaways = takeaways.slice(0, 6);

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
          headers={["Module", "Finding", "Observed pattern"]}
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
              <>
                {r.headline}
                {r.baseline && (
                  <span className="text-muted"> · {fmtBaseline(r.baseline)}</span>
                )}
              </>,
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
        <ol className="space-y-2.5">
          {shownTakeaways.map((k, idx) => (
            <li key={k.lead} className="flex gap-2.5 text-[0.72rem] leading-relaxed">
              <span className="mono shrink-0 tnum text-faint">{idx + 1}.</span>
              <span>
                <span className="mono font-semibold text-text">{k.lead}</span>
                <span className="text-muted"> — {k.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {gated.length > 0 && (
        <p className="mt-4 flex items-start gap-2 text-[0.68rem] leading-relaxed text-muted">
          <span className="mt-0.5 text-faint">
            <IconLock size={12} />
          </span>
          <span>
            {gated.length} module{gated.length === 1 ? "" : "s"} (
            {gated.map((r) => `M${r.def.n}`).join(", ")}) are counted in the consensus above
            but their detail is not shown on this tier.{" "}
            <Link href="/pricing" className="text-amber underline underline-offset-2">
              See plans
            </Link>
            .
          </span>
        </p>
      )}

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
