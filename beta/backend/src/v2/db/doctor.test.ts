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

import { poolUsername, buildSslConfig, loadCaBundle } from './pool';
import { SSL_REQUEST, describeHandshakeStall, type HandshakeStage } from './doctor';
import { baseLogin, loadV2Config, resetV2ConfigForTesting } from '../config/index';

describe('the login name sent to the server', () => {
  test('an empty suffix yields exactly the role name', () => {
    // A direct connection has no tenant. Appending anything would produce a
    // login name matching no role.
    assert.equal(poolUsername('postgres', ''), 'postgres');
  });

  test('a suffix is appended after a dot, which is what a shared pooler routes on', () => {
    assert.equal(poolUsername('postgres', 'abcdef123456'), 'postgres.abcdef123456');
  });

  test('a suffix is never appended twice — the field bug', () => {
    // OBSERVED: `postgres.<ref>.<ref>`, a login matching no role, produced when
    // PT_V2_DB_USER held the JOINED form a provider dashboard hands out while
    // PT_V2_DB_USER_SUFFIX was also set. Two independent guards.
    assert.equal(
      baseLogin('postgres.nwxafrvwimoyhcnvvuji', 'nwxafrvwimoyhcnvvuji'),
      'postgres',
      'configuration normalises the base login'
    );
    assert.equal(
      poolUsername('postgres.nwxafrvwimoyhcnvvuji', 'nwxafrvwimoyhcnvvuji'),
      'postgres.nwxafrvwimoyhcnvvuji',
      'and the join refuses to append a tenant that is already present'
    );
    // Both are idempotent under repetition.
    assert.equal(baseLogin(baseLogin('postgres.abc', 'abc'), 'abc'), 'postgres');
    assert.equal(poolUsername(poolUsername('postgres', 'abc'), 'abc'), 'postgres.abc');
  });

  test('a base login is left alone, including one that merely contains a dot', () => {
    assert.equal(baseLogin('postgres', 'abc'), 'postgres');
    // Only the CONFIGURED suffix is stripped, never an arbitrary trailing part.
    assert.equal(baseLogin('my.service.account', 'abc'), 'my.service.account');
    assert.equal(baseLogin('postgres.abc', ''), 'postgres.abc', 'no suffix, nothing to strip');
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

describe('the CA bundle', () => {
  test('inline PEM is accepted as-is, because CI injects certificates as variables', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n';
    assert.equal(loadCaBundle(pem), pem);
  });

  test('a path that cannot be read fails with the path and the remedy, not ENOENT', () => {
    assert.throws(
      () => loadCaBundle('/definitely/not/here/prod-ca.crt'),
      (error: Error) => {
        assert.match(error.message, /PT_V2_DB_SSL_CA names/);
        assert.match(error.message, /\/definitely\/not\/here\/prod-ca\.crt/);
        assert.match(error.message, /SSL Configuration/, 'must say where to get the bundle');
        assert.match(error.message, /not disabled/, 'must not suggest disabling verification');
        return true;
      }
    );
  });

  test('a file that is not a certificate is rejected rather than passed to pg', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ptv2-ca-'));
    try {
      const path = join(dir, 'not-a-cert.txt');
      writeFileSync(path, 'this is not a certificate\n');
      assert.throws(() => loadCaBundle(path), /contains no .*BEGIN CERTIFICATE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a real bundle reaches the ssl option with verification still ON', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ptv2-ca-'));
    try {
      const path = join(dir, 'prod-ca.crt');
      const pem = '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n';
      writeFileSync(path, pem);
      const ssl = buildSslConfig({
        host: 'example.invalid',
        port: 5432,
        database: 'postgres',
        connectionTimeoutMs: 1000,
        idleTimeoutMs: 1000,
        allowNonSessionPort: false,
        userSuffix: '',
        user: 'postgres',
        ssl: true,
        sslRejectUnauthorized: true,
        sslCaPath: path,
      });
      assert.deepEqual(ssl, { rejectUnauthorized: true, ca: pem });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('dotenv precedence — why file and process can disagree without truncation', () => {
  test('within one file the LAST definition wins, not the first', () => {
    // The field report was `file 16 characters, process 33 characters`. Longer,
    // not shorter, so not truncation. This is the mechanism.
    const parsed = parseDotenv(
      Buffer.from("PT_V2_DB_PASSWORD='sixteen_chars_16'\nPT_V2_DB_PASSWORD='a_much_longer_second_definition33'\n")
    );
    assert.equal(parsed.PT_V2_DB_PASSWORD, 'a_much_longer_second_definition33');
  });

  test('across files the FIRST file wins', async () => {
    const { config: readEnvFiles } = await import('dotenv');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'ptv2-env-'));
    try {
      writeFileSync(join(dir, 'a.env'), 'PW=from_file_a\n');
      writeFileSync(join(dir, 'b.env'), 'PW=from_file_b\n');
      const target: Record<string, string> = {};
      readEnvFiles({ path: [join(dir, 'a.env'), join(dir, 'b.env')], processEnv: target, quiet: true });
      assert.equal(target.PW, 'from_file_a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

      // And the end-to-end field case: the joined form in PT_V2_DB_USER.
      resetV2ConfigForTesting();
      process.env.PT_V2_DB_USER = 'postgres.abcdef123456';
      const { database } = loadV2Config();
      assert.equal(database.user, 'postgres', 'the tenant is stripped from the base login');
      assert.equal(
        poolUsername(database.user, database.userSuffix),
        'postgres.abcdef123456',
        'and appears exactly once in what is sent'
      );
      delete process.env.PT_V2_DB_USER;
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

// ─────────────────────────────────────────────────────────────────────────────
// STAGED HANDSHAKE TRACE
//
// PostgreSQL TLS is not HTTPS. A TLS handshake attempted WITHOUT first sending
// the SSLRequest and reading the server's reply byte sends a ClientHello where
// the server expects a startup packet; the server closes the connection and the
// client reports "unexpected EOF from the transport stream". That message reads
// as a TLS rejection and is nothing of the sort, and a hand-built probe that
// skips the SSLRequest produces it every time against a perfectly healthy
// server. These pin the packet and the guidance so the trace cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

describe('the staged handshake trace', () => {
  test('the SSLRequest packet is the one the protocol defines', () => {
    // Int32 length = 8, Int32 code = 80877103 (0x04D2162F). Any other bytes and
    // the server does not reply 'S'.
    assert.equal(SSL_REQUEST.length, 8);
    assert.equal(SSL_REQUEST.readInt32BE(0), 8, 'length field');
    assert.equal(SSL_REQUEST.readInt32BE(4), 80877103, 'SSLRequest code');
    assert.deepEqual([...SSL_REQUEST], [0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);
  });

  test('every stage has guidance, and each names its own layer', () => {
    const stages: readonly HandshakeStage[] = ['tcp', 'sslrequest', 'sslreply', 'tls'];
    for (const stage of stages) {
      const text = describeHandshakeStall(stage);
      assert.ok(text.length > 40, `${stage} needs real guidance`);
    }
    assert.match(describeHandshakeStall('tcp'), /TCP connection never completed/);
    assert.match(describeHandshakeStall('sslreply'), /never answered the SSLRequest/);
  });

  test('a stall at the TLS stage is not reported as a TLS rejection', () => {
    // The distinction this whole trace exists to draw. Silence after 'S' points
    // at large-packet loss; a rejection arrives promptly as an alert.
    const text = describeHandshakeStall('tls');
    assert.match(text, /AFTER THE SERVER SAID 'S'/);
    assert.match(text, /path-MTU black hole/);
    assert.match(text, /REJECTION would arrive/);
  });
});
