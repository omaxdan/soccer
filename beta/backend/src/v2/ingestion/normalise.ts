// ─────────────────────────────────────────────────────────────────────────────
// NORMALISATION
//
// Shape conversions between what the provider sends and what the schema stores.
// Nothing here makes a domain decision — those live in mapping/index.ts. This
// file converts units, formats and shapes, and refuses to guess.
//
// ─────────────────────────────────────────────────────────────────────────────
// ER-01 GOVERNS EVERY TIMESTAMP BELOW
//
// "Never round-trip a database-generated timestamptz through a JavaScript Date
// and back into a key comparison. PostgreSQL stores microseconds, Date carries
// milliseconds, and the truncation silently breaks every composite foreign key."
//
// S-4 is exposed to this because `football.fixture` is partitioned and every
// child reference is composite on `(fixture_id, fixture_partition_on)`. The
// partition column is a DATE, which is coarse enough to survive the round trip —
// but the rule is followed structurally rather than relied on by luck: the
// partition date is DERIVED HERE from the provider's kickoff instant and
// supplied to every dependent write from the application, never re-read from
// the database and converted back.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a Unix second timestamp to a Date.
 *
 * Returns null rather than the epoch for absent input. `new Date(0)` is 1 January
 * 1970, a real instant that would sort, partition and compare as though it were
 * a genuine observation — the class of substituted value LC-05 exists to forbid.
 */
export function fromUnixSeconds(seconds: number | null | undefined): Date | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The UTC calendar date of an instant, as `YYYY-MM-DD`.
 *
 * PD-08 requires every pipeline session in UTC and the partition key derived in
 * UTC. `toISOString()` is UTC by definition, which is why it is used here rather
 * than any local-time formatter — a session in local time would shift every
 * `date_trunc` and every partition key derived from it.
 */
export function utcDateString(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * The partition key for a fixture.
 *
 * DERIVED ONCE, AT CREATION, AND NEVER RECOMPUTED. `ck_fixture__partition_not_after_kickoff`
 * permits the partition date to precede a later kickoff, which is exactly what a
 * rescheduled fixture needs: the fixture keeps its identity and its partition,
 * and sealed claims made before the postponement still resolve. Recomputing it
 * from a new kickoff would move the row between partitions, and every child's
 * ON UPDATE RESTRICT would refuse — correctly.
 */
export function fixturePartitionOn(scheduledKickoffAt: Date): string {
  return utcDateString(scheduledKickoffAt);
}

/**
 * ISO date from a provider value that may be seconds, a date, or a datetime.
 *
 * Returns null for anything unparseable rather than today's date. A contract
 * expiry silently set to today would end a registration that has not ended.
 */
export function toIsoDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const instant = fromUnixSeconds(value);
    return instant ? utcDateString(instant) : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : utcDateString(parsed);
}

/**
 * A URL-safe slug.
 *
 * Required because `uq_competition__slug`, `uq_team__slug` and `uq_player__slug`
 * are UNIQUE and the provider guarantees no slug. Diacritics are folded through
 * NFD decomposition so 'Bayern München' and 'Bayern Munchen' produce one slug
 * rather than two entities.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * A non-negative integer, or null.
 *
 * Scores, capacities and counts. Returns null for a negative rather than
 * clamping to zero: `ck_result__goals_non_negative` would refuse -1, and
 * clamping would turn a provider error into a plausible-looking nil.
 */
export function nonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded >= 0 ? rounded : null;
}

/** Trimmed text, or null for an empty or absent value. */
export function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The provider's own status string, for `fixture.provider_status_raw`.
 *
 * "The provider's own string, retained for mapping diagnosis. Load-bearing for
 * nothing." Kept verbatim — including the numeric code when that is all the
 * provider sends — because its entire value is being un-normalised. A cleaned-up
 * version would defeat the purpose of retaining it.
 */
export function providerStatusRaw(status: unknown): string | null {
  if (status === null || status === undefined) return null;
  if (typeof status === 'object') {
    const bag = status as Record<string, unknown>;
    const description = bag.description ?? bag.type ?? bag.code;
    return description === undefined ? JSON.stringify(status) : String(description);
  }
  return String(status);
}
