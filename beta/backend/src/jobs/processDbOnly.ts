import { db } from '../db/client';
import { logger } from '../utils/logger';
import { isTrackedBySlug, isTrackedLeague } from '../config/trackedLeagues';
import { computeMatchSignals, MatchSignalInput } from '../lib/signalLogic';
// BETA: pagination helper moved to db/fetchAllRows and now ALWAYS orders
// (appends .order('id') — deterministic paging; the old local version
// paginated unordered, which has no stability guarantee in Postgres).
import { fetchAllRows } from '../db/fetchAllRows';

/**
 * DB-ONLY PROCESSORS
 *
 * All functions in this file compute intelligence from existing DB data.
 * Zero API calls. Safe to run as often as needed.
 *
 * processTeamFixtureLoad  → team_fixture_load
 * processTeamLocations    → team_locations
 */

// ─── FIXTURE LOAD PROCESSOR ──────────────────────────────────────────────────

/**
 * Computes fixture congestion for every team with at least one match.
 *
 * Reads:  matches (date, home_team_id, away_team_id, status)
 * Writes: team_fixture_load (rolling windows + congestion_score)
 *
 * Congestion score formula — PER SPEC (Team Readiness Engine spec, section 3):
 *   Base score from match count in next-14-day window:
 *     1 match=100, 2=90, 3=75, 4=60, 5=40, 6+=20
 *   Minus competition-load penalty (active competitions, 90-day window):
 *     1 competition=0, 2=-5, 3=-10, 4=-15, 5+=-20
 *   Final = max(0, base - penalty)
 */

/** Derives a rough per-match minutes estimate for each player from their
 *  season totals, since no real per-match minutes data source exists yet
 *  (player_match_load has no upstream sync — this is a proxy, not a real
 *  per-match record). Distributes the player's season minutes_played
 *  across their most recent season's actual completed fixtures for
 *  their team: assumed-start appearances get a larger share (~80% of
 *  total minutes spread across starts), assumed-sub appearances get the
 *  remainder (~20% spread across subs). The specific REAL match each
 *  estimate lands on is arbitrary (the player's first N team fixtures
 *  chronologically, not necessarily the ones they actually featured in)
 *  — a reasonable proxy for aggregate load, not a claim that "this
 *  player played exactly X minutes in match Y".
 *
 *  Two real bugs fixed from an earlier version before this was wired
 *  in anywhere:
 *  1. player_season_statistics was queried with no season resolution —
 *     upserts on (player_id, season_external_id), so a player with
 *     multiple historical seasons on record would appear as multiple
 *     separate rows here, each independently assigned to the SAME real
 *     matches (filtered only by team, not season) - double/triple-
 *     counting minutes for anyone with more than one season of history.
 *     Fixed with the same "keep highest season_external_id per player"
 *     resolution used throughout this file (processPredictedLineups,
 *     processPlayerIntelligence, etc).
 *  2. The match query chained .in('home_team_id', teamIds) followed by
 *     .or(`away_team_id.in.(...)`)  - in Supabase/PostgREST, a
 *     standalone .in() and a later .or() are ANDed together, not ORed;
 *     this returned only matches satisfying BOTH conditions rather than
 *     "team plays home OR away", silently missing most away fixtures.
 *     Fixed by putting both conditions inside one .or() call, which is
 *     the only way PostgREST actually produces an OR across two
 *     different columns. */
export async function processPlayerMatchLoad(): Promise<{
  playersProcessed: number;
  rowsWritten: number;
}> {
  logger.info('processPlayerMatchLoad started — DB only');

  const rawStats = await fetchAllRows(
    db.from('player_season_statistics')
      .select('player_id, team_id, season_external_id, minutes_played, appearances, matches_started')
  );

  if (rawStats.length === 0) {
    logger.info('No player season stats found — skipping player_match_load');
    return { playersProcessed: 0, rowsWritten: 0 };
  }

  // Most recent season only per player (see docstring above).
  const statsMap = new Map<number, any>();
  for (const s of rawStats) {
    const existing = statsMap.get(s.player_id);
    if (existing && existing.season_external_id >= (s.season_external_id ?? 0)) continue;
    statsMap.set(s.player_id, s);
  }
  const players = [...statsMap.values()];

  // Get all matches for these teams — home OR away, correctly ORed
  // (see docstring above for the bug this replaces).
  const teamIds = [...new Set(players.map((p: any) => p.team_id))];
  const matches = await fetchAllRows(
    db.from('matches')
      .select('id, home_team_id, away_team_id, date')
      .or(`home_team_id.in.(${teamIds.join(',')}),away_team_id.in.(${teamIds.join(',')})`)
      .lte('date', new Date().toISOString())
      .order('date', { ascending: true })
  );

  if (matches.length === 0) {
    logger.info('No matches found — skipping player_match_load');
    return { playersProcessed: 0, rowsWritten: 0 };
  }

  const rows: any[] = [];
  let playersProcessed = 0;

  for (const player of players) {
    const playerMatches = matches.filter(
      (m: any) => m.home_team_id === player.team_id || m.away_team_id === player.team_id
    );

    if (playerMatches.length === 0 || !player.minutes_played) continue;

    // Distribute minutes proportionally: assume started matches = full 90,
    // sub appearances = remaining minutes distributed evenly
    const starts = player.matches_started || 0;
    const subs = (player.appearances || 0) - starts;
    const totalMinutes = player.minutes_played;
    
    // Estimate: starters get ~80 min, subs get ~20 min
    const estimatedStartMinutes = Math.min(90, starts > 0 ? (totalMinutes * 0.8) / Math.max(starts, 1) : 0);
    const estimatedSubMinutes = subs > 0 ? (totalMinutes * 0.2) / Math.max(subs, 1) : 0;

    for (let i = 0; i < Math.min(starts + subs, playerMatches.length); i++) {
      const isStart = i < starts;
      rows.push({
        player_id: player.player_id,
        match_id: playerMatches[i].id,
        match_date: playerMatches[i].date.split('T')[0],
        minutes_played: Math.round(isStart ? estimatedStartMinutes : estimatedSubMinutes),
        started: isStart,
        substitute: !isStart,
      });
    }
    playersProcessed++;
  }

  if (rows.length > 0) {
    // BETA: single-transaction replace via RPC (migration 024). The old
    // delete()+insert() pair was two PostgREST transactions — a failed
    // insert left the table EMPTY until the next run, and every run had
    // a visible empty-table window for readers.
    const { error } = await db.rpc('replace_player_match_load', { p_rows: rows });
    if (error) throw new Error(error.message);
  }

  logger.info({ playersProcessed, rowsWritten: rows.length }, 'processPlayerMatchLoad completed');
  return { playersProcessed, rowsWritten: rows.length };
}

// processInjuryRisk() REMOVED — it tried to .upsert() rows into
// `injury_risk`, which is a plain SQL VIEW (confirmed: joins players +
// player_intelligence, computes risk level live from fatigue_score on
// every query) — Postgres does not allow writing to an ordinary view
// without INSTEAD OF triggers, which nothing here set up. This would
// fail at runtime the moment it actually ran. Separately, its
// fatigue/load thresholds (>=0.7, >=0.8) assumed a 0-1 scale, but
// fatigue_score/load_index are computed elsewhere in this file as 0-100
// values — even a working writer would have misclassified nearly every
// player as "high" risk.
//
// The view was ALREADY correct and needs no separate writer at all —
// it recalculates live from player_intelligence.fatigue_score on every
// query. The actual root cause (also correctly diagnosed before this
// function was written) is that fatigue_score only ever reflected
// injury severity, never real playing load, so it stayed flat and the
// view's risk classification never differentiated players. Fixed at
// the real source instead: processPlayerIntelligence() below now
// blends injury severity with real match-load data from
// player_match_load (matches/minutes in the last 7 days) and team
// congestion into fatigue_score — the view starts producing meaningful,
// differentiated results automatically once that's populated, with no
// separate injury_risk writer needed.

export async function processTeamFixtureLoad(): Promise<{
  teamsProcessed: number;
  snapshotsWritten: number;
  error?: string;
}> {
  logger.info('processTeamFixtureLoad started — DB only, no API calls');

  try {
    const today   = new Date();
    const snapshot = today.toISOString().split('T')[0];

    // Past windows
    const ago7  = new Date(today.getTime() -  7 * 86400000).toISOString();
    const ago14 = new Date(today.getTime() - 14 * 86400000).toISOString();
    const ago30 = new Date(today.getTime() - 30 * 86400000).toISOString();

    // Forward windows — reads from already-synced scheduled matches.
    // No extra API calls needed: sync:today + sync:week already populate these.
    const next7  = new Date(today.getTime() +  7 * 86400000).toISOString();
    const next14 = new Date(today.getTime() + 14 * 86400000).toISOString();

    // Fetch past + future matches in one query (-30d to +14d)
    // BETA FIX (audit P0): was a raw read, silently capped at 1000 rows by
    // PostgREST. ~44 days × 57 leagues exceeds that; ascending date order
    // meant FUTURE matches were cut first — congestion forward windows
    // undercounted on busy weeks.
    const allMatches = await fetchAllRows(
      db.from('matches')
        .select('id, home_team_id, away_team_id, date, status')
        .gte('date', ago30)
        .lte('date', next14)
        .order('date', { ascending: true })
    );

    if (!allMatches || allMatches.length === 0) {
      logger.warn('No matches found — skipping fixture load computation');
      return { teamsProcessed: 0, snapshotsWritten: 0 };
    }

    // Separate past (for rest days + congestion) and future (for upcoming load)
    const now = today.toISOString();
    const pastMatches     = allMatches.filter((m: any) => m.date <= now);
    const futureMatches   = allMatches.filter((m: any) => m.date >  now);

    // Build per-team date lists (past only for rest/congestion)
    const teamPastDates   = new Map<number, Date[]>();
    const teamFutureDates = new Map<number, Date[]>();

    for (const m of pastMatches) {
      for (const teamId of [m.home_team_id, m.away_team_id]) {
        if (!teamId) continue;
        if (!teamPastDates.has(teamId)) teamPastDates.set(teamId, []);
        teamPastDates.get(teamId)!.push(new Date(m.date));
      }
    }
    for (const m of futureMatches) {
      for (const teamId of [m.home_team_id, m.away_team_id]) {
        if (!teamId) continue;
        if (!teamFutureDates.has(teamId)) teamFutureDates.set(teamId, []);
        teamFutureDates.get(teamId)!.push(new Date(m.date));
      }
    }

    // Union of all team IDs
    const allTeamIds = new Set([...teamPastDates.keys(), ...teamFutureDates.keys()]);
    const rows: any[] = [];

    for (const teamId of allTeamIds) {
      const past   = (teamPastDates.get(teamId)   || []).sort((a, b) => a.getTime() - b.getTime());
      const future = (teamFutureDates.get(teamId) || []).sort((a, b) => a.getTime() - b.getTime());

      // Past windows
      const matches7  = past.filter(d => d >= new Date(ago7)).length;
      const matches14 = past.filter(d => d >= new Date(ago14)).length;
      const matches30 = past.length;

      // Forward-looking windows (from scheduled matches already in DB)
      const nextMatches7  = future.filter(d => d <= new Date(next7)).length;
      const nextMatches14 = future.length;

      // Rest days between consecutive past matches
      const restGaps: number[] = [];
      for (let i = 1; i < past.length; i++) {
        restGaps.push((past[i].getTime() - past[i - 1].getTime()) / 86400000);
      }

      const avgRest = restGaps.length
        ? Math.round((restGaps.reduce((a, b) => a + b, 0) / restGaps.length) * 100) / 100
        : null;
      const minRest = restGaps.length ? Math.round(Math.min(...restGaps)) : null;

      // ── Congestion score — POLARITY: higher = MORE congested ────────────
      // Spec: match count in 14-day window → fixed lookup table, plus a
      // competition-load penalty based on active_competitions.
      // We use matches_next_14_days as the window — this is the
      // forward-looking fixture load that actually predicts fatigue going
      // into a team's NEXT match, which is what congestion is meant to warn about.
      //
      // POLARITY FIX (was inverted at this source): the original lookup
      // gave ≤1 match → 100, i.e. higher = FEWER matches = LESS congested.
      // But every single consumer already treats high-as-congested:
      //   - readiness formula: `100 - congestionScore` ("low congestion = good")
      //   - match_intelligence: congestionGood = 100 - raw
      //   - player_intelligence: load = fatigue*0.6 + teamCongestion*0.4
      //   - signal logic: congestion > 65 → "Under goals" / awayCong > 70
      //   - frontend labels: "High (71-100)", "MOST CONGESTED" = highest score
      // Under the old polarity, sparse forward-fixture data (most teams have
      // ≤1 scheduled match synced) meant nearly every team scored 100 →
      // readiness contribution 100-100=0 at 15% weight → the platform-wide
      // near-zero readiness clustering observed in the live UI. Flipping
      // the source makes all consumers correct simultaneously, and sparse
      // data now errs OPTIMISTIC (score 0 → "not congested") instead of
      // silently crushing readiness.
      const matchCountForCongestion = nextMatches14;

      let baseCongestionScore: number;
      if      (matchCountForCongestion <= 1) baseCongestionScore = 0;
      else if (matchCountForCongestion === 2) baseCongestionScore = 10;
      else if (matchCountForCongestion === 3) baseCongestionScore = 25;
      else if (matchCountForCongestion === 4) baseCongestionScore = 40;
      else if (matchCountForCongestion === 5) baseCongestionScore = 60;
      else                                     baseCongestionScore = 80; // 6+

      // Competition penalty — filled in by caller using teamCompetitionCounts
      // (passed in via closure below); placeholder here, real value applied
      // after the competitions map is built (see post-loop pass). Under the
      // corrected polarity the penalty now ADDS congestion (more active
      // competitions = busier schedule), rather than subtracting.
      const congestionScore = baseCongestionScore; // competition penalty applied below

      rows.push({
        team_id:               teamId,
        snapshot_date:         snapshot,
        matches_last_7_days:   matches7,
        matches_last_14_days:  matches14,
        matches_last_30_days:  matches30,
        matches_next_7_days:   nextMatches7,
        matches_next_14_days:  nextMatches14,
        avg_rest_days:         avgRest,
        min_rest_days:         minRest,
        congestion_score:      congestionScore,
        calculated_at:         new Date().toISOString(),
      });
    }

    // ── Apply competition-load penalty (spec section 3) ─────────────────────
    // 1 competition = -0, 2 = -5, 3 = -10, 4 = -15, 5+ = -20
    // Computed from matches in the last 90 days (same logic as team_intelligence).
    const ago90 = new Date(today.getTime() - 90 * 86400000).toISOString();
    const compMatches90 = await fetchAllRows(
      db
        .from('matches')
        .select('home_team_id, away_team_id, competition')
        .gte('date', ago90)
        .not('competition', 'is', null)
        .not('status', 'in', '("cancelled","postponed")')
    );

    const teamCompCount = new Map<number, Set<string>>();
    for (const m of compMatches90 || []) {
      if (!m.competition) continue;
      for (const tid of [m.home_team_id, m.away_team_id]) {
        if (!tid) continue;
        if (!teamCompCount.has(tid)) teamCompCount.set(tid, new Set());
        teamCompCount.get(tid)!.add(m.competition);
      }
    }

    function competitionPenalty(count: number): number {
      if (count <= 1) return 0;
      if (count === 2) return 5;
      if (count === 3) return 10;
      if (count === 4) return 15;
      return 20; // 5+
    }

    for (const row of rows) {
      const compCount = teamCompCount.get(row.team_id)?.size ?? 1;
      const penalty   = competitionPenalty(compCount);
      // ADDS congestion under the corrected polarity (higher = more
      // congested): more active competitions = busier schedule. Was
      // `- penalty` under the old inverted scale.
      row.congestion_score = Math.max(0, Math.min(100, row.congestion_score + penalty));
    }


    // Batch upsert in chunks of 500
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('team_fixture_load')
        .upsert(chunk, { onConflict: 'team_id,snapshot_date' });
      written += chunk.length;
    }

    logger.info(
      { teamsProcessed: allTeamIds.size, snapshotsWritten: written },
      'processTeamFixtureLoad completed'
    );
    return { teamsProcessed: allTeamIds.size, snapshotsWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamFixtureLoad failed');
    return { teamsProcessed: 0, snapshotsWritten: 0, error: error.message };
  }
}

// ─── TEAM LOCATIONS PROCESSOR ────────────────────────────────────────────────

/**
 * Derives each team's home location from their most frequent home match venue.
 *
 * Reads:  matches (home_team_id, venue_id)
 *         stadiums (id, city, country, latitude, longitude)
 * Writes: team_locations
 *
 * Logic: for each team, find the venue_id that appears most in their
 *        home matches — that's their likely home stadium.
 */
export async function processTeamLocations(): Promise<{
  teamsProcessed: number;
  locationsWritten: number;
  teamsWithNoVenue: number;
  error?: string;
}> {
  logger.info('processTeamLocations started — DB only, no API calls');

  try {
    // Get all home matches that have a venue
    const homeMatches = await fetchAllRows(
      db
        .from('matches')
        .select('home_team_id, venue_id')
        .not('venue_id', 'is', null)
    );

    if (!homeMatches || homeMatches.length === 0) {
      logger.warn('No matches with venue_id found — run sync:today first');
      return { teamsProcessed: 0, locationsWritten: 0, teamsWithNoVenue: 0 };
    }

    // Count venue frequency per home team
    const teamVenueCounts = new Map<number, Map<number, number>>();
    for (const m of homeMatches) {
      if (!m.home_team_id || !m.venue_id) continue;
      if (!teamVenueCounts.has(m.home_team_id)) {
        teamVenueCounts.set(m.home_team_id, new Map());
      }
      const vMap = teamVenueCounts.get(m.home_team_id)!;
      vMap.set(m.venue_id, (vMap.get(m.venue_id) ?? 0) + 1);
    }

    // For each team, pick the most frequent venue
    const teamHomeVenue = new Map<number, number>(); // teamId → stadiumId
    for (const [teamId, vMap] of teamVenueCounts) {
      let bestVenue = 0;
      let bestCount = 0;
      for (const [venueId, count] of vMap) {
        if (count > bestCount) { bestCount = count; bestVenue = venueId; }
      }
      if (bestVenue) teamHomeVenue.set(teamId, bestVenue);
    }

    // Fetch all relevant stadiums in one query
    const stadiumIds = Array.from(new Set(teamHomeVenue.values()));
    const stadiums = await fetchAllRows(
      db
        .from('stadiums')
        .select('id, city, country, latitude, longitude')
        .in('id', stadiumIds)
    );

    const stadiumMap = new Map<number, any>(
      (stadiums || []).map((s: any) => [s.id, s])
    );

    // Fetch teams for name/country context
    const teamIds = Array.from(teamHomeVenue.keys());
    const teams = await fetchAllRows(
      db
        .from('teams')
        .select('id, country')
        .in('id', teamIds)
    );

    const teamMap = new Map<number, any>(
      (teams || []).map((t: any) => [t.id, t])
    );

    // Build location rows
    const rows: any[] = [];
    let teamsWithNoVenue = 0;

    for (const [teamId, stadiumId] of teamHomeVenue) {
      const stadium = stadiumMap.get(stadiumId);
      const team    = teamMap.get(teamId);
      if (!stadium) { teamsWithNoVenue++; continue; }

      rows.push({
        team_id:    teamId,
        stadium_id: stadiumId,
        city:       stadium.city       ?? null,
        country:    stadium.country    ?? team?.country ?? null,
        latitude:   stadium.latitude   ?? null,
        longitude:  stadium.longitude  ?? null,
        updated_at: new Date().toISOString(),
      });
    }

    // Batch upsert
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('team_locations')
        .upsert(chunk, { onConflict: 'team_id' });
      written += chunk.length;
    }

    logger.info(
      { teamsProcessed: teamHomeVenue.size, locationsWritten: written, teamsWithNoVenue },
      'processTeamLocations completed'
    );
    return {
      teamsProcessed: teamHomeVenue.size,
      locationsWritten: written,
      teamsWithNoVenue,
    };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamLocations failed');
    return { teamsProcessed: 0, locationsWritten: 0, teamsWithNoVenue: 0, error: error.message };
  }
}

// ─── HAVERSINE DISTANCE ───────────────────────────────────────────────────────

/**
 * Calculates the great-circle distance between two lat/lng points in km.
 * Uses the Haversine formula — accurate to within ~0.5% for football travel distances.
 */
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R    = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── TEAM TRAVEL LOAD PROCESSOR ──────────────────────────────────────────────

/**
 * Computes travel load for every team that has both a home location and
 * away match venue data. Purely DB-derived — zero API calls.
 *
 * Reads:  team_locations (home lat/lng)
 *         matches (away_team_id, venue_id, date)
 *         stadiums (lat/lng per venue)
 * Writes: team_travel_load (km windows, away match counts, fatigue score)
 *
 * Travel fatigue score formula — PER SPEC (section 4), polarity inverted
 * for consistency with congestion_score (higher = worse, matches frontend):
 *   1. Average away-trip distance over last 14 days → spec distance band:
 *      0-100km=100(good)...2000km+=25(good) — i.e. spec's "Travel Score"
 *   2. fatigue = 100 - specScore  (so higher fatigue = longer travel)
 *   3. fatigue += active_competitions × 3   (spec subtracts from good score;
 *      equivalent to adding to our inverted bad-high fatigue score)
 *
 * Prerequisite: run process:team-locations first.
 */
export async function processTeamTravelLoad(): Promise<{
  teamsProcessed: number;
  rowsWritten: number;
  teamsSkippedNoLocation: number;
  error?: string;
}> {
  logger.info('processTeamTravelLoad started — DB only, zero API calls');

  try {
    const today    = new Date();
    const snapshot = today.toISOString().split('T')[0];
    const ago30    = new Date(today.getTime() - 30 * 86400000).toISOString();
    const ago14    = new Date(today.getTime() - 14 * 86400000).toISOString();
    const ago7     = new Date(today.getTime() - 7  * 86400000).toISOString();

    // 1. Load all team home locations
    const locations = await fetchAllRows(
      db
        .from('team_locations')
        .select('team_id, latitude, longitude')
        .not('latitude',  'is', null)
        .not('longitude', 'is', null)
    );

    if (!locations || locations.length === 0) {
      logger.warn('No team_locations with coordinates — run process:team-locations first');
      return { teamsProcessed: 0, rowsWritten: 0, teamsSkippedNoLocation: 0 };
    }

    const homeLocMap = new Map<number, { lat: number; lng: number }>(
      locations.map((l: any) => [l.team_id, { lat: l.latitude, lng: l.longitude }])
    );

    // 2. Load away matches with venue coordinates (last 30 days)
    const awayMatches = await fetchAllRows(
      db
        .from('matches')
        .select('away_team_id, venue_id, date')
        .gte('date', ago30)
        .not('venue_id', 'is', null)
        .in('status', ['finished', 'live'])
    );

    // 3. Load stadium coordinates
    const venueIds = [...new Set((awayMatches || []).map((m: any) => m.venue_id).filter(Boolean))];
    const stadiumCoordMap = new Map<number, { lat: number; lng: number }>();

    if (venueIds.length > 0) {
      const stadiums = await fetchAllRows(
        db
          .from('stadiums')
          .select('id, latitude, longitude')
          .in('id', venueIds)
          .not('latitude',  'is', null)
          .not('longitude', 'is', null)
      );

      for (const s of stadiums || []) {
        stadiumCoordMap.set(s.id, { lat: s.latitude, lng: s.longitude });
      }
    }

    // 4. Group away matches by team and compute distances
    interface TripRecord { date: Date; km: number }
    const teamTrips = new Map<number, TripRecord[]>();

    for (const m of awayMatches || []) {
      const teamId  = m.away_team_id;
      const venueId = m.venue_id;
      if (!teamId || !venueId) continue;

      const home  = homeLocMap.get(teamId);
      const venue = stadiumCoordMap.get(venueId);
      if (!home || !venue) continue;

      // Skip if team is playing at their own stadium (rare edge case)
      const km = haversineKm(home.lat, home.lng, venue.lat, venue.lng);
      if (km < 5) continue; // <5 km = effectively a home game, skip

      if (!teamTrips.has(teamId)) teamTrips.set(teamId, []);
      teamTrips.get(teamId)!.push({ date: new Date(m.date), km });
    }

    // 5. Compute rolling window stats per team
    const rows: any[] = [];
    const cutoff7  = new Date(ago7);
    const cutoff14 = new Date(ago14);
    const cutoff30 = new Date(ago30);

    for (const [teamId, trips] of teamTrips) {
      const trips7  = trips.filter(t => t.date >= cutoff7);
      const trips14 = trips.filter(t => t.date >= cutoff14);
      const trips30 = trips; // already filtered to last 30 days

      const km7  = Math.round(trips7 .reduce((s, t) => s + t.km, 0));
      const km14 = Math.round(trips14.reduce((s, t) => s + t.km, 0));
      const km30 = Math.round(trips30.reduce((s, t) => s + t.km, 0));

      const allKms = trips30.map(t => t.km);
      const avgKm  = allKms.length
        ? Math.round(allKms.reduce((s, k) => s + k, 0) / allKms.length)
        : 0;

      // ── Travel score per spec formula (section 4) ────────────────────────
      // Spec's "Travel Score" is GOOD-HIGH (100 = short trip, 25 = very long
      // trip) using the average trip distance over the last 14 days.
      //
      // Our team_travel_load.travel_fatigue_score column is BAD-HIGH for
      // consistency with team_fixture_load.congestion_score elsewhere in the
      // codebase (frontend already renders both as "higher = worse, amber/red").
      // So we compute spec's Travel Score, then invert: fatigue = 100 - score.
      // The active-competition modifier in the spec subtracts from the GOOD
      // score, which is equivalent to ADDING to our BAD-HIGH fatigue score.
      const avgKm14 = trips14.length
        ? Math.round(trips14.reduce((s, t) => s + t.km, 0) / trips14.length)
        : 0;

      let specTravelScore: number;
      if      (avgKm14 <= 100)  specTravelScore = 100;
      else if (avgKm14 <= 300)  specTravelScore = 90;
      else if (avgKm14 <= 600)  specTravelScore = 80;
      else if (avgKm14 <= 1000) specTravelScore = 65;
      else if (avgKm14 <= 2000) specTravelScore = 45;
      else                      specTravelScore = 25;

      // Competition modifier applied after band lookup (per spec section 4).
      // active_competitions for this team — filled in below via post-loop pass
      // (matches the same 90-day lookback used in congestion + team_intelligence).
      const travelFatigueScore = 100 - specTravelScore; // competition modifier applied in post-loop pass

      rows.push({
        team_id:                    teamId,
        snapshot_date:              snapshot,
        km_last_7_days:             km7,
        km_last_14_days:            km14,
        km_last_30_days:            km30,
        away_matches_last_7_days:   trips7.length,
        away_matches_last_14_days:  trips14.length,
        away_matches_last_30_days:  trips30.length,
        avg_trip_distance_km:       avgKm,
        travel_fatigue_score:       travelFatigueScore,
        calculated_at:              new Date().toISOString(),
      });
    }

    // ── Apply active-competition modifier (spec section 4) ──────────────────
    // Spec: GoodScore - (active_competitions × 3). Since our column is
    // inverted (bad-high), this becomes: fatigue + (active_competitions × 3).
    const ago90b = new Date(today.getTime() - 90 * 86400000).toISOString();
    const compMatches90b = await fetchAllRows(
      db
        .from('matches')
        .select('home_team_id, away_team_id, competition')
        .gte('date', ago90b)
        .not('competition', 'is', null)
        .not('status', 'in', '("cancelled","postponed")')
    );

    const teamCompCountTravel = new Map<number, Set<string>>();
    for (const m of compMatches90b || []) {
      if (!m.competition) continue;
      for (const tid of [m.home_team_id, m.away_team_id]) {
        if (!tid) continue;
        if (!teamCompCountTravel.has(tid)) teamCompCountTravel.set(tid, new Set());
        teamCompCountTravel.get(tid)!.add(m.competition);
      }
    }

    for (const row of rows) {
      const activeComps = teamCompCountTravel.get(row.team_id)?.size ?? 1;
      row.travel_fatigue_score = Math.max(0, Math.min(100, row.travel_fatigue_score + activeComps * 3));
    }


    const teamsSkippedNoLocation =
      [...teamTrips.keys()].filter(id => !homeLocMap.has(id)).length;

    // 6. Batch upsert
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('team_travel_load')
        .upsert(chunk, { onConflict: 'team_id,snapshot_date' });
      written += chunk.length;
    }

    logger.info(
      { teamsProcessed: teamTrips.size, rowsWritten: written, teamsSkippedNoLocation },
      'processTeamTravelLoad completed'
    );
    return { teamsProcessed: teamTrips.size, rowsWritten: written, teamsSkippedNoLocation };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamTravelLoad failed');
    return { teamsProcessed: 0, rowsWritten: 0, teamsSkippedNoLocation: 0, error: error.message };
  }
}

// ─── MATCH TRAVEL INTELLIGENCE ───────────────────────────────────────────────

/**
 * Computes per-match travel burden for both teams.
 * 100% DB-only — uses team_locations + stadiums + matches.
 *
 * Reads:  matches (home_team_id, away_team_id, venue_id)
 *         team_locations (home lat/lng per team)
 *         stadiums (lat/lng per venue)
 * Writes: match_travel_intelligence
 *
 * travel_advantage_km > 0 = away team traveled more (home team advantage)
 * travel_advantage_km < 0 = home team traveled more (neutral/away venue)
 */
export async function processMatchTravelIntelligence(opts?: {
  dateFrom?: string;
  dateTo?: string;
  dateFilter?: 'today' | 'tomorrow' | string;
  matchIds?: number[];
}): Promise<{
  matchesProcessed: number;
  rowsWritten: number;
  skippedNoVenue: number;
  error?: string;
}> {
  logger.info({ mode: opts?.dateFrom ? `range: ${opts.dateFrom}→${opts.dateTo}` : opts?.dateFilter ?? 'ALL' }, 'processMatchTravelIntelligence started — DB only');

  try {
    // Build date-scoped or full query using the same UTC boundary helpers
    // as processMatchIntelligencePartial
    const parseUTCDate = (s: string) => {
      const [y, mo, d] = s.split('-').map(Number);
      return new Date(Date.UTC(y, mo - 1, d));
    };

    let matchQuery = db
      .from('matches')
      .select('id, home_team_id, away_team_id, venue_id, date')
      .not('venue_id', 'is', null);

    if (opts?.matchIds && opts.matchIds.length > 0) {
      matchQuery = matchQuery.in('id', opts.matchIds);
    } else if (opts?.dateFrom) {
      const from  = parseUTCDate(opts.dateFrom);
      const now   = new Date();
      const toD   = opts.dateTo ? parseUTCDate(opts.dateTo) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0));
      const end   = new Date(Date.UTC(toD.getUTCFullYear(), toD.getUTCMonth(), toD.getUTCDate(), 23, 59, 59, 999));
      matchQuery  = matchQuery.gte('date', start.toISOString()).lte('date', end.toISOString());
    } else if (opts?.dateFilter) {
      const d = new Date();
      if (opts.dateFilter === 'tomorrow') d.setUTCDate(d.getUTCDate() + 1);
      else if (opts.dateFilter !== 'today' && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateFilter)) {
        const [y, mo, day] = opts.dateFilter.split('-').map(Number);
        d.setUTCFullYear(y, mo - 1, day);
      }
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
      const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
      matchQuery  = matchQuery.gte('date', start.toISOString()).lte('date', end.toISOString());
    }

    // Load all matches with a venue

    const { data: matches, error: mErr } = await matchQuery;

    if (!matches || matches.length === 0) {
      logger.warn('No matches with venue_id in scope — run sync:today first or widen date range');
      return { matchesProcessed: 0, rowsWritten: 0, skippedNoVenue: 0 };
    }

    // Load all relevant team locations
    const teamIds = [...new Set([
      ...matches.map((m: any) => m.home_team_id),
      ...matches.map((m: any) => m.away_team_id),
    ].filter(Boolean))];

    const locs = await fetchAllRows(
      db
        .from('team_locations')
        .select('team_id, latitude, longitude')
        .in('team_id', teamIds)
        .not('latitude', 'is', null)
    );

    const locMap = new Map<number, { lat: number; lng: number }>(
      (locs || []).map((l: any) => [l.team_id, { lat: l.latitude, lng: l.longitude }])
    );

    // Load all relevant stadium coordinates
    const venueIds = [...new Set(matches.map((m: any) => m.venue_id).filter(Boolean))];
    const stadiums = await fetchAllRows(
      db
        .from('stadiums')
        .select('id, latitude, longitude')
        .in('id', venueIds)
        .not('latitude', 'is', null)
    );

    const stadiumMap = new Map<number, { lat: number; lng: number }>(
      (stadiums || []).map((s: any) => [s.id, { lat: s.latitude, lng: s.longitude }])
    );

    const rows: any[] = [];
    let skippedNoVenue = 0;

    for (const m of matches) {
      const venue    = stadiumMap.get(m.venue_id);
      const homeLoc  = locMap.get(m.home_team_id);
      const awayLoc  = locMap.get(m.away_team_id);

      if (!venue) { skippedNoVenue++; continue; }

      const homeKm = homeLoc
        ? Math.round(haversineKm(homeLoc.lat, homeLoc.lng, venue.lat, venue.lng))
        : null;
      const awayKm = awayLoc
        ? Math.round(haversineKm(awayLoc.lat, awayLoc.lng, venue.lat, venue.lng))
        : null;

      // travel_advantage_km: positive = away team traveled more
      const advantageKm = (homeKm !== null && awayKm !== null)
        ? Math.round(awayKm - homeKm)
        : null;

      // The team with less travel has the advantage
      let advantageTeamId: number | null = null;
      if (advantageKm !== null) {
        if (advantageKm > 0) advantageTeamId = m.home_team_id;  // home traveled less
        else if (advantageKm < 0) advantageTeamId = m.away_team_id; // away traveled less
        // advantageKm === 0 = equal travel, null team
      }

      rows.push({
        match_id:                m.id,
        match_date:              m.date,  // denormalized — see migration 007
        home_team_distance_km:   homeKm,
        away_team_distance_km:   awayKm,
        travel_advantage_km:     advantageKm,
        travel_advantage_team_id: advantageTeamId,
        calculated_at:           new Date().toISOString(),
      });
    }

    // Batch upsert
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('match_travel_intelligence')
        .upsert(chunk, { onConflict: 'match_id' });
      written += chunk.length;
    }

    logger.info(
      { matchesProcessed: matches.length, rowsWritten: written, skippedNoVenue },
      'processMatchTravelIntelligence completed'
    );
    return { matchesProcessed: matches.length, rowsWritten: written, skippedNoVenue };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processMatchTravelIntelligence failed');
    return { matchesProcessed: 0, rowsWritten: 0, skippedNoVenue: 0, error: error.message };
  }
}

// ─── TEAM INTELLIGENCE (PARTIAL) ─────────────────────────────────────────────

/**
 * Populates team_intelligence with every field computable from existing DB data.
 *
 * Computable NOW (no players needed):
 *   form_index           → team_form_history, PER SPEC: (Last5×0.7)+(Last10×0.3)
 *   last_5_points         → team_form_history
 *   last_10_points        → team_form_history
 *   congestion_score      → team_fixture_load (latest snapshot, spec lookup table)
 *   rest_days_avg         → team_fixture_load
 *   travel_fatigue_score  → team_travel_load (latest snapshot, spec distance bands)
 *   travel_load_km        → team_travel_load.km_last_30_days
 *
 * Computable once squad sync has run (sync:squads:v2):
 *   squad_stability_score → PER SPEC: Retention(50%) + TransferContinuity(25%) + Availability(25%)
 *
 * Left NULL — requires player-minutes tracking (future premium feature):
 *   fatigue_index, rotation_pressure_index
 *
 * IMPORTANT — readiness_score semantics:
 * The Team Readiness Engine spec defines the FULL 7-component formula
 * (Form 30% + OpponentStrength 20% + Congestion 15% + Travel 15% +
 * HomeAdvantage 10% + Stability 5% + Motivation 5%) as a MATCH-CONTEXT
 * calculation — OpponentStrength, HomeAdvantage, and Motivation only make
 * sense relative to a specific upcoming opponent/fixture, not in isolation.
 *
 * This function computes team_intelligence.readiness_score as a NEUTRAL
 * BASELINE using only the team-intrinsic components (Form, Congestion,
 * Travel, Stability — renormalized to their relative spec weights), with
 * Opponent Strength/Home Advantage/Motivation assumed at their neutral
 * midpoint (50). This baseline is what's shown on team profile pages when
 * no specific opponent is selected.
 *
 * The spec-AUTHORITATIVE per-match readiness score — using REAL opponent
 * strength, REAL home/away advantage, and REAL motivation for that specific
 * fixture — is computed by processMatchIntelligencePartial() and stored in
 * match_intelligence.home_readiness / away_readiness. That is the number
 * that should be used for match predictions and betting signals.
 */
// ─── LINEUP VERSATILITY — shared helper ──────────────────────────────────────
// Computes a 0-100 versatility score per team from the PREDICTED XI, not the
// full squad. Bench versatility matters less than starter versatility — a
// manager's in-game flexibility depends on who's expected to play.
//
// Uses players.position_detailed (a comma-separated string like "DR,DC" or
// "MC,DM,AM", populated from SofaScore's positionsDetailed array) joined
// through match_predicted_lineups. Falls back gracefully to null if no
// predicted lineup exists for a team (no penalty for missing data).
//
// Score formula:
//   versatile_pct    = (XI players with 2+ position codes) / XI_count × 100
//   cross_group_pct  = (XI players covering 2+ broad zones D/M/F)  / XI_count × 100
//   versatility_score = versatile_pct × 0.6 + cross_group_pct × 0.4
//
// Rationale for the split: being listed in two positions within the same
// zone (e.g. DR,DC — both defenders) is a lesser signal than spanning zones
// (e.g. DM,MC — bridges defense and midfield). The 0.6/0.4 weighting
// reflects that multi-position listing is a precondition, but cross-zone
// coverage is the stronger tactical-resilience signal.

function codeToZoneGroup(code: string): string | null {
  const c = code.toUpperCase().trim();
  if (['G', 'GK', 'D', 'DC', 'DR', 'DL', 'DM'].includes(c)) return 'D';
  if (['M', 'MC', 'ML', 'MR', 'AM', 'RW', 'LW'].includes(c)) return 'M';
  if (['F', 'ST', 'CF'].includes(c)) return 'F';
  return null;
}

async function computeLineupVersatilityByTeam(): Promise<Map<number, number | null>> {
  const result = new Map<number, number | null>();

  const lineupRows = await fetchAllRows(
    db.from('match_predicted_lineups')
      .select('team_id, player_id, players:player_id(position_detailed)')
  );

  if (!lineupRows || lineupRows.length === 0) return result;

  // Keep only the most recent occurrence per (team_id, player_id): the table
  // accumulates across matches, so the same player appears in multiple rows.
  // First-seen wins here since fetchAllRows returns whatever the DB orders
  // by default (insertion order ≈ recency for append-only tables).
  const latestByTeamPlayer = new Map<string, any>();
  for (const row of lineupRows) {
    const key = `${row.team_id}:${row.player_id}`;
    if (!latestByTeamPlayer.has(key)) latestByTeamPlayer.set(key, row);
  }

  // Group into team → list of position_detailed strings for their predicted XI
  const byTeam = new Map<number, (string | null)[]>();
  for (const row of latestByTeamPlayer.values()) {
    const posDetailed = (row.players as any)?.position_detailed ?? null;
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
    byTeam.get(row.team_id)!.push(posDetailed);
  }

  for (const [teamId, posDetailedList] of byTeam) {
    const xiCount = posDetailedList.length;
    if (xiCount === 0) { result.set(teamId, null); continue; }

    let versatileCount  = 0; // players with 2+ position codes in position_detailed
    let crossGroupCount = 0; // players spanning 2+ broad zones (D/M/F)
    let hasAnyData      = false;

    for (const posDetailed of posDetailedList) {
      if (!posDetailed) continue; // null = no position_detailed synced; skip, don't count as 0
      hasAnyData = true;
      const codes = posDetailed.split(',').map((c: string) => c.trim()).filter(Boolean);
      if (codes.length >= 2) versatileCount++;
      const zones = new Set(codes.map(codeToZoneGroup).filter((z): z is string => z !== null));
      if (zones.size >= 2) crossGroupCount++;
    }

    if (!hasAnyData) { result.set(teamId, null); continue; }

    const versatilePct  = (versatileCount  / xiCount) * 100;
    const crossGroupPct = (crossGroupCount / xiCount) * 100;
    result.set(teamId, Math.min(100, Math.max(0, Math.round(versatilePct * 0.6 + crossGroupPct * 0.4))));
  }

  return result;
}

export async function processTeamIntelligencePartial(): Promise<{
  teamsProcessed: number;
  rowsWritten: number;
  error?: string;
}> {
  logger.info('processTeamIntelligencePartial started — DB only (form + congestion + travel + stability)');

  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Get all team IDs
    const teams = await fetchAllRows(
      db
        .from('teams')
        .select('id')
    );
    if (!teams || teams.length === 0) return { teamsProcessed: 0, rowsWritten: 0 };

    const teamIds = teams.map((t: any) => t.id);

    // 2. Last 5 and 10 points from form history (most recent matches).
    // Sorted by match_date (real chronology - when the match was actually
    // played), not created_at (when this row happened to be inserted).
    // Those normally line up, but a backfill or re-sync that inserts older
    // matches after newer ones were already written would silently break
    // "last 5/10" under created_at ordering - the 5 most RECENTLY INSERTED
    // rows aren't necessarily the 5 most recently PLAYED matches. Every
    // write site for this table denormalizes match_date directly from the
    // source match's real date (see migration 007) specifically so this
    // table doesn't have to rely on insertion order - processTeamMomentum
    // and the scoreline-prediction goals query already sorted by
    // match_date correctly; this was the one remaining site still using
    // created_at, found and fixed here.
    // BETA FIX (audit P0): was a raw read of ALL form history for ~323
    // teams — silently capped at 1000 rows (most recent globally), so
    // teams without a very recent fixture got short/empty arrays and wrong
    // form_index / last_5_points / last_10_points. Also now carries the
    // result letter so last_5_results (migration 023) is precomputed here
    // instead of derived — truncated — in the frontend.
    const formRecords = await fetchAllRows(
      db.from('team_form_history')
        .select('team_id, points, result, match_date')
        .in('team_id', teamIds)
        .order('match_date', { ascending: false })
    );

    const formByTeam = new Map<number, { points: number; result: string | null }[]>();
    for (const f of formRecords || []) {
      if (!formByTeam.has(f.team_id)) formByTeam.set(f.team_id, []);
      formByTeam.get(f.team_id)!.push({ points: f.points ?? 0, result: f.result ?? null });
    }

    // 3. Latest fixture load snapshot per team
    // BETA FIX: snapshots accumulate daily (~323 rows/day), so these two
    // reads passed 1000 rows within days. They survived by accident — the
    // newest date's rows land in the first page — but break the day any
    // team misses a snapshot. Paginate; first-seen-per-team logic unchanged.
    const fixLoadsAll = await fetchAllRows(
      db.from('team_fixture_load')
        .select('team_id, congestion_score, avg_rest_days, snapshot_date')
        .in('team_id', teamIds)
        .order('snapshot_date', { ascending: false })
    );
    const fixtureMap = new Map<number, any>();
    for (const f of fixLoadsAll || []) {
      if (!fixtureMap.has(f.team_id)) fixtureMap.set(f.team_id, f);
    }

    // 4. Latest travel load snapshot per team
    const travelLoadsAll = await fetchAllRows(
      db.from('team_travel_load')
        .select('team_id, travel_fatigue_score, km_last_30_days, snapshot_date')
        .in('team_id', teamIds)
        .order('snapshot_date', { ascending: false })
    );
    const travelMap = new Map<number, any>();
    for (const t of travelLoadsAll || []) {
      if (!travelMap.has(t.team_id)) travelMap.set(t.team_id, t);
    }

    // 5. Active competitions per team (last 90 days)
    // BETA FIX (audit P0): 90 days × 57 leagues is well past 1000 rows —
    // the raw read undercounted active_competitions for every team whose
    // matches fell outside the first page.
    const ago90 = new Date(new Date().getTime() - 90 * 86400000).toISOString();
    const compMatches = await fetchAllRows(
      db.from('matches')
        .select('home_team_id, away_team_id, competition')
        .gte('date', ago90)
        .not('competition', 'is', null)
        .not('status', 'in', '("cancelled","postponed")')
    );

    const teamCompetitions = new Map<number, Set<string>>();
    for (const m of compMatches || []) {
      if (!m.competition) continue;
      for (const teamId of [m.home_team_id, m.away_team_id]) {
        if (!teamId) continue;
        if (!teamCompetitions.has(teamId)) teamCompetitions.set(teamId, new Set());
        teamCompetitions.get(teamId)!.add(m.competition);
      }
    }

    // 6. Squad Stability inputs — PER SPEC (section 6):
    //    Retention(50%) + TransferContinuity(25%) + Availability(25%)
    const transferIntel = await fetchAllRows(
      db
        .from('team_transfer_intelligence')
        .select('team_id, retention_percentage, transfers_in, transfers_out')
    );
    const transferMap = new Map<number, any>(
      (transferIntel ?? []).map((t: any) => [t.team_id, t])
    );

    const squadSnapshots = await fetchAllRows(
      db
        .from('team_squads_snapshot')
        .select('team_id, players_count, injured_player_count, snapshot_date')
        .order('snapshot_date', { ascending: false })
    );
    const squadMap = new Map<number, any>();
    for (const s of squadSnapshots ?? []) {
      if (!squadMap.has(s.team_id)) squadMap.set(s.team_id, s);
    }

    // 7. Squad Depth inputs — team_position_depth is the single canonical
    //    source for position-level breakdown (see migration 007 — the old
    //    flat goalkeeper_depth/defender_depth/etc columns were dropped).
    // Uses fetchAllRows — this table is at 800+ rows and growing with every
    // squad sync, right at the edge of Supabase's silent 1000-row cap.
    const positionDepthRows = await fetchAllRows(
      db.from('team_position_depth').select('team_id, position_code, player_count, injured_count, available_count, total_market_value')
    );
    const positionDepthMap = new Map<number, any[]>();
    for (const p of positionDepthRows ?? []) {
      if (!positionDepthMap.has(p.team_id)) positionDepthMap.set(p.team_id, []);
      positionDepthMap.get(p.team_id)!.push(p);
    }

    // 7b. Squad Depth QUALITY inputs — position_depth above only measures
    // headcount availability (available_count / player_count), which treats
    // 5 average fit defenders as identical to 5 elite fit defenders. This
    // blends in actual player quality via total_rating/count_rating (see
    // Fix 1 above for why total_rating over raw rating — same reasoning:
    // total_rating naturally down-weights tiny-sample outliers since it's
    // an accumulated sum, not a bare average).
    //
    // Players table needed for position mapping (player_season_statistics
    // has no position column) and current_injury (only counting AVAILABLE
    // players' quality, matching what available_count already represents).
    const qualityPlayers = await fetchAllRows(
      db.from('players').select('id, team_id, position, current_injury')
    );
    const qualityStats = await fetchAllRows(
      db.from('player_season_statistics').select('player_id, total_rating, count_rating')
    );
    const statsByPlayerId = new Map<number, { totalRating: number; countRating: number }>();
    for (const s of qualityStats ?? []) {
      if (s.total_rating == null || s.count_rating == null || s.count_rating === 0) continue;
      // A player can have multiple season_external_id rows (different
      // competitions) — sum across all of them, consistent with
      // total_rating's own "accumulate across appearances" semantics.
      const existing = statsByPlayerId.get(s.player_id);
      if (existing) {
        existing.totalRating += s.total_rating;
        existing.countRating += s.count_rating;
      } else {
        statsByPlayerId.set(s.player_id, { totalRating: s.total_rating, countRating: s.count_rating });
      }
    }

    // team_id -> position_code -> { sumTotalRating, sumCountRating } across
    // AVAILABLE (non-injured) players only in that position.
    const qualityByTeamPosition = new Map<string, { sumTotalRating: number; sumCountRating: number }>();
    for (const p of qualityPlayers ?? []) {
      if (p.current_injury) continue; // only available players count toward depth quality
      const stat = statsByPlayerId.get(p.id);
      if (!stat) continue; // no season stats — likely a lower-coverage league, handled gracefully below
      const pos = p.position ?? 'M';
      const key = `${p.team_id}:${pos}`;
      const existing = qualityByTeamPosition.get(key);
      if (existing) {
        existing.sumTotalRating += stat.totalRating;
        existing.sumCountRating += stat.countRating;
      } else {
        qualityByTeamPosition.set(key, { sumTotalRating: stat.totalRating, sumCountRating: stat.countRating });
      }
    }

    // 8. Injury Burden / Market Value inputs — players carries market_value
    //    and current_injury directly, grouped per team here.
    // Uses fetchAllRows — this table has 2,300+ rows, well past Supabase's
    // silent 1000-row-per-request cap. See fetchAllRows() docstring for why
    // a naive .select() here would silently drop over half the players.
    const playerRows = await fetchAllRows(
      db.from('players').select('team_id, market_value, current_injury, injury_severity_score')
    );
    logger.info({ totalPlayerRows: playerRows.length }, 'All players fetched (paginated)');
    const playersByTeam = new Map<number, any[]>();
    for (const p of playerRows ?? []) {
      if (!p.team_id) continue;
      if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
      playersByTeam.get(p.team_id)!.push(p);
    }

    // 9. Lineup Versatility — computed from match_predicted_lineups joined
    // to players.position_detailed. One call, result shared across all teams
    // in the per-team loop below. Null for teams with no predicted lineup.
    const versatilityMap = await computeLineupVersatilityByTeam();

    // 7. Compute intelligence per team
    const rows: any[] = [];

    for (const teamId of teamIds) {
      const formRows = formByTeam.get(teamId) || [];
      const last5  = formRows.slice(0, 5);
      const last10 = formRows.slice(0, 10);

      const last5Points  = last5.reduce( (s: number, r) => s + r.points, 0);
      const last10Points = last10.reduce((s: number, r) => s + r.points, 0);

      // BETA: precomputed form pills, most recent first (e.g. 'WWDLW').
      // Written here — the single source — so no reader ever derives this
      // from a truncatable multi-row query again (migration 023 Part D).
      const last5Results = last5
        .map(r => r.result)
        .filter((r): r is 'W' | 'D' | 'L' => r === 'W' || r === 'D' || r === 'L')
        .join('') || null;

      // ── Form Score PER SPEC (section 1) ───────────────────────────────────
      // Last5Score = (points_last_5 / 15) × 100
      // Last10Score = (points_last_10 / 30) × 100
      // FormScore = (Last5Score × 0.70) + (Last10Score × 0.30)
      let formIndex: number | null = null;
      if (last5.length > 0) {
        const last5Score  = (last5Points / 15) * 100;
        const last10Score = last10.length > 0 ? (last10Points / 30) * 100 : last5Score;
        formIndex = Math.round(last5Score * 0.7 + last10Score * 0.3);
      }

      const fixture = fixtureMap.get(teamId);
      const travel  = travelMap.get(teamId);

      const congestionScore    = fixture?.congestion_score    ?? null;
      const restDaysAvg        = fixture?.avg_rest_days       ?? null;
      const travelFatigueScore = travel?.travel_fatigue_score ?? null;
      const travelLoadKm       = travel?.km_last_30_days      ?? null;

      // ── Squad Stability PER SPEC (section 6) ──────────────────────────────
      // Stability = Retention×0.5 + TransferContinuity×0.25 + Availability×0.25
      const ti = transferMap.get(teamId);
      const sq = squadMap.get(teamId);

      let squadStabilityScore: number | null = null;
      if (ti || sq) {
        const retention = ti?.retention_percentage ?? null; // 0-100, already a %

        // TransferContinuity: fewer total transfers (in+out) = more continuity.
        // 0 transfers = 100 (perfectly stable), 10+ transfers = 0 (high churn).
        const totalTransfers = (ti?.transfers_in ?? 0) + (ti?.transfers_out ?? 0);
        const transferContinuity = Math.max(0, 100 - totalTransfers * 10);

        // Availability: % of squad NOT injured
        const availability = (sq?.players_count && sq.players_count > 0)
          ? Math.max(0, 100 - ((sq.injured_player_count ?? 0) / sq.players_count) * 100)
          : null;

        const components = [
          retention !== null ? { v: retention, w: 0.5 } : null,
          { v: transferContinuity, w: 0.25 },
          availability !== null ? { v: availability, w: 0.25 } : null,
        ].filter((c): c is { v: number; w: number } => c !== null);

        if (components.length > 0) {
          const totalWeight = components.reduce((s, c) => s + c.w, 0);
          squadStabilityScore = Math.round(
            components.reduce((s, c) => s + c.v * c.w, 0) / totalWeight
          );
        }
      }

      // ── Baseline readiness (team-intrinsic components only) ───────────────
      // See function docstring: this is NOT the spec-authoritative match
      // readiness. It renormalizes spec weights over only the components
      // that don't require match context: Form(30) + Congestion(15) +
      // Travel(15) + Stability(5) = 65 of 100 spec weight, renormalized to 100%.
      const baselineComponents = [
        formIndex !== null ? { v: formIndex, w: 30 } : null,
        congestionScore !== null ? { v: 100 - congestionScore, w: 15 } : null, // inverted: low congestion = good
        travelFatigueScore !== null ? { v: 100 - travelFatigueScore, w: 15 } : null, // inverted
        squadStabilityScore !== null ? { v: squadStabilityScore, w: 5 } : null,
      ].filter((c): c is { v: number; w: number } => c !== null);

      const baselineReadiness = baselineComponents.length > 0
        ? Math.round(
            baselineComponents.reduce((s, c) => s + c.v * c.w, 0) /
            baselineComponents.reduce((s, c) => s + c.w, 0)
          )
        : null;

      // ── Squad Depth Score — synthesized from team_position_depth ──────────
      // For each position bucket: availability ratio (available/total, as
      // before) BLENDED with quality (avg rating of available players in
      // that position, derived from total_rating/count_rating). 60/40 split
      // — headcount still matters most (you can't field players who don't
      // exist), quality is a meaningful secondary signal.
      //
      // GRACEFUL FALLBACK: if no quality data exists for a position (lower-
      // coverage league, squad not fully synced, etc.), falls back to 100%
      // availability-only — exactly the old behavior. A team is never
      // penalized for missing data; the score just doesn't get the quality
      // boost/penalty it would with fuller data. This matters directly for
      // category B/C tournaments that may have sparser stats coverage.
      const posDepth = positionDepthMap.get(teamId) ?? [];
      const lineupVersatilityScore = versatilityMap.get(teamId) ?? null;
      let squadDepthScore: number | null = null;
      if (posDepth.length > 0) {
        // Same rating-scale normalization used elsewhere in this file.
        const normalizeRating = (avgRating: number) =>
          Math.max(0, Math.min(100, Math.round(((avgRating - 5.0) / 3.5) * 100)));

        const positionScores = posDepth
          .filter(p => (p.player_count ?? 0) > 0)
          .map(p => {
            const availabilityRatio = ((p.available_count ?? 0) / p.player_count) * 100;
            const q = qualityByTeamPosition.get(`${teamId}:${p.position_code}`);
            const avgRating = (q && q.sumCountRating > 0) ? q.sumTotalRating / q.sumCountRating : null;
            const qualityScore = avgRating !== null ? normalizeRating(avgRating) : null;

            // New formula per spec: Availability 0.4 + avg_rating 0.3 + versatility 0.3
            // Versatility is a team-level score applied equally to each position bucket,
            // because versatility benefits the team as a whole — a DM/DC player helps
            // every position slot, not just the one they're deployed in.
            // Weights renormalize when components are unavailable (no penalty for gaps).
            const components = [
              { v: availabilityRatio,          w: 0.4 },
              qualityScore !== null            ? { v: qualityScore,            w: 0.3 } : null,
              lineupVersatilityScore !== null  ? { v: lineupVersatilityScore,  w: 0.3 } : null,
            ].filter((c): c is { v: number; w: number } => c !== null);

            const totalW = components.reduce((s, c) => s + c.w, 0);
            return components.reduce((s, c) => s + c.v * c.w, 0) / totalW;
          });

        if (positionScores.length > 0) {
          squadDepthScore = Math.round(positionScores.reduce((s, r) => s + r, 0) / positionScores.length);
        }
      }

      // ── Injury Burden Score + Market Value split — from players ───────────
      // Burden weighted by MARKET VALUE, not just headcount — losing a
      // star player should register as a bigger burden than losing a
      // fringe squad player, which a raw injured-count can't capture.
      const teamPlayers = playersByTeam.get(teamId) ?? [];
      let injuryBurdenScore: number | null = null;
      let injuredMarketValue = 0;
      let availableMarketValue = 0;

      if (teamPlayers.length > 0) {
        let totalValue = 0;
        for (const p of teamPlayers) {
          const value = Number(p.market_value ?? 0);
          totalValue += value;
          if (p.current_injury) injuredMarketValue += value;
          else availableMarketValue += value;
        }
        if (totalValue > 0) {
          // Burden = % of total squad market value currently sidelined,
          // scaled 0-100 (higher = worse, consistent with congestion/travel polarity)
          injuryBurdenScore = Math.round((injuredMarketValue / totalValue) * 100);
        } else {
          // No market value data available — fall back to simple headcount ratio
          const injuredCount = teamPlayers.filter(p => p.current_injury).length;
          injuryBurdenScore = Math.round((injuredCount / teamPlayers.length) * 100);
        }
      }

      rows.push({
        team_id:                 teamId,
        form_index:              formIndex,
        last_5_points:           last5.length > 0  ? last5Points  : null,
        last_5_results:          last5Results,
        last_10_points:          last10.length > 0 ? last10Points : null,
        congestion_score:        congestionScore,
        rest_days_avg:           restDaysAvg,
        travel_fatigue_score:    travelFatigueScore,
        travel_load_km:          travelLoadKm,
        squad_stability_score:   squadStabilityScore,
        squad_depth_score:       squadDepthScore,
        lineup_versatility_score: lineupVersatilityScore,
        injury_burden_score:     injuryBurdenScore,
        // NOTE: no `|| null` here — a team with zero injured/available market
        // value (e.g. fully fit squad, or squad data not yet synced) is a
        // legitimate 0, not a missing value. `0 || null` evaluates to null
        // because 0 is falsy in JS, which was silently converting real
        // zeros into NULLs and making "no injuries" indistinguishable from
        // "we don't know".
        injured_market_value:    injuredMarketValue,
        available_market_value:  availableMarketValue,
        // Player-minutes-dependent fields — left NULL until player_season_statistics
        // (matchesStarted/minutesPlayed, see new sync:player-stats job) is synced.
        fatigue_index:           null,
        rotation_pressure_index: null,
        // Baseline readiness — see docstring. Match-context readiness lives
        // in match_intelligence.home_readiness/away_readiness instead.
        readiness_score:         baselineReadiness,
        active_competitions:     teamCompetitions.get(teamId)?.size ?? 0,
        calculated_at:           new Date().toISOString(),
        updated_at:              new Date().toISOString(),
      });
    }

    // Filter to teams that have at least one populated field
    const meaningful = rows.filter(r =>
      r.form_index !== null || r.congestion_score !== null || r.travel_fatigue_score !== null
    );

    // Batch upsert
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < meaningful.length; i += chunkSize) {
      const chunk = meaningful.slice(i, i + chunkSize);
      const { error } = await db
        .from('team_intelligence')
        .upsert(chunk, { onConflict: 'team_id' });
      written += chunk.length;
    }

    // Daily history snapshot — same rows just written, reshaped for the
    // history table. Unblocks Trend charts on Team Detail / League Detail /
    // Leagues Overview (see backend/docs/SCHEMA_GAP_ANALYSIS.md item #1).
    // UNIQUE(team_id, snapshot_date) means re-running this multiple times
    // in the same day upserts rather than creating duplicate history rows.
    const todaySnapshot = new Date().toISOString().split('T')[0];
    const historyRows = meaningful.map(r => ({
      team_id: r.team_id,
      snapshot_date: todaySnapshot,
      readiness_score: r.readiness_score,
      form_index: r.form_index,
      congestion_score: r.congestion_score,
      travel_fatigue_score: r.travel_fatigue_score,
      rest_days_avg: r.rest_days_avg,
      squad_stability_score: r.squad_stability_score,
      injury_burden_score: r.injury_burden_score,
      calculated_at: new Date().toISOString(),
    }));
    let historyWritten = 0;
    for (let i = 0; i < historyRows.length; i += chunkSize) {
      const chunk = historyRows.slice(i, i + chunkSize);
      const { error: histErr } = await db
        .from('team_intelligence_history')
        .upsert(chunk, { onConflict: 'team_id,snapshot_date' });
      if (histErr) {
        // Non-fatal — history is a nice-to-have for trend charts, don't
        // fail the whole processor if this table doesn't exist yet
        // (e.g. migration 010 not run) or a transient write error occurs.
        logger.warn({ error: histErr.message }, 'team_intelligence_history snapshot write failed — trend charts will be missing today\'s point, main team_intelligence data is unaffected');
        break;
      }
      historyWritten += chunk.length;
    }

    logger.info(
      {
        teamsProcessed: teamIds.length,
        rowsWritten: written,
        historySnapshotWritten: historyWritten,
        withSquadStability: meaningful.filter(r => r.squad_stability_score !== null).length,
      },
      'processTeamIntelligencePartial completed'
    );
    return { teamsProcessed: teamIds.length, rowsWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamIntelligencePartial failed');
    return { teamsProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ─── MATCH INTELLIGENCE (PARTIAL) ────────────────────────────────────────────

/**
 * Populates match_intelligence with the SPEC-AUTHORITATIVE per-match readiness
 * score — the full 7-component weighted formula from the Team Readiness
 * Engine spec, section "Match Readiness Calculation":
 *
 *   Readiness = Form×0.30 + OppStrength×0.20 + Congestion×0.15 + Travel×0.15
 *             + HomeAdvantage×0.10 + Stability×0.05 + Motivation×0.05
 *
 * Component sourcing (all DB-only, zero API calls):
 *   Form           → team_intelligence.form_index (own team)
 *   OppStrength    → team_strength_ratings.strength_score (OPPONENT, cross-wise)
 *   Congestion     → 100 - team_intelligence.congestion_score (own team, inverted)
 *   Travel         → 100 - team_intelligence.travel_fatigue_score (own team, inverted)
 *   HomeAdvantage  → team_venue_performance.venue_advantage_score (home side only;
 *                    away side gets 100-that, see inline comment)
 *   Stability      → team_intelligence.squad_stability_score (own team)
 *   Motivation     → competition-tier base value + active_competitions modifier
 *                    (own team's active_competitions count)
 *
 * If a component is unavailable for a given match, it is excluded and the
 * remaining components are renormalized over their relative weights — this
 * means readiness is always computable from day one and silently improves
 * in precision as more data (squad sync, strength ratings) becomes available.
 *
 * Also computable independent of the formula:
 *   home_rest_days / away_rest_days     → days since each team's last match
 *   congestion_factor                    → avg of home + away congestion scores
 *   home/away_travel_distance_km         → from match_travel_intelligence
 *   travel_advantage_score               → normalized travel gap
 */
export async function processMatchIntelligencePartial(opts?: {
  dateFilter?: 'today' | 'tomorrow' | string; // 'today'|'tomorrow' or a YYYY-MM-DD date string
  dateFrom?: string;   // YYYY-MM-DD — start of range (inclusive, UTC)
  dateTo?: string;     // YYYY-MM-DD — end of range (inclusive, UTC); defaults to today if omitted
  matchIds?: number[]; // specific match IDs — bypasses all date filters
}): Promise<{
  matchesProcessed: number;
  rowsWritten: number;
  error?: string;
}> {
  const modeLabel = opts?.matchIds
    ? `match IDs: ${opts.matchIds.join(', ')}`
    : opts?.dateFrom
      ? `range: ${opts.dateFrom} → ${opts.dateTo ?? 'today'}`
      : opts?.dateFilter
        ? `date: ${opts.dateFilter}`
        : 'ALL matches';
  logger.info({ mode: modeLabel }, 'processMatchIntelligencePartial started — DB only, full spec readiness formula');

  try {
    let matchQuery = db
      .from('matches')
      .select('id, home_team_id, away_team_id, date, competition')
      .order('date', { ascending: false });

    // Apply scope filter when requested — dramatically cheaper for daily
    // targeted runs vs always re-processing all 480+ matches
    if (opts?.matchIds && opts.matchIds.length > 0) {
      matchQuery = matchQuery.in('id', opts.matchIds);

    } else if (opts?.dateFrom) {
      // Date range — start must be provided; end defaults to today (UTC).
      // Intended for catch-up runs on local machines without crons, where
      // one or more days were missed: process:match-intelligence:range
      // 2026-06-29 2026-07-01 covers all three days in one command.
      const parseUTCDate = (s: string) => {
        const [y, mo, d] = s.split('-').map(Number);
        return new Date(Date.UTC(y, mo - 1, d));
      };
      const from = parseUTCDate(opts.dateFrom);
      const now  = new Date();
      const toDate = opts.dateTo ? parseUTCDate(opts.dateTo) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const rangeStart = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0));
      const rangeEnd   = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate(), 23, 59, 59, 999));
      matchQuery = matchQuery.gte('date', rangeStart.toISOString()).lte('date', rangeEnd.toISOString());

    } else if (opts?.dateFilter) {
      // Single named date or YYYY-MM-DD string
      const d = new Date();
      if (opts.dateFilter === 'tomorrow') d.setUTCDate(d.getUTCDate() + 1);
      else if (opts.dateFilter !== 'today' && /^\d{4}-\d{2}-\d{2}$/.test(opts.dateFilter)) {
        const [y, mo, day] = opts.dateFilter.split('-').map(Number);
        d.setUTCFullYear(y, mo - 1, day);
      }
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
      const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
      matchQuery = matchQuery.gte('date', start.toISOString()).lte('date', end.toISOString());
    }
    // No filter = existing behaviour: processes all matches (full pipeline)

    const { data: matches, error: mErr } = await matchQuery;

    if (!matches || matches.length === 0) {
      return { matchesProcessed: 0, rowsWritten: 0 };
    }

    // ── Load team_intelligence: form, congestion, travel, stability, comps ──
    const teamIntel = await fetchAllRows(
      db
        .from('team_intelligence')
        .select('team_id, readiness_score, form_index, congestion_score, travel_fatigue_score, squad_stability_score, active_competitions, injury_burden_score')
    );
    const intelMap = new Map<number, any>(
      (teamIntel || []).map((t: any) => [t.team_id, t])
    );

    // ── Load team_strength_ratings: for Opponent Strength (cross-wise) ──────
    const strengthRows = await fetchAllRows(
      db
        .from('team_strength_ratings')
        .select('team_id, strength_score')
    );
    const strengthMap = new Map<number, number>(
      (strengthRows ?? []).map((s: any) => [s.team_id, s.strength_score ?? 50])
    );

    // ── Load team_venue_performance: for Home Advantage ──────────────────────
    const venueRows = await fetchAllRows(
      db
        .from('team_venue_performance')
        .select('team_id, venue_advantage_score')
    );
    const venueMap = new Map<number, number>(
      (venueRows ?? []).map((v: any) => [v.team_id, v.venue_advantage_score ?? 50])
    );

    // Build last-match-date map for each team (for rest days)
    const allMatches = await fetchAllRows(
      db
        .from('matches')
        .select('id, home_team_id, away_team_id, date')
        .eq('status', 'finished')
        .order('date', { ascending: false })
    );

    const teamMatchDates = new Map<number, Date[]>();
    for (const m of allMatches || []) {
      const d = new Date(m.date);
      for (const tid of [m.home_team_id, m.away_team_id]) {
        if (!teamMatchDates.has(tid)) teamMatchDates.set(tid, []);
        teamMatchDates.get(tid)!.push(d);
      }
    }

    // Get travel intelligence per match
    const matchIds = matches.map((m: any) => m.id);
    const travelRows = await fetchAllRows(
      db
        .from('match_travel_intelligence')
        .select('match_id, home_team_distance_km, away_team_distance_km, travel_advantage_km')
        .in('match_id', matchIds)
    );

    const travelMap = new Map<number, any>(
      (travelRows || []).map((t: any) => [t.match_id, t])
    );

    // ── Competition Motivation helpers (spec section 7) ──────────────────────
    function competitionMotivationBase(competitionName: string | null): number {
      const c = (competitionName ?? '').toLowerCase();
      // Heuristic tiering — we don't have round/fixture-importance metadata,
      // so this pattern-matches on competition name. Documented simplification.
      if (c.includes('champions league') && c.includes('final')) return 100;
      if (c.includes('cup') && c.includes('final')) return 95;
      if (c.includes('champions league') || c.includes('europa') || c.includes('libertadores')) return 90;
      if (c.includes('friendly')) return 20;
      return 70; // default: standard league match
    }
    function motivationModifier(activeComps: number): number {
      if (activeComps <= 1) return 0;
      if (activeComps === 2) return 5;
      if (activeComps === 3) return 10;
      return 15; // 4+
    }

    /**
     * Computes the full spec-weighted readiness for one side of a match.
     * Renormalizes over whichever components have data available.
     */
    function computeReadiness(opts: {
      form: number | null;
      oppStrength: number | null;
      congestion: number | null; // already inverted (good-high)
      travel: number | null;     // already inverted (good-high)
      homeAdvantage: number | null;
      stability: number | null;
      motivation: number | null;
    }): number | null {
      const weighted = [
        opts.form          !== null ? { v: opts.form,          w: 30 } : null,
        opts.oppStrength    !== null ? { v: opts.oppStrength,    w: 20 } : null,
        opts.congestion     !== null ? { v: opts.congestion,     w: 15 } : null,
        opts.travel         !== null ? { v: opts.travel,         w: 15 } : null,
        opts.homeAdvantage  !== null ? { v: opts.homeAdvantage,  w: 10 } : null,
        opts.stability      !== null ? { v: opts.stability,      w: 5  } : null,
        opts.motivation     !== null ? { v: opts.motivation,     w: 5  } : null,
      ].filter((c): c is { v: number; w: number } => c !== null);

      if (weighted.length === 0) return null;
      const totalWeight = weighted.reduce((s, c) => s + c.w, 0);
      return Math.round(weighted.reduce((s, c) => s + c.v * c.w, 0) / totalWeight);
    }

    const rows: any[] = [];

    for (const m of matches) {
      const matchDate = new Date(m.date);

      const calcRestDays = (teamId: number): number | null => {
        const dates = teamMatchDates.get(teamId) || [];
        const prev  = dates.find(d => d < matchDate);
        if (!prev) return null;
        return Math.round((matchDate.getTime() - prev.getTime()) / 86400000);
      };

      const homeRest = calcRestDays(m.home_team_id);
      const awayRest = calcRestDays(m.away_team_id);

      const homeIntel = intelMap.get(m.home_team_id);
      const awayIntel = intelMap.get(m.away_team_id);

      const homeCongestionRaw = homeIntel?.congestion_score ?? null;
      const awayCongestionRaw = awayIntel?.congestion_score ?? null;
      const congestionFactor = (homeCongestionRaw !== null && awayCongestionRaw !== null)
        ? Math.round((homeCongestionRaw + awayCongestionRaw) / 2 * 100) / 100
        : (homeCongestionRaw ?? awayCongestionRaw ?? null);

      const travel = travelMap.get(m.id);
      const travelAdvantageScore = travel?.travel_advantage_km !== null && travel?.travel_advantage_km !== undefined
        ? Math.min(100, Math.round(Math.abs(travel.travel_advantage_km) / 30))
        : null;

      // ── Per-side component assembly ─────────────────────────────────────
      const homeForm  = homeIntel?.form_index ?? null;
      const awayForm  = awayIntel?.form_index ?? null;

      // Opponent Strength: CROSS-WISE — home team faces away team's strength
      const homeOppStrength = strengthMap.has(m.away_team_id) ? strengthMap.get(m.away_team_id)! : null;
      const awayOppStrength = strengthMap.has(m.home_team_id) ? strengthMap.get(m.home_team_id)! : null;

      // Congestion / Travel: own team, inverted to good-high
      const homeCongestionGood = homeCongestionRaw !== null ? 100 - homeCongestionRaw : null;
      const awayCongestionGood = awayCongestionRaw !== null ? 100 - awayCongestionRaw : null;
      const homeTravelGood = homeIntel?.travel_fatigue_score != null ? 100 - homeIntel.travel_fatigue_score : null;
      const awayTravelGood = awayIntel?.travel_fatigue_score != null ? 100 - awayIntel.travel_fatigue_score : null;

      // Home Advantage: home team gets their own venue advantage; away team
      // gets the structural inverse (playing away = no home boost). This
      // keeps the component meaningful for both sides of the formula without
      // conflating it with the away team's own separate away-form record.
      const homeVenueAdv = venueMap.has(m.home_team_id) ? venueMap.get(m.home_team_id)! : null;
      const awayVenueAdv = homeVenueAdv !== null ? 100 - homeVenueAdv : null;

      // Stability: own team
      const homeStability = homeIntel?.squad_stability_score ?? null;
      const awayStability = awayIntel?.squad_stability_score ?? null;

      // Motivation: shared competition base, own team's competition-count modifier
      const motivationBase = competitionMotivationBase(m.competition);
      const homeActiveComps = homeIntel?.active_competitions ?? 1;
      const awayActiveComps = awayIntel?.active_competitions ?? 1;
      const homeMotivation = Math.min(100, motivationBase + motivationModifier(homeActiveComps));
      const awayMotivation = Math.min(100, motivationBase + motivationModifier(awayActiveComps));

      const homeReadiness = computeReadiness({
        // BUG FIX (found from a real reported discrepancy: page showed
        // Sligo/Shamrock readiness as 52/56, Δ4, while team_intelligence's
        // baseline — which deliberately excludes opponent strength — showed
        // 41/74, Δ33; a 58-point strength gap should WIDEN the match-context
        // gap versus baseline, not compress it to almost nothing).
        // homeOppStrength/awayOppStrength store the RAW opponent strength
        // (kept that way deliberately — the confidence-score formula further
        // below reuses them unaveraged: homeOwnStrength = awayOppStrength).
        // Every OTHER component in this formula uses "higher input = better
        // for the team owning this calc" polarity (congestion/travel are
        // pre-inverted before being passed in here) — opponent strength
        // was the one component passed RAW, so a team facing a genuinely
        // strong opponent had that opponent's high strength score added as
        // a POSITIVE contribution to their OWN readiness. Inverted only at
        // this call site (100 - raw) so a weak opponent correctly raises
        // readiness and a strong opponent correctly lowers it, without
        // touching what homeOppStrength/awayOppStrength themselves store.
        // Verified by simulation against the real reported numbers before
        // this fix: buggy formula reproduced 52 almost exactly; corrected
        // formula lands at 40, right on the team_intelligence baseline of
        // 41 — exactly the small, sensible adjustment match context should
        // make, not a near-total wipeout of a real 58-point strength gap.
        form: homeForm, oppStrength: homeOppStrength !== null ? 100 - homeOppStrength : null,
        congestion: homeCongestionGood, travel: homeTravelGood,
        homeAdvantage: homeVenueAdv, stability: homeStability, motivation: homeMotivation,
      });
      const awayReadiness = computeReadiness({
        form: awayForm, oppStrength: awayOppStrength !== null ? 100 - awayOppStrength : null,
        congestion: awayCongestionGood, travel: awayTravelGood,
        homeAdvantage: awayVenueAdv, stability: awayStability, motivation: awayMotivation,
      });

      // ── CONFIDENCE SCORE — evidence agreement on the pick side ──────────
      // The Pick is whichever side the readiness gap favors. Confidence
      // measures how strongly the OTHER independent evidence streams agree
      // with that side. Each edge is signed toward the pick (+1 = fully
      // supports, -1 = fully contradicts), normalized by a saturation
      // constant (the gap size at which that signal counts as "maximal"),
      // then weight-blended. Missing components renormalize rather than
      // dragging the score down — same discipline as computeReadiness and
      // the team-strength formula (missing data must never masquerade as
      // negative evidence).
      //
      // Uses ONLY fields verified as actually computed (audit 2026-07-03):
      // readiness_gap, own-team strength (note: homeOppStrength = AWAY
      // team's strength, so home's own strength is awayOppStrength),
      // injury_burden_score, congestion_score (post-polarity-fix: higher =
      // more congested), travel distance, squad stability, venue advantage,
      // and the motivation proxy (deliberately lowest weight — it's a
      // shallow active-competitions modifier, not the points-gap-to-boundary
      // formula still flagged as a follow-up).
      //
      // Bands per spec: >=95 Elite | 85-94 Strong | 70-84 Moderate |
      // 55-69 Risky | <55 Avoid.
      let confidenceScore: number | null = null;
      let confidenceBand: string | null = null;
      {
        const rGap = (homeReadiness !== null && awayReadiness !== null)
          ? homeReadiness - awayReadiness : null;

        if (rGap !== null) {
          const pickSign = rGap >= 0 ? 1 : -1; // +1 = home pick, -1 = away pick

          // Each entry: [signed-toward-home raw gap | null, saturation, weight]
          const homeOwnStrength = awayOppStrength; // what away faces = home's own
          const awayOwnStrength = homeOppStrength;
          const homeInjury = homeIntel?.injury_burden_score ?? null;
          const awayInjury = awayIntel?.injury_burden_score ?? null;
          const homeCongRaw = homeIntel?.congestion_score ?? null;
          const awayCongRaw = awayIntel?.congestion_score ?? null;
          const homeKm = travel?.home_team_distance_km ?? null;
          const awayKm = travel?.away_team_distance_km ?? null;

          const components: Array<[number | null, number, number]> = [
            [rGap, 30, 30],                                                                          // readiness gap
            [(homeOwnStrength !== null && awayOwnStrength !== null) ? homeOwnStrength - awayOwnStrength : null, 30, 20], // strength gap
            [(homeInjury !== null && awayInjury !== null) ? awayInjury - homeInjury : null, 40, 15], // injury gap (opponent's burden helps)
            [(homeCongRaw !== null && awayCongRaw !== null) ? awayCongRaw - homeCongRaw : null, 50, 10], // congestion gap
            [(homeKm !== null && awayKm !== null) ? awayKm - homeKm : null, 1500, 10],               // travel gap (km)
            [(homeStability !== null && awayStability !== null) ? homeStability - awayStability : null, 40, 5], // stability gap
            [(homeVenueAdv !== null && awayVenueAdv !== null) ? homeVenueAdv - awayVenueAdv : null, 40, 7],     // venue gap
            [homeMotivation - awayMotivation, 20, 3],                                                // motivation proxy
          ];

          let weightedSum = 0;
          let weightUsed = 0;
          let componentsWithData = 0;
          for (const [gapTowardHome, saturation, weight] of components) {
            if (gapTowardHome === null) continue;
            // Sign toward the PICK side, clamp to [-1, 1] at saturation.
            const edge = Math.max(-1, Math.min(1, (gapTowardHome * pickSign) / saturation));
            weightedSum += edge * weight;
            weightUsed += weight;
            componentsWithData++;
          }

          // Gate: readiness gap + motivation are ALWAYS present (motivation
          // is a computed proxy, never null), so >= 4 means at least TWO
          // genuinely independent corroborating streams beyond those —
          // a "confidence" built from the gap alone would just restate it
          // with false precision.
          if (componentsWithData >= 4 && weightUsed > 0) {
            confidenceScore = Math.round(
              Math.max(0, Math.min(100, 50 + 50 * (weightedSum / weightUsed))) * 10
            ) / 10;
            confidenceBand =
              confidenceScore >= 95 ? 'Elite'
              : confidenceScore >= 85 ? 'Strong'
              : confidenceScore >= 70 ? 'Moderate'
              : confidenceScore >= 55 ? 'Risky'
              : 'Avoid';
          }
        }
      }

      rows.push({
        match_id:                 m.id,
        match_date:               m.date,  // denormalized — see migration 007
        home_rest_days:           homeRest,
        away_rest_days:           awayRest,
        congestion_factor:        congestionFactor,
        home_travel_distance_km:  travel?.home_team_distance_km ?? null,
        away_travel_distance_km:  travel?.away_team_distance_km ?? null,
        travel_advantage_score:   travelAdvantageScore,
        // ── Spec-authoritative readiness (full 7-component formula) ────────
        home_readiness:           homeReadiness,
        away_readiness:           awayReadiness,
        readiness_gap:            (homeReadiness !== null && awayReadiness !== null)
                                     ? Math.round((homeReadiness - awayReadiness) * 100) / 100
                                     : null,
        // Supporting fields — exposes each spec component for transparency
        home_strength_rating:      homeOppStrength,   // = away team's strength (what home team faces)
        away_strength_rating:      awayOppStrength,   // = home team's strength (what away team faces)
        home_venue_advantage:      homeVenueAdv,
        away_venue_advantage:      awayVenueAdv,
        home_squad_stability:      homeStability,
        away_squad_stability:      awayStability,
        motivation_gap:            Math.round((homeMotivation - awayMotivation) * 100) / 100,
        confidence_score:          confidenceScore,
        confidence_band:           confidenceBand,
        home_active_competitions:  homeActiveComps,
        away_active_competitions:  awayActiveComps,
        calculated_at:             new Date().toISOString(),
        updated_at:                new Date().toISOString(),
      });
    }

    // Batch upsert
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('match_intelligence')
        .upsert(chunk, { onConflict: 'match_id' });
      written += chunk.length;
    }

    logger.info(
      {
        matchesProcessed: matches.length,
        rowsWritten: written,
        withFullReadiness: rows.filter(r => r.home_readiness !== null && r.away_readiness !== null).length,
      },
      'processMatchIntelligencePartial completed'
    );
    return { matchesProcessed: matches.length, rowsWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processMatchIntelligencePartial failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ─── TEAM STRENGTH RATINGS (DB-ONLY) ─────────────────────────────────────────

/**
 * Computes team strength from existing DB data — zero API calls.
 *
 * Reads:  team_form_history (form, points per game, win %)
 *         team_intelligence (available_market_value as proxy for squad quality)
 * Writes: team_strength_ratings
 *
 * league_position: from tournament_standings (sync:standings), normalized
 * against actual league size since tracked leagues range from 10-team to
 * 36-team divisions.
 *
 * strength_score (UPDATED — see commit history): 35% PPG + 25% Win% +
 * 25% League Position + 15% Squad Quality.
 *
 * Squad Quality is NEW — derived from player_season_statistics.total_rating
 * (verified: rating = total_rating / count_rating, and count_rating tracks
 * total appearances not just starts — see backend/docs/ for the full
 * reasoning). Previously strength_score used ZERO player-quality signal,
 * relying purely on standings-derived stats (PPG/Win%/Position) plus
 * market value as informational-only context. That meant strength_score
 * was noisy early in a season (few matches played) despite player-level
 * historical quality data often being available and more stable. Falls
 * back gracefully to the original 3-component formula (weights
 * renormalized to 100%) for any team with no season-stats coverage yet —
 * this matters for category B/C leagues that may have sparser API data.
 */
export async function processTeamStrengthRatings(): Promise<{
  teamsProcessed: number;
  rowsWritten: number;
  withLeaguePosition: number;
  error?: string;
}> {
  logger.info('processTeamStrengthRatings started — DB only, zero API calls');

  try {
    // Get all form history grouped by team
    // Uses fetchAllRows — this table grows with every match and will exceed
    // Supabase's silent 1000-row cap as the season progresses.
    const formRows = await fetchAllRows(
      db.from('team_form_history').select('team_id, result, points')
    );

    // Aggregate by team
    const teamStats = new Map<number, { wins: number; matches: number; points: number }>();
    for (const row of formRows ?? []) {
      if (!teamStats.has(row.team_id)) teamStats.set(row.team_id, { wins: 0, matches: 0, points: 0 });
      const s = teamStats.get(row.team_id)!;
      s.matches++;
      s.points += row.points ?? 0;
      if (row.result === 'W') s.wins++;
    }

    if (teamStats.size === 0) {
      logger.warn('No form history data — run process:form:backfill first');
      return { teamsProcessed: 0, rowsWritten: 0, withLeaguePosition: 0 };
    }

    // ── League position — from tournament_standings (sync:standings) ───────
    // Position needs normalizing against league SIZE — 3rd in a 28-team
    // league is a very different signal than 3rd in a 12-team league, so we
    // group by tournament_id to know each team's league size for scaling.
    //
    // NOTE: no longer filters .eq('standings_type', 'total') — that would
    // silently exclude every team in a true multi-group/conference league
    // (e.g. MLS Eastern/Western) once syncStandings.ts starts writing real
    // group labels instead of a hardcoded 'total' for every row (see that
    // file's multi-group handling). Prefer 'total' when present (covers
    // 100% of today's single-group leagues, zero behavior change there);
    // otherwise take whatever group row exists rather than silently
    // dropping the team's position entirely.
    //
    // KNOWN REMAINING LIMITATION, not fixed here: leagueSizeByTournament
    // below computes size as the max position seen for a tournament,
    // across ALL groups combined. For a genuine multi-group league where
    // each conference has its own independent 1..N ranking, this mixes
    // two separate rank spaces together — a team ranked 3rd in the
    // Western conference isn't equivalent to 3rd in the Eastern
    // conference, but this logic currently treats them as comparable.
    // Fixing this properly needs the real standings_type values a live
    // multi-group response would provide (see backend/docs/api-samples/
    // standings/ once populated) — flagging honestly rather than guessing
    // at a normalization scheme without that data in hand.
    const standingsRowsRaw = await fetchAllRows(
      db
        .from('tournament_standings')
        .select('team_id, tournament_id, position, standings_type')
    );

    const standingsRows: any[] = [];
    const seenTeams = new Set<number>();
    // Prefer 'total' rows first, then fill in any remaining teams from
    // whatever other standings_type rows they have.
    for (const s of (standingsRowsRaw ?? []).filter((r: any) => r.standings_type === 'total')) {
      standingsRows.push(s);
      seenTeams.add(s.team_id);
    }
    for (const s of standingsRowsRaw ?? []) {
      if (seenTeams.has(s.team_id)) continue;
      standingsRows.push(s);
      seenTeams.add(s.team_id);
    }

    const positionMap = new Map<number, number>();
    const leagueSizeByTournament = new Map<number, number>();
    for (const s of standingsRows ?? []) {
      if (s.position) positionMap.set(s.team_id, s.position);
      const current = leagueSizeByTournament.get(s.tournament_id) ?? 0;
      leagueSizeByTournament.set(s.tournament_id, Math.max(current, s.position ?? 0));
    }
    const tournamentByTeam = new Map<number, number>(
      (standingsRows ?? []).map((s: any) => [s.team_id, s.tournament_id])
    );

    // market_value_eur is informational only — spec section 2 explicitly
    // removes market value from the strength_score formula (PPG/Win%/League
    // Position only) now that real league_position exists. Still populated
    // for display purposes (team profile pages, etc.) where it's useful context.
    const tiRows = await fetchAllRows(
      db
        .from('team_intelligence')
        .select('team_id, available_market_value, injured_market_value')
    );
    const mvMap = new Map<number, number>(
      (tiRows ?? []).map((t: any) => [t.team_id, (t.available_market_value ?? 0) + (t.injured_market_value ?? 0)])
    );

    // ── Squad Quality — NEW component (see docstring above) ────────────────
    // Whole-squad average rating, derived from total_rating/count_rating
    // accumulated per player (same "sum across all season_external_id rows"
    // logic as Fix 2 in processTeamIntelligencePartial — a player with
    // stats split across multiple competitions gets a genuine season-wide
    // total, not just whichever row happened to be selected first).
    const qualityStatsAll = await fetchAllRows(
      db.from('player_season_statistics').select('player_id, team_id, total_rating, count_rating')
    );
    const teamQuality = new Map<number, { sumTotalRating: number; sumCountRating: number }>();
    for (const s of qualityStatsAll ?? []) {
      if (s.total_rating == null || s.count_rating == null || s.count_rating === 0) continue;
      const existing = teamQuality.get(s.team_id);
      if (existing) {
        existing.sumTotalRating += s.total_rating;
        existing.sumCountRating += s.count_rating;
      } else {
        teamQuality.set(s.team_id, { sumTotalRating: s.total_rating, sumCountRating: s.count_rating });
      }
    }
    // Same 5.0-8.5 -> 0-100 normalization as Fix 2, kept consistent across
    // both places this rating data gets used.
    const normalizeRating = (avgRating: number) =>
      Math.max(0, Math.min(100, Math.round(((avgRating - 5.0) / 3.5) * 100)));

    // Lineup Versatility — same helper used by processTeamIntelligencePartial.
    // Called here so strength_rating incorporates the same tactical-flexibility
    // signal. Null for teams with no predicted lineup (weight renormalizes out).
    const strengthVersatilityMap = await computeLineupVersatilityByTeam();

    const rows: any[] = [];
    for (const [teamId, stats] of teamStats) {
      if (stats.matches === 0) continue;

      const ppg    = +(stats.points / stats.matches).toFixed(3);
      const winPct = +(stats.wins / stats.matches * 100).toFixed(1);

      const leaguePosition = positionMap.get(teamId) ?? null;
      const tournamentId   = tournamentByTeam.get(teamId);
      const leagueSize      = tournamentId ? leagueSizeByTournament.get(tournamentId) : null;

      // Position score: 1st place = 100, last place = ~0, scaled to actual
      // league size (not a fixed assumption like "20 teams") since tracked
      // leagues range from 10-team divisions to 36-team Argentine tiers.
      const positionScore = (leaguePosition && leagueSize && leagueSize > 1)
        ? Math.round(((leagueSize - leaguePosition) / (leagueSize - 1)) * 100)
        : null;

      // Squad Quality score — whole-squad average rating normalized 0-100.
      // Null (component simply omitted, weights renormalize) when a team
      // has zero season-stats coverage — no penalty for missing data,
      // same graceful-fallback principle as positionScore above.
      const q = teamQuality.get(teamId);
      const squadQualityScore = (q && q.sumCountRating > 0)
        ? normalizeRating(q.sumTotalRating / q.sumCountRating)
        : null;

      const lineupVersatility = strengthVersatilityMap.get(teamId) ?? null;

      // ── Strength Score: 30% PPG + 20% Win% + 20% League Position +
      // 15% Squad Quality + 15% Lineup Versatility.
      // Lineup Versatility (% of predicted-XI players covering multiple
      // positions/zones) reflects tactical resilience — a team with 4
      // versatile starters absorbs in-game injuries/suspensions better
      // than one with 11 specialists. Null when no predicted lineup
      // exists; weight renormalizes as with all other optional components.
      const components = [
        { v: (ppg / 3) * 100, w: 30 },
        { v: winPct,          w: 20 },
        positionScore    !== null ? { v: positionScore,    w: 20 } : null,
        squadQualityScore !== null ? { v: squadQualityScore, w: 15 } : null,
        lineupVersatility !== null ? { v: lineupVersatility, w: 15 } : null,
      ].filter((c): c is { v: number; w: number } => c !== null);

      const totalWeight = components.reduce((s, c) => s + c.w, 0);
      const strength = Math.round(
        components.reduce((s, c) => s + c.v * c.w, 0) / totalWeight
      );

      rows.push({
        team_id:                  teamId,
        league_position:          leaguePosition,
        points_per_game:          ppg,
        win_percentage:           winPct,
        strength_score:           Math.min(100, Math.max(0, strength)),
        lineup_versatility_score: lineupVersatility,
        market_value_eur:         mvMap.get(teamId) || null,
        calculated_at:            new Date().toISOString(),
      });
    }

    // Batch upsert in chunks
    const chunkSize = 200;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error } = await db
        .from('team_strength_ratings')
        .upsert(rows.slice(i, i + chunkSize), { onConflict: 'team_id' });
      written += rows.slice(i, i + chunkSize).length;
    }

    const withLeaguePosition = rows.filter(r => r.league_position !== null).length;
    logger.info({ teamsProcessed: teamStats.size, rowsWritten: written, withLeaguePosition }, 'processTeamStrengthRatings completed');
    return { teamsProcessed: teamStats.size, rowsWritten: written, withLeaguePosition };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamStrengthRatings failed');
    return { teamsProcessed: 0, rowsWritten: 0, withLeaguePosition: 0, error: error.message };
  }
}

// ─── TEAM VENUE PERFORMANCE (DB-ONLY) ────────────────────────────────────────

/**
 * Computes home vs away performance splits — zero API calls.
 *
 * Reads:  team_form_history + matches (to determine home/away)
 * Writes: team_venue_performance
 *
 * venue_advantage_score: capped 0–100
 *   home_ppg > away_ppg → score > 50 (home advantage)
 *   home_ppg < away_ppg → score < 50 (neutral or away-friendly)
 */
export async function processTeamVenuePerformance(): Promise<{
  teamsProcessed: number;
  rowsWritten: number;
  error?: string;
}> {
  logger.info('processTeamVenuePerformance started — DB only, zero API calls');

  try {
    // Join form_history with matches to get home/away context
    // Uses fetchAllRows — same growing-table risk as above.
    const formWithVenue = await fetchAllRows(
      db.from('team_form_history').select(`
        team_id, result, points, goals_for, goals_against,
        match:matches(id, home_team_id)
      `)
    );
    if (!formWithVenue || formWithVenue.length === 0) {
      logger.warn('No form history — run process:form:backfill first');
      return { teamsProcessed: 0, rowsWritten: 0 };
    }

    // Aggregate home and away stats per team
    interface VenueStats {
      matches: number; points: number; wins: number;
      goalsFor: number; goalsAgainst: number;
    }
    const home = new Map<number, VenueStats>();
    const away = new Map<number, VenueStats>();

    for (const row of formWithVenue) {
      const match: any = row.match;
      if (!match) continue;

      const isHome = match.home_team_id === row.team_id;
      const map    = isHome ? home : away;

      if (!map.has(row.team_id)) {
        map.set(row.team_id, { matches: 0, points: 0, wins: 0, goalsFor: 0, goalsAgainst: 0 });
      }
      const s = map.get(row.team_id)!;
      s.matches++;
      s.points      += row.points ?? 0;
      s.goalsFor    += row.goals_for ?? 0;
      s.goalsAgainst+= row.goals_against ?? 0;
      if (row.result === 'W') s.wins++;
    }

    const allTeamIds = new Set([...home.keys(), ...away.keys()]);
    const rows: any[] = [];

    for (const teamId of allTeamIds) {
      const h = home.get(teamId) ?? { matches: 0, points: 0, wins: 0, goalsFor: 0, goalsAgainst: 0 };
      const a = away.get(teamId) ?? { matches: 0, points: 0, wins: 0, goalsFor: 0, goalsAgainst: 0 };

      const homePPG  = h.matches > 0 ? +(h.points / h.matches).toFixed(3) : null;
      const awayPPG  = a.matches > 0 ? +(a.points / a.matches).toFixed(3) : null;
      const homeWin  = h.matches > 0 ? +(h.wins / h.matches * 100).toFixed(1) : null;
      const awayWin  = a.matches > 0 ? +(a.wins / a.matches * 100).toFixed(1) : null;
      const homeGD   = h.matches > 0 ? +((h.goalsFor - h.goalsAgainst) / h.matches).toFixed(2) : null;
      const awayGD   = a.matches > 0 ? +((a.goalsFor - a.goalsAgainst) / a.matches).toFixed(2) : null;

      // venue_advantage_score: 50 = neutral, >50 = home stronger, <50 = away stronger
      let venueScore: number | null = null;
      if (homePPG !== null && awayPPG !== null) {
        const diff    = homePPG - awayPPG; // max realistic range: -3 to +3
        venueScore = Math.round(50 + (diff / 3) * 50);
        venueScore = Math.max(0, Math.min(100, venueScore));
      } else if (homePPG !== null) {
        venueScore = 60; // Has home data only — assume slight advantage
      }

      rows.push({
        team_id:              teamId,
        home_matches:         h.matches,
        away_matches:         a.matches,
        home_points_per_game: homePPG,
        away_points_per_game: awayPPG,
        home_win_pct:         homeWin,
        away_win_pct:         awayWin,
        home_goal_diff:       homeGD,
        away_goal_diff:       awayGD,
        venue_advantage_score: venueScore,
        calculated_at:        new Date().toISOString(),
      });
    }

    // Batch upsert
    const chunkSize = 200;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error } = await db
        .from('team_venue_performance')
        .upsert(rows.slice(i, i + chunkSize), { onConflict: 'team_id' });
      written += rows.slice(i, i + chunkSize).length;
    }

    logger.info({ teamsProcessed: allTeamIds.size, rowsWritten: written }, 'processTeamVenuePerformance completed');
    return { teamsProcessed: allTeamIds.size, rowsWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamVenuePerformance failed');
    return { teamsProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ─── PLAYER INTELLIGENCE (DB-ONLY) ───────────────────────────────────────────

/**
 * Computes player intelligence from data already in DB — zero API calls.
 *
 *   fatigue_score     — max(injury_severity, blended real-load factors:
 *                        minutes overload + match frequency, from
 *                        player_match_load, + team congestion). Injury
 *                        severity is a FLOOR, not averaged in, so an
 *                        actively injured player's fatigue never drops
 *                        below their injury severity just because they
 *                        aren't accumulating playing-load while sidelined.
 *   load_index        — equals fatigue_score (congestion is already
 *                        folded into fatigue above; not re-added here,
 *                        which the previous formula did, inflating
 *                        congestion's real influence).
 *   readiness_score    — 100 - load_index, same direction as team-level readiness.
 *   transfers_last_12  — count from player_transfers (last 12 months).
 *   matches/minutes_last_7/30_days, avg_minutes_per_match — real,
 *                        populated from player_match_load (proxy data,
 *                        see processPlayerMatchLoad's own docstring for
 *                        what "real" means here — season minutes
 *                        distributed across a team's actual recent
 *                        fixtures, not a verified per-match record).
 */
export async function processPlayerIntelligence(): Promise<{
  playersProcessed: number;
  rowsWritten: number;
  error?: string;
}> {
  logger.info('processPlayerIntelligence started — DB only, zero API calls');

  try {
    // ── Query 1: Players (injury data + position, needed for importance) ───
    // players → team_intelligence have no direct FK constraint; Supabase
    // cannot join them. Fetch separately and join in memory instead.
    // Uses fetchAllRows — same 1000-row silent cap bug found and fixed
    // elsewhere in this file; players has 2,300+ rows.
    const players = await fetchAllRows(
      db.from('players').select('id, team_id, position, current_injury, injury_severity_score')
    );
    if (players.length === 0) {
      logger.warn('No players in DB — run sync:squads:v2 first');
      return { playersProcessed: 0, rowsWritten: 0 };
    }
    logger.debug({ playerCount: players.length }, 'Players fetched (paginated)');

    // ── Query 1b: Season stats for importance scoring ───────────────────────
    // Season-SCOPED — most recent season per player only. Same fix as
    // processPredictedLineups: player_season_statistics upserts on
    // (player_id, season_external_id), so a player genuinely accumulates a
    // separate row per season over time; summing across all of them would
    // mix current-season form with stale prior-season numbers.
    const seasonStatsRaw = await fetchAllRows(
      db.from('player_season_statistics')
        .select('player_id, team_id, season_external_id, goals, assists, minutes_played, total_rating, count_rating')
    );
    const statsMap = new Map<number, any>();
    for (const s of seasonStatsRaw) {
      const existing = statsMap.get(s.player_id);
      if (existing && existing.season_external_id >= (s.season_external_id ?? 0)) continue;
      statsMap.set(s.player_id, {
        team_id: s.team_id,
        season_external_id: s.season_external_id ?? 0,
        goals: s.goals || 0,
        assists: s.assists || 0,
        minutes_played: s.minutes_played || 0,
        avg_rating: (s.count_rating > 0 && s.total_rating > 0) ? s.total_rating / s.count_rating : null,
      });
    }

    // Team-level totals, built from the SAME season-scoped statsMap (not raw
    // multi-season sums) — keeps "player's share of team total" internally
    // consistent rather than comparing a single-season player figure against
    // a stale multi-season team figure.
    const teamGoals = new Map<number, number>();
    const teamAssists = new Map<number, number>();
    const teamMinutes = new Map<number, number>();
    for (const [, s] of statsMap) {
      teamGoals.set(s.team_id, (teamGoals.get(s.team_id) ?? 0) + s.goals);
      teamAssists.set(s.team_id, (teamAssists.get(s.team_id) ?? 0) + s.assists);
      teamMinutes.set(s.team_id, (teamMinutes.get(s.team_id) ?? 0) + s.minutes_played);
    }

    // ── Query 2: Team congestion scores (keyed by team_id)
    let teamIntels: any[] = [];
    try {
      teamIntels = await fetchAllRows(
      db
        .from('team_intelligence')
        .select('team_id, congestion_score')
      );
    } catch (e: any) {
      logger.warn({ error: e.message }, 'team_intelligence query failed — continuing degraded');
    }

    const congestionMap = new Map<number, number>(
      (teamIntels ?? []).map((t: any) => [t.team_id, Number(t.congestion_score ?? 0)])
    );

    // ── Query 3: Transfer counts per player (last 12 months)
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const transfers = await fetchAllRows(
      db
        .from('player_transfers')
        .select('player_id')
        .gte('transfer_date', yearAgo.toISOString().split('T')[0])
    );

    const transferMap = new Map<number, number>();
    for (const t of transfers ?? []) {
      transferMap.set(t.player_id, (transferMap.get(t.player_id) ?? 0) + 1);
    }

    // ── Query 4: Recent match load, from player_match_load ──────────────────
    // Populated by processPlayerMatchLoad() — a proxy (season minutes
    // distributed across a team's real recent fixtures), not exact
    // per-match truth, but real enough to distinguish "hasn't played
    // much lately" from "playing every 3 days" for fatigue purposes.
    // Aggregated here into 7d/30d windows per player — feeds BOTH the
    // new fatigue formula below and the matches_last_7_days/
    // minutes_last_7_days/etc columns on this table, previously always
    // written as null with a "future premium feature" comment — that
    // future arrived once player_match_load started being populated.
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const matchLoadRaw = await fetchAllRows(
      db.from('player_match_load')
        .select('player_id, match_date, minutes_played')
        .gte('match_date', thirtyDaysAgo)
    );
    const matchLoadMap = new Map<number, { m7: number; min7: number; m30: number; min30: number }>();
    for (const r of matchLoadRaw) {
      const entry = matchLoadMap.get(r.player_id) ?? { m7: 0, min7: 0, m30: 0, min30: 0 };
      entry.m30 += 1;
      entry.min30 += r.minutes_played ?? 0;
      if (r.match_date >= sevenDaysAgo) {
        entry.m7 += 1;
        entry.min7 += r.minutes_played ?? 0;
      }
      matchLoadMap.set(r.player_id, entry);
    }

    // ── Compute player intelligence rows ─────────────────────────────────────
    const now = new Date().toISOString();
    const rows: any[] = [];

    // normalizeRating: identical to the convention used in
    // processTeamIntelligencePartial/processTeamStrengthRatings elsewhere in
    // this file — a 5.0 rating floors at 0, 8.5 caps at 100.
    const normalizeRating = (r: number) =>
      Math.max(0, Math.min(100, Math.round(((r - 5.0) / 3.5) * 100)));

    const importanceByPlayer = new Map<number, number>(); // for team_injury_impact below

    for (const p of players) {
      const injurySeverity  = Number(p.injury_severity_score ?? 0);
      const teamCongestion  = congestionMap.get(p.team_id) ?? 0;
      const transfersLast12 = transferMap.get(p.id) ?? 0;
      const matchLoad = matchLoadMap.get(p.id);

      // ── fatigue_score — integrated formula, not injury severity alone ──
      // The original version (fatigue = injurySeverity) meant a perfectly
      // healthy player who'd started every match in a packed run of
      // fixtures scored IDENTICALLY to one who'd barely played at all —
      // fatigue never actually reflected real playing load. This is the
      // recommended fix: blend injury severity with real recent-load
      // signals (minutes overload, match frequency) and team schedule
      // congestion.
      //
      // Deliberately max(), not a weighted average across all four
      // factors: an ACTIVELY INJURED player's fatigue must never drop
      // BELOW their injury severity just because they're not
      // accumulating playing-load WHILE SIDELINED — a naive weighted
      // blend would dilute an injured player's fatigue toward 0 as their
      // (necessarily zero) recent minutes pull the average down, which
      // would backwards-inflate their downstream readiness_score exactly
      // when it should be lowest. Verified this exact failure mode by
      // simulation before choosing max() over a weighted average.
      //
      // minutesOverload/matchFrequency ceilings (270 min/wk = 3 full
      // matches, 3 matches/wk) reflect a widely-recognized heavy-schedule
      // threshold in football — not an arbitrary number chosen to make
      // the formula "work". Weights (25/25/20 from the original
      // recommendation) renormalized to sum to 100 among just the three
      // non-injury factors (~36/36/28), since max() replaces the fourth
      // (injury) term rather than averaging it in.
      const minutesOverload = matchLoad ? Math.min(100, (matchLoad.min7 / 270) * 100) : 0;
      const matchFrequency  = matchLoad ? Math.min(100, (matchLoad.m7 / 3) * 100) : 0;
      const loadBlend = minutesOverload * 0.357 + matchFrequency * 0.357 + teamCongestion * 0.286;
      const fatigue = Math.round(Math.max(injurySeverity, loadBlend));

      // load_index: fatigue now already incorporates team congestion
      // (via loadBlend above) — no longer re-adding it here too, which
      // the previous fatigue*0.6+congestion*0.4 formula would have done,
      // inflating congestion's real influence beyond what was intended.
      const load = fatigue;

      // readiness_score: inverse of load — a healthy, unfatigued player on
      // a lightly-congested team schedule reads as high readiness. Same
      // directional logic as team_intelligence.readiness_score, just at
      // player granularity. Unblocks the "Key Players" READINESS column
      // in the Team Detail mockup (see SCHEMA_GAP_ANALYSIS.md item #2).
      const readiness = Math.max(0, Math.min(100, 100 - Math.min(100, load)));

      // ── Importance score — how much does this team rely on this player? ──
      // Built after finding a real double-scaling bug in a proposed ad-hoc
      // formula elsewhere ((weighted-fraction-sum-already-0-100) * 100 —
      // inflated a real ~12.5/100 score to 1250, misreported as "CRITICAL").
      // Verified this version by direct simulation against realistic player
      // profiles before writing it here — star striker, first-choice
      // keeper, rotation player, and bench player all produced a sensible,
      // monotonic, correctly-bounded 0-100 distribution.
      //
      // POSITION-AWARE, deliberately: a goals+assists-weighted formula
      // would make every goalkeeper look nearly worthless (keepers
      // essentially never score or assist), which is obviously wrong —
      // losing a first-choice keeper is a major blow. Goalkeepers are
      // scored on minutes-share + quality only; outfield players get the
      // full goals/assists/minutes/quality blend.
      const stat = statsMap.get(p.id);
      let importanceScore: number | null = null;
      let goalSharePct: number | null = null;
      let assistSharePct: number | null = null;
      let minutesSharePct: number | null = null;
      if (stat) {
        const tGoals = teamGoals.get(stat.team_id) ?? 0;
        const tAssists = teamAssists.get(stat.team_id) ?? 0;
        const tMinutes = teamMinutes.get(stat.team_id) ?? 0;
        const gShare = tGoals > 0 ? stat.goals / tGoals : 0;
        const aShare = tAssists > 0 ? stat.assists / tAssists : 0;
        const mShare = tMinutes > 0 ? stat.minutes_played / tMinutes : 0;
        const quality = stat.avg_rating != null ? normalizeRating(stat.avg_rating) / 100 : 0;

        importanceScore = p.position === 'G'
          ? Math.round(Math.min(100, mShare * 50 + quality * 50) * 10) / 10
          : Math.round(Math.min(100, gShare * 30 + aShare * 20 + mShare * 30 + quality * 20) * 10) / 10;
        goalSharePct = Math.round(gShare * 1000) / 10;
        assistSharePct = Math.round(aShare * 1000) / 10;
        minutesSharePct = Math.round(mShare * 1000) / 10;
      }
      if (importanceScore != null) importanceByPlayer.set(p.id, importanceScore);

      rows.push({
        player_id:                p.id,
        fatigue_score:            fatigue,
        load_index:               Math.min(100, load),
        readiness_score:          readiness,
        transfers_last_12_months: transfersLast12,
        importance_score:         importanceScore,
        goal_share_pct:           goalSharePct,
        assist_share_pct:         assistSharePct,
        minutes_share_pct:        minutesSharePct,
        // Now real — populated from player_match_load (see matchLoadMap
        // above). avg_minutes_per_match uses the 30-day window as a more
        // stable sample than 7 days alone.
        matches_last_7_days:   matchLoad?.m7 ?? 0,
        matches_last_30_days:  matchLoad?.m30 ?? 0,
        minutes_last_7_days:   matchLoad?.min7 ?? 0,
        minutes_last_30_days:  matchLoad?.min30 ?? 0,
        avg_minutes_per_match: (matchLoad && matchLoad.m30 > 0) ? Math.round(matchLoad.min30 / matchLoad.m30) : null,
        calculated_at:         now,
        updated_at:            now,
      });
    }

    // ── Upsert in chunks ──────────────────────────────────────────────────────
    const chunkSize = 200;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('player_intelligence')
        .upsert(chunk, { onConflict: 'player_id' });
      written += chunk.length;
      logger.debug({ written, total: rows.length }, 'Player intelligence chunk written');
    }

    logger.info({
      playersProcessed: players.length,
      rowsWritten:      written,
      withInjury:       rows.filter((r: any) => r.fatigue_score > 0).length,
      withTransfers:    rows.filter((r: any) => r.transfers_last_12_months > 0).length,
    }, 'processPlayerIntelligence completed');

    // ── team_goal_dependency — concentration risk, not "starters vs bench" ──
    // Deliberately NOT "% of goals from the predicted XI" (the framing in
    // the source analysis this was built from) — that's largely tautological,
    // since predicted lineups are selected BY matches_started/rating, so of
    // course the starters account for most output; that's true of every
    // team ever and isn't itself a differentiated risk signal. Concentration
    // in ONE named individual — "33% of this team's goals come from a
    // single player" — is the real, rare, actionable signal.
    let goalDepWritten = 0;
    try {
      const goalDepRows: any[] = [];
      for (const [teamId, tGoals] of teamGoals) {
        if (tGoals <= 0) continue;
        // Find this team's top scorer(s) among players with a resolved stat row
        const teamPlayers = [...statsMap.entries()].filter(([, s]) => s.team_id === teamId);
        const byGoals = teamPlayers.filter(([, s]) => s.goals > 0).sort((a, b) => b[1].goals - a[1].goals);
        if (byGoals.length === 0) continue;
        const [topId, topStat] = byGoals[0];
        const top2Goals = byGoals.slice(0, 2).reduce((sum, [, s]) => sum + s.goals, 0);
        goalDepRows.push({
          team_id: teamId,
          season_external_id: topStat.season_external_id,
          total_goals: tGoals,
          total_assists: teamAssists.get(teamId) ?? 0,
          top_scorer_player_id: topId,
          top_scorer_goals: topStat.goals,
          top_scorer_pct: Math.round((topStat.goals / tGoals) * 1000) / 10,
          top_2_scorers_pct: Math.round((top2Goals / tGoals) * 1000) / 10,
          // No viable second scorer at all — single point of failure, not
          // just "concentrated", genuinely irreplaceable if only one player
          // has scored ANY goals this season.
          top_scorer_no_backup: byGoals.length === 1,
          calculated_at: now,
        });
      }
      if (goalDepRows.length > 0) {
        const { error: gdErr } = await db
          .from('team_goal_dependency')
          .upsert(goalDepRows, { onConflict: 'team_id' });
        if (gdErr) {
          logger.warn({ error: gdErr.message }, 'team_goal_dependency upsert failed — continuing');
        } else {
          goalDepWritten = goalDepRows.length;
        }
      }
    } catch (e: any) {
      logger.warn({ error: e.message }, 'team_goal_dependency computation failed — continuing');
    }

    // ── team_injury_impact — SUM(importance_score) of currently-injured
    // players, correctly gated on the SAME two signals already used above
    // (current_injury boolean OR an active row implied by injury_severity_score
    // > 0 — this function never queried player_injuries directly, it already
    // had what it needed on the players row itself). NOT the source
    // analysis's `end_timestamp > NOW()` comparison, which silently drops
    // any open-ended injury with no known return date (NULL > X is NULL,
    // not true, in a WHERE clause).
    let injuryImpactWritten = 0;
    try {
      const injuredByTeam = new Map<number, { player_id: number; importance: number; goals: number; assists: number; position: string }[]>();
      for (const p of players) {
        const isInjured = p.current_injury === true || Number(p.injury_severity_score ?? 0) > 0;
        if (!isInjured) continue;
        const importance = importanceByPlayer.get(p.id) ?? 0;
        const stat = statsMap.get(p.id);
        if (!injuredByTeam.has(p.team_id)) injuredByTeam.set(p.team_id, []);
        injuredByTeam.get(p.team_id)!.push({
          player_id: p.id, importance,
          goals: stat?.goals ?? 0, assists: stat?.assists ?? 0,
          position: p.position ?? 'M',
        });
      }

      const injuryRows: any[] = [];
      for (const [teamId, injured] of injuredByTeam) {
        if (injured.length === 0) continue;
        const totalImportance = injured.reduce((s, i) => s + i.importance, 0);
        const goalsLost = injured.reduce((s, i) => s + i.goals, 0);
        const assistsLost = injured.reduce((s, i) => s + i.assists, 0);
        const worst = injured.reduce((a, b) => (b.importance > a.importance ? b : a));

        // Positions where EVERY player at that position for this team is
        // currently injured — "no natural replacement", the genuinely
        // useful signal from the source analysis, computed correctly here
        // via team_position_depth's own available_count rather than a
        // fragile in-memory position count.
        injuryRows.push({
          team_id: teamId,
          injured_count: injured.length,
          total_importance_lost: Math.round(totalImportance * 10) / 10,
          goals_lost: goalsLost,
          assists_lost: assistsLost,
          no_replacement_positions: null, // filled in below via team_position_depth
          worst_absence_player_id: worst.player_id,
          worst_absence_importance: Math.round(worst.importance * 10) / 10,
          calculated_at: now,
        });
      }

      // Fill in no_replacement_positions from team_position_depth
      // (available_count === 0 at a position with player_count > 0).
      if (injuryRows.length > 0) {
        const posDepth = await fetchAllRows(
          db
            .from('team_position_depth')
            .select('team_id, position_code, available_count, player_count')
            .in('team_id', injuryRows.map(r => r.team_id))
        );
        const noReplMap = new Map<number, string[]>();
        for (const pd of posDepth ?? []) {
          if ((pd.player_count ?? 0) > 0 && (pd.available_count ?? 0) === 0) {
            if (!noReplMap.has(pd.team_id)) noReplMap.set(pd.team_id, []);
            noReplMap.get(pd.team_id)!.push(pd.position_code);
          }
        }
        for (const row of injuryRows) {
          const positions = noReplMap.get(row.team_id);
          row.no_replacement_positions = positions && positions.length > 0 ? positions.join(',') : null;
        }

        const { error: iiErr } = await db
          .from('team_injury_impact')
          .upsert(injuryRows, { onConflict: 'team_id' });
        if (iiErr) {
          logger.warn({ error: iiErr.message }, 'team_injury_impact upsert failed — continuing');
        } else {
          injuryImpactWritten = injuryRows.length;
        }
      }
    } catch (e: any) {
      logger.warn({ error: e.message }, 'team_injury_impact computation failed — continuing');
    }

    logger.info({ goalDepWritten, injuryImpactWritten }, 'goal dependency + injury impact written');

    return { playersProcessed: players.length, rowsWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processPlayerIntelligence failed');
    return { playersProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ─── DERIVED "LIKELY XI" — zero-API-cost predicted lineup ───────────────────

/**
 * Computes a predicted starting XI for upcoming matches — entirely DB-only,
 * zero API calls. No confirmed-lineups or predicted-lineups endpoint is
 * used anywhere in this design (neither fit the rate-limit budget — see
 * prior analysis). Instead:
 *
 *   1. Primary signal: player_season_statistics.matches_started — ranks
 *      players within each position bucket by how often they've actually
 *      started this season. This is a better signal than a single recent
 *      confirmed lineup, since it reflects the manager's pattern across
 *      the whole season, not one match's selection.
 *   2. Availability filter: excludes anyone with players.current_injury = true,
 *      or who transferred OUT of this team since the season-stats snapshot
 *      (player_transfers, to_team_id != this team, most recent transfer).
 *   3. Position bucketing: uses players.position (G/D/M/F) to group, then
 *      takes the top N per bucket based on a standard formation shape
 *      (1 GK, 4 DEF, 4 MID, 2 FWD — close enough for "likely XI" purposes;
 *      exact tactical formation isn't knowable without lineup data).
 *
 * confidence field: 0-100, derived from how decisively matches_started
 * separates this player from the next-best option at their position —
 * a player with 18 starts vs the next-best's 2 gets high confidence;
 * two players both around 8-10 starts each get lower confidence (genuine
 * rotation, less predictable).
 */
// ─── PREDICTED LINEUPS ───────────────────────────────────────────────────────

/**
 * Computes predicted starting XI for upcoming matches — entirely DB-only,
 * zero API calls.
 *
 * Ranking signals, in priority order: matches_started, appearances,
 * average rating (total_rating/count_rating), minutes_played. Excludes
 * players who are currently injured (current_injury flag, or an active
 * row in player_injuries with status 'out'/'doubtful' or an expected
 * return date), and players who've transferred to a different team since
 * their season-stats snapshot. Respects a fixed 1-4-4-2 formation.
 * Upserts (onConflict: match_id,player_id) after clearing any stale
 * lineup rows for the matches being processed.
 */
export async function processPredictedLineups(): Promise<{
  matchesProcessed: number;
  playersWritten: number;
  error?: string;
}> {
  logger.info('processPredictedLineups started — DB only, zero API calls');

  try {
    // ── 1. Get upcoming matches (next 7 days) ────────────────────────────
    const now = new Date().toISOString();
    const weekOut = new Date(Date.now() + 7 * 86400000).toISOString();

    const matches = await fetchAllRows(
      db
        .from('matches')
        .select('id, home_team_id, away_team_id, date')
        .eq('status', 'scheduled')
        .gte('date', now)
        .lte('date', weekOut)
    );

    if (!matches || matches.length === 0) {
      logger.info('No upcoming matches in next 7 days');
      return { matchesProcessed: 0, playersWritten: 0 };
    }

    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];
    logger.info({ matchCount: matches.length, teamCount: teamIds.length }, 'Processing predicted lineups');

    // ── 2. Get player season statistics (ranking signal) ──────────────────
    // Uses fetchAllRows because player_season_statistics has 10,000+ rows
    const seasonStats = await fetchAllRows(
      db.from('player_season_statistics')
        .select('player_id, team_id, season_external_id, matches_started, appearances, minutes_played, total_rating, count_rating, goals, assists')
        .in('team_id', teamIds)
    );

    if (seasonStats.length === 0) {
      logger.warn('No season statistics found for teams — run sync:player-stats first');
      return { matchesProcessed: 0, playersWritten: 0 };
    }

    // Build player stats map — one row per player, MOST RECENT SEASON ONLY.
    //
    // player_season_statistics upserts on (player_id, season_external_id) —
    // see syncSeasonStatistics.ts — meaning a player genuinely accumulates
    // a SEPARATE row per season as this platform covers more seasons over
    // time (not just one row that gets overwritten). An earlier version of
    // this function summed matches_started/minutes_played/etc. across
    // EVERY row returned per player with no season filter at all, which
    // would silently mix current-season form with stale prior-season
    // numbers once historical seasons started accumulating — inflating
    // matches_started and diluting avg_rating for anyone with more than
    // one season on record. Fixed to keep only the row with the highest
    // season_external_id per player, matching the "higher external_id =
    // more recent season" convention already used elsewhere in this
    // codebase (see resolveTeamSeasonContext in syncSeasonStatistics.ts).
    const statsMap = new Map<number, any>();
    for (const stat of seasonStats) {
      const existing = statsMap.get(stat.player_id);
      if (existing && existing.season_external_id >= (stat.season_external_id ?? 0)) {
        continue; // existing row is from an equal-or-more-recent season — keep it
      }
      statsMap.set(stat.player_id, {
        team_id: stat.team_id,
        season_external_id: stat.season_external_id ?? 0,
        matches_started: stat.matches_started || 0,
        appearances: stat.appearances || 0,
        minutes_played: stat.minutes_played || 0,
        total_rating: stat.total_rating || 0,
        count_rating: stat.count_rating || 0,
        goals: stat.goals || 0,
        assists: stat.assists || 0,
      });
    }

    // ── 3. Get players with position and injury status ────────────────────
    const players = await fetchAllRows(
      db.from('players')
        .select('id, team_id, position, current_injury, injury_status, injury_reason, injury_return_days')
        .in('team_id', teamIds)
    );

    const playerMap = new Map<number, any>();
    for (const p of players) {
      playerMap.set(p.id, p);
    }

    // ── 4. Get active injuries from player_injuries table ──────────────────
    // This gives us more detailed injury info than the current_injury boolean
    let injuries: any[] = [];
    try {
      injuries = await fetchAllRows(
      db
        .from('player_injuries')
        .select('player_id, injury_reason, injury_status, expected_return_days, days_out, injury_severity_score')
        .eq('active', true)
        .in('player_id', [...statsMap.keys()])
      );
    } catch (e: any) {
      logger.warn({ error: e.message }, 'Failed to fetch player_injuries — continuing degraded');
    }

    const injuryMap = new Map<number, any>();
    for (const inj of injuries || []) {
      injuryMap.set(inj.player_id, inj);
    }

    // ── 5. Get recent transfers to exclude players who left ────────────────
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);

    let transfers: any[] = [];
    try {
      transfers = await fetchAllRows(
        db
          .from('player_transfers')
          .select('player_id, to_team_id, from_team_id, transfer_date')
          .gte('transfer_date', yearAgo.toISOString().split('T')[0])
          .order('transfer_date', { ascending: false })
      );
    } catch (e: any) {
      logger.warn({ error: e.message }, 'Failed to fetch transfers — continuing degraded');
    }

    // Get latest team per player (if they transferred)
    const latestTeamMap = new Map<number, number>();
    for (const t of transfers || []) {
      if (t.to_team_id && !latestTeamMap.has(t.player_id)) {
        latestTeamMap.set(t.player_id, t.to_team_id);
      }
    }

    // ── 6. Build per-team ranked rosters by position ──────────────────────
    // Formation: 1 GK, 4 DEF, 4 MID, 2 FWD
    const FORMATION: Record<string, number> = { G: 1, D: 4, M: 4, F: 2 };
    const teamRosters = new Map<number, Map<string, any[]>>();

    for (const [playerId, stats] of statsMap) {
      const player = playerMap.get(playerId);
      if (!player) continue;

      // ── Check if player is available ──────────────────────────────────
      // 1. Exclude if current_injury is true
      if (player.current_injury) continue;

      // 2. Check active injuries table for detailed status
      const injury = injuryMap.get(playerId);
      if (injury) {
        // If injury_status is 'out' or 'doubtful', exclude
        if (injury.injury_status === 'out' || injury.injury_status === 'doubtful') {
          continue;
        }
        // If expected_return_days > 0 and match is within that window, exclude
        if (injury.expected_return_days && injury.expected_return_days > 0) {
          // Could check against match date, but safer to exclude if injured at all
          continue;
        }
      }

      // 3. Check if player transferred out since stats snapshot
      const latestTeam = latestTeamMap.get(playerId);
      if (latestTeam && latestTeam !== player.team_id) continue;
      if (latestTeam && latestTeam !== stats.team_id) continue;

      const pos = player.position || 'M'; // default bucket if unknown
      if (!teamRosters.has(stats.team_id)) {
        teamRosters.set(stats.team_id, new Map());
      }
      const posMap = teamRosters.get(stats.team_id)!;
      if (!posMap.has(pos)) posMap.set(pos, []);

      // Calculate average rating from total/count
      let avgRating = 0;
      if (stats.count_rating > 0 && stats.total_rating > 0) {
        avgRating = stats.total_rating / stats.count_rating;
      }

      posMap.get(pos)!.push({
        playerId: playerId,
        teamId: stats.team_id,
        matchesStarted: stats.matches_started || 0,
        appearances: stats.appearances || 0,
        minutesPlayed: stats.minutes_played || 0,
        avgRating: avgRating,
        totalRating: stats.total_rating || 0,
        countRating: stats.count_rating || 0,
        goals: stats.goals || 0,
        assists: stats.assists || 0,
        position: pos,
        injuryStatus: injury?.injury_status || null,
      });
    }

    // ── 7. Select starting XI for each match ──────────────────────────────
    const rows: any[] = [];

    for (const match of matches) {
      for (const teamId of [match.home_team_id, match.away_team_id]) {
        const posMap = teamRosters.get(teamId);
        if (!posMap) {
          logger.warn({ teamId, matchId: match.id }, 'No players found for team');
          continue;
        }

        for (const [pos, count] of Object.entries(FORMATION)) {
          // ── Rank players by multiple signals ──────────────────────────────
          // Primary: matches_started (who actually plays)
          // Secondary: appearances (fitness/reliability)
          // Tertiary: avg_rating (quality)
          // Quaternary: minutes_played (endurance/trust)
          const candidates = (posMap.get(pos) || [])
            .filter(c => c.matchesStarted > 0 || c.appearances > 0) // Only players who've played
            .sort((a, b) => {
              // 1. Matches started (most important)
              if (b.matchesStarted !== a.matchesStarted) {
                return b.matchesStarted - a.matchesStarted;
              }
              // 2. Appearances (reliability)
              if (b.appearances !== a.appearances) {
                return b.appearances - a.appearances;
              }
              // 3. Average rating (quality)
              if (b.avgRating !== a.avgRating) {
                return b.avgRating - a.avgRating;
              }
              // 4. Minutes played (endurance)
              return b.minutesPlayed - a.minutesPlayed;
            });

          const top = candidates.slice(0, count);

          top.forEach((c, index) => {
            const next = candidates[index + 1];

            // ── Calculate confidence ─────────────────────────────────────────
            // Factors:
            // 1. Starts gap vs next player (50% weight)
            // 2. Rating gap vs next player (20% weight)
            // 3. Appearance count (20% weight)
            // 4. Position-specific bonus (10% weight)

            const startsGap = next ? c.matchesStarted - next.matchesStarted : c.matchesStarted || 1;
            const ratingGap = next ? c.avgRating - next.avgRating : 0;
            const appearanceFactor = Math.min(1, c.appearances / 20);

            let confidence = 50;
            confidence += Math.min(40, startsGap * 4); // Starts gap: max +40
            confidence += Math.min(15, ratingGap * 3); // Rating gap: max +15
            confidence += appearanceFactor * 15; // Experience: max +15
            confidence += c.matchesStarted > 10 ? 10 : 0; // Established starter: +10

            // Position-specific adjustments
            if (pos === 'G' && c.matchesStarted > 5) {
              confidence += 5; // Keepers more stable
            } else if (pos === 'F' && index > 0) {
              confidence -= 5; // 2nd forward less certain
            }

            confidence = Math.min(100, Math.max(0, Math.round(confidence)));

            rows.push({
              match_id: match.id,
              team_id: teamId,
              player_id: c.playerId,
              position_code: pos,
              rank_in_position: index + 1,
              matches_started: c.matchesStarted,
              confidence: confidence / 100, // Store as 0-1 for consistency
              calculated_at: new Date().toISOString(),
            });
          });

          // ── Log if position has fewer players than needed ──────────────
          if (top.length < count) {
            logger.warn({
              teamId,
              position: pos,
              needed: count,
              available: top.length,
              matchId: match.id,
            }, 'Not enough players for position — formation may be incomplete');
          }
        }
      }
    }

    // ── 8. Batch upsert ────────────────────────────────────────────────────
    if (rows.length === 0) {
      logger.warn('No lineups generated — check player data and injury status');
      return { matchesProcessed: 0, playersWritten: 0 };
    }

    // Delete existing lineups for these matches (clean slate)
    const matchIds = [...new Set(rows.map((r: any) => r.match_id))];
    const { error: delErr } = await db
      .from('match_predicted_lineups')
      .delete()
      .in('match_id', matchIds);

    if (delErr) {
      logger.warn({ error: delErr.message }, 'Failed to delete existing lineups — continuing with upsert');
    }

    // Upsert in chunks
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('match_predicted_lineups')
        .upsert(chunk, { onConflict: 'match_id,player_id' });
      if (error) {
        logger.error({ error: error.message, chunk: i }, 'Failed to upsert lineups');
        throw error;
      }
      written += chunk.length;
    }

    // ── 9. Log summary ─────────────────────────────────────────────────────
    const matchesProcessed = new Set(rows.map((r: any) => r.match_id)).size;
    const teamsProcessed = new Set(rows.map((r: any) => r.team_id)).size;

    logger.info({
      matchesProcessed,
      teamsProcessed,
      playersWritten: written,
      totalLineups: rows.length,
      avgPerMatch: Math.round(rows.length / matchesProcessed),
    }, 'processPredictedLineups completed');

    return { matchesProcessed, playersWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'processPredictedLineups failed');
    return { matchesProcessed: 0, playersWritten: 0, error: error.message };
  }
}

// ─── LEAGUE INTELLIGENCE — precomputed per-tournament aggregates ────────────

/**
 * PRECOMPUTES per-tournament averages (readiness, form, congestion, travel,
 * rest days, active competitions) — previously computed live in the
 * browser on every Leagues Overview page load (getLeagueReadinessRankings()
 * in frontend/src/lib/queries.ts: three bulk queries + in-memory grouping/
 * averaging, recomputed fresh every time). Same architecture fix as
 * processMatchSignals() above — zero runtime calculations, frontend reads
 * only.
 *
 * Exact same join path as the original frontend logic: tournament_standings
 * is the only table linking teams to a specific tournament (team_intelligence
 * itself has no tournament_id) — see backend/docs/SCHEMA_GAP_ANALYSIS.md.
 *
 * Queries ALL tournaments in the DB rather than re-filtering by tracked
 * slug — the tournaments table itself is already curated to just the
 * tracked set (see migration 006_cleanup_untracked_data.sql), so an
 * additional slug filter here would be redundant with what the DB already
 * guarantees, unlike the frontend's belt-and-suspenders TRACKED_SLUGS
 * filter which existed partly to guard against un-migrated/stale data.
 */
export async function processLeagueIntelligence(): Promise<{
  tournamentsProcessed: number;
  error?: string;
}> {
  logger.info('processLeagueIntelligence started — DB only, zero API calls');

  try {
    const tournaments = await fetchAllRows(db.from('tournaments').select('id'));
    if (tournaments.length === 0) {
      logger.info('No tournaments found');
      return { tournamentsProcessed: 0 };
    }
    const tournamentIds = tournaments.map((t: any) => t.id);

    // Latest standings row per team per tournament — used purely for the
    // team_id -> tournament_id mapping, not the standings data itself.
    const standings = await fetchAllRows(
      db.from('tournament_standings').select('tournament_id, team_id').in('tournament_id', tournamentIds)
    );

    const teamIdsByTournament = new Map<number, Set<number>>();
    for (const s of standings) {
      if (!teamIdsByTournament.has(s.tournament_id)) teamIdsByTournament.set(s.tournament_id, new Set());
      teamIdsByTournament.get(s.tournament_id)!.add(s.team_id);
    }

    const allTeamIds = [...new Set(standings.map((s: any) => s.team_id))];

    const [teamIntel, travelLoad] = allTeamIds.length > 0
      ? await Promise.all([
          fetchAllRows(
            db.from('team_intelligence')
              .select('team_id, readiness_score, form_index, congestion_score, rest_days_avg, active_competitions')
              .in('team_id', allTeamIds)
          ),
          fetchAllRows(
            db.from('team_travel_load')
              .select('team_id, km_last_14_days, snapshot_date')
              .in('team_id', allTeamIds)
              .order('snapshot_date', { ascending: false })
          ),
        ])
      : [[], []];

    const intelMap = new Map<number, any>(teamIntel.map((t: any) => [t.team_id, t]));
    const travelMap = new Map<number, number>();
    for (const t of travelLoad) {
      if (!travelMap.has(t.team_id)) travelMap.set(t.team_id, t.km_last_14_days ?? 0);
    }

    const avg = (nums: (number | null | undefined)[]): number | null => {
      const valid = nums.filter((n): n is number => n != null);
      if (valid.length === 0) return null;
      return Math.round((valid.reduce((s, n) => s + n, 0) / valid.length) * 10) / 10;
    };

    const rows = tournaments.map((t: any) => {
      const teamIds = [...(teamIdsByTournament.get(t.id) ?? [])];
      const intels = teamIds.map(id => intelMap.get(id)).filter(Boolean);
      const travels = teamIds.map(id => travelMap.get(id));

      return {
        tournament_id: t.id,
        team_count: teamIds.length,
        avg_readiness: avg(intels.map((i: any) => i.readiness_score)),
        avg_form: avg(intels.map((i: any) => i.form_index)),
        avg_congestion: avg(intels.map((i: any) => i.congestion_score)),
        avg_travel_14d: avg(travels),
        avg_rest_days: avg(intels.map((i: any) => i.rest_days_avg)),
        avg_active_competitions: avg(intels.map((i: any) => i.active_competitions)),
        calculated_at: new Date().toISOString(),
      };
    });

    const { error } = await db.from('league_intelligence').upsert(rows, { onConflict: 'tournament_id' });
    logger.info({ tournamentsProcessed: rows.length }, 'processLeagueIntelligence completed');
    return { tournamentsProcessed: rows.length };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processLeagueIntelligence failed');
    return { tournamentsProcessed: 0, error: error.message };
  }
}

// ─── FIXTURE DIFFICULTY ──────────────────────────────────────────────────────

/**
 * Average opponent strength across each team's next 5/10 scheduled
 * matches — fully derivable from data already synced (team_strength_ratings
 * + matches), no new API calls. Higher score = harder run of fixtures.
 * Confirmed nothing computed this before.
 */
export async function processFixtureDifficulty(): Promise<{
  teamsProcessed: number;
  error?: string;
}> {
  logger.info('processFixtureDifficulty started — DB only, zero API calls');

  try {
    const now = new Date().toISOString();

    const upcomingMatches = await fetchAllRows(
      db.from('matches')
        .select('home_team_id, away_team_id, date')
        .eq('status', 'scheduled')
        .gte('date', now)
        .order('date', { ascending: true })
    );

    if (upcomingMatches.length === 0) {
      logger.info('No upcoming matches found');
      return { teamsProcessed: 0 };
    }

    const strengthRows = await fetchAllRows(
      db.from('team_strength_ratings').select('team_id, strength_score')
    );
    const strengthMap = new Map<number, number>(
      strengthRows.filter((r: any) => r.strength_score != null).map((r: any) => [r.team_id, r.strength_score])
    );

    // Build each team's ordered list of upcoming opponents.
    const opponentsByTeam = new Map<number, number[]>();
    for (const m of upcomingMatches) {
      if (m.home_team_id && m.away_team_id) {
        if (!opponentsByTeam.has(m.home_team_id)) opponentsByTeam.set(m.home_team_id, []);
        opponentsByTeam.get(m.home_team_id)!.push(m.away_team_id);
        if (!opponentsByTeam.has(m.away_team_id)) opponentsByTeam.set(m.away_team_id, []);
        opponentsByTeam.get(m.away_team_id)!.push(m.home_team_id);
      }
    }

    const avg = (nums: number[]): number | null =>
      nums.length > 0 ? Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10 : null;

    const rows: any[] = [];
    for (const [teamId, opponents] of opponentsByTeam) {
      const next5 = opponents.slice(0, 5).map(id => strengthMap.get(id)).filter((s): s is number => s != null);
      const next10 = opponents.slice(0, 10).map(id => strengthMap.get(id)).filter((s): s is number => s != null);

      rows.push({
        team_id: teamId,
        next_5_difficulty: avg(next5),
        next_10_difficulty: avg(next10),
        next_5_matches: Math.min(5, opponents.length),
        next_10_matches: Math.min(10, opponents.length),
        calculated_at: new Date().toISOString(),
      });
    }

    const { error } = await db.from('team_fixture_difficulty').upsert(rows, { onConflict: 'team_id' });
    logger.info({ teamsProcessed: rows.length }, 'processFixtureDifficulty completed');
    return { teamsProcessed: rows.length };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processFixtureDifficulty failed');
    return { teamsProcessed: 0, error: error.message };
  }
}

// ─── TEAM MOMENTUM ───────────────────────────────────────────────────────────

/**
 * Recent-vs-prior form trend — fully derivable from team_form_history
 * (already has per-match points + date), no new data needed. Positive
 * momentum_score = rising, negative = declining. Confirmed nothing
 * computed this before.
 */
export async function processTeamMomentum(): Promise<{
  teamsProcessed: number;
  error?: string;
}> {
  logger.info('processTeamMomentum started — DB only, zero API calls');

  try {
    const formRows = await fetchAllRows(
      db.from('team_form_history')
        .select('team_id, points, match_date')
        .order('match_date', { ascending: false })
    );

    if (formRows.length === 0) {
      logger.info('No form history found');
      return { teamsProcessed: 0 };
    }

    const byTeam = new Map<number, any[]>();
    for (const r of formRows) {
      if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
      byTeam.get(r.team_id)!.push(r);
    }

    const rows: any[] = [];
    for (const [teamId, matches] of byTeam) {
      // Already ordered most-recent-first from the query above.
      const last5 = matches.slice(0, 5);
      const prior5 = matches.slice(5, 10);

      if (last5.length === 0) continue;

      const last5Points = last5.reduce((s, m) => s + (m.points ?? 0), 0);
      const prior5Points = prior5.reduce((s, m) => s + (m.points ?? 0), 0);

      // Only meaningful once there's a full prior window to compare
      // against — with fewer than 5 prior matches, momentum is null
      // rather than a misleadingly confident number computed from a
      // partial (or empty) comparison window.
      const momentumScore = prior5.length === 5 ? last5Points - prior5Points : null;
      const trend = momentumScore == null ? null
        : momentumScore > 2 ? 'rising'
        : momentumScore < -2 ? 'declining'
        : 'stable';

      rows.push({
        team_id: teamId,
        momentum_score: momentumScore,
        last_5_points: last5Points,
        prior_5_points: prior5.length === 5 ? prior5Points : null,
        trend,
        calculated_at: new Date().toISOString(),
      });
    }

    const { error } = await db.from('team_momentum').upsert(rows, { onConflict: 'team_id' });
    logger.info({ teamsProcessed: rows.length }, 'processTeamMomentum completed');
    return { teamsProcessed: rows.length };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamMomentum failed');
    return { teamsProcessed: 0, error: error.message };
  }
}

// ─── PLATFORM DAILY SUMMARY — precomputed dashboard aggregates ─────────────

/**
 * Computes platform-wide aggregate stats once, server-side, for the
 * dashboard. CRITICAL REQUIREMENT: no calculations at frontend runtime —
 * the dashboard previously computed avg readiness via .reduce() over the
 * full rankings list on every page load. This processor computes it once;
 * the frontend only ever SELECTs platform_daily_summary and displays it.
 */
export async function processDashboardSummary(): Promise<{
  written: boolean;
  error?: string;
}> {
  logger.info('processDashboardSummary started — DB only');

  try {
    const today = new Date().toISOString().split('T')[0];
    // EXPLICIT UTC day boundary — NOT local-timezone midnight.
    // Match dates are stored as timestamptz (UTC). The previous version used
    // new Date().setHours(0,0,0,0), which computes midnight in whatever
    // timezone the process happens to run in, then converts to UTC for the
    // query. For a process running at UTC+3, a match at 23:00 UTC falls
    // AFTER that local day's UTC-converted window ends (20:59:59 UTC) —
    // it's already "tomorrow, 2am" locally — so it was silently excluded
    // even though it's unambiguously today in UTC terms, which is the only
    // timezone with no ambiguity for a global, multi-region platform.
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfDay   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    // ── Resolve currently-valid tracked tournament names ──────────────────
    // CRITICAL: do not trust the tournaments table's existing rows blindly.
    // It may still contain stale entries written before a trackedLeagues.ts
    // fix (e.g. the substring-matching bug that let 'MLS Next Pro',
    // 'Damallsvenskan', etc. through) — those rows don't get cleaned up
    // automatically just because the matcher was fixed; only a cleanup
    // migration physically removes them. Re-validating every tournament
    // row against the CURRENT matching rules here means this count stays
    // accurate even before that cleanup runs, and matches what the
    // frontend's getTrackedCompetitionNames() already does (it re-validates
    // the same way, which is why it correctly excluded leaked matches that
    // this function previously counted anyway — that mismatch is the bug
    // this fix resolves).
    const allTournaments = await fetchAllRows(
      db
        .from('tournaments')
        .select('name, slug, category')
    );

    const trackedNames = new Set(
      (allTournaments ?? [])
        .filter((t: any) =>
          (t.slug && isTrackedBySlug(t.slug, t.category)) ||
          isTrackedLeague(t.name, t.category)
        )
        .map((t: any) => t.name)
    );

    const todaysMatchesRaw = await fetchAllRows(
      db
        .from('matches')
        .select('id, competition')
        .gte('date', startOfDay.toISOString())
        .lte('date', endOfDay.toISOString())
    );

    const todaysMatches = (todaysMatchesRaw ?? []).filter((m: any) => trackedNames.has(m.competition));

    const matchesToday = todaysMatches.length;
    const competitionsToday = new Set(todaysMatches.map((m: any) => m.competition)).size;

    // competitionsTracked: count only tournaments that re-validate against
    // current rules (trackedNames was built from this same revalidation
    // above) — NOT a raw row count, which would include any stale leaked
    // rows still physically present until a cleanup migration runs.
    const competitionsTracked = trackedNames.size;

    // teamsTracked: count distinct teams that appear in at least one
    // tracked-competition match — same logic, avoids counting teams that
    // only ever appeared in a now-excluded leaked competition.
    const allMatchesForTeams = await fetchAllRows(
      db
        .from('matches')
        .select('home_team_id, away_team_id, competition')
    );
    const trackedTeamIds = new Set<number>();
    for (const m of allMatchesForTeams ?? []) {
      if (!trackedNames.has(m.competition)) continue;
      if (m.home_team_id) trackedTeamIds.add(m.home_team_id);
      if (m.away_team_id) trackedTeamIds.add(m.away_team_id);
    }
    const teamsTracked = trackedTeamIds.size;

    const readinessRows = await fetchAllRows(
      db
        .from('team_intelligence')
        .select('readiness_score')
        .not('readiness_score', 'is', null)
    );

    const readinessCalculatedCount = readinessRows?.length ?? 0;
    const avgReadiness = readinessCalculatedCount > 0
      ? Math.round(
          (readinessRows ?? []).reduce((s: number, r: any) => s + (r.readiness_score ?? 0), 0) / readinessCalculatedCount
        )
      : null;

    const { data: lastSync } = await db
      .from('team_intelligence')
      .select('calculated_at')
      .order('calculated_at', { ascending: false })
      .limit(1)
      .single();

    const { error } = await db.from('platform_daily_summary').upsert({
      summary_date:                today,
      matches_today:                matchesToday,
      competitions_today:           competitionsToday,
      teams_tracked:                teamsTracked ?? 0,
      competitions_tracked:         competitionsTracked ?? 0,
      readiness_calculated_count:   readinessCalculatedCount,
      avg_readiness:                avgReadiness,
      last_sync_at:                 lastSync?.calculated_at ?? null,
      calculated_at:                new Date().toISOString(),
    }, { onConflict: 'summary_date' });

    if (error) throw new Error(error.message);

    logger.info({ matchesToday, teamsTracked, avgReadiness }, 'processDashboardSummary completed');
    return { written: true };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processDashboardSummary failed');
    return { written: false, error: error.message };
  }
}

// ─── MATCH SIGNALS — precomputed betting signals ─────────────────────────────

/**
 * PRECOMPUTES betting signals — previously computeMatchSignals() (see
 * lib/signalLogic.ts, an exact port of the old frontend-only
 * lib/signals.ts) ran fresh in the browser on every match/betting page
 * load, with no backend job and nothing persisted. That violated this
 * project's own core principle (zero runtime calculations, frontend
 * reads only), and meant there was no way to ever check whether a
 * signal was "right" after the fact — a live-computed, thrown-away-on-
 * every-load signal has nothing to check accuracy against later.
 *
 * Mirrors the exact input-building logic the frontend match page used —
 * match_intelligence (per-match, spec-authoritative) as primary source,
 * falling back to team_intelligence (team baseline) for any field
 * match_intelligence hasn't computed yet for this specific match. Same
 * "match_intelligence lags behind matches.id" pattern used elsewhere in
 * this codebase.
 *
 * The frontend's lib/signals.ts (computeMatchSignals + its own input-
 * building code) is UNCHANGED and still exists — it now serves as a
 * live-compute fallback for any match that doesn't have a precomputed
 * row yet, so nothing regresses for freshly-synced matches waiting on
 * their first process:match-signals run.
 */
export async function processMatchSignals(): Promise<{
  matchesProcessed: number;
  signalsWritten: number;
  error?: string;
}> {
  logger.info('processMatchSignals started — DB only, zero API calls');

  try {
    const now = new Date().toISOString();
    const twoWeeksOut = new Date(Date.now() + 14 * 86400000).toISOString();

    const matches = await fetchAllRows(
      db.from('matches')
        .select('id, home_team_id, away_team_id')
        .eq('status', 'scheduled')
        .gte('date', now)
        .lte('date', twoWeeksOut)
    );

    if (matches.length === 0) {
      logger.info('No upcoming matches in next 14 days');
      return { matchesProcessed: 0, signalsWritten: 0 };
    }

    const matchIds = matches.map((m: any) => m.id);
    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    const [matchIntelRows, teamIntelRows, travelRows] = await Promise.all([
      fetchAllRows(
        db.from('match_intelligence')
          .select('match_id, home_readiness, away_readiness, readiness_gap, congestion_factor, home_rest_days, away_rest_days, home_travel_distance_km, away_travel_distance_km, home_active_competitions, away_active_competitions')
          .in('match_id', matchIds)
      ),
      fetchAllRows(
        db.from('team_intelligence')
          .select('team_id, readiness_score, form_index, congestion_score, travel_fatigue_score, last_5_points, active_competitions, rest_days_avg, squad_depth_score, injury_burden_score, squad_stability_score')
          .in('team_id', teamIds)
      ),
      fetchAllRows(
        db.from('match_travel_intelligence')
          .select('match_id, travel_advantage_km')
          .in('match_id', matchIds)
      ),
    ]);

    const matchIntelMap = new Map<number, any>(matchIntelRows.map((r: any) => [r.match_id, r]));
    const teamIntelMap = new Map<number, any>(teamIntelRows.map((r: any) => [r.team_id, r]));
    const travelMap = new Map<number, any>(travelRows.map((r: any) => [r.match_id, r]));

    const allRows: any[] = [];

    for (const match of matches) {
      const intel = matchIntelMap.get(match.id);
      const homeIntel = teamIntelMap.get(match.home_team_id);
      const awayIntel = teamIntelMap.get(match.away_team_id);
      const travel = travelMap.get(match.id);

      const homeReadinessAny = intel?.home_readiness ?? homeIntel?.readiness_score ?? null;
      const awayReadinessAny = intel?.away_readiness ?? awayIntel?.readiness_score ?? null;

      // Same gate the frontend used — need at least a baseline readiness
      // on both sides before signals are meaningful at all.
      if (homeReadinessAny == null || awayReadinessAny == null) continue;

      const input: MatchSignalInput = {
        home_readiness: homeReadinessAny,
        away_readiness: awayReadinessAny,
        readiness_gap: intel?.readiness_gap ?? (homeReadinessAny - awayReadinessAny),
        congestion_factor: intel?.congestion_factor ??
          ((homeIntel?.congestion_score != null && awayIntel?.congestion_score != null)
            ? (homeIntel.congestion_score + awayIntel.congestion_score) / 2
            : null),
        home_rest_days: intel?.home_rest_days ?? homeIntel?.rest_days_avg,
        away_rest_days: intel?.away_rest_days ?? awayIntel?.rest_days_avg,
        home_travel_distance_km: intel?.home_travel_distance_km,
        away_travel_distance_km: intel?.away_travel_distance_km,
        home_active_competitions: intel?.home_active_competitions ?? homeIntel?.active_competitions,
        away_active_competitions: intel?.away_active_competitions ?? awayIntel?.active_competitions,
        home_form_index: homeIntel?.form_index,
        away_form_index: awayIntel?.form_index,
        home_travel_fatigue: homeIntel?.travel_fatigue_score,
        away_travel_fatigue: awayIntel?.travel_fatigue_score,
        home_congestion: homeIntel?.congestion_score,
        away_congestion: awayIntel?.congestion_score,
        home_last_5_pts: homeIntel?.last_5_points,
        away_last_5_pts: awayIntel?.last_5_points,
        travel_advantage_km: travel?.travel_advantage_km,
        home_squad_depth: homeIntel?.squad_depth_score,
        away_squad_depth: awayIntel?.squad_depth_score,
        home_injury_burden: homeIntel?.injury_burden_score,
        away_injury_burden: awayIntel?.injury_burden_score,
        home_squad_stability: homeIntel?.squad_stability_score,
        away_squad_stability: awayIntel?.squad_stability_score,
      };

      const signals = computeMatchSignals(input);
      for (const s of signals) {
        allRows.push({
          match_id: match.id,
          market: s.market,
          signal_group: s.group,
          signal_text: s.signal,
          direction: s.direction,
          strength: s.strength,
          drivers: s.drivers,
          data_source: s.dataSource ?? null,
          locked: s.locked ?? false,
          calculated_at: new Date().toISOString(),
        });
      }
    }

    if (allRows.length === 0) {
      logger.info('No matches had enough data for signals yet');
      return { matchesProcessed: 0, signalsWritten: 0 };
    }

    // Delete-then-upsert, same pattern as processPredictedLineups — clears
    // stale signals for these matches before writing the fresh set, so a
    // market that no longer fires (e.g. a signal that used to show but
    // conditions changed) doesn't linger.
    const processedMatchIds = [...new Set(allRows.map((r: any) => r.match_id))];
    const { error: delErr } = await db
      .from('match_signals')
      .delete()
      .in('match_id', processedMatchIds);
    if (delErr) {
      logger.warn({ error: delErr.message }, 'Failed to delete stale match_signals — continuing with upsert');
    }

    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < allRows.length; i += chunkSize) {
      const chunk = allRows.slice(i, i + chunkSize);
      const { error } = await db
        .from('match_signals')
        .upsert(chunk, { onConflict: 'match_id,market' });
      written += chunk.length;
    }

    logger.info(
      { matchesProcessed: processedMatchIds.length, signalsWritten: written },
      'processMatchSignals completed'
    );
    return { matchesProcessed: processedMatchIds.length, signalsWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processMatchSignals failed');
    return { matchesProcessed: 0, signalsWritten: 0, error: error.message };
  }
}

// ─── SCORELINE PREDICTIONS — Poisson goal model ─────────────────────────────

/**
 * Computes expected goals and likely scorelines for upcoming matches —
 * DB-only, zero API calls. Uses an INDEPENDENT POISSON model: the standard,
 * transparent baseline approach for correct-score markets.
 *
 *   λ_home (expected home goals) = avg(home team's own scoring rate,
 *                                       away team's own conceding rate) × 1.10
 *   λ_away (expected away goals) = avg(away team's own scoring rate,
 *                                       home team's own conceding rate) × 0.95
 *
 * The ×1.10 / ×0.95 factors are a standard simplified home-advantage
 * adjustment (real models would split scoring rate by home/away venue
 * specifically, which would need more granular data than team_form_history
 * currently captures — this is the honest, documented approximation).
 *
 * Each scoreline's probability = Poisson(home_goals; λ_home) ×
 * Poisson(away_goals; λ_away), assuming independence (the standard
 * simplifying assumption for a basic model — real markets see slight
 * negative correlation in low-scoring games, which this doesn't capture).
 * Top 6 scorelines by probability are kept, renormalized to sum ~100%.
 *
 * Inputs: team_form_history.goals_for/goals_against — last 10 matches per
 * team, already populated, no new sync required.
 */
export async function processScorelinePredictions(): Promise<{
  matchesProcessed: number;
  rowsWritten: number;
  error?: string;
}> {
  logger.info('processScorelinePredictions started — DB only, Poisson goal model');

  try {
    // Only upcoming (scheduled) matches within the next 7 days — same
    // window as predicted lineups, no value in predicting scorelines for
    // matches far in the future.
    const now = new Date().toISOString();
    const weekOut = new Date(Date.now() + 7 * 86400000).toISOString();

    const matches = await fetchAllRows(
      db
        .from('matches')
        .select('id, home_team_id, away_team_id, date, competition')
        .eq('status', 'scheduled')
        .gte('date', now)
        .lte('date', weekOut)
    );

    if (!matches || matches.length === 0) {
      return { matchesProcessed: 0, rowsWritten: 0 };
    }

    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];
    const competitions = [...new Set(matches.map((m: any) => m.competition).filter(Boolean))];

    // Last 10 form-history rows per team, most recent first
    // BETA FIX (audit P0): was a raw read silently capped at 1000 rows —
    // teams without recent fixtures got short/empty goal histories, so
    // Poisson scoreline predictions were built from partial attack/defence
    // averages with no error anywhere.
    const formRows = await fetchAllRows(
      db.from('team_form_history')
        .select('team_id, goals_for, goals_against, match_date')
        .in('team_id', teamIds)
        .order('match_date', { ascending: false })
    );

    const byTeam = new Map<number, { for: number[]; against: number[] }>();
    for (const r of formRows ?? []) {
      if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, { for: [], against: [] });
      const entry = byTeam.get(r.team_id)!;
      if (entry.for.length < 10) {
        entry.for.push(r.goals_for ?? 0);
        entry.against.push(r.goals_against ?? 0);
      }
    }

    const avg = (arr: number[]): number | null =>
      arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    // ── League average scoring rates — the shrinkage prior ────────────────
    // For each competition featuring in this run's matches, compute the
    // average home goals and away goals from ALL finished results in that
    // competition. Teams with few form history rows are then pulled toward
    // the league mean rather than relying on a 2-3 game sample. Also
    // allows generating a prediction for teams with zero form history
    // (previously hard-skipped) by using league averages as the sole input.
    //
    // Minimum 5 finished games in a competition before using its average
    // as a prior — below that threshold the league rate itself is noise.
    //
    // Fetch only competitions present in this run's match set.
    const MIN_LEAGUE_GAMES = 5;
    const leagueAvgByComp = new Map<string, { homeGoals: number; awayGoals: number }>();

    if (competitions.length > 0) {
      const finishedRows = await fetchAllRows(
        db
          .from('matches')
          .select('competition, match_results!inner(home_score, away_score)')
          .in('competition', competitions)
          .not('competition', 'is', null)
      );

      const compBuckets = new Map<string, { home: number[]; away: number[] }>();
      for (const row of finishedRows ?? []) {
        if (!row.competition) continue;
        // PostgREST embeds UNIQUE FK as object; defensively handle array too
        const res: any = Array.isArray(row.match_results) ? row.match_results[0] : row.match_results;
        if (!res || res.home_score == null || res.away_score == null) continue;
        if (!compBuckets.has(row.competition)) compBuckets.set(row.competition, { home: [], away: [] });
        compBuckets.get(row.competition)!.home.push(res.home_score);
        compBuckets.get(row.competition)!.away.push(res.away_score);
      }
      for (const [comp, data] of compBuckets) {
        if (data.home.length < MIN_LEAGUE_GAMES) continue;
        leagueAvgByComp.set(comp, {
          homeGoals: data.home.reduce((s, v) => s + v, 0) / data.home.length,
          awayGoals: data.away.reduce((s, v) => s + v, 0) / data.away.length,
        });
      }
      logger.debug({ competitions: [...leagueAvgByComp.keys()].length }, 'League average rates computed');
    }

    // Poisson PMF: P(X = k) = (λ^k × e^-λ) / k!
    function poissonPMF(k: number, lambda: number): number {
      let factorial = 1;
      for (let i = 2; i <= k; i++) factorial *= i;
      return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial;
    }

    const MAX_GOALS = 6; // cap the scoreline grid — beyond 6-6 is noise, not signal
    const rows: any[] = [];

    for (const m of matches) {
      const homeStats = byTeam.get(m.home_team_id);
      const awayStats = byTeam.get(m.away_team_id);

      const homeScoringRate  = homeStats ? avg(homeStats.for)     : null;
      const homeConcedeRate  = homeStats ? avg(homeStats.against) : null;
      const awayScoringRate  = awayStats ? avg(awayStats.for)     : null;
      const awayConcedeRate  = awayStats ? avg(awayStats.against) : null;

      // League prior: home team's competition average rates (if available)
      const leagueStats = m.competition ? leagueAvgByComp.get(m.competition) : null;

      // Shrinkage weights: team form × 0.70, league average × 0.30.
      // When team form data is absent (new team, no results yet), fall back
      // to the league average as the sole input rather than hard-skipping.
      // When league data is also absent, skip — we can't generate a
      // prediction without at least one signal.
      const TEAM_W = 0.70, LEAGUE_W = 0.30;
      const blend = (teamRate: number | null, leagueRate: number | null): number | null => {
        if (teamRate != null && leagueRate != null) return teamRate * TEAM_W + leagueRate * LEAGUE_W;
        if (teamRate != null) return teamRate;   // team-only (no league data)
        if (leagueRate != null) return leagueRate; // league-only fallback
        return null;
      };

      // lambdaHome: blended home scoring vs blended away defensive vulnerability
      // lambdaAway: blended away scoring vs blended home defensive vulnerability
      // League rates: homeGoals ≈ avg home team scoring ≈ avg away team conceding
      //               awayGoals ≈ avg away team scoring ≈ avg home team conceding
      const effHomeScoring = blend(homeScoringRate, leagueStats?.homeGoals ?? null);
      const effHomeConcede = blend(homeConcedeRate, leagueStats?.awayGoals ?? null);
      const effAwayScoring = blend(awayScoringRate, leagueStats?.awayGoals ?? null);
      const effAwayConcede = blend(awayConcedeRate, leagueStats?.homeGoals ?? null);

      if (effHomeScoring == null || effHomeConcede == null || effAwayScoring == null || effAwayConcede == null) {
        continue;
      }

      const lambdaHome = ((effHomeScoring + effAwayConcede) / 2) * 1.10;
      const lambdaAway = ((effAwayScoring + effHomeConcede) / 2) * 0.95;

      // Build full probability grid, then keep top 6
      const grid: { home: number; away: number; probability: number }[] = [];
      for (let h = 0; h <= MAX_GOALS; h++) {
        for (let a = 0; a <= MAX_GOALS; a++) {
          const p = poissonPMF(h, lambdaHome) * poissonPMF(a, lambdaAway);
          grid.push({ home: h, away: a, probability: p });
        }
      }

      // ── Real Win/Draw/Away probability — summed from the FULL grid
      // BEFORE truncating to top-6. The top-6-renormalized set (below)
      // covers only ~6 of 49 cells and was never a sound basis for a
      // W/D/L split — this sums every cell in the grid the model already
      // computes, so it's grounded in the same Poisson model with no new
      // assumptions, not a fabricated "confidence" number. Cap at
      // MAX_GOALS=6 per side means a vanishingly small residual
      // probability mass beyond 6-6 is implicitly excluded — negligible
      // for realistic scoring rates, not worth the added complexity of
      // an analytic tail correction.
      let pHomeWin = 0, pDraw = 0, pAwayWin = 0;
      for (const cell of grid) {
        if (cell.home > cell.away) pHomeWin += cell.probability;
        else if (cell.home === cell.away) pDraw += cell.probability;
        else pAwayWin += cell.probability;
      }
      const wdlTotal = pHomeWin + pDraw + pAwayWin;
      const winProbHome = wdlTotal > 0 ? Math.round((pHomeWin / wdlTotal) * 1000) / 10 : null;
      const winProbDraw = wdlTotal > 0 ? Math.round((pDraw / wdlTotal) * 1000) / 10 : null;
      const winProbAway = wdlTotal > 0 ? Math.round((pAwayWin / wdlTotal) * 1000) / 10 : null;

      grid.sort((x, y) => y.probability - x.probability);
      const top6 = grid.slice(0, 6);
      const top6Sum = top6.reduce((s, g) => s + g.probability, 0);
      const normalized = top6.map(g => ({
        home: g.home,
        away: g.away,
        probability: top6Sum > 0 ? Math.round((g.probability / top6Sum) * 1000) / 10 : 0,
      }));

      rows.push({
        match_id: m.id,
        predicted_home_goals: Math.round(lambdaHome * 100) / 100,
        predicted_away_goals: Math.round(lambdaAway * 100) / 100,
        predicted_scorelines: normalized,
        win_probability_home: winProbHome,
        win_probability_draw: winProbDraw,
        win_probability_away: winProbAway,
        updated_at: new Date().toISOString(),
      });
    }

    // Upsert, not update — a plain UPDATE would silently affect zero rows
    // for any match that doesn't have a match_intelligence row yet (the
    // exact backlog gap diagnosed earlier: new matches sync continuously,
    // process:match-intelligence only catches up when explicitly run).
    // match_intelligence has no NOT NULL constraints besides match_id, so
    // creating a sparse row here (just these 3 columns) is safe — a later
    // process:match-intelligence run fills in the rest via its own upsert
    // on the same match_id.
    let written = 0;
    for (const row of rows) {
      const { error } = await db
        .from('match_intelligence')
        .upsert({
          match_id: row.match_id,
          predicted_home_goals: row.predicted_home_goals,
          predicted_away_goals: row.predicted_away_goals,
          predicted_scorelines: row.predicted_scorelines,
          updated_at: row.updated_at,
        }, { onConflict: 'match_id' });
      if (!error) written++;
      else logger.error({ matchId: row.match_id, error: error.message }, 'Scoreline upsert failed');
    }

    logger.info({ matchesProcessed: matches.length, rowsWritten: written, skipped: matches.length - rows.length }, 'processScorelinePredictions completed');
    return { matchesProcessed: matches.length, rowsWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processScorelinePredictions failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ─── NET BATTLE SUPERIORITY INDEX (NBSI) ────────────────────────────────────
// A single, informational number summarizing how far apart two teams are
// across every tracked comparison category, on a genuinely comparable
// scale. See migration 022 for the full methodology rationale.
//
// Deliberately NOT hand-picked category weights — every category is
// z-scored against the REAL current population of tracked teams (real
// mean/stddev, queried from the DB), then averaged with equal weight.
// No verdict, no classification label — a number, nothing more.

interface NBSICategory {
  key: string;
  table: string;
  column: string;
  lowerIsBetter: boolean;
  // 'team' = one row per team_id (population = all teams' current value)
  // 'match' = one row per match (population = all currently-relevant match_intelligence rows)
  scope: 'team' | 'match';
}

const NBSI_CATEGORIES: NBSICategory[] = [
  { key: 'readiness',       table: 'team_intelligence',        column: 'readiness_score',        lowerIsBetter: false, scope: 'team' },
  { key: 'form_index',      table: 'team_intelligence',        column: 'form_index',              lowerIsBetter: false, scope: 'team' },
  { key: 'congestion',      table: 'team_intelligence',        column: 'congestion_score',        lowerIsBetter: true,  scope: 'team' },
  { key: 'squad_stability', table: 'team_intelligence',        column: 'squad_stability_score',   lowerIsBetter: false, scope: 'team' },
  { key: 'squad_depth',     table: 'team_intelligence',        column: 'squad_depth_score',       lowerIsBetter: false, scope: 'team' },
  { key: 'versatility',     table: 'team_intelligence',        column: 'lineup_versatility_score',lowerIsBetter: false, scope: 'team' },
  { key: 'strength',        table: 'team_strength_ratings',    column: 'strength_score',          lowerIsBetter: false, scope: 'team' },
  { key: 'venue_advantage', table: 'team_venue_performance',   column: 'venue_advantage_score',   lowerIsBetter: false, scope: 'team' },
  { key: 'goals_scored',    table: 'team_season_statistics',   column: 'goals_scored',            lowerIsBetter: false, scope: 'team' },
  { key: 'goals_conceded',  table: 'team_season_statistics',   column: 'goals_conceded',          lowerIsBetter: true,  scope: 'team' },
  { key: 'injury_impact',   table: 'team_injury_impact',       column: 'total_importance_lost',   lowerIsBetter: true,  scope: 'team' },
];

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function stddev(arr: number[], m: number): number {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

export async function processNetBattleIndex(): Promise<{
  matchesProcessed: number;
  rowsWritten: number;
  categoriesUsed: number;
  error?: string;
}> {
  logger.info('processNetBattleIndex started — z-score population normalization, no hand-picked weights');

  try {
    // ── Step 1: real population stats per team-level category ─────────────
    // One query per category table, computing real mean/stddev from every
    // team currently carrying a non-null value. Categories with fewer than
    // 5 teams of population data are excluded — a mean/stddev from 2-3
    // teams is noise, not a population.
    const MIN_POPULATION = 5;
    const popStats = new Map<string, { mean: number; stddev: number }>();
    const teamValuesByCategory = new Map<string, Map<number, number>>();

    for (const cat of NBSI_CATEGORIES) {
      if (cat.scope !== 'team') continue;
      let data: any[] = [];
      try {
        data = await fetchAllRows(
        db
          .from(cat.table)
          .select(`team_id, ${cat.column}`)
          .not(cat.column, 'is', null)
        );
      } catch (e: any) {
        logger.warn({ category: cat.key, err: e.message }, 'NBSI population query failed — category skipped');
        continue;
      }
      const rows = (data ?? []) as any[];
      const values = rows.map(r => Number(r[cat.column])).filter(v => !Number.isNaN(v));
      if (values.length < MIN_POPULATION) {
        logger.debug({ category: cat.key, n: values.length }, 'NBSI category below minimum population — skipped');
        continue;
      }
      const m = mean(values);
      const sd = stddev(values, m);
      if (sd === 0) continue; // no variance = z-score undefined, skip
      popStats.set(cat.key, { mean: m, stddev: sd });

      const byTeam = new Map<number, number>();
      for (const r of rows) {
        const v = Number(r[cat.column]);
        if (!Number.isNaN(v)) byTeam.set(r.team_id, v);
      }
      teamValuesByCategory.set(cat.key, byTeam);
    }

    logger.info({ categoriesWithPopulation: [...popStats.keys()] }, 'NBSI population stats computed');

    // ── Step 2: match-level category (Predicted Goals) population ─────────
    // Predicted goals are per-match, not a team baseline — population is
    // every currently-populated predicted_home_goals/predicted_away_goals
    // value across match_intelligence, treated as one pooled distribution
    // (home and away predictions pooled together, since both represent
    // "a team's predicted goals in a match", just from different sides).
    const predGoalRows = await fetchAllRows(
      db
        .from('match_intelligence')
        .select('predicted_home_goals, predicted_away_goals')
        .not('predicted_home_goals', 'is', null)
        .not('predicted_away_goals', 'is', null)
    );
    const pooledPredGoals: number[] = [];
    for (const r of predGoalRows ?? []) {
      pooledPredGoals.push(Number(r.predicted_home_goals), Number(r.predicted_away_goals));
    }
    let predGoalsStats: { mean: number; stddev: number } | null = null;
    if (pooledPredGoals.length >= MIN_POPULATION) {
      const m = mean(pooledPredGoals);
      const sd = stddev(pooledPredGoals, m);
      if (sd > 0) predGoalsStats = { mean: m, stddev: sd };
    }

    // ── Step 3: upcoming matches (same 7-day window as scoreline predictions) ─
    const now = new Date().toISOString();
    const weekOut = new Date(Date.now() + 7 * 86400000).toISOString();
    const matches = await fetchAllRows(
      db
        .from('matches')
        .select('id, home_team_id, away_team_id, date')
        .eq('status', 'scheduled')
        .gte('date', now)
        .lte('date', weekOut)
    );
    if (!matches || matches.length === 0) {
      return { matchesProcessed: 0, rowsWritten: 0, categoriesUsed: popStats.size };
    }

    // Predicted goals per match (already computed by processScorelinePredictions)
    const matchIds = matches.map((m: any) => m.id);
    const miRows = await fetchAllRows(
      db
        .from('match_intelligence')
        .select('match_id, predicted_home_goals, predicted_away_goals')
        .in('match_id', matchIds)
    );
    const predGoalsByMatch = new Map<number, { home: number | null; away: number | null }>();
    for (const r of miRows ?? []) {
      predGoalsByMatch.set(r.match_id, { home: r.predicted_home_goals, away: r.predicted_away_goals });
    }

    // ── Step 4: compute NBSI per match ─────────────────────────────────────
    let written = 0;
    for (const match of matches) {
      const zDiffs: number[] = [];

      for (const cat of NBSI_CATEGORIES) {
        if (cat.scope !== 'team') continue;
        const stats = popStats.get(cat.key);
        const byTeam = teamValuesByCategory.get(cat.key);
        if (!stats || !byTeam) continue;
        const homeVal = byTeam.get(match.home_team_id);
        const awayVal = byTeam.get(match.away_team_id);
        if (homeVal == null || awayVal == null) continue;

        let zHome = (homeVal - stats.mean) / stats.stddev;
        let zAway = (awayVal - stats.mean) / stats.stddev;
        if (cat.lowerIsBetter) { zHome = -zHome; zAway = -zAway; }
        zDiffs.push(zHome - zAway);
      }

      // Predicted Goals — match-level category
      if (predGoalsStats) {
        const pg = predGoalsByMatch.get(match.id);
        if (pg?.home != null && pg?.away != null) {
          const zHome = (pg.home - predGoalsStats.mean) / predGoalsStats.stddev;
          const zAway = (pg.away - predGoalsStats.mean) / predGoalsStats.stddev;
          zDiffs.push(zHome - zAway);
        }
      }

      if (zDiffs.length === 0) continue; // no comparable data at all — skip, don't write a fabricated 0

      const netBattleIndex = Math.round((zDiffs.reduce((s, v) => s + v, 0) / zDiffs.length) * 100) / 100;

      // Upsert, not update — a plain UPDATE would silently affect zero rows
      // for any match without an existing match_intelligence row yet (same
      // documented gap processScorelinePredictions already fixed above).
      const { error: updErr } = await db
        .from('match_intelligence')
        .upsert({
          match_id: match.id,
          net_battle_index: netBattleIndex,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'match_id' });

      if (updErr) {
        logger.warn({ matchId: match.id, err: updErr.message }, 'NBSI write failed');
        continue;
      }
      written++;
    }

    logger.info({ matchesProcessed: matches.length, written, categoriesUsed: popStats.size }, 'processNetBattleIndex completed');
    return { matchesProcessed: matches.length, rowsWritten: written, categoriesUsed: popStats.size };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processNetBattleIndex failed');
    return { matchesProcessed: 0, rowsWritten: 0, categoriesUsed: 0, error: error.message };
  }
}
