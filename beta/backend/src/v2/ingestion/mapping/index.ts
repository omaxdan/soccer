// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER → CANONICAL MAPPING
//
// ─────────────────────────────────────────────────────────────────────────────
// NO MAPPING IN THIS FILE CREATES A VOCABULARY ROW
//
// Every function here returns a code that is ALREADY SEEDED, or null, or a
// rejection. None of them writes. V1's pattern was the opposite:
//
//     await db.from('countries').upsert(countryRows, { onConflict: 'name' });
//                                          — syncDateMasterFeed.ts:473
//
// A country row was created from the provider's `category.name` on every sync,
// which is how V1 accumulated codes nobody governed. `football.country` is a
// governed vocabulary with a format CHECK and S-3 owns its contents.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ARCHITECTURE ALREADY DECIDED THE HARD CASE
//
// football.fixture_lifecycle_state carries a seventh code:
//
//     ('UNKNOWN', 'Unknown',
//      'Provider status not recognised by the current mapping. Seals by default.',
//      false)
//
// with the column comment: "The lifecycle guard protects by default: an unmapped
// provider status maps to a state with is_open = FALSE."
//
// That is the governing principle for everything below: AN UNMAPPED VALUE
// DEGRADES SAFELY AND VISIBLY, NEVER SILENTLY. What "safely" means differs per
// column, and the schema decides which — a nullable column may take null, a NOT
// NULL column may not, and no amount of convenience changes that.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The outcome of mapping one provider value.
 *
 * A three-way result rather than `string | null`, because "mapped to null" and
 * "could not be mapped" are different facts with different telemetry. The first
 * is an absent attribute; the second is a gap in this file that someone should
 * close.
 */
export type MappingResult =
  | { readonly kind: 'MAPPED'; readonly code: string }
  /** The column is nullable and the value is legitimately absent or unmappable. */
  | { readonly kind: 'ABSENT'; readonly reason: string }
  /** The column is NOT NULL and no honest value exists. The row must not be written. */
  | { readonly kind: 'REJECTED'; readonly reason: string };

export const mapped = (code: string): MappingResult => ({ kind: 'MAPPED', code });
export const absent = (reason: string): MappingResult => ({ kind: 'ABSENT', reason });
export const rejected = (reason: string): MappingResult => ({ kind: 'REJECTED', reason });

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE LIFECYCLE STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider status code → platform lifecycle state.
 *
 * The numeric codes are the provider's; the mapping is V1's `transformMatch`
 * status map, carried across because it was derived from live observation and is
 * correct. What changes is the TARGET vocabulary: V1 mapped onto eight free-text
 * strings written to `matches.status`; V2 maps onto a governed 7-code relation
 * whose `is_open` flag governs whether a fixture may still be snapshotted.
 *
 * V1's 'live' and 'halftime' both become IN_PROGRESS. The distinction mattered
 * to V1 because the match page displayed it; it does not exist in the platform
 * vocabulary because LC-14 defines these states by what they permit — and
 * neither permits a snapshot.
 */
const LIFECYCLE_BY_PROVIDER_STATUS: Readonly<Record<number, string>> = {
  0: 'SCHEDULED',
  6: 'IN_PROGRESS',
  7: 'IN_PROGRESS',
  31: 'IN_PROGRESS', // half-time
  40: 'IN_PROGRESS',
  41: 'IN_PROGRESS',
  50: 'IN_PROGRESS',
  60: 'POSTPONED',
  70: 'CANCELLED',
  90: 'ABANDONED',
  100: 'COMPLETED',
  110: 'COMPLETED', // after extra time
  120: 'COMPLETED', // after penalties
};

/**
 * Maps a provider status onto the platform lifecycle vocabulary.
 *
 * NEVER RETURNS ABSENT OR REJECTED. `fixture.lifecycle_state_code` is NOT NULL,
 * and the vocabulary supplies UNKNOWN precisely so that an unrecognised status
 * has a safe destination. UNKNOWN carries `is_open = false`, so an unmapped
 * fixture SEALS rather than accepting snapshots against a state nobody
 * understands. Protecting by default is the whole design.
 *
 * The provider's own string is retained separately on `provider_status_raw`, so
 * an unmapped status is diagnosable without this function having guessed.
 */
export function mapLifecycleState(providerStatusCode: number | null | undefined): string {
  if (providerStatusCode === null || providerStatusCode === undefined) return 'UNKNOWN';
  return LIFECYCLE_BY_PROVIDER_STATUS[providerStatusCode] ?? 'UNKNOWN';
}

/** Whether a lifecycle state was reached by mapping or by falling through. */
export function isUnmappedLifecycle(providerStatusCode: number | null | undefined): boolean {
  return mapLifecycleState(providerStatusCode) === 'UNKNOWN';
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider country/category name → seeded ISO alpha-2 code.
 *
 * The provider reports a display name (`category.name`), not a code. This map is
 * the whole translation, declared statically so it is reviewable — and it covers
 * every country in `config/trackedLeagues.ts` after S-4 extended the vocabulary
 * from 24 codes to 51 (decision D-2).
 *
 * SC and WA are football ASSOCIATIONS rather than ISO countries; see
 * NON_ISO_ASSOCIATION_CODES in the S-3 seed and finding S4-1. 'England' maps to
 * GB because no separate English code was seeded — the competition record names
 * the association.
 */
const COUNTRY_BY_PROVIDER_NAME: Readonly<Record<string, string>> = {
  // Seeded in S-3
  england: 'GB',
  'united kingdom': 'GB',
  'great britain': 'GB',
  scotland: 'SC',
  spain: 'ES',
  germany: 'DE',
  italy: 'IT',
  france: 'FR',
  netherlands: 'NL',
  holland: 'NL',
  portugal: 'PT',
  belgium: 'BE',
  turkey: 'TR',
  türkiye: 'TR',
  greece: 'GR',
  switzerland: 'CH',
  austria: 'AT',
  sweden: 'SE',
  norway: 'NO',
  denmark: 'DK',
  poland: 'PL',
  brazil: 'BR',
  argentina: 'AR',
  'united states': 'US',
  usa: 'US',
  mexico: 'MX',
  japan: 'JP',
  'saudi arabia': 'SA',
  australia: 'AU',
  // Added in S-4 (D-2)
  wales: 'WA',
  ireland: 'IE',
  'republic of ireland': 'IE',
  ukraine: 'UA',
  russia: 'RU',
  croatia: 'HR',
  serbia: 'RS',
  slovenia: 'SI',
  slovakia: 'SK',
  czechia: 'CZ',
  'czech republic': 'CZ',
  hungary: 'HU',
  romania: 'RO',
  bulgaria: 'BG',
  cyprus: 'CY',
  finland: 'FI',
  lithuania: 'LT',
  monaco: 'MC',
  andorra: 'AD',
  liechtenstein: 'LI',
  canada: 'CA',
  colombia: 'CO',
  uruguay: 'UY',
  ecuador: 'EC',
  'south korea': 'KR',
  korea: 'KR',
  'korea republic': 'KR',
  china: 'CN',
  'china pr': 'CN',
  india: 'IN',
  egypt: 'EG',
  'south africa': 'ZA',
};

/**
 * Maps a provider country name onto a seeded code.
 *
 * RETURNS ABSENT, NEVER REJECTED, because every column referencing
 * `football.country` is nullable — `competition.country_code`,
 * `team.country_code`, `venue.country_code`, `player.nationality_code`. LC-05
 * requires absence rather than a substituted value, and PD-07 follows it: the
 * absence of a fact is the absence of a row, not a placeholder standing in.
 *
 * An unmapped country is counted as a rejected row on the write record and named
 * in the log, so the gap is visible and closable by adding a code to the S-3
 * seed under governance — not by this function inventing one.
 */
export function mapCountry(providerName: string | null | undefined): MappingResult {
  if (!providerName) return absent('provider reported no country');
  const key = providerName.trim().toLowerCase();
  const code = COUNTRY_BY_PROVIDER_NAME[key];
  if (code) return mapped(code);
  return absent(
    `country '${providerName}' has no seeded code. Add it to src/v2/seed/vocabulary.ts under governance; ` +
      'ingestion does not create vocabulary rows.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider position token → one of the 11 seeded canonical positions.
 *
 * The provider returns `positionsDetailed` as free text; V1's `parsePositions`
 * split it on commas and stored the tokens verbatim, which is how a position
 * vocabulary nobody governed came to exist.
 *
 * The single-letter provider codes are the coarse ones (G/D/M/F). They map to
 * the most defensible canonical position in their band — a bare 'D' becomes CB
 * rather than a full-back, because centre-back is the unmarked case and guessing
 * a side would be inventing information the provider did not give.
 */
const POSITION_BY_PROVIDER_TOKEN: Readonly<Record<string, string>> = {
  g: 'GK', gk: 'GK', goalkeeper: 'GK',
  d: 'CB', cb: 'CB', dc: 'CB', 'centre-back': 'CB', 'center-back': 'CB', defender: 'CB',
  lb: 'LB', dl: 'LB', 'left-back': 'LB', lwb: 'LB',
  rb: 'RB', dr: 'RB', 'right-back': 'RB', rwb: 'RB',
  dm: 'DM', dmc: 'DM', cdm: 'DM',
  m: 'CM', cm: 'CM', mc: 'CM', midfielder: 'CM',
  am: 'AM', amc: 'AM', cam: 'AM',
  lw: 'LW', lm: 'LW', ml: 'LW', aml: 'LW',
  rw: 'RW', rm: 'RW', mr: 'RW', amr: 'RW',
  cf: 'CF', f: 'CF', forward: 'CF',
  st: 'ST', striker: 'ST',
};

/**
 * Maps one provider position token.
 *
 * Returns ABSENT on failure: the only in-scope column referencing
 * `football.position` is `player_availability.position_code_at_onset`, which is
 * nullable. `football.position_profile` — the relation that would carry a
 * player's full positional profile — is NOT WRITTEN BY S-4 at all, because S-3
 * deliberately left its vocabulary unseeded until governed meaning exists in
 * S-6. Mapping a token is therefore possible; storing a profile is not yet.
 */
export function mapPosition(providerToken: string | null | undefined): MappingResult {
  if (!providerToken) return absent('provider reported no position');
  const key = providerToken.trim().toLowerCase();
  const code = POSITION_BY_PROVIDER_TOKEN[key];
  if (code) return mapped(code);
  return absent(`position token '${providerToken}' is not in the canonical mapping`);
}

/** The first mappable token from a provider's detailed position list. */
export function mapPrimaryPosition(raw: unknown): MappingResult {
  const tokens = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  for (const token of tokens) {
    const result = mapPosition(token);
    if (result.kind === 'MAPPED') return result;
  }
  return absent(tokens.length === 0 ? 'provider reported no position' : 'no token in the list is mappable');
}

// ─────────────────────────────────────────────────────────────────────────────
// CURRENCY — the one mapping that refuses
// ─────────────────────────────────────────────────────────────────────────────

/** The 14 currencies S-3 seeded, as provider-reported forms. */
const CURRENCY_BY_PROVIDER_TOKEN: Readonly<Record<string, string>> = {
  eur: 'EUR', '€': 'EUR', euro: 'EUR',
  gbp: 'GBP', '£': 'GBP', pound: 'GBP',
  usd: 'USD', $: 'USD', dollar: 'USD',
  jpy: 'JPY', '¥': 'JPY', yen: 'JPY',
  brl: 'BRL', ars: 'ARS', chf: 'CHF', sek: 'SEK', nok: 'NOK',
  dkk: 'DKK', pln: 'PLN', try: 'TRY', mxn: 'MXN', sar: 'SAR',
};

/**
 * Maps a provider currency onto a seeded code.
 *
 * THE ONLY MAPPING THAT REJECTS, because `player_valuation.currency_code` is
 * NOT NULL and there is no honest default.
 *
 * V1 read `proposedMarketValueRaw?.value` and DISCARDED the accompanying
 * currency, storing a bare scalar. Substituting EUR here would restore that
 * behaviour while looking rigorous: `football.currency.minor_unit` exists
 * precisely because a JPY valuation treated as EUR is wrong by two orders of
 * magnitude, and a valuation compared across currencies without it is compared
 * wrongly.
 *
 * A valuation is a DATED OBSERVATION whose trajectory is the point. A missing
 * one is a gap; a wrong one corrupts the series. So the row is not written, is
 * counted as rejected, and raises a DATA_QUALITY failure naming the currency.
 */
export function mapCurrency(providerToken: string | null | undefined): MappingResult {
  if (!providerToken) {
    return rejected(
      'provider reported no currency. player_valuation.currency_code is NOT NULL and no default is honest — ' +
        'minor_unit differences make a substituted currency wrong by orders of magnitude.'
    );
  }
  const key = providerToken.trim().toLowerCase();
  const code = CURRENCY_BY_PROVIDER_TOKEN[key];
  if (code) return mapped(code);
  return rejected(`currency '${providerToken}' has no seeded code. Add it under governance before ingesting valuations in it.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// UNAVAILABILITY AND REGISTRATION KIND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider injury/suspension description → `football.unavailability_kind`.
 *
 * Three seeded codes: INJURY, SUSPENSION, OTHER. OTHER is the vocabulary's own
 * fall-through, so this never fails — the reason text is retained verbatim on
 * `player_availability.reason`, which is where the provider's words belong.
 */
export function mapUnavailabilityKind(reason: string | null | undefined): string {
  if (!reason) return 'OTHER';
  const text = reason.toLowerCase();
  if (/suspen|ban\b|red card|disciplin/.test(text)) return 'SUSPENSION';
  if (/injur|strain|sprain|tear|fracture|knock|surgery|hamstring|acl|ligament|muscle/.test(text)) {
    return 'INJURY';
  }
  return 'OTHER';
}

/**
 * Registration kind, with its provenance.
 *
 * Returns BOTH because they are one decision. `player_registration` carries
 * `registration_kind_code` and `provenance_class_code`, and the honest pairing
 * depends on how the boundary was learned:
 *
 *   an explicit transfer record          -> OBSERVED
 *   a difference between squad snapshots -> INFERRED
 *
 * The column comment is explicit that an INFERRED boundary is "a materially
 * weaker fact than an OBSERVED one, and downstream consumers must be able to
 * tell". S-4 MUST NOT write OBSERVED for a diffed boundary — that is the single
 * most consequential provenance rule in this subsystem, because a calibration
 * population built on inferred registrations treated as observed is wrong in a
 * way nothing downstream can detect.
 */
export function mapRegistrationKind(options: {
  readonly providerType?: string | null;
  readonly derivedFromSnapshotDiff: boolean;
}): { readonly kind: string; readonly provenance: string } {
  const text = (options.providerType ?? '').toLowerCase();
  const kind = /loan/.test(text) ? (/out|from/.test(text) ? 'LOAN_OUT' : 'LOAN_IN') : 'PERMANENT';
  return {
    kind,
    provenance: options.derivedFromSnapshotDiff ? 'INFERRED' : 'OBSERVED',
  };
}
