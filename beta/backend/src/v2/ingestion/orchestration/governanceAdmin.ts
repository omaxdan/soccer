// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANCE ADMIN — register a tracked competition/edition, and link a governed
// edition to its materialized football reality.
//
//   npm run governance:register -- --tournament 325 --season 87678 \
//                                  --from 2026-01-01 --to 2027-01-01 --authorize
//   npm run governance:link            # link every pending governance edition
//
// WHY THIS EXISTS
//
// Gate 3 selection reads governance; Gate 6C/6D consult coverage keyed on the
// materialized football.competition_edition. Two production entry points were
// missing between "an edition is authorized" and "coverage-aware skipping works":
//
//   1. REGISTRATION — creating governance.tracked_competition + tracked_edition.
//      Previously done only by tests/manual SQL.
//   2. LINKAGE — populating governance.tracked_edition.competition_edition_id once
//      football.competition_edition materialises (the Gate 6E-identified gap).
//      Until it is set, Gate 6C is bypassed and every governed re-run redispatches
//      the whole window.
//
// ROLE BOUNDARY. Governance writes belong to pt_platform_admin (SIU on governance,
// migration 025). pt_pipeline_ingestion stays SELECT-only on governance and is
// NOT touched here. This module authorizes nothing at ingest time — it records the
// operator's governance decision; Gate 3/4 remain the authorization authorities.
//
// LINKAGE IDENTITY — AUTHORITATIVE, NOT PLAUSIBLE.
// football.competition_edition.provider_external_id carries a GLOBAL unique
// constraint (uq_competition_edition__provider_external_id, migration 022:
// "ONE PROVIDER SEASON IS ONE EDITION"), and ingestion stores the provider
// season.id there (resolveCompetitionEdition, conflict target provider_external_id).
// governance.tracked_edition.provider_season_external_id is that same provider
// season.id. So
//     football.competition_edition.provider_external_id
//       = governance.tracked_edition.provider_season_external_id
// resolves to AT MOST ONE edition by a real constraint — the match is deterministic,
// never a guess. Consistency with the competition linkage is asserted, and an
// edition that resolves to a different competition than the governance row names is
// reported, never linked.
// ─────────────────────────────────────────────────────────────────────────────

import '../../config/env';

import type { PoolClient } from 'pg';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { PROVIDER_CODE } from '../provider/config';
import { logger } from '../../../utils/logger';

/** The one role permitted to write governance (migration 025: SIU). */
export const GOVERNANCE_ADMIN_ROLE = 'pt_platform_admin' as const;

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterTrackedEditionParams {
  readonly providerCode?: string;
  /** provider uniqueTournament.id, as text. */
  readonly competitionProviderId: string;
  /** provider season.id, as text. */
  readonly seasonProviderId: string;
  /** season_period lower bound, inclusive, YYYY-MM-DD. Required for an ACTIVE edition. */
  readonly seasonFrom: string;
  /** season_period upper bound, exclusive, YYYY-MM-DD. */
  readonly seasonTo: string;
  /** Explicit ingestion authorization. DEFAULT false — a binding never silently authorizes. */
  readonly authorized?: boolean;
  readonly competitionType?: string;   // governance.competition_type.code
  readonly competitionScope?: string;  // governance.competition_scope.code
  readonly trackingStatus?: string;    // governance.tracking_status.code
  readonly editionStatus?: string;     // governance.edition_status.code
}

export interface RegisterTrackedEditionResult {
  readonly trackedCompetitionId: string;
  readonly trackedEditionId: string;
  readonly competitionInserted: boolean;
  readonly editionInserted: boolean;
  readonly authorized: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Registers (idempotently) a tracked competition + tracked edition on `tx`.
 *
 * DECLARATIVE AND IDEMPOTENT: re-registering the same identity updates classification /
 * authorization / period to the supplied values and touches nothing else — it never
 * creates a duplicate logical row (the provider alternate keys are the conflict
 * targets). Authorization defaults FALSE and is only ever what the operator states.
 *
 * Does NOT open a transaction — it participates in the caller's, exactly like the
 * coverage write. `registerTrackedEditionGoverned` supplies the transaction.
 */
export async function registerTrackedEdition(
  tx: PoolClient,
  params: RegisterTrackedEditionParams
): Promise<RegisterTrackedEditionResult> {
  const providerCode = params.providerCode ?? PROVIDER_CODE;
  const authorized = params.authorized === true;
  const trackingStatus = params.trackingStatus ?? 'TRACKED';
  const editionStatus = params.editionStatus ?? 'ACTIVE';
  const competitionType = params.competitionType ?? 'LEAGUE';
  const competitionScope = params.competitionScope ?? 'DOMESTIC';

  for (const [field, value] of [['seasonFrom', params.seasonFrom], ['seasonTo', params.seasonTo]] as const) {
    if (!ISO_DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
      throw new Error(`${field} must be a valid YYYY-MM-DD date, received '${value}'.`);
    }
  }
  if (params.seasonTo <= params.seasonFrom) {
    throw new Error(`seasonTo (${params.seasonTo}) must be after seasonFrom (${params.seasonFrom}).`);
  }
  if (!params.competitionProviderId) throw new Error('competitionProviderId is required.');
  if (!params.seasonProviderId) throw new Error('seasonProviderId is required.');

  // Tracked competition — identity (provider_code, provider_external_id). xmax=0
  // detects a genuine insert vs an idempotent update.
  const comp = await tx.query<{ id: string; inserted: boolean }>(
    `INSERT INTO governance.tracked_competition
       (provider_code, provider_external_id, tracking_status_code, competition_type_code, competition_scope_code)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider_code, provider_external_id) DO UPDATE
       SET tracking_status_code   = EXCLUDED.tracking_status_code,
           competition_type_code  = EXCLUDED.competition_type_code,
           competition_scope_code = EXCLUDED.competition_scope_code,
           updated_at             = now()
     RETURNING id::text AS id, (xmax = 0) AS inserted`,
    [providerCode, params.competitionProviderId, trackingStatus, competitionType, competitionScope]
  );
  const trackedCompetitionId = comp.rows[0].id;

  // Tracked edition — identity (tracked_competition_id, provider_season_external_id).
  const edition = await tx.query<{ id: string; inserted: boolean }>(
    `INSERT INTO governance.tracked_edition
       (tracked_competition_id, provider_season_external_id, edition_status_code, authorized_for_ingestion, season_period)
     VALUES ($1, $2, $3, $4, daterange($5::date, $6::date, '[)'))
     ON CONFLICT (tracked_competition_id, provider_season_external_id) DO UPDATE
       SET edition_status_code      = EXCLUDED.edition_status_code,
           authorized_for_ingestion = EXCLUDED.authorized_for_ingestion,
           season_period            = EXCLUDED.season_period,
           updated_at               = now()
     RETURNING id::text AS id, (xmax = 0) AS inserted`,
    [trackedCompetitionId, params.seasonProviderId, editionStatus, authorized, params.seasonFrom, params.seasonTo]
  );

  return {
    trackedCompetitionId,
    trackedEditionId: edition.rows[0].id,
    competitionInserted: comp.rows[0].inserted,
    editionInserted: edition.rows[0].inserted,
    authorized,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LINKAGE
// ─────────────────────────────────────────────────────────────────────────────

export interface EditionLinkResult {
  readonly trackedEditionId: string;
  readonly seasonProviderExternalId: string;
  readonly competitionEditionId: string;
}
export interface EditionLinkAnomaly {
  readonly trackedEditionId: string;
  readonly seasonProviderExternalId: string;
  readonly reason: string;
}
export interface LinkEditionRealitiesResult {
  /** Governance editions newly linked to their materialized football edition. */
  readonly linked: readonly EditionLinkResult[];
  /** Governance editions whose football edition has not been materialized yet. */
  readonly pending: readonly EditionLinkAnomaly[];
  /** Governance editions that could not be linked safely (reported, never guessed). */
  readonly conflicts: readonly EditionLinkAnomaly[];
  /** Tracked competitions whose competition_id linkage was populated as a side effect. */
  readonly competitionsLinked: number;
}

interface PendingRow {
  readonly tracked_edition_id: string;
  readonly tracked_competition_id: string;
  readonly season_provider_external_id: string;
  /** tracked_competition.competition_id, may be null. */
  readonly tracked_competition_competition_id: string | null;
}

/**
 * Links every tracked_edition with a null competition_edition_id to its
 * materialized football.competition_edition, on `tx`. Idempotent: already-linked
 * rows are never selected, so re-running links nothing and modifies no correct
 * linkage. Read-mostly; only pending rows are written.
 *
 * Deterministic by uq_competition_edition__provider_external_id (one edition per
 * provider season). A tracked edition whose football edition does not exist yet is
 * PENDING (not an error). A resolved edition that belongs to a different competition
 * than the governance row, or that is already claimed by another governance edition
 * (uq_tracked_edition__competition_edition), is a CONFLICT — reported, never linked.
 */
export async function linkEditionRealities(tx: PoolClient): Promise<LinkEditionRealitiesResult> {
  const pendingRows = await tx.query<PendingRow>(
    `SELECT te.id::text                    AS tracked_edition_id,
            te.tracked_competition_id::text AS tracked_competition_id,
            te.provider_season_external_id  AS season_provider_external_id,
            tc.competition_id::text         AS tracked_competition_competition_id
       FROM governance.tracked_edition te
       JOIN governance.tracked_competition tc ON tc.id = te.tracked_competition_id
      WHERE te.competition_edition_id IS NULL
      ORDER BY te.id`
  );

  const linked: EditionLinkResult[] = [];
  const pending: EditionLinkAnomaly[] = [];
  const conflicts: EditionLinkAnomaly[] = [];
  let competitionsLinked = 0;

  for (const row of pendingRows.rows) {
    // Resolve the materialized football edition by the authoritative alternate key.
    const match = await tx.query<{ id: string; competition_id: string }>(
      `SELECT id::text AS id, competition_id::text AS competition_id
         FROM football.competition_edition
        WHERE provider_external_id = $1`,
      [row.season_provider_external_id]
    );
    if (match.rows.length === 0) {
      pending.push({ trackedEditionId: row.tracked_edition_id, seasonProviderExternalId: row.season_provider_external_id, reason: 'football edition not materialized yet' });
      continue;
    }
    // The alternate key is UNIQUE, so >1 is structurally impossible; guard anyway.
    if (match.rows.length > 1) {
      conflicts.push({ trackedEditionId: row.tracked_edition_id, seasonProviderExternalId: row.season_provider_external_id, reason: `ambiguous: ${match.rows.length} football editions share this provider season id` });
      continue;
    }
    const edition = match.rows[0];

    // Consistency: if the tracked competition is already linked to a football
    // competition, the resolved edition must belong to it. Never link across a
    // disagreement — report it.
    if (row.tracked_competition_competition_id !== null && edition.competition_id !== row.tracked_competition_competition_id) {
      conflicts.push({ trackedEditionId: row.tracked_edition_id, seasonProviderExternalId: row.season_provider_external_id, reason: `resolved edition belongs to competition ${edition.competition_id}, governance names competition ${row.tracked_competition_competition_id}` });
      continue;
    }

    try {
      // Link the edition. WHERE competition_edition_id IS NULL keeps it idempotent
      // even under a concurrent linker. uq_tracked_edition__competition_edition
      // (one governance edition per reality edition) surfaces a double-claim as a
      // unique violation, caught below.
      const upd = await tx.query(
        `UPDATE governance.tracked_edition
            SET competition_edition_id = $2, updated_at = now()
          WHERE id = $1 AND competition_edition_id IS NULL`,
        [row.tracked_edition_id, edition.id]
      );
      if (upd.rowCount === 0) {
        pending.push({ trackedEditionId: row.tracked_edition_id, seasonProviderExternalId: row.season_provider_external_id, reason: 'already linked concurrently' });
        continue;
      }

      // Opportunistically populate the competition linkage when absent — same
      // authoritative alternate key on football.competition. Never overwrites.
      if (row.tracked_competition_competition_id === null) {
        const compUpd = await tx.query(
          `UPDATE governance.tracked_competition
              SET competition_id = $2, updated_at = now()
            WHERE id = $1 AND competition_id IS NULL`,
          [row.tracked_competition_id, edition.competition_id]
        );
        competitionsLinked += compUpd.rowCount ?? 0;
      }

      linked.push({ trackedEditionId: row.tracked_edition_id, seasonProviderExternalId: row.season_provider_external_id, competitionEditionId: edition.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A unique-violation here means another governance edition already claims this
      // reality edition — a governance anomaly, reported not resolved.
      conflicts.push({ trackedEditionId: row.tracked_edition_id, seasonProviderExternalId: row.season_provider_external_id, reason: `link refused: ${message}` });
    }
  }

  return { linked, pending, conflicts, competitionsLinked };
}

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED WRAPPERS — supply the pt_platform_admin connection + a transaction.
// ─────────────────────────────────────────────────────────────────────────────

async function inGovernanceTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  return withConnection(GOVERNANCE_ADMIN_ROLE, async (tx) => {
    await tx.query('BEGIN');
    try {
      const result = await fn(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

export function registerTrackedEditionGoverned(params: RegisterTrackedEditionParams): Promise<RegisterTrackedEditionResult> {
  return inGovernanceTransaction((tx) => registerTrackedEdition(tx, params));
}

export function linkEditionRealitiesGoverned(): Promise<LinkEditionRealitiesResult> {
  return inGovernanceTransaction((tx) => linkEditionRealities(tx));
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function parseFlags(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { values.set(arg, 'true'); continue; }
    values.set(arg, next);
    i += 1;
  }
  return values;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const subcommand = argv[0];
  const flags = parseFlags(argv.slice(1));
  /* eslint-disable no-console */
  try {
    if (subcommand === 'register') {
      for (const flag of ['--tournament', '--season', '--from', '--to']) {
        if (!flags.has(flag)) {
          throw new Error(`${flag} is required. Usage: governance:register -- --tournament 325 --season 87678 --from 2026-01-01 --to 2027-01-01 [--authorize] [--provider SPORTSAPI_API] [--type LEAGUE] [--scope DOMESTIC]`);
        }
      }
      const result = await registerTrackedEditionGoverned({
        providerCode: flags.get('--provider'),
        competitionProviderId: flags.get('--tournament')!,
        seasonProviderId: flags.get('--season')!,
        seasonFrom: flags.get('--from')!,
        seasonTo: flags.get('--to')!,
        authorized: flags.get('--authorize') === 'true',
        competitionType: flags.get('--type'),
        competitionScope: flags.get('--scope'),
        trackingStatus: flags.get('--tracking-status'),
        editionStatus: flags.get('--edition-status'),
      });
      console.log(
        `\ngovernance register: tracked_competition ${result.trackedCompetitionId} (${result.competitionInserted ? 'created' : 'updated'}), ` +
          `tracked_edition ${result.trackedEditionId} (${result.editionInserted ? 'created' : 'updated'}), authorized=${result.authorized}\n`
      );
    } else if (subcommand === 'link') {
      const result = await linkEditionRealitiesGoverned();
      console.log(`\ngovernance link: ${result.linked.length} edition(s) linked, ${result.competitionsLinked} competition(s) linked, ${result.pending.length} pending, ${result.conflicts.length} conflict(s)`);
      for (const l of result.linked) console.log(`  linked   edition ${l.trackedEditionId} (season ${l.seasonProviderExternalId}) → competition_edition ${l.competitionEditionId}`);
      for (const p of result.pending) console.log(`  pending  edition ${p.trackedEditionId} (season ${p.seasonProviderExternalId}) — ${p.reason}`);
      for (const c of result.conflicts) console.log(`  CONFLICT edition ${c.trackedEditionId} (season ${c.seasonProviderExternalId}) — ${c.reason}`);
      console.log('');
      if (result.conflicts.length > 0) process.exitCode = 1;
    } else {
      throw new Error(`unknown subcommand '${subcommand ?? '(none)'}'. Use 'register' or 'link'.`);
    }
  } finally {
    await closeAllPools();
  }
  /* eslint-enable no-console */
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\ngovernance admin FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
