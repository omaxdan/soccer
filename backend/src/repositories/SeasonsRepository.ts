import { db } from '../db/client';
import { Season } from '../types/index';
import { logger } from '../utils/logger';

export class SeasonsRepository {
  async findByExternalId(externalId: number): Promise<Season | null> {
    const { data, error } = await db
      .from('seasons')
      .select('*')
      .eq('external_id', externalId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, externalId },
        'Failed to find season'
      );
      throw error;
    }

    return data || null;
  }

  async findById(id: number): Promise<Season | null> {
    const { data, error } = await db
      .from('seasons')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error: error.message, id }, 'Failed to find season');
      throw error;
    }

    return data || null;
  }

  async upsert(data: Season): Promise<Season> {
    const { id: _id, ...payload } = data as any; // strip id
    const { data: result, error } = await db
      .from('seasons')
      .upsert(payload, { onConflict: 'external_id' })
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, externalId: data.external_id },
        'Failed to upsert season'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(seasons: Season[]): Promise<number> {
    if (seasons.length === 0) return 0;

    const { error } = await db.from('seasons').upsert(seasons, {
      onConflict: 'external_id',
    });

    if (error) {
      logger.error(
        { error: error.message, count: seasons.length },
        'Failed to batch upsert seasons'
      );
      throw error;
    }

    return seasons.length;
  }

  async getByTournamentId(tournamentId: number): Promise<Season[]> {
    const { data, error } = await db
      .from('seasons')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('year', { ascending: false });

    if (error) {
      logger.error(
        { error: error.message, tournamentId },
        'Failed to get seasons by tournament'
      );
      throw error;
    }

    return data || [];
  }

  async getAll(): Promise<Season[]> {
    const { data, error } = await db.from('seasons').select('*');

    if (error) {
      logger.error({ error: error.message }, 'Failed to get all seasons');
      throw error;
    }

    return data || [];
  }
}

export const seasonsRepository = new SeasonsRepository();
