import { directionStyle } from "@/lib/intel";
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

// A market signal rendered as a terminal ledger line:
// [glyph] MARKET .............................. [strength]
export function SignalRow({ signal }: { signal: MarketSignal }) {
  const d = directionStyle(signal.direction);
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
      <p className="mt-1.5 pl-7 text-[0.8rem] leading-snug text-muted">
        {signal.signal_text}
      </p>
      {signal.drivers && (
        <p className="mono mt-1 pl-7 text-[0.6rem] tracking-wide text-faint">
          {signal.drivers}
        </p>
      )}
    </div>
  );
}
