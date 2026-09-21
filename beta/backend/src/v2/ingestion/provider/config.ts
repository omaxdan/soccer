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
  /** Per-key daily request budget, used to reason about cost before spending it.
   *  HOMOGENEOUS default — every key shares this ceiling. For HETEROGENEOUS keys
   *  (e.g. a 7,500/day paid key alongside a 100/day free key) `perKeyDailyQuota`
   *  overrides it index-by-index; `dailyQuotaPerKey` then equals the first key's
   *  quota and is no longer the whole-deployment figure. */
  readonly dailyQuotaPerKey: number;
  /** OPTIONAL heterogeneous per-key daily quotas, aligned by index with `keys`.
   *  Present only when keys have DIFFERENT ceilings. When present:
   *    • dailyQuota() = Σ perKeyDailyQuota  (correct aggregate, e.g. 7500+100=7600)
   *    • routing is capacity-descending PRIMARY-FIRST, never blind round-robin.
   *  Absent → homogeneous behaviour is unchanged (round-robin, keys×dailyQuotaPerKey). */
  readonly perKeyDailyQuota?: readonly number[];
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

  const dailyQuotaPerKey = readInt('PT_V2_PROVIDER_DAILY_QUOTA', 100);

  // HETEROGENEOUS keys: a per-key ceiling on the SECOND key marks the deployment as
  // mixed-capacity (e.g. KEY A = 7500/day paid, KEY B = 100/day free). The first
  // key's ceiling is PT_V2_PROVIDER_DAILY_QUOTA; the second key's is
  // PT_V2_PROVIDER_DAILY_QUOTA_2. Only wired when a second key AND its quota exist,
  // so a single-key or equal-key deployment stays on the homogeneous path untouched.
  const secondQuotaRaw = process.env.PT_V2_PROVIDER_DAILY_QUOTA_2;
  let perKeyDailyQuota: number[] | undefined;
  if (keys.length >= 2 && secondQuotaRaw !== undefined && secondQuotaRaw !== '') {
    const second = readInt('PT_V2_PROVIDER_DAILY_QUOTA_2', dailyQuotaPerKey);
    // One quota per key: key 0 → dailyQuotaPerKey, key 1 → second, any further keys
    // inherit the homogeneous scalar (no third env var is defined; extend explicitly).
    perKeyDailyQuota = keys.map((_k, i) => (i === 0 ? dailyQuotaPerKey : i === 1 ? second : dailyQuotaPerKey));
  }

  cached = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    keys,
    requestTimeoutMs: readInt('PT_V2_PROVIDER_TIMEOUT_MS', 30_000),
    dailyQuotaPerKey,
    ...(perKeyDailyQuota ? { perKeyDailyQuota } : {}),
    minRequestIntervalMs: readInt('PT_V2_PROVIDER_MIN_INTERVAL_MS', 2_000),
  };
  return cached;
}

/** The whole-deployment daily budget, across every configured key. Sums explicit
 *  per-key quotas when the deployment is heterogeneous; otherwise keys × the shared
 *  per-key ceiling. This is the single figure the budget governor admits against. */
export function dailyQuota(config: ProviderConfig = loadProviderConfig()): number {
  if (config.perKeyDailyQuota && config.perKeyDailyQuota.length > 0) {
    return config.perKeyDailyQuota.reduce((sum, q) => sum + q, 0);
  }
  return config.keys.length * config.dailyQuotaPerKey;
}

/** True when keys carry DIFFERENT daily ceilings — the case that makes blind
 *  round-robin unsafe (half the traffic would hit the small key and 429-storm). */
export function isHeterogeneous(config: ProviderConfig = loadProviderConfig()): boolean {
  return !!config.perKeyDailyQuota && new Set(config.perKeyDailyQuota).size > 1;
}

/** Key indices in the order the client should PREFER them: largest daily ceiling
 *  first, ties broken by declaration order (stable). Homogeneous deployments get
 *  plain declaration order (the client then round-robins over it). Pure. */
export function keyPriorityOrder(config: ProviderConfig = loadProviderConfig()): number[] {
  const indices = config.keys.map((_k, i) => i);
  const quota = (i: number): number => config.perKeyDailyQuota?.[i] ?? config.dailyQuotaPerKey;
  return indices.sort((a, b) => quota(b) - quota(a) || a - b);
}

/** Test seam. Never called by production code. */
export function resetProviderConfigForTesting(): void {
  cached = null;
}
