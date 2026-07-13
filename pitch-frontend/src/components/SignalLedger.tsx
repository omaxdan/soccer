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
  overallHomeScore?: number | null;
  overallAwayScore?: number | null;
  homeWinProb?: number | null;
  awayWinProb?: number | null;
  mostLikelyScore?: string | null;
  homeXIStrength?: number | null;
  awayXIStrength?: number | null;
  homeBenchStrength?: number | null;
  awayBenchStrength?: number | null;
}

const f1 = (v: number | null | undefined) => (v == null ? null : v.toFixed(1));
const f0 = (v: number | null | undefined) => (v == null ? null : Math.round(v));

function generateEvidenceLines(signal: MarketSignal, ctx: SignalMatchContext): { text: string; positive?: boolean }[] {
  const lines: { text: string; positive?: boolean }[] = [];
  const group = signal.signal_group;
  const market = signal.market?.toLowerCase() || "";
  const dir = signal.direction;

  // ─── 1X2 / MATCH RESULT ────────────────────────────────────────────────────
  if (group === "1x2" || group === "competition" || market.includes("result") || market.includes("match result")) {
    
    // Quality comparison
    if (ctx.homeQuality != null && ctx.awayQuality != null) {
      const diff = ctx.homeQuality - ctx.awayQuality;
      if (Math.abs(diff) > 5) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ 
          text: `Quality: ${direction} ${Math.abs(diff)}pts higher (${f0(ctx.homeQuality)} vs ${f0(ctx.awayQuality)})`,
          positive: isSupport
        });
      }
    }

    // Attack comparison
    if (ctx.homeAttack != null && ctx.awayAttack != null) {
      const diff = ctx.homeAttack - ctx.awayAttack;
      if (Math.abs(diff) > 5) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ 
          text: `Attack: ${direction} ${Math.abs(diff)}pts higher (${f0(ctx.homeAttack)} vs ${f0(ctx.awayAttack)})`,
          positive: isSupport
        });
      }
    }

    // Defence comparison
    if (ctx.homeDefence != null && ctx.awayDefence != null) {
      const diff = ctx.homeDefence - ctx.awayDefence;
      if (Math.abs(diff) > 5) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ 
          text: `Defence: ${direction} ${Math.abs(diff)}pts better (${f0(ctx.homeDefence)} vs ${f0(ctx.awayDefence)})`,
          positive: isSupport
        });
      }
    }

    // Win probability
    if (ctx.homeWinProb != null && ctx.awayWinProb != null) {
      const diff = ctx.homeWinProb - ctx.awayWinProb;
      if (Math.abs(diff) > 2) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ 
          text: `Win probability: ${direction} ${Math.abs(diff).toFixed(1)}% higher (${f0(ctx.homeWinProb)}% vs ${f0(ctx.awayWinProb)}%)`,
          positive: isSupport
        });
      }
    }

    // Overall score
    if (ctx.overallHomeScore != null && ctx.overallAwayScore != null) {
      const diff = ctx.overallHomeScore - ctx.overallAwayScore;
      if (Math.abs(diff) > 5) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ 
          text: `Overall score: ${direction} ${Math.abs(diff)}pts (${f0(ctx.overallHomeScore)} vs ${f0(ctx.overallAwayScore)})`,
          positive: isSupport
        });
      }
    }

    // Most likely score
    if (ctx.mostLikelyScore) {
      lines.push({ text: `Most likely score: ${ctx.mostLikelyScore}`, positive: false });
    }

    // Readiness (can be conflicting)
    if (ctx.homeReadiness != null && ctx.awayReadiness != null) {
      const diff = ctx.homeReadiness - ctx.awayReadiness;
      if (Math.abs(diff) > 5) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ 
          text: `Readiness: ${direction} ${Math.abs(diff)}pts higher (${f0(ctx.homeReadiness)} vs ${f0(ctx.awayReadiness)})`,
          positive: isSupport
        });
      }
    }

    // XI strength (can be conflicting or neutral)
    if (ctx.homeXIStrength != null && ctx.awayXIStrength != null) {
      const diff = ctx.homeXIStrength - ctx.awayXIStrength;
      if (Math.abs(diff) <= 5) {
        lines.push({ 
          text: `XI strength: ${f0(ctx.homeXIStrength)} vs ${f0(ctx.awayXIStrength)} (almost even)`,
          positive: false
        });
      } else if (Math.abs(diff) > 10) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ 
          text: `XI strength: ${direction} ${Math.abs(diff)}pts higher (${f0(ctx.homeXIStrength)} vs ${f0(ctx.awayXIStrength)})`,
          positive: isSupport
        });
      }
    }

    // Form
    if (ctx.homeForm != null && ctx.awayForm != null) {
      const diff = ctx.homeForm - ctx.awayForm;
      if (Math.abs(diff) > 10) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ 
          text: `Form: ${direction} ${Math.abs(diff)}pts better (${f0(ctx.homeForm)} vs ${f0(ctx.awayForm)})`,
          positive: isSupport
        });
      }
    }

    // Squad stability
    if (ctx.homeSquadStability != null && ctx.homeSquadStability > 80) {
      lines.push({ text: `Home squad stability: ${f0(ctx.homeSquadStability)}/100`, positive: dir === "home" });
    }
    if (ctx.awaySquadStability != null && ctx.awaySquadStability > 80) {
      lines.push({ text: `Away squad stability: ${f0(ctx.awaySquadStability)}/100`, positive: dir === "away" });
    }

    // Rest advantage
    if (ctx.homeRest != null && ctx.awayRest != null) {
      const diff = ctx.homeRest - ctx.awayRest;
      if (Math.abs(diff) > 2) {
        const direction = diff > 0 ? "Home" : "Away";
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ text: `Rest advantage: ${direction} +${Math.abs(diff).toFixed(1)}d`, positive: isSupport });
      }
    }

    // Travel
    if (ctx.awayTravel != null && ctx.awayTravel > 200) {
      lines.push({ text: `Away travelled: ${f0(ctx.awayTravel)}km`, positive: dir === "home" });
    }

    // ─── CONFLICTING EVIDENCE ──────────────────────────────────────────────
    if (dir === "home" && ctx.awayQuality != null && ctx.homeQuality != null && ctx.awayQuality > ctx.homeQuality + 10) {
      lines.push({ text: `⚠️ Away quality actually rates higher (${f0(ctx.awayQuality)} vs ${f0(ctx.homeQuality)})`, positive: false });
    }
    if (dir === "away" && ctx.homeQuality != null && ctx.awayQuality != null && ctx.homeQuality > ctx.awayQuality + 10) {
      lines.push({ text: `⚠️ Home quality actually rates higher (${f0(ctx.homeQuality)} vs ${f0(ctx.awayQuality)})`, positive: false });
    }
    if (dir === "home" && ctx.homeReadiness != null && ctx.awayReadiness != null && ctx.awayReadiness > ctx.homeReadiness + 10) {
      lines.push({ text: `⚠️ Home readiness actually higher (${f0(ctx.homeReadiness)} vs ${f0(ctx.awayReadiness)})`, positive: false });
    }
    if (dir === "away" && ctx.homeReadiness != null && ctx.awayReadiness != null && ctx.homeReadiness > ctx.awayReadiness + 10) {
      lines.push({ text: `⚠️ Away readiness actually higher (${f0(ctx.awayReadiness)} vs ${f0(ctx.homeReadiness)})`, positive: false });
    }
  }

  // ─── OTHER MARKETS ─────────────────────────────────────────────────────
  // Goals / BTTS
  if (group === "goals" || market.includes("btts") || market.includes("goal") || market.includes("total")) {
    if (ctx.homeAttack != null && ctx.homeAttack > 50) {
      lines.push({ text: `Home attack: ${f0(ctx.homeAttack)}/100`, positive: true });
    }
    if (ctx.awayAttack != null && ctx.awayAttack > 50) {
      lines.push({ text: `Away attack: ${f0(ctx.awayAttack)}/100`, positive: true });
    }
    if (ctx.homeDefence != null && ctx.homeDefence < 50) {
      lines.push({ text: `Home defence: ${f0(ctx.homeDefence)}/100 (leaky)`, positive: true });
    }
    if (ctx.awayDefence != null && ctx.awayDefence < 50) {
      lines.push({ text: `Away defence: ${f0(ctx.awayDefence)}/100 (leaky)`, positive: true });
    }
    if (ctx.homeGoalsPerGame != null && ctx.homeGoalsPerGame > 1.3) {
      lines.push({ text: `Home goals/game: ${f1(ctx.homeGoalsPerGame)}`, positive: true });
    }
    if (ctx.awayGoalsPerGame != null && ctx.awayGoalsPerGame > 1.3) {
      lines.push({ text: `Away goals/game: ${f1(ctx.awayGoalsPerGame)}`, positive: true });
    }
    if (ctx.predictedHomeGoals != null && ctx.predictedAwayGoals != null) {
      const total = ctx.predictedHomeGoals + ctx.predictedAwayGoals;
      if (total > 2.5) {
        lines.push({ text: `Expected goals: ${total.toFixed(2)} (Over 2.5 lean)`, positive: true });
      } else if (total < 2.0) {
        lines.push({ text: `Expected goals: ${total.toFixed(2)} (Under 2.5 lean)`, positive: false });
      } else {
        lines.push({ text: `Expected goals: ${total.toFixed(2)}`, positive: false });
      }
    }
  }

  // Half-time
  if (group === "halftime" || market.includes("half") || market.includes("ht")) {
    if (ctx.readinessGap != null && Math.abs(ctx.readinessGap) > 10) {
      const isSupport = (dir === "home" && ctx.readinessGap > 0) || (dir === "away" && ctx.readinessGap < 0);
      lines.push({ text: `Readiness gap: ${Math.abs(ctx.readinessGap)}pts`, positive: isSupport });
    }
    if (ctx.homeForm != null && ctx.awayForm != null) {
      const diff = ctx.homeForm - ctx.awayForm;
      if (Math.abs(diff) > 10) {
        const isSupport = (dir === "home" && diff > 0) || (dir === "away" && diff < 0);
        lines.push({ text: `Form: ${diff > 0 ? "Home" : "Away"} +${Math.abs(diff)}pts (${f0(ctx.homeForm)} vs ${f0(ctx.awayForm)})`, positive: isSupport });
      }
    }
  }

  return lines;
}

export function SignalRow({
  signal,
  matchConfidence,
  matchContext,
}: {
  signal: MarketSignal;
  matchConfidence?: { score: number | null; band: string | null };
  matchContext?: SignalMatchContext;
}) {
  // Use driver lines if available, otherwise generate from context
  const driverLines: { text: string; positive?: boolean }[] = signal.drivers
    ? signal.drivers.split(",").map((s) => ({ text: s.trim() }))
    : [];
  const lines = driverLines.length > 0 ? driverLines : matchContext ? generateEvidenceLines(signal, matchContext) : [];

  // ─── CALCULATE DIRECTION FROM EVIDENCE ──────────────────────────────
  let effectiveDirection = signal.direction;
  
  // If neutral or weak, derive from evidence
  if (signal.direction === 'neutral' || signal.strength < 2) {
    const supportLines = lines.filter(l => l.positive === true);
    const homeSupport = supportLines.filter(l => l.text.toLowerCase().includes('home')).length;
    const awaySupport = supportLines.filter(l => l.text.toLowerCase().includes('away')).length;
    
    if (homeSupport > awaySupport) {
      effectiveDirection = 'home';
    } else if (awaySupport > homeSupport) {
      effectiveDirection = 'away';
    }
  }

  const d = directionStyle(effectiveDirection);

  // ─── CALCULATE STRENGTH ──────────────────────────────────────────────
  const supportLines = lines.filter(l => l.positive === true);
  const opposeLines = lines.filter(l => l.positive === false);
  const hasConflicting = opposeLines.length > 0 && supportLines.length > 0;
  
  let adjustedStrength = signal.strength;
  
  // If we have evidence but signal says 0, use evidence count
  if (adjustedStrength === 0 && supportLines.length > 0) {
    adjustedStrength = Math.min(6, supportLines.length);
  }
  
  // If we derived direction, ensure minimum strength
  if (effectiveDirection !== 'neutral' && adjustedStrength < 2 && supportLines.length >= 3) {
    adjustedStrength = Math.min(6, Math.max(3, supportLines.length));
  }
  
  // Reduce for conflicting evidence
  if (hasConflicting && adjustedStrength > 1) {
    adjustedStrength = Math.max(1, adjustedStrength - 1);
  }
  
  adjustedStrength = Math.min(6, Math.max(0, adjustedStrength));

  // ─── EVIDENCE STREAMS COUNT ──────────────────────────────────────────
  const evidenceLines = lines.filter(l => l.positive !== undefined);
  const totalEvidence = evidenceLines.length;
  const supportCount = evidenceLines.filter(l => l.positive === true).length;
  const opposeCount = evidenceLines.filter(l => l.positive === false).length;
  const showEvidenceCount = totalEvidence >= 3 && effectiveDirection !== 'neutral' && supportCount > opposeCount;

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
        <StrengthMeter strength={adjustedStrength} color={d.color} />
        {signal.locked && (
          <span className="mono shrink-0 text-[0.6rem] text-faint" title="Signal locked — no longer recalculated">🔒</span>
        )}
      </div>
      <p className="mt-1.5 pl-7 text-[0.8rem] leading-snug text-muted">
        {signal.signal_text}
      </p>
      {signal.data_source && (
        <p className="mono pl-7 text-[0.55rem] uppercase tracking-wide text-faint">source: {signal.data_source}</p>
      )}
      {lines.length > 0 && (
        <div className="pl-7">
          <EvidenceDisclosure
            label={signal.market}
            lines={lines}
            facts={[
              { label: "Signal strength", value: `${adjustedStrength}/6`, explain: "signal_strength" },
              ...(matchConfidence?.score != null
                ? [{ label: "Match confidence", value: `${Math.round(matchConfidence.score)}%${matchConfidence.band ? ` (${matchConfidence.band})` : ""}`, explain: "match_confidence" as const }]
                : []),
              ...(hasConflicting ? [{ label: "⚠️ Conflicting signals", value: `${opposeCount} oppose, ${supportCount} support`, explain: "signal_conflict" as const }] : []),
              ...(showEvidenceCount ? [{ label: "Evidence streams", value: `${supportCount} of ${totalEvidence} point ${effectiveDirection === 'home' ? 'HOME' : 'AWAY'}`, explain: "evidence_streams" as const }] : []),
            ]}
          />
        </div>
      )}
      <p className="mono mt-1.5 pl-7 text-[0.55rem] text-faint">
        {hasConflicting ? "Mixed signal — conflicting evidence" : signalStrengthLabel(adjustedStrength)} signal
      </p>
    </div>
  );
}