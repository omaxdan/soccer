// ─────────────────────────────────────────────────────────────────────────────
// S-4 PROVIDER EVIDENCE RUNNER — `npm run discover:v2`
//
// WHAT THIS IS FOR
//
// Nothing in V2 may assume a provider response shape. Doc 35 recorded the
// provider capability question as OPEN precisely because no live payload had
// ever been captured, and the endpoint registry says so in its own descriptions:
// page numbering, page size, the termination condition and empty-page behaviour
// of the events feed are UNVERIFIED. This runner is how they stop being
// unverified — by asking, once, cheaply, and writing down exactly what came
// back.
//
// It is NOT an ingestion. It writes no database row, opens no pool and needs no
// database at all: a provider key and a writable directory are the whole
// dependency list. That is deliberate — evidence collection must not be able to
// fail because something unrelated is down.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE BUDGET IS A REFUSAL, NOT A WARNING
//
// The account allows roughly 200 calls a day across two keys. A discovery tool
// that could overspend is worse than no tool, because the quota it burns is the
// quota the real ingestion needs. `--max-calls` is checked BEFORE each request
// and the runner stops rather than exceeding it. The default is 3, which is the
// minimum that answers the pagination question.
//
// ─────────────────────────────────────────────────────────────────────────────
// IT REFUSES TO GUESS
//
// After the seasons call, this needs a season id to continue. It looks for one
// conservatively, and if the response does not match a shape it recognises it
// STOPS — having spent one call — and tells the operator which file to read and
// to re-run with `--season`. Inventing a traversal for an unseen payload is the
// exact failure this phase exists to prevent.
//
// ─────────────────────────────────────────────────────────────────────────────
// NO CREDENTIAL IS EVER WRITTEN
//
// The api key travels in a header and never enters an observation. Files carry
// the base URL, the resolved path, the parameters, the status and the body. The
// runner prints key COUNT and quota, never key material.
// ─────────────────────────────────────────────────────────────────────────────

import '../config/env';

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ProviderClient, ProviderRequestError, type ProviderObservation } from './provider/client';
import { dailyQuota, loadProviderConfig, PROVIDER_CODE } from './provider/config';
import type { EndpointKey } from './provider/endpoints';
import { logger } from '../../utils/logger';

/* eslint-disable no-console */

/** Where evidence lands. Alongside V1's samples, in its own subdirectory. */
export const EVIDENCE_DIR = resolve(__dirname, '..', '..', '..', 'docs', 'api-samples', 'v2-discovery');

/** Minimum that answers the pagination question: seasons, page 0, page 1. */
export const DEFAULT_MAX_CALLS = 3;

export interface DiscoveryArguments {
  readonly tournamentId: string;
  readonly seasonId?: string;
  readonly maxCalls: number;
}

export function parseArguments(argv: readonly string[]): DiscoveryArguments {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${arg} expects a value.`);
    values.set(arg, next);
    i += 1;
  }

  const tournamentId = values.get('--tournament');
  if (!tournamentId) {
    throw new Error(
      'A tournament id is required: --tournament <providerTournamentId>.\n' +
        '  Find one already in the V2 database with:\n' +
        "    SELECT name, provider_external_id FROM football.competition\n" +
        "     WHERE provider_external_id IS NOT NULL ORDER BY name LIMIT 20;\n" +
        '  Pick a band-A competition — a busy one gives the most informative pages.'
    );
  }

  const rawMax = values.get('--max-calls');
  if (rawMax !== undefined && !/^\d+$/.test(rawMax)) {
    throw new Error(`--max-calls expects a whole number, received '${rawMax}'.`);
  }
  const maxCalls = rawMax === undefined ? DEFAULT_MAX_CALLS : Number(rawMax);
  if (maxCalls < 1) throw new Error('--max-calls must be at least 1.');

  return { tournamentId, seasonId: values.get('--season'), maxCalls };
}

/**
 * A deterministic filename for one request.
 *
 * Same request, same file — so a re-run overwrites its own evidence rather than
 * accumulating near-duplicates, and a diff between two runs is meaningful.
 */
export function evidenceFilename(
  endpointKey: string,
  parameters: Record<string, string | number>
): string {
  const suffix = Object.entries(parameters)
    .sort(([a], [b]) => a.localeCompare(b))
    // Separators are replaced, and so is any run of dots: a parameter is
    // provider-supplied text, and `..` in a filename is worth removing even
    // though the absence of a separator already keeps it inside the directory.
    .map(
      ([name, value]) =>
        `${name}-${String(value).replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '_')}`
    )
    .join('__');
  return suffix ? `${endpointKey}__${suffix}.json` : `${endpointKey}.json`;
}

interface EvidenceRecord {
  readonly capturedAt: string;
  readonly provider: string;
  readonly endpointKey: string;
  readonly method: 'GET';
  readonly url: string;
  readonly path: string;
  readonly parameters: Record<string, string | number>;
  readonly status: number | null;
  readonly success: boolean;
  readonly attempts: number;
  readonly quotaRemaining: number | null;
  readonly responseSha256: string;
  readonly bodyBytes: number;
  readonly body: unknown;
  readonly error?: string;
}

function write(record: EvidenceRecord): string {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = join(EVIDENCE_DIR, evidenceFilename(record.endpointKey, record.parameters));
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
}

function toRecord(
  observation: ProviderObservation<unknown>,
  capturedAt: string
): EvidenceRecord {
  const serialised = JSON.stringify(observation.data ?? null);
  return {
    capturedAt,
    provider: PROVIDER_CODE,
    endpointKey: observation.endpointKey,
    method: 'GET',
    url: observation.url,
    path: observation.path,
    parameters: observation.parameters,
    status: observation.status,
    success: true,
    attempts: observation.attempts,
    quotaRemaining: observation.quotaRemaining,
    responseSha256: createHash('sha256').update(serialised).digest('hex'),
    bodyBytes: Buffer.byteLength(serialised, 'utf8'),
    body: observation.data,
  };
}

/**
 * Describes a payload's shape without printing its contents.
 *
 * The operator needs to know what came back before deciding what to ask next,
 * and a wall of JSON in a terminal is not that. Keys and lengths are.
 */
export function describeShape(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `array(${value.length})${value.length > 0 && depth < 2 ? ` of ${describeShape(value[0], depth + 1)}` : ''}`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (depth >= 2) return `object{${keys.length} keys}`;
    return `object{ ${keys.slice(0, 24).join(', ')}${keys.length > 24 ? ', …' : ''} }`;
  }
  return typeof value;
}

/**
 * The first season id in a seasons payload, or null when the shape is unknown.
 *
 * CONSERVATIVE BY DESIGN. It checks the handful of envelopes this provider is
 * already known to use elsewhere in the codebase — a bare array, `data`, or a
 * named collection — and gives up rather than searching creatively. A creative
 * search that found the wrong number would send every later call to the wrong
 * season, and the evidence would look plausible.
 */
export function firstSeasonId(payload: unknown): string | null {
  const containers: unknown[] = [payload];
  const record = payload as Record<string, unknown> | null;
  if (record && typeof record === 'object') {
    for (const key of ['data', 'seasons', 'results']) {
      if (key in record) containers.push(record[key]);
      const nested = record.data as Record<string, unknown> | undefined;
      if (nested && typeof nested === 'object' && key in nested) containers.push(nested[key]);
    }
  }
  for (const container of containers) {
    if (!Array.isArray(container) || container.length === 0) continue;
    const first = container[0] as Record<string, unknown> | null;
    if (!first || typeof first !== 'object') continue;
    const id = first.id ?? first.seasonId;
    if (typeof id === 'number' || (typeof id === 'string' && id.length > 0)) return String(id);
  }
  return null;
}

/** Enforces the budget by refusing, and keeps the count honest. */
class Budget {
  private spent = 0;
  constructor(private readonly max: number) {}

  /** Throws rather than allowing the call. Checked BEFORE each request. */
  claim(what: string): void {
    if (this.spent >= this.max) {
      throw new Error(
        `Budget exhausted: ${this.spent} of ${this.max} calls used, and '${what}' would be ` +
          `number ${this.spent + 1}. Re-run with a higher --max-calls if that is intended.`
      );
    }
    this.spent += 1;
  }

  get used(): number {
    return this.spent;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  const capturedAt = new Date().toISOString();

  // FAIL SAFELY, BEFORE SPENDING ANYTHING. loadProviderConfig throws a message
  // naming the missing variable, which is the whole diagnosis.
  const config = loadProviderConfig();
  console.log('\nV2 PROVIDER DISCOVERY — evidence only, no ingestion\n');
  console.log(`  provider        ${PROVIDER_CODE}`);
  console.log(`  base url        ${config.baseUrl}`);
  console.log(`  keys            ${config.keys.length} configured (values never printed)`);
  console.log(`  daily budget    ${dailyQuota(config)} calls`);
  console.log(`  this run        at most ${args.maxCalls}`);
  console.log(`  evidence dir    ${EVIDENCE_DIR}\n`);

  const client = new ProviderClient(config);
  const budget = new Budget(args.maxCalls);
  const written: string[] = [];
  let lastQuotaRemaining: number | null = null;

  const capture = async (
    endpointKey: EndpointKey,
    parameters: Record<string, string | number>
  ): Promise<unknown> => {
    budget.claim(endpointKey);
    console.log(`  [${budget.used}/${args.maxCalls}] GET ${endpointKey} ${JSON.stringify(parameters)}`);
    try {
      const observation = await client.getObserved<unknown>(endpointKey, parameters);
      const record = toRecord(observation, capturedAt);
      lastQuotaRemaining = observation.quotaRemaining ?? lastQuotaRemaining;
      written.push(write(record));
      console.log(
        `        ${observation.status}  ${record.bodyBytes} bytes  sha256 ${record.responseSha256.slice(0, 12)}` +
          `  attempts ${observation.attempts}`
      );
      console.log(`        shape: ${describeShape(observation.data)}`);
      return observation.data;
    } catch (error) {
      const failure = error instanceof ProviderRequestError ? error : null;
      const message = error instanceof Error ? error.message : String(error);
      // A FAILURE IS EVIDENCE TOO. It is written with the same envelope so the
      // request that produced it is as reproducible as a success.
      written.push(
        write({
          capturedAt,
          provider: PROVIDER_CODE,
          endpointKey,
          method: 'GET',
          url: `${config.baseUrl}${failure?.message ?? ''}`.split(' ')[0],
          path: '(see error)',
          parameters,
          status: failure?.status ?? null,
          success: false,
          attempts: 0,
          quotaRemaining: lastQuotaRemaining,
          responseSha256: '',
          bodyBytes: 0,
          body: null,
          error: message,
        })
      );
      console.log(`        FAILED  status ${failure?.status ?? '(none)'}  ${message}`);
      throw error;
    }
  };

  try {
    // ── 1. Seasons, unless the operator already knows the season id ──────────
    let seasonId = args.seasonId;
    if (!seasonId) {
      const seasons = await capture('tournament_seasons', { tournamentId: args.tournamentId });
      seasonId = firstSeasonId(seasons) ?? undefined;
      if (!seasonId) {
        console.log('\n  STOPPING — no season id could be read from that payload, and this');
        console.log('  runner does not guess. One call was spent and the response is saved.');
        console.log(`  Read ${written[0]}`);
        console.log('  then re-run with:  npm run discover:v2 -- --tournament <id> --season <id>\n');
        return;
      }
      console.log(`        season id resolved: ${seasonId}`);
    } else {
      console.log(`  season id supplied: ${seasonId} — skipping the seasons call\n`);
    }

    // ── 2 & 3. Two consecutive pages, which is what answers the question ─────
    // One page shows the envelope. TWO show whether the page number advances,
    // whether page size is fixed, whether ids repeat, and what an empty page
    // looks like if page 1 is past the end. One page answers none of that.
    for (const page of [0, 1]) {
      await capture('tournament_season_events_last', {
        tournamentId: args.tournamentId,
        seasonId,
        page,
      });
    }
  } catch (error) {
    console.log(`\n  Run stopped: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    console.log(`\n  calls used      ${budget.used} of ${args.maxCalls}`);
    console.log(
      `  quota remaining ${lastQuotaRemaining ?? '(the provider did not say)'}`
    );
    console.log('  files written:');
    for (const file of written) console.log(`    ${file}`);
    console.log('');
    logger.info({ calls: budget.used, files: written.length }, 'v2 discovery: complete');
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('\nv2 discovery FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
