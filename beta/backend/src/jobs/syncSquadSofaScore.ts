/**
 * NINETYDATA ENGINE — SOFASCORE SQUAD INTELLIGENCE (V2)
 *
 * PRIMARY DATA SOURCE: SofaScore /teams/{id}/players
 * THROTTLING:          1 request per 2 seconds (queue-based, no parallel)
 * SINGLE CALL RULE:    One request per team populates ALL of:
 *   1. players
 *   2. player_injuries
 *   3. player_transfers
 *   4. team_squads_snapshot
 *   5. team_position_depth
 *   6. team_transfer_intelligence
 *   7. team_intelligence (squad fields)
 *
 * COOLDOWN: 7 days per team (skip if recently synced)
 * PRIORITY: Teams with upcoming matches (next 3 days) are synced first
 */

import { sportsApiClient }  from '../services/sportsApiClient';
import { getTrackedLeagueSlugs } from '../config/trackedLeagues';
import { db } from '../db/client';
import { logger } from '../utils/logger';
import { logApiSample } from '../utils/apiSamples';
import { playerInjuriesRepository }            from '../repositories/PlayerInjuriesRepository';
import { teamPositionDepthRepository }         from '../repositories/TeamPositionDepthRepository';
import { teamTransferIntelligenceRepository }  from '../repositories/IntelligenceRepositories';

const COOLDOWN_DAYS = 7;
const THROTTLE_MS   = 2000; // 1 req / 2 seconds — mandatory per spec

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function injurySeverityScore(returnDays: number | null): number {
  if (!returnDays) return 0;
  if (returnDays <= 7)  return 25;
  if (returnDays <= 28) return 50;
  if (returnDays <= 90) return 75;
  return 100;
}

// injuryBurdenScore (count-based) removed — superseded by the market-value-
// weighted version in processTeamIntelligencePartial(), which is a better
// signal (losing a star player should register as a bigger burden than
// losing a fringe squad player, which a raw count can't capture).

function parsePositions(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map(p => p.trim()).filter(Boolean);
  return [];
}

function unixToDate(ts: number | null | undefined): string | null {
  if (!ts) return null;
  return new Date(ts * 1000).toISOString().split('T')[0];
}

function dobToDate(dob: string | number | null | undefined): string | null {
  if (!dob) return null;
  if (typeof dob === 'number') return unixToDate(dob);
  return dob.length === 10 ? dob : new Date(dob).toISOString().split('T')[0];
}

function ageFromDob(dob: string | number | null | undefined): number | null {
  if (!dob) return null;
  const d = typeof dob === 'number' ? new Date(dob * 1000) : new Date(dob);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── QUEUE-BASED THROTTLER (mandatory — no parallel requests) ─────────────────

class SofaScoreQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;

  enqueue(fn: () => Promise<void>): void {
    this.queue.push(fn);
    if (!this.running) this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      try { await fn(); } catch (e: any) { logger.error({ err: e.message }, 'Queue task failed'); }
      if (this.queue.length > 0) await delay(THROTTLE_MS);
    }
    this.running = false;
  }

  get size(): number { return this.queue.length; }
}

const globalQueue = new SofaScoreQueue();

// ─── ELIGIBILITY CHECK ────────────────────────────────────────────────────────

async function wasRecentlySynced(teamId: number): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COOLDOWN_DAYS);
  const { data } = await db
    .from('team_squads_snapshot')
    .select('snapshot_date')
    .eq('team_id', teamId)
    .gte('snapshot_date', cutoff.toISOString().split('T')[0])
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// ── YOUTH / RESERVE / NATIONAL TEAM DETECTION ─────────────────────────────

// Team name patterns that indicate non-senior club teams.
// These teams appear in schedule data but have no squad endpoint or irrelevant squads.
const YOUTH_TEAM_PATTERNS = [
  ' U17', ' U18', ' U19', ' U20', ' U21', ' U23',
  ' Sub-17', ' Sub-18', ' Sub-19', ' Sub-20', ' Sub-21', ' Sub-23',
  ' II', ' III', ' B Team', ' B)', ' -B ', ' Reserve', ' Reserves',
  ' Youth', ' Academy', ' Development', ' Women', ' Ladies', ' Fem',
];

function isLikelyNonClubTeam(teamName: string, country: string | null): boolean {
  if (!teamName) return false;
  const name = teamName.trim();
  // Youth/reserve patterns in team name
  if (YOUTH_TEAM_PATTERNS.some(p => name.includes(p))) return true;
  // National team: exact match between team name and country
  if (country && name.toLowerCase() === country.toLowerCase()) return true;
  // Common national/non-club prefixes
  if (/^(National|Olympic|Paralympic|All-Star)\s/i.test(name)) return true;
  return false;
}

/**
 * Returns ONLY club teams from EXACTLY tracked league competitions.
 *
 * PRECISION APPROACH — uses tournaments table with slug + category matching:
 *
 *   Step 1: tournaments table  →  slug + category exact match
 *           e.g. slug='brasileirao-serie-b' AND category='Brazil'
 *           → gets exact tournament name "Brasileirão Série B"
 *
 *   Step 2: matches table  →  competition IN (exact tournament names)
 *           → no partial matching, no false positives from U20 cups etc.
 *
 *   Step 3: teams table  →  filter by isLikelyNonClubTeam()
 *           → removes national teams, youth squads, reserve teams
 *
 * This is far more precise than name-based partial matching.
 * Falls back to name-based filter if no tournaments found in DB.
 */
async function getTrackedLeagueTeams(daysAhead = 1): Promise<any[]> {

  // ── Step 1: Get exact tracked tournament names from DB via slug + category ─

  const trackedSlugs = getTrackedLeagueSlugs();
  const allSlugs = trackedSlugs.map(s => s.slug);

  // Fetch all tournaments whose slug is in our tracked list
  const { data: dbTournaments, error: tErr } = await db
    .from('tournaments')
    .select('id, name, slug, category')
    .in('slug', allSlugs);

  if (tErr) {
    logger.error({ error: tErr.message }, 'Failed to query tournaments table');
    return [];
  }

  // Cross-reference: slug must match AND category (country) must match
  const exactTournamentNames = new Set<string>();
  const matchedLeagues: string[] = [];

  for (const dbT of dbTournaments ?? []) {
    const tSlug     = (dbT.slug ?? '').toLowerCase();
    const tCategory = (dbT.category ?? '').toLowerCase();

    for (const tracked of trackedSlugs) {
      if (tracked.slug.toLowerCase() !== tSlug) continue;

      // Category check: if config has a country (or array of countries), at
      // least one must match the DB tournament's category. Handles both the
      // legacy single-string form and the new multi-country array form (e.g.
      // MLS: ['USA', 'Canada'], EFL Championship: ['England', 'Wales']).
      const countryOk = !tracked.country || (
        Array.isArray(tracked.country)
          ? tracked.country.some(c => tCategory === c || tCategory.includes(c))
          : tCategory === tracked.country || tCategory.includes(tracked.country)
      );

      if (countryOk) {
        exactTournamentNames.add(dbT.name);
        matchedLeagues.push(`${dbT.name} (${dbT.category})`);
        break;
      }
    }
  }

  if (exactTournamentNames.size === 0) {
    logger.warn('No tracked tournaments found in DB — run sync:today first to populate tournaments table');
    return [];
  }

  logger.debug({ matched: matchedLeagues.length, tournaments: matchedLeagues }, 'Resolved tracked tournaments from DB');

  // ── Step 2: Get team IDs from matches WHERE competition is exactly tracked ─

  // Supabase .in() has a limit; chunk if needed (most cases < 50 names)
  // Date window: only matches within the daysAhead window
  const now    = new Date().toISOString();
  const cutoff = new Date(Date.now() + daysAhead * 86400000).toISOString();

  const nameList = Array.from(exactTournamentNames);
  const teamIds  = new Set<number>();
  const chunkSize = 50;

  for (let i = 0; i < nameList.length; i += chunkSize) {
    const { data: matchRows } = await db
      .from('matches')
      .select('home_team_id, away_team_id')
      .in('competition', nameList.slice(i, i + chunkSize))
      .gte('date', now)
      .lte('date', cutoff);

    for (const m of matchRows ?? []) {
      if (m.home_team_id) teamIds.add(m.home_team_id);
      if (m.away_team_id) teamIds.add(m.away_team_id);
    }
  }

  if (teamIds.size === 0) {
    logger.warn({ tournaments: nameList }, 'No matches found for tracked tournaments — sync schedule data first');
    return [];
  }

  // ── Step 3: Fetch team records and filter non-club teams ─────────────────

  const { data: teams } = await db
    .from('teams')
    .select('id, external_id, name, country')
    .in('id', Array.from(teamIds));

  const clubTeams = (teams ?? []).filter(
    (t: any) => !isLikelyNonClubTeam(t.name, t.country)
  );

  logger.info({
    trackedTournaments:  exactTournamentNames.size,
    teamsFromMatches:    teamIds.size,
    nonClubFiltered:     (teams ?? []).length - clubTeams.length,
    finalClubTeams:      clubTeams.length,
  }, 'Tracked league teams resolved (slug + category exact match)');

  return clubTeams;
}

async function getTeamsWithUpcomingMatches(days = 3): Promise<Set<number>> {
  const now    = new Date().toISOString();
  const future = new Date(Date.now() + days * 86400000).toISOString();
  const { data } = await db
    .from('matches')
    .select('home_team_id, away_team_id')
    .eq('status', 'scheduled')
    .gte('date', now)
    .lte('date', future);

  const ids = new Set<number>();
  (data ?? []).forEach((m: any) => {
    if (m.home_team_id) ids.add(m.home_team_id);
    if (m.away_team_id) ids.add(m.away_team_id);
  });
  return ids;
}

// ─── CORE: SINGLE TEAM SYNC ───────────────────────────────────────────────────

async function syncOneTeamSquad(
  teamExternalId: number,
  isPriority: boolean
): Promise<{ synced: boolean; skipped: boolean; error?: string }> {
  // 1. Get internal team record
  const { data: teamRows } = await db
    .from('teams')
    .select('id, name, country, external_id')
    .eq('external_id', teamExternalId)
    .limit(1);

  const team = teamRows?.[0];
  if (!team) {
    logger.warn({ teamExternalId }, 'Team not found in DB — skipping squad sync');
    return { synced: false, skipped: true };
  }

  // 2. Cooldown check (skip priority teams if forced)
  const recentlySynced = await wasRecentlySynced(team.id);
  if (recentlySynced && !isPriority) {
    logger.debug({ teamExternalId, teamId: team.id }, 'Squad recently synced — cooldown active, skipping');
    return { synced: false, skipped: true };
  }

  // 3. Fetch squad data via SportsAPI Pro
  //
  // NOTE ON DATA SOURCE:
  // SportsAPI Pro is a SofaScore data reseller. Their /teams/{id}/players endpoint
  // returns the full SofaScore player schema including:
  //   player.id, player.shortName, player.positionsDetailed, player.injury,
  //   player.proposedMarketValueRaw, player.contractUntilTimestamp, etc.
  // Team external_ids in our DB match SofaScore IDs exactly.
  //
  // Direct SofaScore access (https://api.sofascore.com) is blocked by Cloudflare
  // from server environments. SportsAPI Pro proxies this data without that restriction.

  logger.debug({ teamExternalId, teamName: team.name, isPriority }, 'Fetching squad from SportsAPI Pro (SofaScore data)');

  let rawResponse: any;
  try {
    rawResponse = await sportsApiClient.get<any>(`/teams/${teamExternalId}/players`);
  } catch (err: any) {
    const status = (err as any).response?.status;
    if (err.message?.includes('404') || status === 404) {
      logger.warn({ teamExternalId }, 'Squad endpoint 404 — team not in API');
      return { synced: false, skipped: true };
    }
    logger.error({ teamExternalId, status, error: err.message }, 'Squad API call failed');
    return { synced: false, skipped: false, error: err.message };
  }

  // 4. Normalise players — SofaScore nests player under "player" key
  const rawPlayers: any[] = rawResponse.players ?? rawResponse.data?.players ?? [];
  if (rawPlayers.length === 0) {
    logger.warn({ teamExternalId }, 'No players returned');
    return { synced: false, skipped: true };
  }

  // Full reference sample, zero extra API calls. NOTE: grouped by
  // team.country here, NOT tier band (A/B/C) — this function runs per-team
  // and doesn't otherwise resolve which tracked tournament/tier a team
  // belongs to, so forcing a true band lookup would mean an extra DB call
  // per team for a diagnostic feature. Country is what's already available
  // for free at this point. It's a real, useful signal (does a Brazilian
  // team's squad payload differ from an English one) even if it doesn't
  // answer the exact tier-band question the standings/stats samples do.
  await logApiSample('squad', team.country, rawResponse);

  logger.debug({ teamId: team.id, playerCount: rawPlayers.length, sample: JSON.stringify(rawPlayers[0]).slice(0, 300) }, 'Squad response sample');

  // Diagnostic: confirm whether transfer-related fields exist on this endpoint.
  // Check once per team sync — cheap, helps verify/refute the previousTeam fallback above.
  const sampleP = rawPlayers[0]?.player ?? rawPlayers[0];
  if (sampleP) {
    logger.debug({
      teamId: team.id,
      hasPreviousTeam: 'previousTeam' in sampleP,
      hasTransferDate: 'transferDate' in sampleP,
      topLevelKeys: Object.keys(sampleP),
    }, 'Transfer field diagnostic — confirms whether squad endpoint includes transfer history');
  }

  // ── PROCESS EACH PLAYER ──────────────────────────────────────────────────────

  const processedPlayers: Array<{ raw: any; internalId: number }> = [];
  const positionMap = new Map<string, { playerIds: number[]; injuredIds: number[]; marketValues: number[] }>();

  for (const rawEntry of rawPlayers) {
    // SofaScore wraps player data under "player" key
    const p: any = rawEntry.player ?? rawEntry;
    if (!p?.id) {
      logger.debug({ sample: JSON.stringify(rawEntry).slice(0, 200) }, 'Player has no id — skipping');
      continue;
    }

    const positions     = parsePositions(p.positionsDetailed);
    const injuryDays    = p.injury?.expectedReturn ?? null;
    const hasInjury     = !!p.injury;
    const severityScore = injurySeverityScore(injuryDays);
    const dobString     = dobToDate(p.dateOfBirth);
    const marketValue   = p.proposedMarketValueRaw?.value ?? p.marketValue ?? null;

    // ── TRANSFER DETECTION (zero extra API calls) ───────────────────────────
    // SofaScore's squad list endpoint does NOT include transfer history fields
    // (previousTeam/transferDate are checked below as a fallback but rarely,
    // if ever, present on this endpoint — confirmed by sample logging).
    //
    // Real signal: if this player's EXISTING team_id in our DB differs from
    // the team we're syncing now, that's a transfer we can detect for free
    // simply by comparing before/after team_id on every routine squad sync.
    const { data: existingPlayerRows } = await db
      .from('players')
      .select('id, team_id')
      .eq('external_id', p.id)
      .limit(1);

    const existingPlayer  = existingPlayerRows?.[0] ?? null;
    const priorTeamId     = existingPlayer?.team_id ?? null;
    const teamChanged     = priorTeamId !== null && priorTeamId !== team.id;

    // ── Table 1: players ────────────────────────────────────────────────────
    const playerPayload = {
      external_id:                  p.id,
      name:                         p.name ?? 'Unknown',
      short_name:                   p.shortName ?? null,
      position:                     p.position ?? null,
      position_detailed:            positions.join(',') || null,
      primary_position:             positions[0] ?? null,
      secondary_position:           positions[1] ?? null,
      tertiary_position:            positions[2] ?? null,
      nationality:                  p.country?.alpha2 ?? p.country?.alpha3 ?? null,
      nationality_code:             p.country?.alpha2 ?? null,
      preferred_foot:               p.preferredFoot ?? null,
      height_cm:                    p.height ?? null,
      jersey_number:                p.jerseyNumber ?? p.shirtNumber ?? null,
      date_of_birth:                dobString,
      contract_until:               unixToDate(p.contractUntilTimestamp ?? null),
      market_value:                 marketValue,
      team_id:                      team.id,
      current_injury:               hasInjury,
      injury_status:                hasInjury ? (p.injury.status ?? null) : null,
      injury_reason:                hasInjury ? (p.injury.reason ?? null) : null,
      injury_return_days:           hasInjury ? injuryDays : null,
      injury_expected_return_days:  hasInjury ? injuryDays : null,
      injury_start_timestamp:       hasInjury ? (p.injury.startTimestamp ?? null) : null,
      injury_end_timestamp:         hasInjury ? (p.injury.endTimestamp ?? null) : null,
      injury_updated_timestamp:     hasInjury ? (p.injury.updatedTimestamp ?? null) : null,
      injury_severity_score:        severityScore,
      updated_at:                   new Date().toISOString(),
    };

    // Strip id so BIGSERIAL generates it
    const { data: savedRows, error: playerErr } = await db
      .from('players')
      .upsert(playerPayload, { onConflict: 'external_id' })
      .select('id');

    if (playerErr) {
      logger.error({ error: playerErr.message, externalId: p.id }, 'Failed to upsert player');
      continue;
    }

    const internalPlayerId = savedRows?.[0]?.id;
    if (!internalPlayerId) continue;

    processedPlayers.push({ raw: p, internalId: internalPlayerId });

    // Record the detected transfer (team_id changed since last sync).
    // transfer_date is the sync date — the actual transfer date is unknown,
    // but this is the date we first observed the squad change, which is the
    // best available signal without per-player API calls.
    if (teamChanged && priorTeamId) {
      const today = new Date().toISOString().split('T')[0];
      const { data: existingTransfer } = await db
        .from('player_transfers')
        .select('id')
        .eq('player_id', internalPlayerId)
        .eq('to_team_id', team.id)
        .eq('transfer_date', today)
        .limit(1);

      if (!existingTransfer || existingTransfer.length === 0) {
        await db.from('player_transfers').upsert({
          player_id:     internalPlayerId,
          from_team_id:  priorTeamId,
          to_team_id:    team.id,
          transfer_date: today,
          source:        'squad_diff',
        }, { onConflict: 'player_id,transfer_date', ignoreDuplicates: true });
        logger.info({ playerId: internalPlayerId, from: priorTeamId, to: team.id }, 'Transfer detected via squad change');
      }
    }

    // ── Table 2: player_injuries ────────────────────────────────────────────
    if (hasInjury) {
      const daysOut = p.injury.startTimestamp
        ? Math.floor((Date.now() - p.injury.startTimestamp * 1000) / 86400000)
        : null;

      await playerInjuriesRepository.upsert({
        player_id:              internalPlayerId,
        injury_reason:          p.injury.reason ?? null,
        injury_status:          p.injury.status ?? null,
        expected_return_days:   injuryDays,
        start_timestamp:        p.injury.startTimestamp ?? null,
        end_timestamp:          p.injury.endTimestamp ?? null,
        updated_timestamp:      p.injury.updatedTimestamp ?? null,
        active:                 true,
        days_out:               daysOut,
        injury_severity_score:  severityScore,
        position_at_injury:     p.position ?? null,
        market_value_at_injury: marketValue,
      });
    } else {
      // Mark existing active injuries as resolved
      await playerInjuriesRepository.markInactive(internalPlayerId);
    }

    // ── Table 3: player_transfers (fallback — previousTeam/transferDate) ─────
    // NOTE: confirmed via sample logging that SofaScore's /teams/{id}/players
    // squad-list endpoint does not reliably include these fields. The primary
    // detection mechanism is the team_id-change check above. This block is
    // kept as a no-cost fallback in case a future API response includes it.
    if (p.previousTeam?.id && p.transferDate) {
      const { data: prevTeamRows } = await db
        .from('teams')
        .select('id')
        .eq('external_id', p.previousTeam.id)
        .limit(1);

      // from_team_id is nullable — don't drop the transfer record just
      // because the previous club isn't in our tracked-league DB. A player
      // moving from a non-tracked club is still a real transfer worth logging.
      const prevTeamId = prevTeamRows?.[0]?.id ?? null;

      const { data: existing } = await db
        .from('player_transfers')
        .select('id')
        .eq('player_id', internalPlayerId)
        .eq('transfer_date', p.transferDate)
        .limit(1);

      if (!existing || existing.length === 0) {
        await db.from('player_transfers').upsert({
          player_id:     internalPlayerId,
          from_team_id:  prevTeamId, // may be null — that's fine, column allows it
          to_team_id:    team.id,
          transfer_date: p.transferDate,
          source:        'squad_diff',
        }, { onConflict: 'player_id,transfer_date', ignoreDuplicates: true });
      }
    }

    // ── Build position map for Table 5 ──────────────────────────────────────
    for (const posCode of positions) {
      if (!positionMap.has(posCode)) {
        positionMap.set(posCode, { playerIds: [], injuredIds: [], marketValues: [] });
      }
      const entry = positionMap.get(posCode)!;
      entry.playerIds.push(internalPlayerId);
      if (hasInjury) entry.injuredIds.push(internalPlayerId);
      if (marketValue) entry.marketValues.push(marketValue);
    }
  }

  if (processedPlayers.length === 0) {
    logger.warn({ teamId: team.id }, 'No valid players processed');
    return { synced: false, skipped: true };
  }

  // ── Table 4: team_squads_snapshot ─────────────────────────────────────────
  const today       = new Date().toISOString().split('T')[0];
  const totalCount  = processedPlayers.length;
  const injuredList = processedPlayers.filter(({ raw: p }) => !!p.injury);
  const injCount    = injuredList.length;

  // BUG FIX: the previous version compared a player's alpha2 code (e.g.
  // 'BR') directly against team.country, a full name (e.g. 'Brazil').
  // 'br' !== 'brazil' is ALWAYS true, so every single player on every team
  // was being counted as foreign — foreign_players_count == totalCount on
  // every squad snapshot. Fix: derive the team's own alpha2 from its own
  // players (majority nationality among the squad) and compare like-for-like.
  const nationalityCounts = new Map<string, number>();
  for (const { raw: p } of processedPlayers) {
    const code = (p.country?.alpha2 ?? '').toUpperCase();
    if (!code) continue;
    nationalityCounts.set(code, (nationalityCounts.get(code) ?? 0) + 1);
  }
  // The team's "home" nationality is whichever alpha2 code appears most
  // often in the squad — far more reliable than trusting teams.country
  // (which may be missing, or store a full name instead of a code).
  let teamAlpha2 = '';
  let maxCount = 0;
  for (const [code, count] of nationalityCounts) {
    if (count > maxCount) { maxCount = count; teamAlpha2 = code; }
  }

  const foreignCount = processedPlayers.filter(({ raw: p }) => {
    const playerCode = (p.country?.alpha2 ?? '').toUpperCase();
    if (!playerCode) return true; // unknown nationality — treat as foreign, matches prior conservative default
    return playerCode !== teamAlpha2;
  }).length;

  const ages = processedPlayers
    .map(({ raw: p }) => ageFromDob(p.dateOfBirth))
    .filter((a): a is number => a !== null);
  const avgAge = ages.length ? +(ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1) : null;

  const marketValues = processedPlayers
    .map(({ raw: p }) => p.proposedMarketValueRaw?.value ?? p.marketValue ?? 0)
    .filter(Boolean);
  const avgMV = marketValues.length
    ? Math.round(marketValues.reduce((s, v) => s + v, 0) / marketValues.length)
    : null;

  // Precomputed percentages — see migration 007. Squad-stability frontend
  // page must never compute (foreign/injured / total) * 100 itself; that's
  // business calculation, not display formatting.
  const foreignPlayerPct = totalCount > 0 ? Math.round((foreignCount / totalCount) * 100 * 10) / 10 : null;
  const injuredPlayerPct = totalCount > 0 ? Math.round((injCount   / totalCount) * 100 * 10) / 10 : null;

  const snapshotPayload = {
    team_id:                team.id,
    snapshot_date:          today,
    players_count:          totalCount,
    avg_age:                avgAge,
    foreign_players_count:  foreignCount,
    domestic_players_count: totalCount - foreignCount,
    average_market_value:   avgMV,
    injured_player_count:   injCount,
    foreign_player_pct:     foreignPlayerPct,
    injured_player_pct:     injuredPlayerPct,
    // NOTE: goalkeeper_count/defender_count/midfielder_count/attacker_count
    // dropped per migration 007 — team_position_depth is the canonical
    // source for position breakdown (written separately, see below).
  };

  // team_squads_snapshot: check for existing record first (no unique constraint on team+date)
  const { data: existingSnap } = await db
    .from('team_squads_snapshot')
    .select('id')
    .eq('team_id', team.id)
    .eq('snapshot_date', today)
    .limit(1);

  if (existingSnap && existingSnap.length > 0) {
    const { error: snapErr } = await db
      .from('team_squads_snapshot')
      .update(snapshotPayload)
      .eq('id', existingSnap[0].id);
    if (snapErr) logger.error({ error: snapErr.message }, 'team_squads_snapshot update failed');
  } else {
    const { error: snapErr } = await db
      .from('team_squads_snapshot')
      .insert(snapshotPayload);
    if (snapErr) logger.error({ error: snapErr.message }, 'team_squads_snapshot insert failed');
  }

  // ── Table 5: team_position_depth ─────────────────────────────────────────
  const posDepthRows = Array.from(positionMap.entries()).map(([code, { playerIds, injuredIds, marketValues: mv }]) => ({
    team_id:             team.id,
    position_code:       code,
    player_count:        playerIds.length,
    injured_count:       injuredIds.length,
    available_count:     playerIds.length - injuredIds.length,
    total_market_value:  mv.reduce((s, v) => s + v, 0),
  }));
  await teamPositionDepthRepository.upsertBatch(posDepthRows);

  // ── Table 6: team_transfer_intelligence ───────────────────────────────────
  // Count transfers in/out within the last 12 months
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yearAgoStr = yearAgo.toISOString().split('T')[0];

  const { data: transfersIn } = await db
    .from('player_transfers')
    .select('id')
    .eq('to_team_id', team.id)
    .gte('transfer_date', yearAgoStr);

  const { data: transfersOut } = await db
    .from('player_transfers')
    .select('id')
    .eq('from_team_id', team.id)
    .gte('transfer_date', yearAgoStr);

  // Get previous squad size from most recent prior snapshot
  const { data: prevSnapshot } = await db
    .from('team_squads_snapshot')
    .select('players_count')
    .eq('team_id', team.id)
    .lt('snapshot_date', today)
    .order('snapshot_date', { ascending: false })
    .limit(1);

  const prevCount   = prevSnapshot?.[0]?.players_count ?? totalCount;
  const outCount    = transfersOut?.length ?? 0;
  const retained    = Math.max(0, prevCount - outCount);
  const retentionPct = prevCount > 0 ? Math.round((retained / prevCount) * 100) : 100;
  // Transfer activity: 100% retention → 100 score, 0% retention → 0
  const transferActivityScore = clamp(retentionPct);

  await teamTransferIntelligenceRepository.upsert({
    team_id:                team.id,
    transfers_in:           transfersIn?.length ?? 0,
    transfers_out:          outCount,
    retained_players:       retained,
    retention_percentage:   retentionPct,
    transfer_activity_score: transferActivityScore,
  });

  // ── team_intelligence is NOT written here ───────────────────────────────
  // Squad sync's job ends at raw data collection (players, squad snapshot,
  // position depth, transfer intelligence — all written above). ALL
  // intelligence-score computation (squad_depth_score, injury_burden_score,
  // injured/available_market_value, squad_stability_score) happens
  // exclusively in processTeamIntelligencePartial(), which reads these
  // tables as its source. This used to be duplicated in both places with
  // two different formulas computing the same field — removed per the
  // schema cleanup (migration 007) to keep one source of truth per score.

  logger.info({
    teamId: team.id, teamName: team.name,
    players: totalCount, injured: injCount,
    positions: positionMap.size, transfers: transfersIn?.length ?? 0,
  }, 'Squad sync V2 complete — raw data only, scoring handled by processTeamIntelligencePartial');

  return { synced: true, skipped: false };
}

// ─── PUBLIC EXPORTS ───────────────────────────────────────────────────────────

export async function syncSquadsForTrackedLeagues(
  daysAhead = 1,
  delayMs = THROTTLE_MS
): Promise<{ synced: number; skipped: number; failed: number; teams: number }> {
  logger.info({ daysAhead }, 'syncSquadsForTrackedLeagues started (V2 — SportsAPI Pro/SofaScore data, single-call ingestion)');
  logger.info('Initializing Supabase client...');

  const teams     = await getTrackedLeagueTeams(daysAhead);
  const upcoming  = await getTeamsWithUpcomingMatches(daysAhead);

  // Priority: upcoming matches first
  const prioritised = [
    ...teams.filter((t: any) => upcoming.has(t.id)),
    ...teams.filter((t: any) => !upcoming.has(t.id)),
  ];

  logger.info({
    trackedLeagueTeams: teams.length,
    upcomingPriority:   upcoming.size,
  }, 'Tracked-league squad sync queued');

  let synced = 0, skipped = 0, failed = 0;

  for (const team of prioritised) {
    const isPriority = upcoming.has(team.id);
    logger.debug({ teamExternalId: team.external_id, isPriority }, 'Checking squad sync eligibility');

    const result = await syncOneTeamSquad(team.external_id, isPriority);

    if (result.skipped) {
      skipped++;
    } else if (result.error) {
      failed++;
    } else if (result.synced) {
      synced++;
      // Throttle: 1 request per 2 seconds (mandatory per spec)
      await delay(delayMs);
    }
  }

  logger.info({ teams: teams.length, synced, skipped, failed, apiCallsUsed: synced }, 'Squad sync completed');
  return { synced, skipped, failed, teams: teams.length };
}

/** Sync squads filtered by country (still only tracked league teams) */
export async function syncSquadsByCountries(
  countries: string[],
  delayMs = THROTTLE_MS
): Promise<{ synced: number; skipped: number; failed: number; teams: number }> {
  logger.info({ countries }, 'Syncing squads by country (V2 — SportsAPI Pro/SofaScore data)...');
  logger.info('Initializing Supabase client...');

  const allTracked = await getTrackedLeagueTeams();
  const teams = allTracked.filter((t: any) =>
    countries.map(c => c.toLowerCase()).includes((t.country ?? '').toLowerCase())
  );

  if (teams.length === 0) {
    logger.warn({ countries }, 'No tracked-league teams found for these countries. Ensure sync:today has run.');
    return { synced: 0, skipped: 0, failed: 0, teams: 0 };
  }

  const upcoming = await getTeamsWithUpcomingMatches(3);
  const prioritised = [
    ...teams.filter((t: any) => upcoming.has(t.id)),
    ...teams.filter((t: any) => !upcoming.has(t.id)),
  ];

  logger.info({
    countries,
    trackedLeagueTotal: allTracked.length,
    countryFiltered: prioritised.length,
    upcomingCount: upcoming.size,
  }, 'Country-filtered teams queued (tracked leagues only)');

  let synced = 0, skipped = 0, failed = 0;

  for (const team of prioritised) {
    const isPriority = upcoming.has(team.id);
    const result = await syncOneTeamSquad(team.external_id, isPriority);

    if (result.skipped)  skipped++;
    else if (result.error) failed++;
    else if (result.synced) { synced++; await delay(delayMs); }
  }

  logger.info({ synced, skipped, failed, teams: teams.length }, 'Country squad sync completed');
  return { synced, skipped, failed, teams: teams.length };
}

/** Resolves a set of match external IDs (matches.external_match_id — the
 *  source API's id, not this DB's internal auto-increment id) to the
 *  external_id of every team playing in those matches, deduplicated.
 *  Extracted out of syncSquadsForMatches() below so the SAME resolution
 *  logic can be reused by other match-targeted sync commands (e.g.
 *  player-stats-by-matches in cli.ts) without duplicating the match ->
 *  team -> external_id lookup a second time. */
export async function resolveTeamsFromMatches(matchExternalIds: number[]): Promise<{
  teams: { id: number; external_id: number; name: string }[];
  matchesResolved: number;
  matchesNotFound: number[];
}> {
  const { data: matches, error: matchErr } = await db
    .from('matches')
    .select('external_match_id, home_team_id, away_team_id')
    .in('external_match_id', matchExternalIds);

  if (matchErr) {
    logger.error({ error: matchErr.message }, 'Failed to look up matches by external_match_id');
    return { teams: [], matchesResolved: 0, matchesNotFound: matchExternalIds };
  }

  const foundIds = new Set((matches ?? []).map((m: any) => m.external_match_id));
  const matchesNotFound = matchExternalIds.filter(id => !foundIds.has(id));
  if (matchesNotFound.length > 0) {
    logger.warn({ matchesNotFound }, 'Some match external IDs were not found in this DB — ensure sync:today/sync:schedule has run for them');
  }
  if (!matches || matches.length === 0) {
    return { teams: [], matchesResolved: 0, matchesNotFound };
  }

  const internalTeamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

  const { data: teams, error: teamErr } = await db
    .from('teams')
    .select('id, external_id, name')
    .in('id', internalTeamIds);

  if (teamErr || !teams) {
    logger.error({ error: teamErr?.message }, 'Failed to resolve teams for the matched fixtures');
    return { teams: [], matchesResolved: matches.length, matchesNotFound };
  }

  return { teams, matchesResolved: matches.length, matchesNotFound };
}

/** Sync squads for the teams playing in specific matches, identified by
 *  each match's EXTERNAL id (matches.external_match_id — the source
 *  API's ID, not this DB's internal auto-increment id). Built for the
 *  "I have specific upcoming fixtures, make sure THOSE teams' squads
 *  are fresh" use case — a targeted alternative to syncing by country
 *  or across all tracked leagues.
 *
 *  Requires at least 2 match external IDs (a single match only ever
 *  involves 2 teams anyway — a 1-match call would just be
 *  sync:squads:single-team called twice, which already exists).
 *
 *  Resolves match -> home_team_id/away_team_id (internal DB ids) ->
 *  teams.external_id (the id syncOneTeamSquad actually needs — a
 *  different id space from either the match's or the team's internal
 *  DB id) via resolveTeamsFromMatches() above, then calls the SAME
 *  syncOneTeamSquad() unit every other squad-sync path already uses —
 *  no new sync logic, just a new, more targeted way to select which
 *  teams get synced. Passes priority=true unconditionally (same as
 *  syncSingleTeamSquad) since a team explicitly named here because of
 *  a specific upcoming match should bypass the normal cooldown, not
 *  wait behind it. */
export async function syncSquadsForMatches(
  matchExternalIds: number[],
  delayMs = THROTTLE_MS
): Promise<{
  synced: number; skipped: number; failed: number; teams: number;
  matchesResolved: number; matchesNotFound: number[];
}> {
  if (matchExternalIds.length < 2) {
    logger.error({ matchExternalIds }, 'syncSquadsForMatches requires at least 2 match external IDs');
    return { synced: 0, skipped: 0, failed: 0, teams: 0, matchesResolved: 0, matchesNotFound: matchExternalIds };
  }

  logger.info({ matchExternalIds }, 'Resolving teams for the given match external IDs...');
  logger.info('Initializing Supabase client...');

  const { teams, matchesResolved, matchesNotFound } = await resolveTeamsFromMatches(matchExternalIds);

  if (teams.length === 0) {
    logger.error('None of the given match external IDs resolved to any team — nothing to sync');
    return { synced: 0, skipped: 0, failed: 0, teams: 0, matchesResolved, matchesNotFound };
  }

  logger.info({
    matchesRequested: matchExternalIds.length,
    matchesResolved,
    teamsToSync: teams.length,
    teamNames: teams.map((t: any) => t.name),
  }, 'Teams resolved from match external IDs — starting squad sync');

  let synced = 0, skipped = 0, failed = 0;
  for (const team of teams) {
    const result = await syncOneTeamSquad(team.external_id, true);
    if (result.skipped) skipped++;
    else if (result.error) failed++;
    else if (result.synced) { synced++; await delay(delayMs); }
  }

  logger.info({ synced, skipped, failed, teams: teams.length, matchesResolved, matchesNotFound }, 'Match-targeted squad sync completed');
  return { synced, skipped, failed, teams: teams.length, matchesResolved, matchesNotFound };
}

/** Force sync a single team — bypasses cooldown */
export async function syncSingleTeamSquad(
  teamExternalId: number
): Promise<{ synced: boolean; skipped: boolean; error?: string }> {
  logger.info({ teamExternalId }, 'Force syncing single team squad (V2)');
  logger.info('Initializing Supabase client...');
  return syncOneTeamSquad(teamExternalId, true);
}
