// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE ENTITIES — competition, competition_edition, competition_stage, venue
//
// The first stage, because everything else references it. A fixture needs an
// edition; an edition needs a competition; a competition needs a country that
// S-3 already seeded.
//
// ─────────────────────────────────────────────────────────────────────────────
// COMPETITION EDITION IS THE ONE THAT MATTERS
//
// "THE most load-bearing entity in Layer 1. Its absence in the previous platform
// was the root of several unrelated-looking problems: statistics with no real
// referent, standings with no temporal home, fixtures with ambiguous context,
// and calibration keyed on a name that a sponsor rename could sever."
//
// V1 stored season as free text on the match row, which made "which season was
// active on this date" unanswerable. V2 requires a BOUNDED PERIOD — a daterange
// with an exclusion constraint forbidding two editions of one competition from
// overlapping. That constraint is why edition resolution below is careful about
// dates rather than trusting a season label.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { PROVIDER_CODE } from '../provider/config';
import { mapCountry } from '../mapping/index';
import { IngestionCounts, upsertMutable } from '../write/index';
import { slugify } from '../normalise';
import { logger } from '../../../utils/logger';

/** A competition as the provider reports it, already unwrapped from the feed. */
export interface ProviderCompetition {
  readonly externalId: string;
  readonly name: string;
  /** The provider's category name — a country in most cases, 'World' for others. */
  readonly categoryName: string | null;
}

export interface ProviderSeason {
  readonly externalId: string | null;
  readonly label: string;
  /** Bounded period. Derived when the provider gives only a label — see below. */
  readonly startsOn: string;
  readonly endsOn: string;
}

/**
 * Resolves a competition, creating or updating it.
 *
 * `country_code` is NULLABLE, so an unmapped country writes null and the gap is
 * counted rather than fatal (LC-05: absence rather than a substituted value).
 * The competition still resolves, the fixture still lands, and the missing code
 * is nameable from the log and closable by adding it to the S-3 seed under
 * governance.
 *
 * The slug is derived rather than provider-supplied because `uq_competition__slug`
 * is UNIQUE and the provider does not guarantee one.
 */
export async function resolveCompetition(
  tx: PoolClient,
  competition: ProviderCompetition,
  counts: IngestionCounts
): Promise<string> {
  const country = mapCountry(competition.categoryName);
  if (country.kind === 'ABSENT' && competition.categoryName) {
    counts.rejected += 1;
    logger.warn(
      { competition: competition.name, category: competition.categoryName, reason: country.reason },
      'v2 ingestion: competition country unmapped, writing null'
    );
  }

  const row = await upsertMutable(tx, {
    relation: 'football.competition',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code'],
    values: [
      PROVIDER_CODE,
      competition.externalId,
      competition.name,
      slugify(competition.name),
      country.kind === 'MAPPED' ? country.code : null,
    ],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });

  counts.examined += 1;
  counts.written += 1;
  return String(row.id);
}

/**
 * Resolves a competition edition.
 *
 * CONFLICT TARGET IS (competition_id, season_period), not the provider id.
 * `competition_edition.provider_external_id` is nullable and carries no unique
 * constraint — the schema's identity for an edition is the competition plus the
 * period, which is the point of the entity. Keying on the provider id would let
 * two editions of one competition overlap, and
 * `ex_competition_edition__periods_do_not_overlap` would refuse the second with
 * a message about exclusion constraints rather than about seasons.
 */
export async function resolveCompetitionEdition(
  tx: PoolClient,
  competitionId: string,
  season: ProviderSeason,
  counts: IngestionCounts
): Promise<string> {
  const row = await upsertMutable(tx, {
    relation: 'football.competition_edition',
    columns: ['competition_id', 'provider_external_id', 'season_label', 'season_period'],
    values: [
      competitionId,
      season.externalId,
      season.label,
      `[${season.startsOn},${season.endsOn})`,
    ],
    conflictTarget: ['competition_id', 'season_period'],
  });

  counts.examined += 1;
  counts.written += 1;
  return String(row.id);
}

/**
 * Resolves a competition stage — group phase, knockout round, matchweek.
 *
 * V1 HAD NO ROUND CONCEPT AT ALL, "which left a documented product gap
 * unfillable". Stages are optional on a fixture, so a feed that reports no round
 * leaves `competition_stage_id` null rather than inventing a stage 1.
 *
 * `nesting_depth` is 0 here throughout: the schedule feed reports a flat round,
 * never a hierarchy. A nested structure would need the tournament structure
 * endpoint, which S-4 does not call. Writing a fabricated depth would be
 * asserting a hierarchy nobody observed.
 */
export async function resolveCompetitionStage(
  tx: PoolClient,
  editionId: string,
  stage: { readonly ordinal: number; readonly name: string },
  counts: IngestionCounts
): Promise<string> {
  const row = await upsertMutable(tx, {
    relation: 'football.competition_stage',
    columns: ['competition_edition_id', 'stage_ordinal', 'nesting_depth', 'name'],
    values: [editionId, stage.ordinal, 0, stage.name],
    conflictTarget: ['competition_edition_id', 'stage_ordinal'],
  });

  counts.examined += 1;
  counts.written += 1;
  return String(row.id);
}

export interface ProviderVenue {
  readonly externalId: string;
  readonly name: string;
  readonly city: string | null;
  readonly countryName: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly capacity: number | null;
}

/**
 * Resolves a venue.
 *
 * "An entity in its own right rather than an attribute of a club, because venues
 * are shared, neutral venues exist, and travel calculation requires coordinates
 * belonging to the place rather than to whoever plays there."
 *
 * COORDINATES ARE PAIRED OR ABSENT — `ck_venue__coordinates_paired` requires
 * `(latitude IS NULL) = (longitude IS NULL)`. A provider reporting one without
 * the other yields neither, because half a coordinate locates nothing and would
 * be refused anyway. That refusal is correct; anticipating it here just makes
 * the reason legible.
 */
export async function resolveVenue(
  tx: PoolClient,
  venue: ProviderVenue,
  counts: IngestionCounts
): Promise<string> {
  const country = mapCountry(venue.countryName);
  const paired = venue.latitude !== null && venue.longitude !== null;

  const row = await upsertMutable(tx, {
    relation: 'football.venue',
    columns: ['provider_external_id', 'name', 'city', 'country_code', 'latitude', 'longitude', 'capacity'],
    values: [
      venue.externalId,
      venue.name,
      venue.city,
      country.kind === 'MAPPED' ? country.code : null,
      paired ? venue.latitude : null,
      paired ? venue.longitude : null,
      venue.capacity && venue.capacity > 0 ? venue.capacity : null,
    ],
    conflictTarget: ['provider_external_id'],
  });

  counts.examined += 1;
  counts.written += 1;
  return String(row.id);
}
