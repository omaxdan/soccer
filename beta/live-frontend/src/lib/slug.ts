import type { MatchRow, TeamLite, TournamentLite } from "./types";

// Public URLs are slug-*id*: the human-readable slug is for presentation/SEO,
// the trailing numeric id is the source of truth. We always resolve by id and
// never depend on a stored slug column (matches has none), which is what was
// causing match pages to 404 on live.
//   /match/home-vs-away-15502595
//   /team/ldu-quito-42133
//   /league/brazil-serie-b-240

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function teamSlug(t: Pick<TeamLite, "id" | "name">): string {
  return `${slugify(t.name)}-${t.id}`;
}

export function leagueSlug(t: Pick<TournamentLite, "id" | "name">): string {
  return `${slugify(t.name)}-${t.id}`;
}

export function matchSlug(m: MatchRow): string {
  return `${slugify(m.home.name)}-vs-${slugify(m.away.name)}-${m.id}`;
}

// Extract the trailing numeric id from a slug-id param. Returns null if none,
// so callers can fall back gracefully (e.g. demo string slugs).
export function idFromParam(param: string): number | null {
  const m = param.match(/-(\d+)$/) ?? param.match(/^(\d+)$/);
  return m ? Number(m[1]) : null;
}
