import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index';
import { logger } from '../utils/logger';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      throw new Error('Supabase credentials missing. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    }
    logger.info('Initializing Supabase client...');
    supabaseInstance = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseInstance;
}

export const db = {
  from: (table: string) => getSupabaseClient().from(table),
} as any;
