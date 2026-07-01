export interface Config {
  sportsapi: {
    key: string;
    key2: string | null;  // Optional second key — doubles daily quota when set
    baseUrl: string;
  };
  sofascore: {
    baseUrl: string;
  };
  supabase: {
    url: string;
    serviceKey: string;
  };
  node: {
    env: 'development' | 'production' | 'test';
  };
  log: {
    level: string;
  };
  cron: {
    enabled: boolean;
  };
}

function loadConfig(): Config {
  const missingEnvs: string[] = [];

  const requiredEnvs = [
    'SPORTSAPI_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
  ];

  requiredEnvs.forEach((env) => {
    if (!process.env[env]) {
      missingEnvs.push(env);
    }
  });

  if (missingEnvs.length > 0) {
    console.error(
      `Missing environment variables: ${missingEnvs.join(', ')}`
    );
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  return {
    sportsapi: {
      key:  process.env.SPORTSAPI_KEY || '',
      // Optional — if set, doubles the effective daily quota (100 -> 200).
      // Set SPORTSAPI_KEY_2 in .env to enable. Safe to leave unset; the
      // client falls back to single-key behavior automatically.
      key2: process.env.SPORTSAPI_KEY_2 || null,
      baseUrl:
        process.env.SPORTSAPI_BASE_URL ||
        'https://v2.football.sportsapipro.com/api',
    },
    sofascore: {
      // SofaScore public API — no key required
      // Override with SOFASCORE_BASE_URL if using a proxy or reseller
      baseUrl: process.env.SOFASCORE_BASE_URL || 'https://api.sofascore.com/api/v1',
    },
    supabase: {
      url: process.env.SUPABASE_URL || '',
      serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
    },
    node: {
      env: (process.env.NODE_ENV as any) || 'development',
    },
    log: {
      level: process.env.LOG_LEVEL || 'debug',
    },
    cron: {
      enabled: process.env.CRON_ENABLED === 'true',
    },
  };
}

export const config = loadConfig();
