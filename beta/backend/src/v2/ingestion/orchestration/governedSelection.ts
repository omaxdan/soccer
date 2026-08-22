// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED SELECTION — read-only enumerator of authorized editions.
//
// Answers exactly one question: "which competition editions are authorized for
// ingestion right now?" It returns AUTHORIZATION FACTS and nothing else.
//
// IT IS NOT a scheduler, window planner, ingestion authority, backfill mechanism,
// or coverage system. It derives no window from season_period, imposes no order,
// priority, freshness, or budget, and never calls the provider, mutates
// governance, or dispatches ingestSeason. Selection confers NO authority:
// governedSeason independently re-validates the specific (competition, season)
// before any execution (the at-commit re-check is a later gate).
//
// FAIL-CLOSED: no authorized rows → []. A query/connection failure THROWS — it is
// never converted into [] or a partial result.
// ─────────────────────────────────────────────────────────────────────────────

// FIRST IMPORT, DELIBERATELY — `.env` before any module that reads process.env at
// load time, matching the ingestion CLI and governedSeason.
import '../../config/env';

import type { PoolClient } from 'pg';
import { INGESTION_ROLE } from '../pipeline';
import { withConnection } from '../../db/tx';
import { AUTHORIZED_EDITIONS_SQL } from './governanceAuthorization';

/**
 * The season_period bound, as a FACT (its two daterange endpoints). Exposed so a
 * later window-policy layer can clamp to it. NOT an ingestion window itself.
 */
export interface SeasonPeriodFact {
  /** lower(season_period), inclusive; ISO date or null. */
  readonly from: string | null;
  /** upper(season_period), exclusive; ISO date or null. */
  readonly to: string | null;
}

/** One authorized edition, authorization facts only. */
export interface AuthorizedEdition {
  readonly providerCode: string;
  /** `tournament.uniqueTournament.id`. */
  readonly competitionProviderExternalId: string;
  /** `season.id`. */
  readonly seasonProviderExternalId: string;
  /** Reality linkage; null until the competition row exists. */
  readonly competitionId: string | null;
  /** Reality linkage; null until the edition row exists. */
  readonly competitionEditionId: string | null;
  /** Legitimacy bound, a fact — never transformed into an ingestion window here. */
  readonly seasonPeriod: SeasonPeriodFact;
}

/** The raw row shape returned by AUTHORIZED_EDITIONS_SQL. */
interface AuthorizedEditionRow {
  readonly provider_code: string;
  readonly competition_provider_external_id: string;
  readonly season_provider_external_id: string;
  // bigint columns arrive from node-pg as strings.
  readonly competition_id: string | null;
  readonly competition_edition_id: string | null;
  readonly season_from: string | null;
  readonly season_to: string | null;
}

/** Pure mapping from a DB row to the fact record. No derivation, no policy. */
export function mapAuthorizedEditionRow(row: AuthorizedEditionRow): AuthorizedEdition {
  return {
    providerCode: row.provider_code,
    competitionProviderExternalId: row.competition_provider_external_id,
    seasonProviderExternalId: row.season_provider_external_id,
    competitionId: row.competition_id,
    competitionEditionId: row.competition_edition_id,
    seasonPeriod: { from: row.season_from, to: row.season_to },
  };
}

/** Injectable read seam. Production reads through the pt_pipeline_ingestion pool. */
export interface GovernedSelectionDeps {
  readonly fetchRows?: () => Promise<readonly AuthorizedEditionRow[]>;
}

/**
 * Enumerates every authorized edition. Read-only.
 *
 * Empty → []. Any read failure propagates (throws): a database error is NEVER
 * turned into an empty or partial set, because "nothing authorized" and "could
 * not tell" must not look alike to a caller that decides whether to ingest.
 */
export async function selectAuthorizedEditions(
  deps: GovernedSelectionDeps = {}
): Promise<AuthorizedEdition[]> {
  const fetchRows =
    deps.fetchRows ??
    (() =>
      withConnection(INGESTION_ROLE, async (client: PoolClient) => {
        const result = await client.query<AuthorizedEditionRow>(AUTHORIZED_EDITIONS_SQL);
        return result.rows;
      }));

  const rows = await fetchRows(); // a rejection here propagates — fail-closed
  return rows.map(mapAuthorizedEditionRow);
}
