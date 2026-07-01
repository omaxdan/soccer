import axios, { AxiosInstance } from 'axios';
import { config } from '../config/index';
import { logger } from '../utils/logger';

// 4 retries: attempt 1 = immediate, attempt 2 = failover to other key,
// attempt 3 = 62s window-reset wait if both keys exhausted, attempt 4 = final.
const MAX_RETRIES = 4;
const INITIAL_DELAY_MS = 1000;

/**
 * SportsAPI Pro client with optional dual-key support.
 *
 * If SPORTSAPI_KEY_2 is set, requests round-robin between both keys,
 * doubling the effective daily quota (100/day per key -> 200/day total).
 * Each key is presumed to have its own independent quota bucket on the
 * provider's side (separate API key = separate subscription/limit).
 *
 * Failover behavior: a 429 (rate limit) on one key immediately retries
 * on the OTHER key rather than backing off and retrying the same
 * (already-exhausted) key — this is strictly better than blind backoff
 * when a second key is available, since the other key likely still has
 * budget remaining.
 *
 * Call counting is in-memory only (resets on process restart) — useful
 * for run-level visibility into how the daily budget was spent, NOT a
 * persistent historical record. For true cross-run quota tracking, the
 * provider's own dashboard/usage page is the source of truth.
 */
export class SportsAPIClient {
  private clients: AxiosInstance[];
  private keyLabels: string[];
  private rrIndex = 0;
  private callCounts: number[];

  constructor() {
    const keys = [config.sportsapi.key, config.sportsapi.key2].filter(
      (k): k is string => !!k
    );

    if (keys.length === 0) {
      logger.error('No SportsAPI key configured — set SPORTSAPI_KEY');
    }
    if (keys.length === 2) {
      logger.info('Dual-key mode enabled — effective daily quota doubled (100 -> 200)');
    }

    this.clients = keys.map(key =>
      axios.create({
        baseURL: config.sportsapi.baseUrl,
        headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        timeout: 30000,
      })
    );
    this.keyLabels = keys.map((_, i) => `key${i + 1}`);
    this.callCounts = keys.map(() => 0);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getBackoffDelay(retryCount: number): number {
    return INITIAL_DELAY_MS * Math.pow(2, retryCount);
  }

  /** Returns the index of the next key to use, round-robin. */
  private nextKeyIndex(): number {
    const idx = this.rrIndex % this.clients.length;
    this.rrIndex++;
    return idx;
  }

  /** In-memory call counts per key, for this process run only. */
  getCallCounts(): Record<string, number> {
    return Object.fromEntries(this.keyLabels.map((label, i) => [label, this.callCounts[i]]));
  }

  async get<T>(
    path: string,
    params?: Record<string, any>
  ): Promise<T> {
    if (this.clients.length === 0) {
      throw new Error('SportsAPIClient: no API keys configured');
    }

    let lastError: Error | null = null;
    let keyIdx = this.nextKeyIndex();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.clients[keyIdx].get<T>(path, { params });
        this.callCounts[keyIdx]++;
        return response.data;
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;
        const isRateLimit = status === 429;
        const isServerError = status >= 500 && status < 600;
        const isTimeout = error.code === 'ECONNABORTED';
        const isRetryable = isRateLimit || isServerError || isTimeout;

        if (attempt < MAX_RETRIES && isRetryable) {
          if (isRateLimit && this.clients.length > 1) {
            const otherIdx = (keyIdx + 1) % this.clients.length;

            // Only immediately fail over to the other key if we haven't
            // tried it yet this attempt. If we have (both keys returned 429
            // on consecutive tries), the per-minute window is fully consumed
            // by concurrent requests — immediate failover just burns the same
            // budget again. Wait for the rate-limit window to reset instead.
            const alreadyTriedOther = attempt > 0 && (attempt % this.clients.length !== 0);
            if (alreadyTriedOther) {
              const waitMs = 62000; // 60s rate-limit window + 2s buffer
              logger.warn(
                { path, waitMs, attempt: attempt + 1 },
                'Both API keys rate-limited — waiting 62s for per-minute window to reset'
              );
              await this.sleep(waitMs);
            } else {
              logger.warn(
                { from: this.keyLabels[keyIdx], to: this.keyLabels[otherIdx], path },
                'Rate limited — failing over to other API key'
              );
              keyIdx = otherIdx;
              continue; // immediate failover — other key not yet tried
            }
          } else {
            const delay = this.getBackoffDelay(attempt);
            logger.warn(
              { attempt: attempt + 1, status, delay, path, key: this.keyLabels[keyIdx] },
              `Retrying request after ${delay}ms`
            );
            await this.sleep(delay);
          }
        } else {
          logger.error(
            { attempt: attempt + 1, status, message: error.message, path, key: this.keyLabels[keyIdx] },
            'Request failed after retries'
          );
          throw lastError;
        }
      }
    }

    throw lastError;
  }
}

export const sportsApiClient = new SportsAPIClient();
