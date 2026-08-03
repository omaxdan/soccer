// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER CLIENT
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY NOT REUSE V1's SportsAPIClient
//
// V1's client is competent — dual-key round robin, failover on 429 rather than
// blind backoff, a considered 62-second window wait when both keys are spent.
// That behaviour is preserved here, not discarded.
//
// What it cannot do is account for what it spent. Its own comment concedes the
// point: call counts are "in-memory only (resets on process restart) — useful
// for run-level visibility ... NOT a persistent historical record". Making it
// persistent would mean editing a V1 file, and V1 is untouched.
//
// So this client wraps the same tactics around one addition: EVERY REQUEST IS
// OBSERVED, and the observations fold into operations.api_usage windows through
// the S-2 accumulator. Nothing else about the retry policy changes.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CLIENT DOES NOT WRITE
//
// It accumulates. Flushing to operations.api_usage needs a connection as
// pt_pipeline_ingestion, and this class holds none — it is HTTP and arithmetic.
// The pipeline flushes at stage boundaries, on the control connection, so usage
// survives a rollback of the work it paid for. A run that failed still spent its
// quota, and a quota record lost with the rollback would tell the next run it
// has budget it does not have.
// ─────────────────────────────────────────────────────────────────────────────

import axios, { AxiosInstance, AxiosError } from 'axios';
import { ApiUsageWindowBuilder } from '../../operations/apiUsage';
import { PROVIDER_CODE, loadProviderConfig, type ProviderConfig } from './config';
import { ENDPOINTS, resolvePath, type EndpointKey } from './endpoints';
import { logger } from '../../../utils/logger';

/** Attempts per request, matching V1: immediate, other key, window wait, final. */
const MAX_ATTEMPTS = 4;
const INITIAL_BACKOFF_MS = 1_000;
/** 60s provider window plus 2s of slack, as V1 established empirically. */
const WINDOW_RESET_WAIT_MS = 62_000;

/** Raised when the provider refuses a request in a way retrying cannot fix. */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly endpointKey: EndpointKey,
    readonly status: number | undefined,
    readonly attempts: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }

  /**
   * Whether the provider said the resource does not exist.
   *
   * Distinguished because it is a DATA condition, not a transport failure: a
   * team with no squad, a season with no standings. The caller records it and
   * continues rather than aborting the stage.
   */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export class ProviderClient {
  private readonly config: ProviderConfig;
  private readonly transports: AxiosInstance[];
  private roundRobin = 0;
  private lastRequestAt = 0;

  /** One usage accumulator per endpoint. Windows are per endpoint by schema. */
  private readonly usage = new Map<EndpointKey, ApiUsageWindowBuilder>();

  constructor(config: ProviderConfig = loadProviderConfig()) {
    this.config = config;
    this.transports = config.keys.map((key) =>
      axios.create({
        baseURL: config.baseUrl,
        timeout: config.requestTimeoutMs,
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      })
    );
    logger.info(
      { keys: config.keys.length, dailyBudget: config.keys.length * config.dailyQuotaPerKey },
      'v2 ingestion: provider client ready'
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Honours the minimum interval between requests.
   *
   * The squad endpoint requires one request per two seconds. Applied globally
   * rather than per endpoint because the limit is the provider's, not the path's,
   * and the cost of being too polite is latency while the cost of being
   * impolite is a 429 that consumes budget and returns nothing.
   */
  private async throttle(): Promise<void> {
    const since = Date.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && since < this.config.minRequestIntervalMs) {
      await this.sleep(this.config.minRequestIntervalMs - since);
    }
    this.lastRequestAt = Date.now();
  }

  private accumulator(key: EndpointKey): ApiUsageWindowBuilder {
    let builder = this.usage.get(key);
    if (!builder) {
      builder = new ApiUsageWindowBuilder(PROVIDER_CODE, key);
      this.usage.set(key, builder);
    }
    return builder;
  }

  /**
   * Reads the provider's own remaining-quota header, when it sends one.
   *
   * Returns null rather than a guess when absent. `api_usage.quota_remaining` is
   * nullable precisely so an unreported figure stays unreported — a computed
   * estimate stored in a column meaning "what the provider said" would be a
   * fabricated observation, and the next run would act on it.
   */
  private static remainingFromHeaders(headers: unknown): number | null {
    if (!headers || typeof headers !== 'object') return null;
    const bag = headers as Record<string, unknown>;
    for (const name of ['x-ratelimit-remaining', 'x-quota-remaining', 'ratelimit-remaining']) {
      const raw = bag[name];
      if (typeof raw === 'string' || typeof raw === 'number') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return null;
  }

  /**
   * Issues one request, retrying transport failures and rate limits.
   *
   * EVERY ATTEMPT IS OBSERVED, including the ones that fail. A 429 consumed
   * budget; recording only successes would report a spend lower than the one the
   * provider actually charged, which is the specific way quota accounting goes
   * wrong and stays wrong.
   */
  async get<T>(key: EndpointKey, params: Record<string, string | number> = {}): Promise<T> {
    const path = resolvePath(key, params);
    const builder = this.accumulator(key);
    let transportIndex = this.roundRobin++ % this.transports.length;
    let lastStatus: number | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.throttle();
      try {
        const response = await this.transports[transportIndex].get<T>(path);
        builder.observe({ remaining: ProviderClient.remainingFromHeaders(response.headers) });
        return response.data;
      } catch (error) {
        lastError = error;
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        lastStatus = status;

        const rateLimited = status === 429;
        builder.observe({
          throttled: rateLimited,
          remaining: ProviderClient.remainingFromHeaders(axiosError.response?.headers),
        });

        // 404 is a data condition, not a transport failure. Retrying cannot
        // conjure a squad that does not exist, and each retry costs budget.
        if (status === 404) break;
        // 4xx other than 429 means the request itself is wrong. Retrying repeats
        // the same mistake at the same price.
        if (status !== undefined && status >= 400 && status < 500 && !rateLimited) break;

        const retryable =
          rateLimited ||
          status === undefined ||
          status >= 500 ||
          axiosError.code === 'ECONNABORTED' ||
          axiosError.code === 'ETIMEDOUT';
        if (!retryable || attempt === MAX_ATTEMPTS - 1) break;

        if (rateLimited && this.transports.length > 1) {
          const other = (transportIndex + 1) % this.transports.length;
          // Failing over is only useful the FIRST time. If the other key has
          // already answered 429 this request, the per-minute window is fully
          // consumed and switching back just spends the same exhausted budget.
          const alreadyFailedOver = attempt > 0;
          if (alreadyFailedOver) {
            logger.warn({ path, waitMs: WINDOW_RESET_WAIT_MS }, 'v2 ingestion: both keys rate-limited, waiting for window reset');
            await this.sleep(WINDOW_RESET_WAIT_MS);
          } else {
            logger.warn({ path }, 'v2 ingestion: rate limited, failing over to second key');
            transportIndex = other;
          }
          continue;
        }

        const backoff = INITIAL_BACKOFF_MS * 2 ** attempt;
        logger.warn({ path, status, attempt: attempt + 1, backoff }, 'v2 ingestion: provider request failed, retrying');
        await this.sleep(backoff);
      }
    }

    throw new ProviderRequestError(
      `${ENDPOINTS[key].key} ${path} failed` + (lastStatus ? ` with status ${lastStatus}` : ''),
      key,
      lastStatus,
      MAX_ATTEMPTS,
      lastError
    );
  }

  /** Calls observed since the last flush, across every endpoint. */
  get pendingCallCount(): number {
    let total = 0;
    for (const builder of this.usage.values()) total += builder.callCount;
    return total;
  }

  /**
   * Writes every accumulated window to operations.api_usage and resets.
   *
   * Takes a connection rather than opening one, so the caller decides which —
   * and the caller passes the CONTROL connection, outside the work transaction,
   * so the record of what was spent survives a rollback of what it bought.
   */
  async flushUsage(control: import('pg').PoolClient): Promise<number> {
    let written = 0;
    for (const [key, builder] of this.usage) {
      const result = await builder.flush(control);
      if (result) written += 1;
      this.usage.delete(key);
    }
    return written;
  }
}
