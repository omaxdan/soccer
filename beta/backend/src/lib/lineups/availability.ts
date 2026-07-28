/**
 * PREDICTED LINEUPS ENGINE — availability filtering
 *
 * Decides whether a player can be selected for a SPECIFIC match. The match
 * date matters: the v1 filter excluded anyone with `expected_return_days > 0`,
 * which permanently benched a player due back on Tuesday from a fixture on
 * Saturday. Availability is evaluated against kickoff, not against today.
 *
 * SUSPENSIONS — a known gap, stated rather than papered over
 *
 * Both design notes ask for suspended players to be excluded. There is no
 * suspension data in this database: no suspensions table, no suspension flag
 * on `players`, and `player_season_statistics` carries only season card TOTALS
 * (yellow_cards, red_cards, yellow_red_cards) with no match dates, so a
 * current ban cannot be reconstructed from them — a player with 9 yellows
 * across a season may or may not be serving a ban this weekend, and the data
 * cannot distinguish the cases. The only handling possible today is the
 * keyword check in UNAVAILABLE_STATUSES below, which catches a suspension if
 * the upstream feed happens to express one through `injury_status`. Genuine
 * suspension filtering needs a real data source first.
 */

/** Player row fields the availability check reads. */
export interface AvailabilityPlayer {
  id: number;
  teamId: number | null;
  currentInjury: boolean | null;
  injuryStatus: string | null;
  injuryReturnDays: number | null;
  injuryEndTimestamp: number | null;
  injuryUpdatedTimestamp: number | null;
}

/** Active row from player_injuries, when one exists for the player. */
export interface AvailabilityInjury {
  injuryStatus: string | null;
  expectedReturnDays: number | null;
  endTimestamp: number | null;
  updatedTimestamp: number | null;
}

export type UnavailabilityReason =
  | 'injured'
  | 'injury-status'
  | 'returns-after-kickoff'
  | 'transferred';

export interface AvailabilityResult {
  available: boolean;
  reason?: UnavailabilityReason;
  /** Expected return date, when one could be derived — for logging. */
  expectedReturn?: Date;
}

/**
 * Status strings that mean "not selectable", matched case-insensitively as
 * substrings so feed variants ("Out", "out injured", "Doubtful — late fitness
 * test") are all caught.
 *
 * 'doubtful' is treated as unavailable per spec. That is a deliberately
 * conservative reading — some doubtful players do start — but a predicted XI
 * that quietly includes a player who may not be fit is worse than one that
 * names his understudy.
 */
const UNAVAILABLE_STATUSES = [
  'out',
  'unavailable',
  'doubtful',
  'injured',
  'suspended',
  'suspension',
  'ban',
];

function statusIsUnavailable(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  if (!s) return false;
  return UNAVAILABLE_STATUSES.some((k) => s.includes(k));
}

const DAY_MS = 86_400_000;

/**
 * Best available estimate of when a player is fit again.
 *
 * Preference order:
 *   1. An explicit end timestamp from the feed (unix SECONDS — SofaScore's
 *      `injury.endTimestamp`, stored raw by syncSquadSofaScore).
 *   2. A day count, anchored to when the feed last updated the injury rather
 *      than to now — "out for 14 days" reported three weeks ago describes a
 *      player who is already back.
 *
 * Returns null when neither is present, which the caller treats as
 * "unavailable with unknown return" rather than guessing a date.
 */
export function estimateReturnDate(
  player: AvailabilityPlayer,
  injury: AvailabilityInjury | undefined,
): Date | null {
  const endTs = injury?.endTimestamp ?? player.injuryEndTimestamp;
  if (endTs && endTs > 0) return new Date(endTs * 1000);

  const days = injury?.expectedReturnDays ?? player.injuryReturnDays;
  if (days != null && days > 0) {
    const anchorTs = injury?.updatedTimestamp ?? player.injuryUpdatedTimestamp;
    const anchor = anchorTs && anchorTs > 0 ? new Date(anchorTs * 1000) : new Date();
    return new Date(anchor.getTime() + days * DAY_MS);
  }

  return null;
}

/**
 * Whether a player is available for a match kicking off at `matchDate`.
 *
 * @param latestTransferTeamId  the team the player's most recent transfer
 *                              moved him TO, if any — see resolveLatestTeams
 */
export function checkAvailability(
  player: AvailabilityPlayer,
  injury: AvailabilityInjury | undefined,
  matchDate: Date,
  statsTeamId: number,
  latestTransferTeamId: number | undefined,
): AvailabilityResult {
  // Transfer check first: it is unconditional, while every injury check is
  // relative to the fixture. A player whose latest transfer moved him to
  // another club cannot appear for this one regardless of fitness.
  if (latestTransferTeamId != null) {
    if (latestTransferTeamId !== statsTeamId || (player.teamId != null && latestTransferTeamId !== player.teamId)) {
      return { available: false, reason: 'transferred' };
    }
  }

  const flagged = player.currentInjury === true;
  const statusBad = statusIsUnavailable(player.injuryStatus) || statusIsUnavailable(injury?.injuryStatus);
  const hasInjuryRecord = flagged || statusBad || injury != null;

  if (!hasInjuryRecord) return { available: true };

  const returnDate = estimateReturnDate(player, injury);

  // A known return date is the authoritative answer in both directions: back
  // before kickoff means available even though the flag is still set, and back
  // after kickoff means unavailable even if the status string looks benign.
  if (returnDate) {
    if (returnDate.getTime() <= matchDate.getTime()) return { available: true, expectedReturn: returnDate };
    return { available: false, reason: 'returns-after-kickoff', expectedReturn: returnDate };
  }

  // No date to reason about: fall back to the flags.
  if (statusBad) return { available: false, reason: 'injury-status' };
  if (flagged) return { available: false, reason: 'injured' };

  // An active player_injuries row with no status and no date — treat the
  // existence of the record as the signal.
  return { available: false, reason: 'injured' };
}

/**
 * Latest destination club per player, from player_transfers.
 *
 * `transfers` must be sorted newest-first; the first row seen per player wins.
 * Rows with no destination (contract expiries recorded with a null to_team_id)
 * are skipped rather than read as "moved to nowhere", which would exclude the
 * player from every squad.
 */
export function resolveLatestTeams(
  transfers: Array<{ player_id: number; to_team_id: number | null }>,
): Map<number, number> {
  const latest = new Map<number, number>();
  for (const t of transfers) {
    if (t.to_team_id == null) continue;
    if (latest.has(t.player_id)) continue;
    latest.set(t.player_id, t.to_team_id);
  }
  return latest;
}
