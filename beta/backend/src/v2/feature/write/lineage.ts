// ─────────────────────────────────────────────────────────────────────────────
// THE WRITE BOUNDARY — feature.feature_lineage
//
// "A DEPENDENCY says 'this rule consumes that rule' — type-level, declared in
// advance. LINEAGE says 'this value consumed those values' — instance-level,
// recorded at calculation. Lineage is what makes reproducibility real rather
// than nominal: without it, a stated version tells you which rule ran but not
// what it ran ON, and a reproduction can differ from the original with nothing
// revealing why."
//
// ─────────────────────────────────────────────────────────────────────────────
// ONLY team.readiness_score PRODUCES LINEAGE
//
// It is the only composite. The other five features consume no feature and
// correctly write no edge — R-53 exempts values with no lineage from the
// provenance propagation rule for exactly that reason.
//
// A readiness value calculated from ONE input writes ONE edge, not two. Lineage
// is instance-level: it records what this value actually read, not what its rule
// may read in general. Writing a second edge for an input that was absent would
// cite a value that does not exist, and the composite foreign key would refuse
// it — correctly.
//
// ─────────────────────────────────────────────────────────────────────────────
// ORDER WITHIN THE TRANSACTION: VALUES FIRST, THEN LINEAGE
//
// Forced by `fk_feature_lineage__produced_value`, which references
// `feature_value (id, as_of)`. A lineage row cannot exist before the value it
// describes.
//
// That same ordering is the cause of finding S5-1 — it is why the A.12 trigger
// can never see lineage at the moment it fires, and why `write/provenance.ts` is
// the only enforcement of LC-37 that exists.
//
// ─────────────────────────────────────────────────────────────────────────────
// ER-01 — BOTH `as_of` VALUES ARE THE APPLICATION'S OWN
//
// `produced_value_as_of` and `consumed_value_as_of` are halves of two composite
// foreign keys. Both are supplied from the instants the driver derived, never
// read back from PostgreSQL and reconverted: the database stores microseconds,
// a JS `Date` carries milliseconds, and the truncation would break the reference
// silently.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { WrittenValue } from './values';

export interface LineageWriteResult {
  readonly examined: number;
  readonly written: number;
  readonly skipped: number;
}

/**
 * Writes the lineage edges for values just inserted.
 *
 * Takes only the values that were actually written. A skipped value's edges were
 * written when it was, in the same transaction, so attempting them again would
 * be an insert of rows already present.
 *
 * `ck_feature_lineage__consumed_not_after_produced` requires the consumed
 * instant to be at or before the produced one. S-5 satisfies it structurally —
 * a composite consumes inputs at its OWN `as_of`, so the two are equal — and the
 * constraint is not re-checked here. PostgreSQL owns it, and a violation would
 * mean the pipeline had consumed a value from its own future, which must surface
 * as a named constraint failure rather than a silently dropped edge.
 */
export async function writeLineage(
  tx: PoolClient,
  writtenValues: readonly WrittenValue[]
): Promise<LineageWriteResult> {
  const parameters: unknown[] = [];
  const tuples: string[] = [];

  // Deterministic order, for the same reason values are sorted: an identical
  // statement between runs is what the replay guarantee rests on.
  const edges = writtenValues
    .flatMap((written) =>
      written.candidate.consumed.map((consumed) => ({
        producedValueId: written.valueId,
        producedAsOf: written.candidate.asOf,
        consumedValueId: consumed.valueId,
        consumedAsOf: consumed.asOf,
        sortKey: `${written.candidate.featureKey}|${written.candidate.teamId}|${consumed.featureKey}`,
      }))
    )
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  if (edges.length === 0) return { examined: 0, written: 0, skipped: 0 };

  for (const edge of edges) {
    const base = parameters.length;
    parameters.push(edge.producedValueId, edge.producedAsOf, edge.consumedValueId, edge.consumedAsOf);
    tuples.push(`($${base + 1}::bigint, $${base + 2}, $${base + 3}::bigint, $${base + 4})`);
  }

  // Named conflict target, for the same reason as values: a bare DO NOTHING
  // would also swallow the self-reference check and both composite foreign keys,
  // each of which means the pipeline is wrong.
  const { rowCount } = await tx.query(
    `INSERT INTO feature.feature_lineage
       (produced_value_id, produced_value_as_of, consumed_value_id, consumed_value_as_of)
     VALUES ${tuples.join(', ')}
     ON CONFLICT ON CONSTRAINT uq_feature_lineage__produced_consumed DO NOTHING`,
    parameters
  );

  const written = rowCount ?? 0;
  return { examined: edges.length, written, skipped: edges.length - written };
}
