import { db } from '../db/client';
import { Team } from '../types/index';
import { logger } from '../utils/logger';

export class TeamsRepository {
  async findByExternalId(externalId: number): Promise<Team | null> {
    const { data, error } = await db
      .from('teams')
      .select('*')
      .eq('external_id', externalId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, externalId },
        'Failed to find team'
      );
      throw error;
    }

    return data || null;
  }


  async findByExternalIds(externalIds: number[]): Promise<Team[]> {
  if (externalIds.length === 0) return [];

  const { data, error } = await db
    .from('teams')
    .select('*')
    .in('external_id', externalIds);

  if (error) {
    logger.error(
      { error: error.message, count: externalIds.length },
      'Failed to batch find teams by external IDs'
    );
    throw error;
  }

  return data || [];
}


  async findById(id: number): Promise<Team | null> {
    const { data, error } = await db
      .from('teams')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error: error.message, id }, 'Failed to find team');
      throw error;
    }

    return data || null;
  }

  async upsert(data: Team): Promise<Team> {
    const { id: _id, ...payload } = data as any; // strip id
    const { data: result, error } = await db
      .from('teams')
      .upsert(payload, { onConflict: 'external_id' })
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, externalId: data.external_id },
        'Failed to upsert team'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(teams: Team[]): Promise<number> {
    if (teams.length === 0) return 0;

    const { error } = await db.from('teams').upsert(teams, {
      onConflict: 'external_id',
    });

    if (error) {
      logger.error(
        { error: error.message, count: teams.length },
        'Failed to batch upsert teams'
      );
      throw error;
    }

    return teams.length;
  }

  async getAll(): Promise<Team[]> {
    const { data, error } = await db.from('teams').select('*');

    if (error) {
      logger.error({ error: error.message }, 'Failed to get all teams');
      throw error;
    }

    return data || [];
  }

  async getByCountry(country: string): Promise<Team[]> {
    const { data, error } = await db
      .from('teams')
      .select('*')
      .eq('country', country);

    if (error) {
      logger.error(
        { error: error.message, country },
        'Failed to get teams by country'
      );
      throw error;
    }

    return data || [];
  }

  async search(query: string, limit: number = 10): Promise<Team[]> {
    const { data, error } = await db
      .from('teams')
      .select('*')
      .or(`name.ilike.%${query}%,short_name.ilike.%${query}%`)
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, query },
        'Failed to search teams'
      );
      throw error;
    }

    return data || [];
  }
}

export const teamsRepository = new TeamsRepository();
