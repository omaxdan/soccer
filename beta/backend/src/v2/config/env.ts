// ─────────────────────────────────────────────────────────────────────────────
// V2 ENVIRONMENT FILE LOADING
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT THIS FIXES
//
// `src/config/index.ts` (V1) is evaluated at import time — `export const config =
// loadConfig()` on its last line — and V1's only `.env` load lives in
// `src/cli.ts`, the V1 entry point. The three V2 entry points never imported
// dotenv, so `npm run seed:v2` ran with a process environment that contained
// nothing from `.env`, and failed twice over:
//
//   Missing environment variables: SPORTSAPI_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
//   V2 database configuration incomplete. Missing: PT_V2_DB_HOST, PT_V2_DB_NAME.
//
// Those are ONE fault, not two. The first line comes from V1's config module,
// reached transitively because V2 modules import `src/utils/logger`, which
// imports `../config/index`. The second comes from `loadV2Config()`. Neither
// module is wrong — the file was simply never read.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY LOADING BELONGS AT THE ENTRY POINT AND NOWHERE ELSE
//
// Reading `.env` mutates `process.env`, which is process-global state. A library
// module that did it on import would impose that mutation on every importer,
// including a V1 process and the test runner, and the order in which it happened
// would depend on import graph shape rather than on any decision. Entry points
// are the only modules entitled to change the process they are the process of.
//
// This is also V1's existing pattern — `src/cli.ts:1` is `import 'dotenv/config'`
// — so V2 is not inventing a second convention, and V1's loading is untouched.
//
// ORDER MATTERS AND IS LOAD-BEARING. This module must be the FIRST import in an
// entry point. CommonJS evaluates imports in source order, and V1's config is
// evaluated the moment anything reaches `src/utils/logger`. Placed second, the
// file would be read after the value that needed it had already been computed.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS DELIBERATELY NOT DONE HERE
//
// NO FALLBACK TO V1 VARIABLES. `PT_V2_PROVIDER_KEY` is not defaulted from
// `SPORTSAPI_KEY`, and no V2 name is defaulted from a V1 name. The V2 README
// states the reason: "V1's provider configuration is deliberately not reused —
// V2 must be deployable without inheriting V1 environment." A fallback would
// make that false silently, and a deployment holding only V1 secrets would look
// configured while pointing V2 at whatever V1 happened to have.
//
// NO VALUE IS EVER RETURNED OR LOGGED. `loadV2Env()` reports variable NAMES so
// an operator can see what a file supplied; the values stay in `process.env`
// where they belong. `quiet: true` suppresses dotenv's own summary line for the
// same reason.
//
// NO OVERRIDE OF THE REAL ENVIRONMENT. dotenv's default, kept deliberately: a
// value exported by the shell, a CI secret or a container definition outranks a
// file on disk. A deployed environment injects real variables and usually has no
// `.env` at all, which is why a missing file is not an error.
// ─────────────────────────────────────────────────────────────────────────────

import { resolve } from 'node:path';
import { config as readEnvFiles } from 'dotenv';

/**
 * The backend package root, derived from this file's location rather than from
 * the working directory, so it is correct however the entry point was invoked.
 *
 * `src/v2/config/env.ts` -> three levels up is the directory holding
 * `package.json`.
 */
const PACKAGE_ROOT = resolve(__dirname, '..', '..', '..');

export interface V2EnvLoadResult {
  /** Files consulted, in precedence order. Absent files are not an error. */
  readonly paths: readonly string[];
  /**
   * Names of the variables the files supplied — NAMES ONLY, never values.
   *
   * A name that was already present in the real environment still appears here:
   * the file offered it, the environment kept precedence.
   */
  readonly namesOffered: readonly string[];
}

let loaded: V2EnvLoadResult | null = null;

/**
 * Reads `.env` into `process.env`, once per process.
 *
 * TWO PATHS, IN PRECEDENCE ORDER, and they are the same path in every supported
 * invocation. `npm run seed:v2` sets the working directory to the package root,
 * so the first entry IS the second and the behaviour is identical to V1's. The
 * second exists only so that invoking an entry point by absolute path from some
 * other directory still finds the file, instead of silently finding nothing.
 *
 * dotenv resolves an array of paths first-wins, so where the two ever differ the
 * working directory wins — the same precedence a person would expect, and the
 * same one V1 has.
 */
export function loadV2Env(): V2EnvLoadResult {
  if (loaded) return loaded;

  const paths = [resolve(process.cwd(), '.env')];
  const packageEnv = resolve(PACKAGE_ROOT, '.env');
  if (packageEnv !== paths[0]) paths.push(packageEnv);

  // A missing file returns `{ error }` rather than throwing, which is the
  // behaviour a deployed environment needs: real variables, no file.
  const outcome = readEnvFiles({ path: paths, quiet: true });

  loaded = { paths, namesOffered: Object.keys(outcome.parsed ?? {}).sort() };
  return loaded;
}

/** Test-only. Permits a second load in a process that has already loaded. */
export function resetV2EnvForTesting(): void {
  loaded = null;
}

// The side effect that makes `import '../config/env';` sufficient at an entry
// point. Module caching makes it exactly-once without a guard; the guard in
// loadV2Env() exists for the explicit call and for the test seam.
loadV2Env();
