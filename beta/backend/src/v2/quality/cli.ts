// ─────────────────────────────────────────────────────────────────────────────
// S-12 QUALITY ASSERTION RUNNER — CLI
//
// One command, no arguments. The assertion set is the registry's, not the
// caller's: letting an operator choose which checks to run would make a clean
// report a matter of what was asked for.
// ─────────────────────────────────────────────────────────────────────────────

// FIRST. `src/config/index.ts` computes at import time through the logger, so a
// loader placed second runs after the computation that needed it.
import '../config/env';

import { assertDatabaseConfigured } from '../config/index';
import { closeAllPools } from '../db/pool';
import { runQualityAssertions, type QualityRunReport } from './run';
import { logger } from '../../utils/logger';

function report(result: QualityRunReport): void {
  /* eslint-disable no-console */
  console.log('\nv2 quality assertions\n');
  for (const outcome of result.evaluated) {
    const mark = outcome.passed ? 'PASS' : 'FAIL';
    const origin = outcome.implementation === 'DATABASE' ? 'db  ' : 'app*';
    console.log(`  ${mark}  ${origin}  ${outcome.key}`);
    if (outcome.detail) console.log(`             ${outcome.detail}`);
  }

  // COVERAGE IS REPORTED BESIDE THE RESULT, ALWAYS. "8 passed" without "of 17
  // registered" is the misreading this block exists to prevent.
  console.log(`\n  evaluated     ${String(result.evaluated.length).padStart(3)}`);
  console.log(`  recorded      ${String(result.recorded).padStart(3)}   (operations.quality_assertion_result)`);
  if (result.unreached.length > 0) {
    console.log(
      `  NOT REACHED   ${String(result.unreached.length).padStart(3)}   ` +
        `an earlier assertion raised first — no row written: ${result.unreached.join(', ')}`
    );
  }
  console.log(
    `  NO CHECK      ${String(result.unimplemented.length).padStart(3)}   ` +
      'registered with no implementation (S5-2) — no row written'
  );
  for (const key of result.unimplemented) console.log(`                  ${key}`);
  console.log('\n  app* = temporary application control, see src/v2/feature/verify.ts\n');
  /* eslint-enable no-console */
}

export async function main(): Promise<void> {
  assertDatabaseConfigured();
  try {
    const result = await runQualityAssertions();
    report(result);
    // A FAILED ASSERTION FAILS THE COMMAND. A quality run that exits 0 while
    // reporting a BLOCKING breach is a report nobody will wire into anything.
    // Missing coverage does NOT fail it — that is a known, recorded gap, not a
    // regression, and failing on it would make the command permanently red.
    if (!result.allPassed) process.exitCode = 1;
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'v2 quality: run failed'
    );
    process.exitCode = 1;
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  void main();
}
