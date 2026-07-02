/**
 * TRACKED LEAGUES CONFIGURATION
 *
 * Single source of truth for NinetyData league coverage.
 * Drives:
 *   - Schedule feed filter (which matches to store)
 *   - Squad sync (which teams to fetch players for)
 *
 * TWO MATCHING STRATEGIES:
 *
 *   apiNameMatch  — Partial, case-insensitive match against tournament.name from API.
 *                   Used in syncDateMasterFeed.ts (schedule feed) where only the name
 *                   is available at filter time.
 *
 *   slug          — EXACT match against tournaments.slug in the DB.
 *                   Used in syncSquadSofaScore.ts (squad sync) via getTrackedLeagueTeams().
 *                   This is precise — no false positives from partial name collisions.
 *
 * ADDING A NEW LEAGUE:
 *   1. Run sync:today and check tournaments table for the exact name + slug
 *   2. Add entry below with both apiNameMatch (name fragment) and slug (exact DB slug)
 *   3. Cron picks it up automatically
 *
 * Source: NinetyData League Coverage Map — June 2026
 */

export interface TrackedLeague {
  name: string;           // Human-readable label for logs
  apiNameMatch: string;   // Partial match against tournament.name from schedule API
  slug: string;           // EXACT match against tournaments.slug in DB
  country?: string;       // Category/country for disambiguation
  dbNames?: string[];     // Exact tournament.name values actually found in the DB —
                          // handles cases where the API's name and what ends up
                          // stored differ (e.g. API says "Série A", DB stores
                          // "Brasileirão Betano" — a sponsor-branded name). OPTIONAL
                          // and safe to leave empty/undefined: a league whose season
                          // hasn't started yet has no DB row at all, so there's no
                          // way to know its dbNames in advance — findTrackedLeagueByDbName()
                          // below falls back to the same apiNameMatch prefix logic used
                          // everywhere else when dbNames is empty or doesn't match,
                          // so newly-starting leagues (England/Spain/Italy pre-season,
                          // etc.) are correctly tracked from their very first synced
                          // match without needing this field populated ahead of time.
  tier: number;
  band: 'A' | 'B' | 'C' | 'Mandated' | 'Discovery';
  region: string;
}

// ─── COUNTRY ALIASES ──────────────────────────────────────────────────────────
// Same alias table as the frontend's countriesMatch() and the SQL cleanup
// migration's _rip_country_aliases — kept in sync manually across the three
// (TS config here, queries.ts on the frontend, 006_cleanup_untracked_data.sql)
// since they run in different runtimes and can't share a single import.
const COUNTRY_ALIASES: Record<string, string[]> = {
  turkey:       ['türkiye', 'turkiye'],
  'south korea': ['korea republic', 'republic of korea'],
  usa:          ['united states', 'united states of america'],
  netherlands:  ['holland'],
  russia:       ['russian federation'],
};

/**
 * Strict country match with alias support. Returns false (not true) when
 * either input is missing — country disambiguation is MANDATORY whenever
 * a tracked league entry declares a country, to prevent the exact bug this
 * was built to catch: 'Premier League' exists as a literal tournament name
 * in England, Russia, Egypt — but ALSO in Ethiopia, Lebanon, Kazakhstan,
 * Kuwait, Mongolia, Somalia, Syria, and Tanzania. A name-only match (or a
 * country check that silently passes when category data is missing) lets
 * all of those through. This must never default to "permit on missing data".
 */
function countriesMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false; // missing data = no match, not a free pass
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();
  if (aLower === bLower) return true;
  const aliasesA = COUNTRY_ALIASES[aLower] ?? [];
  const aliasesB = COUNTRY_ALIASES[bLower] ?? [];
  return aliasesA.includes(bLower) || aliasesB.includes(aLower);
}

export const TRACKED_LEAGUES: TrackedLeague[] = [

  // ── EUROPE ────────────────────────────────────────────────────────────────

  // England
  { name: 'Premier League',         apiNameMatch: 'Premier League',   slug: 'premier-league',        country: 'England',      tier: 1, band: 'A',         region: 'Europe' },
  { name: 'EFL Championship',       apiNameMatch: 'Championship',     slug: 'championship',          country: 'England',      tier: 2, band: 'A',         region: 'Europe' },
  { name: 'EFL League One',         apiNameMatch: 'League One',       slug: 'league-one',            country: 'England',      tier: 3, band: 'B',         region: 'Europe' },
  { name: 'EFL League Two',         apiNameMatch: 'League Two',       slug: 'league-two',            country: 'England',      tier: 4, band: 'B',         region: 'Europe' },

  // Spain
  { name: 'La Liga',                apiNameMatch: 'La Liga',          slug: 'laliga',                country: 'Spain',        tier: 1, band: 'A',         region: 'Europe' },
  { name: 'Segunda División',       apiNameMatch: 'Segunda División', slug: 'laliga-2',              country: 'Spain',        tier: 2, band: 'B',         region: 'Europe' },

  // Germany
  { name: 'Bundesliga',             apiNameMatch: 'Bundesliga',       slug: 'bundesliga',            country: 'Germany',      tier: 1, band: 'A',         region: 'Europe' },
  { name: '2. Bundesliga',          apiNameMatch: '2. Bundesliga',    slug: '2-bundesliga',          country: 'Germany',      tier: 2, band: 'B',         region: 'Europe' },

  // Italy
  { name: 'Serie A',                apiNameMatch: 'Serie A',          slug: 'serie-a',               country: 'Italy',        tier: 1, band: 'A',         region: 'Europe' },
  { name: 'Serie B (Italian)',      apiNameMatch: 'Serie B',          slug: 'serie-b',               country: 'Italy',        tier: 2, band: 'B',         region: 'Europe' },

  // France
  { name: 'Ligue 1',                apiNameMatch: 'Ligue 1',          slug: 'ligue-1',               country: 'France',       tier: 1, band: 'A',         region: 'Europe' },

  // Netherlands
  { name: 'Eredivisie',             apiNameMatch: 'Eredivisie',       slug: 'eredivisie',            country: 'Netherlands',  tier: 1, band: 'B',         region: 'Europe' },

  // Portugal
  { name: 'Primeira Liga',          apiNameMatch: 'Primeira Liga',    slug: 'liga-portugal-betclic', country: 'Portugal',     tier: 1, band: 'B',         region: 'Europe' },

  // Belgium
  { name: 'Jupiler Pro League',     apiNameMatch: 'Jupiler',          slug: 'jupiler-pro-league',    country: 'Belgium',      tier: 1, band: 'B',         region: 'Europe' },

  // Turkey
  { name: 'Süper Lig',              apiNameMatch: 'Süper Lig',        slug: 'super-lig',             country: 'Turkey',       tier: 1, band: 'B',         region: 'Europe' },

  // Scotland
  { name: 'Scottish Premiership',   apiNameMatch: 'Premiership',      slug: 'premiership',           country: 'Scotland',     tier: 1, band: 'B',         region: 'Europe' },

  // Russia
  { name: 'Russian Premier League', apiNameMatch: 'Premier League',   slug: 'premier-league',        country: 'Russia',       tier: 1, band: 'B',         region: 'Europe' },

  // Norway
  { name: 'Eliteserien',            apiNameMatch: 'Eliteserien',      slug: 'eliteserien',           country: 'Norway',       tier: 1, band: 'B',         region: 'Europe' },

  // Sweden
  { name: 'Allsvenskan',            apiNameMatch: 'Allsvenskan',      slug: 'allsvenskan',           country: 'Sweden',       tier: 1, band: 'B',         region: 'Europe' },

  // Switzerland
  { name: 'Swiss Super League',     apiNameMatch: 'Super League',     slug: 'super-league',          country: 'Switzerland',  tier: 1, band: 'B',         region: 'Europe' },

  // Austria
  { name: 'Austrian Bundesliga',    apiNameMatch: 'Bundesliga',       slug: 'bundesliga',            country: 'Austria',      tier: 1, band: 'B',         region: 'Europe' },

  // Ireland
  { name: 'League of Ireland',      apiNameMatch: 'League of Ireland',slug: 'premier-division',      country: 'Ireland',      dbNames: ['Premier Division', ' Premier Division'], tier: 1, band: 'Discovery', region: 'Europe' },

  // Finland
  { name: 'Veikkausliiga',          apiNameMatch: 'Veikkausliiga',    slug: 'veikkausliiga',         country: 'Finland',      tier: 1, band: 'Discovery', region: 'Europe' },

  // Lithuania
  { name: 'A Lyga',                 apiNameMatch: 'A Lyga',           slug: 'a-lyga',                country: 'Lithuania',    dbNames: ['TOPLYGA', 'A Lyga'], tier: 1, band: 'Discovery', region: 'Europe' },

  // ── SOUTH AMERICA ─────────────────────────────────────────────────────────

  { name: 'Brasileirão Série A',    apiNameMatch: 'Série A',          slug: 'brasileirao-serie-a',   country: 'Brazil',       dbNames: ['Brasileirão Série A', 'Brasileirão Betano'], tier: 1, band: 'A',         region: 'South America' },
  { name: 'Brasileirão Série B',    apiNameMatch: 'Série B',          slug: 'brasileirao-serie-b',   country: 'Brazil',       tier: 2, band: 'Mandated',  region: 'South America' },
  { name: 'Liga Profesional',       apiNameMatch: 'Liga Profesional', slug: 'liga-profesional',      country: 'Argentina',    tier: 1, band: 'B',         region: 'South America' },
  { name: 'Primera Nacional',       apiNameMatch: 'Primera Nacional', slug: 'primera-nacional',      country: 'Argentina',    tier: 2, band: 'Mandated',  region: 'South America' },
  { name: 'Categoría Primera A',    apiNameMatch: 'Primera A',        slug: 'primera-a-apertura',    country: 'Colombia',     dbNames: ['Primera A, Apertura'], tier: 1, band: 'C',         region: 'South America' },
  { name: 'Primera División',       apiNameMatch: 'Primera División', slug: 'primera-division',      country: 'Uruguay',      dbNames: ['Liga AUF Uruguaya'], tier: 1, band: 'C',         region: 'South America' },
  { name: 'LigaPro',                apiNameMatch: 'LigaPro Serie A',  slug: 'ligapro-serie-a',       country: 'Ecuador',      tier: 1, band: 'B',         region: 'South America' },

  // ── NORTH AMERICA ─────────────────────────────────────────────────────────

  { name: 'MLS',                    apiNameMatch: 'MLS',              slug: 'mls',                   country: 'USA',          tier: 1, band: 'A',         region: 'North America' },
  { name: 'Liga MX',                apiNameMatch: 'Liga MX',          slug: 'liga-mx',               country: 'Mexico',       tier: 1, band: 'B',         region: 'North America' },

  // ── AFRICA ────────────────────────────────────────────────────────────────

  { name: 'Egyptian Premier League',  apiNameMatch: 'Premier League', slug: 'premier-league',        country: 'Egypt',        tier: 1, band: 'B',         region: 'Africa' },
  { name: 'PSL Betway Premiership',   apiNameMatch: 'Premiership',    slug: 'premiership',           country: 'South Africa', tier: 1, band: 'C',         region: 'Africa' },

  // ── ASIA ──────────────────────────────────────────────────────────────────

  { name: 'J1 League',              apiNameMatch: 'J1',               slug: 'j1-league',             country: 'Japan',        tier: 1, band: 'B',         region: 'Asia' },
  { name: 'J2 League',              apiNameMatch: 'J2',               slug: 'j2-league',             country: 'Japan',        tier: 2, band: 'B',         region: 'Asia' },
  { name: 'K League 1',             apiNameMatch: 'K League 1',       slug: 'k-league-1',            country: 'South Korea',  tier: 1, band: 'B',         region: 'Asia' },
  { name: 'K League 2',             apiNameMatch: 'K League 2',       slug: 'k-league-2',            country: 'South Korea',  tier: 2, band: 'C',         region: 'Asia' },
  { name: 'Saudi Pro League',       apiNameMatch: 'Saudi',            slug: 'saudi-pro-league',      country: 'Saudi Arabia', tier: 1, band: 'B',         region: 'Asia' },
  { name: 'Indian Super League',    apiNameMatch: 'Indian Super',     slug: 'indian-super-league',   country: 'India',        tier: 1, band: 'C',         region: 'Asia' },
  { name: 'Chinese Super League',   apiNameMatch: 'Chinese Super',    slug: 'cfa-super-league',     country: 'China',        tier: 1, band: 'B',         region: 'Asia' },
];

// ── LOOKUP HELPERS ────────────────────────────────────────────────────────────

/**
 * Used by syncDateMasterFeed.ts (schedule feed).
 * Partial name match — fast, no DB query needed.
 */
// ─── DISQUALIFYING TERMS ──────────────────────────────────────────────────────
// If any of these appear anywhere in the API tournament name, it can never
// match a tracked league via the name fallback, regardless of prefix —
// catches variant competitions whose name structure doesn't reduce to a
// simple prefix problem (e.g. "A Lyga Women" legitimately starts with our
// "A Lyga" pattern, so prefix-anchoring alone wouldn't reject it).
const DISQUALIFYING_TERMS = [
  'women', 'feminino', 'femenino', 'femminile', 'frauen', 'femenil',
  'reserve', 'reserves', 'next pro', 'youth', 'academy',
  'u21', 'u20', 'u19', 'u18', 'u17', 'u23',
  'sub-21', 'sub-20', 'sub-19', 'sub-18', 'sub-17', 'sub-23',
];

function hasDisqualifyingTerm(name: string): boolean {
  const lower = name.toLowerCase();
  return DISQUALIFYING_TERMS.some(term => lower.includes(term));
}

/**
 * Checks whether an API tournament name matches a tracked pattern.
 *
 * NOT a substring-anywhere check (that was the bug — see header comment
 * below for the false positives it caused). Requires the pattern to match
 * as a PREFIX of the name, followed by a word boundary (so "Allsvenskan"
 * doesn't match inside "Damallsvenskan" — no boundary between "Dam" and
 * "Allsvenskan" in a fused compound word; "A Lyga" doesn't match inside
 * "Pirma Lyga" for the same reason), OR an exact full match. Combined with
 * the disqualifying-terms denylist above for variant names where prefix-
 * anchoring alone isn't enough (e.g. "A Lyga Women" — legitimately starts
 * with "A Lyga", needs the denylist to reject it).
 */
function nameMatchesPattern(apiName: string, pattern: string): boolean {
  const name = apiName.toLowerCase().trim();
  const pat = pattern.toLowerCase().trim();

  if (name === pat) return true; // exact match always wins
  if (hasDisqualifyingTerm(apiName)) return false;

  if (!name.startsWith(pat)) return false;
  // Require a word boundary immediately after the pattern — reject fused
  // continuations like "ligapro" matching inside "ligaproX" for some
  // hypothetical X, even though that's not one of today's known cases.
  const nextChar = name.charAt(pat.length);
  return nextChar === '' || /[^a-z0-9À-ÿ]/i.test(nextChar);
}

/**
 * Resolves a tournament name + country to a tracked league entry, or null.
 *
 * ── WHY THIS ISN'T SIMPLE SUBSTRING MATCHING ────────────────────────────
 * Confirmed via live production data that `.includes()` (substring anywhere)
 * let through a long list of false positives, ALL sharing a substring with
 * a tracked pattern but representing a genuinely different competition:
 *   'MLS Next Pro'                    matched 'MLS'        (reserve league)
 *   'Damallsvenskan'                  matched 'Allsvenskan' (women's league,
 *                                                            fused compound word)
 *   'A Lyga Women'                    matched 'A Lyga'      (women's league)
 *   'Pirma Lyga'                      matched 'A Lyga'      (Lithuania's
 *                                                            SECOND tier —
 *                                                            substring fused
 *                                                            inside "Pirma")
 *   'Brasileirão Série A1, Feminino'  matched 'Série A'     (women's league)
 *   'Carioca, Série A2'               matched 'Série A'     (Rio de Janeiro
 *                                                            STATE championship,
 *                                                            not the national league)
 *   'Catarinense/Maranhense/Sul-Mato-
 *    Grossense, Série B'              matched 'Série B'     (other Brazilian
 *                                                            STATE championships)
 *   'LigaPro Serie B'                 matched 'LigaPro'     (Ecuador's
 *                                                            second tier —
 *                                                            we only track Serie A)
 *
 * Every one of these is now correctly excluded by prefix-anchored matching
 * plus the disqualifying-terms denylist above.
 */
export function findTrackedLeague(
  tournamentName: string,
  countryName?: string
): TrackedLeague | null {
  for (const league of TRACKED_LEAGUES) {
    if (!nameMatchesPattern(tournamentName, league.apiNameMatch)) continue;
    // Country check is MANDATORY whenever the league entry declares one.
    // countriesMatch() returns false on missing data — no silent pass.
    // This is what prevents 'Premier League' (Ethiopia/Lebanon/Kazakhstan/
    // Kuwait/Mongolia/Somalia/Syria/Tanzania) from matching the England entry.
    if (league.country && !countriesMatch(countryName, league.country)) continue;
    return league;
  }
  return null;
}

export function isTrackedLeague(tournamentName: string, countryName?: string): boolean {
  return findTrackedLeague(tournamentName, countryName) !== null;
}

/**
 * Resolves a tournament by its ACTUAL DB tournament.name value (not the
 * API's schedule-feed name, which can differ — e.g. API says "Série A",
 * DB stores the sponsor-branded "Brasileirão Betano"). Checks dbNames
 * first (exact match, case/whitespace-insensitive), then FALLS BACK to
 * the same apiNameMatch prefix logic findTrackedLeague() uses.
 *
 * The fallback is what makes this safe for leagues that haven't started
 * their season yet: a league with no matches ever synced has no
 * tournament.name in the DB at all, so dbNames literally can't be known
 * in advance for it. Rather than requiring dbNames to be pre-populated
 * (which would silently break newly-starting leagues — England/Spain/
 * Italy pre-season, etc. — until someone manually added their exact DB
 * name after the fact), this falls through to prefix-matching, which
 * works correctly from the very first synced match with zero
 * configuration needed ahead of time. dbNames is purely an optimization/
 * correction for the specific cases where the DB name doesn't share a
 * prefix with the API name at all (sponsor branding, regional naming
 * differences) — not a requirement for a league to be trackable.
 *
 * Used by the schedule sync when inserting new tournaments — checks
 * whether a tournament with a given DB name should be inserted/tracked
 * or skipped as untracked noise.
 */
export function findTrackedLeagueByDbName(
  tournamentName: string,
  countryName?: string
): TrackedLeague | null {
  const nameLower = tournamentName.toLowerCase().trim();

  // Pass 1: exact dbNames match, when populated.
  for (const league of TRACKED_LEAGUES) {
    if (!league.dbNames || league.dbNames.length === 0) continue;
    const matchesDbName = league.dbNames.some(n => n.toLowerCase().trim() === nameLower);
    if (!matchesDbName) continue;
    if (league.country && !countriesMatch(countryName, league.country)) continue;
    return league;
  }

  // Pass 2: fall back to the standard prefix-anchored apiNameMatch logic —
  // this is what keeps newly-starting leagues (no dbNames known yet)
  // working correctly without any manual config step.
  return findTrackedLeague(tournamentName, countryName);
}

/**
 * Used by syncSquadSofaScore.ts (squad sync).
 * Returns {slug, country} pairs for DB slug-based lookup.
 * This is the PRECISE path — no partial name collisions.
 */
export function getTrackedLeagueSlugs(): Array<{ slug: string; country: string | undefined }> {
  return TRACKED_LEAGUES.map(l => ({ slug: l.slug, country: l.country?.toLowerCase() }));
}

/**
 * Check if a DB tournament (by slug + category) is a tracked league.
 * Used to validate DB tournaments against config.
 */
export function isTrackedBySlug(slug: string, category?: string): boolean {
  const sLower = slug.toLowerCase();
  return TRACKED_LEAGUES.some(l => {
    if (l.slug.toLowerCase() !== sLower) return false;
    // Mandatory + alias-aware, same as findTrackedLeague above.
    if (l.country && !countriesMatch(category, l.country)) return false;
    return true;
  });
}

/**
 * Resolves the real tier band (A/B/C/Mandated/Discovery) for a tracked
 * league by slug. IMPORTANT: this is NOT the same as tournaments.category
 * in the DB, which stores COUNTRY (e.g. 'Brazil', 'England'), not tier.
 * The band classification only ever lived here in this static config —
 * confirmed by reading the actual TrackedLeague interface and every entry
 * in TRACKED_LEAGUES below, not assumed. Used by logApiSample() so API
 * reference samples are organized by real tier, not by country.
 */
export function getBandBySlug(slug: string): string | null {
  const sLower = slug.toLowerCase();
  return TRACKED_LEAGUES.find(l => l.slug.toLowerCase() === sLower)?.band ?? null;
}

export function getTrackedLeaguesSummary(): Record<string, number> {
  return TRACKED_LEAGUES.reduce((acc, l) => {
    acc[l.region] = (acc[l.region] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

export const TRACKED_LEAGUE_COUNT = TRACKED_LEAGUES.length;
