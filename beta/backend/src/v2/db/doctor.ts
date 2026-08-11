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
import { Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { Client } from 'pg';

import { loadV2Env } from '../config/env';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_DB_USER,
  loadV2Config,
  SESSION_MODE_PORT,
} from '../config/index';
import { buildPoolConfig, loadCaBundle, poolUsername } from './pool';


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

interface Definition {
  readonly path: string;
  readonly line: number;
  readonly raw: string;
}

/**
 * EVERY definition of `name` across the files, in file order then line order.
 *
 * ALL of them, not the first. dotenv's precedence is subtle in exactly the way
 * that produces an unexplainable mismatch: ACROSS files the FIRST file wins, but
 * WITHIN a file the LAST definition wins. A `.env` that defines a password twice
 * therefore yields the second value while a reader — and the first version of
 * this diagnostic — sees the first. That reads as "the loader transformed my
 * password" when the truth is "your file says it twice".
 *
 * Deliberately naive parsing: it reads the FILE, not dotenv's interpretation of
 * it, so the two can be compared.
 */
function definitionsOf(paths: readonly string[], name: string): Definition[] {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`);
  const found: Definition[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    // Split on /\r?\n/ rather than '\n'. A Windows-authored file leaves a
    // trailing \r on every line, and in JavaScript `.` does not match \r — it is
    // a line terminator — so `(.*)$` would fail to match every line of a CRLF
    // file and the comparison would silently report "nothing to compare".
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        const match = pattern.exec(line);
        if (match) found.push({ path, line: index + 1, raw: match[1] });
      });
  }
  return found;
}

/** Strips one layer of matching wrapping quotes, as dotenv does. */
function unquote(raw: string): string {
  const trimmed = raw.trim();
  return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

function inspectCredential(envPaths: readonly string[]): CredentialReport {
  const variable = 'PT_V2_DB_PASSWORD';
  const loaded = process.env[variable];
  const definitions = definitionsOf(envPaths, variable);
  const notes: string[] = [];

  // WHICH definition dotenv would have used: within a file the last wins, and
  // across files the first file wins. Reproducing that here is what makes the
  // comparison below meaningful.
  const firstFileWithOne = definitions[0]?.path;
  const winning = [...definitions].reverse().find((d) => d.path === firstFileWithOne) ?? null;
  const raw = winning === null ? null : winning.raw;

  if (definitions.length > 1) {
    const sameFile = definitions.filter((d) => d.path === firstFileWithOne);
    if (sameFile.length > 1) {
      notes.push(
        `DEFINED ${sameFile.length} TIMES in ${firstFileWithOne} — lines ` +
          `${sameFile.map((d) => d.line).join(', ')}. Within one file dotenv keeps the ` +
          `LAST, so line ${winning?.line} is the value in force and the earlier ones are ` +
          'dead. Delete them.'
      );
    }
    const otherFiles = definitions.filter((d) => d.path !== firstFileWithOne);
    if (otherFiles.length > 0) {
      notes.push(
        `also defined in ${[...new Set(otherFiles.map((d) => d.path))].join(', ')} — ` +
          'ignored, because across files dotenv keeps the first file that defines it'
      );
    }
  }

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
    const bare = unquote(raw);
    rawMatchesLoaded = bare === loaded;

    if (!rawMatchesLoaded) {
      // A value already in the real environment OUTRANKS the file — dotenv never
      // overrides. That is deliberate, and it is the other way a file and a
      // process legitimately disagree.
      notes.push(
        'the real environment may hold this variable, which outranks the file. ' +
          'Check with `echo %PT_V2_DB_PASSWORD%` (cmd) or `$env:PT_V2_DB_PASSWORD` ' +
          '(PowerShell); if it is set there, unset it or make it match.'
      );
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
  lines.push(`  connect budget       ${database.connectionTimeoutMs} ms`);
  if (database.connectionTimeoutMs < DEFAULT_CONNECT_TIMEOUT_MS) {
    lines.push('');
    lines.push(
      `  PT_V2_DB_CONNECT_TIMEOUT_MS is ${database.connectionTimeoutMs} ms, below the ` +
        `${DEFAULT_CONNECT_TIMEOUT_MS} ms default.`
    );
    lines.push('  A full connection through a shared pooler on a cold tenant has been');
    lines.push('  measured at 14.1s here — the network handshake is only ~3.3s of that,');
    lines.push('  the rest is the pooler opening its own connection to the database. A');
    lines.push('  budget below that kills every attempt at the same deadline, so retrying');
    lines.push('  cannot help. Raise it in .env or remove the line to take the default.');
  }
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
      'TLS — the certificate did not chain to a trusted authority. The provider signs ' +
        'with its own CA, which the system trust store does not carry. Download the ' +
        'project certificate (Supabase: Project Settings > Database > SSL Configuration) ' +
        'and set PT_V2_DB_SSL_CA to it. Do not disable verification.',
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

// ─────────────────────────────────────────────────────────────────────────────
// STAGED HANDSHAKE TRACE
//
// POSTGRESQL TLS IS NOT HTTPS, AND THAT DISTINCTION HAS COST DAYS.
//
// An HTTPS client opens a socket and sends a ClientHello. A PostgreSQL client
// must not. The sequence is:
//
//   1. TCP connect
//   2. client sends the 8-byte SSLRequest       00 00 00 08 04 D2 16 2F
//   3. server replies ONE byte, 'S' or 'N'
//   4. only THEN does the TLS handshake begin, on the same socket
//
// A TLS handshake attempted on a fresh socket WITHOUT step 2 sends a ClientHello
// where the server expects a startup packet. It cannot parse it and closes the
// connection, which a TLS client reports as "Received an unexpected EOF or 0
// bytes from the transport stream" — a message that reads as "the server
// rejected my TLS" and means nothing of the sort.
//
// This trace performs all four steps in order, on one socket, with the real
// host, port and TLS options from buildPoolConfig(), and times each. It exists
// so the answer to "which layer stalled" is one command rather than a chain of
// hand-built probes that may each test a different thing.
//
// It reports the negotiated protocol and cipher NAME. No certificate content is
// printed, and no key material can be.
// ─────────────────────────────────────────────────────────────────────────────

/** The PostgreSQL SSLRequest packet: Int32 length 8, Int32 code 80877103. */
export const SSL_REQUEST = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);

export type HandshakeStage = 'tcp' | 'sslrequest' | 'sslreply' | 'tls';

/**
 * What a stall at `stage` means. Pure, so the guidance is testable and cannot
 * drift from the stage names the trace actually emits.
 */
export function describeHandshakeStall(stage: HandshakeStage): string {
  switch (stage) {
    case 'tcp':
      return (
        'The TCP connection never completed. Nothing accepted the socket — a ' +
        'firewall, a blocked port, or an unreachable address.'
      );
    case 'sslrequest':
      return 'The 8-byte SSLRequest could not be written. The socket died immediately.';
    case 'sslreply':
      return (
        "The server never answered the SSLRequest with 'S' or 'N'. It accepted the " +
        'connection and then said nothing, which points at something in the path ' +
        'terminating the session rather than at the database.'
      );
    case 'tls':
      return (
        "STALLED AFTER THE SERVER SAID 'S'. The protocol negotiation succeeded and " +
        'the TLS handshake did not. The server certificate flight is several ' +
        'kilobytes across full-size segments, where everything up to this point was ' +
        'a handful of bytes — so a path that drops large packets (a path-MTU black ' +
        'hole, common behind a VPN or a tunnelling router) produces exactly this: ' +
        'small packets fine, handshake silent. A TLS REJECTION would arrive ' +
        'promptly as an alert or a certificate error, not as silence.'
      );
  }
}

function withDeadline<T>(work: Promise<T>, ms: number, stage: HandshakeStage): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error(`stalled at ${stage}`), { stage })), ms)
    ),
  ]);
}

async function traceHandshake(): Promise<void> {
  let config;
  try {
    config = buildPoolConfig();
  } catch (error) {
    console.log(`  FAILED             ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const host = String(config.host);
  const port = Number(config.port);
  const socket = new Socket();
  const started = Date.now();
  const since = (): string => `${String(Date.now() - started).padStart(5)}ms`;
  let stage: HandshakeStage = 'tcp';

  try {
    await withDeadline(
      new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.connect(port, host, () => resolve());
      }),
      15_000,
      'tcp'
    );
    console.log(`  ${since()}  TCP connected to ${host}:${port}`);

    stage = 'sslrequest';
    await withDeadline(
      new Promise<void>((resolve, reject) => {
        socket.write(SSL_REQUEST, (err) => (err ? reject(err) : resolve()));
      }),
      15_000,
      'sslrequest'
    );
    console.log(`  ${since()}  SSLRequest sent (8 bytes)`);

    stage = 'sslreply';
    const reply = await withDeadline(
      new Promise<string>((resolve, reject) => {
        socket.once('error', reject);
        socket.once('data', (buffer: Buffer) => resolve(buffer.toString('utf8', 0, 1)));
      }),
      15_000,
      'sslreply'
    );
    console.log(`  ${since()}  server replied '${reply}'`);
    if (reply !== 'S') {
      console.log(`  the server refused TLS ('${reply}'). PT_V2_DB_SSL expects it to accept.`);
      return;
    }

    stage = 'tls';
    const secure = await withDeadline(
      new Promise<TLSSocket>((resolve, reject) => {
        const options: Record<string, unknown> = { socket, servername: host };
        // The SAME TLS options production uses, so this cannot pass where the
        // application fails for a certificate reason.
        if (config.ssl && typeof config.ssl === 'object') Object.assign(options, config.ssl);
        const tlsSocket = tlsConnect(options as never, () => resolve(tlsSocket));
        tlsSocket.once('error', reject);
      }),
      20_000,
      'tls'
    );
    console.log(
      `  ${since()}  TLS established — ${secure.getProtocol() ?? 'unknown'}, ` +
        `cipher ${secure.getCipher()?.name ?? 'unknown'}, authorized=${secure.authorized}`
    );
    if (!secure.authorized && secure.authorizationError) {
      console.log(`             certificate not authorized: ${String(secure.authorizationError)}`);
    }
    console.log('  the handshake completes; any remaining failure is authentication or later');
    secure.destroy();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ${since()}  FAILED at ${stage}: ${message}`);
    console.log(`  meaning    ${describeHandshakeStall(stage)}`);
  } finally {
    socket.destroy();
  }
}

async function probe(): Promise<void> {
  let config;
  try {
    // Building the configuration can fail on its own — an unreadable CA bundle,
    // for one. Report it here rather than letting it abort the whole command.
    config = buildPoolConfig();
  } catch (error) {
    console.log(`\n  FAILED             ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
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

  const { database: database0 } = loadV2Config();

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

  // The CA bundle, verified now rather than at connection time — a bad path here
  // otherwise surfaces as an ENOENT thrown from pool construction.
  if (database0.ssl && database0.sslCaPath) {
    console.log('\ncertificate authority');
    console.log(`  PT_V2_DB_SSL_CA      ${database0.sslCaPath}`);
    try {
      const bundle = loadCaBundle(database0.sslCaPath);
      const count = bundle.split('-----BEGIN CERTIFICATE-----').length - 1;
      console.log(`  loaded               yes, ${count} certificate(s), ${bundle.length} bytes`);
    } catch (error) {
      console.log(`  loaded               NO`);
      console.log(`    - ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (database0.ssl && database0.sslRejectUnauthorized) {
    console.log('\ncertificate authority');
    console.log('  PT_V2_DB_SSL_CA      (not set)');
    console.log('    - verification uses the system trust store. A managed provider');
    console.log('      presenting its own CA will fail with "self-signed certificate in');
    console.log('      certificate chain" — supply its bundle rather than disabling');
    console.log('      verification.');
  }

  console.log('\nlogin name that will be sent');
  console.log(`  "${poolUsername(database0.user, database0.userSuffix)}"`);

  if (!report.present) {
    console.log('\nNo credential configured, so no connection is possible.\n');
    return;
  }
  if (!shouldProbe) {
    console.log('\nNo connection attempted. Re-run with --probe to test authentication.\n');
    return;
  }

  // The staged trace runs FIRST. When the pg attempt fails with a bare timeout,
  // this is what says which of the four steps it got to.
  console.log('\nhandshake trace — TCP, SSLRequest, reply, TLS, in order');
  await traceHandshake();

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
