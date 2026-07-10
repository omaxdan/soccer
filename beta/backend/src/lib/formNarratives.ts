// ─── FORM NARRATIVES — pure computation library ──────────────────────────────
// Takes a team's recent form history rows (newest-first, from team_form_history)
// and returns structured narrative objects for the 8 priority narratives.
//
// Design constraints:
//   - Zero DB calls: caller fetches the rows, this function only computes.
//   - Threshold-gated: only returns a narrative when there's something genuinely
//     notable. No "1 win in a row" — below-threshold results return null and
//     are filtered out by the caller.
//   - Graceful on null fields: the migration 021 columns (is_home, btts,
//     half_time_score_for/against) are nullable on pre-migration rows.
//     Narratives that depend on those columns simply don't fire until the
//     backfill has run. No fabricated data, no partial-data bluffing.
//   - Venue-split narratives only fire when the team has enough venue-specific
//     history. A team with 1 away game in the last 10 doesn't get an away
//     narrative — the sample is too small to mean anything.
//
// Narrative categories (the 8 priority narratives for launch):
//   FORM:      Win streak, unbeaten streak, winless/loss streak
//   VENUE:     Home form, away form (requires is_home)
//   GOALS:     Scoring run, goal drought, clean sheet run, BTTS rate
//   HALFTIME:  HT lead rate, comeback wins, dropped points from winning pos
//
// Architecture note: this file lives in the backend src/lib/ so it can be
// called by both a future precompute job (processFormNarratives.ts → writes
// to a narratives table, frontend reads static text) AND by the frontend
// directly if it fetches form history rows itself. The function is pure —
// no side effects, no DB, identical in both contexts.

export type NarrativeCategory = 'form' | 'venue' | 'goals' | 'halftime';
export type NarrativeStrength = 'positive' | 'negative' | 'neutral';

export interface FormNarrative {
  id: string;               // stable identifier, e.g. "win_streak"
  title: string;            // short label, e.g. "Win Streak"
  text: string;             // the headline sentence, e.g. "3 wins in a row"
  detail: string;           // fuller sentence for display in the UI
  category: NarrativeCategory;
  strength: NarrativeStrength;
  matchesSpan: number;      // how many recent matches this narrative covers
  value: number;            // the key metric (streak count, %, etc.)
}

// A form history row as this library expects it. Matches TeamFormHistory
// from types/index.ts but typed explicitly here so this file has no
// backend type dependency (could be used by frontend too).
export interface FormRow {
  result: string;              // 'W' | 'D' | 'L'
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  is_home: boolean | null;     // null = pre-migration, venue narratives skip
  btts: boolean | null;        // null = pre-migration, BTTS narrative skips
  half_time_score_for: number | null;
  half_time_score_against: number | null;
  match_date: string;
}

// ─── thresholds ──────────────────────────────────────────────────────────────
const MIN_WIN_STREAK        = 3;  // "3 wins in a row" is the floor
const MIN_UNBEATEN_STREAK   = 5;  // "5 unbeaten" is worth noting
const MIN_LOSS_STREAK       = 3;  // negative form floor
const MIN_SCORING_RUN       = 4;  // "scored in 4 consecutive"
const MIN_CS_RUN            = 3;  // "clean sheet in 3 of last N"
const BTTS_WINDOW           = 8;  // calculate BTTS rate over last 8
const BTTS_RATE_THRESHOLD   = 0.625; // 5/8 games = threshold to flag
const HT_WINDOW             = 8;  // HT lead rate window
const HT_LEAD_THRESHOLD     = 0.625; // 5/8 = threshold
const VENUE_MIN_GAMES       = 4;  // min home/away games to generate venue narrative
const VENUE_STRONG_PPG      = 1.8; // >= 1.8 PPG at home/away = strong
const VENUE_POOR_PPG        = 0.8; // <= 0.8 PPG = poor

// ─── streak helpers ──────────────────────────────────────────────────────────

function consecutiveStreak(
  rows: FormRow[],
  predicate: (r: FormRow) => boolean,
): number {
  let streak = 0;
  for (const r of rows) {
    if (predicate(r)) streak++;
    else break;
  }
  return streak;
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

// ─── individual narrative generators ─────────────────────────────────────────

function winStreak(rows: FormRow[]): FormNarrative | null {
  const streak = consecutiveStreak(rows, r => r.result === 'W');
  if (streak < MIN_WIN_STREAK) return null;
  return {
    id: 'win_streak', title: 'Win Streak', category: 'form', strength: 'positive',
    matchesSpan: streak, value: streak,
    text: `${streak} wins in a row`,
    detail: `On a ${streak}-game winning run heading into this fixture — momentum is firmly on their side.`,
  };
}

function unbeatenStreak(rows: FormRow[]): FormNarrative | null {
  const winStrk = consecutiveStreak(rows, r => r.result === 'W');
  if (winStrk >= MIN_WIN_STREAK) return null; // win_streak already fires; don't double-up
  const streak = consecutiveStreak(rows, r => r.result !== 'L');
  if (streak < MIN_UNBEATEN_STREAK) return null;
  const wins  = rows.slice(0, streak).filter(r => r.result === 'W').length;
  const draws = streak - wins;
  return {
    id: 'unbeaten_streak', title: 'Unbeaten Run', category: 'form', strength: 'positive',
    matchesSpan: streak, value: streak,
    text: `${streak} games unbeaten (${wins}W ${draws}D)`,
    detail: `${streak} matches without a defeat — hard to beat right now, even if not always winning.`,
  };
}

function lossStreak(rows: FormRow[]): FormNarrative | null {
  const streak = consecutiveStreak(rows, r => r.result === 'L');
  if (streak < MIN_LOSS_STREAK) return null;
  return {
    id: 'loss_streak', title: 'Losing Run', category: 'form', strength: 'negative',
    matchesSpan: streak, value: streak,
    text: `Lost last ${streak} games`,
    detail: `${streak} consecutive defeats — a team in genuine difficulty heading into this match.`,
  };
}

function winlessStreak(rows: FormRow[]): FormNarrative | null {
  const lossStrk = consecutiveStreak(rows, r => r.result === 'L');
  if (lossStrk >= MIN_LOSS_STREAK) return null; // loss_streak already fires
  const streak = consecutiveStreak(rows, r => r.result !== 'W');
  if (streak < MIN_LOSS_STREAK) return null;
  const draws  = rows.slice(0, streak).filter(r => r.result === 'D').length;
  const losses = streak - draws;
  return {
    id: 'winless_streak', title: 'Winless Run', category: 'form', strength: 'negative',
    matchesSpan: streak, value: streak,
    text: `${streak} games without a win (${draws}D ${losses}L)`,
    detail: `${streak} matches without winning — form that's hard to trust regardless of opponent.`,
  };
}

function homeForm(rows: FormRow[]): FormNarrative | null {
  const homeRows = rows.filter(r => r.is_home === true);
  if (homeRows.length < VENUE_MIN_GAMES) return null;

  const span   = Math.min(homeRows.length, 6); // last 6 home games
  const sample = homeRows.slice(0, span);
  const pts    = sample.reduce((s, r) => s + (r.points ?? 0), 0);
  const ppg    = pts / span;
  const wins   = sample.filter(r => r.result === 'W').length;

  if (ppg >= VENUE_STRONG_PPG) {
    return {
      id: 'home_form_strong', title: 'Home Fortress', category: 'venue', strength: 'positive',
      matchesSpan: span, value: Math.round(ppg * 10) / 10,
      text: `${wins} wins from last ${span} home games (${ppg.toFixed(1)} PPG)`,
      detail: `Strong home record this season — difficult to beat at their own ground.`,
    };
  }
  if (ppg <= VENUE_POOR_PPG) {
    return {
      id: 'home_form_poor', title: 'Poor Home Form', category: 'venue', strength: 'negative',
      matchesSpan: span, value: Math.round(ppg * 10) / 10,
      text: `Only ${wins} wins from last ${span} home games (${ppg.toFixed(1)} PPG)`,
      detail: `Struggling on home turf — the home advantage may not be the protection it sounds.`,
    };
  }
  return null;
}

function awayForm(rows: FormRow[]): FormNarrative | null {
  const awayRows = rows.filter(r => r.is_home === false);
  if (awayRows.length < VENUE_MIN_GAMES) return null;

  const span   = Math.min(awayRows.length, 6);
  const sample = awayRows.slice(0, span);
  const pts    = sample.reduce((s, r) => s + (r.points ?? 0), 0);
  const ppg    = pts / span;
  const wins   = sample.filter(r => r.result === 'W').length;

  if (ppg >= VENUE_STRONG_PPG) {
    return {
      id: 'away_form_strong', title: 'Road Warriors', category: 'venue', strength: 'positive',
      matchesSpan: span, value: Math.round(ppg * 10) / 10,
      text: `${wins} wins from last ${span} away games (${ppg.toFixed(1)} PPG)`,
      detail: `Excellent away record — travels well and picks up points on the road.`,
    };
  }
  if (ppg <= VENUE_POOR_PPG) {
    return {
      id: 'away_form_poor', title: 'Away Struggles', category: 'venue', strength: 'negative',
      matchesSpan: span, value: Math.round(ppg * 10) / 10,
      text: `Only ${wins} wins from last ${span} away games (${ppg.toFixed(1)} PPG)`,
      detail: `Historically picks up very little on the road — a genuine away-day concern.`,
    };
  }
  return null;
}

function scoringRun(rows: FormRow[]): FormNarrative | null {
  const streak = consecutiveStreak(rows, r => (r.goals_for ?? 0) > 0);
  if (streak < MIN_SCORING_RUN) return null;
  return {
    id: 'scoring_run', title: 'Scoring Run', category: 'goals', strength: 'positive',
    matchesSpan: streak, value: streak,
    text: `Scored in ${streak} consecutive games`,
    detail: `${streak} matches in a row finding the net — consistent attacking threat.`,
  };
}

function goalDrought(rows: FormRow[]): FormNarrative | null {
  const streak = consecutiveStreak(rows, r => (r.goals_for ?? 0) === 0);
  if (streak < 2) return null;
  return {
    id: 'goal_drought', title: 'Goal Drought', category: 'goals', strength: 'negative',
    matchesSpan: streak, value: streak,
    text: `Failed to score in last ${streak} games`,
    detail: `${streak} matches without scoring — a concerning attacking bluntness.`,
  };
}

function cleanSheetRun(rows: FormRow[]): FormNarrative | null {
  const span   = Math.min(rows.length, 8);
  const sample = rows.slice(0, span);
  const csCount = sample.filter(r => (r.goals_against ?? 1) === 0).length;
  if (csCount < MIN_CS_RUN) return null;
  // Also check if it's a genuine streak (not scattered)
  const streak = consecutiveStreak(rows, r => (r.goals_against ?? 1) === 0);
  const isStreak = streak >= MIN_CS_RUN;
  return {
    id: 'clean_sheet_run', title: 'Clean Sheet Form', category: 'goals', strength: 'positive',
    matchesSpan: span, value: csCount,
    text: isStreak
      ? `${streak} consecutive clean sheets`
      : `${csCount} clean sheets in last ${span} games`,
    detail: isStreak
      ? `${streak} games in a row keeping a clean sheet — one of the meanest defenses in current form.`
      : `${csCount} clean sheets from the last ${span} games — solid defensive discipline.`,
  };
}

function bttsRate(rows: FormRow[]): FormNarrative | null {
  // Only fire when btts column is populated (post-migration backfill)
  const sample = rows.slice(0, BTTS_WINDOW).filter(r => r.btts !== null);
  if (sample.length < BTTS_WINDOW - 1) return null; // need enough data
  const bttsCount = sample.filter(r => r.btts === true).length;
  const rate      = bttsCount / sample.length;
  if (rate < BTTS_RATE_THRESHOLD) return null;
  return {
    id: 'btts_rate', title: 'Both Teams Scoring', category: 'goals', strength: 'neutral',
    matchesSpan: sample.length, value: bttsCount,
    text: `Both teams scored in ${bttsCount} of last ${sample.length} games`,
    detail: `${pct(bttsCount, sample.length)}% BTTS rate — matches involving this team tend to have goals at both ends.`,
  };
}

function htLeadRate(rows: FormRow[]): FormNarrative | null {
  const sample = rows.slice(0, HT_WINDOW)
    .filter(r => r.half_time_score_for !== null && r.half_time_score_against !== null);
  if (sample.length < HT_WINDOW - 2) return null;
  const leading = sample.filter(r => (r.half_time_score_for ?? 0) > (r.half_time_score_against ?? 0)).length;
  const rate    = leading / sample.length;
  if (rate < HT_LEAD_THRESHOLD) return null;
  return {
    id: 'ht_lead_rate', title: 'First-Half Dominance', category: 'halftime', strength: 'positive',
    matchesSpan: sample.length, value: leading,
    text: `Leads at half-time in ${leading} of last ${sample.length} games`,
    detail: `${pct(leading, sample.length)}% of games ahead at the break — regularly takes early control.`,
  };
}

function comebackWins(rows: FormRow[]): FormNarrative | null {
  const span   = Math.min(rows.length, 10);
  const sample = rows.slice(0, span)
    .filter(r => r.half_time_score_for !== null && r.half_time_score_against !== null);
  if (sample.length < 5) return null;
  const comebacks = sample.filter(r =>
    (r.half_time_score_for ?? 0) < (r.half_time_score_against ?? 0)
    && r.result === 'W'
  ).length;
  if (comebacks < 2) return null;
  return {
    id: 'comeback_wins', title: 'Comeback Ability', category: 'halftime', strength: 'positive',
    matchesSpan: sample.length, value: comebacks,
    text: `Won from behind at half-time ${comebacks} times in last ${sample.length} games`,
    detail: `${comebacks} matches where they trailed at half-time yet won — a team that doesn't give up.`,
  };
}

function droppedPoints(rows: FormRow[]): FormNarrative | null {
  const span   = Math.min(rows.length, 10);
  const sample = rows.slice(0, span)
    .filter(r => r.half_time_score_for !== null && r.half_time_score_against !== null);
  if (sample.length < 5) return null;
  // Led at HT but didn't win at FT
  const dropped = sample.filter(r =>
    (r.half_time_score_for ?? 0) > (r.half_time_score_against ?? 0)
    && r.result !== 'W'
  ).length;
  if (dropped < 2) return null;
  return {
    id: 'dropped_points', title: 'Dropped Points', category: 'halftime', strength: 'negative',
    matchesSpan: sample.length, value: dropped,
    text: `Dropped points from a HT lead ${dropped} times in last ${sample.length} games`,
    detail: `${dropped} matches where they led at half-time but failed to win — a closing problem.`,
  };
}

// ─── main export ─────────────────────────────────────────────────────────────

/** Compute all applicable narrative threads for a team from their recent
 *  form history. Input rows must be sorted newest-first (match_date DESC).
 *  Returns only narratives that cross their relevance thresholds — a result
 *  of [] means "nothing notable enough to surface", not a data error.
 *
 *  Suggested input: last 10–15 form history rows. Passing fewer reduces
 *  which venue and rate-based narratives can fire; passing more is fine
 *  (window-based narratives only use the most recent N in their window). */
export function computeFormNarratives(rows: FormRow[]): FormNarrative[] {
  if (rows.length === 0) return [];

  const candidates = [
    // FORM — in priority order (positive before negative; win > unbeaten > winless > loss)
    winStreak(rows),
    unbeatenStreak(rows),
    winlessStreak(rows),
    lossStreak(rows),
    // VENUE — home before away
    homeForm(rows),
    awayForm(rows),
    // GOALS
    scoringRun(rows),
    goalDrought(rows),
    cleanSheetRun(rows),
    bttsRate(rows),
    // HALFTIME
    htLeadRate(rows),
    comebackWins(rows),
    droppedPoints(rows),
  ];

  return candidates.filter((n): n is FormNarrative => n !== null);
}
