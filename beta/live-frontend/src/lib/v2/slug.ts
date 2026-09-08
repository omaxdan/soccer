// V2 public match-route slug helper.
//
// Reuses the repository's established slug-id convention (src/lib/slug.ts):
// public URLs are `{home}-vs-{away}-{id}`, the human-readable part is
// presentation/SEO, and the trailing numeric fixture id is the source of truth.
// This adapter exists only because the V2 API-consumer shapes (ApiEditionFixture,
// ApiMatchHeader) differ from the Supabase MatchRow the original matchSlug takes —
// it composes the SAME shape from V2 fields and delegates the id extraction to the
// existing idFromParam. No second slug algorithm: slugify and idFromParam are the
// canonical implementations, imported here rather than reimplemented.

import { slugify, idFromParam } from '../slug';

/** Re-export the canonical id extractor so V2 routes resolve slugs one way only. */
export { idFromParam };

/** The two fields a V2 fixture needs to build a canonical match slug. */
export interface V2SlugFixture {
  fixtureId: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
}

/** Canonical V2 public match URL slug: `{home}-vs-{away}-{fixtureId}`. */
export function v2MatchSlug(f: V2SlugFixture): string {
  return `${slugify(f.homeTeam.name)}-vs-${slugify(f.awayTeam.name)}-${f.fixtureId}`;
}

/** Canonical V2 public team URL slug: `{name}-{id}` (id is the source of truth). */
export function v2TeamSlug(t: { id: string; name: string }): string {
  return `${slugify(t.name)}-${t.id}`;
}

/** Canonical V2 public player URL slug: `{name}-{id}` (id is the source of truth). */
export function v2PlayerSlug(p: { id: string; fullName: string }): string {
  return `${slugify(p.fullName)}-${p.id}`;
}
