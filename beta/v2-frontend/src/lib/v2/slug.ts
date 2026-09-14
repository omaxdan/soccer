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

/** Canonical V2 public team URL slug: `{team.slug}-{id}`. The human part is the
 *  entity's CANONICAL STORED slug (unique, provider-derived — e.g. `flamengo-5981`),
 *  NOT a re-slugified name; the trailing DB id stays the immutable source of truth. */
export function v2TeamSlug(t: { id: string; slug: string }): string {
  return `${t.slug}-${t.id}`;
}

/** Canonical V2 public player URL slug: `{player.slug}-{id}` (stored slug + DB id). */
export function v2PlayerSlug(p: { id: string; slug: string }): string {
  return `${p.slug}-${p.id}`;
}

/** Canonical V2 public competition URL slug: `{competition.slug}-{id}` (stored slug +
 *  DB id — e.g. `brasileirao-betano-325-28`). */
export function v2CompetitionSlug(c: { id: string; slug: string }): string {
  return `${c.slug}-${c.id}`;
}

/** Canonical V2 public venue URL slug: `{slugify(name)}-{id}`. Venue has NO stored
 *  canonical slug, and venue names are not unique, so the human part is slugified from
 *  the name and the trailing DB id is mandatory as the resolver. */
export function v2VenueSlug(v: { id: string; name: string }): string {
  return `${slugify(v.name)}-${v.id}`;
}
