import type { MatchRow, TeamLite, TournamentLite } from "./types";

// Public URLs are slug-based; database IDs stay internal. In the live
// warehouse these slugs should be generated at ingestion and stored in
// teams.slug / tournaments.slug / matches.slug. Here we read the stored
// slug when present and fall back to a deterministic derivation so the
// app is navigable in demo mode too.

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function teamSlug(t: Pick<TeamLite, "slug" | "name">): string {
  return t.slug || slugify(t.name);
}

export function leagueSlug(t: Pick<TournamentLite, "slug" | "name">): string {
  return t.slug || slugify(t.name);
}

export function matchSlug(m: MatchRow): string {
  const d = new Date(m.date);
  const iso = Number.isNaN(d.getTime())
    ? ""
    : `-${d.toISOString().slice(0, 10)}`;
  return `${teamSlug(m.home)}-vs-${teamSlug(m.away)}${iso}`;
}

// A param may be a slug or (defensively) a numeric id. This lets detail
// resolvers accept either without exposing ids in generated links.
export function isNumericId(param: string): boolean {
  return /^\d+$/.test(param);
}
