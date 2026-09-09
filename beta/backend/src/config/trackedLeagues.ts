/**
 * TRACKED LEAGUES CONFIGURATION
 *
 * Single source of truth for NinetyData league coverage.
 * Drives:
 *   - Schedule feed filter (which matches to store)
 *   - Squad sync (which teams to fetch players for)
 *
 * THREE MATCHING STRATEGIES, in descending order of trust:
 *
 *   ids           — EXACT match against the provider's tournament id. THE ONLY
 *                   MATCHER THAT CANNOT LEAK. Numeric and globally unique, so it
 *                   needs no country disambiguation and has no collision surface
 *                   at all. Use isTrackedId() at every DB write boundary where an
 *                   id is available; the two matchers below exist only for the
 *                   paths where it isn't.
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
 *   1. Find the tournament in the provider's /tournaments dump — grab its id,
 *      slug and countryName. Match on countryName, never on slug or name alone:
 *      27 different countries publish a tournament slugged 'premier-league'.
 *   2. Add entry below with ids (required), apiNameMatch (name fragment) and
 *      slug (exact DB slug)
 *   3. Cron picks it up automatically
 *
 * IDS WERE BACKFILLED from the provider's /tournaments dump. That same pass
 * found 12 entries whose slug here no longer matched anything the provider
 * publishes (e.g. 'jupiler-pro-league' is 'pro-league' upstream, 'liga-i' is
 * 'superliga'). Those slugs are now corrected. Slug drift like that fails
 * SILENTLY and in the direction of under-fetching — the squad sync simply
 * found nothing for those 12 leagues — which is exactly why ids are now the
 * primary key here.
 *
 * Source: NinetyData League Coverage Map — June 2026
 */

export interface TrackedLeague {
  name: string;           // Human-readable label for logs
  apiNameMatch: string;   // Partial match against tournament.name from schedule API
  slug: string;           // EXACT match against tournaments.slug in DB
  ids: number[];          // AUTHORITATIVE. Provider tournament IDs (SPORTSAPI
                          // /tournaments -> leagues[].id). Numeric, stable, and
                          // globally unique across countries, so unlike slug or
                          // name they need no country disambiguation and cannot
                          // collide: 'premier-league' exists in 27 countries and
                          // 'bundesliga' in 2, but id 17 is only ever England's
                          // Premier League. Prefer isTrackedId() over every other
                          // matcher in this file wherever the ingest path has an
                          // id in hand — that is the only check that cannot leak
                          // an untracked tournament into the DB.
                          // Array because some competitions are split upstream
                          // into Apertura/Clausura or similar phases.
  country?: string | string[];  // Category/country — array for multi-country leagues
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
function countriesMatch(a: string | undefined, b: string | string[] | undefined): boolean {
  if (!a || !b) return false; // missing data = no match, not a free pass
  const aLower = a.toLowerCase().trim();
  const candidates = Array.isArray(b) ? b : [b];
  return candidates.some(country => {
    const bLower = country.toLowerCase().trim();
    if (aLower === bLower) return true;
    const aliasesA = COUNTRY_ALIASES[aLower] ?? [];
    const aliasesB = COUNTRY_ALIASES[bLower] ?? [];
    return aliasesA.includes(bLower) || aliasesB.includes(aLower);
  });
}

export const TRACKED_LEAGUES: TrackedLeague[] = [

  // ── EUROPE ────────────────────────────────────────────────────────────────

  // England
  { name: 'Premier League',         apiNameMatch: 'Premier League',   slug: 'premier-league',        ids: [17],      country: 'England',      tier: 1, band: 'A',         region: 'Europe' },
  { name: 'EFL Championship',       apiNameMatch: 'Championship',     slug: 'championship',          ids: [18],      country: ['England', 'Wales'],      tier: 2, band: 'A',         region: 'Europe' },
  { name: 'EFL League One',         apiNameMatch: 'League One',       slug: 'league-one',            ids: [24],      country: 'England',      tier: 3, band: 'B',         region: 'Europe' },
  { name: 'EFL League Two',         apiNameMatch: 'League Two',       slug: 'league-two',            ids: [25],      country: ['England', 'Wales'],      tier: 4, band: 'B',         region: 'Europe' },

  // Spain
  { name: 'La Liga',                apiNameMatch: 'La Liga',          slug: 'laliga',                ids: [8],       country: 'Spain',        tier: 1, band: 'A',         region: 'Europe' },
  { name: 'Segunda División',       apiNameMatch: 'Segunda División', slug: 'laliga-2',              ids: [54],      country: ['Spain', 'Andorra'],        tier: 2, band: 'B',         region: 'Europe' },

  // Germany
  { name: 'Bundesliga',             apiNameMatch: 'Bundesliga',       slug: 'bundesliga',            ids: [35],      country: 'Germany',      tier: 1, band: 'A',         region: 'Europe' },
  { name: '2. Bundesliga',          apiNameMatch: '2. Bundesliga',    slug: '2-bundesliga',          ids: [44],      country: 'Germany',      tier: 2, band: 'B',         region: 'Europe' },

  // Italy
  { name: 'Serie A',                apiNameMatch: 'Serie A',          slug: 'serie-a',               ids: [23],      country: 'Italy',        tier: 1, band: 'A',         region: 'Europe' },
  { name: 'Serie B (Italian)',      apiNameMatch: 'Serie B',          slug: 'serie-b',               ids: [53],      country: 'Italy',        tier: 2, band: 'B',         region: 'Europe' },

  // France
  { name: 'Ligue 1',                apiNameMatch: 'Ligue 1',          slug: 'ligue-1',               ids: [34],      country: ['France', 'Monaco'],       tier: 1, band: 'A',         region: 'Europe' },

  // Netherlands
  { name: 'Eredivisie',             apiNameMatch: 'Eredivisie',       slug: 'eredivisie',            ids: [37],      country: 'Netherlands',  tier: 1, band: 'B',         region: 'Europe' },

  // Portugal
  { name: 'Primeira Liga',          apiNameMatch: 'Primeira Liga',    slug: 'liga-portugal-betclic', ids: [238],     country: 'Portugal',     tier: 1, band: 'B',         region: 'Europe' },

  // Belgium
  { name: 'Jupiler Pro League',     apiNameMatch: 'Jupiler',          slug: 'pro-league',            ids: [38],      country: 'Belgium',      tier: 1, band: 'B',         region: 'Europe' },

  // Turkey
  { name: 'Süper Lig',              apiNameMatch: 'Süper Lig',        slug: 'trendyol-super-lig',     ids: [52],      country: 'Turkey',       tier: 1, band: 'B',         region: 'Europe' },

  // Scotland
  { name: 'Scottish Premiership',   apiNameMatch: 'Premiership',      slug: 'premiership',           ids: [36],      country: 'Scotland',     tier: 1, band: 'B',         region: 'Europe' },

  // Russia
  { name: 'Russian Premier League', apiNameMatch: 'Premier League',   slug: 'premier-liga',          ids: [203],     country: 'Russia',       tier: 1, band: 'B',         region: 'Europe' },

  // Norway
  { name: 'Eliteserien',            apiNameMatch: 'Eliteserien',      slug: 'eliteserien',           ids: [20],      country: 'Norway',       tier: 1, band: 'B',         region: 'Europe' },

  // Sweden
  { name: 'Allsvenskan',            apiNameMatch: 'Allsvenskan',      slug: 'allsvenskan',           ids: [40],      country: 'Sweden',       tier: 1, band: 'B',         region: 'Europe' },

  // Switzerland
  { name: 'Swiss Super League',     apiNameMatch: 'Super League',     slug: 'super-league',          ids: [215],     country: ['Switzerland', 'Liechtenstein'],  tier: 1, band: 'B',         region: 'Europe' },

  // Austria
  { name: 'Austrian Bundesliga',    apiNameMatch: 'Bundesliga',       slug: 'bundesliga',            ids: [45],      country: 'Austria',      tier: 1, band: 'B',         region: 'Europe' },

  // Romania
  { name: 'Liga I',                  apiNameMatch: 'Liga I',            slug: 'superliga',              ids: [152],     country: 'Romania',           tier: 1, band: 'B', region: 'Europe' },

  // Slovenia — confirmed from DB
  { name: 'PrvaLiga',                apiNameMatch: 'PrvaLiga',          slug: 'prvaliga',              ids: [212],     country: 'Slovenia',          tier: 1, band: 'C', region: 'Europe' },

  // Denmark
  { name: 'Danish Superliga',        apiNameMatch: 'Superliga',         slug: 'superliga',             ids: [39],      country: 'Denmark',           tier: 1, band: 'B', region: 'Europe' },

  // Greece
  { name: 'Greek Super League',      apiNameMatch: 'Super League',      slug: 'stoiximan-super-league', ids: [185],     country: 'Greece',            tier: 1, band: 'B', region: 'Europe' },

  // Czech Republic
  { name: 'Czech First League',      apiNameMatch: 'Czech First',       slug: '1-liga',    ids: [172],     country: 'Czech Republic',    tier: 1, band: 'B', region: 'Europe' },

  // Croatia
  { name: 'HNL',                     apiNameMatch: 'HNL',               slug: 'hnl',                   ids: [170],     country: 'Croatia',           tier: 1, band: 'B', region: 'Europe' },

  // Serbia
  { name: 'Serbian SuperLiga',       apiNameMatch: 'SuperLiga',         slug: 'mozzart-bet-superliga',  ids: [210],     country: 'Serbia',            tier: 1, band: 'B', region: 'Europe' },

  // Poland
  { name: 'Ekstraklasa',             apiNameMatch: 'Ekstraklasa',       slug: 'ekstraklasa',           ids: [202],     country: 'Poland',            tier: 1, band: 'B', region: 'Europe' },

  // Ukraine
  { name: 'Ukrainian Premier League',apiNameMatch: 'Ukrainian Premier', slug: 'premier-league',           ids: [218],     country: 'Ukraine',         tier: 1, band: 'B', region: 'Europe' },

  // Hungary
  { name: 'NB I',                    apiNameMatch: 'NB I',              slug: 'nb-i',                  ids: [187],     country: 'Hungary',           tier: 1, band: 'C', region: 'Europe' },

  // Slovakia
  { name: 'Slovak Super Liga',       apiNameMatch: 'Super Liga',        slug: 'nike-liga',             ids: [211],     country: 'Slovakia',          tier: 1, band: 'C', region: 'Europe' },

  // Bulgaria
  { name: 'Bulgarian First League',  apiNameMatch: 'First League',      slug: 'parva-liga',            ids: [247],     country: 'Bulgaria',          tier: 1, band: 'C', region: 'Europe' },

  // Cyprus
  { name: 'Cypriot First Division',  apiNameMatch: 'First Division',    slug: '1-division',            ids: [171],     country: 'Cyprus',            tier: 1, band: 'C', region: 'Europe' },
  // Ireland
  { name: 'League of Ireland',      apiNameMatch: 'League of Ireland',slug: 'premier-division',      ids: [192],     country: 'Ireland',      dbNames: ['Premier Division', ' Premier Division'], tier: 1, band: 'Discovery', region: 'Europe' },

  // Finland
  { name: 'Veikkausliiga',          apiNameMatch: 'Veikkausliiga',    slug: 'veikkausliiga',         ids: [41],      country: 'Finland',      tier: 1, band: 'Discovery', region: 'Europe' },

  // Lithuania
  { name: 'A Lyga',                 apiNameMatch: 'A Lyga',           slug: 'a-lyga',                ids: [198],     country: 'Lithuania',    dbNames: ['TOPLYGA', 'A Lyga'], tier: 1, band: 'Discovery', region: 'Europe' },

  // ── SOUTH AMERICA ─────────────────────────────────────────────────────────

  { name: 'Brasileirão Série A',    apiNameMatch: 'Série A',          slug: 'brasileirao-serie-a',   ids: [325],     country: 'Brazil',       dbNames: ['Brasileirão Série A', 'Brasileirão Betano'], tier: 1, band: 'A',         region: 'South America' },
  { name: 'Brasileirão Série B',    apiNameMatch: 'Série B',          slug: 'brasileirao-serie-b',   ids: [390],     country: 'Brazil',       tier: 2, band: 'Mandated',  region: 'South America' },
  { name: 'Liga Profesional',       apiNameMatch: 'Liga Profesional', slug: 'liga-profesional-de-futbol', ids: [155],     country: 'Argentina',    tier: 1, band: 'B',         region: 'South America' },
  { name: 'Primera Nacional',       apiNameMatch: 'Primera Nacional', slug: 'primera-nacional',      ids: [703],     country: 'Argentina',    tier: 2, band: 'Mandated',  region: 'South America' },
  { name: 'Categoría Primera A',    apiNameMatch: 'Primera A',        slug: 'primera-a-apertura',    ids: [11539],   country: 'Colombia',     dbNames: ['Primera A, Apertura'], tier: 1, band: 'C',         region: 'South America' },
  { name: 'Primera División',       apiNameMatch: 'Primera División', slug: 'primera-division',      ids: [278],     country: 'Uruguay',      dbNames: ['Liga AUF Uruguaya'], tier: 1, band: 'C',         region: 'South America' },
  { name: 'LigaPro',                apiNameMatch: 'LigaPro Serie A',  slug: 'ligapro-serie-a',       ids: [240],     country: 'Ecuador',      tier: 1, band: 'B',         region: 'South America' },
  { name: 'Liga MX Apertura',       apiNameMatch: 'Liga MX',          slug: 'liga-mx-apertura',      ids: [11621],   country: 'Mexico',       tier: 1, band: 'B',         region: 'North America' },
  // ── NORTH AMERICA ─────────────────────────────────────────────────────────

  { name: 'MLS',                    apiNameMatch: 'MLS',              slug: 'mls',                   ids: [242],     country: ['USA', 'Canada'],          tier: 1, band: 'A',         region: 'North America' },
  { name: 'Liga MX',                apiNameMatch: 'Liga MX',          slug: 'liga-mx-clausura',       ids: [11620],   country: 'Mexico',       tier: 1, band: 'B',         region: 'North America' },

  // ── AFRICA ────────────────────────────────────────────────────────────────

  { name: 'Egyptian Premier League',  apiNameMatch: 'Premier League', slug: 'premier-league',        ids: [808],     country: 'Egypt',        tier: 1, band: 'B',         region: 'Africa' },
  { name: 'PSL Betway Premiership',   apiNameMatch: 'Premiership',    slug: 'premiership',           ids: [358],     country: 'South Africa', tier: 1, band: 'C',         region: 'Africa' },

  // ── ASIA ──────────────────────────────────────────────────────────────────

  { name: 'J1 League',              apiNameMatch: 'J1',               slug: 'j1-league',             ids: [196],     country: 'Japan',        tier: 1, band: 'B',         region: 'Asia' },
  { name: 'J2 League',              apiNameMatch: 'J2',               slug: 'j2-league',             ids: [402],     country: 'Japan',        tier: 2, band: 'B',         region: 'Asia' },
  { name: 'K League 1',             apiNameMatch: 'K League 1',       slug: 'k-league-1',            ids: [410],     country: 'South Korea',  tier: 1, band: 'B',         region: 'Asia' },
  { name: 'K League 2',             apiNameMatch: 'K League 2',       slug: 'k-league-2',            ids: [777],     country: 'South Korea',  tier: 2, band: 'C',         region: 'Asia' },
  { name: 'Saudi Pro League',       apiNameMatch: 'Saudi',            slug: 'saudi-pro-league',      ids: [955],     country: 'Saudi Arabia', tier: 1, band: 'B',         region: 'Asia' },
  { name: 'Indian Super League',    apiNameMatch: 'Indian Super',     slug: 'indian-super-league',   ids: [1900],    country: 'India',        tier: 1, band: 'C',         region: 'Asia' },
  { name: 'Chinese Super League',   apiNameMatch: 'Chinese Super',    slug: 'cfa-super-league',     ids: [649],     country: 'China',        tier: 1, band: 'B',         region: 'Asia' },
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
export function getTrackedLeagueSlugs(): Array<{ slug: string; country: string | string[] | undefined }> {
  return TRACKED_LEAGUES.map(l => ({
    slug: l.slug,
    country: Array.isArray(l.country)
      ? l.country.map(c => c.toLowerCase())
      : l.country?.toLowerCase(),
  }));
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
 *
 * AMBIGUOUS BY CONSTRUCTION — prefer getBandById(). Several slugs appear on
 * more than one entry ('bundesliga' on Germany band A and Austria band B;
 * 'premier-league' on England band A, Egypt band B and Ukraine band B;
 * 'premiership' on Scotland band B and South Africa band C; 'superliga' on
 * Denmark and Romania), and .find() returns whichever is declared first —
 * so Austria silently reports band A. Kept only for callers that have no id.
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

// ── ID-BASED LOOKUPS (PREFERRED — USE THESE AT THE DB WRITE BOUNDARY) ────────

/**
 * Flat set of every tracked provider tournament id.
 *
 * This is the leak-proof gate. Name and slug matching both have a collision
 * surface that has to be closed by a country check, and a country check can
 * only be as good as the category data on the record — which is exactly the
 * "permit on missing data" hole the countriesMatch() comment above warns
 * about. An id has no such surface: 17 is England's Premier League and
 * nothing else, in any feed, with or without country data attached.
 */
export const TRACKED_LEAGUE_IDS: ReadonlySet<number> = new Set(
  TRACKED_LEAGUES.flatMap(l => l.ids)
);

/**
 * THE ingest guard. Call this before inserting any tournament (and before
 * inserting matches, standings or players hanging off one). Accepts strings
 * because JSON feeds and query params hand ids over as strings often enough
 * that a silent `'17' !== 17` mismatch is a real failure mode — but rejects
 * anything that isn't a finite number, rather than coercing null/''/NaN into
 * something that might accidentally hit.
 */
export function isTrackedId(id: number | string | null | undefined): boolean {
  if (id === null || id === undefined || id === '') return false;
  const n = typeof id === 'number' ? id : Number(id);
  return Number.isFinite(n) && TRACKED_LEAGUE_IDS.has(n);
}

/** Resolves a provider tournament id to its tracked entry, or null. */
export function findTrackedLeagueById(id: number | string): TrackedLeague | null {
  const n = typeof id === 'number' ? id : Number(id);
  if (!Number.isFinite(n)) return null;
  return TRACKED_LEAGUES.find(l => l.ids.includes(n)) ?? null;
}

/** Unambiguous replacement for getBandBySlug() — see the warning on that fn. */
export function getBandById(id: number | string): string | null {
  return findTrackedLeagueById(id)?.band ?? null;
}

/** Every tracked id, for `WHERE tournament_id = ANY($1)` style queries. */
export function getTrackedLeagueIds(): number[] {
  return [...TRACKED_LEAGUE_IDS];
}

/**
 * Convenience for filtering a raw provider payload in one pass.
 * `pick` defaults to reading `.id`, override for feeds that nest it
 * (e.g. `t => t.tournament?.id`).
 */
export function filterToTrackedIds<T>(
  items: readonly T[],
  pick: (item: T) => number | string | null | undefined = (i: any) => i?.id
): T[] {
  return items.filter(i => isTrackedId(pick(i)));
}

// Config integrity check. Runs once at import. A duplicate id means two
// entries claim the same tournament, which would make findTrackedLeagueById()
// and getBandById() silently return whichever was declared first — the same
// class of bug getBandBySlug() already has. This is static config, so this
// either always throws or never does; it cannot surprise you in production.
(() => {
  const seen = new Map<number, string>();
  for (const league of TRACKED_LEAGUES) {
    if (!league.ids || league.ids.length === 0) {
      throw new Error(`trackedLeagues: "${league.name}" has no ids`);
    }
    for (const id of league.ids) {
      const prev = seen.get(id);
      if (prev) {
        throw new Error(
          `trackedLeagues: tournament id ${id} claimed by both "${prev}" and "${league.name}"`
        );
      }
      seen.set(id, league.name);
    }
  }
})();

export const TRACKED_TOURNAMENT_ID_COUNT = TRACKED_LEAGUE_IDS.size;
