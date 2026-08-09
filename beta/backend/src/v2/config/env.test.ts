// ─────────────────────────────────────────────────────────────────────────────
// V2 ENVIRONMENT LOADING TESTS
//
// No database required. Two spawned child processes, both against a temporary
// working directory, neither able to reach a real database — see the note above
// the end-to-end block for why that is guaranteed rather than hoped for.
//
// The suite proves four separate things, because the defect had four separable
// parts and a fix that satisfied three of them would still be wrong:
//
//   1. the loader reads `.env`, reports NAMES only, and never overrides the real
//      environment;
//   2. the three V2 entry points load it FIRST, which is the property that makes
//      it work at all — V1's config module is evaluated on import, so a load
//      placed second would happen after the value that needed it;
//   3. V2 does not fall back to V1's `SPORTSAPI_*` variables;
//   4. V1 is unchanged — its config module still loads no `.env` of its own and
//      still requires exactly the three variables it always required.
//
// The control at the end runs the same probe WITHOUT the loader and asserts both
// original failure messages reappear. Without it, the end-to-end assertions
// would pass just as happily against a machine that never had the bug.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadV2Env, resetV2EnvForTesting } from './env';
import { loadProviderConfig, resetProviderConfigForTesting } from '../ingestion/provider/config';

const PACKAGE_ROOT = resolve(__dirname, '..', '..', '..');
const SRC = join(PACKAGE_ROOT, 'src');

const ENTRY_POINTS = [
  join(SRC, 'v2', 'seed', 'runAll.ts'),
  join(SRC, 'v2', 'ingestion', 'cli.ts'),
  join(SRC, 'v2', 'feature', 'cli.ts'),
];

/** TypeScript import specifiers use forward slashes on every platform. */
function specifier(path: string): string {
  return path.replace(/\\/g, '/');
}

function readdirRecursive(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? readdirRecursive(full) : [full];
  });
}

function withTempDir<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'ptv2-env-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs `body` with the process working directory moved, then restores it. */
function inDirectory<T>(dir: string, body: () => T): T {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return body();
  } finally {
    process.chdir(previous);
  }
}

describe('the loader itself', () => {
  test('reads a .env in the working directory and reports NAMES, never values', () => {
    withTempDir((dir) => {
      const name = `PT_V2_TEST_ONLY_${Date.now()}`;
      const secret = 'this-value-must-never-appear-in-a-result-or-a-log';
      writeFileSync(join(dir, '.env'), `${name}=${secret}\n`);

      resetV2EnvForTesting();
      const result = inDirectory(dir, loadV2Env);
      try {
        assert.ok(
          result.namesOffered.includes(name),
          'the variable name the file supplied should be reported'
        );
        assert.equal(process.env[name], secret, 'the value belongs in process.env');
        assert.ok(
          !JSON.stringify(result).includes(secret),
          'a secret must never be returned — the result carries names only'
        );
      } finally {
        delete process.env[name];
      }
    });
  });

  test('the real environment outranks the file', () => {
    withTempDir((dir) => {
      const name = `PT_V2_TEST_ONLY_PRECEDENCE_${Date.now()}`;
      writeFileSync(join(dir, '.env'), `${name}=from-the-file\n`);
      process.env[name] = 'from-the-environment';

      resetV2EnvForTesting();
      inDirectory(dir, loadV2Env);
      try {
        // A CI secret, a container definition or an exported shell variable must
        // outrank a file on disk. This is dotenv's default and it is kept.
        assert.equal(
          process.env[name],
          'from-the-environment',
          'a value already in the environment must not be replaced by the file'
        );
      } finally {
        delete process.env[name];
      }
    });
  });

  test('a missing .env is not an error', () => {
    withTempDir((dir) => {
      resetV2EnvForTesting();
      // A deployed environment injects real variables and has no file at all.
      assert.doesNotThrow(() => inDirectory(dir, loadV2Env));
    });
  });

  test('the working directory takes precedence over the package root', () => {
    resetV2EnvForTesting();
    const result = loadV2Env();
    assert.equal(
      result.paths[0],
      resolve(process.cwd(), '.env'),
      'the working directory is consulted first, which is what V1 does'
    );
    assert.ok(
      result.paths.includes(resolve(PACKAGE_ROOT, '.env')) ||
        result.paths[0] === resolve(PACKAGE_ROOT, '.env'),
      'the package root is consulted, so an absolute invocation still finds the file'
    );
  });

  test('loading is idempotent', () => {
    resetV2EnvForTesting();
    const first = loadV2Env();
    assert.equal(loadV2Env(), first, 'a second call must not re-read the file');
  });
});

describe('the entry points load it first', () => {
  // ORDER IS THE WHOLE FIX. CommonJS evaluates imports in source order, and
  // `src/config/index.ts` computes its value at import time, reached through
  // `src/utils/logger`. An env load placed second runs after the computation
  // that needed it. This is asserted on the source because the property IS a
  // source property — no runtime observation distinguishes "first" from
  // "second but nothing else read the environment yet".
  for (const entry of ENTRY_POINTS) {
    test(`${entry.slice(SRC.length + 1)} imports the loader before anything else`, () => {
      const lines = readFileSync(entry, 'utf8').split(/\r?\n/);
      const firstImport = lines.find((line) => line.startsWith('import '));
      assert.equal(
        firstImport,
        "import '../config/env';",
        'the env loader must be the first import in a V2 entry point'
      );
    });
  }

  test('every V2 entry point is covered — a fourth cannot be added unnoticed', () => {
    // An entry point is a module that runs itself. Discovered rather than
    // listed, so adding one without env loading fails here instead of failing in
    // production with a message about a variable the operator did set.
    const discovered = readdirRecursive(join(SRC, 'v2'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('require.main === module'))
      .sort();

    assert.deepEqual(
      discovered,
      [...ENTRY_POINTS].sort(),
      'a self-executing V2 module must be listed above and must load the env file'
    );
  });
});

describe('V2 does not fall back to V1 configuration', () => {
  test('V1 provider variables do not satisfy V2 provider configuration', () => {
    const saved = {
      base: process.env.PT_V2_PROVIDER_BASE_URL,
      key: process.env.PT_V2_PROVIDER_KEY,
      key2: process.env.PT_V2_PROVIDER_KEY_2,
      v1Base: process.env.SPORTSAPI_BASE_URL,
      v1Key: process.env.SPORTSAPI_KEY,
    };
    delete process.env.PT_V2_PROVIDER_BASE_URL;
    delete process.env.PT_V2_PROVIDER_KEY;
    delete process.env.PT_V2_PROVIDER_KEY_2;
    process.env.SPORTSAPI_BASE_URL = 'https://v1-base.invalid/api';
    process.env.SPORTSAPI_KEY = 'a-v1-key';
    resetProviderConfigForTesting();

    try {
      // The README's reason, restated as a test: "V1's provider configuration is
      // deliberately not reused — V2 must be deployable without inheriting V1
      // environment." A fallback would make a V1-only host look configured.
      assert.throws(
        () => loadProviderConfig(),
        /PT_V2_PROVIDER_BASE_URL is required/,
        'a V1 base URL must not satisfy V2'
      );

      process.env.PT_V2_PROVIDER_BASE_URL = 'https://v2-base.invalid/api';
      resetProviderConfigForTesting();
      assert.throws(
        () => loadProviderConfig(),
        /PT_V2_PROVIDER_KEY is required/,
        'a V1 API key must not satisfy V2'
      );
    } finally {
      for (const [name, value] of [
        ['PT_V2_PROVIDER_BASE_URL', saved.base],
        ['PT_V2_PROVIDER_KEY', saved.key],
        ['PT_V2_PROVIDER_KEY_2', saved.key2],
        ['SPORTSAPI_BASE_URL', saved.v1Base],
        ['SPORTSAPI_KEY', saved.v1Key],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      resetProviderConfigForTesting();
    }
  });

  test('the loader defines no V2 name from a V1 name', () => {
    const source = readFileSync(join(__dirname, 'env.ts'), 'utf8');
    for (const v1Name of ['SPORTSAPI_KEY', 'SPORTSAPI_KEY_2', 'SPORTSAPI_BASE_URL']) {
      // The name may appear in the header explaining why it is NOT used; it must
      // not appear in an executable line.
      const executable = source
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'));
      assert.ok(
        !executable.some((line) => line.includes(v1Name)),
        `${v1Name} must not appear in executable code — no silent V1 fallback`
      );
    }
  });
});

describe('V1 configuration behaviour is unchanged', () => {
  const v1Config = readFileSync(join(SRC, 'config', 'index.ts'), 'utf8');

  test('V1 config loads no environment file of its own', () => {
    assert.ok(
      !v1Config.includes('dotenv'),
      'src/config/index.ts must not gain an env load — V1 loading stays in src/cli.ts'
    );
  });

  test('V1 requires exactly the three variables it always required', () => {
    const block = v1Config.slice(
      v1Config.indexOf('const requiredEnvs'),
      v1Config.indexOf('requiredEnvs.forEach')
    );
    const names = [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(
      names,
      ['SPORTSAPI_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'],
      'no V2 variable may become a V1 requirement — that would break existing V1 deployments'
    );
  });

  test('V1 keeps its own env load at its own entry point', () => {
    const v1Cli = readFileSync(join(SRC, 'cli.ts'), 'utf8').split(/\r?\n/);
    assert.equal(
      v1Cli[0],
      "import 'dotenv/config';",
      "V1's entry point keeps loading .env exactly as it did"
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// END TO END — the actual `npm run seed:v2` entry point, in a child process
//
// NO DATABASE CAN BE REACHED, BY CONSTRUCTION. The temporary `.env` sets
// PT_V2_DB_PORT=6543, and the working directory outranks every other source of
// that variable, so `loadV2Config()` refuses the transaction-pooler port and
// throws before a single connection is attempted. That refusal is also the
// proof: the port could only have come from the file.
//
// The child's environment is stripped of PT_V2_*, SPORTSAPI_* and SUPABASE_* so
// a developer's real shell cannot make the test pass, and NODE_ENV is removed so
// V1's config warns rather than calling process.exit(1).
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_ENV = [
  'PT_V2_DB_HOST=host-from-the-env-file.invalid',
  'PT_V2_DB_NAME=name_from_the_env_file',
  // Refused outright, instantly, before any connection. See the note above.
  'PT_V2_DB_PORT=6543',
  'SPORTSAPI_KEY=placeholder-not-a-real-key',
  'SUPABASE_URL=https://placeholder.invalid',
  'SUPABASE_SERVICE_KEY=placeholder-not-a-real-key',
  '',
].join('\n');

function childEnvironment(): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('PT_V2_') || name.startsWith('SPORTSAPI_') || name.startsWith('SUPABASE_')) {
      continue;
    }
    if (name === 'NODE_ENV') continue;
    clean[name] = value;
  }
  return clean;
}

/**
 * The TypeScript loader, as an absolute file URL.
 *
 * `--import tsx` resolves against the CHILD's working directory, which is a
 * temporary directory with no `node_modules`. Resolving it here, from inside the
 * package, is what makes the child runnable from anywhere — which is the whole
 * point of the fixture.
 */
const TSX_LOADER = pathToFileURL(require.resolve('tsx')).href;

function runInChild(script: string, cwd: string): { output: string; status: number | null } {
  const result = spawnSync(process.execPath, ['--import', TSX_LOADER, script], {
    cwd,
    env: childEnvironment(),
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { output: `${result.stdout ?? ''}${result.stderr ?? ''}`, status: result.status };
}

describe('end to end — the seed entry point reads .env', () => {
  test('npm run seed:v2 no longer fails for want of an env file', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, '.env'), FIXTURE_ENV);
      const { output, status } = runInChild(join(SRC, 'v2', 'seed', 'runAll.ts'), dir);

      assert.notEqual(status, 0, 'this fixture is meant to fail, on the port and nothing else');
      assert.match(
        output,
        /TRANSACTION POOLER/,
        'the port refusal proves PT_V2_DB_PORT was read from the file'
      );
      assert.doesNotMatch(
        output,
        /V2 database configuration incomplete/,
        'PT_V2_DB_HOST and PT_V2_DB_NAME must now come from the file'
      );
      assert.doesNotMatch(
        output,
        /Missing environment variables:/,
        "V1's config module is reached through the shared logger; the same file " +
          'satisfies it, without src/config/index.ts being touched'
      );
    });
  });

  test('CONTROL — the same fixture without the loader reproduces both failures', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, '.env'), FIXTURE_ENV);
      // Deliberately does NOT import ../config/env. This is the code path as it
      // was before the fix; if these assertions ever stop holding, the test
      // above has stopped proving anything.
      writeFileSync(
        join(dir, 'probe.ts'),
        [
          `import { config } from '${specifier(join(SRC, 'config', 'index'))}';`,
          `import { loadV2Config } from '${specifier(join(SRC, 'v2', 'config', 'index'))}';`,
          'try {',
          '  loadV2Config();',
          "  console.log('V2_LOADED');",
          '} catch (error) {',
          "  console.log('V2_FAILED: ' + (error as Error).message);",
          '}',
          "console.log('V1_KEY_PRESENT: ' + (config.sportsapi.key !== ''));",
          '',
        ].join('\n')
      );

      const { output } = runInChild(join(dir, 'probe.ts'), dir);
      assert.match(
        output,
        /Missing environment variables: SPORTSAPI_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY/,
        'without the loader, V1 config still reports the original three'
      );
      assert.match(
        output,
        /V2_FAILED: V2 database configuration incomplete\. Missing: PT_V2_DB_HOST, PT_V2_DB_NAME/,
        'without the loader, V2 config still reports the original two'
      );
      assert.match(output, /V1_KEY_PRESENT: false/);
    });
  });
});
