// ─────────────────────────────────────────────────────────────────────────────
// PLAYER DETAIL — pure read-model mappers/aggregation (DB-free, unit-tested)
//
// Turns RAW stored rows into an evidence-honest player detail projection. It draws a
// hard line between three kinds of value and never blurs them:
//
//   • RAW EVIDENCE   — the stored provider facts: registration, availability,
//     valuation, and each per-match `player_match_statistic` row (an EAV
//     statistic_key → statistic_value with a value_type shape tag).
//   • DERIVED AGGREGATE — pure arithmetic over the stored numeric rows (per-key sum
//     and mean, match counts). Arithmetic only; NOT a governed metric.
//   • GOVERNED INTELLIGENCE — NONE here. This model emits no score, index, rating,
//     readiness or verdict. Governed intelligence lives only in sealed snapshots.
//
// Absence stays absence: a statistic key with no numeric rows carries a null
// total/mean (never 0); a player with no stored stats yields empty arrays and
// matchesRepresented 0 (never a fabricated fixture). Only statistic keys actually
// present in the data are surfaced — nothing is assumed to exist (no goals/assists/
// minutes/cards unless the provider stored that key).
// ─────────────────────────────────────────────────────────────────────────────

// ── Raw row shapes (as the DB queries project them) ─────────────────────────────

/** One stored player_match_statistic row joined to its fixture context. */
export interface PlayerStatRow {
  readonly fixture_id: string;
  readonly team_id: string;                 // the side the player represented in this fixture
  readonly statistic_key: string;
  readonly statistic_value: string | null;  // raw text (scalar) or JSON text
  readonly value_type: string | null;       // 'number' | 'json' | null (provider shape tag)
  readonly scheduled_kickoff_at: Date | string;
  readonly competition_edition_id: string;
  readonly season_label: string;
  readonly competition_id: string;
  readonly competition_name: string;
  readonly competition_slug: string;
  readonly home_team_id: string;
  readonly away_team_id: string;
  readonly home_name: string;
  readonly away_name: string;
  readonly home_goals: number | string | null;
  readonly away_goals: number | string | null;
}

export interface PlayerRegistrationRow {
  readonly team_id: string;
  readonly registration_kind_code: string;
  readonly registration_from: string | null; // ISO date or null (unbounded)
  readonly registration_to: string | null;   // ISO date or null (open)
  readonly competition_edition_id: string;
  readonly season_label: string;
}

export interface PlayerAvailabilityRow {
  readonly unavailability_kind_code: string;
  readonly spell_from: string | null;
  readonly spell_to: string | null;
  readonly expected_return_on: string | null;
  readonly reason: string | null;
  readonly severity_rank: number | string | null;
  readonly is_current: boolean;
}

export interface PlayerValuationRow {
  readonly amount: string;              // numeric text
  readonly currency_code: string | null;
  readonly as_of_on: string;            // ISO date
  readonly source_code: string | null;
}

// ── Contract view types ─────────────────────────────────────────────────────────

export interface PlayerRegistrationView {
  readonly teamId: string;
  readonly registrationKindCode: string;
  readonly registrationFrom: string | null;
  readonly registrationTo: string | null;
  readonly competitionEditionId: string;
  readonly seasonLabel: string;
}

export interface PlayerAvailabilityView {
  readonly unavailabilityKindCode: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly expectedReturnOn: string | null;
  readonly reason: string | null;
  readonly severityRank: number | null;
  readonly current: boolean;
}

export interface PlayerValuationView {
  readonly amount: string;
  readonly currencyCode: string | null;
  readonly asOfOn: string;
  readonly sourceCode: string | null;
}

/** A DERIVED arithmetic aggregate over stored rows for one provider statistic_key.
 *  Not a governed score. total/mean are null for non-numeric (json) keys. */
export interface PlayerStatAggregate {
  readonly statisticKey: string;
  readonly valueType: string | null;
  readonly matchesWithValue: number;
  readonly numericTotal: string | null;
  readonly numericMean: string | null;
}

export interface PlayerEditionParticipation {
  readonly competitionEditionId: string;
  readonly seasonLabel: string;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly matches: number;
}

export interface PlayerMatchStatLine {
  readonly fixtureId: string;
  readonly kickoffAt: string;
  readonly competitionEditionId: string;
  readonly seasonLabel: string;
  readonly teamId: string;
  readonly opponentTeamId: string;
  readonly opponentName: string;
  readonly isHome: boolean;
  readonly score: { readonly home: number; readonly away: number } | null;
  /** RAW stored stat rows for this fixture (evidence — not derived). */
  readonly statistics: readonly { readonly key: string; readonly value: string | null; readonly valueType: string | null }[];
}

export interface PlayerStatistics {
  readonly matchesRepresented: number;
  readonly availableStatisticKeys: readonly string[];
  readonly summary: readonly PlayerStatAggregate[];
  readonly editions: readonly PlayerEditionParticipation[];
  readonly recentMatches: readonly PlayerMatchStatLine[];
}

// ── helpers ──────────────────────────────────────────────────────────────────────

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Parse a stored stat value as a finite number iff the provider tagged it 'number'.
 *  Anything else (json, null, unparseable) is NOT numeric — never coerced to 0. */
function numericValue(value: string | null, valueType: string | null): number | null {
  if (valueType !== 'number' || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Format a derived number as exact-ish text: integers plain, else up to 4 dp with
 *  trailing zeros trimmed. Presentation of an arithmetic result, never a float lie. */
function formatDerived(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function toScore(home: number | string | null, away: number | string | null): { home: number; away: number } | null {
  if (home === null || away === null) return null;
  const h = Number(home); const a = Number(away);
  return Number.isFinite(h) && Number.isFinite(a) ? { home: h, away: a } : null;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

export function mapRegistration(row: PlayerRegistrationRow | null | undefined): PlayerRegistrationView | null {
  if (!row) return null;
  return {
    teamId: row.team_id,
    registrationKindCode: row.registration_kind_code,
    registrationFrom: row.registration_from,
    registrationTo: row.registration_to,
    competitionEditionId: row.competition_edition_id,
    seasonLabel: row.season_label,
  };
}

export function mapAvailability(row: PlayerAvailabilityRow | null | undefined): PlayerAvailabilityView | null {
  if (!row) return null;
  return {
    unavailabilityKindCode: row.unavailability_kind_code,
    from: row.spell_from,
    to: row.spell_to,
    expectedReturnOn: row.expected_return_on,
    reason: row.reason,
    severityRank: row.severity_rank === null || row.severity_rank === undefined ? null : Number(row.severity_rank),
    current: row.is_current,
  };
}

export function mapValuation(row: PlayerValuationRow | null | undefined): PlayerValuationView | null {
  if (!row) return null;
  return { amount: row.amount, currencyCode: row.currency_code, asOfOn: row.as_of_on, sourceCode: row.source_code };
}

/**
 * Aggregate a player's stored stat rows into the statistics projection. Pure and
 * deterministic: summary and per-match statistics are ordered by key; recent matches
 * follow the caller's row order (the DB orders kickoff DESC, fixture DESC) and are
 * capped at `recentLimit`. Nothing is invented; non-numeric keys keep null totals.
 */
export function aggregatePlayerStatistics(rows: readonly PlayerStatRow[], recentLimit = 10): PlayerStatistics {
  // Group rows by fixture, preserving first-seen (kickoff-desc) order.
  const fixtureOrder: string[] = [];
  const byFixture = new Map<string, PlayerStatRow[]>();
  for (const r of rows) {
    let bucket = byFixture.get(r.fixture_id);
    if (!bucket) { bucket = []; byFixture.set(r.fixture_id, bucket); fixtureOrder.push(r.fixture_id); }
    bucket.push(r);
  }

  // Per-key aggregate.
  const keyStats = new Map<string, { valueType: string | null; matches: number; numericSum: number; numericCount: number }>();
  for (const r of rows) {
    let k = keyStats.get(r.statistic_key);
    if (!k) { k = { valueType: r.value_type, matches: 0, numericSum: 0, numericCount: 0 }; keyStats.set(r.statistic_key, k); }
    k.matches += 1; // unique per (fixture,key) at source → one row = one fixture
    const num = numericValue(r.statistic_value, r.value_type);
    if (num !== null) { k.numericSum += num; k.numericCount += 1; }
  }
  const availableStatisticKeys = [...keyStats.keys()].sort((a, b) => a.localeCompare(b));
  const summary: PlayerStatAggregate[] = availableStatisticKeys.map((key) => {
    const k = keyStats.get(key)!;
    const hasNumeric = k.numericCount > 0;
    return {
      statisticKey: key,
      valueType: k.valueType,
      matchesWithValue: k.matches,
      numericTotal: hasNumeric ? formatDerived(k.numericSum) : null,
      numericMean: hasNumeric ? formatDerived(k.numericSum / k.numericCount) : null,
    };
  });

  // Editions participated (distinct fixtures per edition).
  const editionMap = new Map<string, { seasonLabel: string; competition: { id: string; name: string; slug: string }; fixtures: Set<string> }>();
  for (const r of rows) {
    let e = editionMap.get(r.competition_edition_id);
    if (!e) { e = { seasonLabel: r.season_label, competition: { id: r.competition_id, name: r.competition_name, slug: r.competition_slug }, fixtures: new Set() }; editionMap.set(r.competition_edition_id, e); }
    e.fixtures.add(r.fixture_id);
  }
  const editions: PlayerEditionParticipation[] = [...editionMap.entries()]
    .map(([competitionEditionId, e]) => ({ competitionEditionId, seasonLabel: e.seasonLabel, competition: e.competition, matches: e.fixtures.size }))
    .sort((a, b) => (b.seasonLabel.localeCompare(a.seasonLabel)) || a.competitionEditionId.localeCompare(b.competitionEditionId));

  // Recent match-by-match lines (bounded).
  const recentMatches: PlayerMatchStatLine[] = fixtureOrder.slice(0, recentLimit).map((fixtureId) => {
    const fx = byFixture.get(fixtureId)!;
    const head = fx[0];
    const isHome = head.team_id === head.home_team_id;
    return {
      fixtureId,
      kickoffAt: isoDate(head.scheduled_kickoff_at),
      competitionEditionId: head.competition_edition_id,
      seasonLabel: head.season_label,
      teamId: head.team_id,
      opponentTeamId: isHome ? head.away_team_id : head.home_team_id,
      opponentName: isHome ? head.away_name : head.home_name,
      isHome,
      score: toScore(head.home_goals, head.away_goals),
      statistics: [...fx]
        .sort((a, b) => a.statistic_key.localeCompare(b.statistic_key))
        .map((r) => ({ key: r.statistic_key, value: r.statistic_value, valueType: r.value_type })),
    };
  });

  return { matchesRepresented: byFixture.size, availableStatisticKeys, summary, editions, recentMatches };
}
