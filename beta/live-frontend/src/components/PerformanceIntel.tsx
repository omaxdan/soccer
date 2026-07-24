import { BarMeter } from "./Meters";
import type { PerformanceIntel, PerfInsight, DerivedSignal } from "@/lib/performance";

function InsightRow({ i }: { i: PerfInsight }) {
  return (
    <div className="border-b border-line py-3 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.8rem] font-medium tracking-tight">{i.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="mono text-sm font-bold tnum" style={{ color: i.color }}>
            {i.value}
          </span>
          <span
            className="mono rounded px-1.5 py-0.5 text-[0.55rem] font-semibold tracking-wide"
            style={{ color: i.color, background: `color-mix(in srgb, ${i.color} 14%, transparent)` }}
          >
            {i.tier}
          </span>
        </span>
      </div>
      {i.score != null && (
        <div className="mt-2">
          <BarMeter value={i.score} color={i.color} height={5} />
        </div>
      )}
      <p className="mt-1.5 text-[0.75rem] leading-snug text-muted">{i.reading}</p>
    </div>
  );
}

const DIR_STYLE: Record<DerivedSignal["direction"], { color: string; word: string }> = {
  positive: { color: "var(--edge)", word: "LEANS OVER / YES" },
  negative: { color: "var(--cool)", word: "LEANS UNDER / NO" },
  neutral: { color: "var(--muted)", word: "NO EDGE" },
  avoid: { color: "var(--risk)", word: "AVOID" },
};

function SignalCard({ s }: { s: DerivedSignal }) {
  const st = DIR_STYLE[s.direction];
  return (
    <div className="rounded-term border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-[0.8rem] font-semibold tracking-tight">{s.market}</span>
        <span className="mono text-[0.55rem] font-bold tracking-wider" style={{ color: st.color }}>
          {st.word}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <BarMeter value={s.confidence} color={st.color} height={5} />
        <span className="mono w-9 shrink-0 text-right text-[0.65rem] tnum" style={{ color: st.color }}>
          {Math.round(s.confidence)}%
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {s.reasons.map((r, idx) => (
          <li key={idx} className="flex items-start gap-1.5 text-[0.72rem] leading-snug">
            <span className="mono shrink-0" style={{ color: r.good ? "var(--edge)" : "var(--risk)" }}>
              {r.good ? "+" : "−"}
            </span>
            <span className="text-muted">{r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InsightList({ insights }: { insights: PerfInsight[] }) {
  return <div>{insights.map((i) => <InsightRow key={i.key} i={i} />)}</div>;
}

export function SignalGrid({ signals }: { signals: DerivedSignal[] }) {
  if (!signals.length) return null;
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {signals.map((s) => <SignalCard key={s.market} s={s} />)}
    </div>
  );
}

export function PerformanceIntelView({ perf }: { perf: PerformanceIntel }) {
  const fragColor =
    perf.defenseFragility === "HIGH"
      ? "var(--risk)"
      : perf.defenseFragility === "MEDIUM"
      ? "var(--warn)"
      : "var(--edge)";

  return (
    <div className="space-y-5">
      {/* headline scores */}
      <div className="grid grid-cols-2 gap-3">
        <div className="panel-raised p-3">
          <div className="label-cap">Attack efficiency</div>
          <div
            className="mono mt-1 text-2xl font-bold leading-none tnum"
            style={{ color: (perf.attackEfficiency ?? 0) >= 60 ? "var(--edge)" : (perf.attackEfficiency ?? 0) >= 40 ? "var(--warn)" : "var(--risk)" }}
          >
            {perf.attackEfficiency ?? "—"}
          </div>
          <div className="mono text-[0.55rem] text-faint">efficiency, not volume</div>
        </div>
        <div className="panel-raised p-3">
          <div className="label-cap">Defensive fragility</div>
          <div className="mono mt-1 text-2xl font-bold leading-none" style={{ color: fragColor }}>
            {perf.defenseFragility ?? "—"}
          </div>
          <div className="mono text-[0.55rem] text-faint">goal vulnerability</div>
        </div>
      </div>

      {/* style identity */}
      {perf.style && (
        <div>
          <p className="label-cap mb-1">Attacking identity</p>
          <p className="mono text-sm font-semibold text-amber">{perf.style.identity}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {perf.style.traits.map((t) => (
              <span key={t} className="mono rounded border border-line px-2 py-0.5 text-[0.6rem] text-muted">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* attack insights */}
      {perf.attack.length > 0 && (
        <div>
          <p className="label-cap mb-1">Attacking intelligence</p>
          <div>{perf.attack.map((i) => <InsightRow key={i.key} i={i} />)}</div>
        </div>
      )}

      {/* defense insights */}
      {perf.defense.length > 0 && (
        <div>
          <p className="label-cap mb-1">Defensive intelligence</p>
          <div>{perf.defense.map((i) => <InsightRow key={i.key} i={i} />)}</div>
        </div>
      )}

      {/* discipline + physical */}
      {(perf.discipline || perf.physical) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {perf.discipline && <div className="rounded-term border border-line p-3"><InsightRow i={perf.discipline} /></div>}
          {perf.physical && <div className="rounded-term border border-line p-3"><InsightRow i={perf.physical} /></div>}
        </div>
      )}

      {/* derived signals */}
      {perf.signals.length > 0 && (
        <div>
          <p className="label-cap mb-2">Derived market signals</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {perf.signals.map((s) => <SignalCard key={s.market} s={s} />)}
          </div>
          <p className="mono mt-2 text-[0.55rem] text-faint">
            Signals are read from season-long efficiency, not single-match form. Not betting advice.
          </p>
        </div>
      )}

      {/* transparency: missing inputs */}
      {perf.missing.length > 0 && (
        <p className="mono rounded-term border border-line bg-raised/40 p-2.5 text-[0.6rem] leading-relaxed text-faint">
          Some shot-level metrics ({perf.missing.join(", ")}) aren&rsquo;t in the
          warehouse yet, so finishing and suppression reads are partial. Add
          these columns to team_season_statistics and they compute automatically.
        </p>
      )}
    </div>
  );
}
