import { db } from '../db/client';
import { TeamFormHistory } from '../types/index';
import { logger } from '../utils/logger';

export class TeamFormHistoryRepository {
  async findByTeamAndMatch(
    teamId: number,
    matchId: number
  ): Promise<TeamFormHistory | null> {
    const { data, error } = await db
      .from('team_form_history')
      .select('*')
      .eq('team_id', teamId)
      .eq('match_id', matchId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, teamId, matchId },
        'Failed to find form history'
      );
      throw error;
    }

    return data || null;
  }

  async upsert(data: TeamFormHistory): Promise<TeamFormHistory> {
    // Strip `id` so Postgres auto-generates it via BIGSERIAL.
    // Without this, passing id:0 hits the pkey constraint on every re-run.
    const { id: _id, ...payload } = data as any;
    const { data: result, error } = await db
      .from('team_form_history')
      .upsert(payload, { onConflict: 'team_id,match_id' })
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, teamId: data.team_id, matchId: data.match_id },
        'Failed to upsert form history'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(records: TeamFormHistory[]): Promise<number> {
    if (records.length === 0) return 0;

    // Strip id from every record for same reason as upsert()
    const payloads = records.map(({ id: _id, ...r }: any) => r);
    const { error } = await db.from('team_form_history').upsert(payloads, {
      onConflict: 'team_id,match_id',
    });

    if (error) {
      logger.error(
        { error: error.message, count: records.length },
        'Failed to batch upsert form history'
      );
      throw error;
    }

    return records.length;
  }

  /**
   * Get the last N form records for a team
   */
  async getTeamFormRecent(
    teamId: number,
    limit: number = 10
  ): Promise<TeamFormHistory[]> {
    const { data, error } = await db
      .from('team_form_history')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, teamId, limit },
        'Failed to get team form history'
      );
      throw error;
    }

    return data || [];
  }

  /**
   * Calculate rolling form statistics (W-D-L record)
   */
  async getTeamFormStats(
    teamId: number,
    limit: number = 10
  ): Promise<{ wins: number; draws: number; losses: number }> {
    const records = await this.getTeamFormRecent(teamId, limit);

    const stats = {
      wins: 0,
      draws: 0,
      losses: 0,
    };

    records.forEach((record) => {
      if (record.result === 'W') stats.wins++;
      else if (record.result === 'D') stats.draws++;
      else if (record.result === 'L') stats.losses++;
    });

    return stats;
  }

  /**
   * Calculate rolling form points (3 for W, 1 for D, 0 for L)
   */
  async getTeamFormPoints(
    teamId: number,
    limit: number = 10
  ): Promise<number> {
    const records = await this.getTeamFormRecent(teamId, limit);

    return records.reduce((total, record) => {
      if (record.result === 'W') return total + 3;
      if (record.result === 'D') return total + 1;
      return total;
    }, 0);
  }

  /**
   * Get all form records for a team within a date range
   */
  async getTeamFormBetweenDates(
    teamId: number,
    startDate: Date,
    endDate: Date
  ): Promise<TeamFormHistory[]> {
    const { data, error } = await db
      .from('team_form_history')
      .select('*')
      .eq('team_id', teamId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      logger.error(
        { error: error.message, teamId },
        'Failed to get team form between dates'
      );
      throw error;
    }

    return data || [];
  }

  /**
   * Check if form history exists for a match
   */
  async existsForMatch(matchId: number): Promise<boolean> {
    const { count, error } = await db
      .from('team_form_history')
      .select('*', { count: 'exact', head: true })
      .eq('match_id', matchId);

    if (error) {
      logger.error(
        { error: error.message, matchId },
        'Failed to check form existence'
      );
      throw error;
    }

    return (count || 0) > 0;
  }
  async getExistingMatchIds(): Promise<number[]> {
  // BETA FIX (audit P0): raw read capped at 1000 rows = only ~500 matches'
  // IDs (2 rows per match), so the backfill's dedup set was incomplete —
  // already-processed matches looked new. Upserts made that harmless but
  // wasteful; the real damage was the capped getFinishedMatches read this
  // pairs with. Both now paginate.
  const { fetchAllRows } = await import('../db/fetchAllRows');
  const data = await fetchAllRows(
    db.from('team_form_history').select('match_id')
  );

  // Deduplicate — each match has 2 rows (home + away)
  const rows = (data || []) as { match_id: number }[];
  return [...new Set(rows.map(row => row.match_id))];
}
}

export const teamFormHistoryRepository = new TeamFormHistoryRepository();
