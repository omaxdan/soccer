import { directionStyle, signalStrengthLabel } from "@/lib/intel";
import type { MarketSignal } from "@/lib/types";

function StrengthMeter({ strength, color }: { strength: number; color: string }) {
  const max = 6;
  return (
    <span className="flex items-center gap-0.5" aria-label={`Strength ${strength} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className="h-2.5 w-1 rounded-[1px]"
          style={{
            background: i < strength ? color : "var(--line)",
          }}
        />
      ))}
    </span>
  );
}

// The `drivers` column is a single free-text field from the warehouse, e.g.
// "Readiness gap 37pts (80 vs 43); Home squad stability 100/100; Away
// travel 28km". Split it into individual evidence lines so each concrete
// number gets its own row instead of being buried in one gray sentence.
function splitDrivers(drivers: string): string[] {
  return drivers
    .split(/;|\n|(?<=\))\s*,\s*(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// A market signal rendered as an always-expanded card: the market, the lean,
// the strength meter, and — front and center — the actual evidence numbers
// behind it. No internal jargon ("N of M evidence streams"); just the data.
export function SignalRow({ signal }: { signal: MarketSignal }) {
  const d = directionStyle(signal.direction);
  const evidence = signal.drivers ? splitDrivers(signal.drivers) : [];
  return (
    <div className="border-b border-line py-3 last:border-0">
      <div className="flex items-center gap-2.5">
        <span
          className="mono grid h-5 w-5 shrink-0 place-items-center rounded text-xs"
          style={{
            color: d.color,
            background: `color-mix(in srgb, ${d.color} 14%, transparent)`,
          }}
          aria-hidden
        >
          {d.glyph}
        </span>
        <span className="mono truncate text-[0.8rem] font-medium tracking-tight text-text">
          {signal.market}
        </span>
        <span className="mx-1 hidden flex-1 border-b border-dotted border-line sm:block" />
        <span
          className="mono ml-auto shrink-0 text-[0.55rem] font-semibold tracking-widest sm:ml-0"
          style={{ color: d.color }}
        >
          {d.word}
        </span>
        <StrengthMeter strength={Math.min(6, signal.strength)} color={d.color} />
      </div>
      <p className="mt-1.5 pl-7 text-[0.8rem] leading-snug text-text">
        {signal.signal_text}
      </p>
      {evidence.length > 0 && (
        <ul className="mt-2 space-y-1 pl-7">
          {evidence.map((line, idx) => (
            <li key={idx} className="mono flex items-start gap-1.5 text-[0.68rem] leading-snug text-muted">
              <span className="mt-0.5 shrink-0" style={{ color: d.color }}>›</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mono mt-1.5 pl-7 text-[0.55rem] text-faint">
        {signalStrengthLabel(signal.strength)} signal
      </p>
    </div>
  );
}
