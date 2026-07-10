import { fetchAllRows } from '../db/fetchAllRows';
import { db } from '../db/client';
import { Player } from '../types/index';
import { logger } from '../utils/logger';

export class PlayersRepository {
  async findByExternalId(externalId: number): Promise<Player | null> {
    const { data, error } = await db
      .from('players')
      .select('*')
      .eq('external_id', externalId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, externalId },
        'Failed to find player'
      );
      throw error;
    }

    return data || null;
  }

  async findById(id: number): Promise<Player | null> {
    const { data, error } = await db
      .from('players')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error: error.message, id }, 'Failed to find player');
      throw error;
    }

    return data || null;
  }

  async upsert(data: Player): Promise<Player> {
    const { id: _id, ...payload } = data as any; // strip id — Postgres auto-generates via BIGSERIAL
    const { data: result, error } = await db
      .from('players')
      .upsert(payload, { onConflict: 'external_id' })
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, externalId: data.external_id },
        'Failed to upsert player'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(players: Player[]): Promise<number> {
    if (players.length === 0) return 0;

    const payloads = players.map(({ id: _id, ...p }: any) => p); // strip id
    const { error } = await db.from('players').upsert(payloads, {
      onConflict: 'external_id',
    });

    if (error) {
      logger.error(
        { error: error.message, count: players.length },
        'Failed to batch upsert players'
      );
      throw error;
    }

    return players.length;
  }

  async getTeamPlayers(teamId: number): Promise<Player[]> {
    const { data, error } = await db
      .from('players')
      .select('*')
      .eq('team_id', teamId)
      .order('name', { ascending: true });

    if (error) {
      logger.error(
        { error: error.message, teamId },
        'Failed to get team players'
      );
      throw error;
    }

    return data || [];
  }

  async search(query: string, limit: number = 10): Promise<Player[]> {
    const { data, error } = await db
      .from('players')
      .select('*')
      .ilike('name', `%${query}%`)
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, query },
        'Failed to search players'
      );
      throw error;
    }

    return data || [];
  }

  async getPlayersByPosition(
    position: string,
    teamId?: number
  ): Promise<Player[]> {
    let query = db.from('players').select('*').eq('position', position);

    if (teamId) {
      query = query.eq('team_id', teamId);
    }

    // BETA FIX: unscoped position reads span all teams (>1000 rows) — paginate.
    let data: any[] = [];
    try {
      data = await fetchAllRows(query);
    } catch (e: any) {
      const error = { message: e.message };
      logger.error(
        { error: error.message, position, teamId },
        'Failed to get players by position'
      );
      throw error;
    }

    return data || [];
  }
}

export const playersRepository = new PlayersRepository();
