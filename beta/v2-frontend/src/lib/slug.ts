// Slug/id helpers — the two PURE functions the V2 surface needs.
//
// This is a self-contained copy of the canonical implementation (the legacy
// frontend's src/lib/slug.ts): only `slugify` and `idFromParam`, which V2 actually
// uses via src/lib/v2/slug.ts. The legacy file's other helpers (teamSlug/
// playerSlug/leagueSlug/matchSlug) depend on V1 Supabase row types and are NOT
// carried over — V2 has no such dependency. Public URLs remain slug-*id*: the
// human-readable slug is presentation/SEO, the trailing numeric id is the source
// of truth.

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Extract the trailing numeric id from a slug-id param. Returns null if none,
// so callers can 404 rather than guess.
export function idFromParam(param: string): number | null {
  const m = param.match(/-(\d+)$/) ?? param.match(/^(\d+)$/);
  return m ? Number(m[1]) : null;
}
