import { db } from '../db/client';
import { Match, MatchResult } from '../types/index';
import { logger } from '../utils/logger';

export class MatchesRepository {
  async findByExternalId(externalId: number): Promise<Match | null> {
    const { data, error } = await db
      .from('matches')
      .select('*')
      .eq('external_match_id', externalId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, externalId },
        'Failed to find match'
      );
      throw error;
    }

    return data || null;
  }

  async findById(id: number): Promise<Match | null> {
    const { data, error } = await db
      .from('matches')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error: error.message, id }, 'Failed to find match');
      throw error;
    }

    return data || null;
  }

  async upsert(data: Match): Promise<Match> {
    const { id: _id, ...payload } = data as any; // strip id
    const { data: result, error } = await db
      .from('matches')
      .upsert(payload, { onConflict: 'external_match_id' })
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, externalId: data.external_match_id },
        'Failed to upsert match'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(matches: Match[]): Promise<number> {
    if (matches.length === 0) return 0;

    // Strip id (which transformMatch sets to 0) before upserting — Postgres
    // treats an explicit id:0 as a real value to INSERT, so a batch containing
    // multiple new matches all with id:0 causes a self-conflict on the PK.
    // Dropping id lets the DB generate it on INSERT and ignores it on UPDATE
    // (the conflict resolution key is external_match_id, not id).
    const payload = matches.map(({ id: _id, ...rest }) => rest);

    const { error } = await db.from('matches').upsert(payload, {
      onConflict: 'external_match_id',
    });

    if (error) {
      logger.error(
        { error: error.message, count: matches.length },
        'Failed to batch upsert matches'
      );
      throw error;
    }

    return matches.length;
  }

  async getScheduledMatches(days: number = 7): Promise<Match[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const { data, error } = await db
      .from('matches')
      .select('*')
      .eq('status', 'scheduled')
      .lte('date', futureDate.toISOString())
      .order('date', { ascending: true });

    if (error) {
      logger.error(
        { error: error.message, days },
        'Failed to get scheduled matches'
      );
      throw error;
    }

    return data || [];
  }

  async getFinishedMatches(limit: number = 100): Promise<Match[]> {
    // BETA FIX (audit P0): .limit(10000) returns 1000 — PostgREST caps
    // every response at server max_rows regardless of the requested limit.
    // The form backfill's "all finished matches" read was silently capped,
    // so matches beyond the first 1000 NEVER got form rows. Paginate when
    // the caller asks for more than one server page.
    if (limit > 1000) {
      const { fetchAllRows } = await import('../db/fetchAllRows');
      const rows = await fetchAllRows(
        db.from('matches')
          .select('*')
          .eq('status', 'finished')
          .order('date', { ascending: false })
      );
      return rows.slice(0, limit);
    }

    const { data, error } = await db
      .from('matches')
      .select('*')
      .eq('status', 'finished')
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message },
        'Failed to get finished matches'
      );
      throw error;
    }

    return data || [];
  }

  async getTeamMatches(
    teamId: number,
    limit: number = 10
  ): Promise<Match[]> {
    const { data, error } = await db
      .from('matches')
      .select('*')
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, teamId },
        'Failed to get team matches'
      );
      throw error;
    }

    return data || [];
  }
}

export class MatchResultsRepository {
  async findByMatchId(matchId: number): Promise<MatchResult | null> {
    const { data, error } = await db
      .from('match_results')
      .select('*')
      .eq('match_id', matchId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, matchId },
        'Failed to find match result'
      );
      throw error;
    }

    return data || null;
  }

  async upsert(data: MatchResult): Promise<MatchResult> {
    // Strip id (transformMatchResult sets it to 0) for the same reason as
    // matchesRepository.upsertBatch — an explicit id:0 conflicts on the PK
    // before the ON CONFLICT (match_id) clause can fire.
    const { id: _id, ...payload } = data;
    const { data: result, error } = await db
      .from('match_results')
      .upsert(payload as any, { onConflict: 'match_id' })
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, matchId: data.match_id },
        'Failed to upsert match result'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(results: MatchResult[]): Promise<number> {
    if (results.length === 0) return 0;

    const payload = results.map(({ id: _id, ...rest }) => rest);
    const { error } = await db.from('match_results').upsert(payload, {
      onConflict: 'match_id',
    });

    if (error) {
      logger.error(
        { error: error.message, count: results.length },
        'Failed to batch upsert match results'
      );
      throw error;
    }

    return results.length;
  }

  async getTeamResults(
    teamId: number,
    limit: number = 10
  ): Promise<MatchResult[]> {
    const { data, error } = await db
      .from('match_results')
      .select(`*, matches:match_id(home_team_id, away_team_id)`)
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, teamId },
        'Failed to get team results'
      );
      throw error;
    }

    return data || [];
  }
}

export const matchesRepository = new MatchesRepository();
export const matchResultsRepository = new MatchResultsRepository();
