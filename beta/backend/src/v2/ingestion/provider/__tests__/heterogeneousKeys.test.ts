// HETEROGENEOUS PROVIDER KEYS — safety tests (DB-free, network-free).
//
// Proves the required Phase-1 scenario: KEY A = 7500/day, KEY B = 100/day →
// aggregate 7600, routing prefers A (primary-first, no blind round-robin), the
// small key is a 429 spillover, failover is preserved, and keys come from env
// (never hard-coded). No provider call is made — routing is inspected, not exercised.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  dailyQuota, isHeterogeneous, keyPriorityOrder, loadProviderConfig,
  resetProviderConfigForTesting, type ProviderConfig,
} from '../config';
import { ProviderClient } from '../client';

const HETERO: ProviderConfig = {
  baseUrl: 'https://provider.invalid/api', keys: ['A', 'B'],
  requestTimeoutMs: 30_000, dailyQuotaPerKey: 7500, perKeyDailyQuota: [7500, 100],
  minRequestIntervalMs: 2_000,
};
const HOMO: ProviderConfig = {
  baseUrl: 'https://provider.invalid/api', keys: ['A', 'B'],
  requestTimeoutMs: 30_000, dailyQuotaPerKey: 100, minRequestIntervalMs: 2_000,
};

// ── pure quota math ─────────────────────────────────────────────────────────────

describe('heterogeneous keys · aggregate quota', () => {
  test('KEY A 7500 + KEY B 100 → 7600 (sum, not keys×scalar)', () => {
    assert.equal(dailyQuota(HETERO), 7600);
  });
  test('homogeneous still keys × per-key ceiling', () => {
    assert.equal(dailyQuota(HOMO), 200);
  });
  test('single key → that key’s ceiling', () => {
    assert.equal(dailyQuota({ ...HOMO, keys: ['A'] }), 100);
  });
});

describe('heterogeneous keys · classification & priority', () => {
  test('different ceilings are heterogeneous; equal ceilings are not', () => {
    assert.equal(isHeterogeneous(HETERO), true);
    assert.equal(isHeterogeneous(HOMO), false);
    assert.equal(isHeterogeneous({ ...HETERO, perKeyDailyQuota: [100, 100] }), false); // equal → homogeneous
  });
  test('priority is capacity-descending; largest key first regardless of declaration order', () => {
    assert.deepEqual(keyPriorityOrder(HETERO), [0, 1]); // A(7500) before B(100)
    // declared small-first, quota still ranks the big key first
    assert.deepEqual(keyPriorityOrder({ ...HETERO, keys: ['B', 'A'], perKeyDailyQuota: [100, 7500] }), [1, 0]);
    assert.deepEqual(keyPriorityOrder(HOMO), [0, 1]); // ties → declaration order
  });
});

// ── client routing (no network) ────────────────────────────────────────────────

describe('heterogeneous keys · client routing', () => {
  test('heterogeneous → PRIMARY_FIRST, starts on the largest key, aggregate 7600', () => {
    const client = new ProviderClient(HETERO);
    assert.equal(client.routing.mode, 'PRIMARY_FIRST');
    assert.equal(client.routing.priority[0], 0);       // KEY A (7500) is primary
    assert.equal(client.routing.aggregateDailyQuota, 7600);
  });
  test('homogeneous → ROUND_ROBIN over equal budgets (safe), aggregate 200', () => {
    const client = new ProviderClient(HOMO);
    assert.equal(client.routing.mode, 'ROUND_ROBIN');
    assert.equal(client.routing.aggregateDailyQuota, 200);
  });
  test('failover is still available — more than one transport exists', () => {
    const client = new ProviderClient(HETERO);
    assert.ok(client.routing.priority.length > 1); // spillover key present for 429 failover
  });
});

// ── env wiring (keys are configuration, not source) ──────────────────────────────

describe('heterogeneous keys · loadProviderConfig env wiring', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetProviderConfigForTesting();
  });

  test('PT_V2_PROVIDER_DAILY_QUOTA_2 marks the deployment heterogeneous and sums correctly', () => {
    resetProviderConfigForTesting();
    process.env.PT_V2_PROVIDER_BASE_URL = 'https://provider.invalid/api';
    process.env.PT_V2_PROVIDER_KEY = 'from-env-A';
    process.env.PT_V2_PROVIDER_KEY_2 = 'from-env-B';
    process.env.PT_V2_PROVIDER_DAILY_QUOTA = '7500';
    process.env.PT_V2_PROVIDER_DAILY_QUOTA_2 = '100';
    const cfg = loadProviderConfig();
    assert.deepEqual(cfg.perKeyDailyQuota, [7500, 100]);
    assert.equal(dailyQuota(cfg), 7600);
    assert.equal(isHeterogeneous(cfg), true);
  });

  test('without the second quota the deployment stays homogeneous (no perKeyDailyQuota)', () => {
    resetProviderConfigForTesting();
    process.env.PT_V2_PROVIDER_BASE_URL = 'https://provider.invalid/api';
    process.env.PT_V2_PROVIDER_KEY = 'from-env-A';
    process.env.PT_V2_PROVIDER_KEY_2 = 'from-env-B';
    process.env.PT_V2_PROVIDER_DAILY_QUOTA = '100';
    delete process.env.PT_V2_PROVIDER_DAILY_QUOTA_2;
    const cfg = loadProviderConfig();
    assert.equal(cfg.perKeyDailyQuota, undefined);
    assert.equal(dailyQuota(cfg), 200);
  });

  test('keys are required from env — never defaulted from source (fail-fast)', () => {
    resetProviderConfigForTesting();
    process.env.PT_V2_PROVIDER_BASE_URL = 'https://provider.invalid/api';
    delete process.env.PT_V2_PROVIDER_KEY;
    delete process.env.PT_V2_PROVIDER_KEY_2;
    assert.throws(() => loadProviderConfig(), /PT_V2_PROVIDER_KEY is required/);
  });
});
