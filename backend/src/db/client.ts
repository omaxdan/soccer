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

// db.storage uses a GETTER, not a plain property assigned once at
// module load. A plain `storage: getSupabaseClient().storage` would
// call getSupabaseClient() eagerly the moment this file is imported -
// a real behavioral change from db.from()'s existing lazy pattern
// (only initializes, and only throws on missing credentials, when
// actually invoked). A getter preserves that: db.storage still only
// initializes the client the moment it's actually accessed, same as
// db.from() always has.
export const db = {
  from: (table: string) => getSupabaseClient().from(table),
  get storage() { return getSupabaseClient().storage; },
} as any;
