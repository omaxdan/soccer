/**
 * PREDICTED LINEUPS ENGINE — weighted player score
 *
 * Produces the 0-100 "how likely is this player to be in the XI" score that
 * the optimizer maximizes. Everything is normalized WITHIN the player's own
 * team, so the score is scale-free: a squad twelve games into its season and a
 * squad thirty games in both produce scores spanning the same 0-100 range, and
 * a player is only ever compared against the team-mates he is competing with.
 *
 * WEIGHTS
 *
 *   35%  matches started    the direct trusted-starter signal
 *   30%  minutes played     distinguishes a starter who plays 90 from one
 *                           routinely withdrawn on the hour; also catches the
 *                           regular substitute who is closer to the XI than
 *                           his start count suggests
 *   20%  average rating     quality, independent of volume
 *   10%  appearances        squad involvement — counts a five-minute cameo the
 *                           same as a full match, which is exactly why it is
 *                           the smallest volume term rather than a large one
 *    5%  goal contributions goals + assists, capped
 *
 * The v1 formula weighted appearances at 20% and ignored minutes entirely,
 * which rated a fit-again substitute with many cameos above an ever-present
 * defender.
 *
 * RECENT FORM — deliberately absent
 *
 * Weighting the last five to ten matches would be a stronger predictor than
 * any season aggregate, and both design notes ask for it. The data is not
 * there: `player_match_load` is not synced from any upstream source, it is
 * synthesized by processPlayerMatchLoad(), which spreads a player's SEASON
 * minutes across an arbitrary set of his team's fixtures. Its own docstring
 * says the specific match each estimate lands on is arbitrary. Deriving
 * "recent starts" from it would produce a confident-looking number carrying no
 * recency information at all, so the component is omitted and
 * `recent_starts_score` is written as NULL rather than fabricated. Wiring in a
 * real per-match appearance feed is the single highest-value upgrade available
 * to this engine.
 */

/** Season aggregates for one player, as read from player_season_statistics. */
export interface RawPlayerStats {
  matchesStarted: number;
  appearances: number;
  minutesPlayed: number;
  totalRating: number;
  countRating: number;
  goals: number;
  assists: number;
}

export const SCORE_WEIGHTS = {
  matchesStarted: 35,
  minutesPlayed: 30,
  averageRating: 20,
  appearances: 10,
  goalContributions: 5,
} as const;

/** Per-team maxima used to normalize the volume terms. */
export interface TeamScoreNormalizers {
  maxStarts: number;
  maxMinutes: number;
  maxAppearances: number;
}

export function buildTeamNormalizers(squad: RawPlayerStats[]): TeamScoreNormalizers {
  return {
    // Floor of 1 keeps the division safe for a squad with no recorded
    // starts/minutes yet (pre-season, newly tracked league).
    maxStarts: Math.max(1, ...squad.map((s) => s.matchesStarted)),
    maxMinutes: Math.max(1, ...squad.map((s) => s.minutesPlayed)),
    maxAppearances: Math.max(1, ...squad.map((s) => s.appearances)),
  };
}

/** Mean match rating on SofaScore's 0-10 scale, or 0 when unrated. */
export function averageRating(stats: RawPlayerStats): number {
  if (stats.countRating <= 0 || stats.totalRating <= 0) return 0;
  return stats.totalRating / stats.countRating;
}

/**
 * Normalizes a rating to 0-1 across the band that actually discriminates
 * between professional footballers. Ratings below 5.5 are rare and effectively
 * interchangeable; above 8.0 is exceptional. Dividing by 10 instead — as v1
 * did — compresses every real player into the 0.6-0.8 range and wastes the
 * component's entire 20% weight.
 */
const RATING_FLOOR = 5.5;
const RATING_CEILING = 8.0;

function normalizeRating(rating: number): number {
  if (rating <= 0) return 0;
  return clamp01((rating - RATING_FLOOR) / (RATING_CEILING - RATING_FLOOR));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 0-100 weighted selection score for one player, normalized against his own
 * squad.
 */
export function calculateWeightedScore(
  stats: RawPlayerStats,
  norm: TeamScoreNormalizers,
): number {
  const startsNorm = clamp01(stats.matchesStarted / norm.maxStarts);
  const minutesNorm = clamp01(stats.minutesPlayed / norm.maxMinutes);
  const appsNorm = clamp01(stats.appearances / norm.maxAppearances);
  const ratingNorm = normalizeRating(averageRating(stats));
  // 15 combined goals and assists saturates the term — beyond that the player
  // is already maximally rewarded by the rating and volume components.
  const contribNorm = clamp01((stats.goals + stats.assists) / 15);

  return (
    SCORE_WEIGHTS.matchesStarted * startsNorm +
    SCORE_WEIGHTS.minutesPlayed * minutesNorm +
    SCORE_WEIGHTS.averageRating * ratingNorm +
    SCORE_WEIGHTS.appearances * appsNorm +
    SCORE_WEIGHTS.goalContributions * contribNorm
  );
}

/**
 * Whether a player has played enough to be a selection candidate at all.
 *
 * Someone with no appearances and no minutes has no evidence behind them in
 * either direction — they may be a youth-team name on the squad list or a
 * signing yet to debut. Including them adds noise; excluding them is only
 * unsafe for a squad with no recorded statistics whatsoever, which the caller
 * handles separately by falling back to the unfiltered pool.
 */
export function hasPlayingEvidence(stats: RawPlayerStats): boolean {
  return stats.appearances > 0 || stats.minutesPlayed > 0 || stats.matchesStarted > 0;
}
