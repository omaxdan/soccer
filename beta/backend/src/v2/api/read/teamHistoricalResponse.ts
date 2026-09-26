// ─────────────────────────────────────────────────────────────────────────────
// TEAM HISTORICAL RESPONSE — read model (Historical Patterns v1), evidence-honest
//
// "What were the historically observed results FOLLOWING the subject team's wins, and
// following its losses?" — descriptive historical evidence for ONE team, ALL_COMPETITIONS.
// Authored + locked as historical-response-v1 (docs/db-v2/99-historical-response-v1.md);
// it was NOT previously frozen in the repository. NOT prediction, probability, forecast,
// recommendation, betting, or psychological interpretation.
//
// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED SEMANTICS (v1)
//   • SUBJECT team; SCOPE ALL_COMPETITIONS; strict `kickoff < asOf` (Sequence A AND B).
//   • ELIGIBLE fixture = COMPLETED + governed result + kickoff < asOf. SCHEDULED/
//     POSTPONED/IN_PROGRESS/CANCELLED/ABANDONED never count (enforced by the COMPLETED
//     filter + the result JOIN).
//   • RESULT is team-perspective WIN/DRAW/LOSS from football.result goals, oriented by
//     whether the subject team was home or away — the same deterministic orientation as
//     Season Position Trajectory; no new result semantics, no provider data.
//   • TRIGGERS POST_WIN / POST_LOSS. SEQUENCE A = the trigger fixtures in chronological
//     order. SEQUENCE B = the FIRST subsequent eligible fixture (the next element of the
//     ordered eligible sequence); its result is the observed response. A trigger with no
//     subsequent eligible fixture contributes NO response (not counted in n).
//   • SAMPLE GATE n >= 10 → engaged; else not engaged (never lowered, never zero-filled).
//   • INVARIANT wins + draws + losses = n, by construction.
//   • No trigger reaching n>=10 → no engaged reading (never a fabricated empty pattern).
//   • READ-MODEL: computed on read from football.fixture + football.result. Nothing is
//     persisted; no immutable-snapshot claim. One set-based query per team; no N+1.
//   • Does NOT touch historical_advantage (a distinct, inactive H2H module).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

export const HISTORICAL_RESPONSE_VERSION = 'historical-response-v1';

export type TeamOutcome = 'WIN' | 'DRAW' | 'LOSS';
export type HistoricalTrigger = 'POST_WIN' | 'POST_LOSS';

export interface HistoricalResponseCounts {
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
}

export interface HistoricalTriggerReading {
  readonly engaged: boolean; // n >= SAMPLE_GATE
  readonly n: number;        // trigger fixtures that had a subsequent eligible response
  readonly response: HistoricalResponseCounts; // wins + draws + losses = n
}

export interface TeamHistoricalResponse {
  readonly subjectKind: 'TEAM';
  readonly subjectId: string;
  readonly scope: 'ALL_COMPETITIONS';
  readonly asOf: string;
  readonly triggers: Readonly<Record<HistoricalTrigger, HistoricalTriggerReading>>;
  readonly anyEngaged: boolean;
  readonly provenance: { readonly source: string; readonly mode: 'READ_MODEL'; readonly version: string };
  readonly version: string;
}

/** Minimum qualifying trigger observations for an engaged reading. LOCKED — never lower. */
export const SAMPLE_GATE = 10;

// ── pure computation ──────────────────────────────────────────────────────────

/** Team-perspective outcome from goals for/against. Pure. */
export function outcomeOf(goalsFor: number, goalsAgainst: number): TeamOutcome {
  if (goalsFor > goalsAgainst) return 'WIN';
  if (goalsFor < goalsAgainst) return 'LOSS';
  return 'DRAW';
}

/** Over the CHRONOLOGICALLY ORDERED eligible outcome sequence, for each trigger tally the
 *  outcome of the FIRST subsequent eligible fixture (the next element). A trigger at the
 *  final position has no response and is excluded from n. Pure; deterministic. */
export function computeHistoricalResponse(
  orderedOutcomes: readonly TeamOutcome[],
): Record<HistoricalTrigger, HistoricalTriggerReading> {
  const acc: Record<HistoricalTrigger, { wins: number; draws: number; losses: number }> = {
    POST_WIN: { wins: 0, draws: 0, losses: 0 },
    POST_LOSS: { wins: 0, draws: 0, losses: 0 },
  };
  for (let i = 0; i < orderedOutcomes.length - 1; i++) {
    const trigger: HistoricalTrigger | null =
      orderedOutcomes[i] === 'WIN' ? 'POST_WIN' : orderedOutcomes[i] === 'LOSS' ? 'POST_LOSS' : null;
    if (trigger === null) continue; // a DRAW is neither trigger
    const response = orderedOutcomes[i + 1]; // first subsequent eligible fixture
    if (response === 'WIN') acc[trigger].wins += 1;
    else if (response === 'DRAW') acc[trigger].draws += 1;
    else acc[trigger].losses += 1;
  }
  const build = (t: HistoricalTrigger): HistoricalTriggerReading => {
    const c = acc[t];
    const n = c.wins + c.draws + c.losses;
    return { engaged: n >= SAMPLE_GATE, n, response: { wins: c.wins, draws: c.draws, losses: c.losses } };
  };
  return { POST_WIN: build('POST_WIN'), POST_LOSS: build('POST_LOSS') };
}

// ── SQL (read-only) ───────────────────────────────────────────────────────────

/** The subject team's full chronological ELIGIBLE result sequence (ALL_COMPETITIONS):
 *  COMPLETED + governed result + strict kickoff < asOf, team-perspective goals, ordered
 *  (kickoff, id). $1 team id · $2 asOf. Set-based; one query. */
export const TEAM_RESULT_SEQUENCE_SQL = `
  SELECT f.id::text AS fixture_id,
         f.scheduled_kickoff_at AS kickoff_at,
         CASE WHEN f.home_team_id = $1::bigint THEN r.home_goals ELSE r.away_goals END AS goals_for,
         CASE WHEN f.home_team_id = $1::bigint THEN r.away_goals ELSE r.home_goals END AS goals_against
    FROM football.fixture f
    JOIN football.result r
      ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE (f.home_team_id = $1::bigint OR f.away_team_id = $1::bigint)
     AND f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
   ORDER BY f.scheduled_kickoff_at ASC, f.id ASC
`;

interface SequenceRow { fixture_id: string; kickoff_at: Date | string; goals_for: number | string; goals_against: number | string }

// ── reader (assembles pure pieces) ──────────────────────────────────────────────

export async function readTeamHistoricalResponse(
  tx: PoolClient, teamId: string, options: { asOf?: Date } = {},
): Promise<TeamHistoricalResponse> {
  const asOf = options.asOf ?? new Date();
  const res = await tx.query<SequenceRow>(TEAM_RESULT_SEQUENCE_SQL, [teamId, asOf]);
  const outcomes = res.rows.map((r) => outcomeOf(Number(r.goals_for), Number(r.goals_against)));
  const triggers = computeHistoricalResponse(outcomes);
  return {
    subjectKind: 'TEAM', subjectId: teamId, scope: 'ALL_COMPETITIONS', asOf: asOf.toISOString(),
    triggers,
    anyEngaged: triggers.POST_WIN.engaged || triggers.POST_LOSS.engaged,
    provenance: { source: 'football.fixture+football.result', mode: 'READ_MODEL', version: HISTORICAL_RESPONSE_VERSION },
    version: HISTORICAL_RESPONSE_VERSION,
  };
}
