/**
 * PREDICTED LINEUPS — v2
 *
 * Predicts the most likely starting XI, the formation it will be arranged in,
 * and where each player stands, for every scheduled fixture in the horizon.
 * Entirely DB-derived: zero API calls, no confirmed-lineup or predicted-lineup
 * endpoint anywhere in the design.
 *
 * WHAT CHANGED FROM v1
 *
 * v1 was a single ~400-line function that assumed 1-4-4-2 for every team on
 * earth, bucketed players by a coarse G/D/M/F letter, filled slots greedily
 * from left to right, and computed each player's confidence by comparing him
 * against whoever happened to be next in the output array. It could ship a
 * ten-player lineup, and it wrote columns that did not exist in the schema.
 *
 * v2 is an orchestration layer over src/lib/lineups: this file loads data and
 * persists results, and every football decision lives in a small tested module
 * that processStartingXIStrength() shares. Each stage is one function:
 *
 *   loadMatches()             fixtures in the horizon
 *   loadSquadData()           players, season stats, injuries, transfers
 *   buildTeamCandidatePool()  availability filter -> scored candidates
 *   predictLineup()           formation selection -> assignment -> assembly
 *   buildRows()               domain objects -> database rows
 *   savePredictedLineups()    upsert + stale-row cleanup
 *
 * WRITE STRATEGY — upsert, not delete-then-insert
 *
 * The two design notes disagree here; this follows the one with the argument
 * behind it. DELETE-then-INSERT across a 500-match run means a crash at match
 * 120 leaves the remaining 380 matches with NO lineup at all until the next
 * scheduled run, and every run has a window where readers see an empty table.
 * Migration 025 adds UNIQUE(match_id, team_id, player_id), so the write is an
 * upsert: each match's lineup is replaced atomically and a crash costs only
 * the matches not yet reached. Rows for players who dropped out of an XI are
 * cleaned up afterwards by timestamp — see savePredictedLineups().
 */

import { db } from '../db/client';
import { fetchAllRows } from '../db/fetchAllRows';
import { logger } from '../utils/logger';
import { MUTABLE_MATCH_STATUS } from '../lib/matchLifecycle';
import {
  assembleLineup,
  buildCandidates,
  checkAvailability,
  resolveLatestTeams,
  selectBestFormation,
  type AvailabilityInjury,
  type AvailabilityPlayer,
  type CandidateInput,
  type PredictedLineup,
  type UnavailabilityReason,
} from '../lib/lineups';

// ─── Configuration ───────────────────────────────────────────────────────────

/** How far ahead to predict. Matches processStartingXIStrength()'s horizon. */
const DEFAULT_HORIZON_DAYS = 7;

/** Supabase write batch size, consistent with the rest of the pipeline. */
const CHUNK_SIZE = 500;

export interface PredictedLineupOptions {
  horizonDays?: number;
  /** Restrict to specific fixtures — used by targeted reruns. */
  matchIds?: number[];
}

export interface PredictedLineupResult {
  matchesProcessed: number;
  teamsProcessed: number;
  playersWritten: number;
  formationsWritten: number;
  teamsSkipped: number;
  staleRowsRemoved: number;
  error?: string;
}

// ─── Data loading ────────────────────────────────────────────────────────────

interface MatchRow {
  id: number;
  home_team_id: number;
  away_team_id: number;
  date: string;
}

/** Scheduled fixtures in the prediction horizon. */
async function loadMatches(opts: PredictedLineupOptions): Promise<MatchRow[]> {
  if (opts.matchIds && opts.matchIds.length > 0) {
    return fetchAllRows<MatchRow>(
      db.from('matches').select('id, home_team_id, away_team_id, date').in('id', opts.matchIds),
    );
  }

  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const now = new Date().toISOString();
  const until = new Date(Date.now() + horizonDays * 86400000).toISOString();

  return fetchAllRows<MatchRow>(
    db
      .from('matches')
      .select('id, home_team_id, away_team_id, date')
      .eq('status', MUTABLE_MATCH_STATUS)
      .gte('date', now)
      .lte('date', until),
  );
}

interface SquadData {
  /** playerId -> the player row fields availability and positions need. */
  players: Map<number, PlayerRow>;
  /** playerId -> most recent season's statistics. */
  stats: Map<number, SeasonStatsRow>;
  /** playerId -> active injury record, when one exists. */
  injuries: Map<number, AvailabilityInjury>;
  /** playerId -> club their latest transfer moved them to. */
  latestTeams: Map<number, number>;
}

interface PlayerRow {
  id: number;
  team_id: number | null;
  position: string | null;
  primary_position: string | null;
  secondary_position: string | null;
  tertiary_position: string | null;
  current_injury: boolean | null;
  injury_status: string | null;
  injury_return_days: number | null;
  injury_end_timestamp: number | null;
  injury_updated_timestamp: number | null;
}

interface SeasonStatsRow {
  player_id: number;
  team_id: number;
  season_external_id: number;
  matches_started: number | null;
  appearances: number | null;
  minutes_played: number | null;
  total_rating: number | null;
  count_rating: number | null;
  goals: number | null;
  assists: number | null;
}

/**
 * Loads everything needed for the teams in scope, in four queries.
 *
 * Season statistics are resolved to the MOST RECENT SEASON ONLY.
 * player_season_statistics upserts on (player_id, season_external_id), so a
 * player accumulates one row per season as the platform covers more history —
 * summing across rows would mix this season's form with last season's totals.
 * Higher season_external_id means more recent, the same convention used by
 * resolveTeamSeasonContext() in syncSeasonStatistics.ts.
 */
async function loadSquadData(teamIds: number[]): Promise<SquadData> {
  const [statRows, playerRows] = await Promise.all([
    fetchAllRows<SeasonStatsRow>(
      db
        .from('player_season_statistics')
        .select(
          'player_id, team_id, season_external_id, matches_started, appearances, minutes_played, total_rating, count_rating, goals, assists',
        )
        .in('team_id', teamIds),
    ),
    fetchAllRows<PlayerRow>(
      db
        .from('players')
        .select(
          'id, team_id, position, primary_position, secondary_position, tertiary_position, current_injury, injury_status, injury_return_days, injury_end_timestamp, injury_updated_timestamp',
        )
        .in('team_id', teamIds),
    ),
  ]);

  const stats = new Map<number, SeasonStatsRow>();
  for (const row of statRows) {
    const existing = stats.get(row.player_id);
    if (existing && (existing.season_external_id ?? 0) >= (row.season_external_id ?? 0)) continue;
    stats.set(row.player_id, row);
  }

  const players = new Map<number, PlayerRow>(playerRows.map((p) => [p.id, p]));

  // Injuries and transfers are fetched unfiltered on purpose. Filtering by
  // `.in('player_id', [...thousands of ids])` serializes into a URL long
  // enough for the gateway to reject the request outright with a bare "Bad
  // Request" — a failure already hit and documented elsewhere in this
  // pipeline. Both tables are small enough to pull whole and index in memory.
  const injuries = new Map<number, AvailabilityInjury>();
  try {
    const injuryRows = await fetchAllRows<any>(
      db
        .from('player_injuries')
        .select('player_id, injury_status, expected_return_days, end_timestamp, updated_timestamp')
        .eq('active', true),
    );
    for (const row of injuryRows) {
      injuries.set(row.player_id, {
        injuryStatus: row.injury_status ?? null,
        expectedReturnDays: row.expected_return_days ?? null,
        endTimestamp: row.end_timestamp ?? null,
        updatedTimestamp: row.updated_timestamp ?? null,
      });
    }
  } catch (e: any) {
    // Degraded but not fatal: players.current_injury still carries the flag.
    logger.warn({ error: e.message }, 'player_injuries unavailable — falling back to players.current_injury');
  }

  let latestTeams = new Map<number, number>();
  try {
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const transfers = await fetchAllRows<any>(
      db
        .from('player_transfers')
        .select('player_id, to_team_id, transfer_date')
        .gte('transfer_date', yearAgo.toISOString().split('T')[0])
        .order('transfer_date', { ascending: false }),
    );
    latestTeams = resolveLatestTeams(transfers);
  } catch (e: any) {
    logger.warn({ error: e.message }, 'player_transfers unavailable — skipping transfer validation');
  }

  return { players, stats, injuries, latestTeams };
}

// ─── Candidate pool ──────────────────────────────────────────────────────────

interface TeamPool {
  candidates: ReturnType<typeof buildCandidates>['candidates'];
  normalizers: ReturnType<typeof buildCandidates>['normalizers'];
  exclusions: Map<UnavailabilityReason, number>;
}

/**
 * Builds one team's candidate pool as of a specific kickoff.
 *
 * Availability is match-relative — a player due back on Tuesday is available
 * for Saturday's fixture and unavailable for Sunday's — so the pool is keyed
 * by (team, match date) rather than by team alone.
 */
function buildTeamCandidatePool(teamId: number, matchDate: Date, squad: SquadData): TeamPool {
  const inputs: CandidateInput[] = [];
  const exclusions = new Map<UnavailabilityReason, number>();

  for (const [playerId, stat] of squad.stats) {
    if (stat.team_id !== teamId) continue;
    const player = squad.players.get(playerId);
    if (!player) continue;

    const availabilityPlayer: AvailabilityPlayer = {
      id: player.id,
      teamId: player.team_id,
      currentInjury: player.current_injury,
      injuryStatus: player.injury_status,
      injuryReturnDays: player.injury_return_days,
      injuryEndTimestamp: player.injury_end_timestamp,
      injuryUpdatedTimestamp: player.injury_updated_timestamp,
    };

    const availability = checkAvailability(
      availabilityPlayer,
      squad.injuries.get(playerId),
      matchDate,
      stat.team_id,
      squad.latestTeams.get(playerId),
    );

    if (!availability.available) {
      const reason = availability.reason!;
      exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);
      continue;
    }

    inputs.push({
      playerId,
      teamId,
      rawPositions: [player.primary_position, player.secondary_position, player.tertiary_position],
      broadPosition: player.position,
      stats: {
        matchesStarted: stat.matches_started ?? 0,
        appearances: stat.appearances ?? 0,
        minutesPlayed: stat.minutes_played ?? 0,
        totalRating: stat.total_rating ?? 0,
        countRating: stat.count_rating ?? 0,
        goals: stat.goals ?? 0,
        assists: stat.assists ?? 0,
      },
    });
  }

  const { candidates, normalizers } = buildCandidates(teamId, inputs);
  return { candidates, normalizers, exclusions };
}

// ─── Prediction ──────────────────────────────────────────────────────────────

/**
 * Predicts one team's XI, or returns null with a logged reason.
 *
 * Returning null rather than a short lineup is deliberate. A ten-player
 * "prediction" is not a degraded answer, it is a wrong one — every downstream
 * consumer (XI strength, key battles, department confidence) would silently
 * treat the missing player as a real absence.
 */
function predictLineup(teamId: number, pool: TeamPool, matchId: number): PredictedLineup | null {
  if (pool.candidates.length < 11) {
    logger.warn(
      { teamId, matchId, available: pool.candidates.length, exclusions: Object.fromEntries(pool.exclusions) },
      'Fewer than 11 available players — no lineup predicted',
    );
    return null;
  }

  if (!pool.candidates.some((c) => c.isGoalkeeper)) {
    logger.warn(
      { teamId, matchId, exclusions: Object.fromEntries(pool.exclusions) },
      'No available goalkeeper — aborting lineup rather than fielding an outfielder in goal',
    );
    return null;
  }

  const selection = selectBestFormation(pool.candidates);
  if (!selection) {
    logger.warn({ teamId, matchId }, 'No formation could be filled from the available squad');
    return null;
  }

  return assembleLineup({
    teamId,
    evaluation: selection.best,
    allCandidates: pool.candidates,
    formationMargin: selection.margin,
    normalizers: { maxStarts: pool.normalizers.maxStarts, maxMinutes: pool.normalizers.maxMinutes },
  });
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function buildLineupRows(matchId: number, lineup: PredictedLineup, calculatedAt: string): any[] {
  return lineup.players.map((p) => ({
    match_id: matchId,
    team_id: lineup.teamId,
    player_id: p.playerId,

    // position_code carries the TACTICAL slot as of migration 025 (it used to
    // hold the broad letter, which now lives in position_group).
    position_code: p.slot.code,
    tactical_position: p.slot.code,
    position_group: p.slot.group,
    natural_position: p.candidate.naturalPosition,

    formation: lineup.formation.name,
    lineup_order: p.slot.order,
    rank_in_position: p.rankInPosition,
    role: p.slot.role,
    x: p.slot.x,
    y: p.slot.y,

    confidence: p.confidence,
    weighted_score: round2(p.candidate.weightedScore),
    suitability: round3(p.suitability),
    matches_started: p.candidate.matchesStarted,
    minutes_played: p.candidate.minutesPlayed,
    // NULL by design — see the "recent form" note in lib/lineups/playerScoring.ts.
    // No genuine per-match appearance data exists to derive this from.
    recent_starts_score: null,

    is_captain: p.isCaptain,
    is_vice_captain: p.isViceCaptain,
    calculated_at: calculatedAt,
  }));
}

function buildFormationRow(matchId: number, lineup: PredictedLineup, calculatedAt: string): any {
  return {
    match_id: matchId,
    team_id: lineup.teamId,
    formation: lineup.formation.name,
    confidence: lineup.formationConfidence,
    formation_score: lineup.formationScore,
    out_of_position_count: lineup.outOfPositionCount,
    calculated_at: calculatedAt,
  };
}

/**
 * Writes both tables and removes rows superseded by this run.
 *
 * The cleanup is what replaces the old DELETE-then-INSERT: rather than
 * emptying the table up front, rows for the matches just processed whose
 * calculated_at predates this run are deleted AFTER the new rows are safely
 * committed. Those are exactly the players who were in a previous XI and are
 * not in the new one. A crash before this point leaves the old lineup intact
 * instead of leaving nothing at all.
 *
 * The cleanup is scoped to matches this run WROTE. One consequence worth
 * knowing: if a fixture's home XI was predicted but the away side could not be
 * (a fresh injury took the squad below eleven), the away side's older rows are
 * removed along with the home side's superseded ones. That is intentional — a
 * stale XI sitting next to a fresh one is a worse answer than no XI, and the
 * skip is logged with its reason — but it does mean a team can lose a
 * previously stored lineup without a replacement.
 */
async function savePredictedLineups(
  lineupRows: any[],
  formationRows: any[],
  matchIds: number[],
  runStartedAt: string,
): Promise<{ playersWritten: number; formationsWritten: number; staleRowsRemoved: number }> {
  let playersWritten = 0;
  for (let i = 0; i < lineupRows.length; i += CHUNK_SIZE) {
    const chunk = lineupRows.slice(i, i + CHUNK_SIZE);
    const { error } = await db
      .from('match_predicted_lineups')
      .upsert(chunk, { onConflict: 'match_id,team_id,player_id' });
    if (error) throw new Error(`match_predicted_lineups upsert failed: ${error.message}`);
    playersWritten += chunk.length;
  }

  let formationsWritten = 0;
  for (let i = 0; i < formationRows.length; i += CHUNK_SIZE) {
    const chunk = formationRows.slice(i, i + CHUNK_SIZE);
    const { error } = await db
      .from('match_predicted_formations')
      .upsert(chunk, { onConflict: 'match_id,team_id' });
    if (error) throw new Error(`match_predicted_formations upsert failed: ${error.message}`);
    formationsWritten += chunk.length;
  }

  let staleRowsRemoved = 0;
  for (let i = 0; i < matchIds.length; i += CHUNK_SIZE) {
    const chunk = matchIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await db
      .from('match_predicted_lineups')
      .delete()
      .in('match_id', chunk)
      .lt('calculated_at', runStartedAt)
      .select('id');
    if (error) {
      // Non-fatal: the current XI is already written and correct. Leftover
      // rows from a previous shape would show as extra players, so this is
      // worth surfacing, but it is not a reason to fail the run.
      logger.warn({ error: error.message }, 'Stale predicted-lineup cleanup failed — duplicates may remain');
      continue;
    }
    staleRowsRemoved += data?.length ?? 0;
  }

  return { playersWritten, formationsWritten, staleRowsRemoved };
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export async function processPredictedLineups(
  opts: PredictedLineupOptions = {},
): Promise<PredictedLineupResult> {
  const startedAt = Date.now();
  const runStartedAt = new Date().toISOString();
  logger.info('processPredictedLineups v2 started — DB only, zero API calls');

  const empty: PredictedLineupResult = {
    matchesProcessed: 0,
    teamsProcessed: 0,
    playersWritten: 0,
    formationsWritten: 0,
    teamsSkipped: 0,
    staleRowsRemoved: 0,
  };

  try {
    const matches = await loadMatches(opts);
    if (matches.length === 0) {
      logger.info('No scheduled matches in the prediction horizon');
      return empty;
    }

    const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean))];
    const squad = await loadSquadData(teamIds);

    if (squad.stats.size === 0) {
      logger.warn('No season statistics for any team in scope — run sync:player-stats first');
      return empty;
    }

    logger.info(
      { matches: matches.length, teams: teamIds.length, playersWithStats: squad.stats.size },
      'Predicting lineups',
    );

    // Candidate pools are keyed by (team, kickoff day): two fixtures on the
    // same day share a pool, fixtures on different days do not, because
    // availability moves with the date.
    const poolCache = new Map<string, TeamPool>();
    const lineupRows: any[] = [];
    const formationRows: any[] = [];
    const formationCounts = new Map<string, number>();
    let teamsProcessed = 0;
    let teamsSkipped = 0;
    let confidenceSum = 0;

    for (const match of matches) {
      const matchDate = new Date(match.date);
      const dayKey = match.date.slice(0, 10);

      for (const teamId of [match.home_team_id, match.away_team_id]) {
        if (!teamId) continue;

        const cacheKey = `${teamId}:${dayKey}`;
        let pool = poolCache.get(cacheKey);
        if (!pool) {
          pool = buildTeamCandidatePool(teamId, matchDate, squad);
          poolCache.set(cacheKey, pool);
        }

        const lineup = predictLineup(teamId, pool, match.id);
        if (!lineup) {
          teamsSkipped++;
          continue;
        }

        const captain = lineup.players.find((p) => p.isCaptain);
        const viceCaptain = lineup.players.find((p) => p.isViceCaptain);
        const avgConfidence =
          lineup.players.reduce((sum, p) => sum + p.confidence, 0) / lineup.players.length;

        logger.debug(
          {
            matchId: match.id,
            teamId,
            formation: lineup.formation.name,
            formationScore: lineup.formationScore,
            formationConfidence: lineup.formationConfidence,
            outOfPosition: lineup.outOfPositionCount,
            avgConfidence: round3(avgConfidence),
            captain: captain?.playerId ?? null,
            viceCaptain: viceCaptain?.playerId ?? null,
            excluded: Object.fromEntries(pool.exclusions),
          },
          'Predicted XI',
        );

        lineupRows.push(...buildLineupRows(match.id, lineup, runStartedAt));
        formationRows.push(buildFormationRow(match.id, lineup, runStartedAt));
        formationCounts.set(
          lineup.formation.name,
          (formationCounts.get(lineup.formation.name) ?? 0) + 1,
        );
        confidenceSum += avgConfidence;
        teamsProcessed++;
      }
    }

    if (lineupRows.length === 0) {
      logger.warn({ teamsSkipped }, 'No lineups generated — check squad availability and player statistics');
      return { ...empty, teamsSkipped };
    }

    const processedMatchIds = [...new Set(lineupRows.map((r) => r.match_id))];
    const written = await savePredictedLineups(
      lineupRows,
      formationRows,
      processedMatchIds,
      runStartedAt,
    );

    const result: PredictedLineupResult = {
      matchesProcessed: processedMatchIds.length,
      teamsProcessed,
      teamsSkipped,
      ...written,
    };

    logger.info(
      {
        ...result,
        avgConfidence: round3(confidenceSum / Math.max(1, teamsProcessed)),
        formations: Object.fromEntries(
          [...formationCounts.entries()].sort((a, b) => b[1] - a[1]),
        ),
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
      'processPredictedLineups completed',
    );

    return result;
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'processPredictedLineups failed');
    return { ...empty, error: error.message };
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
