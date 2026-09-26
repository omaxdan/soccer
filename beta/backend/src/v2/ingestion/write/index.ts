// ─────────────────────────────────────────────────────────────────────────────
// INGESTION WRITE PRIMITIVES
//
// Three primitives, because the schema has exactly three duplicate classes and
// choosing between them is a LIFECYCLE decision, not a preference:
//
//   upsertMutable       identity records that describe a current state
//   insertAppendOnly    dated observations that are never restated
//   (succession)        temporal spells — see registration.ts; no primitive can
//                       express it, because ON CONFLICT cannot target an
//                       exclusion constraint
//
// ─────────────────────────────────────────────────────────────────────────────
// THERE IS NO DELETE PRIMITIVE, AND THERE CANNOT BE ONE
//
// pt_pipeline_ingestion holds no DELETE on schema football at all — not on one
// relation, not on any. Delete-and-reinsert, the laziest reconciliation
// strategy, is foreclosed at the privilege layer rather than by convention, so
// it fails as `permission denied` rather than as a silent history loss.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE UPDATE BRANCH COALESCES
//
// A provider response omitting a field is NOT an assertion that the field is
// empty. A schedule feed that carries no venue for a fixture has not learned the
// venue is unknown; it simply did not send one. Overwriting a known coordinate
// with NULL because today's payload was thinner is how a platform loses data it
// already had, one sync at a time — and nothing reports it, because the write
// succeeded.
//
// So every updated column is COALESCE(EXCLUDED.col, target.col). Clearing a
// value is then impossible through ingestion, which is the correct trade: an
// attribute genuinely retracted is rare and governed; an attribute missing from
// one response is routine.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { WriteCounts } from '../../operations/writeRecord';

/**
 * The column `upsertMutable` projects to say which branch of the upsert ran.
 *
 * Named once so the primitive, the counter and the tests cannot drift, and so a
 * caller asking for a column of the same name is refused rather than shadowed.
 */
export const INSERTED_FLAG = 'inserted' as const;

/** A mutable counter matching the shape `operations.write_record` stores. */
export class IngestionCounts {
  examined = 0;
  written = 0;
  skipped = 0;
  rejected = 0;

  // ───────────────────────────────────────────────────────────────────────────
  // F-3. `written` COUNTS BOTH BRANCHES; THESE SEPARATE THEM.
  //
  // A pass that inserted 47 fixtures and a pass that updated 47 reported
  // identically — `examined 47, written 47, skipped 0` — so "how much of this
  // competition was new?" could only be answered by counting rows before and
  // after, which no operator reading a finished sweep can do.
  //
  // These are a PARTITION OF THE WRITES MADE THROUGH THE TWO PRIMITIVES in this
  // file: for those, `inserted + updated === written`. `squad.ts` writes
  // `player_registration` and `player_availability` with hand-written SQL and is
  // deliberately untouched here, so a counter that includes those relations has
  // `inserted + updated < written`. That residue is the unclassified raw-SQL
  // path, not a lost row, and it is stated rather than papered over.
  // ───────────────────────────────────────────────────────────────────────────

  /** Writes that created a row. */
  inserted = 0;
  /** Writes that landed on a row that already existed. */
  updated = 0;

  /** Records a value the mapping layer refused, with the reason. */
  reject(_reason: string): void {
    this.examined += 1;
    this.rejected += 1;
  }

  /**
   * Records one `upsertMutable` write, attributing it to the branch that ran.
   *
   * Takes the returned row rather than a boolean so the branch cannot be
   * restated by hand at nine call sites — the only source is the statement that
   * performed the write. A row without the flag is a wiring fault and throws:
   * guessing would make `inserted + updated === written` quietly false, which is
   * the exact class of defect F-3 exists to remove.
   */
  countUpsert(row: Record<string, unknown>): void {
    const inserted = row[INSERTED_FLAG];
    if (typeof inserted !== 'boolean') {
      throw new Error(
        `upsertMutable did not report '${INSERTED_FLAG}'. The insert/update split cannot ` +
          'be inferred, and reporting one of them as the other would be worse than not ' +
          'reporting it at all.'
      );
    }
    this.examined += 1;
    this.written += 1;
    if (inserted) this.inserted += 1;
    else this.updated += 1;
  }

  /**
   * Records one mutable upsert whose insert/update branch is ALREADY KNOWN from a
   * prior existence read — the partitioned-relation path, where `(xmax = 0)` is
   * unavailable and the caller supplies `existedBeforeWrite` instead.
   *
   * This is the batched counterpart of `countUpsert`: `upsertMutableBatch` folds
   * many rows into one statement and so cannot return a per-row `inserted` flag,
   * but every row it writes carries the same existence knowledge the row-by-row
   * path passed to `upsertMutable`. The accounting is identical — one examined,
   * one written, split by the branch — so `inserted + updated === written` holds
   * exactly as before.
   */
  countUpsertKnown(existedBeforeWrite: boolean): void {
    this.examined += 1;
    this.written += 1;
    if (existedBeforeWrite) this.updated += 1;
    else this.inserted += 1;
  }

  add(other: IngestionCounts): void {
    this.examined += other.examined;
    this.written += other.written;
    this.skipped += other.skipped;
    this.rejected += other.rejected;
    this.inserted += other.inserted;
    this.updated += other.updated;
  }

  /**
   * The four quantities `operations.write_record` holds — UNCHANGED BY F-3.
   *
   * The ledger has `rows_examined`, `rows_written`, `rows_skipped` and
   * `rows_rejected` and nothing else. Finding M-3 (`operations/writeRecord.ts`)
   * records that the brief's "rows inserted / rows updated" were considered and
   * deliberately not adopted, so the split lives in the run's own report and in
   * the logs. Persisting it is a schema change and a governance decision, and is
   * neither made nor pre-empted here.
   */
  toWriteCounts(): WriteCounts {
    return {
      rowsExamined: this.examined,
      rowsWritten: this.written,
      rowsSkipped: this.skipped,
      rowsRejected: this.rejected,
    };
  }
}

/**
 * Inserts or updates a mutable identity record, returning its surrogate id.
 *
 * For `competition`, `competition_edition`, `competition_stage`, `venue`,
 * `team`, `player`, `official`, `fixture` and `result` — relations where
 * ingestion holds S, I and U, which carry `updated_at`, and which describe a
 * CURRENT state. A renamed club is the same club with a new name.
 *
 * `conflictTarget` must name the provider alternate key or the natural key. It
 * is required, never optional: `ON CONFLICT DO UPDATE` needs a target anyway,
 * and naming it keeps a foreign key or check violation loud rather than folding
 * it into the update branch.
 *
 * `immutableColumns` are excluded from the update. `fixture_partition_on` is the
 * canonical case — it is derived in UTC at creation, never advances, and every
 * child reference enforces that with ON UPDATE RESTRICT.
 *
 * RETURNS THE ID EVEN WHEN NOTHING CHANGED. `DO UPDATE` always produces a row,
 * which is why this primitive uses it rather than `DO NOTHING` — a resolution
 * that returned no id on a re-run would make every dependent write fail on the
 * second execution.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ALSO REPORTS WHICH BRANCH RAN  (F-3)
 *
 * The returned row carries `inserted`, so the caller's counter can separate a
 * creation from an update. Two mechanisms, because one does not cover the
 * schema — see `existedBeforeWrite`.
 */
export async function upsertMutable(
  tx: PoolClient,
  options: {
    readonly relation: string;
    readonly columns: readonly string[];
    readonly values: readonly unknown[];
    readonly conflictTarget: readonly string[];
    readonly immutableColumns?: readonly string[];
    /** Columns to return, in order. Defaults to the surrogate id alone. */
    readonly returning?: readonly string[];
    /**
     * Whether the relation carries `updated_at`. True for all nine mutable
     * identity relations in S-4's scope — verified against migrations 004 and
     * 005 rather than assumed — and present so a relation without it can say so
     * instead of failing at runtime on a column that does not exist.
     */
    readonly hasUpdatedAt?: boolean;
    /**
     * Whether the row already existed, when the caller has ALREADY read it.
     *
     * `RETURNING (xmax = 0) AS inserted` is how this primitive normally tells an
     * insert from an update, and it is free — the statement is already round
     * tripping. It does not work on a PARTITIONED target: PostgreSQL answers
     * `cannot retrieve a system column in this context`, because the tuple is
     * routed to a leaf and the projection has no partition to read `xmax` from.
     * `football.fixture` and `football.result` are the two partitioned relations
     * this primitive writes, and BOTH ALREADY READ THE EXISTING ROW for reasons
     * of their own — identity-before-partition in `resolveFixture` (U-9) and the
     * LC-17 revision check in `recordResult` — so passing what they already know
     * costs no extra statement.
     *
     * Omitting it on a partitioned relation FAILS THE STATEMENT with that error.
     * That is the intended failure mode: this option can never be forgotten into
     * a wrong count, only into a loud one.
     */
    readonly existedBeforeWrite?: boolean;
  }
): Promise<Record<string, unknown>> {
  const { relation, columns, values, conflictTarget } = options;
  // `updated_at` is excluded from the COALESCE treatment deliberately. It is the
  // one column whose whole purpose is to advance, and coalescing it against the
  // existing value would freeze it at first insert — a row that changed every
  // day would claim never to have been touched.
  const immutable = new Set([
    ...conflictTarget,
    ...(options.immutableColumns ?? []),
    'created_at',
    'updated_at',
  ]);
  const returning = options.returning ?? ['id'];
  if (returning.includes(INSERTED_FLAG)) {
    throw new Error(
      `upsertMutable projects '${INSERTED_FLAG}' itself; a caller asking for a column of ` +
        'that name would shadow the insert/update split with table data.'
    );
  }
  const askDatabase = options.existedBeforeWrite === undefined;
  // The unqualified relation name is how PostgreSQL addresses the target row
  // inside ON CONFLICT DO UPDATE; the schema qualifier is not accepted there.
  const target = relation.split('.').pop()!;

  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const updatable = columns.filter((c) => !immutable.has(c));

  // A relation whose every column is part of the key has nothing to update, and
  // `DO UPDATE SET` with an empty list is a syntax error. Assigning the key to
  // itself is the standard way to still get a RETURNING row.
  const assignments =
    updatable.length > 0
      ? updatable.map((c) => `${c} = COALESCE(EXCLUDED.${c}, ${target}.${c})`)
      : [`${conflictTarget[0]} = EXCLUDED.${conflictTarget[0]}`];

  if (updatable.length > 0 && options.hasUpdatedAt !== false) {
    assignments.push('updated_at = now()');
  }

  const projection = askDatabase
    ? [...returning, `(xmax = 0) AS ${INSERTED_FLAG}`]
    : [...returning];

  const { rows } = await tx.query(
    `INSERT INTO ${relation} (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (${conflictTarget.join(', ')}) DO UPDATE SET ${assignments.join(', ')}
     RETURNING ${projection.join(', ')}`,
    values as unknown[]
  );
  const row = rows[0] as Record<string, unknown>;
  return askDatabase ? row : { ...row, [INSERTED_FLAG]: !options.existedBeforeWrite };
}

/**
 * The set-based form of `upsertMutable`: many rows of ONE relation, ONE statement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `persistMatchEnrichment` writes ~1,345 `player_match_statistic`, ~133
 * `team_match_statistic` and ~46 `lineup_selection` rows per fixture. Calling
 * `upsertMutable` once per row is ~1,500 awaited round trips inside a single
 * transaction — measured at ~6–7 minutes per fixture. Folding each relation's
 * rows into one multi-row `INSERT ... ON CONFLICT DO UPDATE` collapses that to a
 * handful of statements (one per parameter-limit chunk) with no change to what
 * lands in the table.
 *
 * IT IS `upsertMutable`, BATCHED — NOT A NEW SEMANTIC. The conflict target, the
 * COALESCE(EXCLUDED.col, target.col) update branch, the immutable-column
 * exclusion and the `updated_at = now()` advance are byte-for-byte the same
 * clause the row-by-row primitive builds. A re-run over stored keys updates in
 * place; it never duplicates and never blind-inserts.
 *
 * PARTITIONED TARGETS ONLY REACH THIS PATH VIA `existedBeforeWrite`. Every caller
 * here writes a relation partitioned on `fixture_partition_on`, so — exactly as
 * `upsertMutable` documents — `(xmax = 0)` cannot be projected. The caller has
 * already read which keys exist (one set-returning SELECT it makes anyway), so
 * the insert/update split is known per row without any RETURNING, and the
 * statement omits RETURNING entirely.
 *
 * THE ONE HAZARD BATCHING ADDS, AND HOW IT IS CLOSED. A multi-row
 * `ON CONFLICT DO UPDATE` may not touch the same conflict key twice in one
 * statement — PostgreSQL raises "ON CONFLICT DO UPDATE command cannot affect row
 * a second time". Row-by-row tolerated a repeated key by upserting it twice, last
 * write winning. We preserve that FINAL STATE by de-duplicating within the batch,
 * last occurrence winning, before building tuples. In a well-formed enrichment
 * payload the natural keys are already unique and de-duplication is a no-op; the
 * guard exists so a malformed payload degrades to "last wins" rather than to a
 * hard statement error the row-by-row path would never have raised.
 *
 * ATOMICITY AND ERROR ISOLATION ARE UNCHANGED. Every chunk runs on the caller's
 * transaction, so the unit of atomicity is still the whole fixture: any failure
 * rolls the fixture back exactly as the row-by-row path did. RLS INSERT/UPDATE
 * policies are evaluated per row within a multi-row statement, so the posture is
 * enforced identically.
 */
export async function upsertMutableBatch(
  tx: PoolClient,
  options: {
    readonly relation: string;
    readonly columns: readonly string[];
    /** One entry per row: its values (aligned to `columns`) and whether the row
     *  already existed — REQUIRED, because these targets are partitioned and the
     *  branch cannot be read from `xmax`. */
    readonly rows: readonly { readonly values: readonly unknown[]; readonly existedBeforeWrite: boolean }[];
    readonly conflictTarget: readonly string[];
    readonly immutableColumns?: readonly string[];
    /** False for a relation without `updated_at` (e.g. `lineup_selection`, per
     *  migration 005) — matches `upsertMutable`'s option of the same name. */
    readonly hasUpdatedAt?: boolean;
    /**
     * Maximum bind parameters per statement. PostgreSQL's hard ceiling is 65535
     * (a 16-bit wire field); rows are chunked at `floor(maxParams / columns)` so
     * a fixture's ~1,345 × 9-column player stats stay one or two statements while
     * never risking the limit. The default leaves generous headroom.
     */
    readonly maxParams?: number;
  }
): Promise<IngestionCounts> {
  const counts = new IngestionCounts();
  const { relation, columns, conflictTarget } = options;
  if (options.rows.length === 0) return counts;

  // De-duplicate by conflict key (last wins) — see the header note on the
  // "cannot affect row a second time" hazard.
  const keyIndices = conflictTarget.map((c) => columns.indexOf(c));
  if (keyIndices.some((i) => i < 0)) {
    throw new Error(
      `upsertMutableBatch: a conflictTarget column is absent from columns for ${relation}; ` +
        'the batch key cannot be formed.'
    );
  }
  const deduped = new Map<string, { values: readonly unknown[]; existedBeforeWrite: boolean }>();
  for (const row of options.rows) {
    deduped.set(keyIndices.map((i) => String(row.values[i])).join('\u0000'), row);
  }
  const rows = [...deduped.values()];

  // Build the shared ON CONFLICT DO UPDATE clause — identical to upsertMutable.
  const immutable = new Set([
    ...conflictTarget,
    ...(options.immutableColumns ?? []),
    'created_at',
    'updated_at',
  ]);
  const target = relation.split('.').pop()!;
  const updatable = columns.filter((c) => !immutable.has(c));
  const assignments =
    updatable.length > 0
      ? updatable.map((c) => `${c} = COALESCE(EXCLUDED.${c}, ${target}.${c})`)
      : [`${conflictTarget[0]} = EXCLUDED.${conflictTarget[0]}`];
  if (updatable.length > 0 && options.hasUpdatedAt !== false) {
    assignments.push('updated_at = now()');
  }

  const nCols = columns.length;
  const maxParams = options.maxParams ?? 60_000; // < 65535 hard ceiling, generous headroom
  const maxRowsPerChunk = Math.max(1, Math.floor(maxParams / Math.max(1, nCols)));

  for (let start = 0; start < rows.length; start += maxRowsPerChunk) {
    const chunk = rows.slice(start, start + maxRowsPerChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.values.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const { rowCount } = await tx.query(
      `INSERT INTO ${relation} (${columns.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (${conflictTarget.join(', ')}) DO UPDATE SET ${assignments.join(', ')}`,
      params
    );

    // DO UPDATE yields a row for every conflicting tuple and a non-conflicting
    // tuple inserts, so a correct statement affects EVERY chunk row. A shortfall
    // is a wiring fault (e.g. a tuple silently dropped) and must be loud, not
    // folded into an under-count.
    if ((rowCount ?? 0) !== chunk.length) {
      throw new Error(
        `upsertMutableBatch: ${relation} affected ${rowCount ?? 0} of ${chunk.length} rows in a ` +
          'chunk; a mutable upsert must touch every row it was given.'
      );
    }
    for (const row of chunk) counts.countUpsertKnown(row.existedBeforeWrite);
  }
  return counts;
}

/**
 * Inserts a dated observation, skipping one already recorded.
 *
 * For `standing`, `player_valuation` and `fixture_lifecycle_transition` — the
 * three football relations in the APPEND-ONLY lifecycle class. Ingestion holds
 * S and I only: migration 016 Revision 2 removed UPDATE explicitly under P-06,
 * because "granting UPDATE asserted a capability the lifecycle class forbids".
 * The append guard of migration 015 would refuse the statement regardless, so
 * the posture holds at three independent layers.
 *
 * Their natural keys already express the correct grain — one standing per team
 * per day per variant, one valuation per player per source per day — so a
 * re-run on the same day writes nothing and reports it as SKIPPED.
 *
 * That count is diagnostic, not noise. E9.03: "a calculation that conflicted on
 * every row reports zero written and a high skipped count".
 */
export async function insertAppendOnly(
  tx: PoolClient,
  options: {
    readonly relation: string;
    readonly columns: readonly string[];
    readonly rows: readonly (readonly unknown[])[];
    readonly conflictTarget: readonly string[];
  }
): Promise<IngestionCounts> {
  const counts = new IngestionCounts();
  if (options.rows.length === 0) return counts;

  const values: unknown[] = [];
  const tuples = options.rows.map((row) => {
    const placeholders = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const { rowCount } = await tx.query(
    `INSERT INTO ${options.relation} (${options.columns.join(', ')})
     VALUES ${tuples.join(', ')}
     ON CONFLICT (${options.conflictTarget.join(', ')}) DO NOTHING`,
    values
  );

  counts.examined = options.rows.length;
  counts.written = rowCount ?? 0;
  counts.skipped = options.rows.length - counts.written;
  // F-3. Every row this primitive lands is a creation — `DO NOTHING` cannot
  // update, and the append guard of migration 015 would refuse it if it tried.
  // Stated rather than left at zero, because a relation reporting 20 written and
  // neither inserted nor updated reads as a third, unexplained kind of write.
  counts.inserted = counts.written;
  return counts;
}

/**
 * Reads a surrogate id by provider alternate key, without writing.
 *
 * Used where a reference must already exist and creating it would be wrong —
 * resolving the home team of a fixture, for instance, after the participant
 * stage has run. A null return is a genuine ordering failure and should abort
 * the stage rather than quietly create a shell entity, which is how V1
 * accumulated teams with a name and nothing else.
 */
export async function findByProviderId(
  tx: PoolClient,
  relation: string,
  providerCode: string,
  providerExternalId: string
): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id::text FROM ${relation}
      WHERE provider_code = $1 AND provider_external_id = $2`,
    [providerCode, providerExternalId]
  );
  return rows[0]?.id ?? null;
}
