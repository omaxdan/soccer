import { directionStyle, signalStrengthLabel } from "@/lib/intel";
import { EvidenceDisclosure } from "./Explain";
import type { MarketSignal } from "@/lib/types";

function StrengthMeter({ strength, color }: { strength: number; color: string }) {
  const max = 6;
  return (
    <span className="flex items-center gap-0.5" aria-label={`Strength ${strength} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className="h-2.5 w-1 rounded-[1px]"
          style={{ background: i < strength ? color : "var(--line)" }}
        />
      ))}
    </span>
  );
}

// Real per-team context, already fetched for this match — used only as a
// fallback source of evidence lines when the warehouse hasn't populated
// `drivers` for a given signal. Every field is a real number, not a score
// computed for this purpose.
export interface SignalMatchContext {
  homeReadiness: number | null; awayReadiness: number | null; readinessGap: number | null;
  homeSquadStability: number | null; awaySquadStability: number | null;
  homeForm: number | null; awayForm: number | null;
  homeAttack: number | null; awayAttack: number | null;
  homeDefence: number | null; awayDefence: number | null;
  homeTravel: number | null; awayTravel: number | null;
  homeRest: number | null; awayRest: number | null;
  homeFatigue: number | null; awayFatigue: number | null;
  homeQuality: number | null; awayQuality: number | null;
  homeGoalsPerGame: number | null; awayGoalsPerGame: number | null;
  predictedHomeGoals: number | null; predictedAwayGoals: number | null;
}

const f1 = (v: number | null | undefined) => (v == null ? null : v.toFixed(1));
const f0 = (v: number | null | undefined) => (v == null ? null : Math.round(v));

function contextFallbackLines(signal: MarketSignal, ctx: SignalMatchContext): { text: string; positive?: boolean }[] {
  const lines: { text: string; positive?: boolean }[] = [];
  const group = signal.signal_group;
  const dir = signal.direction;

  if (group === "1x2" || group === "competition") {
    if (ctx.readinessGap != null && ctx.homeReadiness != null && ctx.awayReadiness != null) {
      lines.push({ text: `Readiness gap ${f0(ctx.readinessGap)}pts (${f0(ctx.homeReadiness)} vs ${f0(ctx.awayReadiness)})` });
    }
    if (ctx.homeQuality != null && ctx.awayQuality != null) {
      lines.push({ text: `Team quality ${f0(ctx.homeQuality)} vs ${f0(ctx.awayQuality)}` });
    }
    if (ctx.homeSquadStability != null) lines.push({ text: `Home squad stability ${f0(ctx.homeSquadStability)}/100` });
    if (ctx.awaySquadStability != null) lines.push({ text: `Away squad stability ${f0(ctx.awaySquadStability)}/100` });
    if (ctx.homeRest != null && ctx.awayRest != null) {
      lines.push({ text: `Rest: home ${f1(ctx.homeRest)}d, away ${f1(ctx.awayRest)}d` });
    }
    if (ctx.awayTravel != null) lines.push({ text: `Away travelled ${f0(ctx.awayTravel)}km` });
  }

  if (group === "halftime") {
    if (ctx.readinessGap != null) lines.push({ text: `Readiness gap ${f0(ctx.readinessGap)}pts` });
    if (ctx.homeSquadStability != null) lines.push({ text: `Home squad stability ${f0(ctx.homeSquadStability)}/100` });
    if (ctx.homeForm != null && ctx.awayForm != null) lines.push({ text: `Form: home ${f0(ctx.homeForm)}, away ${f0(ctx.awayForm)}` });
  }

  if (group === "goals" || group === "cards") {
    if (ctx.predictedHomeGoals != null && ctx.predictedAwayGoals != null) {
      lines.push({ text: `Expected goals ${f1(ctx.predictedHomeGoals)} + ${f1(ctx.predictedAwayGoals)} = ${f1(ctx.predictedHomeGoals + ctx.predictedAwayGoals)}` });
    }
    if (ctx.homeAttack != null) lines.push({ text: `Home attack rating ${f0(ctx.homeAttack)}/100` });
    if (ctx.awayAttack != null) lines.push({ text: `Away attack rating ${f0(ctx.awayAttack)}/100` });
    if (ctx.homeDefence != null) lines.push({ text: `Home defence rating ${f0(ctx.homeDefence)}/100` });
    if (ctx.awayDefence != null) lines.push({ text: `Away defence rating ${f0(ctx.awayDefence)}/100` });
    if (ctx.homeGoalsPerGame != null) lines.push({ text: `Home goals/game ${f1(ctx.homeGoalsPerGame)}` });
    if (ctx.awayGoalsPerGame != null) lines.push({ text: `Away goals/game ${f1(ctx.awayGoalsPerGame)}` });
  }

  // An honest tension worth surfacing rather than smoothing over: the lean
  // disagreeing with the plainer quality comparison.
  if (dir === "home" && ctx.homeQuality != null && ctx.awayQuality != null && ctx.awayQuality > ctx.homeQuality + 10) {
    lines.push({ text: `Away quality actually rates higher (${f0(ctx.awayQuality)} vs ${f0(ctx.homeQuality)})`, positive: false });
  }
  if (dir === "away" && ctx.homeQuality != null && ctx.awayQuality != null && ctx.homeQuality > ctx.awayQuality + 10) {
    lines.push({ text: `Home quality actually rates higher (${f0(ctx.homeQuality)} vs ${f0(ctx.awayQuality)})`, positive: false });
  }

  return lines;
}

// A market signal rendered as a terminal ledger line:
// [glyph] MARKET .............................. [strength]
//
// matchConfidence is optional — pass the match's real confidence_score/
// confidence_band (match_intelligence) so each signal can show the actual
// per-match number instead of a fabricated per-signal "streams agree"
// estimate. matchContext is optional too — when the warehouse's `drivers`
// text is empty for a signal, it's used to build a handful of evidence
// lines from real per-team numbers already fetched for this match, so the
// "why" panel still has something real to show rather than nothing.
export function SignalRow({
  signal,
  matchConfidence,
  matchContext,
}: {
  signal: MarketSignal;
  matchConfidence?: { score: number | null; band: string | null };
  matchContext?: SignalMatchContext;
}) {
  const d = directionStyle(signal.direction);
  const driverLines = signal.drivers ? signal.drivers.split(",").map((s) => ({ text: s.trim() })) : [];
  const lines = driverLines.length > 0 ? driverLines : matchContext ? contextFallbackLines(signal, matchContext) : [];

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
      {lines.length > 0 && (
        <div className="pl-7">
          <EvidenceDisclosure
            label={signal.market}
            lines={lines}
            facts={[
              { label: "Signal strength", value: `${Math.min(6, signal.strength)}/6`, explain: "signal_strength" },
              ...(matchConfidence?.score != null
                ? [{ label: "Match confidence", value: `${Math.round(matchConfidence.score)}%${matchConfidence.band ? ` (${matchConfidence.band})` : ""}`, explain: "match_confidence" as const }]
                : []),
            ]}
          />
        </div>
      )}
      <p className="mono mt-1.5 pl-7 text-[0.55rem] text-faint">{signalStrengthLabel(signal.strength)} signal</p>
    </div>
  );
}
