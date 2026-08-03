// ─────────────────────────────────────────────────────────────────────────────
// VOCABULARY SEEDING
//
// WHAT S-3 SEEDS, AND WHAT IT DELIBERATELY DOES NOT
//
// Seventeen code-keyed governed vocabularies exist in the approved schema.
// THIRTEEN ARE ALREADY SEEDED BY THE MIGRATIONS THEMSELVES (002 and 012), and
// S-3 must not re-seed, amend or re-order them — they are the migration set's
// data and the migration set owns them. This module VERIFIES their presence,
// because the registries seeded later reference them by foreign key and a
// missing code should be reported as a missing code, not discovered as a foreign
// key violation halfway through.
//
// Three are empty and are seeded here:
//
//   football.currency      minor units, referenced by player_valuation
//   football.country       ISO 3166-1 alpha-2, referenced by competition and team
//   football.position      the canonical playing positions
//
// TWO EMPTY VOCABULARIES ARE DELIBERATELY LEFT ALONE:
//
//   football.position_profile   Its governed meaning is defined by module logic
//                               that does not exist until S-6. Seeding it now
//                               would be inventing a vocabulary to fit a gap.
//   module.model_output_type    No model exists, so no output type is knowable.
//                               Guessing the codes would be invention, and the
//                               relation is not needed until S-7 writes
//                               snapshot.snapshot_model_output.
//
// COUNTRIES AND POSITIONS ARE NOT PROVIDER-OWNED. A provider is a source of
// data, not the owner of the domain model. S-4 ingestion maps provider values
// onto these canonical references and rejects what it cannot map — it does not
// create vocabulary dynamically, which is how V1 accumulated codes nobody
// governed.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { assertVocabularyPresent, seedRows, type SeedOutcome } from './helpers';

/**
 * Vocabularies the MIGRATIONS seed, with the codes the registries depend on.
 *
 * Verified, never written. If one of these is absent the migration set was not
 * applied correctly, and that is a deployment problem rather than something a
 * seed should paper over.
 */
export const MIGRATION_OWNED_VOCABULARIES = [
  { relation: 'football.subject_kind', column: 'code', codes: ['TEAM', 'PLAYER', 'FIXTURE', 'COMPETITION_EDITION'] },
  { relation: 'football.context_kind', column: 'code', codes: ['ALL_COMPETITIONS', 'COMPETITION_SCOPED', 'CROSS_COMPETITION_DERIVED'] },
  { relation: 'football.provenance_class', column: 'code', codes: ['OBSERVED', 'DERIVED', 'INFERRED', 'ESTIMATED'] },
  { relation: 'football.snapshot_point', column: 'code', codes: ['T_MINUS_7D', 'T_MINUS_3D', 'T_MINUS_1D', 'KICKOFF'] },
  { relation: 'module.calibration_mode', column: 'code', codes: ['OUTCOME_SCORED', 'CONTEXTUAL'] },
  { relation: 'module.module_status', column: 'code', codes: ['SUPPORTS', 'CONTRADICTS', 'NEUTRAL', 'INACTIVE'] },
  { relation: 'calibration.outcome_dimension', column: 'code', codes: ['MATCH_RESULT', 'GOAL_TOTAL', 'BOTH_SCORED', 'CLEAN_SHEET', 'MARGIN', 'HALF_TIME_STATE'] },
  { relation: 'operations.failure_class', column: 'code', codes: ['TRANSIENT', 'UPSTREAM', 'DATA_QUALITY', 'LOGIC'] },
] as const;

/**
 * Currencies, for football.player_valuation.
 *
 * minor_unit is the number of decimal places the currency subdivides into — two
 * for the euro, zero for the yen. It is stored because a valuation compared
 * across currencies without it is compared wrongly.
 */
const CURRENCIES: readonly (readonly [string, string, number, string])[] = [
  ['EUR', 'Euro', 2, 'The reporting currency of most European transfer valuations.'],
  ['GBP', 'Pound sterling', 2, 'English and Scottish domestic reporting.'],
  ['USD', 'US dollar', 2, 'Used by some providers as a common denominator.'],
  ['JPY', 'Japanese yen', 0, 'Zero minor units — a valuation divided by 100 would be wrong by two orders of magnitude.'],
  ['BRL', 'Brazilian real', 2, 'South American domestic reporting.'],
  ['ARS', 'Argentine peso', 2, 'South American domestic reporting.'],
  ['CHF', 'Swiss franc', 2, 'Swiss domestic reporting.'],
  ['SEK', 'Swedish krona', 2, 'Nordic domestic reporting.'],
  ['NOK', 'Norwegian krone', 2, 'Nordic domestic reporting.'],
  ['DKK', 'Danish krone', 2, 'Nordic domestic reporting.'],
  ['PLN', 'Polish złoty', 2, 'Central European domestic reporting.'],
  ['TRY', 'Turkish lira', 2, 'Turkish domestic reporting.'],
  ['MXN', 'Mexican peso', 2, 'North American domestic reporting.'],
  ['SAR', 'Saudi riyal', 2, 'Saudi Pro League reporting.'],
];

/**
 * Countries, ISO 3166-1 alpha-2, restricted to football nations the platform
 * can plausibly cover.
 *
 * A MINIMUM, not a complete ISO list. Every code here is a nation with a league
 * or a national side the platform may track; adding the full 249-entry ISO set
 * would put codes in a governed vocabulary that nothing will ever reference,
 * and a vocabulary nobody governs is the V1 pattern this replaces. S-4 adds a
 * code when a competition genuinely requires it, under the same governance.
 *
 * EXTENDED BY S-4 (decision D-2), 24 -> 51. `config/trackedLeagues.ts` declares
 * 57 leagues spanning roughly 48 countries, and 27 of them had no code — so a
 * Ukrainian or South Korean competition would have ingested with a NULL country
 * and become ungroupable by nation. That is the requirement S-3 anticipated
 * arriving, and this is the governance it anticipated: a static, reviewed,
 * ADDITIVE source change. The seed is insert-only, so nothing already seeded is
 * touched and re-running remains a no-op for the original 24.
 *
 * It is emphatically NOT dynamic vocabulary creation. V1 upserted countries from
 * the provider's category name on every sync (`syncDateMasterFeed.ts:473`), which
 * is how it accumulated codes nobody governed. Ingestion reads this list and
 * rejects what it cannot map; it never adds to it.
 *
 * The CHECK on this relation is `^[A-Z]{2}$`, so alpha-2 is the primary key and
 * alpha-3 is carried alongside for providers that report it.
 */
const COUNTRIES: readonly (readonly [string, string, string, string])[] = [
  ['GB', 'United Kingdom', 'GBR', 'Covers the four home nations; the competition record carries the specific association.'],
  ['ES', 'Spain', 'ESP', 'La Liga and Segunda División.'],
  ['DE', 'Germany', 'DEU', 'Bundesliga and 2. Bundesliga.'],
  ['IT', 'Italy', 'ITA', 'Serie A and Serie B.'],
  ['FR', 'France', 'FRA', 'Ligue 1 and Ligue 2.'],
  ['NL', 'Netherlands', 'NLD', 'Eredivisie.'],
  ['PT', 'Portugal', 'PRT', 'Primeira Liga.'],
  ['BE', 'Belgium', 'BEL', 'Belgian Pro League.'],
  ['TR', 'Turkey', 'TUR', 'Süper Lig.'],
  ['GR', 'Greece', 'GRC', 'Super League Greece.'],
  ['CH', 'Switzerland', 'CHE', 'Swiss Super League.'],
  ['AT', 'Austria', 'AUT', 'Austrian Bundesliga.'],
  ['SE', 'Sweden', 'SWE', 'Allsvenskan.'],
  ['NO', 'Norway', 'NOR', 'Eliteserien.'],
  ['DK', 'Denmark', 'DNK', 'Danish Superliga.'],
  ['PL', 'Poland', 'POL', 'Ekstraklasa.'],
  ['SC', 'Scotland', 'SCO', 'Scottish Premiership. Carried separately because the association is distinct from the GB state code.'],
  ['BR', 'Brazil', 'BRA', 'Série A.'],
  ['AR', 'Argentina', 'ARG', 'Primera División.'],
  ['US', 'United States', 'USA', 'Major League Soccer.'],
  ['MX', 'Mexico', 'MEX', 'Liga MX.'],
  ['JP', 'Japan', 'JPN', 'J1 League.'],
  ['SA', 'Saudi Arabia', 'SAU', 'Saudi Pro League.'],
  ['AU', 'Australia', 'AUS', 'A-League.'],

  // ── Added by S-4 (D-2), for tracked leagues that had no code ──────────────
  // FOOTBALL ASSOCIATION, NOT AN ISO COUNTRY. Wales has no ISO 3166-1 alpha-2 of
  // its own — it is the subdivision GB-WLS — but it fields a separate association
  // and a separate league, which is what this vocabulary is for. 'WA' is
  // unassigned in ISO 3166-1 today; it is a PLATFORM code occupying an ISO-shaped
  // slot, exactly as S-3's 'SC' for Scotland already is. See finding S4-1.
  ['WA', 'Wales', 'WAL', 'Cymru Premier, and Welsh clubs in the English pyramid. Carried separately because the association is distinct from the GB state code, as Scotland already is. Not an ISO country code — see S4-1.'],
  ['IE', 'Ireland', 'IRL', 'League of Ireland Premier Division.'],
  ['UA', 'Ukraine', 'UKR', 'Ukrainian Premier League.'],
  ['RU', 'Russia', 'RUS', 'Russian Premier League.'],
  ['HR', 'Croatia', 'HRV', 'HNL.'],
  ['RS', 'Serbia', 'SRB', 'Serbian SuperLiga.'],
  ['SI', 'Slovenia', 'SVN', 'Slovenian PrvaLiga.'],
  ['SK', 'Slovakia', 'SVK', 'Slovak Super Liga.'],
  ['CZ', 'Czechia', 'CZE', 'Czech First League. ISO renamed the country to Czechia; the code is unchanged.'],
  ['HU', 'Hungary', 'HUN', 'Nemzeti Bajnokság I.'],
  ['RO', 'Romania', 'ROU', 'Liga I.'],
  ['BG', 'Bulgaria', 'BGR', 'First Professional League.'],
  ['CY', 'Cyprus', 'CYP', 'Cypriot First Division.'],
  ['FI', 'Finland', 'FIN', 'Veikkausliiga.'],
  ['LT', 'Lithuania', 'LTU', 'A Lyga.'],
  ['MC', 'Monaco', 'MCO', 'Monégasque club competing in Ligue 1.'],
  ['AD', 'Andorra', 'AND', 'Andorran club competing in the Spanish pyramid.'],
  ['LI', 'Liechtenstein', 'LIE', 'Liechtenstein clubs competing in the Swiss pyramid.'],
  ['CA', 'Canada', 'CAN', 'Canadian clubs in Major League Soccer.'],
  ['CO', 'Colombia', 'COL', 'Categoría Primera A.'],
  ['UY', 'Uruguay', 'URY', 'Primera División.'],
  ['EC', 'Ecuador', 'ECU', 'Serie A.'],
  ['KR', 'South Korea', 'KOR', 'K League 1.'],
  ['CN', 'China', 'CHN', 'Chinese Super League.'],
  ['IN', 'India', 'IND', 'Indian Super League.'],
  ['EG', 'Egypt', 'EGY', 'Egyptian Premier League.'],
  ['ZA', 'South Africa', 'ZAF', 'Betway Premiership.'],
];

/**
 * The canonical playing positions.
 *
 * position_group is the broad zone a position belongs to — the distinction V1's
 * lineup code already makes, and the one that matters for department confidence:
 * a full-back and a centre-back are both defenders, and both must land in the
 * defensive bucket. V1 got this wrong once by prefix-matching position codes,
 * where 'RB' matched on 'R' and dropped every full-back out of defence; storing
 * the group explicitly removes the opportunity.
 *
 * Provider-specific aliases are NOT seeded. S-4 maps them onto these.
 */
const POSITIONS: readonly (readonly [string, string, string, string])[] = [
  ['GK', 'Goalkeeper', 'GOALKEEPER', 'The only position whose absence cannot be covered by another.'],
  ['CB', 'Centre-back', 'DEFENCE', 'Central defence.'],
  ['LB', 'Left-back', 'DEFENCE', 'Wide defence, left.'],
  ['RB', 'Right-back', 'DEFENCE', 'Wide defence, right.'],
  ['DM', 'Defensive midfielder', 'MIDFIELD', 'Holding midfield, screening the defence.'],
  ['CM', 'Central midfielder', 'MIDFIELD', 'Central midfield.'],
  ['AM', 'Attacking midfielder', 'MIDFIELD', 'Advanced central midfield.'],
  ['LW', 'Left winger', 'ATTACK', 'Wide attack, left.'],
  ['RW', 'Right winger', 'ATTACK', 'Wide attack, right.'],
  ['CF', 'Centre-forward', 'ATTACK', 'Central attack, dropping or linking.'],
  ['ST', 'Striker', 'ATTACK', 'Central attack, furthest forward.'],
];

/**
 * Seeds the three empty football vocabularies and verifies the thirteen the
 * migrations own.
 *
 * Runs as pt_pipeline_ingestion, which is the role holding INSERT on football.
 * That is not a convenience — the privilege matrix assigns writes by layer, and
 * football is ingestion's layer.
 */
export async function seedVocabularies(tx: PoolClient): Promise<SeedOutcome[]> {
  const outcomes: SeedOutcome[] = [];

  outcomes.push(
    await seedRows(
      tx,
      'football.currency',
      ['code', 'display_name', 'minor_unit', 'meaning'],
      CURRENCIES,
      ['code']
    )
  );

  outcomes.push(
    await seedRows(
      tx,
      'football.country',
      ['code', 'display_name', 'alpha3_code', 'meaning'],
      COUNTRIES,
      ['code']
    )
  );

  outcomes.push(
    await seedRows(
      tx,
      'football.position',
      ['code', 'display_name', 'position_group', 'meaning'],
      POSITIONS,
      ['code']
    )
  );

  return outcomes;
}

/**
 * Verifies every migration-owned vocabulary holds the codes the registries need.
 *
 * SEPARATE FROM THE SEED STAGES, AND RUN AS pt_platform_admin, because the
 * vocabularies span four schemas and no pipeline role can read all of them.
 * pt_pipeline_ingestion holds USAGE on football and operations only, so checking
 * module.calibration_mode under it fails with "permission denied for schema
 * module" — found by running it.
 *
 * The administrative role is the one principal with SELECT across every design
 * schema, which is exactly what a cross-schema precondition check needs and why
 * it is the right role for this and the wrong role for the seeding itself.
 */
export async function verifyMigrationVocabularies(tx: PoolClient): Promise<void> {
  for (const vocabulary of MIGRATION_OWNED_VOCABULARIES) {
    await assertVocabularyPresent(tx, vocabulary.relation, vocabulary.column, vocabulary.codes);
  }
}

/**
 * Codes in this vocabulary that are NOT ISO 3166-1 alpha-2 country codes.
 *
 * Both are football ASSOCIATIONS carried separately from the state they sit in,
 * because each fields its own league and the competition record must name it.
 * Neither has an alpha-2 of its own — Scotland is GB-SCT and Wales is GB-WLS.
 *
 * 'SC' IS A GENUINE COLLISION: in ISO 3166-1 it denotes Seychelles. S-3 seeded it
 * for Scotland, so the platform cannot later represent Seychelles without a
 * conflict. Recorded as finding S4-1 rather than corrected here — the seed has no
 * update path by design, and changing a seeded code is exactly what the
 * append-only posture forbids. 'WA' is unassigned in ISO today, so it collides
 * with nothing, but it carries the same caveat.
 *
 * Exported so the ingestion mapper and the test suite can both name them without
 * restating the list.
 */
export const NON_ISO_ASSOCIATION_CODES = ['SC', 'WA'] as const;

/** Exposed for the test suite, so expectations are not restated by hand. */
export const VOCABULARY_COUNTS = {
  currency: CURRENCIES.length,
  country: COUNTRIES.length,
  position: POSITIONS.length,
} as const;
