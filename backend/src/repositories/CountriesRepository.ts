import { db } from '../db/client';
import { Country } from '../types/index';
import { logger } from '../utils/logger';

export class CountriesRepository {
  async findByName(name: string): Promise<Country | null> {
    const { data, error } = await db
      .from('countries')
      .select('*')
      .eq('name', name)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found (not an error)
      logger.error(
        { error: error.message, name },
        'Failed to find country by name'
      );
      throw error;
    }

    return data || null;
  }

  async findById(id: number): Promise<Country | null> {
    const { data, error } = await db
      .from('countries')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error({ error: error.message, id }, 'Failed to find country');
      throw error;
    }

    return data || null;
  }

  async upsert(name: string, data: Partial<Country>): Promise<Country> {
    const { data: result, error } = await db
      .from('countries')
      .upsert(
        {
          name,
          ...data,
        } as any,
        { onConflict: 'name' }
      )
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, name },
        'Failed to upsert country'
      );
      throw error;
    }

    return result;
  }

  async getAll(): Promise<Country[]> {
    const { data, error } = await db.from('countries').select('*');

    if (error) {
      logger.error({ error: error.message }, 'Failed to get all countries');
      throw error;
    }

    return data || [];
  }
}

export const countriesRepository = new CountriesRepository();
