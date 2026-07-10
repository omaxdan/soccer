import { db } from '../db/client';
import { Tournament } from '../types/index';
import { logger } from '../utils/logger';

export class TournamentsRepository {
  async findByExternalId(externalId: number): Promise<Tournament | null> {
    const { data, error } = await db
      .from('tournaments')
      .select('*')
      .eq('external_id', externalId)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, externalId },
        'Failed to find tournament'
      );
      throw error;
    }

    return data || null;
  }

  async findById(id: number): Promise<Tournament | null> {
    const { data, error } = await db
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error: error.message, id }, 'Failed to find tournament');
      throw error;
    }

    return data || null;
  }

  async upsert(data: Tournament): Promise<Tournament> {
    const { id: _id, ...payload } = data as any; // strip id
    const { data: result, error } = await db
      .from('tournaments')
      .upsert(payload, { onConflict: 'external_id' })
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, externalId: data.external_id },
        'Failed to upsert tournament'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(tournaments: Tournament[]): Promise<number> {
    if (tournaments.length === 0) return 0;

    const { error, status } = await db.from('tournaments').upsert(tournaments, {
      onConflict: 'external_id',
    });

    if (error) {
      logger.error(
        { error: error.message, count: tournaments.length },
        'Failed to batch upsert tournaments'
      );
      throw error;
    }

    return tournaments.length;
  }

  async getAll(): Promise<Tournament[]> {
    const { data, error } = await db.from('tournaments').select('*');

    if (error) {
      logger.error({ error: error.message }, 'Failed to get all tournaments');
      throw error;
    }

    return data || [];
  }

  async getByCountryId(countryId: number): Promise<Tournament[]> {
    const { data, error } = await db
      .from('tournaments')
      .select('*')
      .eq('country_id', countryId);

    if (error) {
      logger.error(
        { error: error.message, countryId },
        'Failed to get tournaments by country'
      );
      throw error;
    }

    return data || [];
  }
}

export const tournamentsRepository = new TournamentsRepository();
