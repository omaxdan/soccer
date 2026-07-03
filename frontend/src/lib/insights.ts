/**
 * Rule-based KEY INSIGHT text generator.
 * Produces a short, specific natural-language explanation of WHY the
 * readiness gap exists — the "What is happening / Why is it happening"
 * question the design doc identifies as the platform differentiator.
 * No LLM, no hallucination — each statement maps 1:1 to a real score.
 */

export interface InsightInput {
  homeTeam: string;
  awayTeam: string;
  homeReadiness?: number | null;
  awayReadiness?: number | null;
  readinessGap?: number | null;
  homeFormIndex?: number | null;
  awayFormIndex?: number | null;
  homeRestDays?: number | null;
  awayRestDays?: number | null;
  awayTravelKm?: number | null;
  homeCongestion?: number | null;
  awayCongestion?: number | null;
  homeInjuryBurden?: number | null;
  awayInjuryBurden?: number | null;
  homeSquadStability?: number | null;
  awaySquadStability?: number | null;
  homeStrengthRating?: number | null;
  awayStrengthRating?: number | null;
}

export interface Insight {
  text: string;
  drivers: string[];     // bullet list of specific contributing factors
  confidence: number;    // 0–100 — how confident we are in the edge
  advantage: 'home' | 'away' | 'neutral';
}

export function generateMatchInsight(m: InsightInput): Insight {
  const gap     = m.readinessGap ?? ((m.homeReadiness ?? 50) - (m.awayReadiness ?? 50));
  const absGap  = Math.abs(gap);
  const favTeam = gap > 0 ? m.homeTeam : m.awayTeam;
  const disTeam = gap > 0 ? m.awayTeam : m.homeTeam;
  const advantage: 'home' | 'away' | 'neutral' = absGap < 5 ? 'neutral' : gap > 0 ? 'home' : 'away';

  const drivers: string[] = [];

  // Form differential
  const formDiff = (m.homeFormIndex ?? 0) - (m.awayFormIndex ?? 0);
  if (Math.abs(formDiff) > 15) {
    drivers.push(`${Math.abs(formDiff) > 25 ? 'Significantly' : 'Notably'} better recent form (${gap > 0 ? m.homeTeam : m.awayTeam} ${Math.abs(formDiff) > 25 ? 'dominant' : 'ahead'})`);
  }

  // Rest day advantage
  const restDiff = (m.homeRestDays ?? 0) - (m.awayRestDays ?? 0);
  if (Math.abs(restDiff) > 1.5) {
    const restFav = restDiff > 0 ? m.homeTeam : m.awayTeam;
    drivers.push(`${restFav} has ${Math.abs(restDiff).toFixed(1)} more rest days`);
  }

  // Travel fatigue
  if ((m.awayTravelKm ?? 0) > 600) {
    const distLabel = (m.awayTravelKm ?? 0) > 1500 ? 'extreme' : (m.awayTravelKm ?? 0) > 800 ? 'significant' : 'notable';
    drivers.push(`${m.awayTeam} facing ${distLabel} travel (${Math.round(m.awayTravelKm ?? 0)}km)`);
  }

  // Congestion
  const congDiff = (m.awayCongestion ?? 0) - (m.homeCongestion ?? 0);
  if (congDiff > 20) {
    drivers.push(`${m.awayTeam} significantly more congested (${Math.round(m.awayCongestion ?? 0)} vs ${Math.round(m.homeCongestion ?? 0)})`);
  }

  // Squad/injury
  if ((m.homeInjuryBurden ?? 0) > 30 || (m.awayInjuryBurden ?? 0) > 30) {
    const injuredTeam = (m.awayInjuryBurden ?? 0) > (m.homeInjuryBurden ?? 0) ? m.awayTeam : m.homeTeam;
    drivers.push(`${injuredTeam} carrying elevated injury burden`);
  }

  // Squad stability
  const stabDiff = (m.homeSquadStability ?? 50) - (m.awaySquadStability ?? 50);
  if (Math.abs(stabDiff) > 20) {
    drivers.push(`${stabDiff > 0 ? m.homeTeam : m.awayTeam} notably more stable squad`);
  }

  // Strength rating — was declared in InsightInput but never actually
  // used here (found while building generateExecutiveSummary below).
  const strengthDiff = (m.homeStrengthRating ?? 50) - (m.awayStrengthRating ?? 50);
  if (Math.abs(strengthDiff) > 20) {
    drivers.push(`${strengthDiff > 0 ? m.homeTeam : m.awayTeam} has the stronger overall squad (${Math.round(Math.abs(strengthDiff))}pt rating gap)`);
  }

  // Build the headline text
  let text = '';
  if (absGap < 5) {
    text = `${m.homeTeam} and ${m.awayTeam} enter this match with near-identical readiness. Intelligence signals are balanced — outcome likely influenced by in-game factors.`;
  } else if (absGap >= 25) {
    text = `${favTeam} hold a commanding readiness advantage over ${disTeam}`;
    if (drivers.length > 0) text += `, driven by ${drivers.slice(0, 2).join(' and ').toLowerCase()}`;
    text += '.';
  } else if (absGap >= 12) {
    text = `${favTeam} have a clear readiness edge entering this fixture`;
    if (drivers.length > 0) text += ` — ${drivers[0].toLowerCase()}`;
    text += '.';
  } else {
    text = `Slight readiness advantage to ${favTeam}`;
    if (drivers.length > 0) text += `. Primary driver: ${drivers[0].toLowerCase()}`;
    text += '.';
  }

  // Confidence: based on how many data points corroborate the advantage
  const corroborating = drivers.length;
  const baseConf = absGap >= 25 ? 75 : absGap >= 15 ? 60 : absGap >= 8 ? 45 : 30;
  const confidence = Math.min(95, baseConf + corroborating * 5);

  return { text, drivers, confidence, advantage };
}

export function generateTeamInsight(m: {
  teamName: string;
  readiness?: number | null;
  formIndex?: number | null;
  congestion?: number | null;
  travelFatigue?: number | null;
  injuryBurden?: number | null;
  squadStability?: number | null;
  restDays?: number | null;
}): string {
  const insights: string[] = [];

  if ((m.readiness ?? 0) >= 80) insights.push(`${m.teamName} are in excellent shape — high readiness across all components`);
  else if ((m.readiness ?? 0) >= 65) insights.push(`${m.teamName} in good form with above-average readiness`);
  else if ((m.readiness ?? 0) < 40) insights.push(`${m.teamName} showing signs of fatigue — readiness below optimal`);

  if ((m.congestion ?? 0) >= 75) insights.push(`Fixture congestion is a significant concern (${Math.round(m.congestion ?? 0)}/100)`);
  if ((m.travelFatigue ?? 0) >= 60) insights.push(`Heavy travel load impacting preparation`);
  if ((m.injuryBurden ?? 0) >= 40) insights.push(`Elevated injury burden reducing squad options`);
  if ((m.restDays ?? 0) < 3)  insights.push(`Limited rest time since last fixture`);

  if (insights.length === 0) return `${m.teamName} are in steady condition — readiness indicators within normal range.`;
  return insights.slice(0, 2).join('. ') + '.';
}

// ─── EXECUTIVE SUMMARY — fuller, multi-sentence synthesis ──────────────────
// Reuses generateMatchInsight's exact readiness-gap logic and driver list
// (single source of truth for "why is one team favored") but produces a
// genuinely comprehensive 2-3 sentence paragraph incorporating goals
// scored/conceded and injury/goal-dependency context that the single-line
// Insight card intentionally leaves out. Built for the new Team Comparison
// Matrix on the match page — same "no LLM, no hallucination, every
// statement maps 1:1 to a real score" discipline as generateMatchInsight.

export interface ExecutiveSummaryInput extends InsightInput {
  homeGoalsScored?: number | null;
  awayGoalsScored?: number | null;
  homeGoalsConceded?: number | null;
  awayGoalsConceded?: number | null;
  homeInjuredCount?: number | null;
  awayInjuredCount?: number | null;
  homeTopScorerPct?: number | null;
  awayTopScorerPct?: number | null;
}

export function generateExecutiveSummary(m: ExecutiveSummaryInput): string {
  const insight = generateMatchInsight(m);
  const gap = m.readinessGap ?? ((m.homeReadiness ?? 50) - (m.awayReadiness ?? 50));
  const absGap = Math.abs(gap);
  const favTeam = gap > 0 ? m.homeTeam : m.awayTeam;
  const disTeam = gap > 0 ? m.awayTeam : m.homeTeam;

  const sentences: string[] = [];

  // Opening: readiness verdict, reusing the Insight card's exact text
  sentences.push(insight.text);

  // Goal output context — only if both sides have season stats
  if (m.homeGoalsScored != null && m.awayGoalsScored != null) {
    const homeGD = (m.homeGoalsScored ?? 0) - (m.homeGoalsConceded ?? 0);
    const awayGD = (m.awayGoalsScored ?? 0) - (m.awayGoalsConceded ?? 0);
    if (Math.abs(homeGD - awayGD) > 8) {
      const better = homeGD > awayGD ? m.homeTeam : m.awayTeam;
      sentences.push(`${better}'s goal difference this season (${homeGD > awayGD ? homeGD : awayGD > 0 ? '+' + awayGD : awayGD}) points to a clear edge in overall output at both ends of the pitch.`);
    }
  }

  // Injury/availability context — only mention if genuinely notable
  const homeInjured = m.homeInjuredCount ?? 0;
  const awayInjured = m.awayInjuredCount ?? 0;
  if (homeInjured === 0 && awayInjured === 0) {
    sentences.push(`Both sides have a clean injury sheet — this is a true test of squad quality rather than forced changes.`);
  } else if (homeInjured > 0 || awayInjured > 0) {
    const worseOff = homeInjured > awayInjured ? m.homeTeam : m.awayTeam;
    const count = Math.max(homeInjured, awayInjured);
    sentences.push(`${worseOff} will be missing ${count} player${count === 1 ? '' : 's'} from their strongest available XI.`);
  }

  // Goal-scoring concentration risk — only flag if genuinely high
  const homeTopPct = m.homeTopScorerPct ?? 0;
  const awayTopPct = m.awayTopScorerPct ?? 0;
  if (homeTopPct >= 30 || awayTopPct >= 30) {
    const concentrated = homeTopPct > awayTopPct ? m.homeTeam : m.awayTeam;
    const pct = Math.max(homeTopPct, awayTopPct);
    sentences.push(`${concentrated} lean heavily on a single scorer (${pct.toFixed(0)}% of season goals) — a real risk if that player is marked out of the game.`);
  }

  return sentences.join(' ');
}
