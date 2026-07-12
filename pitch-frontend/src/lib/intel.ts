import type {
  MatchRow,
  RiskBand,
  SignalDirection,
  ScorelineProb,
  TeamGoalDependency,
} from "./types";

// ── Numeric formatting ───────────────────────────────────
export const n0 = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : Math.round(v).toString();

export const n1 = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : v.toFixed(1);

export const pct = (v: number | null | undefined) => {
  if (v == null || Number.isNaN(v)) return "—";
  const scaled = v <= 1 ? v * 100 : v;
  return `${Math.round(scaled)}%`;
};

export const km = (v: number | null | undefined) =>
  v == null ? "—" : v <= 1 ? "0 km" : `${Math.round(v).toLocaleString()} km`;

export function money(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${Math.round(v / 1_000)}K`;
  return `€${v}`;
}

// ── Score / probability normalization ────────────────────
export function normProb(v: number | null | undefined): number {
  if (v == null) return 0;
  return v <= 1 ? v * 100 : v;
}

export function normScorelines(raw: ScorelineProb[] | null): ScorelineProb[] {
  if (!raw || raw.length === 0) return [];
  return [...raw]
    .map((s) => ({ ...s, probability: normProb(s.probability) }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 5);
}

// ── Date / kickoff ───────────────────────────────────────
export function kickoff(dateStr: string): { day: string; time: string; rel: string } {
  const d = new Date(dateStr);
  const now = new Date();
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const diffH = (d.getTime() - now.getTime()) / 36e5;
  let rel = "";
  if (diffH < -3) rel = "FT";
  else if (diffH < 0) rel = "LIVE";
  else if (diffH < 1) rel = `${Math.round(diffH * 60)}m`;
  else if (diffH < 24) rel = `${Math.round(diffH)}h`;
  else rel = `${Math.round(diffH / 24)}d`;
  return { day, time, rel };
}

// ── Semantic colour for scores ───────────────────────────
export function readinessTier(v: number | null | undefined) {
  if (v == null) return { label: "—", color: "var(--muted)" };
  if (v >= 82) return { label: "Elite", color: "var(--edge)" };
  if (v >= 68) return { label: "Strong", color: "var(--edge)" };
  if (v >= 52) return { label: "Average", color: "var(--warn)" };
  return { label: "Depleted", color: "var(--risk)" };
}

export function fatigueTier(v: number | null | undefined) {
  if (v == null) return { label: "—", color: "var(--muted)" };
  if (v >= 65) return { label: "Heavy", color: "var(--risk)" };
  if (v >= 40) return { label: "Moderate", color: "var(--warn)" };
  return { label: "Fresh", color: "var(--edge)" };
}

export function riskColor(band: RiskBand | null | undefined): string {
  if (band === "HIGH") return "var(--risk)";
  if (band === "MEDIUM") return "var(--warn)";
  if (band === "LOW") return "var(--edge)";
  return "var(--muted)";
}

export function opportunityColor(score: number | null | undefined): string {
  if (score == null) return "var(--muted)";
  if (score >= 70) return "var(--edge)";
  if (score >= 45) return "var(--amber)";
  return "var(--muted)";
}

// Directional glyph + colour for a market signal ledger row
export function directionStyle(dir: SignalDirection): {
  glyph: string;
  color: string;
  word: string;
} {
  switch (dir) {
    case "home":
      return { glyph: "◤", color: "var(--edge)", word: "HOME LEAN" };
    case "away":
      return { glyph: "◥", color: "var(--cool)", word: "AWAY LEAN" };
    case "avoid":
      return { glyph: "✕", color: "var(--risk)", word: "AVOID" };
    default:
      return { glyph: "─", color: "var(--muted)", word: "NEUTRAL" };
  }
}

// ── Executive lean derived from win probabilities ────────
export function bestLean(m: MatchRow): { pick: string; conf: number } | null {
  const i = m.intel;
  if (!i) return null;
  const h = normProb(i.win_probability_home);
  const d = normProb(i.win_probability_draw);
  const a = normProb(i.win_probability_away);
  if (h === 0 && d === 0 && a === 0) return null;
  const home = m.home.short_name || m.home.name;
  const away = m.away.short_name || m.away.name;
  const conf = normProb(i.confidence_score);
  if (h >= a && h - a >= 12) return { pick: `${home} Draw No Bet`, conf };
  if (a > h && a - h >= 12) return { pick: `${away} Draw No Bet`, conf };
  if (h + d >= 70) return { pick: `${home} Double Chance`, conf };
  if (a + d >= 70) return { pick: `${away} Double Chance`, conf };
  const total =
    (i.predicted_home_goals ?? 0) + (i.predicted_away_goals ?? 0);
  if (total >= 2.8) return { pick: "Over 2.5 Goals", conf };
  if (total > 0 && total <= 2.1) return { pick: "Under 2.5 Goals", conf };
  return { pick: "No clear market edge", conf };
}

// ── Stat → intelligence conversions (per product spec) ───
export function conversionRate(goals: number, shots: number): number | null {
  if (!shots) return null;
  return (goals / shots) * 100;
}

export function finishingVerdict(rate: number | null): {
  label: string;
  color: string;
} {
  if (rate == null) return { label: "—", color: "var(--muted)" };
  if (rate >= 13) return { label: "Elite finishing", color: "var(--edge)" };
  if (rate >= 9) return { label: "Efficient", color: "var(--edge)" };
  if (rate >= 6) return { label: "Average finishing", color: "var(--warn)" };
  return { label: "Poor finishing", color: "var(--risk)" };
}

export function dependencyVerdict(dep: TeamGoalDependency | null | undefined): {
  label: string;
  color: string;
  pct: number | null;
} {
  const p = dep?.top_scorer_pct ?? null;
  if (p == null) return { label: "—", color: "var(--muted)", pct: null };
  const scaled = p <= 1 ? p * 100 : p;
  if (scaled >= 40)
    return { label: "Extreme dependency", color: "var(--risk)", pct: scaled };
  if (scaled >= 28)
    return { label: "High dependency", color: "var(--warn)", pct: scaled };
  return { label: "Distributed threat", color: "var(--edge)", pct: scaled };
}

export function clamp(v: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

export function difficultyBand(score: number | null | undefined): { label: string; color: string } {
  if (score == null) return { label: "Unknown", color: "var(--faint)" };
  if (score < 40) return { label: "Easy", color: "var(--edge)" };
  if (score < 58) return { label: "Medium", color: "var(--warn)" };
  if (score < 72) return { label: "Hard", color: "var(--coral, var(--risk))" };
  return { label: "Very Hard", color: "var(--risk)" };
}

export function positionLabel(code: string): string {
  const c = code.toUpperCase();
  if (c.startsWith("G")) return "Goalkeepers";
  if (c.startsWith("D")) return "Defenders";
  if (c.startsWith("M")) return "Midfielders";
  if (c.startsWith("F") || c.startsWith("A")) return "Attackers";
  return code;
}

// HT/FT combination label from the four terminal-state probabilities.
export function htFtLabel(
  hh: number | null, dh: number | null, dd: number | null, aa: number | null
): string {
  const probs = [
    { value: hh, label: "Home/Home" },
    { value: dh, label: "Draw/Home" },
    { value: dd, label: "Draw/Draw" },
    { value: aa, label: "Away/Away" },
  ].filter((p) => p.value != null) as { value: number; label: string }[];
  if (probs.length === 0) return "No Edge";
  const top = probs.sort((a, b) => b.value - a.value)[0];
  if (top.value < 20) return "No Edge";
  return `${top.label} (${Math.round(top.value)}%)`;
}

// Generic 0-100 confidence banding for market-evidence style displays.
export function confidenceBand(score: number | null | undefined): { label: string; color: string } {
  if (score == null) return { label: "UNKNOWN", color: "var(--muted)" };
  if (score >= 70) return { label: "HIGH", color: "var(--edge)" };
  if (score >= 55) return { label: "MODERATE", color: "var(--warn)" };
  return { label: "LOW", color: "var(--faint)" };
}

// Signal strength (1..6 in this warehouse) to a short descriptive label.
export function signalStrengthLabel(strength: number | null | undefined): string {
  const s = strength ?? 0;
  if (s >= 6) return "Very strong";
  if (s >= 5) return "Strong";
  if (s >= 3) return "Moderate";
  if (s >= 1) return "Weak";
  return "Very weak";
}
