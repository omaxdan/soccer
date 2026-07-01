import {
  SportsAPITeam,
  SportsAPIPlayer,
  SportsAPIMatch,
  Team,
  Player,
  Match,
  MatchResult,
} from '../types/index';
import { logger } from '../utils/logger';

/**
 * Team Transformer
 */
export function transformTeam(sportsApiTeam: SportsAPITeam): Team {
  return {
    id: 0, // Will be set by DB
    external_id: sportsApiTeam.id,
    name: sportsApiTeam.name,
    short_name: sportsApiTeam.shortName || null,
    country: sportsApiTeam.country || null,
    slug: sportsApiTeam.name.toLowerCase().replace(/\s+/g, '-') || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Player Transformer
 * Accepts the already-normalised player object from syncTeamsPlayers.
 * Field resolution (nested unwrap, timestamp->date) happens in the normaliser
 * before this is called — this is purely a domain mapping.
 */
export function transformPlayer(
  sportsApiPlayer: any,
  teamId?: number
): Player {
  let dateOfBirth: string | null = null;
  if (sportsApiPlayer.dateOfBirth) {
    const raw = String(sportsApiPlayer.dateOfBirth);
    dateOfBirth = raw.length === 10 ? raw : new Date(raw).toISOString().split('T')[0];
  }

  return {
    id: 0,
    external_id: sportsApiPlayer.id,
    name: sportsApiPlayer.name || 'Unknown',
    position: sportsApiPlayer.position || null,
    nationality: sportsApiPlayer.nationality || null,
    date_of_birth: dateOfBirth,
    market_value: sportsApiPlayer.market_value ?? null,
    team_id: teamId || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Match Transformer
 * Converts SportsAPI match to normalized Match record
 */
export function transformMatch(sportsApiMatch: any): Match {
  // Validate using actual API fields
  if (!sportsApiMatch.id || !sportsApiMatch.homeTeam?.id || !sportsApiMatch.awayTeam?.id || !sportsApiMatch.tournament?.name) {
    throw new Error(
      `Invalid match data: missing id, homeTeam, awayTeam, or tournament. Data: ${JSON.stringify(sportsApiMatch)}`
    );
  }

  const statusMap: Record<number, string> = {
    0: 'scheduled',
    6: 'live',
    7: 'live',
    31: 'halftime',
    40: 'live',
    41: 'live',
    50: 'live',
    100: 'finished',
    110: 'finished',
    120: 'finished',
    60: 'postponed',
    70: 'cancelled',
    90: 'abandoned',
  };

  return {
    id: 0,
    external_match_id: sportsApiMatch.id,
    home_team_id: 0,   // set by job
    away_team_id: 0,   // set by job
    date: new Date(sportsApiMatch.startTimestamp * 1000).toISOString(),
    competition: sportsApiMatch.tournament.name,
    season: sportsApiMatch.season?.name || null,
    status: statusMap[sportsApiMatch.status?.code] || 'scheduled',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Match Result Transformer
 * Extracts scores and determines winner
 */
export function transformMatchResult(
  matchId: number,
  sportsApiMatch: any
): MatchResult {
  const homeScore = sportsApiMatch.homeScore?.normaltime ?? sportsApiMatch.homeScore?.current;
  const awayScore = sportsApiMatch.awayScore?.normaltime ?? sportsApiMatch.awayScore?.current;
  const halfTimeHome = sportsApiMatch.homeScore?.period1;
  const halfTimeAway = sportsApiMatch.awayScore?.period1;

  // winner_team_id will be resolved later by the job (set to 0 for now)
  let winnerTeamId: number | null = 0;

  const statusMap: Record<number, string> = {
    100: 'finished',
    110: 'finished',
    120: 'finished',
    6: 'live',
    7: 'live',
    31: 'halftime',
    40: 'live',
    41: 'live',
    50: 'live',
    0: 'scheduled',
    60: 'postponed',
    70: 'cancelled',
    90: 'abandoned',
  };

  return {
    id: 0,
    match_id: matchId,
    home_score: homeScore ?? null,
    away_score: awayScore ?? null,
    half_time_home_score: halfTimeHome ?? null,
    half_time_away_score: halfTimeAway ?? null,
    winner_team_id: winnerTeamId,
    status: statusMap[sportsApiMatch.status?.code] || 'scheduled',
    updated_at: new Date().toISOString(),
  };
}

/**
 * Helper: Slugify text for URLs
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
