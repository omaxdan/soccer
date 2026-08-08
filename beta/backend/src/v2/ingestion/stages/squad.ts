// ─────────────────────────────────────────────────────────────────────────────
// SQUAD STAGE — one team, one transaction
//
// Wires the four squad writers that S-4 built and never called (G-4, G-9). The
// writers are UNCHANGED; this file is the runner they were missing.
//
// ─────────────────────────────────────────────────────────────────────────────
// ORDER IS FORCED, AND THE LAST STEP IS THE DANGEROUS ONE
//
//   1. resolvePlayer          × N   establishes player_id
//   2. recordRegistration     × N   reads the open spell, may close and succeed it
//   3. recordUnavailability   × injured   opens a spell if none is open
//   4. closeResolvedSpells    × 1   closes spells the provider no longer reports
//   5. recordValuations       × 1   append-only, order-independent
//
// Step 4 MUST follow 1 and 3, because it takes both sets as arguments: the
// players observed in this response, and those still reported unavailable. It
// closes everything else that is open for those players.
//
// ─────────────────────────────────────────────────────────────────────────────
// AN INCOMPLETE RESPONSE MUST NOT CLOSE A VALID SPELL
//
// `closeResolvedSpells` treats absence as recovery — that is its documented
// design: "A spell that ends is not reported as ending — it simply stops
// appearing. The absence is the signal."
//
// The unit of trust is therefore THE TEAM'S SQUAD RESPONSE. Absence within a
// squad we successfully fetched is evidence; absence because we fetched nothing
// is not. So closing is gated on the response having produced at least one
// resolved player. A zero-player response is a FAILED OBSERVATION, not a report
// of a fully fit squad, and this stage refuses to read it as one.
//
// That gate invents no threshold. It does not ask whether a squad "looks big
// enough" — a judgement nobody can source — it asks only whether an observation
// happened at all.
//
// The writer's own bounding still applies underneath: it touches only the player
// ids passed to it, so a player absent from this response is never affected.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE OBSERVATION DATE IS CAPTURED ONCE AND PASSED DOWN
//
// A roster response says who is at the club NOW. It carries no registration
// start date — V1 reads `contractUntilTimestamp`, which is an END date — so the
// boundary this stage can honestly assert is the date it OBSERVED the
// membership, marked INFERRED by `mapRegistrationKind` because it was learned by
// snapshot difference rather than from a transfer record.
//
// One date per run, supplied by the caller, following the S-5 discipline: "the
// clock is captured ONCE per run and passed down, so two pairs in one run cannot
// be judged against two different 'now's."
//
// `closeResolvedSpells` still reads the wall clock internally. That is a known
// defect (doc 29 B-2) and it is NOT worked around here — working around it would
// hide it. This stage passes its own observation date where it can and leaves
// the writer exactly as it is.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS STAGE MUST NEVER PRODUCE
//
// G-1 is OPEN. Nothing here creates or implies fixture-level participation: no
// minutes, no starter status, no unused-substitute status, no lineup, no
// appearance, no season-minute allocation. A roster is a statement about
// MEMBERSHIP, not about who played.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { ProviderClient } from '../provider/client';
import { PROVIDER_CODE } from '../provider/config';
import { IngestionCounts } from '../write/index';
import { resolvePlayer } from '../entities/participants';
import {
  closeResolvedSpells,
  recordRegistration,
  recordUnavailability,
  recordValuations,
  type ProviderValuation,
} from '../entities/squad';
import { text, toIsoDate, utcDateString } from '../normalise';
import { logger } from '../../../utils/logger';

/** Per-relation counts, which is the grain `operations.write_record` stores. */
export interface SquadStageCounts {
  readonly total: IngestionCounts;
  readonly byRelation: ReadonlyMap<string, IngestionCounts>;
}

class StageAccumulator {
  readonly total = new IngestionCounts();
  readonly byRelation = new Map<string, IngestionCounts>();

  for(relation: string): IngestionCounts {
    let counts = this.byRelation.get(relation);
    if (!counts) {
      counts = new IngestionCounts();
      this.byRelation.set(relation, counts);
    }
    return counts;
  }

  /** Folds per-relation counts into the total. Called once, at the end. */
  seal(): SquadStageCounts {
    for (const counts of this.byRelation.values()) this.total.add(counts);
    return { total: this.total, byRelation: this.byRelation };
  }
}

/** The provider's roster payload, kept loose because it is external data. */
interface SquadResponse {
  readonly players?: readonly unknown[];
  readonly data?: { readonly players?: readonly unknown[] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function externalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The provider nests the player differently across shapes.
 *
 * V1's own comment says "SofaScore nests player under 'player' key", and then
 * reads `p.id` directly — because the SportsAPI Pro reseller shape flattens it.
 * Both are accepted rather than betting on one, which costs a line and removes a
 * whole class of silent empty ingestion.
 */
function playerRecord(entry: unknown): Record<string, unknown> | null {
  const outer = asRecord(entry);
  if (!outer) return null;
  const nested = asRecord(outer.player);
  return nested ?? outer;
}

export interface SquadTeam {
  /** Surrogate id of `football.team`. */
  readonly teamId: string;
  /** Provider id, which is what the endpoint is keyed by. */
  readonly providerExternalId: string;
  /** Diagnostic only. */
  readonly name: string;
}

/**
 * Ingests one team's squad.
 *
 * Runs inside a `withRun` transaction as `pt_pipeline_ingestion`. Everything
 * this function writes commits together or not at all — a half-ingested squad is
 * worse than an absent one, because the next attempt would find some players
 * present and skip them, and because a registration succeeded without its
 * matching availability describes a state that never existed.
 *
 * `observedOn` is the run's single observation date, `YYYY-MM-DD` UTC.
 */
export async function ingestTeamSquad(
  tx: PoolClient,
  client: ProviderClient,
  team: SquadTeam,
  observedOn: string
): Promise<SquadStageCounts> {
  const response = await client.get<SquadResponse>('team_players', { id: team.providerExternalId });
  const entries = response.players ?? response.data?.players ?? [];
  const stage = new StageAccumulator();

  /** Players resolved from THIS response. The bound on step 4. */
  const observedPlayerIds: string[] = [];
  /** Of those, the ones the provider still reports unavailable. */
  const stillUnavailablePlayerIds: string[] = [];
  const valuations: ProviderValuation[] = [];

  for (const entry of entries) {
    const raw = playerRecord(entry);
    if (!raw) {
      stage.for('football.player').reject('squad entry is not an object');
      continue;
    }

    const providerPlayerId = externalId(raw.id);
    if (!providerPlayerId) {
      stage.for('football.player').reject('squad entry has no provider player id');
      continue;
    }

    // ── 1. Player identity ────────────────────────────────────────────────
    const playerId = await resolvePlayer(
      tx,
      {
        externalId: providerPlayerId,
        name: text(raw.name) ?? `Player ${providerPlayerId}`,
        shortName: text(raw.shortName),
        dateOfBirth: (raw.dateOfBirth ?? raw.dateOfBirthTimestamp) as string | number | null,
        nationalityName: text(asRecord(raw.country)?.name),
        heightCm: finiteNumber(raw.height),
        preferredFoot: text(raw.preferredFoot),
      },
      stage.for('football.player')
    );
    observedPlayerIds.push(playerId);

    // ── 2. Registration ───────────────────────────────────────────────────
    // The roster states membership, not a transfer. Evidence is therefore
    // SNAPSHOT_DIFFERENCE, which `mapRegistrationKind` turns into INFERRED —
    // "the single most consequential provenance rule in this subsystem".
    await recordRegistration(
      tx,
      {
        playerId,
        teamId: team.teamId,
        providerType: text(raw.transferType) ?? text(raw.type),
        evidence: 'SNAPSHOT_DIFFERENCE',
        startsOn: observedOn,
      },
      stage.for('football.player_registration')
    );

    // ── 3. Availability — only where the provider states one ──────────────
    const injury = asRecord(raw.injury);
    if (injury) {
      stillUnavailablePlayerIds.push(playerId);
      const valuationRaw = asRecord(raw.proposedMarketValueRaw);
      await recordUnavailability(
        tx,
        {
          playerId,
          reason: text(injury.reason) ?? text(injury.status),
          // The provider's own start where it gives one; otherwise the date we
          // observed the spell. `spell_period` is NOT NULL and the spell is open
          // now, so the observation is the only bounded start available — and it
          // is a statement about when we saw it, not a claim about when it began.
          startsOn: toIsoDate(injury.startTimestamp as string | number | null) ?? observedOn,
          expectedReturnOn: (injury.expectedReturn ?? injury.endTimestamp ?? null) as
            | string
            | number
            | null,
          positionsRaw: raw.positionsDetailed ?? raw.position ?? null,
          valuationAmount: finiteNumber(valuationRaw?.value),
          valuationCurrency: text(valuationRaw?.currency),
        },
        stage.for('football.player_availability')
      );
    }

    // ── 5. Valuation, collected here and written once below ───────────────
    // ONLY where the provider supplies BOTH an amount and a currency. V1 read
    // the amount and discarded the currency; `mapCurrency` refuses that, and a
    // missing currency therefore yields no row rather than a row in an assumed
    // currency.
    const valuation = asRecord(raw.proposedMarketValueRaw);
    if (valuation) {
      valuations.push({
        playerId,
        amount: finiteNumber(valuation.value),
        currency: text(valuation.currency),
        asOfOn: observedOn,
        sourceCode: PROVIDER_CODE,
      });
    }
  }

  // ── 4. Close resolved spells — GATED ────────────────────────────────────
  // Only when an observation actually happened. See the header.
  if (observedPlayerIds.length > 0) {
    await closeResolvedSpells(
      tx,
      observedPlayerIds,
      stillUnavailablePlayerIds,
      stage.for('football.player_availability')
    );
  } else {
    logger.warn(
      { team: team.name, providerExternalId: team.providerExternalId },
      'v2 ingestion: squad response resolved no players — not closing any availability spell'
    );
  }

  if (valuations.length > 0) {
    await recordValuations(tx, valuations, stage.for('football.player_valuation'));
  }

  logger.info(
    {
      team: team.name,
      entries: entries.length,
      resolved: observedPlayerIds.length,
      unavailable: stillUnavailablePlayerIds.length,
    },
    'v2 ingestion: squad processed'
  );
  return stage.seal();
}
