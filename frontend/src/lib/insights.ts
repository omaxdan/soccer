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

// ─── ROLE DERIVATION — rule-based, deterministic ────────────────────────────
// Classifies a key player's role from real stats (position + goals/assists),
// matching the source document's "🎯 Playmaker / 🛡️ Defensive Anchor /
// 🧤 Key Goalkeeper / 🔥 Main Attacker" labels — every label maps 1:1 to a
// real stat threshold, never inferred/hallucinated.

// ─── PLAYER CATEGORY — KEY PLAYER / REGULAR STARTER / SQUAD PLAYER ─────────
// The three-tier classification concept from the source match-preview
// documents (Block 6/9's player_category) — but NOT their thresholds
// (>=70 Key Player, >=40 Regular Starter). Those were calibrated against
// that document's own double-scaling bug, which inflated scores into the
// hundreds; this codebase's real, correctly-scaled importance_score
// realistically tops out far lower — the highest ever actually observed
// in this codebase's data was Fitzgerald at 26.8%, and a theoretical
// best-case all-around outfield star (35% of goals AND assists, 95% of
// minutes, elite quality) tops out around 66 under the real formula.
// Recalibrated to that real range: REGULAR STARTER matches the existing
// 16% "worth listing at all" threshold used elsewhere (getMatchKeyPlayers'
// minImportance) rather than introducing a second, disconnected number;
// KEY PLAYER is reserved for genuinely elite real performers at
// Fitzgerald-tier or above.
export function deriveCategory(importance: number): { label: string; color: 'green' | 'amber' | 'muted' } {
  if (importance >= 25) return { label: 'KEY PLAYER', color: 'green' };
  if (importance >= 16) return { label: 'REGULAR STARTER', color: 'amber' };
  return { label: 'SQUAD PLAYER', color: 'muted' };
}

// ─── MATCH RISK — Low / Medium / High ───────────────────────────────────────
// Derived from the confidence engine already built (migration 016's
// evidence-agreement score) — NOT a new, independent metric. "Risk" here
// means "how predictable is this outcome", which is exactly what
// confidence_score already measures: how strongly the independent
// evidence streams agree. Reusing it under this label rather than
// inventing a second, disconnected number for the same underlying
// question. Falls back to a null-confidence default (never LOW without
// real evidence behind it) rather than guessing.
export function deriveMatchRisk(confidence: number | null, readinessGapAbs: number | null): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (confidence == null) {
    return (readinessGapAbs != null && readinessGapAbs >= 8) ? 'MEDIUM' : 'HIGH';
  }
  if (confidence >= 70) return 'LOW';
  if (confidence >= 55) return 'MEDIUM';
  return 'HIGH';
}

export function deriveRole(positionCode: string, goals: number, assists: number): { emoji: string; label: string } {
  if (positionCode === 'GK') return { emoji: '🧤', label: 'Key Goalkeeper' };
  if (positionCode === 'DEF') {
    if (goals + assists >= 3) return { emoji: '⚔️', label: 'Attacking Threat' };
    return { emoji: '🛡️', label: 'Defensive Anchor' };
  }
  if (positionCode === 'MID') {
    if (assists > goals && assists >= 2) return { emoji: '🎯', label: 'Playmaker' };
    if (goals >= 3) return { emoji: '🏆', label: 'Goal-Scoring Midfielder' };
    return { emoji: '🏆', label: 'Key Midfielder' };
  }
  // FWD
  if (goals >= 5) return { emoji: '🔥', label: 'Main Attacker' };
  return { emoji: '⚡', label: 'Forward' };
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

// ─── NARRATIVE THREADS — numbered story points ─────────────────────────────
// The "Key Narrative Threads" block from the source match-preview
// documents this whole feature was built from — explicit ask to include
// this more faithfully rather than only the condensed executive summary.
// Each thread only fires when its underlying gap is genuinely notable
// (same discipline as generateExecutiveSummary's concentration-risk
// sentence) — six weak threads are noise, not insight; this is meant to
// surface only the storylines that actually matter for THIS match.

export interface NarrativeKeyPlayer {
  name: string;
  positionCode: string;
  importance: number;
  goals: number;
  assists: number;
}

export interface NarrativeThreadsInput extends ExecutiveSummaryInput {
  homeLast5Points?: number | null;
  awayLast5Points?: number | null;
  homeVenueAdvantage?: number | null;
  awayVenueAdvantage?: number | null; // the AWAY side's OWN away-form venue score, not the inverse of home's
  homeTopScorerName?: string | null;
  awayTopScorerName?: string | null;
  homeTopScorerGoals?: number | null;
  awayTopScorerGoals?: number | null;
  /** Every predicted-XI player above the narrative's importance threshold
   *  (16% by default at the call site) — replaces the old single top-
   *  scorer name/pct pair so the "Key Player Battle" thread can genuinely
   *  list every player worth naming per side, not just one. */
  homeKeyPlayers?: NarrativeKeyPlayer[];
  awayKeyPlayers?: NarrativeKeyPlayer[];
}

export interface NarrativeThread {
  title: string;
  emoji: string;
  text: string;
  impact: string;
}

export function generateNarrativeThreads(m: NarrativeThreadsInput): NarrativeThread[] {
  const threads: NarrativeThread[] = [];

  // 1. The Form Divide — only when the points gap over the last 5 is real
  const homePts = m.homeLast5Points ?? null;
  const awayPts = m.awayLast5Points ?? null;
  if (homePts != null && awayPts != null && Math.abs(homePts - awayPts) >= 6) {
    const better = homePts > awayPts ? m.homeTeam : m.awayTeam;
    const worse = homePts > awayPts ? m.awayTeam : m.homeTeam;
    const betterPts = Math.max(homePts, awayPts);
    const worsePts = Math.min(homePts, awayPts);
    threads.push({
      title: 'The Form Divide', emoji: '📉📈',
      text: `${worse} have collected just ${worsePts} point${worsePts === 1 ? '' : 's'} from their last 5 matches, while ${better} have taken ${betterPts} from the same 15 available. A ${betterPts - worsePts}-point swing over 5 games is a significant gap in current form.`,
      impact: `A team building momentum visiting one that isn't — the psychological edge favors ${better}.`,
    });
  }

  // 2. The Injury Factor — always worth stating either way (clean sheet is
  // itself informative), but the FRAMING differs based on severity
  const homeInj = m.homeInjuredCount ?? 0;
  const awayInj = m.awayInjuredCount ?? 0;
  if (homeInj === 0 && awayInj === 0) {
    threads.push({
      title: 'The Injury Factor', emoji: '💊',
      text: `Both teams arrive with a clean injury sheet — no players missing for either side.`,
      impact: `This is a true test of squad quality versus squad quality, not a match decided by forced absences.`,
    });
  } else if (homeInj > 0 || awayInj > 0) {
    const worseOff = homeInj > awayInj ? m.homeTeam : m.awayTeam;
    const count = Math.max(homeInj, awayInj);
    threads.push({
      title: 'The Injury Factor', emoji: '💊',
      text: `${worseOff} will be without ${count} player${count === 1 ? '' : 's'} from their strongest available XI.`,
      impact: `A genuine squad-depth test for ${worseOff}, not just a form contest.`,
    });
  }

  // 3. The Home Advantage Myth — only worth a thread when the away side's
  // venue comparator meaningfully exceeds the home side's (not just any
  // crossover — structural-inverse comparators cross 50 constantly, so a
  // real threshold matters here to keep this selective, not trivial)
  if (m.homeVenueAdvantage != null && m.awayVenueAdvantage != null && (m.awayVenueAdvantage - m.homeVenueAdvantage) >= 8) {
    threads.push({
      title: 'The Home Advantage Myth', emoji: '🏠',
      text: `${m.homeTeam}'s home venue score (${m.homeVenueAdvantage.toFixed(0)}) is actually lower than ${m.awayTeam}'s away venue score (${m.awayVenueAdvantage.toFixed(0)}) — the visitors perform better on the road than the hosts do at home.`,
      impact: `Home advantage may not be the equalizer ${m.homeTeam} need it to be.`,
    });
  }

  // 4. The Goal Difference Story — only when the swing is large
  if (m.homeGoalsScored != null && m.awayGoalsScored != null && m.homeGoalsConceded != null && m.awayGoalsConceded != null) {
    const homeGD = m.homeGoalsScored - m.homeGoalsConceded;
    const awayGD = m.awayGoalsScored - m.awayGoalsConceded;
    if (Math.abs(homeGD - awayGD) >= 15) {
      threads.push({
        title: 'The Goal Difference Story', emoji: '⚽',
        text: `${m.homeTeam} have a goal difference of ${homeGD >= 0 ? '+' : ''}${homeGD} (${m.homeGoalsScored} scored, ${m.homeGoalsConceded} conceded) compared to ${m.awayTeam}'s ${awayGD >= 0 ? '+' : ''}${awayGD} (${m.awayGoalsScored} scored, ${m.awayGoalsConceded} conceded).`,
        impact: `Two teams operating at very different levels at both ends of the pitch this season.`,
      });
    }
  }

  // 5. The Squad Quality Gap — strength rating, only when the gap is large
  if (m.homeStrengthRating != null && m.awayStrengthRating != null) {
    const sDiff = Math.abs(m.homeStrengthRating - m.awayStrengthRating);
    if (sDiff >= 30) {
      const stronger = m.homeStrengthRating > m.awayStrengthRating ? m.homeTeam : m.awayTeam;
      const weaker = m.homeStrengthRating > m.awayStrengthRating ? m.awayTeam : m.homeTeam;
      threads.push({
        title: 'The Squad Quality Gap', emoji: '🏋️',
        text: `${stronger}'s strength rating outweighs ${weaker}'s by ${sDiff.toFixed(0)} points — a real difference in individual quality across the pitch.`,
        impact: `Even at full strength, ${weaker} face a genuine talent gap, not just a form dip.`,
      });
    }
  }

  // 6. The Key Player Battle — lists EVERY player above the importance
  // threshold per side (not just the single top scorer), per explicit
  // ask that players "at least above 16%" belong in the narrative itself,
  // not just a separate table. Each player gets a rule-based role from
  // deriveRole() — no single-name-only version of this thread anymore.
  const homeKP = m.homeKeyPlayers ?? [];
  const awayKP = m.awayKeyPlayers ?? [];
  if (homeKP.length > 0 || awayKP.length > 0) {
    const describeSide = (team: string, players: NarrativeKeyPlayer[]): string => {
      if (players.length === 0) return `${team} have no single player standing out above the threshold — a genuinely collective effort.`;
      const parts = players.map(p => {
        const role = deriveRole(p.positionCode, p.goals, p.assists);
        const statLine = p.goals > 0 || p.assists > 0 ? ` (${p.goals}g/${p.assists}a)` : '';
        return `${p.name} — ${role.emoji} ${role.label}, ${p.importance.toFixed(0)}% importance${statLine}`;
      });
      return `${team}'s key contributors: ${parts.join('; ')}.`;
    };
    threads.push({
      title: 'The Key Player Battle', emoji: '⚔️',
      text: `${describeSide(m.homeTeam, homeKP)} ${describeSide(m.awayTeam, awayKP)}`,
      impact: `Whichever side loses the most of these individual battles is likely to lose control of the match.`,
    });
  } else if (m.homeTopScorerName && m.awayTopScorerName && (m.homeTopScorerPct ?? 0) > 0 && (m.awayTopScorerPct ?? 0) > 0) {
    // Fallback for callers that haven't wired homeKeyPlayers/awayKeyPlayers
    // yet — keeps this thread working with just the top-scorer pair.
    threads.push({
      title: 'The Key Player Battle', emoji: '⚔️',
      text: `${m.homeTopScorerName} (${m.homeTeam}'s top scorer, ${(m.homeTopScorerPct ?? 0).toFixed(0)}% of team goals) versus ${m.awayTopScorerName} (${m.awayTeam}'s top scorer, ${(m.awayTopScorerPct ?? 0).toFixed(0)}% of team goals) — the individual matchup likely to shape the game.`,
      impact: `Whichever side neutralizes the opposing scorer gains a real tactical edge.`,
    });
  }

  return threads;
}
