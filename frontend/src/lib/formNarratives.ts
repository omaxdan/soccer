// ─── FORM NARRATIVES — frontend entry point ───────────────────────────────────
// Re-exports the narrative types and provides a thin adapter that takes the
// raw rows from getTeamFormHistory() and returns FormNarrative[] ready to render.
//
// The core computation logic lives in backend/src/lib/formNarratives.ts
// (mirrored here as a direct copy so the frontend has zero build dependency
// on backend source). Both copies must be kept in sync — the only difference
// is the import path.

export type NarrativeCategory = 'form' | 'venue' | 'goals' | 'halftime';
export type NarrativeStrength = 'positive' | 'negative' | 'neutral';

export interface FormNarrative {
  id: string;
  title: string;
  text: string;
  detail: string;
  category: NarrativeCategory;
  strength: NarrativeStrength;
  matchesSpan: number;
  value: number;
}

interface FormRow {
  result: string;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  is_home: boolean | null;
  btts: boolean | null;
  half_time_score_for: number | null;
  half_time_score_against: number | null;
  match_date: string;
}

// ─── thresholds (keep in sync with backend/src/lib/formNarratives.ts) ────────
const MIN_WIN_STREAK        = 3;
const MIN_UNBEATEN_STREAK   = 5;
const MIN_LOSS_STREAK       = 3;
const MIN_SCORING_RUN       = 4;
const MIN_CS_RUN            = 3;
const BTTS_WINDOW           = 8;
const BTTS_RATE_THRESHOLD   = 0.625;
const HT_WINDOW             = 8;
const HT_LEAD_THRESHOLD     = 0.625;
const VENUE_MIN_GAMES       = 4;
const VENUE_STRONG_PPG      = 1.8;
const VENUE_POOR_PPG        = 0.8;

function consecutiveStreak(rows: FormRow[], predicate: (r: FormRow) => boolean): number {
  let streak = 0;
  for (const r of rows) { if (predicate(r)) streak++; else break; }
  return streak;
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

function winStreak(rows: FormRow[]): FormNarrative | null {
  const streak = consecutiveStreak(rows, r => r.result === 'W');
  if (streak < MIN_WIN_STREAK) return null;
  return { id: 'win_streak', title: 'Win Streak', category: 'form', strength: 'positive', matchesSpan: streak, value: streak,
    text: `${streak} wins in a row`,
    detail: `On a ${streak}-game winning run heading into this fixture — momentum is firmly on their side.` };
}

function unbeatenStreak(rows: FormRow[]): FormNarrative | null {
  if (consecutiveStreak(rows, r => r.result === 'W') >= MIN_WIN_STREAK) return null;
  const streak = consecutiveStreak(rows, r => r.result !== 'L');
  if (streak < MIN_UNBEATEN_STREAK) return null;
  const wins = rows.slice(0, streak).filter(r => r.result === 'W').length;
  return { id: 'unbeaten_streak', title: 'Unbeaten Run', category: 'form', strength: 'positive', matchesSpan: streak, value: streak,
    text: `${streak} games unbeaten (${wins}W ${streak - wins}D)`,
    detail: `${streak} matches without a defeat — hard to beat right now, even if not always winning.` };
}

function lossStreak(rows: FormRow[]): FormNarrative | null {
  const streak = consecutiveStreak(rows, r => r.result === 'L');
  if (streak < MIN_LOSS_STREAK) return null;
  return { id: 'loss_streak', title: 'Losing Run', category: 'form', strength: 'negative', matchesSpan: streak, value: streak,
    text: `Lost last ${streak} games`,
    detail: `${streak} consecutive defeats — a team in genuine difficulty heading into this match.` };
}

function winlessStreak(rows: FormRow[]): FormNarrative | null {
  if (consecutiveStreak(rows, r => r.result === 'L') >= MIN_LOSS_STREAK) return null;
  const streak = consecutiveStreak(rows, r => r.result !== 'W');
  if (streak < MIN_LOSS_STREAK) return null;
  const draws = rows.slice(0, streak).filter(r => r.result === 'D').length;
  return { id: 'winless_streak', title: 'Winless Run', category: 'form', strength: 'negative', matchesSpan: streak, value: streak,
    text: `${streak} games without a win (${draws}D ${streak - draws}L)`,
    detail: `${streak} matches without winning — form that's hard to trust regardless of opponent.` };
}

function venueForm(rows: FormRow[], isHome: boolean): FormNarrative | null {
  const venue = rows.filter(r => r.is_home === isHome);
  if (venue.length < VENUE_MIN_GAMES) return null;
  const span   = Math.min(venue.length, 6);
  const sample = venue.slice(0, span);
  const pts    = sample.reduce((s, r) => s + (r.points ?? 0), 0);
  const ppg    = pts / span;
  const wins   = sample.filter(r => r.result === 'W').length;
  if (ppg >= VENUE_STRONG_PPG)
    return { id: isHome ? 'home_form_strong' : 'away_form_strong', title: isHome ? 'Home Fortress' : 'Road Warriors', category: 'venue', strength: 'positive', matchesSpan: span, value: Math.round(ppg * 10) / 10,
      text: `${wins} wins from last ${span} ${isHome ? 'home' : 'away'} games (${ppg.toFixed(1)} PPG)`,
      detail: isHome ? `Strong home record this season — difficult to beat at their own ground.` : `Excellent away record — travels well and picks up points on the road.` };
  if (ppg <= VENUE_POOR_PPG)
    return { id: isHome ? 'home_form_poor' : 'away_form_poor', title: isHome ? 'Poor Home Form' : 'Away Struggles', category: 'venue', strength: 'negative', matchesSpan: span, value: Math.round(ppg * 10) / 10,
      text: `Only ${wins} wins from last ${span} ${isHome ? 'home' : 'away'} games (${ppg.toFixed(1)} PPG)`,
      detail: isHome ? `Struggling on home turf — the home advantage may not be the protection it sounds.` : `Historically picks up very little on the road — a genuine away-day concern.` };
  return null;
}

function scoringRun(rows: FormRow[]): FormNarrative | null {
  const streak = consecutiveStreak(rows, r => (r.goals_for ?? 0) > 0);
  if (streak < MIN_SCORING_RUN) return null;
  return { id: 'scoring_run', title: 'Scoring Run', category: 'goals', strength: 'positive', matchesSpan: streak, value: streak,
    text: `Scored in ${streak} consecutive games`,
    detail: `${streak} matches in a row finding the net — consistent attacking threat.` };
}

function goalDrought(rows: FormRow[]): FormNarrative | null {
  const streak = consecutiveStreak(rows, r => (r.goals_for ?? 0) === 0);
  if (streak < 2) return null;
  return { id: 'goal_drought', title: 'Goal Drought', category: 'goals', strength: 'negative', matchesSpan: streak, value: streak,
    text: `Failed to score in last ${streak} games`,
    detail: `${streak} matches without scoring — a concerning attacking bluntness.` };
}

function cleanSheetRun(rows: FormRow[]): FormNarrative | null {
  const span    = Math.min(rows.length, 8);
  const sample  = rows.slice(0, span);
  const csCount = sample.filter(r => (r.goals_against ?? 1) === 0).length;
  if (csCount < MIN_CS_RUN) return null;
  const streak  = consecutiveStreak(rows, r => (r.goals_against ?? 1) === 0);
  const isStrk  = streak >= MIN_CS_RUN;
  return { id: 'clean_sheet_run', title: 'Clean Sheet Form', category: 'goals', strength: 'positive', matchesSpan: span, value: csCount,
    text: isStrk ? `${streak} consecutive clean sheets` : `${csCount} clean sheets in last ${span} games`,
    detail: isStrk ? `${streak} games in a row keeping a clean sheet — one of the meanest defenses in current form.` : `${csCount} clean sheets from the last ${span} games — solid defensive discipline.` };
}

function bttsRate(rows: FormRow[]): FormNarrative | null {
  const sample = rows.slice(0, BTTS_WINDOW).filter(r => r.btts !== null);
  if (sample.length < BTTS_WINDOW - 1) return null;
  const bttsCount = sample.filter(r => r.btts === true).length;
  if (bttsCount / sample.length < BTTS_RATE_THRESHOLD) return null;
  return { id: 'btts_rate', title: 'Both Teams Scoring', category: 'goals', strength: 'neutral', matchesSpan: sample.length, value: bttsCount,
    text: `Both teams scored in ${bttsCount} of last ${sample.length} games`,
    detail: `${pct(bttsCount, sample.length)}% BTTS rate — matches involving this team tend to have goals at both ends.` };
}

function htLeadRate(rows: FormRow[]): FormNarrative | null {
  const sample = rows.slice(0, HT_WINDOW).filter(r => r.half_time_score_for !== null);
  if (sample.length < HT_WINDOW - 2) return null;
  const leading = sample.filter(r => (r.half_time_score_for ?? 0) > (r.half_time_score_against ?? 0)).length;
  if (leading / sample.length < HT_LEAD_THRESHOLD) return null;
  return { id: 'ht_lead_rate', title: 'First-Half Dominance', category: 'halftime', strength: 'positive', matchesSpan: sample.length, value: leading,
    text: `Leads at half-time in ${leading} of last ${sample.length} games`,
    detail: `${pct(leading, sample.length)}% of games ahead at the break — regularly takes early control.` };
}

function comebackWins(rows: FormRow[]): FormNarrative | null {
  const sample = rows.slice(0, 10).filter(r => r.half_time_score_for !== null);
  if (sample.length < 5) return null;
  const cb = sample.filter(r => (r.half_time_score_for ?? 0) < (r.half_time_score_against ?? 0) && r.result === 'W').length;
  if (cb < 2) return null;
  return { id: 'comeback_wins', title: 'Comeback Ability', category: 'halftime', strength: 'positive', matchesSpan: sample.length, value: cb,
    text: `Won from behind at half-time ${cb} times in last ${sample.length} games`,
    detail: `${cb} matches where they trailed at half-time yet won — a team that doesn't give up.` };
}

function droppedPoints(rows: FormRow[]): FormNarrative | null {
  const sample = rows.slice(0, 10).filter(r => r.half_time_score_for !== null);
  if (sample.length < 5) return null;
  const dropped = sample.filter(r => (r.half_time_score_for ?? 0) > (r.half_time_score_against ?? 0) && r.result !== 'W').length;
  if (dropped < 2) return null;
  return { id: 'dropped_points', title: 'Dropped Points', category: 'halftime', strength: 'negative', matchesSpan: sample.length, value: dropped,
    text: `Dropped points from a HT lead ${dropped} times in last ${sample.length} games`,
    detail: `${dropped} matches where they led at half-time but failed to win — a closing problem.` };
}

/** Convert rows from getTeamFormHistory() into form narrative objects.
 *  Rows must be newest-first (match_date DESC). Returns only narratives
 *  that cross their relevance threshold — [] means nothing notable,
 *  not a data error. */
export function computeFormNarratives(rows: any[]): FormNarrative[] {
  if (!rows || rows.length === 0) return [];
  const typed = rows as FormRow[];
  return [
    winStreak(typed), unbeatenStreak(typed), winlessStreak(typed), lossStreak(typed),
    venueForm(typed, true), venueForm(typed, false),
    scoringRun(typed), goalDrought(typed), cleanSheetRun(typed), bttsRate(typed),
    htLeadRate(typed), comebackWins(typed), droppedPoints(typed),
  ].filter((n): n is FormNarrative => n !== null);
}

// Strength → CSS color token key (e.g. COLORS[strengthColor(n.strength)])
export function strengthColor(strength: NarrativeStrength): string {
  if (strength === 'positive') return 'green';
  if (strength === 'negative') return 'red';
  return 'muted';
}
