// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION DOCTOR AND LOGIN-NAME TESTS
//
// No database required. These pin the three things that were wrong in the field
// and that no error message revealed:
//
//   1. dotenv TRUNCATES an unquoted value at `#`, silently. A correct password
//      in `.env` therefore leaves this process as a different, shorter password,
//      and the server answers `password authentication failed` — the same
//      message it gives for a genuinely wrong password. Two weeks of resetting
//      passwords cannot distinguish those two states; a length can.
//   2. The pooler tenant was a literal compiled into pool.ts. A deployment-
//      specific value in source is unreachable to configuration and invisible to
//      every diagnostic.
//   3. Certificate verification had been turned off in the same literal.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseDotenv } from 'dotenv';

import { poolUsername, buildSslConfig } from './pool';
import { loadV2Config, resetV2ConfigForTesting } from '../config/index';

describe('the login name sent to the server', () => {
  test('an empty suffix yields exactly the role name', () => {
    // A direct connection has no tenant. Appending anything would produce a
    // login name matching no role.
    assert.equal(poolUsername('postgres', ''), 'postgres');
  });

  test('a suffix is appended after a dot, which is what a shared pooler routes on', () => {
    assert.equal(poolUsername('postgres', 'abcdef123456'), 'postgres.abcdef123456');
  });

  test('the login name is never altered, only wrapped', () => {
    for (const suffix of ['', 'tenant']) {
      assert.ok(
        poolUsername('postgres', suffix).startsWith('postgres'),
        'the login must remain the leading component — PostgreSQL authenticates it'
      );
    }
  });
});

describe('dotenv truncation — the defect that produced two weeks of wrong passwords', () => {
  // Measured against the installed dotenv, not assumed. If a future version
  // stops truncating, this test says so rather than leaving stale guidance.
  test('an unquoted value is silently cut at the first #', () => {
    const parsed = parseDotenv(Buffer.from('PT_V2_DB_PASSWORD=Qx7pLm#4vZt2Rw9s\n'));
    assert.equal(
      parsed.PT_V2_DB_PASSWORD,
      'Qx7pLm',
      'sixteen characters on disk become six in the process, with no warning'
    );
  });

  test('single quotes preserve the whole value', () => {
    const parsed = parseDotenv(Buffer.from("PT_V2_DB_PASSWORD='Qx7pLm#4vZt2Rw9s'\n"));
    assert.equal(parsed.PT_V2_DB_PASSWORD, 'Qx7pLm#4vZt2Rw9s');
  });

  test('double quotes preserve it too, but interpret \\n', () => {
    assert.equal(
      parseDotenv(Buffer.from('PW="Qx7pLm#4vZt2Rw9s"\n')).PW,
      'Qx7pLm#4vZt2Rw9s'
    );
    // Worth pinning: a password containing a literal backslash-n is altered by
    // the double-quoted form and not by the single-quoted one.
    assert.equal(parseDotenv(Buffer.from('PW="a\\nb"\n')).PW, 'a\nb');
    assert.equal(parseDotenv(Buffer.from("PW='a\\nb'\n")).PW, 'a\\nb');
  });

  test('a CRLF file does not leave a carriage return in the value', () => {
    assert.equal(parseDotenv(Buffer.from('PW=plain\r\n')).PW, 'plain');
  });
});

describe('TLS posture', () => {
  const base = {
    host: 'example.invalid',
    port: 5432,
    database: 'postgres',
    connectionTimeoutMs: 1000,
    idleTimeoutMs: 1000,
    allowNonSessionPort: false,
    userSuffix: '',
    user: 'postgres',
  };

  test('verification is ON unless a deployment turns it off', () => {
    const ssl = buildSslConfig({ ...base, ssl: true, sslRejectUnauthorized: true });
    assert.deepEqual(ssl, { rejectUnauthorized: true });
  });

  test('turning it off is possible but must be an explicit configured choice', () => {
    const ssl = buildSslConfig({ ...base, ssl: true, sslRejectUnauthorized: false });
    assert.deepEqual(ssl, { rejectUnauthorized: false });
  });

  test('TLS off entirely yields no ssl option', () => {
    assert.equal(buildSslConfig({ ...base, ssl: false, sslRejectUnauthorized: true }), undefined);
  });
});

describe('configuration defaults for the new variables', () => {
  test('the secure default holds when nothing is set', () => {
    const saved = {
      host: process.env.PT_V2_DB_HOST,
      name: process.env.PT_V2_DB_NAME,
      suffix: process.env.PT_V2_DB_USER_SUFFIX,
      reject: process.env.PT_V2_DB_SSL_REJECT_UNAUTHORIZED,
    };
    process.env.PT_V2_DB_HOST = 'example.invalid';
    process.env.PT_V2_DB_NAME = 'postgres';
    delete process.env.PT_V2_DB_USER_SUFFIX;
    delete process.env.PT_V2_DB_SSL_REJECT_UNAUTHORIZED;
    resetV2ConfigForTesting();
    try {
      const { database } = loadV2Config();
      assert.equal(database.sslRejectUnauthorized, true, 'certificate verification defaults ON');
      assert.equal(database.userSuffix, '', 'no suffix unless configured');
    } finally {
      for (const [name, value] of [
        ['PT_V2_DB_HOST', saved.host],
        ['PT_V2_DB_NAME', saved.name],
        ['PT_V2_DB_USER_SUFFIX', saved.suffix],
        ['PT_V2_DB_SSL_REJECT_UNAUTHORIZED', saved.reject],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      resetV2ConfigForTesting();
    }
  });

  test('a suffix pasted with its leading dot does not produce a double dot', () => {
    const saved = {
      host: process.env.PT_V2_DB_HOST,
      name: process.env.PT_V2_DB_NAME,
      suffix: process.env.PT_V2_DB_USER_SUFFIX,
    };
    process.env.PT_V2_DB_HOST = 'example.invalid';
    process.env.PT_V2_DB_NAME = 'postgres';
    process.env.PT_V2_DB_USER_SUFFIX = '.abcdef123456';
    resetV2ConfigForTesting();
    try {
      assert.equal(loadV2Config().database.userSuffix, 'abcdef123456');
      assert.equal(
        poolUsername(loadV2Config().database.user, loadV2Config().database.userSuffix),
        'postgres.abcdef123456'
      );
    } finally {
      for (const [name, value] of [
        ['PT_V2_DB_HOST', saved.host],
        ['PT_V2_DB_NAME', saved.name],
        ['PT_V2_DB_USER_SUFFIX', saved.suffix],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      resetV2ConfigForTesting();
    }
  });
});

describe('no deployment-specific literal remains in source', () => {
  test('pool.ts contains no hardcoded project reference', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./pool.ts', `file://${__dirname}/`), 'utf8');
    // The username is built from configuration. A literal here is unreachable to
    // configuration and invisible to `doctor:v2`.
    assert.doesNotMatch(
      source,
      /\.[a-z0-9]{15,}`/,
      'the tenant belongs in PT_V2_DB_USER_SUFFIX, not in the source'
    );
    assert.doesNotMatch(
      source,
      /rejectUnauthorized:\s*false/,
      'certificate verification must not be disabled by a literal'
    );
  });
});
