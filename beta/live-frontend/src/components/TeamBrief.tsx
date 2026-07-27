// ─────────────────────────────────────────────────────────────────────────────
// TeamBrief — the top of /team/[slug].
//
// Every block here returns null when its input is empty. That is the whole
// design: a team with thin coverage renders a shorter page, not a page full of
// cards saying "No data". Nothing renders a placeholder.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import {
  toneColor,
  type Badge,
  type Insight,
  type Pillar,
  type MarketRow,
  type Risk,
  type IdentityRow,
} from "@/lib/teamBrief";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mono mb-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ── Executive summary ────────────────────────────────────

export function ExecutiveSummary({
  summary,
  badges,
}: {
  summary: string | null;
  badges: Badge[];
}) {
  if (!summary && badges.length === 0) return null;
  return (
    <section className="panel p-4">
      {summary && (
        <p className="max-w-3xl text-[0.88rem] leading-relaxed text-text">{summary}</p>
      )}
      {badges.length > 0 && (
        <ul className={`flex flex-wrap gap-1.5 ${summary ? "mt-4 border-t border-line pt-4" : ""}`}>
          {badges.map((b) => (
            <li
              key={b.label}
              className="mono rounded-term px-2 py-1 text-[0.62rem] tracking-wide"
              style={{
                color: toneColor[b.tone],
                background: `color-mix(in srgb, ${toneColor[b.tone]} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${toneColor[b.tone]} 28%, transparent)`,
              }}
            >
              {b.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Key insights ─────────────────────────────────────────

export function KeyInsights({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <Section title="Key insights">
      <div className="grid gap-2.5 lg:grid-cols-2">
        {insights.map((ins) => (
          <article
            key={ins.title}
            className="panel p-3.5"
            style={{ borderColor: `color-mix(in srgb, ${toneColor[ins.tone]} 26%, var(--line))` }}
          >
            <h3
              className="mono flex items-center gap-2 text-[0.76rem] font-semibold"
              style={{ color: toneColor[ins.tone] }}
            >
              <span
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: toneColor[ins.tone] }}
                aria-hidden="true"
              />
              {ins.title}
            </h3>
            {ins.points.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {ins.points.map((p) => (
                  <li key={p} className="text-[0.72rem] leading-relaxed text-muted">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </Section>
  );
}

// ── Three pillars ────────────────────────────────────────

export function Pillars({ pillars }: { pillars: Pillar[] }) {
  if (pillars.length === 0) return null;
  const tone = (v: number) =>
    v >= 65 ? "var(--edge)" : v >= 45 ? "var(--warn)" : "var(--risk)";
  return (
    <Section title="Pillars">
      <div className="grid gap-2.5 sm:grid-cols-3">
        {pillars.map((p) => (
          <article key={p.name} className="panel p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="mono text-[0.68rem] uppercase tracking-[0.14em] text-muted">
                {p.name}
              </h3>
              {p.trend && (
                <span className="mono text-[0.58rem] tracking-wide text-faint">
                  {p.trend}
                </span>
              )}
            </div>
            <div
              className="mono tnum mt-1 text-3xl font-semibold"
              style={{ color: tone(p.score) }}
            >
              {p.score}
            </div>
            {/* Bar doubles as the score readout — no separate meter needed. */}
            <div className="mt-2 h-1 w-full rounded-full bg-line">
              <div
                className="h-1 rounded-full"
                style={{ width: `${Math.max(2, Math.min(100, p.score))}%`, background: tone(p.score) }}
              />
            </div>
            <p className="mt-2.5 text-[0.72rem] leading-relaxed text-muted">{p.sentence}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

// ── Market profile ───────────────────────────────────────

export function MarketProfile({ markets }: { markets: MarketRow[] }) {
  if (markets.length === 0) return null;
  const tone = (b: MarketRow["band"]) =>
    b === "Strong" ? "var(--edge)" : b === "Medium" ? "var(--warn)" : "var(--muted)";
  return (
    <Section title="Market profile">
      <div className="panel divide-y divide-line">
        {markets.map((m) => (
          <div key={m.market} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-3.5">
            <span className="mono w-40 shrink-0 text-[0.74rem] font-semibold text-text">
              {m.market}
            </span>
            <span className="flex min-w-[7rem] items-center gap-2">
              <span className="h-1 w-16 rounded-full bg-line">
                <span
                  className="block h-1 rounded-full"
                  style={{ width: `${Math.max(2, Math.min(100, m.score))}%`, background: tone(m.band) }}
                />
              </span>
              <span className="mono text-[0.62rem] font-bold tracking-widest" style={{ color: tone(m.band) }}>
                {m.band}
              </span>
            </span>
            <span className="flex-1 text-[0.7rem] leading-relaxed text-muted">{m.sentence}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.65rem] leading-relaxed text-faint">
        Descriptive only — where this side&rsquo;s own profile has been most separable. Whether a
        market is worth taking depends on both teams and the price, which is the match page&rsquo;s
        job, not this one&rsquo;s.
      </p>
    </Section>
  );
}

// ── Danger zone ──────────────────────────────────────────

export function DangerZone({ risks }: { risks: Risk[] }) {
  if (risks.length === 0) return null;
  return (
    <Section title="Danger zone">
      <div className="grid gap-2.5 lg:grid-cols-2">
        {risks.map((r) => (
          <article
            key={r.title}
            className="panel p-3.5"
            style={{ borderColor: "color-mix(in srgb, var(--risk) 24%, var(--line))" }}
          >
            <h3 className="mono text-[0.74rem] font-semibold" style={{ color: "var(--risk)" }}>
              {r.title}
            </h3>
            <p className="mt-1.5 text-[0.72rem] leading-relaxed text-text">{r.why}</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-muted">{r.effect}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

// ── Tactical identity ────────────────────────────────────

export function TacticalIdentity({
  rows,
  strengths,
  weaknesses,
}: {
  rows: IdentityRow[];
  strengths: string[];
  weaknesses: string[];
}) {
  if (rows.length === 0 && strengths.length === 0 && weaknesses.length === 0) return null;
  return (
    <Section title="Identity">
      <div className="panel p-4">
        {rows.length > 0 && (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <div key={r.label}>
                <dt className="label-cap">{r.label}</dt>
                <dd className="mono text-[0.76rem] text-text">{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {(strengths.length > 0 || weaknesses.length > 0) && (
          <div
            className={`grid gap-4 sm:grid-cols-2 ${rows.length > 0 ? "mt-4 border-t border-line pt-4" : ""}`}
          >
            {strengths.length > 0 && (
              <div>
                <div className="label-cap mb-1" style={{ color: "var(--edge)" }}>
                  Strengths
                </div>
                <ul className="space-y-0.5">
                  {strengths.map((s) => (
                    <li key={s} className="text-[0.72rem] leading-relaxed text-muted">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {weaknesses.length > 0 && (
              <div>
                <div className="label-cap mb-1" style={{ color: "var(--risk)" }}>
                  Weaknesses
                </div>
                <ul className="space-y-0.5">
                  {weaknesses.map((w) => (
                    <li key={w} className="text-[0.72rem] leading-relaxed text-muted">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
