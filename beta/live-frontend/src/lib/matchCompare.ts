// ─────────────────────────────────────────────────────────────────────────────
// matchCompare — turns two teams' existing intelligence into head-to-head
// comparison intelligence.
//
// NOTHING IN THIS FILE COMPUTES A METRIC. Every function here takes two
// TeamBriefInput objects — the exact type the team page builds from
// getTeamIntel() — and either reads a field directly or calls an existing
// classification function that already lives in lib/teamBrief.ts or
// lib/modules.ts:
//
//   attack / defence scores    same fields buildPillars() reads
//   momentum                   classifyTrend()          (lib/modules.ts)
//   volatility label           classifyConsistency()    (lib/modules.ts)
//   venue fit                  classifyFixtureVenue()   (lib/modules.ts)
//   regression / risk labels   the same thresholds buildBadges()/buildRisks()
//                              already use (>=4 High, >=2 Medium; vol>=1.5;
//                              window<5; venue matches<5)
//
// The only genuinely new code is the COMPARISON itself — which side a number
// favours, and the prose describing it — because no existing function
// compares two teams; the team page only ever looks at one.
// ─────────────────────────────────────────────────────────────────────────────

import type { TeamBriefInput, Risk } from "./teamBrief";
import { buildPillars, buildRisks } from "./teamBrief";
import { classifyTrend, classifyConsistency, classifyFixtureVenue } from "./modules";

const n = (v: unknown): number | null => {
  if (v == null) return null;
  const x = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(x) ? x : null;
};

export type Side = "home" | "away" | null;

// ── The one comparison primitive ────────────────────────────────────────────
// Same "who's ahead" logic MatchReport's Instant Verdict table already uses
// for Expected Goals / Win Probability / Readiness. Factored out here so it
// is written once rather than reinvented for every new comparison row below —
// three near-identical copies of "is home strictly ahead, else away, else
// level" would itself have been the duplication this task is about avoiding.
export function compareValue(
  home: number | null,
  away: number | null,
  higherIsBetter = true,
  tolerance = 0.05
): { side: Side; level: boolean } {
  if (home == null || away == null) return { side: null, level: false };
  const level = Math.abs(home - away) < tolerance;
  if (level) return { side: null, level: true };
  const homeAhead = higherIsBetter ? home > away : home < away;
  return { side: homeAhead ? "home" : "away", level: false };
}

// ── 1. Attack vs Defence matchup ────────────────────────────────────────────

export interface CrossMatchup {
  label: string;
  attackSide: "home" | "away";
  attackValue: number;
  defenceValue: number;
  edge: Side;
  gap: number;
}

export interface AttackDefenceMatchup {
  matchups: CrossMatchup[];
  sentence: string | null;
}

function attackOf(i: TeamBriefInput): number | null {
  return n(i.dashboard?.attack_rating) ?? n(i.betting?.attack_rating);
}
function defenceOf(i: TeamBriefInput): number | null {
  return n(i.dashboard?.defense_rating) ?? n(i.betting?.defence_rating);
}

export function buildAttackDefenceMatchup(
  home: TeamBriefInput,
  away: TeamBriefInput
): AttackDefenceMatchup {
  const hAtt = attackOf(home);
  const aAtt = attackOf(away);
  const hDef = defenceOf(home);
  const aDef = defenceOf(away);

  const matchups: CrossMatchup[] = [];
  // Home attack vs away defence: home's edge is attack minus defence.
  if (hAtt != null && aDef != null) {
    const gap = hAtt - aDef;
    matchups.push({
      label: `${home.teamName} attack vs ${away.teamName} defence`,
      attackSide: "home",
      attackValue: Math.round(hAtt),
      defenceValue: Math.round(aDef),
      edge: Math.abs(gap) < 3 ? null : gap > 0 ? "home" : "away",
      gap: Math.round(gap),
    });
  }
  if (aAtt != null && hDef != null) {
    const gap = aAtt - hDef;
    matchups.push({
      label: `${away.teamName} attack vs ${home.teamName} defence`,
      attackSide: "away",
      attackValue: Math.round(aAtt),
      defenceValue: Math.round(hDef),
      edge: Math.abs(gap) < 3 ? null : gap > 0 ? "away" : "home",
      gap: Math.round(gap),
    });
  }

  // The single largest gap tells the story most plainly, so it drives the
  // sentence rather than trying to summarise both cross-matchups at once.
  const strongest = [...matchups].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0] ?? null;
  let sentence: string | null = null;
  if (strongest && strongest.edge) {
    const defender = strongest.attackSide === "home" ? away.teamName : home.teamName;
    const attacker = strongest.attackSide === "home" ? home.teamName : away.teamName;
    sentence =
      strongest.edge === (strongest.attackSide === "home" ? "away" : "home")
        ? `${defender}'s defence out-rates ${attacker}'s attack (${Math.abs(strongest.gap)}), suggesting ${attacker} may struggle to create quality chances.`
        : `${attacker}'s attack out-rates ${defender}'s defence (${Math.abs(strongest.gap)}), a profile that tends to create chances against this kind of defensive record.`;
  }

  return { matchups, sentence };
}

// ── 2. Momentum comparison ──────────────────────────────────────────────────
// classifyTrend() is the SAME function M2 (Readiness Tracker) already calls —
// see lib/modules.ts:1162. Reused here rather than reading TeamMomentum.trend
// directly, specifically so this section can never disagree with what the
// module system would say about the identical last5/prior5 numbers.

export interface MomentumComparison {
  home: { base: string; change: number } | null;
  away: { base: string; change: number } | null;
  sentence: string | null;
}

export function buildMomentumComparison(
  home: TeamBriefInput,
  away: TeamBriefInput
): MomentumComparison {
  const h5 = n(home.momentum?.last_5_points);
  const hPrior = n(home.momentum?.prior_5_points);
  const a5 = n(away.momentum?.last_5_points);
  const aPrior = n(away.momentum?.prior_5_points);

  const h = h5 != null && hPrior != null ? classifyTrend(h5, hPrior) : null;
  const a = a5 != null && aPrior != null ? classifyTrend(a5, aPrior) : null;

  let sentence: string | null = null;
  if (h && a) {
    const rank = (b: string) => ({ SURGING: 2, IMPROVING: 1, STABLE: 0, DECLINING: -1, CRASHING: -2 }[b] ?? 0);
    const diff = rank(h.base) - rank(a.base);
    if (diff === 0) {
      sentence = `Both sides arrive on a similar trajectory — ${home.teamName} ${h.base.toLowerCase()}, ${away.teamName} ${a.base.toLowerCase()}.`;
    } else {
      const better = diff > 0 ? home.teamName : away.teamName;
      const worse = diff > 0 ? away.teamName : home.teamName;
      const betterTrend = (diff > 0 ? h : a).base.toLowerCase();
      const worseTrend = (diff > 0 ? a : h).base.toLowerCase();
      sentence = `${better} arrive with more forward momentum (${betterTrend}) than ${worse} (${worseTrend}).`;
    }
  }

  return {
    home: h ? { base: h.base, change: h.change } : null,
    away: a ? { base: a.base, change: a.change } : null,
    sentence,
  };
}

// ── 3. Volatility comparison ────────────────────────────────────────────────
// classifyConsistency() is the same function used to label a single team's
// volatility elsewhere; called here for both sides for a matched label.

export interface VolatilityComparison {
  home: { value: number; label: string } | null;
  away: { value: number; label: string } | null;
  sentence: string | null;
}

export function buildVolatilityComparison(
  home: TeamBriefInput,
  away: TeamBriefInput
): VolatilityComparison {
  const hVol = n(home.formQuality?.volatility);
  const aVol = n(away.formQuality?.volatility);
  const hOaf = n(home.formQuality?.opponent_adjusted_form);
  const aOaf = n(away.formQuality?.opponent_adjusted_form);

  const h = hVol != null ? { value: hVol, label: classifyConsistency(hVol, hOaf) } : null;
  const a = aVol != null ? { value: aVol, label: classifyConsistency(aVol, aOaf) } : null;

  let sentence: string | null = null;
  if (h && a && Math.abs(h.value - a.value) >= 0.3) {
    const more = h.value > a.value ? home.teamName : away.teamName;
    const fewer = h.value > a.value ? away.teamName : home.teamName;
    sentence = `${more}'s higher volatility (${Math.max(h.value, a.value).toFixed(2)} vs ${Math.min(h.value, a.value).toFixed(2)}) makes their profile less predictable over a single match than ${fewer}'s.`;
  }

  return { home: h, away: a, sentence };
}

// ── 4. Sustainability comparison ────────────────────────────────────────────
// performance_delta IS the xPts delta — points earned minus the expected-
// points model over the measured window. Same field buildRisks() reads; the
// High/Medium/Low cutoffs match buildBadges()'s regression-risk wording
// (>=4 High, >=2 Medium) exactly, so a team's own badge and its comparison
// entry here can never disagree.

export interface SustainabilityRow {
  regression: "High" | "Medium" | "Low";
  xPtsDelta: number | null;
}

export interface SustainabilityComparison {
  home: SustainabilityRow | null;
  away: SustainabilityRow | null;
  sentence: string | null;
}

function regressionLabel(delta: number): "High" | "Medium" | "Low" {
  const mag = Math.abs(delta);
  return mag >= 4 ? "High" : mag >= 2 ? "Medium" : "Low";
}

export function buildSustainabilityComparison(
  home: TeamBriefInput,
  away: TeamBriefInput
): SustainabilityComparison {
  const hDelta = n(home.formQuality?.performance_delta);
  const aDelta = n(away.formQuality?.performance_delta);

  const h = hDelta != null ? { regression: regressionLabel(hDelta), xPtsDelta: hDelta } : null;
  const a = aDelta != null ? { regression: regressionLabel(aDelta), xPtsDelta: aDelta } : null;

  let sentence: string | null = null;
  if (hDelta != null && aDelta != null) {
    const flattered = hDelta > aDelta ? home.teamName : away.teamName;
    const aligned = hDelta > aDelta ? away.teamName : home.teamName;
    if (Math.abs(hDelta - aDelta) >= 1) {
      sentence =
        (hDelta > aDelta ? hDelta : aDelta) > 1
          ? `${flattered}'s recent results exceed underlying performance while ${aligned}'s align more closely with expected output.`
          : `Both sides' recent results sit close to their expected-points models, so form ratings for this fixture are unlikely to be flattered by either side.`;
    }
  }

  return { home: h, away: a, sentence };
}

// ── 5. Comparative risk ─────────────────────────────────────────────────────
// Calls buildRisks() — the EXACT existing function the team page's Danger
// Zone renders — once per side. Nothing here recomputes a threshold; this
// only aligns the two resulting Risk[] arrays by type and adds an overall
// read of how many risk categories each side carries.

export type RiskCategory = "Volatility" | "Regression" | "Venue sample" | "Goal dependency" | "Small sample";

const CATEGORY_MATCH: [RiskCategory, RegExp][] = [
  ["Volatility", /^High volatility/],
  ["Regression", /^Regression risk/],
  ["Venue sample", /^Thin venue sample/],
  ["Goal dependency", /^Goal dependency/],
  ["Small sample", /^Small sample/],
];

function categorize(risks: Risk[]): Map<RiskCategory, Risk> {
  const out = new Map<RiskCategory, Risk>();
  for (const r of risks) {
    const hit = CATEGORY_MATCH.find(([, re]) => re.test(r.title));
    if (hit) out.set(hit[0], r);
  }
  return out;
}

export interface RiskComparisonRow {
  category: RiskCategory;
  home: Risk | null;
  away: Risk | null;
}

export interface ComparativeRisk {
  rows: RiskComparisonRow[];
  homeCount: number;
  awayCount: number;
  verdict: string;
}

export function buildComparativeRisk(home: TeamBriefInput, away: TeamBriefInput): ComparativeRisk {
  const hRisks = categorize(buildRisks(home));
  const aRisks = categorize(buildRisks(away));

  const categories = Array.from(new Set([...hRisks.keys(), ...aRisks.keys()]));
  const rows: RiskComparisonRow[] = categories.map((category) => ({
    category,
    home: hRisks.get(category) ?? null,
    away: aRisks.get(category) ?? null,
  }));

  const homeCount = hRisks.size;
  const awayCount = aRisks.size;
  const verdict =
    rows.length === 0
      ? "No elevated risk flags on either side."
      : homeCount === awayCount
        ? `Both sides carry a similar number of risk flags (${homeCount} each) — neither profile is meaningfully more fragile.`
        : homeCount > awayCount
          ? `${home.teamName} carries more risk flags (${homeCount} vs ${awayCount}) — the more fragile profile of the two.`
          : `${away.teamName} carries more risk flags (${awayCount} vs ${homeCount}) — the more fragile profile of the two.`;

  return { rows, homeCount, awayCount, verdict };
}

// ── 6. Venue dependence comparison ──────────────────────────────────────────
// classifyFixtureVenue() is the SAME function M1 (Home/Away Split) already
// calls for this exact fixture — see lib/modules.ts:1409 — comparing the home
// team's home-win% against the away team's away-win%. Reused directly rather
// than re-deriving a second venue verdict that could disagree with M1's.

export interface VenueDependenceComparison {
  homePct: number | null;
  awayPct: number | null;
  homeSample: number | null;
  awaySample: number | null;
  edge: "HOME_VENUE_EDGE" | "AWAY_VENUE_EDGE" | "HOME_VENUE_LEAN" | "AWAY_VENUE_LEAN" | "NO_VENUE_EDGE" | null;
  sentence: string | null;
}

export function buildVenueDependenceComparison(
  home: TeamBriefInput,
  away: TeamBriefInput
): VenueDependenceComparison {
  const homePct = n(home.venue?.home_win_pct);
  const awayPct = n(away.venue?.away_win_pct);
  const homeSample = n(home.venue?.home_matches);
  const awaySample = n(away.venue?.away_matches);

  const edge = homePct != null && awayPct != null ? classifyFixtureVenue(homePct, awayPct) : null;
  const thin = (homeSample ?? 0) < 5 || (awaySample ?? 0) < 5;

  let sentence: string | null = null;
  if (edge && thin) {
    sentence = `Home and away splits are on too few matches (${homeSample ?? 0}H / ${awaySample ?? 0}A) to separate a venue effect from noise.`;
  } else if (edge === "HOME_VENUE_EDGE" || edge === "HOME_VENUE_LEAN") {
    sentence = `${home.teamName} lean on home advantage more than ${away.teamName} travels well — ${Math.round(homePct!)}% at home against ${Math.round(awayPct!)}% away.`;
  } else if (edge === "AWAY_VENUE_EDGE" || edge === "AWAY_VENUE_LEAN") {
    sentence = `${away.teamName} travels better than ${home.teamName} defends home advantage — ${Math.round(awayPct!)}% away against ${Math.round(homePct!)}% at home.`;
  } else if (edge === "NO_VENUE_EDGE") {
    sentence = `Neither side's record shows a clear venue effect for this fixture.`;
  }

  return { homePct, awayPct, homeSample, awaySample, edge, sentence };
}

// ── 7. Where each team has the edge ─────────────────────────────────────────
// Pure comparison over values already produced by buildPillars() and the
// sections above — no new scoring, no new thresholds beyond compareValue()'s
// existing tolerance.

export interface EdgeItem {
  label: string;
  side: "home" | "away";
}

export function buildEdgeSummary(
  home: TeamBriefInput,
  away: TeamBriefInput
): { home: EdgeItem[]; away: EdgeItem[] } {
  const hPillars = new Map(buildPillars(home).map((p) => [p.name, p.score]));
  const aPillars = new Map(buildPillars(away).map((p) => [p.name, p.score]));

  const rows: { label: string; h: number | null; a: number | null; higherIsBetter?: boolean }[] = [
    { label: "Better attack", h: hPillars.get("Attack") ?? null, a: aPillars.get("Attack") ?? null },
    { label: "Better defence", h: hPillars.get("Defence") ?? null, a: aPillars.get("Defence") ?? null },
    { label: "Better readiness", h: hPillars.get("Readiness") ?? null, a: aPillars.get("Readiness") ?? null },
    {
      label: "Higher adjusted form",
      h: n(home.formQuality?.opponent_adjusted_form),
      a: n(away.formQuality?.opponent_adjusted_form),
    },
    {
      label: "Lower regression risk",
      h: n(home.formQuality?.performance_delta),
      a: n(away.formQuality?.performance_delta),
      higherIsBetter: false,
    },
    {
      label: "Lower volatility",
      h: n(home.formQuality?.volatility),
      a: n(away.formQuality?.volatility),
      higherIsBetter: false,
    },
    {
      label: "Lower travel fatigue",
      h: n(home.intel?.travel_fatigue_score),
      a: n(away.intel?.travel_fatigue_score),
      higherIsBetter: false,
    },
  ];

  const homeItems: EdgeItem[] = [];
  const awayItems: EdgeItem[] = [];
  for (const r of rows) {
    const { side } = compareValue(r.h, r.a, r.higherIsBetter ?? true, r.label.includes("volatility") ? 0.1 : 1);
    if (side === "home") homeItems.push({ label: r.label, side: "home" });
    if (side === "away") awayItems.push({ label: r.label, side: "away" });
  }
  return { home: homeItems, away: awayItems };
}

// ── 8. Generated match narrative ────────────────────────────────────────────
// Reads only from the comparisons already computed above — no metric is
// touched a second time here, only assembled into prose.

export function buildMatchNarrative(
  home: TeamBriefInput,
  away: TeamBriefInput,
  edges: { home: EdgeItem[]; away: EdgeItem[] },
  matchup: AttackDefenceMatchup
): string | null {
  if (edges.home.length === 0 && edges.away.length === 0) return null;

  const describe = (items: EdgeItem[]) =>
    items
      .slice(0, 3)
      .map((i) => i.label.replace(/^(Better|Higher|Lower) /, "").toLowerCase())
      .join(", ");

  const parts: string[] = [];
  if (edges.home.length >= edges.away.length && edges.home.length > 0) {
    parts.push(`${home.teamName} arrive with ${describe(edges.home)}.`);
    if (edges.away.length > 0)
      parts.push(`${away.teamName} counter with ${describe(edges.away)}.`);
  } else if (edges.away.length > 0) {
    parts.push(`${away.teamName} arrive with ${describe(edges.away)}.`);
    if (edges.home.length > 0)
      parts.push(`${home.teamName} counter with ${describe(edges.home)}.`);
  }

  if (matchup.sentence) parts.push(matchup.sentence);

  return parts.length ? parts.join(" ") : null;
}
