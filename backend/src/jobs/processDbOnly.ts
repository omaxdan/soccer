import { db } from '../db/client';
import { logger } from '../utils/logger';
import { isTrackedBySlug, isTrackedLeague } from '../config/trackedLeagues';

/**
 * Fetches ALL rows from a Supabase query, paginating past the server's
 * silent row cap.
 *
 * WHY THIS EXISTS: Supabase/PostgREST caps rows returned per request at its
 * server-side max_rows setting (default 1000) — REGARDLESS of what range
 * you request. `.range(0, 99999)` does NOT return 100k rows; it returns the
 * first 1000, with no error or warning. A naive "if returned.length < my
 * requested page size, stop" loop breaks silently in that case, since a
 * huge requested page size makes that condition always true — it exits
 * after exactly one page no matter how much data actually exists.
 *
 * This helper avoids that entirely: it always requests in chunks of
 * PAGE_SIZE (matching the real server cap) and only stops when a page
 * comes back SHORTER than PAGE_SIZE — the only reliable end-of-data signal.
 *
 * Usage:
 *   const players = await fetchAllRows(db.from('players')
 *     .select('team_id, market_value, current_injury'));
 *
 *   // With existing filters/order — chain them BEFORE passing in:
 *   const rows = await fetchAllRows(
 *     db.from('team_form_history').select('team_id, points').in('team_id', ids)
 *   );
 */
async function fetchAllRows<T = any>(
  queryBuilder: any,
  pageSize = 1000
): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await queryBuilder.range(from, to);
    if (error) throw new Error(`Paginated query failed at page ${page}: ${error.message}`);
    if (!data || data.length === 0) { hasMore = false; break; }
    all = all.concat(data);
    if (data.length < pageSize) hasMore = false;
    page++;
  }
  return all;
}

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
    const { data: allMatches, error: mErr } = await db
      .from('matches')
      .select('id, home_team_id, away_team_id, date, status')
      .gte('date', ago30)
      .lte('date', next14)
      .order('date', { ascending: true });

    if (mErr) throw new Error(`matches query: ${mErr.message}`);
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

      // ── Congestion score per spec formula (NOT a custom weighted blend) ──
      // Spec: match count in 14-day window → fixed lookup table, then
      // subtract a competition-load penalty based on active_competitions.
      // We use matches_next_14_days as the window — this is the
      // forward-looking fixture load that actually predicts fatigue going
      // into a team's NEXT match, which is what congestion is meant to warn about.
      const matchCountForCongestion = nextMatches14;

      let baseCongestionScore: number;
      if      (matchCountForCongestion <= 1) baseCongestionScore = 100;
      else if (matchCountForCongestion === 2) baseCongestionScore = 90;
      else if (matchCountForCongestion === 3) baseCongestionScore = 75;
      else if (matchCountForCongestion === 4) baseCongestionScore = 60;
      else if (matchCountForCongestion === 5) baseCongestionScore = 40;
      else                                     baseCongestionScore = 20; // 6+

      // Competition penalty — filled in by caller using teamCompetitionCounts
      // (passed in via closure below); placeholder here, real value applied
      // after the competitions map is built (see post-loop pass).
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
    const { data: compMatches90 } = await db
      .from('matches')
      .select('home_team_id, away_team_id, competition')
      .gte('date', ago90)
      .not('competition', 'is', null)
      .not('status', 'in', '("cancelled","postponed")');

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
      row.congestion_score = Math.max(0, Math.min(100, row.congestion_score - penalty));
    }


    // Batch upsert in chunks of 500
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('team_fixture_load')
        .upsert(chunk, { onConflict: 'team_id,snapshot_date' });
      if (error) throw new Error(`team_fixture_load upsert: ${error.message}`);
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
    const { data: homeMatches, error: mErr } = await db
      .from('matches')
      .select('home_team_id, venue_id')
      .not('venue_id', 'is', null);

    if (mErr) throw new Error(`matches query: ${mErr.message}`);
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
    const { data: stadiums, error: sErr } = await db
      .from('stadiums')
      .select('id, city, country, latitude, longitude')
      .in('id', stadiumIds);

    if (sErr) throw new Error(`stadiums query: ${sErr.message}`);
    const stadiumMap = new Map<number, any>(
      (stadiums || []).map((s: any) => [s.id, s])
    );

    // Fetch teams for name/country context
    const teamIds = Array.from(teamHomeVenue.keys());
    const { data: teams, error: tErr } = await db
      .from('teams')
      .select('id, country')
      .in('id', teamIds);

    if (tErr) throw new Error(`teams query: ${tErr.message}`);
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
      if (error) throw new Error(`team_locations upsert: ${error.message}`);
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
    const { data: locations, error: locErr } = await db
      .from('team_locations')
      .select('team_id, latitude, longitude')
      .not('latitude',  'is', null)
      .not('longitude', 'is', null);

    if (locErr) throw new Error(`team_locations query: ${locErr.message}`);
    if (!locations || locations.length === 0) {
      logger.warn('No team_locations with coordinates — run process:team-locations first');
      return { teamsProcessed: 0, rowsWritten: 0, teamsSkippedNoLocation: 0 };
    }

    const homeLocMap = new Map<number, { lat: number; lng: number }>(
      locations.map((l: any) => [l.team_id, { lat: l.latitude, lng: l.longitude }])
    );

    // 2. Load away matches with venue coordinates (last 30 days)
    const { data: awayMatches, error: mErr } = await db
      .from('matches')
      .select('away_team_id, venue_id, date')
      .gte('date', ago30)
      .not('venue_id', 'is', null)
      .in('status', ['finished', 'live']);

    if (mErr) throw new Error(`away matches query: ${mErr.message}`);

    // 3. Load stadium coordinates
    const venueIds = [...new Set((awayMatches || []).map((m: any) => m.venue_id).filter(Boolean))];
    const stadiumCoordMap = new Map<number, { lat: number; lng: number }>();

    if (venueIds.length > 0) {
      const { data: stadiums, error: sErr } = await db
        .from('stadiums')
        .select('id, latitude, longitude')
        .in('id', venueIds)
        .not('latitude',  'is', null)
        .not('longitude', 'is', null);

      if (sErr) throw new Error(`stadiums query: ${sErr.message}`);
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
    const { data: compMatches90b } = await db
      .from('matches')
      .select('home_team_id, away_team_id, competition')
      .gte('date', ago90b)
      .not('competition', 'is', null)
      .not('status', 'in', '("cancelled","postponed")');

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
      if (error) throw new Error(`team_travel_load upsert: ${error.message}`);
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

    if (mErr) throw new Error(`matches query: ${mErr.message}`);
    if (!matches || matches.length === 0) {
      logger.warn('No matches with venue_id in scope — run sync:today first or widen date range');
      return { matchesProcessed: 0, rowsWritten: 0, skippedNoVenue: 0 };
    }

    // Load all relevant team locations
    const teamIds = [...new Set([
      ...matches.map((m: any) => m.home_team_id),
      ...matches.map((m: any) => m.away_team_id),
    ].filter(Boolean))];

    const { data: locs, error: lErr } = await db
      .from('team_locations')
      .select('team_id, latitude, longitude')
      .in('team_id', teamIds)
      .not('latitude', 'is', null);

    if (lErr) throw new Error(`team_locations query: ${lErr.message}`);
    const locMap = new Map<number, { lat: number; lng: number }>(
      (locs || []).map((l: any) => [l.team_id, { lat: l.latitude, lng: l.longitude }])
    );

    // Load all relevant stadium coordinates
    const venueIds = [...new Set(matches.map((m: any) => m.venue_id).filter(Boolean))];
    const { data: stadiums, error: sErr } = await db
      .from('stadiums')
      .select('id, latitude, longitude')
      .in('id', venueIds)
      .not('latitude', 'is', null);

    if (sErr) throw new Error(`stadiums query: ${sErr.message}`);
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
      if (error) throw new Error(`match_travel_intelligence upsert: ${error.message}`);
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
export async function processTeamIntelligencePartial(): Promise<{
  teamsProcessed: number;
  rowsWritten: number;
  error?: string;
}> {
  logger.info('processTeamIntelligencePartial started — DB only (form + congestion + travel + stability)');

  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Get all team IDs
    const { data: teams, error: tErr } = await db
      .from('teams')
      .select('id');
    if (tErr) throw new Error(`teams query: ${tErr.message}`);
    if (!teams || teams.length === 0) return { teamsProcessed: 0, rowsWritten: 0 };

    const teamIds = teams.map((t: any) => t.id);

    // 2. Last 5 and 10 points from form history (most recent matches)
    const { data: formRecords, error: fErr } = await db
      .from('team_form_history')
      .select('team_id, points, created_at')
      .in('team_id', teamIds)
      .order('created_at', { ascending: false });

    if (fErr) throw new Error(`form history query: ${fErr.message}`);

    const formByTeam = new Map<number, number[]>();
    for (const f of formRecords || []) {
      if (!formByTeam.has(f.team_id)) formByTeam.set(f.team_id, []);
      formByTeam.get(f.team_id)!.push(f.points ?? 0);
    }

    // 3. Latest fixture load snapshot per team
    const { data: fixLoadsAll, error: flErr } = await db
      .from('team_fixture_load')
      .select('team_id, congestion_score, avg_rest_days, snapshot_date')
      .in('team_id', teamIds)
      .order('snapshot_date', { ascending: false });

    if (flErr) throw new Error(`fixture load query: ${flErr.message}`);
    const fixtureMap = new Map<number, any>();
    for (const f of fixLoadsAll || []) {
      if (!fixtureMap.has(f.team_id)) fixtureMap.set(f.team_id, f);
    }

    // 4. Latest travel load snapshot per team
    const { data: travelLoadsAll, error: tlErr } = await db
      .from('team_travel_load')
      .select('team_id, travel_fatigue_score, km_last_30_days, snapshot_date')
      .in('team_id', teamIds)
      .order('snapshot_date', { ascending: false });

    if (tlErr) throw new Error(`travel load query: ${tlErr.message}`);
    const travelMap = new Map<number, any>();
    for (const t of travelLoadsAll || []) {
      if (!travelMap.has(t.team_id)) travelMap.set(t.team_id, t);
    }

    // 5. Active competitions per team (last 90 days)
    const ago90 = new Date(new Date().getTime() - 90 * 86400000).toISOString();
    const { data: compMatches, error: cmErr } = await db
      .from('matches')
      .select('home_team_id, away_team_id, competition')
      .gte('date', ago90)
      .not('competition', 'is', null)
      .not('status', 'in', '("cancelled","postponed")');

    if (cmErr) throw new Error(`active competitions query: ${cmErr.message}`);

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
    const { data: transferIntel } = await db
      .from('team_transfer_intelligence')
      .select('team_id, retention_percentage, transfers_in, transfers_out');
    const transferMap = new Map<number, any>(
      (transferIntel ?? []).map((t: any) => [t.team_id, t])
    );

    const { data: squadSnapshots } = await db
      .from('team_squads_snapshot')
      .select('team_id, players_count, injured_player_count, snapshot_date')
      .order('snapshot_date', { ascending: false });
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

    // 7. Compute intelligence per team
    const rows: any[] = [];

    for (const teamId of teamIds) {
      const points = formByTeam.get(teamId) || [];
      const last5  = points.slice(0, 5);
      const last10 = points.slice(0, 10);

      const last5Points  = last5.reduce( (s: number, p: number) => s + p, 0);
      const last10Points = last10.reduce((s: number, p: number) => s + p, 0);

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
      // For each position bucket, what fraction of the squad in that
      // position is currently available (not injured)? Average across
      // positions present. 100 = full depth everywhere, lower = thin spots.
      const posDepth = positionDepthMap.get(teamId) ?? [];
      let squadDepthScore: number | null = null;
      if (posDepth.length > 0) {
        const ratios = posDepth
          .filter(p => (p.player_count ?? 0) > 0)
          .map(p => ((p.available_count ?? 0) / p.player_count) * 100);
        if (ratios.length > 0) {
          squadDepthScore = Math.round(ratios.reduce((s, r) => s + r, 0) / ratios.length);
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
        last_10_points:          last10.length > 0 ? last10Points : null,
        congestion_score:        congestionScore,
        rest_days_avg:           restDaysAvg,
        travel_fatigue_score:    travelFatigueScore,
        travel_load_km:          travelLoadKm,
        squad_stability_score:   squadStabilityScore,
        squad_depth_score:       squadDepthScore,
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
      if (error) throw new Error(`team_intelligence upsert: ${error.message}`);
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

    if (mErr) throw new Error(`matches query: ${mErr.message}`);
    if (!matches || matches.length === 0) {
      return { matchesProcessed: 0, rowsWritten: 0 };
    }

    // ── Load team_intelligence: form, congestion, travel, stability, comps ──
    const { data: teamIntel, error: tiErr } = await db
      .from('team_intelligence')
      .select('team_id, readiness_score, form_index, congestion_score, travel_fatigue_score, squad_stability_score, active_competitions');
    if (tiErr) throw new Error(`team_intelligence query: ${tiErr.message}`);

    const intelMap = new Map<number, any>(
      (teamIntel || []).map((t: any) => [t.team_id, t])
    );

    // ── Load team_strength_ratings: for Opponent Strength (cross-wise) ──────
    const { data: strengthRows } = await db
      .from('team_strength_ratings')
      .select('team_id, strength_score');
    const strengthMap = new Map<number, number>(
      (strengthRows ?? []).map((s: any) => [s.team_id, s.strength_score ?? 50])
    );

    // ── Load team_venue_performance: for Home Advantage ──────────────────────
    const { data: venueRows } = await db
      .from('team_venue_performance')
      .select('team_id, venue_advantage_score');
    const venueMap = new Map<number, number>(
      (venueRows ?? []).map((v: any) => [v.team_id, v.venue_advantage_score ?? 50])
    );

    // Build last-match-date map for each team (for rest days)
    const { data: allMatches, error: amErr } = await db
      .from('matches')
      .select('id, home_team_id, away_team_id, date')
      .eq('status', 'finished')
      .order('date', { ascending: false });

    if (amErr) throw new Error(`all matches query: ${amErr.message}`);

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
    const { data: travelRows, error: trErr } = await db
      .from('match_travel_intelligence')
      .select('match_id, home_team_distance_km, away_team_distance_km, travel_advantage_km')
      .in('match_id', matchIds);

    if (trErr) throw new Error(`match_travel_intelligence query: ${trErr.message}`);
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
        form: homeForm, oppStrength: homeOppStrength,
        congestion: homeCongestionGood, travel: homeTravelGood,
        homeAdvantage: homeVenueAdv, stability: homeStability, motivation: homeMotivation,
      });
      const awayReadiness = computeReadiness({
        form: awayForm, oppStrength: awayOppStrength,
        congestion: awayCongestionGood, travel: awayTravelGood,
        homeAdvantage: awayVenueAdv, stability: awayStability, motivation: awayMotivation,
      });

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
      if (error) throw new Error(`match_intelligence upsert: ${error.message}`);
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
 * league_position: Cannot be derived without standings API — left null.
 * strength_score: 40% PPG + 40% win % + 20% market value (normalized)
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
    const { data: standingsRows } = await db
      .from('tournament_standings')
      .select('team_id, tournament_id, position')
      .eq('standings_type', 'total');

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
    const { data: tiRows } = await db
      .from('team_intelligence')
      .select('team_id, available_market_value, injured_market_value');
    const mvMap = new Map<number, number>(
      (tiRows ?? []).map((t: any) => [t.team_id, (t.available_market_value ?? 0) + (t.injured_market_value ?? 0)])
    );

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

      // ── Strength Score PER SPEC (section 2): 40% PPG + 30% Win% + 30% League Position
      const components = [
        { v: (ppg / 3) * 100, w: 40 },
        { v: winPct,          w: 30 },
        positionScore !== null ? { v: positionScore, w: 30 } : null,
      ].filter((c): c is { v: number; w: number } => c !== null);

      const totalWeight = components.reduce((s, c) => s + c.w, 0);
      const strength = Math.round(
        components.reduce((s, c) => s + c.v * c.w, 0) / totalWeight
      );

      rows.push({
        team_id:          teamId,
        league_position:  leaguePosition,
        points_per_game:  ppg,
        win_percentage:   winPct,
        strength_score:   Math.min(100, Math.max(0, strength)),
        market_value_eur: mvMap.get(teamId) || null,
        calculated_at:    new Date().toISOString(),
      });
    }

    // Batch upsert in chunks
    const chunkSize = 200;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const { error } = await db
        .from('team_strength_ratings')
        .upsert(rows.slice(i, i + chunkSize), { onConflict: 'team_id' });
      if (error) throw new Error(`team_strength_ratings upsert: ${error.message}`);
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
      if (error) throw new Error(`team_venue_performance upsert: ${error.message}`);
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
 * Populates what is computable WITHOUT player_match_load:
 *   fatigue_score     — from injury_severity_score (if injured) else 0
 *   load_index        — weighted: fatigue + team congestion proxy
 *   transfers_last_12 — count from player_transfers (last 12 months)
 *
 * NOT populated (requires player_match_load — future premium feature):
 *   matches_last_7_days, matches_last_30_days
 *   minutes_last_7_days, minutes_last_30_days
 *   avg_minutes_per_match
 */
export async function processPlayerIntelligence(): Promise<{
  playersProcessed: number;
  rowsWritten: number;
  error?: string;
}> {
  logger.info('processPlayerIntelligence started — DB only, zero API calls');

  try {
    // ── Query 1: Players (injury data only — NO FK join to team_intelligence)
    // players → team_intelligence have no direct FK constraint; Supabase
    // cannot join them. Fetch separately and join in memory instead.
    // Uses fetchAllRows — same 1000-row silent cap bug found and fixed
    // elsewhere in this file; players has 2,300+ rows.
    const players = await fetchAllRows(
      db.from('players').select('id, team_id, current_injury, injury_severity_score')
    );
    if (players.length === 0) {
      logger.warn('No players in DB — run sync:squads:v2 first');
      return { playersProcessed: 0, rowsWritten: 0 };
    }
    logger.debug({ playerCount: players.length }, 'Players fetched (paginated)');

    // ── Query 2: Team congestion scores (keyed by team_id)
    const { data: teamIntels, error: tiErr } = await db
      .from('team_intelligence')
      .select('team_id, congestion_score');

    if (tiErr) {
      logger.warn({ error: tiErr.message }, 'team_intelligence query failed — congestion will default to 0');
    }

    const congestionMap = new Map<number, number>(
      (teamIntels ?? []).map((t: any) => [t.team_id, Number(t.congestion_score ?? 0)])
    );

    // ── Query 3: Transfer counts per player (last 12 months)
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const { data: transfers } = await db
      .from('player_transfers')
      .select('player_id')
      .gte('transfer_date', yearAgo.toISOString().split('T')[0]);

    const transferMap = new Map<number, number>();
    for (const t of transfers ?? []) {
      transferMap.set(t.player_id, (transferMap.get(t.player_id) ?? 0) + 1);
    }

    // ── Compute player intelligence rows ─────────────────────────────────────
    const now = new Date().toISOString();
    const rows: any[] = [];

    for (const p of players) {
      const injurySeverity  = Number(p.injury_severity_score ?? 0);
      const teamCongestion  = congestionMap.get(p.team_id) ?? 0;
      const transfersLast12 = transferMap.get(p.id) ?? 0;

      // fatigue_score: driven by injury severity (0 = healthy, 100 = long-term out)
      const fatigue = injurySeverity;

      // load_index: 60% injury fatigue + 40% team schedule congestion
      const load = Math.round(fatigue * 0.6 + teamCongestion * 0.4);

      // readiness_score: inverse of load — a healthy, unfatigued player on
      // a lightly-congested team schedule reads as high readiness. Same
      // directional logic as team_intelligence.readiness_score, just at
      // player granularity. Unblocks the "Key Players" READINESS column
      // in the Team Detail mockup (see SCHEMA_GAP_ANALYSIS.md item #2).
      const readiness = Math.max(0, Math.min(100, 100 - Math.min(100, load)));

      rows.push({
        player_id:                p.id,
        fatigue_score:            fatigue,
        load_index:               Math.min(100, load),
        readiness_score:          readiness,
        transfers_last_12_months: transfersLast12,
        // Fields requiring player_match_load — future premium feature
        matches_last_7_days:   null,
        matches_last_30_days:  null,
        minutes_last_7_days:   null,
        minutes_last_30_days:  null,
        avg_minutes_per_match: null,
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
      if (error) throw new Error(`player_intelligence upsert chunk ${i}: ${error.message}`);
      written += chunk.length;
      logger.debug({ written, total: rows.length }, 'Player intelligence chunk written');
    }

    logger.info({
      playersProcessed: players.length,
      rowsWritten:      written,
      withInjury:       rows.filter((r: any) => r.fatigue_score > 0).length,
      withTransfers:    rows.filter((r: any) => r.transfers_last_12_months > 0).length,
    }, 'processPlayerIntelligence completed');

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
export async function processPredictedLineups(): Promise<{
  matchesProcessed: number;
  playersWritten: number;
  error?: string;
}> {
  logger.info('processPredictedLineups started — DB only, zero API calls');

  try {
    // Only upcoming (scheduled) matches within the next 7 days — predicted
    // lineups for matches far in the future aren't meaningfully more useful
    // and just cost processing time without value.
    const now = new Date().toISOString();
    const weekOut = new Date(Date.now() + 7 * 86400000).toISOString();

    const { data: matches, error: mErr } = await db
      .from('matches')
      .select('id, home_team_id, away_team_id')
      .eq('status', 'scheduled')
      .gte('date', now)
      .lte('date', weekOut);

    if (mErr) throw new Error(`matches query: ${mErr.message}`);
    if (!matches || matches.length === 0) {
      return { matchesProcessed: 0, playersWritten: 0 };
    }

    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    // Season stats — primary ranking signal
    const { data: seasonStats } = await db
      .from('player_season_statistics')
      .select('player_id, team_id, matches_started, minutes_played')
      .in('team_id', teamIds)
      .order('matches_started', { ascending: false });

    // Player position + injury status
    const { data: players } = await db
      .from('players')
      .select('id, team_id, position, current_injury')
      .in('team_id', teamIds);
    const playerMap = new Map<number, any>((players ?? []).map((p: any) => [p.id, p]));

    // Recent transfers OUT — exclude anyone who's left since the stats snapshot
    const { data: recentTransfers } = await db
      .from('player_transfers')
      .select('player_id, to_team_id, transfer_date')
      .order('transfer_date', { ascending: false });
    const latestTeamByPlayer = new Map<number, number>();
    for (const t of recentTransfers ?? []) {
      if (!latestTeamByPlayer.has(t.player_id) && t.to_team_id) {
        latestTeamByPlayer.set(t.player_id, t.to_team_id);
      }
    }

    // Build per-team ranked rosters by position
    const FORMATION: Record<string, number> = { G: 1, D: 4, M: 4, F: 2 };
    const teamRosters = new Map<number, Map<string, any[]>>();

    for (const stat of seasonStats ?? []) {
      const player = playerMap.get(stat.player_id);
      if (!player) continue;
      if (player.current_injury) continue; // unavailable
      const currentTeam = latestTeamByPlayer.get(stat.player_id);
      if (currentTeam && currentTeam !== stat.team_id) continue; // transferred out since

      const pos = player.position ?? 'M'; // default bucket if unknown
      if (!teamRosters.has(stat.team_id)) teamRosters.set(stat.team_id, new Map());
      const posMap = teamRosters.get(stat.team_id)!;
      if (!posMap.has(pos)) posMap.set(pos, []);
      posMap.get(pos)!.push({ playerId: stat.player_id, matchesStarted: stat.matches_started ?? 0, minutesPlayed: stat.minutes_played ?? 0 });
    }

    const rows: any[] = [];

    for (const m of matches) {
      for (const teamId of [m.home_team_id, m.away_team_id]) {
        const posMap = teamRosters.get(teamId);
        if (!posMap) continue;

        for (const [pos, count] of Object.entries(FORMATION)) {
          const candidates = (posMap.get(pos) ?? []).sort((a, b) => b.matchesStarted - a.matchesStarted);
          const top = candidates.slice(0, count);

          top.forEach((c, i) => {
            const next = candidates[i + 1];
            // Confidence: how much this player's starts separate them from
            // the next-best option — wide gap = high confidence, close = low.
            const gap = next ? c.matchesStarted - next.matchesStarted : c.matchesStarted;
            const confidence = Math.min(100, Math.round(50 + gap * 5));

            rows.push({
              match_id:          m.id,
              team_id:           teamId,
              player_id:         c.playerId,
              position_code:     pos,
              rank_in_position:  i + 1,
              matches_started:   c.matchesStarted,
              confidence,
              calculated_at:     new Date().toISOString(),
            });
          });
        }
      }
    }

    // Batch upsert
    const chunkSize = 500;
    let written = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await db
        .from('match_predicted_lineups')
        .upsert(chunk, { onConflict: 'match_id,player_id' });
      if (error) throw new Error(`match_predicted_lineups upsert: ${error.message}`);
      written += chunk.length;
    }

    logger.info({ matchesProcessed: matches.length, playersWritten: written }, 'processPredictedLineups completed');
    return { matchesProcessed: matches.length, playersWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processPredictedLineups failed');
    return { matchesProcessed: 0, playersWritten: 0, error: error.message };
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
    const { data: allTournaments } = await db
      .from('tournaments')
      .select('name, slug, category');

    const trackedNames = new Set(
      (allTournaments ?? [])
        .filter((t: any) =>
          (t.slug && isTrackedBySlug(t.slug, t.category)) ||
          isTrackedLeague(t.name, t.category)
        )
        .map((t: any) => t.name)
    );

    const { data: todaysMatchesRaw } = await db
      .from('matches')
      .select('id, competition')
      .gte('date', startOfDay.toISOString())
      .lte('date', endOfDay.toISOString());

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
    const { data: allMatchesForTeams } = await db
      .from('matches')
      .select('home_team_id, away_team_id, competition');
    const trackedTeamIds = new Set<number>();
    for (const m of allMatchesForTeams ?? []) {
      if (!trackedNames.has(m.competition)) continue;
      if (m.home_team_id) trackedTeamIds.add(m.home_team_id);
      if (m.away_team_id) trackedTeamIds.add(m.away_team_id);
    }
    const teamsTracked = trackedTeamIds.size;

    const { data: readinessRows } = await db
      .from('team_intelligence')
      .select('readiness_score')
      .not('readiness_score', 'is', null);

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

    const { data: matches, error: mErr } = await db
      .from('matches')
      .select('id, home_team_id, away_team_id, date')
      .eq('status', 'scheduled')
      .gte('date', now)
      .lte('date', weekOut);

    if (mErr) throw new Error(`matches query: ${mErr.message}`);
    if (!matches || matches.length === 0) {
      return { matchesProcessed: 0, rowsWritten: 0 };
    }

    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    // Last 10 form-history rows per team, most recent first
    const { data: formRows } = await db
      .from('team_form_history')
      .select('team_id, goals_for, goals_against, match_date')
      .in('team_id', teamIds)
      .order('match_date', { ascending: false });

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

      // Need at least one side of data for each team to produce a lambda —
      // if a team has zero form history, skip this match entirely rather
      // than guess with a fabricated default rate.
      if (homeScoringRate == null || homeConcedeRate == null || awayScoringRate == null || awayConcedeRate == null) {
        continue;
      }

      const lambdaHome = ((homeScoringRate + awayConcedeRate) / 2) * 1.10;
      const lambdaAway = ((awayScoringRate + homeConcedeRate) / 2) * 0.95;

      // Build full probability grid, then keep top 6
      const grid: { home: number; away: number; probability: number }[] = [];
      for (let h = 0; h <= MAX_GOALS; h++) {
        for (let a = 0; a <= MAX_GOALS; a++) {
          const p = poissonPMF(h, lambdaHome) * poissonPMF(a, lambdaAway);
          grid.push({ home: h, away: a, probability: p });
        }
      }
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
