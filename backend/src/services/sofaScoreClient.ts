/**
 * SofaScore Direct API Client
 *
 * IMPORTANT: Currently unused for squad sync.
 *
 * SofaScore blocks Node.js server requests with Cloudflare 403s even with
 * browser-like headers. SportsAPI Pro is a SofaScore data reseller and
 * provides the same data (same IDs, same schema) without this restriction.
 *
 * syncSquadSofaScore.ts uses sportsApiClient instead.
 *
 * This client is kept for:
 *   - Future use if a Cloudflare bypass solution is implemented
 *   - Self-hosted SofaScore proxy configurations
 *   - Testing direct SofaScore access from environments with whitelisted IPs
 *
 * If you have a SofaScore enterprise agreement or proxy:
 *   Set SOFASCORE_BASE_URL=https://your-proxy.example.com/api/v1
 *   Then use this client directly in syncSquadSofaScore.ts
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config/index';
import { logger } from '../utils/logger';

const MAX_RETRIES     = 3;
const INITIAL_DELAY   = 2000;  // 2s base — SofaScore is stricter than SportsAPI
const CLOUDFLARE_WAIT = 30000; // 30s back-off on 429 / 503

export class SofaScoreClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.sofascore.baseUrl,
      timeout: 30000,
      headers: {
        // Browser-like headers required — SofaScore blocks bare axios User-Agent
        'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':           'application/json, text/plain, */*',
        'Accept-Language':  'en-US,en;q=0.9',
        'Accept-Encoding':  'gzip, deflate, br',
        'Referer':          'https://www.sofascore.com/',
        'Origin':           'https://www.sofascore.com',
        'Sec-Fetch-Dest':   'empty',
        'Sec-Fetch-Mode':   'cors',
        'Sec-Fetch-Site':   'same-site',
        'Cache-Control':    'no-cache',
        'DNT':              '1',
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private backoff(attempt: number): number {
    return INITIAL_DELAY * Math.pow(2, attempt); // 2s, 4s, 8s
  }

  async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.get<T>(path, { params });
        return response.data;
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;

        // 404 = team not in SofaScore → don't retry
        if (status === 404) throw error;

        // 403 = Cloudflare blocking server request → will never succeed, don't retry
        if (status === 403) {
          logger.error({ path }, 'SofaScore 403 — Cloudflare blocking server request. Use SportsAPI Pro instead.');
          throw error;
        }

        // 429 = rate limit, 503 = Cloudflare → long back-off
        if (status === 429 || status === 503) {
          const wait = CLOUDFLARE_WAIT;
          logger.warn({ attempt: attempt + 1, status, path, wait }, `SofaScore rate limited — waiting ${wait / 1000}s`);
          await this.sleep(wait);
          continue;
        }

        // 5xx or timeout → exponential back-off
        const retryable = !status || status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
        if (attempt < MAX_RETRIES && retryable) {
          const wait = this.backoff(attempt);
          logger.warn({ attempt: attempt + 1, status, path, wait }, `SofaScore request failed — retrying in ${wait}ms`);
          await this.sleep(wait);
          continue;
        }

        logger.error({ attempt: attempt + 1, status, message: error.message, path }, 'SofaScore request failed after retries');
        throw error;
      }
    }

    throw lastError;
  }
}

export const sofaScoreClient = new SofaScoreClient();
