// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER CONFIGURATION
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PROVIDER CODE IS NOT CONFIGURABLE
//
// PROVIDER_CODE is a source constant, exactly as the seven role names are.
// It participates in uq_team__provider_external_id (provider_code,
// provider_external_id) and the equivalents on competition, player and fixture,
// so a deployment able to change it could point ingestion at a namespace the
// existing rows do not occupy — and every team, player, competition and fixture
// would silently double, with features and readings splitting across the pairs.
//
// Decision D-1 (architecture owner): SPORTSAPI_API is the only supported S-4
// ingestion source. SofaScore direct is not part of the V2 pipeline, because it
// cannot support scheduled backend ingestion — Cloudflare refuses server
// requests with 403 regardless of headers. Entity uniqueness stays within the
// active ingestion namespace, and NO SECOND NAMESPACE IS CREATED.
//
// The consequence worth stating: SportsAPI Pro resells SofaScore data, so some
// rows describe SofaScore observations. That is a provenance fact recorded in
// documentation. It is NOT an identity fact, and it does not earn a second
// provider_code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one provider namespace. See the header — this is deliberately not read
 * from the environment.
 */
export const PROVIDER_CODE = 'SPORTSAPI_API' as const;

/** Environment variables this subsystem reads. All are V2-scoped. */
export interface ProviderConfig {
  readonly baseUrl: string;
  /**
   * One or more API keys. Two doubles the daily budget, which is why V1 carried
   * configuration specifically to add a second — the arrangement E9.05 names as
   * the thing nothing measured.
   */
  readonly keys: readonly string[];
  readonly requestTimeoutMs: number;
  /** Per-key daily request budget, used to reason about cost before spending it. */
  readonly dailyQuotaPerKey: number;
  /** Minimum milliseconds between requests. The squad endpoint requires 2s. */
  readonly minRequestIntervalMs: number;
}

let cached: ProviderConfig | null = null;

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received '${raw}'.`);
  }
  return parsed;
}

/**
 * Loads and validates provider configuration.
 *
 * FAIL-FAST, like S-1's database configuration. A missing key discovered at the
 * first request is discovered inside a pipeline run, after the operational
 * record has been opened and partway through a stage; discovered at startup it
 * is a clear message and no partial work.
 */
export function loadProviderConfig(): ProviderConfig {
  if (cached) return cached;

  const baseUrl = process.env.PT_V2_PROVIDER_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      'PT_V2_PROVIDER_BASE_URL is required for V2 ingestion. ' +
        'V1 configuration is deliberately not reused: V2 must be deployable without ' +
        'inheriting V1 environment, and a shared variable would couple the two.'
    );
  }

  const keys = [process.env.PT_V2_PROVIDER_KEY, process.env.PT_V2_PROVIDER_KEY_2].filter(
    (k): k is string => typeof k === 'string' && k.length > 0
  );
  if (keys.length === 0) {
    throw new Error('PT_V2_PROVIDER_KEY is required for V2 ingestion.');
  }

  cached = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    keys,
    requestTimeoutMs: readInt('PT_V2_PROVIDER_TIMEOUT_MS', 30_000),
    dailyQuotaPerKey: readInt('PT_V2_PROVIDER_DAILY_QUOTA', 100),
    minRequestIntervalMs: readInt('PT_V2_PROVIDER_MIN_INTERVAL_MS', 2_000),
  };
  return cached;
}

/** The whole-deployment daily budget, across every configured key. */
export function dailyQuota(config: ProviderConfig = loadProviderConfig()): number {
  return config.keys.length * config.dailyQuotaPerKey;
}

/** Test seam. Never called by production code. */
export function resetProviderConfigForTesting(): void {
  cached = null;
}
