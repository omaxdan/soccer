// ─────────────────────────────────────────────────────────────────────────────
// TEAM-SEASON RECONCILIATION  (D2 C9/C10)
//
// The team-event spine is PRIMARY and cross-competition. Reconciliation verifies,
// for ONE (uniqueTournament.id, season.id), whether the spine holds every event
// the competition-season feeds hold — WITHOUT trusting the spine blindly and
// WITHOUT ever discarding an event.
//
// Sources: the season event pager (`sweepSeason`, reused unchanged) and
// `/tournament/{ut}/season/{seasonId}/team-events`. The team-events response is
// indexed EXPLICITLY as `tournamentTeamEvents[instanceId][teamId]` — never the
// first bucket, which for 325/87678 is Cruzeiro, not the target team.
//
// The match key is `event.id` and nothing else — never kickoff, team pair,
// competition name, slug, or array position (D2 §11). An event present in a
// reconciliation source but absent from the spine is returned as a raw event for
// the controller to feed through the SAME canonical writer (`ingestEvents`, NO
// scope); it is audited, never dropped.
//
// THIS MODULE DOES NOT WRITE. It reads, classifies and hands back.
// ─────────────────────────────────────────────────────────────────────────────

import type { ProviderClient } from '../provider/client';
import { sweepSeason, interpretEvent, FIXTURE_WINDOW, type FixtureWindow, type PagedEvent } from '../provider/pager';
import { asRecord, externalId } from '../normalise';
import { logger } from '../../../utils/logger';

export interface ReconcileOptions {
  readonly teamId: string;
  readonly uniqueTournamentId: string;
  readonly seasonId: string;
  readonly window?: FixtureWindow;
  /** Provider calls the reconciliation walk may spend (season pager). */
  readonly callBudget: number;
}

export interface ReconcileCounts {
  /** Distinct reconciliation-source events that involve the target team. */
  readonly reconciliationSourceEvents: number;
  readonly presentBoth: number;
  /** Season/tte has it, spine lacks it — fed back through the canonical writer. */
  readonly missingFromSpine: number;
  /** Spine has it for this season, reconciliation sources do not. */
  readonly spineOnly: number;
  readonly identityMismatches: number;
  readonly dateDiscrepancies: number;
  readonly statusDiscrepancies: number;
  readonly callsSpent: number;
}

export interface ReconcileResult {
  readonly counts: ReconcileCounts;
  /** Raw events present in reconciliation but absent from the spine. */
  readonly missingRaws: readonly Record<string, unknown>[];
  /** Human-readable anomalies for the audit trail (identity/date/status). */
  readonly anomalies: readonly string[];
}

interface TeamEventsEnvelope {
  readonly data?: { readonly tournamentTeamEvents?: Record<string, Record<string, unknown>> };
}

/** Pulls the target team's raw events from `tournamentTeamEvents[instanceId][teamId]`. */
function teamEventsForTarget(body: TeamEventsEnvelope, teamId: string): Record<string, unknown>[] {
  const buckets = body.data?.tournamentTeamEvents;
  if (!buckets || typeof buckets !== 'object') return [];
  const out: Record<string, unknown>[] = [];
  // Iterate EVERY instance bucket and select the target team explicitly — never
  // the first bucket. A team can appear under more than one instance id.
  for (const instanceId of Object.keys(buckets)) {
    const byTeam = asRecord(buckets[instanceId]);
    const bucket = byTeam ? byTeam[teamId] : undefined;
    if (Array.isArray(bucket)) {
      for (const event of bucket) {
        const record = asRecord(event);
        if (record) out.push(record);
      }
    }
  }
  return out;
}

function involvesTeam(event: PagedEvent, teamId: string): boolean {
  return event.homeTeamProviderId === teamId || event.awayTeamProviderId === teamId;
}

/**
 * Reconciles the spine against the competition-season feeds for one team.
 *
 * `spineEvents` is the full cross-competition spine; only its events for this
 * (uniqueTournament, season) are compared, since that is all the reconciliation
 * sources describe.
 */
export async function reconcileTeamSeason(
  client: ProviderClient,
  options: ReconcileOptions,
  spineEvents: readonly PagedEvent[]
): Promise<ReconcileResult> {
  const window = options.window ?? FIXTURE_WINDOW;

  // ── Reconciliation source 1: season event pager (reused unchanged) ──────────
  const seasonSweep = await sweepSeason(client, {
    competitionProviderId: options.uniqueTournamentId,
    seasonProviderId: options.seasonId,
    window,
    callBudget: options.callBudget,
  });
  const seasonCalls = seasonSweep.last.callsSpent + seasonSweep.next.callsSpent;
  const seasonEvents = [...seasonSweep.last.events, ...seasonSweep.next.events].filter((event) =>
    involvesTeam(event, options.teamId)
  );

  // ── Reconciliation source 2: tournament-team-events, indexed explicitly ─────
  const tteBody = await client.get<TeamEventsEnvelope>('tournament_team_events', {
    tournamentId: options.uniqueTournamentId,
    seasonId: options.seasonId,
  });
  const tteRaws = teamEventsForTarget(tteBody, options.teamId);
  const tteEvents: PagedEvent[] = [];
  for (const raw of tteRaws) {
    const parsed = interpretEvent(raw);
    if (parsed !== null && 'providerEventId' in parsed) tteEvents.push(parsed);
  }

  // Reconciliation set, keyed by event.id, carrying the raw for possible re-ingest.
  const recon = new Map<string, { event: PagedEvent; raw: Record<string, unknown> }>();
  for (const event of seasonEvents) recon.set(event.providerEventId, { event, raw: event.raw });
  for (let i = 0; i < tteEvents.length; i += 1) {
    const event = tteEvents[i];
    if (!recon.has(event.providerEventId)) recon.set(event.providerEventId, { event, raw: tteRaws[i] });
  }

  // Spine, restricted to THIS competition-season (all that the sources describe).
  const spineForSeason = new Map<string, PagedEvent>();
  for (const event of spineEvents) {
    if (event.competitionProviderId === options.uniqueTournamentId && event.seasonProviderId === options.seasonId) {
      spineForSeason.set(event.providerEventId, event);
    }
  }

  let presentBoth = 0;
  let identityMismatches = 0;
  let dateDiscrepancies = 0;
  let statusDiscrepancies = 0;
  const missingRaws: Record<string, unknown>[] = [];
  const anomalies: string[] = [];

  for (const [id, entry] of recon) {
    const spine = spineForSeason.get(id);
    if (!spine) {
      missingRaws.push(entry.raw);
      anomalies.push(`MISSING_FROM_SPINE event ${id} (competition ${entry.event.competitionProviderId})`);
      continue;
    }
    presentBoth += 1;
    // Competition identity keyed on uniqueTournament.id (season may be null on a
    // tte event, which is not a mismatch — only a genuine disagreement is).
    if (
      entry.event.competitionProviderId !== spine.competitionProviderId ||
      (entry.event.seasonProviderId !== null && entry.event.seasonProviderId !== spine.seasonProviderId)
    ) {
      identityMismatches += 1;
      anomalies.push(
        `IDENTITY_MISMATCH event ${id}: spine ${spine.competitionProviderId}/${spine.seasonProviderId} ` +
          `vs source ${entry.event.competitionProviderId}/${entry.event.seasonProviderId}`
      );
    }
    if (entry.event.startTimestamp !== spine.startTimestamp) {
      dateDiscrepancies += 1;
      anomalies.push(`DATE_DISCREPANCY event ${id}: spine ${spine.startTimestamp} vs source ${entry.event.startTimestamp}`);
    }
    if (
      entry.event.providerStatusCode !== null &&
      spine.providerStatusCode !== null &&
      entry.event.providerStatusCode !== spine.providerStatusCode
    ) {
      statusDiscrepancies += 1;
      anomalies.push(
        `STATUS_DISCREPANCY event ${id}: spine ${spine.providerStatusCode} vs source ${entry.event.providerStatusCode}`
      );
    }
  }

  let spineOnly = 0;
  for (const id of spineForSeason.keys()) if (!recon.has(id)) spineOnly += 1;

  const counts: ReconcileCounts = {
    reconciliationSourceEvents: recon.size,
    presentBoth,
    missingFromSpine: missingRaws.length,
    spineOnly,
    identityMismatches,
    dateDiscrepancies,
    statusDiscrepancies,
    callsSpent: seasonCalls + 1,
  };

  logger.info(
    { team: options.teamId, competition: options.uniqueTournamentId, season: options.seasonId, ...counts },
    'v2 ingestion: team-season reconciliation complete'
  );

  return { counts, missingRaws, anomalies };
}
