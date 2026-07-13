import 'dotenv/config';
import { logger } from './utils/logger';
import { syncTournaments, syncAllSeasons } from './jobs/syncDiscovery';
import { syncSchedule } from './jobs/syncSchedule';
import { syncAllTeamsPlayers, syncTeamPlayers, syncTeamsByCountries, syncSquadsForTrackedLeagues as syncSquadsTrackedLegacy } from './jobs/syncTeamsPlayers';
import { syncSquadsForTrackedLeagues, syncSquadsByCountries, syncSingleTeamSquad, syncSquadsForMatches, resolveTeamsFromMatches } from './jobs/syncSquadSofaScore';
import { processFormForRecentMatches, processFormBackfill } from './jobs/processForm';
import { processTeamFixtureLoad, processTeamLocations, processTeamTravelLoad, processMatchTravelIntelligence, processTeamIntelligencePartial, processMatchIntelligencePartial, processTeamStrengthRatings, processTeamVenuePerformance, processPlayerIntelligence, processPredictedLineups, processStartingXIStrength, processMatchSignals, processLeagueIntelligence, processFixtureDifficulty, processTeamMomentum, processDashboardSummary, processScorelinePredictions, processPlayerMatchLoad, processNetBattleIndex } from './jobs/processDbOnly';
import {
  processTeamFormQuality, processTeamBettingIntelligence, processHTFTProbabilities,
  processPlayerMatchImpact, processMatchPerformanceComparison, processTeamVersatility,
  processFormationMatchup, processPositionAdaptability, processTacticalFlexibility,
  processSubstitutionImpact, processSquadDepthComparison, processTeamMotivation,
  processMatchImpactSummary, processPlayerVersatility,
  processTeamMatchImpact, processMatchImpactAdvantage, processMatchKeyBattles,
  processMatchPositionalMatchups, processMatchTacticalAdvantages, processPlayerMatchup,
} from './jobs/processExtendedIntelligence';
import { archiveReadinessSnapshot, linkReadinessResults, refreshLeagueGapAnalytics, archiveReadinessSnapshotForDate } from './jobs/archiveReadinessHistory';
import { syncDateMasterFeed, syncDateRange } from './jobs/syncDateMasterFeed';
import { syncPlayerSeasonStatistics, syncTeamSeasonStatistics } from './jobs/syncSeasonStatistics';
import { clearApiSamples } from './utils/apiSamples';
import { syncSampleBands } from './jobs/sampleBands';
import { syncTransfersForTeams } from './jobs/syncTransfersV2';
import { syncTeamImages, syncTournamentImages } from './jobs/syncTeamImages';
import { syncStandings } from './jobs/syncStandings';
import { syncTournamentEvents, syncTournamentEventsByCountries, TournamentEventType } from './jobs/syncTournamentEvents';
import { TRACKED_LEAGUES, getTrackedLeaguesSummary, TRACKED_LEAGUE_COUNT } from './config/trackedLeagues';
import { sportsApiClient } from './services/sportsApiClient';



import { processHistoricalContextBackfill, processHistoricalContextRecent } from './jobs/processHistoricalContext';
import { processFormQuality } from './jobs/processFormQuality';
import { backtestSignals } from './jobs/backtestSignals';
import { processRiskOpportunity } from './jobs/processRiskOpportunity';

/**
 * CLI Interface for Manual Job Execution
 *
 * Usage:
 * npx ts-node src/cli.ts <command> [args]
 *
 * Commands:
 * - sync:tournaments              Sync all tournaments
 * - sync:seasons                  Sync all seasons for all tournaments
 * - sync:schedule <YYYY-MM-DD>    Sync schedule for specific date
 * - sync:teams-players            Sync all team rosters
 * - sync:team-players <teamId>    Sync players for specific team
 * - process:form:recent           Process form for recent matches
 * - process:form:backfill         Backfill form history for all matches
 * - help                          Show this help message
 */

async function handleCommand(command: string, ...args: string[]) {
  logger.info({ command, args }, 'Executing CLI command');

  try {
    switch (command) {
      case 'sync:tournaments':
        logger.info('Syncing tournaments...');
        const toursResult = await syncTournaments();
        logger.info(toursResult, 'Tournaments sync complete');
        break;

      case 'sync:seasons':
        logger.info('Syncing seasons...');
        const seasonsResult = await syncAllSeasons();
        logger.info(seasonsResult, 'Seasons sync complete');
        break;

      case 'sync:schedule':
        if (!args[0]) {
          throw new Error('Date required: YYYY-MM-DD format');
        }
        logger.info({ date: args[0] }, 'Syncing schedule...');
        const scheduleResult = await syncSchedule(args[0]);
        logger.info(scheduleResult, 'Schedule sync complete');
        break;

      case 'sync:teams-players':
        logger.info('Syncing all teams and players...');
        const teamsResult = await syncAllTeamsPlayers();
        logger.info(teamsResult, 'Teams/players sync complete');
        break;

      case 'sync:team-players':
        if (!args[0]) {
          throw new Error('Team ID required');
        }
        const teamId = parseInt(args[0], 10);
        logger.info({ teamId }, 'Syncing team players...');
        const teamResult = await syncTeamPlayers(teamId);
        logger.info(teamResult, 'Team players sync complete');
        break;

      case 'process:injury-risk': {
        // REMOVED — this tried to write into injury_risk, a plain SQL
        // VIEW that already computes risk live from player_intelligence
        // on every query; Postgres doesn't allow writing to an ordinary
        // view, so this would have failed at runtime. The real fix is
        // in process:player-intelligence, which now blends real match
        // load into fatigue_score so the view's existing classification
        // actually differentiates players. See processDbOnly.ts's
        // comment where processInjuryRisk used to be defined.
        logger.error('process:injury-risk was removed — see process:player-intelligence instead (fatigue_score now reflects real match load, which is what injury_risk\'s view actually classifies on).');
        break;
      }

      case 'process:form:recent':
        logger.info('Processing form for recent matches...');
        const formRecentResult = await processFormForRecentMatches(24);
        logger.info(formRecentResult, 'Form processing complete');
        break;

      case 'process:form:backfill':
        logger.warn(
          'Starting form backfill - this may take a long time...'
        );
        const formBackfillResult = await processFormBackfill();
        logger.info(formBackfillResult, 'Form backfill complete');
        break;

      case 'sync:today': {
        // Convenience alias — no shell date escaping needed in cPanel cron
        const today = new Date().toISOString().split('T')[0];
        const r = await syncDateMasterFeed(today);
        logger.info(r, 'sync:today complete');
        break;
      }

      case 'sync:tomorrow': {
        const tom = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const r = await syncDateMasterFeed(tom);
        logger.info(r, 'sync:tomorrow complete');
        break;
      }

      case 'sync:week': {
        // Syncs today + next 6 days = 7 API calls
        // Run weekly to keep fixture calendar fresh
        const start = new Date().toISOString().split('T')[0];
        const end   = new Date(Date.now() + 6 * 86400000).toISOString().split('T')[0];
        const r = await syncDateRange(start, end, 2000);
        logger.info(r, 'sync:week complete');
        break;
      }

      case 'sync:date':
        if (!args[0]) throw new Error('Date required: YYYY-MM-DD');
        const dateResult = await syncDateMasterFeed(args[0]);
        logger.info(dateResult, 'Master feed sync complete');
        break;

      case 'sync:range':
        if (!args[0] || !args[1]) throw new Error('Start and end dates required: YYYY-MM-DD YYYY-MM-DD');
        const rangeResult = await syncDateRange(args[0], args[1]);
        logger.info(rangeResult, 'Date range sync complete');
        break;

      case 'sync:squads:v2': {
        // PRIMARY V2: SofaScore single-call squad intelligence
        // Populates players, injuries, transfers, squad snapshot,
        // position depth, transfer intelligence, team intelligence.
        // daysAhead scopes which teams are eligible: only teams with
        // matches within the next N days. Default 1 = today only.
        // Examples:
        //   sync:squads:v2        → today only (default)
        //   sync:squads:v2 2      → today + tomorrow
        //   sync:squads:v2 4      → next 4 days
        const daysArg = args[0] ? parseInt(args[0], 10) : 1;
        const daysAhead = (!Number.isNaN(daysArg) && daysArg > 0) ? daysArg : 1;
        logger.info({ daysAhead }, `SofaScore V2 squad sync — next ${daysAhead} day(s) only...`);
        const r = await syncSquadsForTrackedLeagues(daysAhead);
        logger.info(r, 'V2 squad sync complete');
        break;
      }

      case 'sync:squads:countries:v2': {
        const countriesV2 = args[0]?.split(',').map((c: string) => c.trim()) ?? [];
        if (countriesV2.length === 0) { logger.error('Usage: sync:squads:countries:v2 "Brazil,Finland"'); break; }
        logger.info({ countries: countriesV2 }, 'SofaScore V2 squad sync by country...');
        const r = await syncSquadsByCountries(countriesV2);
        logger.info(r, 'V2 country squad sync complete');
        break;
      }

      case 'sync:squads:matches:v2': {
        // Accepts either space-separated args (sync:squads:matches:v2
        // 12345 67890) or one comma-separated arg
        // (sync:squads:matches:v2 "12345,67890") — flattened and parsed
        // together so either style works, matching the ask for "at
        // least 2 match ids parameters" without forcing one exact
        // invocation shape.
        const matchIds = args
          .flatMap((a: string) => a.split(','))
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((s: string) => Number(s))
          .filter((n: number) => !Number.isNaN(n));
        if (matchIds.length < 2) {
          logger.error({ received: args }, 'Usage: sync:squads:matches:v2 <externalMatchId1> <externalMatchId2> [...] — needs at least 2 match external IDs (matches.external_match_id, not this DB\'s internal id). Also accepts one comma-separated arg.');
          break;
        }
        logger.info({ matchIds }, 'SofaScore V2 squad sync for teams in specific matches...');
        const r = await syncSquadsForMatches(matchIds);
        logger.info(r, 'Match-targeted squad sync complete');
        break;
      }

      case 'sync:team-squad:v2': {
        const extId = parseInt(args[0] ?? '0');
        if (!extId) { logger.error('Usage: sync:team-squad:v2 <teamExternalId>'); break; }
        logger.info({ extId }, 'SofaScore V2 single team squad sync...');
        const r = await syncSingleTeamSquad(extId);
        logger.info(r, 'V2 single team squad sync complete');
        break;
      }

      case 'sync:squads:tracked': {
        // Primary command — no args needed, derives team list from matches table
        logger.info('Syncing squads for tracked leagues only...');
        const r = await syncSquadsForTrackedLeagues();
        logger.info(r, 'Tracked league squad sync complete');
        break;
      }

      case 'sync:squads:countries':
        if (!args[0]) throw new Error('At least one country name required (comma-separated, e.g. "Brazil,Finland")');
        const countryList = args[0].split(',').map((c: string) => c.trim());
        logger.info({ countries: countryList }, 'Syncing squads by country...');
        const countrySquadResult = await syncTeamsByCountries(countryList);
        logger.info(countrySquadResult, 'Country squad sync complete');
        break;

      case 'sync:squads:all':
        logger.warn('Syncing ALL 3,756 teams — this takes ~3 hours on first run');
        const allSquadsResult = await syncAllTeamsPlayers();
        logger.info(allSquadsResult, 'All squads sync complete');
        break;

      // ── V3 DATA POINTS — see ROADMAP_V3.md for rate-limit cadence design ──

      case 'sync:player-stats': {
        // Daily invocation recommended — cooldown + per-run cap (40 teams)
        // self-throttle, same model as sync:squads:v2. "Every 21 days" as a
        // single periodic call was an earlier documentation mistake — see
        // syncSeasonStatistics.ts header for why.
        // PREREQUISITE: tournaments.external_id must be the correct
        // uniqueTournament.id (fixed in syncDateMasterFeed.ts + migration 007).
        // Also requires sync:squads:v2 to have populated players first —
        // otherwise every fetched row gets filtered out for lack of a
        // matching internal player_id, wasting the API calls.
        //
        // Accepts:
        //   - No args → default, uses cooldown + cap
        //   - [days] (1-4) → teams with matches in next N days only
        //   - Country list ("Brazil,Argentina") → scoped to countries
        //   - Team external_ids ("416 456 567") → scoped to team IDs
        const firstArg = args[0];
        const isSingleDay = firstArg && /^\d$/.test(firstArg); // single digit 1-9
        
        let playerStatsTeamIds: number[] | undefined;
        let playerStatsCountries: string[] | undefined;
        let playerStatsDaysAhead: number | undefined;
        
        if (isSingleDay) {
          // Days ahead variant
          playerStatsDaysAhead = Math.max(1, Math.min(4, Number(firstArg)));
          logger.info({ daysAhead: playerStatsDaysAhead }, `Syncing player stats for teams with matches in next ${playerStatsDaysAhead} days`);
        } else {
          // Original country/team-ID pattern
          const playerStatsAllNumeric = args.length > 0 && args.every((a: string) => /^\d+$/.test(a));
          playerStatsTeamIds = playerStatsAllNumeric ? args.map((a: string) => Number(a)) : undefined;
          playerStatsCountries = !playerStatsAllNumeric && args[0] ? args[0].split(',').map((c: string) => c.trim()) : undefined;
          logger.info({ countries: playerStatsCountries ?? 'n/a', teamIds: playerStatsTeamIds ?? 'n/a' }, 'Syncing player season statistics (rating, minutes, starts)...');
        }
        
        const r = await syncPlayerSeasonStatistics(playerStatsCountries, playerStatsTeamIds, playerStatsDaysAhead);
        logger.info(r, 'Player season statistics sync complete');
        break;
      }

      case 'sync:player-stats:matches:v2': {
        // Same match-targeted pattern as sync:squads:matches:v2 - given
        // 2+ match external IDs (matches.external_match_id), resolves
        // the teams playing in those specific fixtures and syncs player
        // season statistics for just those teams. Reuses
        // resolveTeamsFromMatches() (the same match->team resolution
        // already built for the squads version, extracted out so this
        // command doesn't duplicate that lookup) and the EXISTING
        // syncPlayerSeasonStatistics(countries?, teamExternalIds?) —
        // that function already accepted an explicit team-external-id
        // override, so no new sync logic was needed here at all, just
        // a new way to arrive at the team id list.
        const playerStatsMatchIds = args
          .flatMap((a: string) => a.split(','))
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((s: string) => Number(s))
          .filter((n: number) => !Number.isNaN(n));
        if (playerStatsMatchIds.length < 2) {
          logger.error({ received: args }, 'Usage: sync:player-stats:matches:v2 <externalMatchId1> <externalMatchId2> [...] — needs at least 2 match external IDs (matches.external_match_id). Also accepts one comma-separated arg.');
          break;
        }
        logger.info({ matchIds: playerStatsMatchIds }, 'Resolving teams for player-stats sync...');
        const { teams: statsTeams, matchesResolved, matchesNotFound } = await resolveTeamsFromMatches(playerStatsMatchIds);
        if (statsTeams.length === 0) {
          logger.error({ matchesNotFound }, 'None of the given match external IDs resolved to any team — nothing to sync');
          break;
        }
        logger.info({ matchesResolved, matchesNotFound, teamNames: statsTeams.map(t => t.name) }, 'Teams resolved — syncing player season statistics...');
        const matchStatsResult = await syncPlayerSeasonStatistics(undefined, statsTeams.map(t => t.external_id));
        logger.info({ ...matchStatsResult, matchesResolved, matchesNotFound }, 'Match-targeted player stats sync complete');
        break;
      }

      case 'sync:team-stats': {
        // Daily invocation recommended — cooldown + per-run cap (40 teams)
        // self-throttle, same model as sync:squads:v2.
        //
        // Accepts:
        //   - No args → default, uses cooldown + cap
        //   - [days] (1-4) → teams with matches in next N days only
        //   - Country list ("England,Spain") → scoped to countries
        //   - Team external_ids ("416 456 567") → scoped to team IDs
        const firstArg = args[0];
        const isSingleDay = firstArg && /^\d$/.test(firstArg); // single digit 1-9
        
        let teamStatsTeamIds: number[] | undefined;
        let teamStatsCountries: string[] | undefined;
        let teamStatsDaysAhead: number | undefined;
        
        if (isSingleDay) {
          // Days ahead variant
          teamStatsDaysAhead = Math.max(1, Math.min(4, Number(firstArg)));
          logger.info({ daysAhead: teamStatsDaysAhead }, `Syncing team stats for teams with matches in next ${teamStatsDaysAhead} days`);
        } else {
          // Original country/team-ID pattern
          const teamStatsAllNumeric = args.length > 0 && args.every((a: string) => /^\d+$/.test(a));
          teamStatsTeamIds = teamStatsAllNumeric ? args.map((a: string) => Number(a)) : undefined;
          teamStatsCountries = !teamStatsAllNumeric && args[0] ? args[0].split(',').map((c: string) => c.trim()) : undefined;
          logger.info({ countries: teamStatsCountries ?? 'n/a', teamIds: teamStatsTeamIds ?? 'n/a' }, 'Syncing team season statistics...');
        }
        
        const r = await syncTeamSeasonStatistics(teamStatsCountries, teamStatsTeamIds, teamStatsDaysAhead);
        logger.info(r, 'Team season statistics sync complete');
        break;
      }

      case 'sync:transfers': {
        // NOT a recurring command — run once per region after THAT region's
        // transfer window closes. See CLI_REFERENCE.md for the cluster schedule.
        const countriesArg = args[0];
        const countries = countriesArg ? countriesArg.split(',').map((c: string) => c.trim()) : undefined;
        logger.info({ countries: countries ?? 'ALL (full backfill only — not for recurring use)' }, 'Syncing transfers...');
        const r = await syncTransfersForTeams(countries);
        logger.info(r, 'Transfers sync complete');
        break;
      }

      case 'sync:images': {
        // One-time backfill — re-run manually only if a club rebrands.
        logger.info('Backfilling team crests to Supabase Storage...');
        const r = await syncTeamImages();
        logger.info(r, 'Team image sync complete');
        break;
      }

      case 'sync:tournament-images': {
        // One-time backfill, same cadence reasoning as sync:images.
        // Endpoint is unverified (see syncTeamImages.ts's docstring on
        // syncTournamentImages) - test on a small tournament count
        // before assuming full coverage.
        logger.info('Backfilling tournament/league logos to Supabase Storage...');
        const r = await syncTournamentImages();
        logger.info(r, 'Tournament image sync complete');
        break;
      }

      case 'sync:images:targeted': {
        // Targeted image (re)sync for specific teams, leagues, and/or
        // matches - any one or more of the three, combined in one call.
        // IDs are external_id (the source API's id, matching the
        // established convention from syncSingleTeamSquad/
        // resolveTeamsFromMatches elsewhere in this file), NOT this DB's
        // internal auto-increment id - flagged clearly here since
        // "reading id from DB" could reasonably be read either way.
        //
        // Usage: sync:images:targeted --teams 1,2,3 --leagues 5,6 --matches 100,101
        // Any of the three flags may be omitted; at least one is required.
        // Match IDs are match external_match_id, resolved to their two
        // teams via the same resolveTeamsFromMatches() helper
        // sync:squads:matches:v2 already uses - not a second, separate
        // resolution implementation.
        const parseIdFlag = (flag: string): number[] => {
          const idx = args.indexOf(flag);
          if (idx === -1 || idx + 1 >= args.length) return [];
          return args[idx + 1].split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n));
        };
        const teamIds = parseIdFlag('--teams');
        const leagueIds = parseIdFlag('--leagues');
        const matchIds = parseIdFlag('--matches');

        if (teamIds.length === 0 && leagueIds.length === 0 && matchIds.length === 0) {
          logger.error('Usage: sync:images:targeted --teams <ids> --leagues <ids> --matches <ids> — at least one flag required, each accepting one or more comma-separated external IDs');
          break;
        }

        let resolvedTeamIds = [...teamIds];
        if (matchIds.length > 0) {
          if (matchIds.length < 2) {
            logger.error('--matches requires at least 2 match external IDs (resolveTeamsFromMatches\' own requirement, same as sync:squads:matches:v2)');
            break;
          }
          const { teams, matchesNotFound } = await resolveTeamsFromMatches(matchIds);
          if (matchesNotFound.length > 0) logger.warn({ matchesNotFound }, 'Some match IDs did not resolve');
          resolvedTeamIds = [...new Set([...resolvedTeamIds, ...teams.map(t => t.external_id)])];
        }

        logger.info({ teamIds: resolvedTeamIds, leagueIds }, 'Running targeted image sync...');
        const results: any = {};
        if (resolvedTeamIds.length > 0) results.teams = await syncTeamImages(resolvedTeamIds);
        if (leagueIds.length > 0) results.leagues = await syncTournamentImages(leagueIds);
        logger.info(results, 'Targeted image sync complete');
        break;
      }

      case 'sync:standings': {
        // Weekly cadence — per TOURNAMENT not per team (~42 calls total,
        // not 766). Resolves league_position in team_strength_ratings.
        logger.info('Syncing tournament standings (~42 calls, one per tracked league)...');
        const r = await syncStandings();
        logger.info(r, 'Standings sync complete');
        break;
      }

      case 'sync:tournament-events': {
        // Space-separated tournament external IDs with an optional trailing
        // event-type (total|home|away). Mirrors the sync:squads:matches:v2
        // ID-list pattern — also accepts comma-separated IDs, or a mix.
        // Minimum 2 tournament IDs required.
        //
        // Examples:
        //   sync:tournament-events 42 55 108
        //   sync:tournament-events 42 55 home
        //   sync:tournament-events "42,55,108"
        //   sync:tournament-events "42,55" away
        const EVENT_TYPES = new Set<string>(['total', 'home', 'away']);
        const rawArgs = args.flatMap((a: string) => a.split(','))
          .map((s: string) => s.trim()).filter(Boolean);

        // If the last token is a valid event type, pop it; otherwise default to total.
        let eventType: TournamentEventType = 'total';
        const lastArg = rawArgs[rawArgs.length - 1];
        const idArgs = EVENT_TYPES.has(lastArg)
          ? rawArgs.slice(0, -1)
          : rawArgs;
        if (EVENT_TYPES.has(lastArg)) eventType = lastArg as TournamentEventType;

        const tournamentIds = idArgs
          .map((s: string) => Number(s))
          .filter((n: number) => !Number.isNaN(n) && n > 0);

        if (tournamentIds.length < 2) {
          logger.error(
            { received: args },
            'Usage: sync:tournament-events <id1> <id2> [...] [total|home|away] — needs at least 2 tournament external_ids. Optional trailing type defaults to total.'
          );
          break;
        }
        logger.info({ tournamentIds, eventType }, 'Syncing tournament events...');
        const r = await syncTournamentEvents(tournamentIds, eventType);
        logger.info(r, 'Tournament events sync complete');
        break;
      }

      case 'sync:tournament-events:countries': {
        // Country-based variant — resolves country names to tournament
        // external_ids via tournaments JOIN countries in the DB, then
        // syncs all matching tournaments. Mirrors sync:squads:countries:v2.
        //
        // Examples:
        //   sync:tournament-events:countries "Brazil,Argentina"
        //   sync:tournament-events:countries "Lithuania" away
        //   sync:tournament-events:countries Brazil home
        const EVENT_TYPES = new Set<string>(['total', 'home', 'away']);
        const rawCountryArgs = args.map((a: string) => a.trim()).filter(Boolean);

        // If the last token is a valid event type, pop it.
        let eventTypeC: TournamentEventType = 'total';
        const lastCountryArg = rawCountryArgs[rawCountryArgs.length - 1];
        const countryArgs = EVENT_TYPES.has(lastCountryArg)
          ? rawCountryArgs.slice(0, -1)
          : rawCountryArgs;
        if (EVENT_TYPES.has(lastCountryArg)) eventTypeC = lastCountryArg as TournamentEventType;

        // Countries come either as one comma-separated arg or space-separated;
        // flatten and split both, same as the countries:v2 pattern.
        const countries = countryArgs
          .flatMap((a: string) => a.split(','))
          .map((c: string) => c.trim())
          .filter(Boolean);

        if (countries.length === 0) {
          logger.error('Usage: sync:tournament-events:countries <Country1,Country2,...> [total|home|away]');
          break;
        }
        logger.info({ countries, eventType: eventTypeC }, 'Syncing tournament events by country...');
        const r = await syncTournamentEventsByCountries(countries, eventTypeC);
        logger.info(r, 'Country tournament events sync complete');
        break;
      }

      case 'refresh:api-samples': {
        // Clears captured API reference samples (backend/docs/api-samples/)
        // so the next normal sync cycle recaptures fresh ones. Deliberate
        // action, not automatic — see backend/src/utils/apiSamples.ts for
        // why samples aren't overwritten on every call by default (keeps
        // git diffs on these files meaningful when they DO change, rather
        // than churning on every sync run).
        // Zero API calls itself — just deletes local files. Run this, then
        // run your normal sync commands (sync:standings, sync:player-stats,
        // sync:team-stats, sync:squads:v2) to recapture.
        const r = clearApiSamples();
        logger.info(r, `Cleared ${r.deleted} API sample file(s) — run your normal syncs to recapture fresh ones`);
        break;
      }

      case 'sample:bands': {
        // Auto-resolves ONE representative team per tier band (A/B/C/
        // Mandated/Discovery — whatever bands exist in TRACKED_LEAGUES,
        // not hardcoded) and runs standings + player-stats + team-stats
        // against exactly those teams in one command — bypassing the
        // normal cooldown/cap via the existing multi-team override.
        // Removes the manual "look up a team ID per band, then run
        // sync:team-stats with all three IDs" step.
        //
        // Does NOT include squad sync — that endpoint's sample grouping
        // is by team country, not tier band, so a band-based team picker
        // doesn't map onto it. Run sync:squads:v2 separately for a squad
        // sample.
        logger.info('Auto-resolving one team per tier band and syncing standings + player-stats + team-stats...');
        const r = await syncSampleBands();
        logger.info(r, `sample:bands complete — ${r.bandsResolved}/${r.bandsAttempted} bands resolved`);
        break;
      }

      case 'process:predicted-lineup': {
        // DB-only, zero API calls — derived "Likely XI" from
        // player_season_statistics.matches_started + injuries + transfers.
        logger.info('Computing predicted lineups — DB only...');
        const r = await processPredictedLineups();
        logger.info(r, 'Predicted lineups complete');
        break;
      }

      case 'process:match-signals': {
        // DB-only, zero API calls — precomputes betting signals (see
        // lib/signalLogic.ts) into match_signals, replacing what used to
        // be computed fresh in the browser on every page load. See that
        // job's docstring for the full architecture reasoning. Run this
        // after process:team-intelligence / process:all-db so
        // team_intelligence/match_intelligence are current first.
        logger.info('Precomputing betting signals — DB only...');
        const r = await processMatchSignals();
        logger.info(r, 'Match signals complete');
        break;
      }

      case 'process:league-intelligence': {
        // DB-only, zero API calls — precomputes per-tournament averages
        // (readiness, form, congestion, travel, rest days), replacing what
        // used to be computed fresh in the browser on every Leagues
        // Overview page load. Run after process:team-intelligence so
        // team_intelligence is current first.
        logger.info('Precomputing league intelligence — DB only...');
        const r = await processLeagueIntelligence();
        logger.info(r, 'League intelligence complete');
        break;
      }

      case 'process:fixture-difficulty': {
        // DB-only, zero API calls — average opponent strength across each
        // team's next 5/10 scheduled matches. Needs team_strength_ratings
        // (sync:standings + process:all-db) to be populated first, or every
        // team's difficulty comes back null.
        logger.info('Precomputing fixture difficulty — DB only...');
        const r = await processFixtureDifficulty();
        logger.info(r, 'Fixture difficulty complete');
        break;
      }

      case 'process:momentum': {
        // DB-only, zero API calls — recent-vs-prior form trend from
        // team_form_history. Needs at least 10 matches of form history per
        // team for a meaningful (non-null) momentum_score.
        logger.info('Precomputing team momentum — DB only...');
        const r = await processTeamMomentum();
        logger.info(r, 'Team momentum complete');
        break;
      }

      case 'process:scorelines': {
        // DB-only, zero API calls — independent Poisson goal model using
        // team_form_history.goals_for/against. Upserts directly (not update)
        // so it works even for matches without a match_intelligence row yet.
        logger.info('Computing scoreline predictions — DB only, Poisson model...');
        const r = await processScorelinePredictions();
        logger.info(r, 'Scoreline predictions complete');
        break;
      }

      case 'process:net-battle-index': {
        // Net Battle Superiority Index (NBSI) — z-score population-normalized
        // category comparison, no hand-picked weights, no verdict/classification.
        // See migration 022 for full methodology. DB-only, zero API calls.
        logger.info('Computing Net Battle Index — z-score normalized, DB only...');
        const r = await processNetBattleIndex();
        logger.info(r, 'Net Battle Index complete');
        break;
      }

      case 'process:dashboard-summary': {
        // DB-only — precomputes dashboard aggregates so the frontend never
        // calculates them at runtime. Run after process:all-db, or
        // standalone if you just need the top-line stats refreshed quickly.
        logger.info('Computing dashboard summary — DB only...');
        const r = await processDashboardSummary();
        logger.info(r, 'Dashboard summary complete');
        break;
      }

      case 'process:fixture-load': {
        logger.info('Computing fixture load — DB only...');
        const r = await processTeamFixtureLoad();
        logger.info(r, 'Fixture load complete');
        break;
      }

      // Run before process:player-intelligence — fatigue_score now reads
      // from player_match_load's output (see that function's docstring).
      case 'process:player-match-load': {
        logger.info('Deriving player match load from season stats — DB only...');
        const r = await processPlayerMatchLoad();
        logger.info(r, 'Player match load complete');
        break;
      }


      case 'process:team-locations': {
        logger.info('Deriving team locations from venue history — DB only...');
        const r = await processTeamLocations();
        logger.info(r, 'Team locations complete');
        break;
      }

      case 'process:all-db': {
        // ── ALL DB-ONLY PROCESSORS — zero API calls ────────────────────────
        // Strict dependency order. Do NOT reorder.
        // Safe to run multiple times — all processors are idempotent.
        // Typical runtime: 30–120s depending on DB size.
        const t0 = Date.now();

        logger.info('━━━ process:all-db started ━━━ (zero API calls)');

        // ── LAYER 1 ── No prerequisites — raw DB data only ─────────────────
        logger.info('[L1/3] Form history backfill...');
        const form    = await processFormBackfill();
        logger.info({ ...form }, '[L1] ✓ form history');

        logger.info('[L1/3] Player match load (needs season stats)...');
        const matchLoad = await processPlayerMatchLoad();
        logger.info({ ...matchLoad }, '[L1] ✓ player match load');

        // Needs only team_form_history (L1, just above) — recent-vs-prior
        // form trend, independent of everything else.
        logger.info('[L1/3] Team momentum (needs form_history)...');
        const momentum = await processTeamMomentum();
        logger.info({ ...momentum }, '[L1] ✓ team momentum');

        logger.info('[L1/3] Fixture load...');
        const fixture = await processTeamFixtureLoad();
        logger.info({ ...fixture }, '[L1] ✓ fixture load');

        logger.info('[L1/3] Team locations...');
        const locs    = await processTeamLocations();
        logger.info({ ...locs }, '[L1] ✓ team locations');

        // ── LAYER 2 ── Needs team_locations (L1) ───────────────────────────
        logger.info('[L2/3] Team travel load (needs team_locations)...');
        const travel    = await processTeamTravelLoad();
        logger.info({ ...travel }, '[L2] ✓ team travel load');

        logger.info('[L2/3] Match travel intelligence (needs team_locations)...');
        const matchTravel = await processMatchTravelIntelligence();
        logger.info({ ...matchTravel }, '[L2] ✓ match travel intelligence');

        logger.info('[L2/3] Team strength ratings (needs form_history + tournament_standings)...');
        const strength  = await processTeamStrengthRatings();
        logger.info({ ...strength }, '[L2] ✓ strength ratings');

        // Needs team_strength_ratings (just above) — average opponent
        // strength across each team's next 5/10 fixtures.
        logger.info('[L2/3] Fixture difficulty (needs strength ratings)...');
        const fixtureDiff = await processFixtureDifficulty();
        logger.info({ ...fixtureDiff }, '[L2] ✓ fixture difficulty');

        logger.info('[L2/3] Team venue performance (needs form_history)...');
        const venue     = await processTeamVenuePerformance();
        logger.info({ ...venue }, '[L2] ✓ venue performance');

        // ── LAYER 3 ── Needs L1 + L2 complete ─────────────────────────────
        logger.info('[L3/3] Team intelligence (needs form + fixture + travel)...');
        const teamIntel = await processTeamIntelligencePartial();
        logger.info({ ...teamIntel }, '[L3] ✓ team intelligence');

        logger.info('[L3/3] Player intelligence (needs players + team_intelligence + player_match_load)...');
        const playerIntel = await processPlayerIntelligence();
        logger.info({ ...playerIntel }, '[L3] ✓ player intelligence');

        // ── LAYER 3.5 ── Needs team_intelligence (L3) + team_travel_load
        // (L1) — per-tournament averages, independent of match-level data.
        logger.info('[L3.5/3] League intelligence (needs team_intelligence)...');
        const leagueIntel = await processLeagueIntelligence();
        logger.info({ ...leagueIntel }, '[L3.5] ✓ league intelligence');

        // ── LAYER 4 ── Needs team_intelligence (L3) ────────────────────────
        logger.info('[L4/3] Match intelligence (needs team_intelligence)...');
        const matchIntel  = await processMatchIntelligencePartial();
        logger.info({ ...matchIntel }, '[L4] ✓ match intelligence');

        // ── LAYER 4.5 ── Needs match_intelligence (L4) + team_intelligence
        // (L3) — precomputes betting signals, replacing what used to be
        // computed fresh in the browser on every page load. See
        // processMatchSignals()'s docstring for the full reasoning.
        logger.info('[L4.5/3] Match signals (needs match_intelligence + team_intelligence)...');
        const matchSignals = await processMatchSignals();
        logger.info({ ...matchSignals }, '[L4.5] ✓ match signals');

        // ── LAYER 5 ── Needs player_season_statistics (sync:player-stats) ───
        // Zero-cost — runs even if player-stats hasn't synced yet (just
        // produces 0 predicted lineups until that data exists).
        logger.info('[L5/3] Predicted lineups (needs player_season_statistics)...');
        const predictedLineups = await processPredictedLineups();
        logger.info({ ...predictedLineups }, '[L5] ✓ predicted lineups');

        // ── LAYER 5.7 ── Needs match_predicted_lineups (L5) — Starting XI
        // Strength overlay. Independent metric, not a readiness component;
        // see processStartingXIStrength() docstring.
        logger.info('[L5.7/3] Starting XI strength (needs predicted lineups)...');
        const xiStrength = await processStartingXIStrength();
        logger.info({ ...xiStrength }, '[L5.7] ✓ starting XI strength');

        // ── LAYER 5.5 ── Needs team_form_history (L1) only — independent
        // of squad/player data, can run as soon as form history exists.
        logger.info('[L5.5/3] Scoreline predictions (Poisson model, needs team_form_history)...');
        const scorelines = await processScorelinePredictions();
        logger.info({ ...scorelines }, '[L5.5] ✓ scoreline predictions');

        // ── LAYER 5.6 ── Needs predicted goals (L5.5) + strength/versatility
        // (L2/L3) already computed above.
        logger.info('[L5.6/3] Net Battle Index (z-score normalized)...');
        const nbsi = await processNetBattleIndex();
        logger.info({ ...nbsi }, '[L5.6] ✓ net battle index');

        // ── LAYER 5.8 ── EXTENDED INTELLIGENCE SUITE. Dependency order:
        //   form-quality (needs match_results + team_strength_ratings only)
        //     -> betting-intelligence (needs team_season_statistics + form_index)
        //     -> ht-ft (independent — match_results half-time columns only)
        //     -> team-motivation (needs form-quality + momentum + venue)
        //     -> the match-scoped group, all needing match_predicted_lineups
        //        (L5, already run above): player-match-impact, team-versatility,
        //        formation-matchup, position-adaptability, tactical-flexibility,
        //        substitution-impact (also needs L5.7 xiStrength's
        //        player_strength_score), squad-depth-comparison
        //     -> match-performance-comparison (needs betting-intelligence +
        //        form-quality + momentum, all above)
        //     -> match-impact-summary (needs team-motivation, above)
        logger.info('[L5.8/3] Extended intelligence suite (14 processors)...');
        const formQuality = await processTeamFormQuality();
        logger.info({ ...formQuality }, '[L5.8] ✓ team form quality');
        const bettingIntel = await processTeamBettingIntelligence();
        logger.info({ ...bettingIntel }, '[L5.8] ✓ team betting intelligence');
        const htft = await processHTFTProbabilities();
        logger.info({ ...htft }, '[L5.8] ✓ HT/FT probabilities');
        const teamMotivation = await processTeamMotivation();
        logger.info({ ...teamMotivation }, '[L5.8] ✓ team motivation');
        const playerVersatility = await processPlayerVersatility();
        logger.info({ ...playerVersatility }, '[L5.8] ✓ player versatility');
        const playerMatchImpact = await processPlayerMatchImpact();
        logger.info({ ...playerMatchImpact }, '[L5.8] ✓ player match impact');
        const teamVersatilityMatch = await processTeamVersatility();
        logger.info({ ...teamVersatilityMatch }, '[L5.8] ✓ team versatility (per-match)');
        const formationMatchup = await processFormationMatchup();
        logger.info({ ...formationMatchup }, '[L5.8] ✓ formation matchup');
        const positionAdaptability = await processPositionAdaptability();
        logger.info({ ...positionAdaptability }, '[L5.8] ✓ position adaptability');
        const tacticalFlexibility = await processTacticalFlexibility();
        logger.info({ ...tacticalFlexibility }, '[L5.8] ✓ tactical flexibility');
        const substitutionImpact = await processSubstitutionImpact();
        logger.info({ ...substitutionImpact }, '[L5.8] ✓ substitution impact');
        const squadDepthComparison = await processSquadDepthComparison();
        logger.info({ ...squadDepthComparison }, '[L5.8] ✓ squad depth comparison');
        const matchPerformanceComparison = await processMatchPerformanceComparison();
        logger.info({ ...matchPerformanceComparison }, '[L5.8] ✓ match performance comparison');
        const matchImpactSummary = await processMatchImpactSummary();
        logger.info({ ...matchImpactSummary }, '[L5.8] ✓ match impact summary');

        // ── LAYER 5.9 ── MATCH PAGE SUITE (needs betting-intelligence,
        // match_intelligence, player_match_impact, match_predicted_lineups —
        // all computed above). Dependency order within the layer:
        // team-match-impact -> match-impact-advantage (needs team-match-impact)
        // -> match-key-battles / match-positional-matchups / player-matchup
        //    (need player_match_impact + predicted lineups)
        // -> match-tactical-advantages (independent within this layer).
        logger.info('[L5.9/3] Match page suite (6 processors)...');
        const teamMatchImpact = await processTeamMatchImpact();
        logger.info({ ...teamMatchImpact }, '[L5.9] ✓ team match impact');
        const matchImpactAdvantage = await processMatchImpactAdvantage();
        logger.info({ ...matchImpactAdvantage }, '[L5.9] ✓ match impact advantage');
        const matchKeyBattles = await processMatchKeyBattles();
        logger.info({ ...matchKeyBattles }, '[L5.9] ✓ match key battles');
        const matchPositionalMatchups = await processMatchPositionalMatchups();
        logger.info({ ...matchPositionalMatchups }, '[L5.9] ✓ match positional matchups');
        const matchTacticalAdvantages = await processMatchTacticalAdvantages();
        logger.info({ ...matchTacticalAdvantages }, '[L5.9] ✓ match tactical advantages');
        const playerMatchup = await processPlayerMatchup();
        logger.info({ ...playerMatchup }, '[L5.9] ✓ player matchup');

        // ── LAYER 6 ── Needs everything above — dashboard aggregate stats ───
        logger.info('[L6/3] Dashboard summary (needs all prior layers)...');
        const dashboardSummary = await processDashboardSummary();
        logger.info({ ...dashboardSummary }, '[L6] ✓ dashboard summary');

        const elapsed = Math.round((Date.now() - t0) / 1000);
        logger.info({
          durationSeconds: elapsed,
          form, fixture, locs, travel, matchTravel, momentum, fixtureDiff,
          strength, venue, teamIntel, playerIntel, leagueIntel, matchIntel, matchSignals, predictedLineups, xiStrength, scorelines, nbsi,
          formQuality, bettingIntel, htft, teamMotivation, playerVersatility, playerMatchImpact, teamVersatilityMatch, formationMatchup,
          positionAdaptability, tacticalFlexibility, substitutionImpact, squadDepthComparison, matchPerformanceComparison, matchImpactSummary,
          teamMatchImpact, matchImpactAdvantage, matchKeyBattles, matchPositionalMatchups, matchTacticalAdvantages, playerMatchup,
          dashboardSummary,
        }, '━━━ process:all-db complete in ' + elapsed + 's ━━━');
        break;
      }

      // ── DATE-SCOPED process:all-db VARIANTS ──────────────────────────────
      // Same full pipeline as process:all-db but L4 (match-intelligence) and
      // L2 match-travel are date-scoped — only reprocesses the relevant
      // subset of matches. L1-L3 and L5-L6 always run in full since they're
      // team-level aggregations with no meaningful date dimension.
      // Strategy: resolve date opts once, pass to both date-aware processors.
      case 'process:all-db:today':
      case 'process:all-db:tomorrow':
      case 'process:all-db:yesterday':
      case 'process:all-db:date':
      case 'process:all-db:range':
      case 'process:all-db:catchup': {
        const t0 = Date.now();

        // ── Resolve date opts from command variant ────────────────────────
        let dbDateOpts: { dateFilter?: string; dateFrom?: string; dateTo?: string } = {};
        let modeLabel = '';

        if (command === 'process:all-db:today') {
          dbDateOpts = { dateFilter: 'today' };
          modeLabel  = 'TODAY';
        } else if (command === 'process:all-db:tomorrow') {
          dbDateOpts = { dateFilter: 'tomorrow' };
          modeLabel  = 'TOMORROW';
        } else if (command === 'process:all-db:yesterday') {
          const yest = new Date();
          yest.setUTCDate(yest.getUTCDate() - 1);
          dbDateOpts = { dateFilter: yest.toISOString().split('T')[0] };
          modeLabel  = `YESTERDAY (${dbDateOpts.dateFilter})`;
        } else if (command === 'process:all-db:date') {
          const d = args[0];
          if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            logger.error('Usage: process:all-db:date YYYY-MM-DD');
            break;
          }
          dbDateOpts = { dateFilter: d };
          modeLabel  = d;
        } else if (command === 'process:all-db:range') {
          const from = args[0]; const to = args[1];
          if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
            logger.error('Usage: process:all-db:range YYYY-MM-DD [YYYY-MM-DD]');
            break;
          }
          if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            logger.error('End date must be YYYY-MM-DD if provided');
            break;
          }
          dbDateOpts = { dateFrom: from, dateTo: to };
          modeLabel  = `${from} → ${to ?? 'today'}`;
        } else if (command === 'process:all-db:catchup') {
          const daysBack = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : 3;
          const fromDate = new Date();
          fromDate.setUTCDate(fromDate.getUTCDate() - daysBack);
          dbDateOpts = { dateFrom: fromDate.toISOString().split('T')[0] };
          modeLabel  = `last ${daysBack} days (from ${dbDateOpts.dateFrom})`;
        }

        logger.info({ scope: modeLabel }, `━━━ process:all-db:* started (scope: ${modeLabel}) ━━━`);

        // ── L1-L3: always full — team-level aggregations ─────────────────
        logger.info('[L1] Form history...');
        const form       = await processFormBackfill();
        logger.info('[L1] Fixture load...');
        const fixture    = await processTeamFixtureLoad();
        logger.info('[L1] Team locations...');
        const locs       = await processTeamLocations();
        logger.info('[L2] Team travel load...');
        const travel     = await processTeamTravelLoad();
        logger.info(`[L2] Match travel intelligence (scope: ${modeLabel})...`);
        const matchTravel = await processMatchTravelIntelligence(dbDateOpts);
        logger.info('[L2] Strength ratings...');
        const strength   = await processTeamStrengthRatings();
        logger.info('[L2] Venue performance...');
        const venue      = await processTeamVenuePerformance();
        logger.info('[L3] Team intelligence...');
        const teamIntel  = await processTeamIntelligencePartial();
        logger.info('[L3] Player intelligence...');
        const playerIntel = await processPlayerIntelligence();

        // ── L4: date-scoped — only the relevant match subset ─────────────
        logger.info(`[L4] Match intelligence (scope: ${modeLabel})...`);
        const matchIntel = await processMatchIntelligencePartial(dbDateOpts);
        logger.info({ ...matchIntel }, '[L4] ✓ match intelligence');

        // ── L5-L6: always full ────────────────────────────────────────────
        logger.info('[L5] Predicted lineups...');
        const predictedLineups = await processPredictedLineups();
        logger.info('[L5.5] Scoreline predictions...');
        const scorelines = await processScorelinePredictions();
        logger.info('[L5.6] Net Battle Index...');
        const nbsi = await processNetBattleIndex();
        logger.info('[L6] Dashboard summary...');
        const dashboardSummary = await processDashboardSummary();

        const elapsed = Math.round((Date.now() - t0) / 1000);
        logger.info({
          durationSeconds: elapsed, scope: modeLabel,
          form, fixture, locs, travel, matchTravel,
          strength, venue, teamIntel, playerIntel, matchIntel,
          predictedLineups, scorelines, nbsi, dashboardSummary,
        }, `━━━ process:all-db:* complete in ${elapsed}s (scope: ${modeLabel}) ━━━`);
        break;
      }

      // ── EXTENDED INTELLIGENCE SUITE (see processExtendedIntelligence.ts) ──
      case 'process:form-quality': {
        logger.info('Computing team form quality (opponent-adjusted)...');
        const r = await processTeamFormQuality();
        logger.info(r, 'Team form quality complete');
        break;
      }
      case 'process:betting-intelligence': {
        logger.info('Computing team betting intelligence from season statistics...');
        const r = await processTeamBettingIntelligence();
        logger.info(r, 'Team betting intelligence complete');
        break;
      }
      case 'process:ht-ft': {
        logger.info('Computing half-time/full-time probabilities...');
        const r = await processHTFTProbabilities();
        logger.info(r, 'HT/FT probabilities complete');
        break;
      }
      case 'process:player-match-impact': {
        logger.info('Computing player match impact...');
        const r = await processPlayerMatchImpact();
        logger.info(r, 'Player match impact complete');
        break;
      }
      case 'process:player-match-impact:ids': {
        const matchIds = args.filter((a: string) => /^\d+$/.test(a)).map((a: string) => Number(a));
        if (matchIds.length === 0) {
          logger.error('Usage: process:player-match-impact:ids <id1> <id2> ...');
          break;
        }
        logger.info({ matchIds }, 'Computing player match impact for specific matches...');
        const r = await processPlayerMatchImpact({ matchIds });
        logger.info(r, 'Player match impact (specific IDs) complete');
        break;
      }
      case 'process:player-versatility': {
        logger.info('Computing player versatility...');
        const r = await processPlayerVersatility();
        logger.info(r, 'Player versatility complete');
        break;
      }
      case 'process:team-match-impact': {
        logger.info('Computing team match impact...');
        const r = await processTeamMatchImpact();
        logger.info(r, 'Team match impact complete');
        break;
      }
      case 'process:match-impact-advantage': {
        logger.info('Computing match impact advantage...');
        const r = await processMatchImpactAdvantage();
        logger.info(r, 'Match impact advantage complete');
        break;
      }
      case 'process:match-key-battles': {
        logger.info('Computing match key battles...');
        const r = await processMatchKeyBattles();
        logger.info(r, 'Match key battles complete');
        break;
      }
      case 'process:match-key-battles:ids': {
        const matchIds = args.filter((a: string) => /^\d+$/.test(a)).map((a: string) => Number(a));
        if (matchIds.length === 0) {
          logger.error('Usage: process:match-key-battles:ids <id1> <id2> ...');
          break;
        }
        logger.info({ matchIds }, 'Computing match key battles for specific matches...');
        const r = await processMatchKeyBattles({ matchIds });
        logger.info(r, 'Match key battles (specific IDs) complete');
        break;
      }
      case 'process:match-positional-matchups': {
        logger.info('Computing match positional matchups...');
        const r = await processMatchPositionalMatchups();
        logger.info(r, 'Match positional matchups complete');
        break;
      }
      case 'process:match-tactical-advantages': {
        logger.info('Computing match tactical advantages...');
        const r = await processMatchTacticalAdvantages();
        logger.info(r, 'Match tactical advantages complete');
        break;
      }
      case 'process:player-matchup': {
        logger.info('Computing player matchup...');
        const r = await processPlayerMatchup();
        logger.info(r, 'Player matchup complete');
        break;
      }
      case 'process:match-performance-comparison': {
        logger.info('Computing match performance comparison...');
        const r = await processMatchPerformanceComparison();
        logger.info(r, 'Match performance comparison complete');
        break;
      }

      case 'process:match-performance:ids': {
        const matchIds = args.filter((a: string) => /^\d+$/.test(a)).map((a: string) => Number(a));
        if (matchIds.length === 0) {
          logger.error('Usage: process:match-performance:ids <id1> <id2> ...');
          break;
        }
        logger.info({ matchIds }, 'Computing match performance comparison for specific matches...');
        const r = await processMatchPerformanceComparison({ matchIds });
        logger.info(r, 'Match performance comparison (specific IDs) complete');
        break;
      }

      case 'process:match-performance:range': {
        const from = args[0];
        const to = args[1];
        if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
          logger.error('Usage: process:match-performance:range YYYY-MM-DD [YYYY-MM-DD]');
          break;
        }
        const opts: any = { dateFrom: from };
        if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) opts.dateTo = to;
        logger.info({ from, to: to || 'today' }, 'Computing match performance comparison for date range...');
        const r = await processMatchPerformanceComparison(opts);
        logger.info(r, 'Match performance comparison (range) complete');
        break;
      }
      case 'process:team-versatility': {
        logger.info('Computing team versatility (per-match)...');
        const r = await processTeamVersatility();
        logger.info(r, 'Team versatility complete');
        break;
      }
      case 'process:formation-matchup': {
        logger.info('Computing formation matchup...');
        const r = await processFormationMatchup();
        logger.info(r, 'Formation matchup complete');
        break;
      }
      case 'process:position-adaptability': {
        logger.info('Computing position adaptability...');
        const r = await processPositionAdaptability();
        logger.info(r, 'Position adaptability complete');
        break;
      }
      case 'process:tactical-flexibility': {
        logger.info('Computing tactical flexibility...');
        const r = await processTacticalFlexibility();
        logger.info(r, 'Tactical flexibility complete');
        break;
      }
      case 'process:substitution-impact': {
        logger.info('Computing substitution impact...');
        const r = await processSubstitutionImpact();
        logger.info(r, 'Substitution impact complete');
        break;
      }
      case 'process:substitution-impact:ids': {
        const matchIds = args.filter((a: string) => /^\d+$/.test(a)).map((a: string) => Number(a));
        if (matchIds.length === 0) {
          logger.error('Usage: process:substitution-impact:ids <id1> <id2> ...');
          break;
        }
        logger.info({ matchIds }, 'Computing substitution impact for specific matches...');
        const r = await processSubstitutionImpact({ matchIds });
        logger.info(r, 'Substitution impact (specific IDs) complete');
        break;
      }
      case 'process:squad-depth-comparison': {
        logger.info('Computing squad depth comparison...');
        const r = await processSquadDepthComparison();
        logger.info(r, 'Squad depth comparison complete');
        break;
      }
      case 'process:team-motivation': {
        logger.info('Computing team motivation (league-table context)...');
        const r = await processTeamMotivation();
        logger.info(r, 'Team motivation complete');
        break;
      }
      case 'process:match-impact-summary': {
        logger.info('Computing match impact summary...');
        const r = await processMatchImpactSummary();
        logger.info(r, 'Match impact summary complete');
        break;
      }

      case 'process:travel-load': {
        logger.info('Computing team travel load — DB only...');
        const r = await processTeamTravelLoad();
        logger.info(r, 'Travel load complete');
        break;
      }

      case 'process:match-travel': {
        logger.info('Computing match travel intelligence — DB only...');
        const r = await processMatchTravelIntelligence();
        logger.info(r, 'Match travel intelligence complete');
        break;
      }

      case 'process:team-intelligence': {
        logger.info('Computing partial team intelligence (form + congestion + travel) — DB only...');
        const r = await processTeamIntelligencePartial();
        logger.info(r, 'Team intelligence (partial) complete');
        break;
      }

      case 'process:match-intelligence': {
        logger.info('Computing match intelligence (all matches) — DB only...');
        const r = await processMatchIntelligencePartial();
        logger.info(r, 'Match intelligence complete');
        break;
      }

      case 'archive:readiness-snapshot:yesterday': {
        const yest = new Date();
        yest.setUTCDate(yest.getUTCDate() - 1);
        const dateStr = yest.toISOString().split('T')[0];
        logger.info({ date: dateStr }, 'Archiving readiness snapshot for YESTERDAY...');
        const r = await archiveReadinessSnapshotForDate(dateStr);
        logger.info(r, 'Yesterday snapshot complete');
        break;
      }

      case 'archive:readiness-snapshot:date': {
        const d = args[0];
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          logger.error('Usage: archive:readiness-snapshot:date YYYY-MM-DD');
          break;
        }
        logger.info({ date: d }, 'Archiving readiness snapshot for specific date...');
        const r = await archiveReadinessSnapshotForDate(d);
        logger.info(r, 'Date snapshot complete');
        break;
      }

      case 'archive:readiness-snapshot:range': {
        const from = args[0];
        const to = args[1];
        if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
          logger.error('Usage: archive:readiness-snapshot:range YYYY-MM-DD YYYY-MM-DD');
          break;
        }
        if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          logger.error('End date must be YYYY-MM-DD if provided');
          break;
        }

        const start = new Date(from);
        const end = to ? new Date(to) : new Date();
        const results: any[] = [];
        
        for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const dateStr = d.toISOString().split('T')[0];
          const r = await archiveReadinessSnapshotForDate(dateStr);
          results.push({ date: dateStr, ...r });
        }
        
        logger.info({ results }, 'Date range snapshot complete');
        break;
      }

      case 'archive:readiness-snapshot:catchup': {
        const daysBack = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : 3;
        const results: any[] = [];
        
        for (let i = daysBack; i >= 1; i--) {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          const r = await archiveReadinessSnapshotForDate(dateStr);
          results.push({ date: dateStr, ...r });
        }
        
        logger.info({ daysBack, results }, `Catch-up snapshot for last ${daysBack} days complete`);
        break;
      }

      case 'archive:readiness-snapshot': {
        // Append-only pre-match snapshot. Run nightly AFTER sync + process
        // stages, so it snapshots fully-computed readiness. Insert-if-absent:
        // safe to run repeatedly; a match already snapshotted is skipped, its
        // first pre-match reading preserved. See docs/league-gap-analytics-spec.md.
        logger.info('Archiving pre-match readiness snapshot...');
        const r = await archiveReadinessSnapshot();
        logger.info(r, 'Readiness snapshot complete');
        break;
      }

      case 'archive:link-results': {
        // Finalization: fills result columns on snapshots whose match has
        // finished. Writes ONLY result columns, never the frozen prediction.
        logger.info('Linking finished results to readiness snapshots...');
        const r = await linkReadinessResults();
        logger.info(r, 'Result linking complete');
        break;
      }

      case 'analytics:refresh-league-gap': {
        // Rebuild the per-(league × gap tier) accuracy aggregates the League
        // Analytics page reads. Run nightly after archive:link-results.
        logger.info('Rebuilding league gap analytics aggregates...');
        const r = await refreshLeagueGapAnalytics();
        logger.info(r, 'League gap analytics refresh complete');
        break;
      }

      case 'process:historical-context:backfill': {
        // One-time (or repair) full replay: reconstructs the league table as
        // it stood before EVERY finished match, per (tournament, season), and
        // writes pre-kickoff snapshots + opponent context. No future leakage
        // by construction. Idempotent — safe to re-run after data repairs.
        logger.info('Backfilling historical context (full replay)...');
        const r = await processHistoricalContextBackfill();
        logger.info(r, 'Historical context backfill complete');
        break;
      }

      case 'process:historical-context': {
        // Incremental: replays only tournament groups touched in the window
        // (default 3 days), writes window + upcoming rows. Also captures live
        // strength_rating_before for matches near kickoff — the only moment
        // that value can honestly be recorded.
        const days = args[0] ? parseInt(args[0], 10) : 3;
        logger.info({ days }, 'Processing recent historical context...');
        const r = await processHistoricalContextRecent(days);
        logger.info(r, 'Historical context complete');
        break;
      }

      case 'process:form-quality': {
        // Opponent-adjusted form, strength of schedule, tier splits,
        // giant-killer/flat-track, expected-vs-actual points, volatility.
        // Depends on historical context. DB-only.
        logger.info('Processing form quality...');
        const r = await processFormQuality();
        logger.info(r, 'Form quality complete');
        break;
      }

      case 'backtest:signals': {
        // Replays the shared rule registry over all finished matches using
        // ONLY pre-kickoff features; stores hit rate vs base rate per rule.
        // The signal writer refuses to publish uncalibrated rules.
        logger.info('Backtesting signal rules...');
        const r = await backtestSignals();
        logger.info(r, 'Signal backtest complete');
        break;
      }

      case 'process:risk-opportunity': {
        // Risk engine + opportunity score + executive brief + calibrated
        // market signals for upcoming matches (PT_HORIZON_DAYS, default 7).
        // Writes only its own signal_group ('pitchterminal').
        logger.info('Processing risk/opportunity layer...');
        const r = await processRiskOpportunity();
        logger.info(r, 'Risk/opportunity complete');
        break;
      }

      case 'process:match-intelligence:today': {
        // Targeted — only today's matches (UTC). Fast, cheap, safe to run
        // after sync:today/sync:tomorrow without reprocessing all 480+ matches.
        logger.info('Computing match intelligence for TODAY — DB only...');
        const r = await processMatchIntelligencePartial({ dateFilter: 'today' });
        logger.info(r, 'Match intelligence (today) complete');
        break;
      }

      case 'process:match-intelligence:tomorrow': {
        logger.info('Computing match intelligence for TOMORROW — DB only...');
        const r = await processMatchIntelligencePartial({ dateFilter: 'tomorrow' });
        logger.info(r, 'Match intelligence (tomorrow) complete');
        break;
      }

      case 'process:match-intelligence:date': {
        // Single date: npx ts-node src/cli.ts process:match-intelligence:date 2026-07-04
        const dateArg = args[0];
        if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
          logger.error('Usage: process:match-intelligence:date YYYY-MM-DD');
          break;
        }
        logger.info({ date: dateArg }, 'Computing match intelligence for specific date — DB only...');
        const r = await processMatchIntelligencePartial({ dateFilter: dateArg });
        logger.info(r, 'Match intelligence (date) complete');
        break;
      }

      case 'process:match-intelligence:yesterday': {
        // Convenience alias — catches yesterday without needing to type the date
        const yest = new Date();
        yest.setUTCDate(yest.getUTCDate() - 1);
        const yesterdayStr = yest.toISOString().split('T')[0];
        logger.info({ date: yesterdayStr }, 'Computing match intelligence for yesterday — DB only...');
        const r = await processMatchIntelligencePartial({ dateFilter: yesterdayStr });
        logger.info(r, 'Match intelligence (yesterday) complete');
        break;
      }

      case 'process:match-intelligence:range': {
        // Date range: npx ts-node src/cli.ts process:match-intelligence:range 2026-06-29 2026-07-01
        // End date is optional — defaults to today if omitted.
        // Designed for catch-up on local machines without crons where
        // one or more days were missed.
        const fromArg = args[0];
        const toArg   = args[1]; // optional
        if (!fromArg || !/^\d{4}-\d{2}-\d{2}$/.test(fromArg)) {
          logger.error('Usage: process:match-intelligence:range YYYY-MM-DD [YYYY-MM-DD]');
          break;
        }
        if (toArg && !/^\d{4}-\d{2}-\d{2}$/.test(toArg)) {
          logger.error('End date must be YYYY-MM-DD if provided');
          break;
        }
        const today = new Date().toISOString().split('T')[0];
        logger.info({ from: fromArg, to: toArg ?? today }, 'Computing match intelligence for date range — DB only...');
        const r = await processMatchIntelligencePartial({ dateFrom: fromArg, dateTo: toArg });
        logger.info(r, 'Match intelligence (range) complete');
        break;
      }

      case 'process:match-intelligence:catchup': {
        // Auto catch-up: npx ts-node src/cli.ts process:match-intelligence:catchup [days]
        // Defaults to last 3 days if no argument given — covers a typical
        // weekend or short break on a local machine without crons.
        // npx ts-node src/cli.ts process:match-intelligence:catchup 7  ← last 7 days
        const daysBack = args[0] && /^\d+$/.test(args[0]) ? Number(args[0]) : 3;
        const fromDate = new Date();
        fromDate.setUTCDate(fromDate.getUTCDate() - daysBack);
        const fromStr = fromDate.toISOString().split('T')[0];
        const today   = new Date().toISOString().split('T')[0];
        logger.info({ daysBack, from: fromStr, to: today }, `Catch-up: computing match intelligence for last ${daysBack} days — DB only...`);
        const r = await processMatchIntelligencePartial({ dateFrom: fromStr, dateTo: today });
        logger.info(r, 'Match intelligence (catch-up) complete');
        break;
      }

      case 'process:match-intelligence:ids': {
        // Specific matches: npx ts-node src/cli.ts process:match-intelligence:ids 712 713 714
        const matchIds = args.filter((a: string) => /^\d+$/.test(a)).map((a: string) => Number(a));
        if (matchIds.length === 0) {
          logger.error('Usage: process:match-intelligence:ids <id1> <id2> ...');
          break;
        }
        logger.info({ matchIds }, 'Computing match intelligence for specific matches — DB only...');
        const r = await processMatchIntelligencePartial({ matchIds });
        logger.info(r, 'Match intelligence (specific IDs) complete');
        break;
      }

      case 'process:player-intelligence': {
        // Also now computes and writes: player_intelligence.importance_score
        // (+ goal/assist/minutes share), team_goal_dependency (top-scorer
        // concentration risk), team_injury_impact (SUM of importance lost to
        // active injuries) — all from the same season-scoped player-stats
        // pass, no extra API calls, no extra sync needed.
        logger.info('Computing player intelligence (fatigue now blends real match load — run process:player-match-load first if it hasn\'t run recently) + goal dependency + injury impact — DB only...');
        const r = await processPlayerIntelligence();
        logger.info(r, 'Player intelligence complete');
        break;
      }

      case 'process:strength-ratings': {
        logger.info('Computing team strength ratings — DB only...');
        const r = await processTeamStrengthRatings();
        logger.info(r, 'Strength ratings complete');
        break;
      }

      case 'process:venue-performance': {
        logger.info('Computing team venue performance (home/away splits) — DB only...');
        const r = await processTeamVenuePerformance();
        logger.info(r, 'Venue performance complete');
        break;
      }

      case 'sync:leagues': {
        // Diagnostic: show what leagues are configured and what's in DB
        const summary = getTrackedLeaguesSummary();
        console.log('\n=== NinetyData Tracked Leagues ===');
        console.log(`Total: ${TRACKED_LEAGUE_COUNT} leagues\n`);
        Object.entries(summary).forEach(([region, count]) => {
          console.log(`  ${region}: ${count} leagues`);
        });
        console.log('\nAll tracked leagues:');
        TRACKED_LEAGUES.forEach(l => {
          console.log(`  [${l.band}] ${l.name} (${l.country || 'multi'}) — match: "${l.apiNameMatch}"`);
        });
        console.log('');
        break;
      }

      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;

      default:
        throw new Error(`Unknown command: ${command}`);
    }

    logger.info({ command }, 'Command executed successfully');

    // Surface per-key API call usage for this run — helps confirm dual-key
    // rotation is working and gives visibility into daily quota consumption.
    // In-memory only (resets each process run), not a historical record.
    const callCounts = sportsApiClient.getCallCounts();
    const totalCalls = Object.values(callCounts).reduce((a, b) => a + b, 0);
    if (totalCalls > 0) {
      logger.info({ callCounts, totalCalls }, 'API calls used this run');
    }

    process.exit(0);
  } catch (error: any) {
    logger.error(
      { command, error: error.message },
      'Command execution failed'
    );
    console.error(`\nError: ${error.message}\n`);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
RIP Phase 1 - CLI Utility

Usage: npx ts-node src/cli.ts <command> [args]

Commands:

  Diagnostics:
    sync:leagues                    Show all 41 tracked leagues and their config

  Master Feed (1 API call per date → 8 tables):
    sync:today                      ⭐ Sync today's fixtures (use in daily cron)
    sync:tomorrow                   ⭐ Sync tomorrow's fixtures (use in daily cron)
    sync:week                       Sync next 7 days — 7 API calls (use in weekly cron)
    sync:date <YYYY-MM-DD>          Sync a specific date
    sync:range <start> <end>        Sync a date range

  Squad Sync (smart cooldown — skips teams synced within 7 days):
    sync:squads:tracked             ⭐ PRIMARY: sync only teams in your 42 tracked leagues
                                    Derives team list from matches table — no country arg needed
    sync:squads:countries <list>    Sync by country, still filtered to tracked leagues only
                                    e.g. "Brazil,Finland" — runs Brazil Série A/B only, not all
    sync:team-players <teamId>      Force sync one specific team (ignores cooldown)
    sync:squads:all                 Sync ALL teams (~3hrs — use overnight only)

  Legacy Discovery (optional - schedule feed makes these redundant):
    sync:tournaments                Sync tournaments (now built into sync:date)
    sync:seasons                    Sync seasons (now built into sync:date)
    sync:schedule <date>            Legacy schedule sync (use sync:date instead)

  Processing (DB-only, zero API calls):
    process:all-db                  ⭐ Run ALL DB processors in one command
    process:form:recent             Precompute form for last 24hrs of matches
    process:form:backfill           Backfill form history for ALL finished matches
    process:fixture-load            Compute fixture congestion for all teams
    process:team-locations          Derive team home locations from venue history
    process:travel-load              Compute km traveled + travel fatigue per team
    process:match-travel             Compute per-match travel burden for both teams
    process:team-intelligence        Partial team_intelligence (form+congestion+travel)
    process:match-intelligence       Partial match_intelligence (rest+congestion+travel)
    archive:readiness-snapshot       Append-only pre-match readiness snapshot (run nightly after processing)
    archive:link-results             Fill result columns on snapshots whose match has finished
    analytics:refresh-league-gap     Rebuild per-league gap-accuracy aggregates for the analytics page
    process:net-battle-index         Net Battle Index — z-score normalized category comparison, no hand-picked weights, no verdict
    process:player-match-load        Derive per-match player minutes from season stats (proxy, run before process:player-intelligence)
    process:player-intelligence      Player fatigue/load/importance + goal dependency + injury impact
    process:injury-risk              REMOVED - fatigue now blends real load, see process:player-intelligence
    process:strength-ratings         Team strength (PPG, win%, market value) from form history
    process:venue-performance        Home/away performance splits from match results

  Squad Sync V2 — SofaScore (1 call populates 7 tables, throttled 1 req/2s):
    sync:squads:v2 [days]            ⭐ PRIMARY V2: tracked leagues, teams playing within next N days (default 1=today)
    sync:squads:countries:v2 <list>  V2 by country e.g. "Brazil,Finland"
    sync:squads:matches:v2 <ids>     V2 for teams in specific matches, by match external_match_id (needs 2+; space or comma separated)
    sync:tournament-events <ids> [type]          Sync all fixtures for specific tournaments (season auto-resolved, same
                                                 structure as schedule feed). Needs 2+ tournament external_ids, optional
                                                 trailing type: total|home|away (default total).
                                                 e.g. sync:tournament-events 42 55 108
                                                 e.g. sync:tournament-events 42 55 home
    sync:tournament-events:countries <c> [type]  Same sync by country name — resolves tournaments from DB via
                                                 tournaments JOIN countries. Accepts comma-separated or space-separated
                                                 country names + optional trailing type.
                                                 e.g. sync:tournament-events:countries "Brazil,Lithuania"
                                                 e.g. sync:tournament-events:countries Lithuania away
    sync:images                      One-time team crest backfill to Supabase Storage (re-run manually only on rebrand)
    sync:tournament-images           One-time tournament/league logo backfill - endpoint unverified, test small batch first
    sync:images:targeted             Targeted (re)sync for specific teams/leagues/matches: --teams <ids> --leagues <ids> --matches <ids> (any 1+, combinable, external_id not internal id)
    sync:player-stats:matches:v2 <ids>  Player season stats for teams in specific matches, same match external_match_id pattern
    sync:team-squad:v2 <id>          V2 force sync single team

  Utility:
    help, -h, --help                Show this message

Examples:

  # Sync today (populates 8 tables from 1 API call)
  npx ts-node src/cli.ts sync:date 2026-06-28

  # Backfill a week
  npx ts-node src/cli.ts sync:range 2026-06-01 2026-06-07

  # Sync squad for a specific team
  npx ts-node src/cli.ts sync:team-players 39

  # Backfill all form history
  npx ts-node src/cli.ts process:form:backfill

Note:
  - All commands are idempotent (safe to run multiple times)
  - sync:date is the primary command - use it for all regular syncing
  - Squad sync uses 7-day cooldown to minimise API calls
  - Logs in logs/ directory, set NODE_ENV=production for JSON logs
`);
}

// Parse CLI arguments and execute
const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

if (!command) {
  showHelp();
  process.exit(0);
}

handleCommand(command, ...commandArgs);
