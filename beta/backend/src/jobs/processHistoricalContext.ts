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
 *   quality & rank_band are NULL when the opponent had played <4 games.
 *
 * Modes:
 *   processHistoricalContextBackfill()      — all finished + upcoming matches
 *   processHistoricalContextRecent(days=3)  — groups touched in the window;
 *                                             writes only window + upcoming rows
 *
 * Idempotent — upserts on (match_id, team_id).
 */

const MIN_OPP_GAMES_FOR_QUALITY = 4;
const UPCOMING_HORIZON_DAYS = 7;
const LIVE_STRENGTH_WINDOW_DAYS = 2;
const FORM_INDEX_MAX_STALENESS_DAYS = 14;
const UPSERT_BATCH = 500;

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

async function upsertBatched(table: string, rows: any[], onConflict: string) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const slice = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await db.from(table).upsert(slice, { onConflict });
    if (error) throw new Error(`${table} upsert failed at offset ${i}: ${error.message}`);
  }
}

async function run(mode: 'backfill' | 'recent', recentDays: number) {
  const now = Date.now();
  const horizonIso = new Date(now + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString();
  const windowStartIso = new Date(now - recentDays * 86_400_000).toISOString();

  logger.info({ mode, recentDays }, 'Historical context: loading inputs');

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

  // ── Group + order ─────────────────────────────────────────────────────────
  const isFinished = (m: MatchRow) => {
    const r = resultByMatch.get(m.id);
    return !!r && r.home_score != null && r.away_score != null &&
      (r.status === 'finished' || m.status === 'finished');
  };
  const isUpcoming = (m: MatchRow) =>
    !isFinished(m) && new Date(m.date).getTime() >= now - 6 * 3_600_000; // small grace for in-play

  const groups = new Map<string, MatchRow[]>();
  for (const m of matches) {
    if (!isFinished(m) && !isUpcoming(m)) continue; // skip stale unfinished rows
    const key = groupKey(m);
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  // Recent mode: replay only groups touched in the window (replay is free;
  // the restriction is about WRITE volume, handled below).
  let groupKeys = [...groups.keys()];
  if (mode === 'recent') {
    const windowStart = new Date(windowStartIso).getTime();
    groupKeys = groupKeys.filter(key =>
      groups.get(key)!.some(m => new Date(m.date).getTime() >= windowStart)
    );
  }

  const snapshotRows: SnapshotRow[] = [];
  const contextRows: ContextRow[] = [];
  const nowIso = new Date().toISOString();
  let replayed = 0;

  for (const key of groupKeys) {
    const groupMatches = groups.get(key)!
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id - b.id);

    const accs = new Map<number, Accumulator>();
    const acc = (teamId: number): Accumulator => {
      let a = accs.get(teamId);
      if (!a) { a = { points: 0, games: 0, gf: 0, ga: 0, recentPoints: [] }; accs.set(teamId, a); }
      return a;
    };

    for (const m of groupMatches) {
      const matchTs = new Date(m.date).getTime();
      const finished = isFinished(m);
      const writeThis =
        mode === 'backfill' ||
        matchTs >= new Date(windowStartIso).getTime(); // recent: window + upcoming only

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

          const oppPos = position.get(oppId) ?? null;
          const oppQualityEligible = o.games >= MIN_OPP_GAMES_FOR_QUALITY &&
            oppPos != null && tableSize > 1;
          let quality: number | null = null;
          let band: ContextRow['opponent_rank_band'] = null;
          if (oppQualityEligible) {
            const posPct = 1 - (oppPos! - 1) / (tableSize - 1);
            const oppPpg = o.points / o.games;
            const ppgRatio = leaderPpg > 0 ? Math.min(1, oppPpg / leaderPpg) : 0;
            quality = round2(100 * (0.6 * posPct + 0.4 * ppgRatio));
            band = rankBand(oppPos!, tableSize);
          }

          contextRows.push({
            match_id: m.id,
            team_id: teamId,
            opponent_team_id: oppId,
            opponent_position_before: oppPos,
            opponent_points_before: o.points,
            opponent_ppg_before: o.games > 0 ? round2(o.points / o.games) : null,
            opponent_form_before: o.games > 0 ? sum(o.recentPoints) : null,
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
    { groups: groupKeys.length, replayed, snapshots: snapshotRows.length },
    'Historical context: replay complete, writing'
  );

  await upsertBatched('team_match_snapshots', snapshotRows, 'match_id,team_id');
  await upsertBatched('match_opponent_context', contextRows, 'match_id,team_id');

  logger.info(
    { snapshots: snapshotRows.length, contexts: contextRows.length },
    'Historical context: write complete'
  );
  return { groups: groupKeys.length, replayedMatches: replayed, rowsWritten: snapshotRows.length };
}

export async function processHistoricalContextBackfill() {
  return run('backfill', 0);
}

export async function processHistoricalContextRecent(days = 3) {
  return run('recent', days);
}
