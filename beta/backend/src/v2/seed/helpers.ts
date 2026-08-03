// ─────────────────────────────────────────────────────────────────────────────
// SEED HELPERS — idempotent, insert-only
//
// THE ONE RULE THIS FILE ENFORCES: SEEDING NEVER UPDATES AND NEVER DELETES.
//
// Vocabulary and registry rows are HISTORICAL REFERENCE DATA. A sealed snapshot
// from last season references the module version in force when it was sealed; a
// feature value references the definition that produced it. Rewriting either
// would silently restate what a past claim meant, which is the failure V2 exists
// to remove.
//
// So every statement here is INSERT … ON CONFLICT DO NOTHING. There is no update
// path, no upsert path and no delete path in this module, and none may be added.
// Retiring a vocabulary code is done by closing its effective_to — an operation
// under governance, not something a bootstrap performs.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
// It does not validate codes, check foreign keys, enforce uniqueness or verify
// provenance rules. PostgreSQL owns all of that, and a seed that pre-checked
// would be duplicating database rules in TypeScript — which the S-3 brief
// forbids and which would drift the moment a constraint changed. An invalid code
// reaches the database and is refused there; the failure is recorded by the S-2
// operational layer with its SQLSTATE and constraint name.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { logger } from '../../utils/logger';

/** What one seeded relation did. */
export interface SeedOutcome {
  readonly relation: string;
  /** Rows the seed offered. */
  readonly offered: number;
  /** Rows that did not already exist and were therefore written. */
  readonly inserted: number;
  /** Rows already present and left exactly as they were. */
  readonly skipped: number;
}

export interface SeedReport {
  readonly outcomes: readonly SeedOutcome[];
  readonly totalInserted: number;
  readonly totalSkipped: number;
}

export function summarise(outcomes: readonly SeedOutcome[]): SeedReport {
  return {
    outcomes,
    totalInserted: outcomes.reduce((n, o) => n + o.inserted, 0),
    totalSkipped: outcomes.reduce((n, o) => n + o.skipped, 0),
  };
}

/**
 * Inserts rows into a relation, skipping any that already exist.
 *
 * `columns` names the columns in order; each row supplies values in that order.
 * Values are always parameterised — the only interpolated text is the relation
 * name and the column list, both of which are compile-time constants in this
 * module and never reach it from configuration or a provider feed.
 *
 * `conflictTarget` is the column list of the constraint that identifies a
 * duplicate. It is required rather than optional: `ON CONFLICT DO NOTHING` with
 * no target swallows EVERY constraint violation, including ones that mean the
 * seed is wrong. Naming the target keeps a foreign key failure or a check
 * violation loud, which is the whole point of letting the database own validity.
 */
export async function seedRows(
  tx: PoolClient,
  relation: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  conflictTarget: readonly string[]
): Promise<SeedOutcome> {
  if (rows.length === 0) {
    return { relation, offered: 0, inserted: 0, skipped: 0 };
  }

  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const { rowCount } = await tx.query(
    `INSERT INTO ${relation} (${columns.join(', ')})
     VALUES ${tuples.join(', ')}
     ON CONFLICT (${conflictTarget.join(', ')}) DO NOTHING`,
    values
  );

  const inserted = rowCount ?? 0;
  const outcome: SeedOutcome = {
    relation,
    offered: rows.length,
    inserted,
    skipped: rows.length - inserted,
  };
  logger.info(outcome, 'v2 seed: relation seeded');
  return outcome;
}

/**
 * Inserts rows whose foreign keys are resolved from natural keys in the same
 * statement.
 *
 * Registry rows reference their parents by surrogate id — feature_version needs
 * feature_definition_id, module_version needs module_definition_id — but a seed
 * declares its data by natural key, because a surrogate id is not stable across
 * environments and must never appear in source.
 *
 * Resolving the id in a subquery inside the INSERT keeps the whole thing one
 * statement: no round trip to look the parent up, and no window in which the
 * parent could be absent between the lookup and the write.
 *
 * `selectList` is the COMPLETE select list, positionally matching `columns`,
 * written in terms of $1…$n over the row's values. It is complete rather than a
 * prefix the helper extends: an earlier version appended the remaining
 * placeholders itself and produced "INSERT has more expressions than target
 * columns", because the caller's expression already named them. One place owns
 * the list, and it is the caller — which is also the only place that knows where
 * the resolved parent belongs in the column order.
 */
export async function seedRowsResolvingParent(
  tx: PoolClient,
  relation: string,
  columns: readonly string[],
  selectList: string,
  rows: readonly (readonly unknown[])[],
  conflictTarget: readonly string[]
): Promise<SeedOutcome> {
  if (rows.length === 0) {
    return { relation, offered: 0, inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  for (const row of rows) {
    const { rowCount } = await tx.query(
      `INSERT INTO ${relation} (${columns.join(', ')})
       SELECT ${selectList}
       ON CONFLICT (${conflictTarget.join(', ')}) DO NOTHING`,
      row as unknown[]
    );
    inserted += rowCount ?? 0;
  }

  const outcome: SeedOutcome = {
    relation,
    offered: rows.length,
    inserted,
    skipped: rows.length - inserted,
  };
  logger.info(outcome, 'v2 seed: relation seeded');
  return outcome;
}

/**
 * Confirms a vocabulary the MIGRATIONS seed already holds the codes a later seed
 * will reference.
 *
 * Thirteen vocabularies are seeded by migrations 002 and 012, and S-3 must not
 * re-seed or amend them. But the feature and module registries reference them by
 * foreign key, so a missing code would surface as a foreign key violation
 * halfway through a registry seed rather than as a clear statement of what is
 * absent. This checks first and says so.
 */
export async function assertVocabularyPresent(
  tx: PoolClient,
  relation: string,
  codeColumn: string,
  required: readonly string[]
): Promise<void> {
  const { rows } = await tx.query<{ code: string }>(
    `SELECT ${codeColumn} AS code FROM ${relation} WHERE ${codeColumn} = ANY($1::text[])`,
    [required as string[]]
  );
  const present = new Set(rows.map((r) => r.code));
  const missing = required.filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(
      `${relation} is missing codes the registry seed references: ${missing.join(', ')}. ` +
        'These are seeded by the migration set, not by S-3 — check that migrations 002 and ' +
        '012 were applied.'
    );
  }
}

/** An unbounded effective period, for a version that is currently in force. */
export function openEffectivePeriod(): string {
  // A version's period opens at the moment the registry first records it and has
  // no close: the successor's arrival is what closes it, by the exclusion
  // constraint on the relation.
  return `[${new Date().toISOString()},)`;
}
