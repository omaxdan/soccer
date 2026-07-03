// ─── PostgREST TO-ONE RELATION NORMALIZER ────────────────────────────────────
// match_results, match_intelligence, and match_travel_intelligence all have
// UNIQUE match_id constraints — PostgREST detects that as a to-ONE
// relationship and embeds them as a single OBJECT, not an array. Every
// `?.[0]` access on these silently returned undefined (37 call sites across
// 9 files when this was found, 2026-07-03), which is why finished matches
// never showed scores, per-match readiness silently fell back to team
// baselines, and travel columns showed "—" despite the data existing.
//
// This helper is deliberately shape-proof: it handles BOTH object and array
// forms, so it stays correct even if the relation shape ever changes again
// (e.g. a dropped unique constraint, a PostgREST behavior change, or a
// query rewritten with a different embed). Use this for every to-one
// relation access — never `?.[0]` directly.
//
// Zero imports on purpose: safe to use from components, pages, and
// queries.ts alike with no circular-dependency risk.

export function toOne<T = any>(rel: T[] | T | null | undefined): T | null {
  if (rel == null) return null;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel;
}
