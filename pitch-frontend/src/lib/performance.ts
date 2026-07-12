// ── Performance Intelligence Engine ──────────────────────
// Turns raw team season statistics into derived metrics and betting
// signals. Every output is an *interpretation*, never a raw number.
//
// The input is a superset of the SofaScore-style team stat block. Only a
// curated subset currently lives in `team_season_statistics`; the rest is
// optional and the engine computes whatever the inputs allow, flagging
// anything it can't derive rather than inventing it.

export interface TeamSeasonStats {
  matches: number | null;
  goals_scored: number | null;
  goals_conceded: number | null;
  clean_sheets: number | null;
  avg_possession: number | null;
  avg_rating: number | null;
  accurate_passes_pct: number | null;
  duels_won_pct: number | null;
  aerial_duels_won_pct: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  big_chances_created: number | null;
  big_chances_missed: number | null;
  // extended (raw) fields — present once the warehouse stores them
  shots?: number | null;
  shots_on_target?: number | null;
  shots_inside_box?: number | null;
  goals_inside_box?: number | null;
  goals_outside_box?: number | null;
  headed_goals?: number | null;
  left_foot_goals?: number | null;
  right_foot_goals?: number | null;
  long_balls_pct?: number | null;
  crosses_pct?: number | null;
  big_chances?: number | null;
  // defensive (against)
  shots_against?: number | null;
  shots_on_target_against?: number | null;
  big_chances_against?: number | null;
  errors_leading_to_goal?: number | null;
}

export type Grade = "elite" | "good" | "average" | "poor";
export type Band = "LOW" | "MEDIUM" | "HIGH";

export interface PerfInsight {
  key: string;
  label: string;
  value: string; // display form, e.g. "4.7%"
  tier: string; // e.g. "Poor finishing"
  color: string;
  reading: string; // the sentence
  score: number | null; // 0..100 for a bar, when meaningful
}

export interface DerivedSignal {
  market: string;
  group: "goals" | "btts" | "result" | "cards";
  direction: "positive" | "negative" | "neutral" | "avoid";
  confidence: number; // 0..100
  reasons: { good: boolean; text: string }[];
}

export interface PerformanceIntel {
  attack: PerfInsight[];
  defense: PerfInsight[];
  discipline: PerfInsight | null;
  physical: PerfInsight | null;
  style: { identity: string; traits: string[] } | null;
  attackEfficiency: number | null;
  defenseFragility: Band | null;
  signals: DerivedSignal[];
  missing: string[]; // inputs the warehouse isn't storing yet
}

// ── helpers ──────────────────────────────────────────────
const has = (v: number | null | undefined): v is number =>
  v != null && !Number.isNaN(v);
const per = (v: number | null | undefined, m: number | null | undefined) =>
  has(v) && has(m) && m > 0 ? v / m : null;
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

const C = {
  elite: "var(--edge)",
  good: "var(--edge)",
  average: "var(--warn)",
  poor: "var(--risk)",
  neutral: "var(--muted)",
};

function grade(value: number, thresholds: [number, number, number]): Grade {
  const [e, g, a] = thresholds;
  if (value >= e) return "elite";
  if (value >= g) return "good";
  if (value >= a) return "average";
  return "poor";
}

// ── main ─────────────────────────────────────────────────
export function computePerformance(s: TeamSeasonStats): PerformanceIntel {
  const attack: PerfInsight[] = [];
  const defense: PerfInsight[] = [];
  const missing: string[] = [];
  const m = s.matches ?? null;

  // 1 · Finishing efficiency (shot conversion)
  const conv = per(s.goals_scored, s.shots);
  if (conv != null) {
    const rate = conv * 100;
    const g = grade(rate, [13, 9, 6]);
    attack.push({
      key: "finishing",
      label: "Finishing efficiency",
      value: `${rate.toFixed(1)}%`,
      tier:
        g === "elite" ? "Elite finishing" : g === "good" ? "Efficient" : g === "average" ? "Average finishing" : "Poor finishing",
      color: C[g],
      reading:
        g === "poor"
          ? "Creates shot volume but converts at a low rate — goal output may need many chances and can swing match to match."
          : g === "average"
          ? "Converts at a roughly league-average clip; goal returns track chance creation."
          : "Clinical in front of goal — turns a high share of attempts into goals.",
      score: clamp(rate * 6),
    });
  } else missing.push("shots");

  // 2 · Inside-box conversion (chance quality)
  const ibx = per(s.goals_inside_box, s.shots_inside_box);
  if (ibx != null) {
    const rate = ibx * 100;
    const g = grade(rate, [16, 11, 7]);
    attack.push({
      key: "inside_box",
      label: "Close-range conversion",
      value: `${rate.toFixed(1)}%`,
      tier: g === "poor" ? "Weak" : g === "average" ? "Average" : "Sharp",
      color: C[g],
      reading:
        g === "poor"
          ? "Even high-value close-range chances go unconverted — a finishing-quality problem, not just a distance one."
          : "Takes its close-range chances at a healthy rate.",
      score: clamp(rate * 5),
    });
  }

  // 3 · Big-chance reliability
  const bcTotal =
    s.big_chances ??
    (has(s.big_chances_created) && has(s.big_chances_missed)
      ? (s.big_chances_created ?? 0) + (s.big_chances_missed ?? 0)
      : null);
  if (has(bcTotal) && has(s.big_chances_missed) && bcTotal > 0) {
    const converted = Math.max(0, bcTotal - (s.big_chances_missed ?? 0));
    const rate = (converted / bcTotal) * 100;
    const g = grade(rate, [55, 42, 30]);
    attack.push({
      key: "big_chance",
      label: "Big-chance reliability",
      value: `${Math.round(rate)}%`,
      tier: g === "poor" ? "Wasteful" : g === "average" ? "Medium" : "Clinical",
      color: C[g],
      reading:
        g === "poor" || g === "average"
          ? "Creates high-value openings but wastes many — output looks unstable and is a regression candidate in tight games."
          : "Puts away the gilt-edged chances it makes.",
      score: clamp(rate),
    });
  }

  // 4 · Attack efficiency composite (rewards efficiency, not volume)
  let attackEfficiency: number | null = null;
  {
    const parts: number[] = [];
    if (conv != null) parts.push(clamp(conv * 100 * 6));
    if (bcTotal && has(s.big_chances_missed)) {
      const converted = Math.max(0, bcTotal - (s.big_chances_missed ?? 0));
      parts.push(clamp((converted / bcTotal) * 100));
    }
    const sot = per(s.shots_on_target, s.shots);
    if (sot != null) parts.push(clamp(sot * 100 * 2.2));
    const gpg = per(s.goals_scored, m);
    if (gpg != null) parts.push(clamp(gpg * 45));
    if (parts.length) attackEfficiency = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  }

  // 5 · Defensive conversion allowed (GK / defensive quality)
  const dConv = per(s.goals_conceded, s.shots_on_target_against);
  if (dConv != null) {
    const rate = dConv * 100;
    // lower is better → invert for grade
    const g = grade(100 - rate, [82, 75, 68]);
    defense.push({
      key: "def_conversion",
      label: "Shots-on-target conceded → goals",
      value: `${rate.toFixed(1)}%`,
      tier: g === "poor" ? "Leaky" : g === "average" ? "Average" : "Resistant",
      color: C[g],
      reading:
        rate >= 25
          ? `Roughly one in every ${Math.round(100 / rate)} shots on target ends up in the net — a sign of shaky goalkeeping or defensive structure.`
          : "Turns away a healthy share of shots on target.",
      score: clamp(100 - rate),
    });
  } else missing.push("shots_on_target_against");

  // 6 · Shot suppression
  const shotsAgPg = per(s.shots_against, m);
  if (shotsAgPg != null) {
    const g = grade(20 - shotsAgPg, [12, 8, 6]); // fewer shots = better
    defense.push({
      key: "suppression",
      label: "Shots conceded / game",
      value: shotsAgPg.toFixed(1),
      tier: shotsAgPg >= 13 ? "High pressure" : shotsAgPg >= 10 ? "Moderate" : "Contained",
      color: C[g],
      reading:
        shotsAgPg >= 13
          ? "Concedes excessive shot volume — structural pressure that creates goal vulnerability even against modest attacks."
          : "Keeps opponents to a manageable shot count.",
      score: clamp((20 - shotsAgPg) * 6),
    });
  } else missing.push("shots_against");

  // 7 · Clean-sheet reliability
  const cs = per(s.clean_sheets, m);
  if (cs != null) {
    const rate = cs * 100;
    const g = grade(rate, [45, 33, 22]);
    defense.push({
      key: "clean_sheet",
      label: "Clean-sheet rate",
      value: `${Math.round(rate)}%`,
      tier: g === "poor" ? "Low" : g === "average" ? "Moderate" : "Reliable",
      color: C[g],
      reading:
        g === "poor"
          ? "Rarely keeps a clean sheet — backing this side to win-to-nil or the under carries real risk."
          : "Shuts teams out at a dependable rate.",
      score: clamp(rate),
    });
  }

  // 8 · Big chances against
  const bcaPg = per(s.big_chances_against, m);
  if (bcaPg != null) {
    defense.push({
      key: "bca",
      label: "Big chances conceded / game",
      value: bcaPg.toFixed(2),
      tier: bcaPg >= 0.6 ? "Exposed" : bcaPg >= 0.4 ? "Average" : "Solid",
      color: bcaPg >= 0.6 ? C.poor : bcaPg >= 0.4 ? C.average : C.good,
      reading:
        bcaPg >= 0.6
          ? "Regularly hands opponents clear openings — a live BTTS and over-goals driver."
          : "Limits genuinely clear chances against.",
      score: clamp((1 - bcaPg) * 100),
    });
  }

  // ── Defensive fragility band ──
  let defenseFragility: Band | null = null;
  {
    let pts = 0;
    let n = 0;
    if (shotsAgPg != null) { pts += shotsAgPg >= 13 ? 2 : shotsAgPg >= 10 ? 1 : 0; n++; }
    if (bcaPg != null) { pts += bcaPg >= 0.6 ? 2 : bcaPg >= 0.4 ? 1 : 0; n++; }
    if (cs != null) { pts += cs < 0.22 ? 2 : cs < 0.35 ? 1 : 0; n++; }
    if (dConv != null) { pts += dConv >= 0.25 ? 2 : dConv >= 0.18 ? 1 : 0; n++; }
    if (n >= 2) {
      const ratio = pts / (n * 2);
      defenseFragility = ratio >= 0.6 ? "HIGH" : ratio >= 0.3 ? "MEDIUM" : "LOW";
    }
  }

  // 9 · Discipline risk
  let discipline: PerfInsight | null = null;
  if (has(m) && (has(s.yellow_cards) || has(s.red_cards))) {
    const yPg = per(s.yellow_cards, m) ?? 0;
    const rPg = per(s.red_cards, m) ?? 0;
    const cardsPg = yPg + rPg * 2;
    const g = grade(4 - cardsPg, [2.2, 1.6, 1]); // fewer cards = better
    discipline = {
      key: "discipline",
      label: "Cards / game",
      value: `${(yPg + rPg).toFixed(2)}`,
      tier: cardsPg >= 2.2 ? "High risk" : cardsPg >= 1.6 ? "Elevated" : "Controlled",
      color: cardsPg >= 2.2 ? C.poor : cardsPg >= 1.6 ? C.average : C.good,
      reading:
        cardsPg >= 2
          ? `Averages ${yPg.toFixed(2)} yellows and ${rPg.toFixed(2)} reds a game — a cards-market and late-instability angle.`
          : "Keeps a relatively clean disciplinary record.",
      score: clamp((4 - cardsPg) * 25),
    };
  }

  // 10 · Physical duel profile
  let physical: PerfInsight | null = null;
  if (has(s.duels_won_pct)) {
    const d = s.duels_won_pct as number;
    const g = grade(d, [54, 50, 47]);
    physical = {
      key: "duels",
      label: "Duels won",
      value: `${d.toFixed(1)}%`,
      tier: g === "poor" ? "Second-best" : g === "average" ? "Even" : "Dominant",
      color: C[g],
      reading:
        d < 49
          ? "Loses more physical battles than it wins — vulnerable against direct, aggressive opponents."
          : "Holds its own or better in the physical exchanges.",
      score: clamp(d),
    };
  }

  // ── Style identity ──
  let style: { identity: string; traits: string[] } | null = null;
  {
    const traits: string[] = [];
    const poss = s.avg_possession;
    let identity = "Balanced";
    if (has(poss)) {
      if (poss >= 53) { identity = "Possession-based attack"; traits.push("Controls the ball"); }
      else if (poss < 46) { identity = "Direct transition attack"; traits.push("Low possession, plays on the break"); }
    }
    if (has(s.long_balls_pct) && (s.long_balls_pct as number) >= 40) {
      identity = poss != null && poss < 46 ? "Direct transition attack" : identity;
      traits.push("High long-ball usage");
    }
    if (has(s.crosses_pct)) {
      traits.push((s.crosses_pct as number) < 25 ? "Low cross accuracy" : "Cross-reliant delivery");
    }
    if (has(s.headed_goals) && has(s.goals_scored) && (s.goals_scored as number) > 0) {
      const aerialShare = (s.headed_goals as number) / (s.goals_scored as number);
      traits.push(aerialShare < 0.12 ? "Low aerial threat" : "Real aerial threat");
    }
    if (has(s.left_foot_goals) && has(s.right_foot_goals)) {
      const l = s.left_foot_goals as number, r = s.right_foot_goals as number;
      if (l + r > 0) traits.push(r > l * 1.6 ? "Right-foot dominant" : l > r * 1.6 ? "Left-foot dominant" : "Two-footed threat");
    }
    if (traits.length) style = { identity, traits };
  }

  // ── Derived betting signals ──
  const signals = deriveSignals(s, {
    conv, bcTotal, defenseFragility, shotsAgPg, bcaPg, cs, attackEfficiency,
  });

  return {
    attack, defense, discipline, physical, style,
    attackEfficiency, defenseFragility, signals, missing,
  };
}

// Standalone regression-risk read from a performance delta (actual minus
// expected points). Shared by team_form_quality performance_delta and any
// future team_betting_intelligence sustainability fields.
export function regressionRisk(performanceDelta: number | null): {
  risk: "HIGH" | "MEDIUM" | "LOW";
  label: string;
  reading: string;
} {
  if (performanceDelta == null) {
    return { risk: "MEDIUM", label: "Unknown", reading: "Not enough data to assess sustainability." };
  }
  if (performanceDelta >= 2) {
    return { risk: "HIGH", label: "Over-performing", reading: "Results outpace the underlying numbers — regression is likely." };
  }
  if (performanceDelta <= -2) {
    return { risk: "LOW", label: "Under-performing", reading: "Underlying play is better than the results — improvement looks likely." };
  }
  return { risk: "LOW", label: "Sustainable", reading: "Results track the underlying performance." };
}

function deriveSignals(
  s: TeamSeasonStats,
  d: {
    conv: number | null;
    bcTotal: number | null;
    defenseFragility: Band | null;
    shotsAgPg: number | null;
    bcaPg: number | null;
    cs: number | null;
    attackEfficiency: number | null;
  }
): DerivedSignal[] {
  const out: DerivedSignal[] = [];
  const poorFinishing = d.conv != null && d.conv * 100 < 7;
  const goodCreation =
    (d.bcTotal ?? 0) >= 12 || (s.big_chances_created ?? 0) >= 10;
  const leakyDef = d.defenseFragility === "HIGH" || (d.shotsAgPg ?? 0) >= 12;

  // Over/Under 2.5
  {
    const reasons: { good: boolean; text: string }[] = [];
    let score = 50;
    if (goodCreation) { reasons.push({ good: true, text: "High chance creation" }); score += 12; }
    if (leakyDef) { reasons.push({ good: true, text: "Concedes shots and clear chances freely" }); score += 14; }
    if ((d.bcaPg ?? 0) >= 0.6) { reasons.push({ good: true, text: "Regularly allows big chances" }); score += 8; }
    if (poorFinishing) { reasons.push({ good: false, text: "Poor finishing efficiency" }); score -= 16; }
    if ((d.cs ?? 0) >= 0.4) { reasons.push({ good: false, text: "Keeps clean sheets often" }); score -= 12; }
    if (reasons.length) {
      out.push({
        market: "Over 2.5 Goals",
        group: "goals",
        direction: score >= 58 ? "positive" : score <= 42 ? "negative" : "neutral",
        confidence: clamp(score),
        reasons,
      });
    }
  }

  // BTTS
  {
    const reasons: { good: boolean; text: string }[] = [];
    let score = 50;
    if (goodCreation) { reasons.push({ good: true, text: "Creates enough to score" }); score += 10; }
    if (leakyDef) { reasons.push({ good: true, text: "Concedes regularly" }); score += 14; }
    if (poorFinishing) { reasons.push({ good: false, text: "May fail to convert its chances" }); score -= 12; }
    if ((d.cs ?? 0) >= 0.4) { reasons.push({ good: false, text: "Capable of shutting teams out" }); score -= 12; }
    if (reasons.length) {
      out.push({
        market: "Both Teams To Score",
        group: "btts",
        direction: score >= 58 ? "positive" : score <= 42 ? "negative" : "neutral",
        confidence: clamp(score),
        reasons,
      });
    }
  }

  // Win-market risk (overrated favourite)
  {
    const reasons: { good: boolean; text: string }[] = [];
    const overFinishing = d.conv != null && d.conv * 100 >= 13;
    if (overFinishing) reasons.push({ good: false, text: "Results propped up by unsustainable finishing" });
    if (leakyDef) reasons.push({ good: false, text: "High defensive exposure underneath the results" });
    if (poorFinishing) reasons.push({ good: false, text: "Unreliable in front of goal in tight games" });
    if (reasons.length >= 1 && (overFinishing || (poorFinishing && leakyDef))) {
      out.push({
        market: "Match Result",
        group: "result",
        direction: "avoid",
        confidence: clamp(55 + reasons.length * 8),
        reasons,
      });
    }
  }

  return out;
}
