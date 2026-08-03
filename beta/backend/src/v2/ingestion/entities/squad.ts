// ─────────────────────────────────────────────────────────────────────────────
// SQUAD STATE — player_registration, player_availability, player_valuation
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE PLACE DUPLICATE HANDLING IS AN ALGORITHM
//
// player_registration and player_availability carry EXCLUSION constraints, not
// unique constraints:
//
//   EXCLUDE USING gist (player_id WITH =, registration_kind_code WITH =,
//                       registration_period WITH &&)
//
// ON CONFLICT cannot target an exclusion constraint. There is no clause to
// write. A re-observed spell is not a duplicate key — it is either THE SAME OPEN
// SPELL, which needs nothing done, or A BOUNDARY EVENT, which needs the current
// period closed and a successor opened.
//
// So this file reads the open spell first and decides. Everywhere else in S-4 the
// database settles duplicates; here the application must, because the schema
// deliberately models a fact the conflict machinery cannot express.
//
// ─────────────────────────────────────────────────────────────────────────────
// PROVENANCE IS THE RULE THAT MATTERS MOST IN THIS FILE
//
// "An INFERRED registration boundary — derived by comparing squad snapshots — is
// a materially weaker fact than an OBSERVED one, and downstream consumers must
// be able to tell."
//
// A boundary learned from an explicit transfer record is OBSERVED. A boundary
// learned by noticing a player is in this week's squad and was not in last
// week's is INFERRED. Writing OBSERVED for the second is the single most
// damaging thing this subsystem could do: a calibration population built on
// inferred registrations treated as observed is wrong in a way nothing
// downstream can detect, because the marker that would reveal it is the one that
// was falsified.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { mapCurrency, mapPrimaryPosition, mapRegistrationKind, mapUnavailabilityKind } from '../mapping/index';
import { IngestionCounts, insertAppendOnly } from '../write/index';
import { toIsoDate, text, utcDateString } from '../normalise';
import { logger } from '../../../utils/logger';

/** How a registration boundary came to be known. Decides its provenance class. */
export type BoundaryEvidence =
  /** An explicit transfer record from the provider. */
  | 'TRANSFER_RECORD'
  /** A difference between two squad observations. Weaker, and marked so. */
  | 'SNAPSHOT_DIFFERENCE';

export interface ProviderRegistration {
  readonly playerId: string;
  readonly teamId: string;
  readonly providerType: string | null;
  readonly evidence: BoundaryEvidence;
  /** The date the registration is known or believed to have begun. */
  readonly startsOn: string;
}

interface OpenRegistration {
  readonly id: string;
  readonly teamId: string;
  readonly startsOn: string;
}

/**
 * Reads the player's open registration of a given kind, if any.
 *
 * "Open" means an unbounded upper endpoint. `upper_inf()` is the range function
 * that expresses it; a comparison against a sentinel date would be the kind of
 * substituted value the schema avoids everywhere else.
 */
async function openRegistration(
  tx: PoolClient,
  playerId: string,
  kind: string
): Promise<OpenRegistration | null> {
  const { rows } = await tx.query<{ id: string; team_id: string; starts_on: string }>(
    `SELECT id::text, team_id::text, lower(registration_period)::text AS starts_on
       FROM football.player_registration
      WHERE player_id = $1
        AND registration_kind_code = $2
        AND upper_inf(registration_period)`,
    [playerId, kind]
  );
  const row = rows[0];
  return row ? { id: row.id, teamId: row.team_id, startsOn: row.starts_on } : null;
}

/**
 * Records a player's registration, succeeding the previous one when the club
 * has changed.
 *
 * THREE OUTCOMES, and only the third writes:
 *
 *   1. an open registration at the SAME club   -> nothing. Not a duplicate to
 *                                                 resolve; the fact is unchanged
 *   2. an open registration at ANOTHER club    -> close it at the boundary date,
 *                                                 then open the successor
 *   3. no open registration                    -> open one
 *
 * Case 2 is the only UPDATE this subsystem performs on a football relation, and
 * it is legitimate: `player_registration` is not in the append-only lifecycle
 * class, ingestion holds UPDATE on it, and closing a period is what "the
 * transfer is the BOUNDARY between two registrations" means operationally. The
 * closed row keeps its start date and its provenance; nothing about the past is
 * restated.
 */
export async function recordRegistration(
  tx: PoolClient,
  registration: ProviderRegistration,
  counts: IngestionCounts
): Promise<void> {
  const { kind, provenance } = mapRegistrationKind({
    providerType: registration.providerType,
    derivedFromSnapshotDiff: registration.evidence === 'SNAPSHOT_DIFFERENCE',
  });

  counts.examined += 1;
  const open = await openRegistration(tx, registration.playerId, kind);

  if (open && open.teamId === registration.teamId) {
    counts.skipped += 1;
    return;
  }

  if (open) {
    // Close at the successor's start. `ck_player_registration__period_bounded`
    // refuses an empty range, so a boundary dated at or before the existing
    // start would be refused — correctly, since it would claim a registration
    // ended before it began.
    if (registration.startsOn <= open.startsOn) {
      counts.reject('boundary date is not after the open registration start');
      logger.warn(
        { player: registration.playerId, openSince: open.startsOn, boundary: registration.startsOn },
        'v2 ingestion: registration boundary precedes the open spell, refusing to close it'
      );
      return;
    }
    await tx.query(
      `UPDATE football.player_registration
          SET registration_period = daterange(lower(registration_period), $2::date, '[)'),
              updated_at = now()
        WHERE id = $1`,
      [open.id, registration.startsOn]
    );
  }

  await tx.query(
    `INSERT INTO football.player_registration
       (player_id, team_id, registration_kind_code, registration_period, provenance_class_code)
     VALUES ($1, $2, $3, daterange($4::date, NULL, '[)'), $5)`,
    [registration.playerId, registration.teamId, kind, registration.startsOn, provenance]
  );
  counts.written += 1;
}

export interface ProviderUnavailability {
  readonly playerId: string;
  readonly reason: string | null;
  readonly startsOn: string;
  readonly expectedReturnOn: string | number | null;
  /** Provider's detailed position list, for the point-in-time capture. */
  readonly positionsRaw: unknown;
  readonly valuationAmount: number | null;
  readonly valuationCurrency: string | null;
}

/**
 * Records an unavailability spell, or leaves an equivalent open one alone.
 *
 * "CURRENT AVAILABILITY IS A QUERY OVER OPEN SPELLS, NEVER A STORED FLAG
 * (LC-11)." Nothing here writes an is-injured boolean, because none exists.
 *
 * `position_code_at_onset` and the valuation pair are POINT-IN-TIME CAPTURES:
 * "A player's importance at the moment of injury is not recoverable later once
 * the profile moves on. The previous platform applied this instinct here and
 * almost nowhere else; it is preserved."
 *
 * The valuation pair is governed by `ck_player_availability__valuation_currencied`
 * — amount and currency are both present or both absent. An amount whose
 * currency will not map yields NEITHER, rather than an amount in an assumed
 * currency, for the reason set out in mapCurrency().
 */
export async function recordUnavailability(
  tx: PoolClient,
  spell: ProviderUnavailability,
  counts: IngestionCounts
): Promise<void> {
  const kind = mapUnavailabilityKind(spell.reason);
  counts.examined += 1;

  const { rows } = await tx.query<{ id: string }>(
    `SELECT id::text FROM football.player_availability
      WHERE player_id = $1 AND unavailability_kind_code = $2 AND upper_inf(spell_period)`,
    [spell.playerId, kind]
  );
  if (rows.length > 0) {
    // The spell is already open and still open. Nothing has changed, and
    // re-opening it would collide with the exclusion constraint anyway.
    counts.skipped += 1;
    return;
  }

  const position = mapPrimaryPosition(spell.positionsRaw);
  const currency = spell.valuationAmount !== null ? mapCurrency(spell.valuationCurrency) : null;
  const captureValuation = currency !== null && currency.kind === 'MAPPED';

  await tx.query(
    `INSERT INTO football.player_availability
       (player_id, unavailability_kind_code, spell_period, expected_return_on, reason,
        position_code_at_onset, valuation_amount_at_onset, valuation_currency_code_at_onset)
     VALUES ($1, $2, daterange($3::date, NULL, '[)'), $4, $5, $6, $7, $8)`,
    [
      spell.playerId,
      kind,
      spell.startsOn,
      toIsoDate(spell.expectedReturnOn),
      text(spell.reason),
      position.kind === 'MAPPED' ? position.code : null,
      captureValuation ? spell.valuationAmount : null,
      captureValuation && currency.kind === 'MAPPED' ? currency.code : null,
    ]
  );
  counts.written += 1;
}

/**
 * Closes any open unavailability spell the provider no longer reports.
 *
 * A spell that ends is not reported as ending — it simply stops appearing. The
 * absence is the signal, which is why this takes the set of players CURRENTLY
 * reported unavailable and closes everything else that is open for the squad.
 *
 * Bounded to one team's players deliberately. A global sweep would close spells
 * for players whose squad was not fetched this run, reading "not observed" as
 * "recovered" — the same mistake as treating a thin response as a retraction.
 */
export async function closeResolvedSpells(
  tx: PoolClient,
  teamPlayerIds: readonly string[],
  stillUnavailablePlayerIds: readonly string[],
  counts: IngestionCounts
): Promise<void> {
  if (teamPlayerIds.length === 0) return;
  const { rowCount } = await tx.query(
    `UPDATE football.player_availability
        SET spell_period = daterange(lower(spell_period), $3::date, '[)'),
            updated_at = now()
      WHERE player_id = ANY($1::bigint[])
        AND NOT (player_id = ANY($2::bigint[]))
        AND upper_inf(spell_period)
        AND lower(spell_period) < $3::date`,
    [teamPlayerIds, stillUnavailablePlayerIds, utcDateString(new Date())]
  );
  counts.examined += rowCount ?? 0;
  counts.written += rowCount ?? 0;
}

export interface ProviderValuation {
  readonly playerId: string;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly asOfOn: string;
  /** Which provider stated it. Part of the natural key. */
  readonly sourceCode: string;
}

/**
 * Records dated market valuations.
 *
 * APPEND-ONLY. Ingestion holds S and I, never UPDATE, and the append guard
 * refuses one regardless. `uq_player_valuation__player_src_asof` makes the grain
 * one observation per player per source per day, so re-running a sync the same
 * day writes nothing and reports it as skipped.
 *
 * "A dated observation, not a description of a permanent present. The previous
 * platform stored one undated, uncurrencied scalar overwritten on every
 * ingestion, discarding valuation TRAJECTORY continuously — and a rising and a
 * falling valuation at the same absolute figure describe very different players."
 *
 * A valuation whose currency will not map IS NOT WRITTEN. See mapCurrency() for
 * why no default is honest.
 */
export async function recordValuations(
  tx: PoolClient,
  valuations: readonly ProviderValuation[],
  counts: IngestionCounts
): Promise<void> {
  const rows: unknown[][] = [];

  for (const valuation of valuations) {
    if (valuation.amount === null || valuation.amount < 0) {
      counts.reject('valuation absent or negative');
      continue;
    }
    const currency = mapCurrency(valuation.currency);
    if (currency.kind !== 'MAPPED') {
      counts.reject(currency.reason);
      logger.warn(
        { player: valuation.playerId, currency: valuation.currency, reason: currency.reason },
        'v2 ingestion: valuation currency unmapped, valuation not written'
      );
      continue;
    }
    rows.push([valuation.playerId, valuation.sourceCode, valuation.asOfOn, valuation.amount, currency.code]);
  }

  const result = await insertAppendOnly(tx, {
    relation: 'football.player_valuation',
    columns: ['player_id', 'source_code', 'as_of_on', 'amount', 'currency_code'],
    rows,
    conflictTarget: ['player_id', 'source_code', 'as_of_on'],
  });
  counts.add(result);
}
