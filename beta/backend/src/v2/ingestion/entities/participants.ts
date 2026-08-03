// ─────────────────────────────────────────────────────────────────────────────
// PARTICIPANTS — team, team_registration, player
//
// ─────────────────────────────────────────────────────────────────────────────
// PLAYER IS BIOGRAPHY ONLY
//
// "The previous platform carried four further concerns on this record —
// positional profile across five attributes plus a list, current club, injury
// state across ten attributes duplicating a separate structure, and an undated
// market value overwritten on every sync. All four are separated:
// position_profile, player_registration, player_availability, player_valuation.
// This record holds no computed attribute (LC-07)."
//
// So this file writes name, date of birth, height, preferred foot and
// nationality. It does NOT write the player's club — that is a dated
// registration in squad.ts — and it does not write market value, injury state or
// positional profile.
//
// The temptation is real: the squad response carries all of it, and writing it
// here would be one statement instead of four. It would also rebuild the exact
// shape V2 exists to dismantle.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { PROVIDER_CODE } from '../provider/config';
import { mapCountry } from '../mapping/index';
import { IngestionCounts, upsertMutable } from '../write/index';
import { slugify, toIsoDate, text } from '../normalise';
import { logger } from '../../../utils/logger';

export interface ProviderTeam {
  readonly externalId: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly countryName: string | null;
  /** Resolved venue id, when the feed identified a home ground. */
  readonly homeVenueId: string | null;
}

/**
 * Resolves a team.
 *
 * "One of the two hub entities. Identity is permanent without exception —
 * sealed claims reference it indefinitely, so a club dissolved five years ago
 * retains its identity (LC-02)."
 *
 * That permanence is why the conflict target is the provider alternate key and
 * why nothing here ever deletes: ingestion holds no DELETE on football, so a
 * club that vanishes from the feed simply stops being updated. Its identity, and
 * every claim referencing it, survive.
 */
export async function resolveTeam(
  tx: PoolClient,
  team: ProviderTeam,
  counts: IngestionCounts
): Promise<string> {
  const country = mapCountry(team.countryName);
  if (country.kind === 'ABSENT' && team.countryName) {
    counts.rejected += 1;
    logger.warn(
      { team: team.name, country: team.countryName, reason: country.reason },
      'v2 ingestion: team country unmapped, writing null'
    );
  }

  const row = await upsertMutable(tx, {
    relation: 'football.team',
    columns: [
      'provider_code',
      'provider_external_id',
      'name',
      'short_name',
      'slug',
      'country_code',
      'home_venue_id',
    ],
    values: [
      PROVIDER_CODE,
      team.externalId,
      team.name,
      team.shortName,
      slugify(team.name),
      country.kind === 'MAPPED' ? country.code : null,
      team.homeVenueId,
    ],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });

  counts.examined += 1;
  counts.written += 1;
  return String(row.id);
}

/**
 * Records that a team is registered in a competition edition.
 *
 * "Answers 'which clubs are in this competition this season' — a question the
 * previous platform could answer only by inference from standings or the fixture
 * list, both indirect and both failing for a club registered but not yet played."
 *
 * Derived from fixture participation, which is the one signal the schedule feed
 * gives. `registered_on` is the earliest date the club is seen in the edition,
 * so a re-run never moves it backwards or forwards — the COALESCE in
 * `upsertMutable` leaves the existing value, and `uq_team_registration__team_edition`
 * makes it one row per pairing.
 *
 * The limitation is stated rather than hidden: a club registered but not yet
 * fixtured is still invisible here. Closing that needs a registration endpoint
 * S-4 does not call, and inventing a registration date from nothing would be
 * worse than the gap.
 */
export async function recordTeamRegistration(
  tx: PoolClient,
  teamId: string,
  editionId: string,
  registeredOn: string,
  counts: IngestionCounts
): Promise<void> {
  await upsertMutable(tx, {
    relation: 'football.team_registration',
    columns: ['team_id', 'competition_edition_id', 'registered_on'],
    values: [teamId, editionId, registeredOn],
    conflictTarget: ['team_id', 'competition_edition_id'],
    // Never moved once set. The first date the club appears in the edition is
    // the best evidence available, and a later fixture is not evidence against it.
    immutableColumns: ['registered_on'],
  });
  counts.examined += 1;
  counts.written += 1;
}

export interface ProviderPlayer {
  readonly externalId: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly dateOfBirth: string | number | null;
  readonly nationalityName: string | null;
  readonly heightCm: number | null;
  readonly preferredFoot: string | null;
}

/** `ck_player__preferred_foot_known` admits exactly these three. */
function normalisePreferredFoot(raw: string | null): string | null {
  const value = text(raw)?.toUpperCase();
  if (value === 'LEFT' || value === 'RIGHT' || value === 'BOTH') return value;
  return null;
}

/**
 * Resolves a player — biography only.
 *
 * `height_cm` is bounded by `ck_player__height_plausible` at 120–250. A figure
 * outside that band is dropped to null rather than clamped: clamping a provider's
 * 8 (metres? feet?) to 120 would assert a height nobody measured, where null
 * says only that the height is unknown.
 */
export async function resolvePlayer(
  tx: PoolClient,
  player: ProviderPlayer,
  counts: IngestionCounts
): Promise<string> {
  const nationality = mapCountry(player.nationalityName);
  const height =
    typeof player.heightCm === 'number' && player.heightCm >= 120 && player.heightCm <= 250
      ? Math.trunc(player.heightCm)
      : null;

  const row = await upsertMutable(tx, {
    relation: 'football.player',
    columns: [
      'provider_code',
      'provider_external_id',
      'full_name',
      'short_name',
      'slug',
      'date_of_birth',
      'nationality_code',
      'height_cm',
      'preferred_foot',
    ],
    values: [
      PROVIDER_CODE,
      player.externalId,
      player.name,
      player.shortName,
      // The provider id is folded into the slug because two players genuinely
      // share a name often enough that uq_player__slug would collide, and a
      // collision would either fail the run or — worse, if it were resolved by
      // reusing the row — merge two people into one.
      `${slugify(player.name)}-${player.externalId}`,
      toIsoDate(player.dateOfBirth),
      nationality.kind === 'MAPPED' ? nationality.code : null,
      height,
      normalisePreferredFoot(player.preferredFoot),
    ],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });

  counts.examined += 1;
  counts.written += 1;
  return String(row.id);
}
