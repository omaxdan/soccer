// MATCH NAVIGATION — pure prev/next derivation within a competition edition.
//
// Given the fixtures of the edition a match belongs to (from the existing
// fetchEditionFixtures read), determine the chronologically adjacent fixtures so the
// match page can offer "previous / next match in this competition". This is pure
// presentation/navigation logic — it fabricates nothing: if the current fixture is
// not in the list, or is at an end, the corresponding neighbour is null.
//
// No new backend capability is required: this reuses EditionFixtureListResponse.

import type { ApiEditionFixture } from './types';

export interface AdjacentFixtures {
  readonly prev: ApiEditionFixture | null;
  readonly next: ApiEditionFixture | null;
}

/** Order fixtures by kickoff (then fixtureId for a stable tie-break). Does not
 *  mutate the input. */
export function orderByKickoff(fixtures: readonly ApiEditionFixture[]): ApiEditionFixture[] {
  return [...fixtures].sort((a, b) => {
    const ta = Date.parse(a.kickoffAt);
    const tb = Date.parse(b.kickoffAt);
    if (ta !== tb) return ta - tb;
    return a.fixtureId.localeCompare(b.fixtureId);
  });
}

/**
 * The fixtures immediately before/after `currentFixtureId` in kickoff order.
 * Returns { prev: null, next: null } when the current fixture is absent from the
 * list (never guesses a neighbour). Ends of the list yield null on that side.
 */
export function findAdjacentFixtures(
  fixtures: readonly ApiEditionFixture[],
  currentFixtureId: string,
): AdjacentFixtures {
  const ordered = orderByKickoff(fixtures);
  const i = ordered.findIndex((f) => f.fixtureId === currentFixtureId);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? ordered[i - 1] : null,
    next: i < ordered.length - 1 ? ordered[i + 1] : null,
  };
}
