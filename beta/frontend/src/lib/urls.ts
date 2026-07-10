/**
 * URL builders for SEO-friendly slug-based routes.
 *
 * Pattern: {readable-slug}-{numeric-id} — the trailing ID after the last
 * hyphen is always the canonical lookup key; the slug portion is purely
 * for readability/SEO and is never trusted for the actual DB query. This
 * means links stay valid even if a team renames or a slug changes later
 * (e.g. a club rebrand) — only the ID at the end matters for resolution.
 *
 * Examples:
 *   teamUrl({ id: 5, slug: 'liverpool-fc' })        -> /teams/liverpool-fc-5
 *   leagueUrl({ id: 1, slug: 'premier-league' })     -> /leagues/premier-league-1
 *   matchUrl({ id: 712, home_team: {...}, away_team: {...} })
 *     -> /matches/botafogo-sp-vs-clube-de-regatas-brasil-712
 *
 * If a slug is missing/null (shouldn't happen given teams/tournaments both
 * have slug columns, but defensive anyway), falls back to a generic
 * "team"/"league" placeholder rather than breaking the link entirely.
 */

function safeSlug(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback;
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

export function teamUrl(team: { id: number; slug?: string | null; name?: string | null } | null | undefined): string {
  if (!team?.id) return '/teams';
  const slug = safeSlug(team.slug ?? team.name, 'team');
  return `/teams/${slug}-${team.id}`;
}

export function leagueUrl(tournament: { id: number; slug?: string | null; name?: string | null } | null | undefined): string {
  if (!tournament?.id) return '/leagues';
  const slug = safeSlug(tournament.slug ?? tournament.name, 'league');
  return `/leagues/${slug}-${tournament.id}`;
}

export function matchUrl(match: {
  id: number;
  home_team?: { slug?: string | null; name?: string | null } | null;
  away_team?: { slug?: string | null; name?: string | null } | null;
} | null | undefined): string {
  if (!match?.id) return '/matches';
  const homeSlug = safeSlug(match.home_team?.slug ?? match.home_team?.name, 'home');
  const awaySlug = safeSlug(match.away_team?.slug ?? match.away_team?.name, 'away');
  return `/matches/${homeSlug}-vs-${awaySlug}-${match.id}`;
}

/**
 * Extracts the canonical numeric ID from a slug param — the segment after
 * the LAST hyphen. Used by every [slug] route's page.tsx to resolve the
 * actual DB row, regardless of what the readable portion says.
 *
 * Returns null if no trailing numeric segment is found (malformed URL) —
 * callers should treat this as a 404, not guess.
 */
export function parseIdFromSlug(slug: string): number | null {
  const match = slug.match(/-(\d+)$/);
  if (match) return Number(match[1]);
  // Also handle a bare numeric slug with no hyphen at all (e.g. someone
  // manually typed /teams/5) — still resolvable, not malformed.
  if (/^\d+$/.test(slug)) return Number(slug);
  return null;
}
