/**
 * SEASON STATISTICS SYNC — player-level and team-level season aggregates
 *
 * Sources (confirmed response structure from real API samples):
 *   GET /teams/{teamId}/tournament/{tournamentId}/season/{seasonId}/player-statistics
 *   GET /teams/{teamId}/tournament/{tournamentId}/season/{seasonId}/statistics
 *
 * Writes:
 *   player_season_statistics  — rating, minutesPlayed, matchesStarted, appearances
 *                                (the core signal for the derived "Likely XI")
 *   team_season_statistics    — goals/possession/duels/cards season aggregates
 *
 * ── CADENCE MODEL — invoke DAILY, not periodically ──────────────────────────
 * Correcting an earlier design mistake: these were originally documented as
 * "run once every 21 days" — but the 21-day COOLDOWN only prevents
 * re-processing a team too soon; it does nothing to cap how many teams are
 * eligible in a single run. On a cold start (no prior syncs), EVERY tracked
 * team is simultaneously "due", so a single invocation with no other limit
 * would attempt all of them at once — for 404+ teams, that's 2-4x the
 * entire daily API budget in one script run.
 *
 * The correct model mirrors sync:squads:v2: invoke this command DAILY via
 * cron. maxTeams below caps each invocation to a safe daily slice; the
 * cooldown then naturally staggers full coverage across ~21 days, exactly
 * like squad sync staggers across 7. "Every 21 days" was wrong; "daily,
 * self-throttling via cooldown + cap" is correct.
 *
 * Cooldowns + per-run caps (766 teams / 21 days ≈ 36/day steady-state):
 *   player-statistics: 21-day cooldown, capped at 40 teams/run
 *   team-statistics:   21-day cooldown, capped at 40 teams/run
 *
 * Optional country scoping (like sync:squads:countries:v2) lets you
 * deliberately bootstrap specific regions first during initial backfill,
 * independent of the cap/cooldown mechanism.
 *
 * PREREQUISITE: requires tournaments.external_id to be the CORRECT
 * uniqueTournament.id (see migration 007 + the syncDateMasterFeed.ts fix) —
 * these endpoints are scoped by that exact ID in the URL path. If a team's
 * primary tracked tournament can't be resolved, that team is skipped (logged,
 * not silently dropped) rather than guessing a wrong tournament/season.
 *
 * Also requires players to already be synced (sync:squads:v2) before
 * sync:player-stats can write anything — internal player_id is resolved by
 * matching against the players table; if it's empty, every row gets
 * filtered out and the API calls are wasted. sync:team-stats has no such
 * dependency (doesn't touch players at all).
 */

import { sportsApiClient } from '../services/sportsApiClient';
import { getTrackedLeagueSlugs } from '../config/trackedLeagues';
import { db } from '../db/client';
import { logger } from '../utils/logger';

// Both set to 21 days (adjusted from the original 14d/30d design) to make
// room for sync:standings in the daily API budget — see CLI_REFERENCE.md
// "API BUDGET" section for the full math. 766 teams / 21 days ≈ 36/day each.
const PLAYER_STATS_COOLDOWN_DAYS = 21;
const TEAM_STATS_COOLDOWN_DAYS   = 21;
// Hard per-run cap — prevents a cold-start backlog (every team simultaneously
// "due" when no prior sync exists) from blowing the daily budget in one run.
// Slightly above the 36/day steady-state target to leave a little headroom
// for catch-up without being able to approach the full 200/day ceiling.
const MAX_TEAMS_PER_RUN = 40;
const THROTTLE_MS = 2000;

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Resolves each tracked team's PRIMARY tournament + season context.
 * "Primary" = the tracked competition this team appears in most often in
 * recent matches (handles teams playing in multiple competitions — cup +
 * league — by picking the one with the most fixtures, almost always the
 * league campaign that season-stats are meaningful for).
 */
async function resolveTeamSeasonContext(): Promise<Map<number, { tournamentExternalId: number; seasonExternalId: number }>> {
  const result = new Map<number, { tournamentExternalId: number; seasonExternalId: number }>();

  // Pull recent matches with resolved tournament + season context
  const ago90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: matches } = await db
    .from('matches')
    .select('home_team_id, away_team_id, competition, season')
    .gte('date', ago90)
    .not('competition', 'is', null);

  if (!matches || matches.length === 0) return result;

  // Count competition frequency per team
  const teamCompCounts = new Map<number, Map<string, number>>();
  for (const m of matches) {
    for (const teamId of [m.home_team_id, m.away_team_id]) {
      if (!teamId || !m.competition) continue;
      if (!teamCompCounts.has(teamId)) teamCompCounts.set(teamId, new Map());
      const inner = teamCompCounts.get(teamId)!;
      inner.set(m.competition, (inner.get(m.competition) ?? 0) + 1);
    }
  }

  // Resolve tournament name -> external_id (uniqueTournament.id, per migration 007)
  const { data: tournaments } = await db
    .from('tournaments')
    .select('external_id, name');
  const tournamentByName = new Map<string, number>(
    (tournaments ?? []).map((t: any) => [t.name, t.external_id])
  );

  // Resolve tournament external_id -> most recent season external_id
  const { data: seasons } = await db
    .from('seasons')
    .select('external_id, tournament_id, tournament:tournaments!tournament_id(external_id)')
    .order('external_id', { ascending: false }); // higher external_id ~= more recent season typically

  const seasonByTournamentExtId = new Map<number, number>();
  for (const s of seasons ?? []) {
    const tExtId = (s.tournament as any)?.external_id;
    if (tExtId && !seasonByTournamentExtId.has(tExtId)) {
      seasonByTournamentExtId.set(tExtId, s.external_id);
    }
  }

  for (const [teamId, compCounts] of teamCompCounts) {
    const primaryComp = [...compCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!primaryComp) continue;
    const tournamentExternalId = tournamentByName.get(primaryComp);
    if (!tournamentExternalId) continue;
    const seasonExternalId = seasonByTournamentExtId.get(tournamentExternalId);
    if (!seasonExternalId) continue;
    result.set(teamId, { tournamentExternalId, seasonExternalId });
  }

  return result;
}

/**
 * Returns teams whose stat type hasn't been refreshed within the cooldown
 * window — optionally scoped to specific countries, and always capped at
 * MAX_TEAMS_PER_RUN regardless of how large the eligible backlog is.
 *
 * Country scoping (like sync:squads:countries:v2) is for deliberate manual
 * batching — e.g. bootstrapping specific regions first during an initial
 * backfill. The cap exists independently of that, as a safety net so even
 * an unscoped call on a cold start (every team simultaneously "due") can
 * never exceed a safe slice of the daily budget in one invocation.
 */
async function getEligibleTeams(
  statType: 'player_stats' | 'team_stats',
  cooldownDays: number,
  countries?: string[]
): Promise<any[]> {
  const cutoff = new Date(Date.now() - cooldownDays * 86400000).toISOString();
  const table = statType === 'player_stats' ? 'player_season_statistics' : 'team_season_statistics';

  let query = db.from('teams').select('id, external_id, name, country');
  if (countries && countries.length > 0) {
    query = query.in('country', countries);
  }
  const { data: teams } = await query;
  if (!teams) return [];

  const { data: recentlySynced } = await db
    .from(table)
    .select('team_id, calculated_at')
    .gte('calculated_at', cutoff);

  const recentlySyncedIds = new Set((recentlySynced ?? []).map((r: any) => r.team_id));
  const eligible = teams.filter((t: any) => !recentlySyncedIds.has(t.id));

  if (eligible.length > MAX_TEAMS_PER_RUN) {
    logger.info(
      { eligible: eligible.length, capped: MAX_TEAMS_PER_RUN, statType },
      `Eligible backlog (${eligible.length}) exceeds per-run cap — processing ${MAX_TEAMS_PER_RUN} this run, remainder stays eligible for the next invocation`
    );
  }

  return eligible.slice(0, MAX_TEAMS_PER_RUN);
}

// ─── PLAYER SEASON STATISTICS ────────────────────────────────────────────────

export async function syncPlayerSeasonStatistics(countries?: string[], teamExternalIds?: number[]): Promise<{
  teamsProcessed: number;
  playersWritten: number;
  skipped: number;
  errors: number;
}> {
  logger.info({ countries: countries ?? 'ALL (capped per-run)', teamExternalIds: teamExternalIds ?? 'n/a' }, 'syncPlayerSeasonStatistics started');

  const context = await resolveTeamSeasonContext();

  // Single- or multi-team override — bypasses cooldown AND the per-run cap entirely,
  // same pattern as sync:team-squad:v2 <teamExternalId>. For force-refreshing
  // or debugging one specific team without waiting on the daily backlog.
  let eligibleTeams: any[];
  if (teamExternalIds && teamExternalIds.length > 0) {
    const { data } = await db.from('teams').select('id, external_id, name, country').in('external_id', teamExternalIds);
    eligibleTeams = data ?? [];
    if (eligibleTeams.length < teamExternalIds.length) {
      const found = new Set((eligibleTeams).map((t: any) => t.external_id));
      const missing = teamExternalIds.filter(id => !found.has(id));
      logger.warn({ missing }, 'Some requested external_ids were not found');
    }
  } else {
    eligibleTeams = await getEligibleTeams('player_stats', PLAYER_STATS_COOLDOWN_DAYS, countries);
  }

  let playersWritten = 0, skipped = 0, errors = 0;

  for (const team of eligibleTeams) {
    const ctx = context.get(team.id);
    if (!ctx) {
      skipped++;
      logger.debug({ teamId: team.id, teamName: team.name }, 'Skipped — could not resolve tournament/season context');
      continue;
    }

    try {
      // CONFIRMED via live testing against the real API:
      //   - "teams" (plural), not "team" — matches the already-working
      //     squad sync endpoint (/teams/{id}/players)
      //   - "tournament" (no "unique-" prefix) — same as standings
      // Value passed for tournamentId is still uniqueTournament.id.
      const response = await sportsApiClient.get<any>(
        `/teams/${team.external_id}/tournament/${ctx.tournamentExternalId}/season/${ctx.seasonExternalId}/player-statistics`
      );

      // SportsAPI Pro wraps some endpoints as { success: true, data: {...} }
      // and others return the payload directly — handle both shapes.
      const list = response?.playerStatistics ?? response?.data?.playerStatistics ?? [];
      if (list.length === 0) {
        skipped++;
        logger.warn({ teamId: team.id, topLevelKeys: Object.keys(response ?? {}), sample: JSON.stringify(response).slice(0, 200) }, 'Player stats: no playerStatistics field in response — check shape');
        continue;
      }

      // Resolve internal player IDs by external_id
      const externalIds = list.map((e: any) => e.player?.id).filter(Boolean);
      const { data: dbPlayers } = await db
        .from('players')
        .select('id, external_id')
        .in('external_id', externalIds);
      const playerIdMap = new Map((dbPlayers ?? []).map((p: any) => [p.external_id, p.id]));

      const rows = list
        .filter((e: any) => playerIdMap.has(e.player?.id))
        .map((e: any) => ({
          player_id:          playerIdMap.get(e.player.id),
          team_id:             team.id,
          season_external_id:  ctx.seasonExternalId,
          rating:               e.statistics?.rating ?? null,
          total_rating:         e.statistics?.totalRating ?? null,
          count_rating:         e.statistics?.countRating ?? null,
          appearances:          e.statistics?.appearances ?? null,
          matches_started:      e.statistics?.matchesStarted ?? null,
          minutes_played:       e.statistics?.minutesPlayed ?? null,
          goals:                e.statistics?.goals ?? null,
          assists:              e.statistics?.assists ?? null,
          expected_goals:       e.statistics?.expectedGoals ?? null,
          expected_assists:     e.statistics?.expectedAssists ?? null,
          yellow_cards:         e.statistics?.yellowCards ?? null,
          red_cards:            e.statistics?.redCards ?? null,
          played_enough:        e.playedEnough ?? false,
          calculated_at:        new Date().toISOString(),
          updated_at:           new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await db
          .from('player_season_statistics')
          .upsert(rows, { onConflict: 'player_id,season_external_id' });
        if (error) throw new Error(error.message);
        playersWritten += rows.length;
      }

      logger.info({ teamId: team.id, teamName: team.name, playersWritten: rows.length }, 'Player season stats synced');
    } catch (error: any) {
      errors++;
      logger.error({ teamId: team.id, teamName: team.name, error: error.message }, 'Player season stats sync failed');
    }

    await delay(THROTTLE_MS);
  }

  logger.info({ teamsProcessed: eligibleTeams.length, playersWritten, skipped, errors }, 'syncPlayerSeasonStatistics completed');
  return { teamsProcessed: eligibleTeams.length, playersWritten, skipped, errors };
}

// ─── TEAM SEASON STATISTICS ───────────────────────────────────────────────────

export async function syncTeamSeasonStatistics(countries?: string[], teamExternalIds?: number[]): Promise<{
  teamsProcessed: number;
  written: number;
  skipped: number;
  errors: number;
}> {
  logger.info({ countries: countries ?? 'ALL (capped per-run)', teamExternalIds: teamExternalIds ?? 'n/a' }, 'syncTeamSeasonStatistics started');

  const context = await resolveTeamSeasonContext();

  // Single- or multi-team override — bypasses cooldown AND the per-run cap entirely,
  // same pattern as sync:team-squad:v2 <teamExternalId>.
  let eligibleTeams: any[];
  if (teamExternalIds && teamExternalIds.length > 0) {
    const { data } = await db.from('teams').select('id, external_id, name, country').in('external_id', teamExternalIds);
    eligibleTeams = data ?? [];
    if (eligibleTeams.length < teamExternalIds.length) {
      const found = new Set((eligibleTeams).map((t: any) => t.external_id));
      const missing = teamExternalIds.filter(id => !found.has(id));
      logger.warn({ missing }, 'Some requested external_ids were not found');
    }
  } else {
    eligibleTeams = await getEligibleTeams('team_stats', TEAM_STATS_COOLDOWN_DAYS, countries);
  }

  let written = 0, skipped = 0, errors = 0;

  for (const team of eligibleTeams) {
    const ctx = context.get(team.id);
    if (!ctx) {
      skipped++;
      continue;
    }

    try {
      // Same path corrections as player-statistics above.
      const response = await sportsApiClient.get<any>(
        `/teams/${team.external_id}/tournament/${ctx.tournamentExternalId}/season/${ctx.seasonExternalId}/statistics`
      );

      // SportsAPI Pro wraps some endpoints as { success: true, data: {...} }
      // and others return the payload directly — handle both shapes.
      const s = response?.statistics ?? response?.data?.statistics;
      if (!s) {
        skipped++;
        logger.warn({ teamId: team.id, topLevelKeys: Object.keys(response ?? {}), sample: JSON.stringify(response).slice(0, 200) }, 'Team stats: no statistics field in response — check shape');
        continue;
      }

      const { error } = await db.from('team_season_statistics').upsert({
        team_id:               team.id,
        season_external_id:    ctx.seasonExternalId,
        matches:                 s.matches ?? null,
        goals_scored:             s.goalsScored ?? null,
        goals_conceded:           s.goalsConceded ?? null,
        clean_sheets:             s.cleanSheets ?? null,
        avg_possession:           s.averageBallPossession ?? null,
        avg_rating:               s.avgRating ?? null,
        total_passes:             s.totalPasses ?? null,
        accurate_passes_pct:      s.accuratePassesPercentage ?? null,
        duels_won_pct:            s.duelsWonPercentage ?? null,
        aerial_duels_won_pct:     s.aerialDuelsWonPercentage ?? null,
        tackles:                  s.tackles ?? null,
        interceptions:            s.interceptions ?? null,
        yellow_cards:             s.yellowCards ?? null,
        red_cards:                s.redCards ?? null,
        big_chances_created:      s.bigChancesCreated ?? null,
        big_chances_missed:       s.bigChancesMissed ?? null,
        calculated_at:            new Date().toISOString(),
        updated_at:               new Date().toISOString(),
      }, { onConflict: 'team_id,season_external_id' });

      if (error) throw new Error(error.message);
      written++;
      logger.info({ teamId: team.id, teamName: team.name }, 'Team season stats synced');
    } catch (error: any) {
      errors++;
      logger.error({ teamId: team.id, teamName: team.name, error: error.message }, 'Team season stats sync failed');
    }

    await delay(THROTTLE_MS);
  }

  logger.info({ teamsProcessed: eligibleTeams.length, written, skipped, errors }, 'syncTeamSeasonStatistics completed');
  return { teamsProcessed: eligibleTeams.length, written, skipped, errors };
}
