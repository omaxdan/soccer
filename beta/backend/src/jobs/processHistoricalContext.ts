import { db } from '../db/client';
import { logger } from '../utils/logger';
import { fetchAllRows } from '../db/fetchAllRows';

/**
 * HISTORICAL CONTEXT ENGINE  (migration 028)
 *
 * Rebuilds the league table AS IT STOOD before every match by replaying
 * finished results in date order per (tournament_id, season_id) group, then
 * writes:
 *
 *   team_match_snapshots   — pre-kickoff state of each participant
 *   match_opponent_context — pre-kickoff state of each participant's OPPONENT
 *
 * Core rule: no future leakage. A snapshot may only contain information
 * that existed before that match kicked off. This is what makes the
 * Phase 3 backtest harness honest.
 *
 * Rating enrichment (honest-nullability, see 028 comments):
 *   readiness_before        ← readiness_history (true pre-match archive)
 *   form_rating_before      ← team_intelligence_history nearest ≤ date (≤14d)
 *   strength_rating_before  ← current team_strength_ratings, ONLY for
 *                             matches within LIVE_STRENGTH_WINDOW_DAYS of
 *                             now (backfilled history stays NULL — there is
 *                             no historical strength source and we refuse
 *                             to fake one).
 *
 * Opponent quality (single source of truth for the formula):
 *   quality = 100 × (0.6 × posPercentile + 0.4 × min(1, ppg / leaderPpg))
 *   posPercentile = 1 − (pos−1)/(N−1) over teams with ≥1 game (N>1)
 *   quality & rank_band are NULL when the opponent had played <1 game.
 *
 * EARLY SEASON OPTIMIZATION: Teams with 1-3 games get position-based quality
 * (fallback) to accumulate data faster. Full quality calculation requires 4+ games.
 *
 * Modes:
 *   processHistoricalContextBackfill()      — all finished + upcoming matches
 *   processHistoricalContextRecent(days=3)  — groups touched in the window;
 *                                             writes only window + upcoming rows
 *
 * Idempotent — upserts on (match_id, team_id).
 */

const MIN_OPP_GAMES_FOR_FULL_QUALITY = 4;
const MIN_OPP_GAMES_FOR_BASIC_QUALITY = 1;
const UPCOMING_HORIZON_DAYS = 7;
const LIVE_STRENGTH_WINDOW_DAYS = 2;
const FORM_INDEX_MAX_STALENESS_DAYS = 14;
const UPSERT_BATCH = 200;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface MatchRow {
  id: number;
  home_team_id: number;
  away_team_id: number;
  date: string;
  status: string;
  tournament_id: number | null;
  season_id: number | null;
  competition: string | null;
  season: string | null;
}

interface ResultRow {
  match_id: number;
  home_score: number | null;
  away_score: number | null;
  status: string;
}

interface Accumulator {
  points: number;
  games: number;
  gf: number;
  ga: number;
  recentPoints: number[]; // rolling, capped at 5, most recent last
}

interface SnapshotRow {
  match_id: number;
  team_id: number;
  is_home: boolean;
  league_position_before: number | null;
  points_before: number;
  games_played_before: number;
  goal_diff_before: number;
  ppg_before: number | null;
  points_last5_before: number | null;
  form_rating_before: number | null;
  readiness_before: number | null;
  strength_rating_before: number | null;
  calculated_at: string;
}

interface ContextRow {
  match_id: number;
  team_id: number;
  opponent_team_id: number;
  opponent_position_before: number | null;
  opponent_points_before: number | null;
  opponent_ppg_before: number | null;
  opponent_form_before: number | null;
  opponent_rank_band: 'top' | 'middle' | 'bottom' | null;
  opponent_quality_score: number | null;
  calculated_at: string;
}

function groupKey(m: MatchRow): string {
  if (m.tournament_id != null && m.season_id != null) {
    return `t${m.tournament_id}:s${m.season_id}`;
  }
  // Fallback for rows 023's FK backfill couldn't match
  return `c${m.competition ?? '?'}::${m.season ?? '?'}`;
}

/** Table position among teams with ≥1 game: points desc, GD desc, GF desc. */
function computeTable(accs: Map<number, Accumulator>): {
  order: number[];               // team ids, best first
  position: Map<number, number>; // 1-based
} {
  const order = [...accs.entries()]
    .filter(([, a]) => a.games > 0)
    .sort(([, a], [, b]) =>
      b.points - a.points ||
      (b.gf - b.ga) - (a.gf - a.ga) ||
      b.gf - a.gf
    )
    .map(([teamId]) => teamId);
  const position = new Map<number, number>();
  order.forEach((teamId, i) => position.set(teamId, i + 1));
  return { order, position };
}

function rankBand(pos: number, tableSize: number): 'top' | 'middle' | 'bottom' {
  const third = Math.ceil(tableSize / 3);
  if (pos <= third) return 'top';
  if (pos <= 2 * third) return 'middle';
  return 'bottom';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sum(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0);
}

/** Nearest form_index snapshot ≤ date within staleness window (sorted asc input). */
function nearestFormIndex(
  history: Array<{ date: number; form: number }> | undefined,
  matchTs: number
): number | null {
  if (!history || history.length === 0) return null;
  let lo = 0, hi = history.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].date <= matchTs) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (best === -1) return null;
  const ageDays = (matchTs - history[best].date) / 86_400_000;
  return ageDays <= FORM_INDEX_MAX_STALENESS_DAYS ? history[best].form : null;
}

/**
 * Validate a row before sending to the database
 */
function validateContextRow(row: ContextRow): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (row.match_id == null || row.match_id <= 0) {
    errors.push('match_id is required and must be positive');
  }
  if (row.team_id == null || row.team_id <= 0) {
    errors.push('team_id is required and must be positive');
  }
  if (row.opponent_team_id == null || row.opponent_team_id <= 0) {
    errors.push('opponent_team_id is required and must be positive');
  }
  if (row.opponent_team_id === row.team_id) {
    errors.push('team_id and opponent_team_id cannot be the same');
  }
  if (row.opponent_rank_band && !['top', 'middle', 'bottom'].includes(row.opponent_rank_band)) {
    errors.push(`invalid opponent_rank_band: ${row.opponent_rank_band}`);
  }
  if (row.opponent_quality_score != null && (row.opponent_quality_score < 0 || row.opponent_quality_score > 100)) {
    errors.push(`opponent_quality_score out of range: ${row.opponent_quality_score}`);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Upsert with retry logic and exponential backoff
 */
async function upsertBatchedWithRetry(
  table: string, 
  rows: any[], 
  onConflict: string,
  maxRetries: number = MAX_RETRIES
): Promise<{ written: number; totalRows: number }> {
  if (rows.length === 0) {
    logger.info({ table }, 'No rows to upsert');
    return { written: 0, totalRows: 0 };
  }

  // Validate rows before upsert for match_opponent_context
  if (table === 'match_opponent_context') {
    const invalidRows: Array<{ index: number; row: any; errors: string[] }> = [];
    for (let i = 0; i < rows.length; i++) {
      const result = validateContextRow(rows[i]);
      if (!result.valid) {
        invalidRows.push({ index: i, row: rows[i], errors: result.errors });
      }
    }
    
    if (invalidRows.length > 0) {
      const sample = invalidRows.slice(0, 5);
      logger.error(
        { 
          invalidCount: invalidRows.length,
          sample: sample.map(r => ({
            index: r.index,
            match_id: r.row.match_id,
            team_id: r.row.team_id,
            opponent_team_id: r.row.opponent_team_id,
            errors: r.errors
          }))
        },
        `Found ${invalidRows.length} invalid rows in match_opponent_context`
      );
      throw new Error(`Found ${invalidRows.length} invalid rows in match_opponent_context. Check logs for details.`);
    }
  }

  let totalWritten = 0;
  const totalRows = rows.length;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const slice = rows.slice(i, i + UPSERT_BATCH);
    let attempt = 0;
    let lastError: any;

    while (attempt < maxRetries) {
      try {
        if (i % (UPSERT_BATCH * 5) === 0 || i === 0) {
          logger.info(
            { 
              table, 
              offset: i, 
              batchSize: slice.length, 
              total: rows.length,
              progress: `${Math.round((i / rows.length) * 100)}%`
            },
            `Upserting ${table}`
          );
        }

        const { error } = await db.from(table).upsert(slice, { 
          onConflict,
          returning: 'minimal'
        });
        
        if (error) {
          logger.error(
            { 
              table, 
              offset: i, 
              error: error,
              errorMessage: error.message,
              errorDetails: error.details,
              errorCode: error.code,
              sliceLength: slice.length,
              firstRow: slice[0]
            },
            `Error upserting ${table}`
          );
          throw error;
        }
        
        totalWritten += slice.length;
        logger.debug(
          { table, offset: i, written: slice.length, totalWritten },
          'Batch upsert successful'
        );
        break;

      } catch (err) {
        lastError = err;
        attempt++;
        
        const errorMessage = err instanceof Error ? err.message : String(err);
        const isNetworkError = 
          errorMessage.includes('fetch failed') ||
          errorMessage.includes('network') ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('ETIMEDOUT');

        if (attempt < maxRetries && isNetworkError) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          logger.warn(
            { 
              table, 
              offset: i, 
              attempt, 
              maxRetries, 
              delay,
              error: errorMessage
            },
            `Upsert failed, retrying in ${delay}ms...`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          if (attempt === maxRetries) {
            throw new Error(
              `${table} upsert failed at offset ${i} after ${maxRetries} attempts: ${errorMessage}`
            );
          }
          throw err;
        }
      }
    }

    // Small delay between batches to prevent rate limiting
    if (i + UPSERT_BATCH < rows.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return { written: totalWritten, totalRows };
}

async function run(mode: 'backfill' | 'recent', recentDays: number) {
  const now = Date.now();
  const horizonIso = new Date(now + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString();
  const windowStartIso = new Date(now - recentDays * 86_400_000).toISOString();

  logger.info({ mode, recentDays }, 'Historical context: loading inputs');

  try {
    // ── Inputs (all reads paginated per beta rule) ────────────────────────────
    const matches = await fetchAllRows<MatchRow>(
      db.from('matches')
        .select('id, home_team_id, away_team_id, date, status, tournament_id, season_id, competition, season')
        .lte('date', horizonIso)
    );

    const results = await fetchAllRows<ResultRow>(
      db.from('match_results')
        .select('match_id, home_score, away_score, status')
    );
    const resultByMatch = new Map(results.map(r => [r.match_id, r]));

    const readinessRows = await fetchAllRows<any>(
      db.from('readiness_history')
        .select('match_id, home_team_id, away_team_id, home_readiness, away_readiness')
    );
    const readinessByMatch = new Map(readinessRows.map(r => [r.match_id, r]));

    const tihRows = await fetchAllRows<any>(
      db.from('team_intelligence_history')
        .select('team_id, snapshot_date, form_index')
        .not('form_index', 'is', null)
    );
    const formHistoryByTeam = new Map<number, Array<{ date: number; form: number }>>();
    for (const r of tihRows) {
      const list = formHistoryByTeam.get(r.team_id) ?? [];
      list.push({ date: new Date(r.snapshot_date).getTime(), form: Number(r.form_index) });
      formHistoryByTeam.set(r.team_id, list);
    }
    for (const list of formHistoryByTeam.values()) list.sort((a, b) => a.date - b.date);

    const strengthRows = await fetchAllRows<any>(
      db.from('team_strength_ratings').select('team_id, strength_score')
    );
    const currentStrength = new Map<number, number>(
      strengthRows
        .filter((r: any) => r.strength_score != null)
        .map((r: any) => [r.team_id, Number(r.strength_score)])
    );

    // ── NEW: Load standings from tournament_standings ──────────────────────
    const standingsRows = await fetchAllRows<any>(
      db.from('tournament_standings')
        .select('tournament_id, team_id, season_external_id, position, points, matches')
        .order('season_external_id', { ascending: false })
    );

    // Build standings map: key = `${tournament_id}:${season_external_id}`
    const standingsMap = new Map<string, Map<number, { position: number; points: number; matches: number }>>();
    for (const s of standingsRows) {
      const key = `${s.tournament_id}:${s.season_external_id}`;
      if (!standingsMap.has(key)) {
        standingsMap.set(key, new Map());
      }
      standingsMap.get(key)!.set(s.team_id, {
        position: s.position,
        points: s.points,
        matches: s.matches
      });
    }

    // ── NEW: Map season_id to season_external_id ──────────────────────────
    const seasonRows = await fetchAllRows<any>(
      db.from('seasons').select('id, external_id, tournament_id')
    );
    const seasonExternalMap = new Map<number, number>();
    for (const s of seasonRows) {
      seasonExternalMap.set(s.id, s.external_id);
    }

    logger.info({ 
      standingsCount: standingsRows.length, 
      standingsKeys: standingsMap.size,
      seasonMapSize: seasonExternalMap.size
    }, 'Standings and season mappings loaded');

    // ── Group + order ─────────────────────────────────────────────────────────
    const isFinished = (m: MatchRow) => {
      const r = resultByMatch.get(m.id);
      return !!r && r.home_score != null && r.away_score != null &&
        (r.status === 'finished' || m.status === 'finished');
    };
    const isUpcoming = (m: MatchRow) =>
      !isFinished(m) && new Date(m.date).getTime() >= now - 6 * 3_600_000;

    const groups = new Map<string, MatchRow[]>();
    for (const m of matches) {
      if (!isFinished(m) && !isUpcoming(m)) continue;
      const key = groupKey(m);
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    }

    let groupKeys = [...groups.keys()];
    if (mode === 'recent') {
      const windowStart = new Date(windowStartIso).getTime();
      groupKeys = groupKeys.filter(key =>
        groups.get(key)!.some(m => new Date(m.date).getTime() >= windowStart)
      );
    }

    logger.info({ 
      totalGroups: groups.size, 
      groupsToProcess: groupKeys.length,
      totalMatches: matches.length 
    }, 'Historical context: grouping complete');

    const snapshotRows: SnapshotRow[] = [];
    const contextRows: ContextRow[] = [];
    const nowIso = new Date().toISOString();
    let replayed = 0;
    let fallbackQualityCount = 0;
    let fullQualityCount = 0;
    let standingsUsedCount = 0;

    // ── Process groups ──────────────────────────────────────────────────────
    for (let gIdx = 0; gIdx < groupKeys.length; gIdx++) {
      const key = groupKeys[gIdx];
      
      if (gIdx % 10 === 0) {
        logger.info(
          { group: gIdx + 1, total: groupKeys.length, key },
          'Processing group'
        );
      }

      const groupMatches = groups.get(key)!
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);

      const accs = new Map<number, Accumulator>();
      const acc = (teamId: number): Accumulator => {
        let a = accs.get(teamId);
        if (!a) { a = { points: 0, games: 0, gf: 0, ga: 0, recentPoints: [] }; accs.set(teamId, a); }
        return a;
      };

      // ── Get standings for this group if available ──
      const firstMatch = groupMatches[0];
      const seasonExtId = seasonExternalMap.get(firstMatch.season_id ?? 0) ?? 0;
      const standingsKey = `${firstMatch.tournament_id}:${seasonExtId}`;
      const tournamentStandings = standingsMap.get(standingsKey);

      for (const m of groupMatches) {
        const matchTs = new Date(m.date).getTime();
        const finished = isFinished(m);
        const writeThis =
          mode === 'backfill' ||
          matchTs >= new Date(windowStartIso).getTime();

        if (writeThis) {
          const { order, position } = computeTable(accs);
          const tableSize = order.length;
          const leaderPpg = tableSize > 0
            ? Math.max(...order.map(id => {
                const a = accs.get(id)!;
                return a.games > 0 ? a.points / a.games : 0;
              }))
            : 0;
          const readiness = readinessByMatch.get(m.id);
          const liveWindow = Math.abs(matchTs - now) <= LIVE_STRENGTH_WINDOW_DAYS * 86_400_000;

          for (const side of ['home', 'away'] as const) {
            const teamId = side === 'home' ? m.home_team_id : m.away_team_id;
            const oppId  = side === 'home' ? m.away_team_id : m.home_team_id;
            const a = acc(teamId);
            const o = acc(oppId);

            snapshotRows.push({
              match_id: m.id,
              team_id: teamId,
              is_home: side === 'home',
              league_position_before: position.get(teamId) ?? null,
              points_before: a.points,
              games_played_before: a.games,
              goal_diff_before: a.gf - a.ga,
              ppg_before: a.games > 0 ? round2(a.points / a.games) : null,
              points_last5_before: a.games > 0 ? sum(a.recentPoints) : null,
              form_rating_before: nearestFormIndex(formHistoryByTeam.get(teamId), matchTs),
              readiness_before: readiness
                ? Number(side === 'home' ? readiness.home_readiness : readiness.away_readiness)
                : null,
              strength_rating_before: liveWindow ? (currentStrength.get(teamId) ?? null) : null,
              calculated_at: nowIso,
            });

            // ─── OPPONENT CONTEXT ──────────────────────────────────────────
            // For scheduled/upcoming matches, use tournament_standings if available
            // For finished matches, use the accumulator (historical accuracy)
            let oppPos: number | null = null;
            let oppPoints = o.points;
            let oppGames = o.games;

            // Check if this is an upcoming/scheduled match
            const isScheduled = !finished && m.status === 'scheduled';

            if (isScheduled && tournamentStandings) {
              // Use tournament_standings for scheduled matches
              const oppStanding = tournamentStandings.get(oppId);
              if (oppStanding) {
                oppPos = oppStanding.position;
                oppPoints = oppStanding.points;
                oppGames = oppStanding.matches;
                standingsUsedCount++;
              } else {
                // Fallback to accumulator if no standings found
                oppPos = position.get(oppId) ?? null;
              }
            } else {
              // Use accumulator for finished matches
              oppPos = position.get(oppId) ?? null;
            }

            const hasPosition = oppPos != null && oppGames > 0;
            
            let quality: number | null = null;
            let band: ContextRow['opponent_rank_band'] = null;

            // Always assign rank band and quality if opponent has at least 1 game
            if (hasPosition && oppGames >= MIN_OPP_GAMES_FOR_BASIC_QUALITY) {
              // Assign rank band based on position
              band = rankBand(oppPos!, Math.max(tableSize, 16)); // Use 16 as fallback for league size
              
              // Calculate position percentile (0 to 1, where 1 is best)
              const posPct = 1 - (oppPos! - 1) / (Math.max(tableSize, 16) - 1);
              
              // Ensure posPct is between 0 and 1
              const clampedPosPct = Math.max(0, Math.min(1, posPct));
              
              if (oppGames >= MIN_OPP_GAMES_FOR_FULL_QUALITY) {
                // Full quality calculation (4+ games)
                const oppPpg = oppPoints / oppGames;
                const ppgRatio = leaderPpg > 0 ? Math.min(1, Math.max(0, oppPpg / leaderPpg)) : 0;
                // Calculate and clamp between 0 and 100
                const rawQuality = 100 * (0.6 * clampedPosPct + 0.4 * ppgRatio);
                quality = Math.max(0, Math.min(100, round2(rawQuality)));
                fullQualityCount++;
              } else {
                // Fallback for early season (1-3 games)
                const gamesFactor = oppGames / MIN_OPP_GAMES_FOR_FULL_QUALITY;
                const ppgEstimate = 0.3 + (gamesFactor * 0.4);
                // Calculate and clamp between 0 and 100
                const rawQuality = 100 * (0.6 * clampedPosPct + 0.4 * ppgEstimate);
                quality = Math.max(0, Math.min(100, round2(rawQuality)));
                fallbackQualityCount++;
                
                if (fallbackQualityCount <= 5) {
                  logger.debug(
                    { 
                      teamId: oppId, 
                      games: oppGames, 
                      position: oppPos,
                      positionPercentile: round2(clampedPosPct),
                      quality,
                      band,
                      source: isScheduled && tournamentStandings ? 'standings' : 'accumulator'
                    },
                    'Using fallback quality for early-season team'
                  );
                }
              }
            }

            contextRows.push({
              match_id: m.id,
              team_id: teamId,
              opponent_team_id: oppId,
              opponent_position_before: oppPos,
              opponent_points_before: oppPoints,
              opponent_ppg_before: oppGames > 0 ? round2(oppPoints / oppGames) : null,
              opponent_form_before: oppGames > 0 ? sum(o.recentPoints) : null,
              opponent_rank_band: band,
              opponent_quality_score: quality,
              calculated_at: nowIso,
            });
          }
        }

        // Advance accumulators AFTER snapshotting (pre-kickoff semantics)
        if (finished) {
          const r = resultByMatch.get(m.id)!;
          const hs = r.home_score!, as = r.away_score!;
          const hp = hs > as ? 3 : hs === as ? 1 : 0;
          const ap = as > hs ? 3 : hs === as ? 1 : 0;
          const home = acc(m.home_team_id), away = acc(m.away_team_id);
          home.points += hp; home.games += 1; home.gf += hs; home.ga += as;
          away.points += ap; away.games += 1; away.gf += as; away.ga += hs;
          home.recentPoints.push(hp); if (home.recentPoints.length > 5) home.recentPoints.shift();
          away.recentPoints.push(ap); if (away.recentPoints.length > 5) away.recentPoints.shift();
          replayed++;
        }
      }
    }

    logger.info(
      { 
        groups: groupKeys.length, 
        replayed, 
        snapshots: snapshotRows.length,
        contexts: contextRows.length,
        fullQualityCount,
        fallbackQualityCount,
        standingsUsedCount
      },
      'Historical context: replay complete, writing'
    );

    // ── Write with retry logic ──────────────────────────────────────────────
    let snapshotsWritten = 0;
    let contextsWritten = 0;

    if (snapshotRows.length > 0) {
      logger.info({ count: snapshotRows.length }, 'Writing team_match_snapshots...');
      const result = await upsertBatchedWithRetry('team_match_snapshots', snapshotRows, 'match_id,team_id');
      snapshotsWritten = result.written;
      logger.info({ written: snapshotsWritten, total: snapshotRows.length }, 'team_match_snapshots written');
    }

    if (contextRows.length > 0) {
      logger.info({ count: contextRows.length }, 'Writing match_opponent_context...');
      const result = await upsertBatchedWithRetry('match_opponent_context', contextRows, 'match_id,team_id');
      contextsWritten = result.written;
      logger.info({ written: contextsWritten, total: contextRows.length }, 'match_opponent_context written');
    }

    logger.info(
      { 
        snapshots: snapshotsWritten, 
        contexts: contextsWritten,
        totalGroups: groupKeys.length,
        replayedMatches: replayed,
        fullQualityCount,
        fallbackQualityCount,
        standingsUsedCount
      },
      'Historical context: write complete'
    );
    
    return { 
      groups: groupKeys.length, 
      replayedMatches: replayed, 
      rowsWritten: snapshotsWritten + contextsWritten,
      snapshotsWritten,
      contextsWritten,
      fullQualityCount,
      fallbackQualityCount,
      standingsUsedCount
    };

  } catch (error: any) {
    logger.error(
      { 
        error: error.message || String(error),
        stack: error.stack,
        mode,
        recentDays,
        errorCode: error.code,
        errorDetails: error.details
      },
      'Historical context: processing failed'
    );
    throw error;
  }
}

export async function processHistoricalContextBackfill() {
  logger.info('Starting historical context backfill (full replay)...');
  const result = await run('backfill', 0);
  logger.info(
    { 
      groups: result.groups,
      replayedMatches: result.replayedMatches,
      rowsWritten: result.rowsWritten,
      snapshotsWritten: result.snapshotsWritten,
      contextsWritten: result.contextsWritten,
      fullQualityCount: result.fullQualityCount,
      fallbackQualityCount: result.fallbackQualityCount
    },
    'Historical context backfill complete'
  );
  return result;
}

export async function processHistoricalContextRecent(days = 3) {
  logger.info({ days }, 'Starting historical context recent update...');
  const result = await run('recent', days);
  logger.info(
    { 
      days,
      groups: result.groups,
      replayedMatches: result.replayedMatches,
      rowsWritten: result.rowsWritten,
      fullQualityCount: result.fullQualityCount,
      fallbackQualityCount: result.fallbackQualityCount
    },
    'Historical context recent update complete'
  );
  return result;
}

// Export for CLI usage
export default {
  processHistoricalContextBackfill,
  processHistoricalContextRecent
};