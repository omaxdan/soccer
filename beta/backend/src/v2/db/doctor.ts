// ─────────────────────────────────────────────────────────────────────────────
// V2 CONNECTION DOCTOR — `npm run doctor:v2`
//
// WHY THIS EXISTS
//
// `password authentication failed` is the least informative error in
// PostgreSQL. It is emitted identically whether the password is wrong, the
// password is right but was truncated before it left this process, the role is
// not the one you think, or a pooler in the middle rejected the credential on
// the server's behalf. Two weeks of resetting passwords is what happens when the
// only instrument available is the failure itself.
//
// This command measures the path instead of guessing at it, at every point where
// a value can change between the file on disk and the startup packet:
//
//   .env on disk  ->  dotenv  ->  process.env  ->  requireCredential()
//                 ->  buildPoolConfig()  ->  pg  ->  the server
//
// THE DECISIVE MEASUREMENT is `raw == loaded`. The raw text after `=` in the
// file is compared with the value the process actually holds. If the loaded
// value is a PREFIX of the raw text, the loader dropped the tail — which dotenv
// does silently, without warning, to any unquoted value containing `#`. That is
// a wrong password sent by correct-looking configuration, and no number of
// password resets fixes it.
//
// NO SECRET IS PRINTED. Lengths and an eight-character SHA-256 prefix only. The
// fingerprint is there so a value can be compared against what an operator
// believes it to be, without either party revealing it:
//
//   node -e "process.stdout.write(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex').slice(0,8)+'\n')" "the-password"
//
// READ ONLY. `--probe` opens a connection and runs `SELECT current_user`. It
// writes nothing, creates nothing and alters nothing.
// ─────────────────────────────────────────────────────────────────────────────

import '../config/env';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

import { loadV2Env } from '../config/env';
import { DEFAULT_DB_USER, loadV2Config, SESSION_MODE_PORT } from '../config/index';
import { buildPoolConfig, poolUsername } from './pool';


/* eslint-disable no-console */

const SUPAVISOR_HOST = /\.pooler\.supabase\.com$/i;
const SUPABASE_DIRECT_HOST = /^db\.([a-z0-9]+)\.supabase\.co$/i;

interface CredentialReport {
  readonly variable: string;
  readonly present: boolean;
  readonly bytes: number;
  readonly fingerprint: string;
  /** null when no file supplied the variable, so there is nothing to compare. */
  readonly rawMatchesLoaded: boolean | null;
  readonly notes: readonly string[];
}

/**
 * The raw text to the right of `=` for `name`, from the first file that has it.
 *
 * Deliberately naive: it reads the FILE, not dotenv's interpretation of it, so
 * the two can be compared. A trailing carriage return is removed because a
 * Windows-authored file has one on every line and its presence tells us nothing
 * — whereas a `#` or a quote tells us a great deal.
 */
function rawFromFiles(paths: readonly string[], name: string): string | null {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`);
  for (const path of paths) {
    if (!existsSync(path)) continue;
    // Split on /\r?\n/ rather than '\n'. A Windows-authored file leaves a
    // trailing \r on every line, and in JavaScript `.` does not match \r — it is
    // a line terminator — so `(.*)$` would fail to match every line of a CRLF
    // file and the comparison would silently report "nothing to compare".
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = pattern.exec(line);
      if (match) return match[1];
    }
  }
  return null;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

function inspectCredential(envPaths: readonly string[]): CredentialReport {
  const variable = 'PT_V2_DB_PASSWORD';
  const loaded = process.env[variable];
  const raw = rawFromFiles(envPaths, variable);
  const notes: string[] = [];

  if (loaded === undefined || loaded === '') {
    return {
      variable,
      present: false,
      bytes: 0,
      fingerprint: '-',
      rawMatchesLoaded: null,
      notes: raw === null ? ['not set, and no file supplies it'] : ['set to an empty value'],
    };
  }

  let rawMatchesLoaded: boolean | null = null;
  if (raw !== null) {
    const quoted = /^\s*(["']).*\1\s*$/.test(raw);
    const bare = quoted ? raw.trim().slice(1, -1) : raw.trim();
    rawMatchesLoaded = bare === loaded;

    if (!rawMatchesLoaded) {
      if (bare.startsWith(loaded)) {
        const dropped = bare.slice(loaded.length);
        notes.push(
          `TRUNCATED — the file holds ${bare.length} characters, the process holds ` +
            `${loaded.length}. The loader dropped everything from character ` +
            `${loaded.length + 1}.`
        );
        if (dropped.trimStart().startsWith('#') || dropped.includes('#')) {
          notes.push(
            'CAUSE: an unquoted value containing `#`. dotenv treats it as the start ' +
              'of a comment. Wrap the value in single quotes and the whole password ' +
              'is loaded.'
          );
        }
      } else {
        notes.push(
          `TRANSFORMED — the file and the process disagree, and not by truncation. ` +
            `File ${bare.length} characters, process ${loaded.length}. Check for ` +
            'escapes, quotes or a second definition later in the file.'
        );
      }
    }
    if (quoted) notes.push('the value is quoted in the file, which is the safe form');
  } else {
    notes.push('supplied by the real environment, not by a file — nothing to compare');
  }

  if (/^\s|\s$/.test(loaded)) {
    notes.push('WARNING: the loaded value begins or ends with whitespace');
  }
  if (loaded.includes('\r')) notes.push('WARNING: the loaded value contains a carriage return');
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7e]/.test(loaded)) {
    notes.push(
      'WARNING: the value contains a non-ASCII or control character. SCRAM applies ' +
        'SASLprep, so a normalised form may travel rather than the bytes on disk.'
    );
  }

  return {
    variable,
    present: true,
    bytes: Buffer.byteLength(loaded, 'utf8'),
    fingerprint: fingerprint(loaded),
    rawMatchesLoaded,
    notes,
  };
}

function describeTarget(): string[] {
  const { database } = loadV2Config();
  const lines: string[] = [];
  lines.push(`  host                 ${database.host}`);
  lines.push(`  port                 ${database.port}`);
  lines.push(`  database             ${database.database}`);
  lines.push(`  ssl                  ${database.ssl ? 'on' : 'OFF'}`);
  lines.push(
    `  verify certificate   ${database.sslRejectUnauthorized ? 'yes' : 'NO — see below'}`
  );
  if (database.sslCaPath) lines.push(`  ca bundle            ${database.sslCaPath}`);
  lines.push(`  login name           ${database.user}`);
  lines.push(`  username suffix      ${database.userSuffix === '' ? '(none)' : database.userSuffix}`);
  if (database.user === DEFAULT_DB_USER) {
    lines.push('');
    lines.push(`  Running as '${DEFAULT_DB_USER}' — the login the project already has, which is`);
    lines.push('  what makes V2 operable with no PT-specific identity to provision.');
    lines.push('  On Supabase that role typically carries BYPASSRLS, so row-level policies');
    lines.push('  are inert FOR THIS CONNECTION. Policies governing anon and authenticated');
    lines.push('  are unaffected — the frontend does not connect as this role. Set');
    lines.push('  PT_V2_DB_USER to run the application under a narrower login.');
  }

  if (SUPAVISOR_HOST.test(database.host)) {
    lines.push('');
    lines.push('  This host is a Supabase SHARED POOLER (Supavisor), not the database.');
    lines.push(
      `    port ${SESSION_MODE_PORT} is SESSION mode — session state is preserved, so R-58 is satisfied`
    );
    lines.push('    port 6543 is TRANSACTION mode — refused by configuration, correctly');
    lines.push('    it is reachable over IPv4, which the direct host is not');
    lines.push('    it requires the tenant identifier in the username, hence the suffix');
    if (database.userSuffix === '') {
      lines.push('');
      lines.push(
        '    PROBLEM: no suffix is set. This host will answer ENOIDENTIFIER. Set ' +
          'PT_V2_DB_USER_SUFFIX to the project reference.'
      );
    }
  } else if (SUPABASE_DIRECT_HOST.test(database.host)) {
    lines.push('');
    lines.push('  This host is a Supabase DIRECT connection.');
    lines.push('    it resolves to IPv6 only unless the project has the IPv4 add-on');
    lines.push('    it needs NO username suffix — the bare role name is correct');
    if (database.userSuffix !== '') {
      lines.push('');
      lines.push(
        '    PROBLEM: a suffix is set. A direct connection has no tenant, so the ' +
          'login name will not match any role. Clear PT_V2_DB_USER_SUFFIX.'
      );
    }
  }

  if (database.ssl && !database.sslRejectUnauthorized) {
    lines.push('');
    lines.push('  CERTIFICATE VERIFICATION IS DISABLED.');
    lines.push(
      '    The connection is encrypted but unauthenticated: nothing proves the far ' +
        'end is the database, and the credential is what is on the wire. Prefer ' +
        'PT_V2_DB_SSL_CA pointing at the provider CA bundle.'
    );
  }
  return lines;
}

function classifyConnectionError(message: string): string {
  const checks: readonly (readonly [RegExp, string])[] = [
    [
      /no tenant identifier|tenant or user not found|ENOIDENTIFIER/i,
      'POOLER ROUTING — the username carried no usable tenant. Fix PT_V2_DB_USER_SUFFIX.',
    ],
    [
      /password authentication failed/i,
      'CREDENTIAL REJECTED at authentication. Compare the fingerprint above with the ' +
        'password you set on the role. If they match, the role password differs from ' +
        'what you believe, or the pooler could not verify it on the server\'s behalf.',
    ],
    [
      /authentication query failed/i,
      'POOLER COULD NOT VERIFY THE ROLE. Supavisor looks the role up on the database ' +
        'to authenticate it; this is the known failure mode for custom roles through ' +
        'the shared pooler. Test the same credential on the direct host to separate ' +
        'the two.',
    ],
    [
      /self.signed|unable to verify|certificate/i,
      'TLS — the certificate did not verify. Set PT_V2_DB_SSL_CA to the provider CA ' +
        'bundle. Do not disable verification.',
    ],
    [
      /ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND/i,
      'NETWORK — the host is unreachable or unresolvable. A Supabase direct host is ' +
        'IPv6 only; if this machine has no IPv6 route, use the shared pooler.',
    ],
    [
      /ETIMEDOUT|ECONNREFUSED|timeout expired|connection timeout/i,
      'NETWORK — nothing answered on that host and port within the timeout. Check ' +
        'that outbound 5432 is not blocked and that PT_V2_DB_HOST is right.',
    ],
    [/max client connections/i, 'POOLER SATURATED — reduce PT_V2_POOL_MAX_*.'],
    [
      /role .* does not exist/i,
      'THE ROLE DOES NOT EXIST on the database this host points at. Check the project.',
    ],
    [
      /unrecognized configuration parameter|unsupported startup parameter/i,
      'STARTUP OPTIONS REJECTED — the pooler refused `-c search_path=` / `-c timezone=UTC`.',
    ],
  ];
  for (const [pattern, explanation] of checks) if (pattern.test(message)) return explanation;
  return 'UNCLASSIFIED — the message above is the whole of what the server said.';
}

async function probe(): Promise<void> {
  const config = buildPoolConfig();
  console.log(`\n  sending username   "${String(config.user)}"`);
  const client = new Client({ ...config, connectionTimeoutMillis: 15_000 });
  const startedAt = Date.now();
  try {
    await client.connect();
    const { rows } = await client.query<{ current_user: string; version: string }>(
      "SELECT current_user, current_setting('server_version') AS version"
    );
    console.log(
      `  CONNECTED          ${Date.now() - startedAt}ms, ` +
        `authenticated as "${rows[0].current_user}", server ${rows[0].version}`
    );
    const expected = loadV2Config().database.user;
    if (rows[0].current_user !== expected) {
      console.log(
        `  MISMATCH           PT_V2_DB_USER names "${expected}". The credential ` +
          'belongs to a different login than the configuration claims.'
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  FAILED             ${message}`);
    console.log(`  meaning            ${classifyConnectionError(message)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const shouldProbe = argv.includes('--probe');
  const env = loadV2Env();

  console.log('\nV2 CONNECTION DOCTOR\n');

  console.log('environment files');
  for (const path of env.paths) {
    console.log(`  ${existsSync(path) ? 'read  ' : 'absent'} ${path}`);
  }
  console.log(`  ${env.namesOffered.length} variable name(s) supplied by file`);
  const v2Names = env.namesOffered.filter((name) => name.startsWith('PT_V2_'));
  console.log(`  ${v2Names.length} of them V2 variables`);
  if (v2Names.length === 0) {
    console.log('  PROBLEM: no PT_V2_* variable came from a file. Is this the right .env?');
  }

  console.log('\nconnection target');
  for (const line of describeTarget()) console.log(line);

  console.log('\ncredential — no value is printed');
  const report = inspectCredential(env.paths);
  const status = !report.present
    ? 'not set'
    : report.rawMatchesLoaded === null
      ? 'n/a'
      : report.rawMatchesLoaded
        ? 'yes'
        : 'NO';
  console.log(`  variable             ${report.variable}`);
  console.log(`  set                  ${report.present ? 'yes' : 'NO'}`);
  console.log(`  bytes                ${report.present ? report.bytes : '-'}`);
  console.log(`  sha256               ${report.fingerprint}`);
  console.log(`  file == process      ${status}`);
  for (const note of report.notes) console.log(`    - ${note}`);

  const { database } = loadV2Config();
  console.log('\nlogin name that will be sent');
  console.log(`  "${poolUsername(database.user, database.userSuffix)}"`);

  if (!report.present) {
    console.log('\nNo credential configured, so no connection is possible.\n');
    return;
  }
  if (!shouldProbe) {
    console.log('\nNo connection attempted. Re-run with --probe to test authentication.\n');
    return;
  }

  console.log('\nprobe — one read-only connection');
  await probe();
  console.log('');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('\nv2 doctor FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
