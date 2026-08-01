/**
 * The mutable-fixture invariant.
 *
 * Complementary to Historical Immutability (jobs/processDbOnly.ts,
 * migrations 042/043): that rule says a finalized match's intelligence must
 * never be rewritten. This is the other half — a match-scoped intelligence
 * processor may only ever SELECT a mutable fixture to begin with. Both rules
 * exist because relying on either alone is not enough: a processor with a
 * correct WHERE clause today can still regress via a future edit, which is
 * what the database trigger guards against; a processor with the trigger as
 * its only protection would still needlessly recompute rows the trigger
 * would just reject, and — per what this audit actually found — a WHERE
 * clause built on the wrong predicate (matching "has a predicted lineup"
 * instead of "is still scheduled") can silently include finished matches
 * even though nobody intended it to.
 *
 * MUTABLE_MATCH_STATUS is the one place the actual status value lives.
 * Found while fixing four processors that had each independently
 * (copy-pasted, by the look of it) written `.not('status', 'in',
 * '("cancelled","postponed")')` — a negative filter that, unlike this one,
 * lets 'finished' straight through. Today the rule is a single value;
 * if the product introduces additional pre-kickoff statuses (delayed,
 * warmup, postponed-then-rescheduled), this is the one place that changes.
 */
export const MUTABLE_MATCH_STATUS = 'scheduled' as const;
