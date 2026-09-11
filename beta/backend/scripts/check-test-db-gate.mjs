// ─── check-test-db-gate.mjs — CI guard for the V2 test DB safety gate ────────
//
// Rule (S-6 remediation): every DB-CAPABLE V2 test file must route its database
// access through the centralized safety gate in src/v2/db/testSupport.ts, which
// fail-closes on the production / unknown database identity. A test that reaches
// the database without that gate is a production-test safety hole — the class of
// defect that put 175 anomalous rows into production on 2026-09-01.
//
// This is a STATIC, source-only check. It opens no database and runs no test.
//
//   DB-CAPABLE   the file calls a connection/write primitive:
//                withConnection( · withRun( · poolFor( · writeReading(  (or imports 'pg')
//   SAFE GATE    the file references a centralized guarded entry point:
//                testDatabaseReady( · skipReason( · testableRoles( · assertDatabaseTargetSafe(
//                (all route through assertDatabaseTargetSafe in testSupport.ts)
//   FORBIDDEN    the raw availability gate Boolean(process.env.PT_V2_DB_HOST && …),
//                which asks only "is a DB configured?" and never "which DB?"
//
// A DB-capable file FAILS if it uses the forbidden gate, or is DB-capable without
// any safe gate. Non-DB-capable files need no gate and pass.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CONNECT = /\b(?:withConnection|withRun|poolFor|writeReading)\s*\(|(?:from|require\(\s*)['"]pg['"]/;
const OLD_GATE = /Boolean\(\s*process\.env\.PT_V2_DB_HOST\b/;
const SAFE_GATE = /\b(?:testDatabaseReady|skipReason|testableRoles|assertDatabaseTargetSafe)\s*\(/;

/**
 * Classifies one test file's source. Exported so the policy can be exercised
 * against sample sources without leaving fixtures in the repository.
 * @returns {{dbCapable:boolean, oldGate:boolean, safeGate:boolean, ok:boolean, reason:string}}
 */
export function classifyTestFile(src) {
  const dbCapable = CONNECT.test(src);
  const oldGate = OLD_GATE.test(src);
  const safeGate = SAFE_GATE.test(src);
  if (oldGate) {
    return { dbCapable, oldGate, safeGate, ok: false,
      reason: 'uses the forbidden raw PT_V2_DB_HOST availability gate — use testDatabaseReady()' };
  }
  if (dbCapable && !safeGate) {
    return { dbCapable, oldGate, safeGate, ok: false,
      reason: 'is DB-capable (withConnection/withRun/poolFor/writeReading) but does not route ' +
        'through a centralized safety gate (testDatabaseReady / skipReason / testableRoles)' };
  }
  return { dbCapable, oldGate, safeGate, ok: true, reason: '' };
}

function listV2TestFiles() {
  const out = execSync('git ls-files', { encoding: 'utf8' });
  return out.split('\n').filter((p) => /^src\/v2\/.*\.test\.ts$/.test(p));
}

function main() {
  const files = listV2TestFiles();
  const violations = [];
  let dbCapableCount = 0;
  for (const f of files) {
    const v = classifyTestFile(readFileSync(f, 'utf8'));
    if (v.dbCapable) dbCapableCount += 1;
    if (!v.ok) violations.push([f, v.reason]);
  }
  if (violations.length > 0) {
    console.error('\ncheck-test-db-gate: FAIL — DB-capable test(s) bypass the safety gate:\n');
    for (const [f, reason] of violations) console.error(`  ✗ ${f}\n      ${reason}`);
    console.error(
      `\n${violations.length} violation(s). Route DB access through testDatabaseReady() ` +
        '(or skipReason()/testableRoles() for the connection-layer suites) in src/v2/db/testSupport.ts.\n'
    );
    process.exit(1);
  }
  console.log(
    `check-test-db-gate: OK — ${files.length} V2 test file(s) scanned, ` +
      `${dbCapableCount} DB-capable, all gated; no forbidden raw PT_V2_DB_HOST gate.`
  );
}

// Run as a CLI, but stay importable for the policy exercise.
if (import.meta.url === `file://${process.argv[1]}`) main();
