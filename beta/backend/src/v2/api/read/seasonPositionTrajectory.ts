// ─────────────────────────────────────────────────────────────────────────────
// SEASON POSITION TRAJECTORY — read model (RAW / deterministic reconstruction)
//
// Reconstructs each team's league-table position through the completed fixtures of
// ONE competition edition, from PERSISTED football state only:
//   football.fixture  — eligibility (COMPLETED), kickoff, edition, home/away teams
//   football.result   — goals (deterministic points / W-D-L / GF / GA / GD)
//   football.team     — participant identity
//
// It is DESCRIPTIVE HISTORICAL EVIDENCE ("where was this team in the reconstructed
// table after each completed fixture?"). It is NOT prediction, forecast, expected
// final position, betting, probability, or table zones.
//
// ─────────────────────────────────────────────────────────────────────────────
// RAW / DETERMINISTIC — NOT OFFICIAL
//
// Positions are a RAW deterministic reconstruction using the comparator
//   points DESC → goalDifference DESC → goalsFor DESC → teamId ASC
// (the V1-fidelity ordering already used by feature/calculators/giantKillerRanking.ts;
// replicated here rather than refactoring that frozen feature). This is NOT the
// competition's official tie-break system — the repository encodes no official
// tie-break rules (e.g. Brasileirão's wins-first + head-to-head + fair-play), so
// no "official historical position" is claimed. `mode` = 'RAW_DETERMINISTIC' and
// `positionMethod.version` identify the reconstruction so a future official
// comparator can be distinguished.
//
// ZERO-POINT SEATING: every edition participant is seeded at 0 and ranked at every
// replay point (no games>0 filter — that is giant-killer behaviour and would
// diverge from the §6 contract). So positionBefore/positionAfter are never null for
// an eligible fixture. Before any results, all-zero ties are resolved by teamId;
// those early positions are a deterministic reconstruction artifact, NOT an
// assertion of official ranking.
//
// LEAK-FREE: only fixtures with kickoff STRICTLY before `asOf`, COMPLETED, with a
// result, replayed in (kickoff ASC, fixtureId ASC) total order; the table state is
// snapshotted BEFORE a fixture's result is applied and again AFTER. Never uses
// football.standing (a current provider snapshot, not a historical trajectory),
// future fixtures, or calculated_at.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export interface TrajectoryTableState {
  readonly points: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
}

export interface TrajectoryPoint {
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly sequenceIndex: number; // canonical 1..n for THIS team, chronological (never renumbered)
  readonly kickoffAt: string;     // ISO
  readonly opponent: { readonly id: string; readonly name: string; readonly slug: string };
  readonly venueSide: 'home' | 'away';
  readonly result: 'W' | 'D' | 'L';
  readonly pointsEarned: number;  // 3 / 1 / 0
  readonly positionBefore: number;
  readonly positionAfter: number;
  /** positionBefore − positionAfter. POSITIVE = moved UP toward rank 1; negative = down; 0 = unchanged. */
  readonly positionChange: number;
  readonly table: TrajectoryTableState; // cumulative totals AFTER this fixture
}

export interface TrajectorySummary {
  readonly highestPosition: number | null; // best (lowest number) positionAfter
  readonly lowestPosition: number | null;  // worst (highest number) positionAfter
  readonly currentPosition: number | null;  // positionAfter of the latest eligible fixture
  readonly averagePosition: number | null;  // mean positionAfter, 2 dp
  readonly medianPosition: number | null;   // median positionAfter, 2 dp
  readonly totalObservedFixtures: number;
  readonly positionMovesUp: number;    // positionChange > 0
  readonly positionMovesDown: number;  // positionChange < 0
  readonly positionUnchanged: number;  // positionChange = 0
  readonly largestRise: number;  // max positionChange (≥ 0)
  readonly largestDrop: number;  // min positionChange (≤ 0)
  readonly longestUnchangedRun: number; // longest run of consecutive equal positionAfter
}

export interface TeamTrajectory {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly observationCount: number;
  readonly trajectory: readonly TrajectoryPoint[]; // emitted (ordered/sliced); summary is from the FULL series
  readonly summary: TrajectorySummary;
}

export interface SeasonPositionTrajectoryResponse {
  readonly edition: { readonly id: string; readonly seasonLabel: string };
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: {
    readonly asOf: string;
    readonly order: 'asc' | 'desc';
    readonly teamId: string | null;
  };
  readonly asOf: string;
  readonly mode: 'RAW_DETERMINISTIC';
  readonly positionMethod: {
    readonly comparator: readonly string[];
    readonly version: string;
    readonly note: string;
  };
  readonly teamCount: number;
  readonly teams: readonly TeamTrajectory[];
}

export interface SeasonPositionTrajectoryOptions {
  readonly asOf?: Date;
  readonly teamId?: string | null;
  readonly order?: 'asc' | 'desc';
  readonly limit?: number | null;
  readonly offset?: number | null;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

export interface TrajectoryIdentityRow {
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
}

export interface TrajectoryTeamRow {
  team_id: string;
  team_name: string;
  team_slug: string;
}

export interface TrajectoryFixtureRow {
  fixture_id: string;
  fixture_partition_on: string;
  kickoff_at: Date | string;
  home_team_id: string;
  away_team_id: string;
  home_goals: number | string | null;
  away_goals: number | string | null;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

export class SeasonPositionTrajectoryDataIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'SeasonPositionTrajectoryDataIntegrityError'; }
}

function iso(v: Date | string): string { return v instanceof Date ? v.toISOString() : new Date(v).toISOString(); }

/** The deterministic reconstruction comparator's declared keys (also documented in `positionMethod`). */
export const POSITION_COMPARATOR = ['points DESC', 'goalDifference DESC', 'goalsFor DESC', 'teamId ASC'] as const;
export const POSITION_METHOD_VERSION = 'raw-det-1';
const POSITION_METHOD_NOTE =
  'RAW deterministic reconstruction (points → goal difference → goals for → team id). ' +
  'Not official competition ranking; the repository encodes no official tie-break rules. ' +
  'Before results accrue, all-zero ties are resolved by team id — a deterministic artifact, not official order.';

interface Acc {
  points: number; wins: number; draws: number; losses: number; gf: number; ga: number;
}
function zeroAcc(): Acc { return { points: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 }; }
function goalDiff(a: Acc): number { return a.gf - a.ga; }

/** Rank ALL seeded teams by the deterministic comparator → 1-based position map. Pure. */
export function rankTeams(acc: ReadonlyMap<string, Acc>): Map<string, number> {
  const ranked = [...acc.entries()].sort(
    ([aId, a], [bId, b]) =>
      b.points - a.points ||
      goalDiff(b) - goalDiff(a) ||
      b.gf - a.gf ||
      Number(aId) - Number(bId),
  );
  const pos = new Map<string, number>();
  ranked.forEach(([id], i) => pos.set(id, i + 1));
  return pos;
}

/** Strict integer goal parse for an eligible fixture; a missing/non-numeric score is a
 *  data-integrity condition (never fabricated as zero). */
function requireGoals(v: number | string | null, fixtureId: string, side: 'home' | 'away'): number {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    throw new SeasonPositionTrajectoryDataIntegrityError(
      `fixture ${fixtureId}: eligible completed fixture is missing ${side}_goals`,
    );
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new SeasonPositionTrajectoryDataIntegrityError(
      `fixture ${fixtureId}: non-numeric ${side}_goals (${String(v)})`,
    );
  }
  return n;
}

/** Reconstruct every participant team's trajectory by chronological zero-point replay.
 *  `fixtures` MUST be in canonical (kickoff ASC, fixtureId ASC) order. Pure. */
export function reconstructTrajectories(
  participants: readonly TrajectoryTeamRow[],
  fixtures: readonly TrajectoryFixtureRow[],
): Map<string, TrajectoryPoint[]> {
  const meta = new Map<string, { id: string; name: string; slug: string }>();
  const acc = new Map<string, Acc>();
  for (const t of participants) {
    meta.set(t.team_id, { id: t.team_id, name: t.team_name, slug: t.team_slug });
    acc.set(t.team_id, zeroAcc());
  }
  const out = new Map<string, TrajectoryPoint[]>();
  for (const t of participants) out.set(t.team_id, []);
  const seqByTeam = new Map<string, number>();

  const ensure = (teamId: string): void => {
    // Defensive: a fixture team not in the participant set (should not happen — participants
    // are the edition's fixture teams). Seed it so the table stays complete and ranked.
    if (!acc.has(teamId)) {
      acc.set(teamId, zeroAcc());
      meta.set(teamId, { id: teamId, name: teamId, slug: teamId });
      out.set(teamId, []);
    }
  };

  for (const f of fixtures) {
    ensure(f.home_team_id); ensure(f.away_team_id);
    const posBefore = rankTeams(acc);

    const hg = requireGoals(f.home_goals, f.fixture_id, 'home');
    const ag = requireGoals(f.away_goals, f.fixture_id, 'away');
    const home = acc.get(f.home_team_id)!;
    const away = acc.get(f.away_team_id)!;
    home.gf += hg; home.ga += ag;
    away.gf += ag; away.ga += hg;
    if (hg > ag) { home.wins += 1; home.points += 3; away.losses += 1; }
    else if (hg < ag) { away.wins += 1; away.points += 3; home.losses += 1; }
    else { home.draws += 1; away.draws += 1; home.points += 1; away.points += 1; }

    const posAfter = rankTeams(acc);

    for (const isHome of [true, false] as const) {
      const teamId = isHome ? f.home_team_id : f.away_team_id;
      const oppId = isHome ? f.away_team_id : f.home_team_id;
      const gfF = isHome ? hg : ag;
      const gaF = isHome ? ag : hg;
      const result: 'W' | 'D' | 'L' = gfF > gaF ? 'W' : gfF < gaF ? 'L' : 'D';
      const pointsEarned = result === 'W' ? 3 : result === 'D' ? 1 : 0;
      const a = acc.get(teamId)!;
      const before = posBefore.get(teamId)!;
      const after = posAfter.get(teamId)!;
      const seq = (seqByTeam.get(teamId) ?? 0) + 1;
      seqByTeam.set(teamId, seq);
      out.get(teamId)!.push({
        fixtureId: f.fixture_id,
        fixturePartitionOn: f.fixture_partition_on,
        sequenceIndex: seq,
        kickoffAt: iso(f.kickoff_at),
        opponent: meta.get(oppId)!,
        venueSide: isHome ? 'home' : 'away',
        result,
        pointsEarned,
        positionBefore: before,
        positionAfter: after,
        positionChange: before - after, // positive = up toward rank 1
        table: {
          points: a.points, wins: a.wins, draws: a.draws, losses: a.losses,
          goalsFor: a.gf, goalsAgainst: a.ga, goalDifference: goalDiff(a),
        },
      });
    }
  }
  return out;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Summary aggregates over a team's FULL chronological trajectory. Pure. */
export function summarise(points: readonly TrajectoryPoint[]): TrajectorySummary {
  const n = points.length;
  if (n === 0) {
    return {
      highestPosition: null, lowestPosition: null, currentPosition: null,
      averagePosition: null, medianPosition: null, totalObservedFixtures: 0,
      positionMovesUp: 0, positionMovesDown: 0, positionUnchanged: 0,
      largestRise: 0, largestDrop: 0, longestUnchangedRun: 0,
    };
  }
  const afters = points.map((p) => p.positionAfter);
  const changes = points.map((p) => p.positionChange);
  const sorted = [...afters].sort((a, b) => a - b);
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;

  let longest = 0; let run = 0; let prev: number | null = null;
  for (const a of afters) {
    if (prev !== null && a === prev) { run += 1; } else { run = 1; }
    if (run > longest) longest = run;
    prev = a;
  }

  return {
    highestPosition: Math.min(...afters),
    lowestPosition: Math.max(...afters),
    currentPosition: afters[n - 1],
    averagePosition: round2(afters.reduce((s, x) => s + x, 0) / n),
    medianPosition: round2(median),
    totalObservedFixtures: n,
    positionMovesUp: changes.filter((c) => c > 0).length,
    positionMovesDown: changes.filter((c) => c < 0).length,
    positionUnchanged: changes.filter((c) => c === 0).length,
    largestRise: Math.max(0, ...changes),
    largestDrop: Math.min(0, ...changes),
    longestUnchangedRun: longest,
  };
}

/** Assemble the response from reconstructed trajectories. Reconstruction/summary happen
 *  over the FULL series; team filter + order + limit/offset only reshape the emitted output. Pure. */
export function assembleSeasonPositionTrajectory(
  identity: { edition: { id: string; seasonLabel: string }; competition: { id: string; name: string; slug: string } },
  participants: readonly TrajectoryTeamRow[],
  byTeam: ReadonlyMap<string, TrajectoryPoint[]>,
  opts: { asOf: Date; teamId: string | null; order: 'asc' | 'desc'; limit: number | null; offset: number | null },
): SeasonPositionTrajectoryResponse {
  let teamRows = participants;
  if (opts.teamId) teamRows = participants.filter((t) => t.team_id === opts.teamId);

  const teams: TeamTrajectory[] = teamRows.map((t) => {
    const full = byTeam.get(t.team_id) ?? [];
    const summary = summarise(full);
    let emitted = full;
    if (opts.order === 'desc') emitted = [...full].reverse();
    if (opts.offset != null && opts.offset > 0) emitted = emitted.slice(opts.offset);
    if (opts.limit != null) emitted = emitted.slice(0, opts.limit);
    return {
      team: { id: t.team_id, name: t.team_name, slug: t.team_slug },
      observationCount: full.length,
      trajectory: emitted,
      summary,
    };
  });

  // Order returned teams by current reconstructed position (rank 1 first), then team id.
  teams.sort((a, b) => {
    const ca = a.summary.currentPosition; const cb = b.summary.currentPosition;
    if (ca === null && cb === null) return Number(a.team.id) - Number(b.team.id);
    if (ca === null) return 1;
    if (cb === null) return -1;
    return ca - cb || Number(a.team.id) - Number(b.team.id);
  });

  return {
    edition: identity.edition,
    competition: identity.competition,
    scope: { asOf: opts.asOf.toISOString(), order: opts.order, teamId: opts.teamId },
    asOf: opts.asOf.toISOString(),
    mode: 'RAW_DETERMINISTIC',
    positionMethod: { comparator: [...POSITION_COMPARATOR], version: POSITION_METHOD_VERSION, note: POSITION_METHOD_NOTE },
    teamCount: teams.length,
    teams,
  };
}

// ── SQL (read-only) ─────────────────────────────────────────────────────────────

const TRAJECTORY_IDENTITY_SQL = `
  SELECT ce.id::text     AS edition_id,
         ce.season_label AS season_label,
         c.id::text      AS competition_id,
         c.name          AS competition_name,
         c.slug          AS competition_slug
    FROM football.competition_edition ce
    JOIN football.competition c ON c.id = ce.competition_id
   WHERE ce.id = $1::bigint
`;

// All edition participant teams (every team that appears in an edition fixture, any
// lifecycle) — seeded at zero even if they have not played before asOf. $1 edition.
const TRAJECTORY_TEAMS_SQL = `
  SELECT t.id::text AS team_id, t.name AS team_name, t.slug AS team_slug
    FROM football.team t
   WHERE t.id IN (
     SELECT home_team_id FROM football.fixture WHERE competition_edition_id = $1::bigint
     UNION
     SELECT away_team_id FROM football.fixture WHERE competition_edition_id = $1::bigint
   )
   ORDER BY t.id
`;

// Eligible completed, result-bearing fixtures in canonical chronological order. NO
// LIMIT — the full set is required for a correct replay. $1 edition · $2 as_of (STRICT <).
export const TRAJECTORY_FIXTURES_SQL = `
  SELECT f.id::text                     AS fixture_id,
         f.fixture_partition_on::text   AS fixture_partition_on,
         f.scheduled_kickoff_at         AS kickoff_at,
         f.home_team_id::text           AS home_team_id,
         f.away_team_id::text           AS away_team_id,
         r.home_goals                   AS home_goals,
         r.away_goals                   AS away_goals
    FROM football.fixture f
    JOIN football.result r
      ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE f.competition_edition_id = $1::bigint
     AND f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
   ORDER BY f.scheduled_kickoff_at ASC, f.id ASC
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

/** Returns the edition's RAW deterministic season position trajectory, or null when the
 *  edition does not exist (→ 404). At most three queries: identity + teams + fixtures
 *  (no per-fixture / per-team N+1). Reconstruction happens over the full eligible set;
 *  team filter + order + limit/offset only reshape the emitted response. */
export async function readSeasonPositionTrajectory(
  tx: PoolClient,
  editionId: string,
  options: SeasonPositionTrajectoryOptions = {},
): Promise<SeasonPositionTrajectoryResponse | null> {
  const identityRes = await tx.query<TrajectoryIdentityRow>(TRAJECTORY_IDENTITY_SQL, [editionId]);
  if (identityRes.rows.length === 0) return null;
  const idRow = identityRes.rows[0];
  const identity = {
    edition: { id: idRow.edition_id, seasonLabel: idRow.season_label },
    competition: { id: idRow.competition_id, name: idRow.competition_name, slug: idRow.competition_slug },
  };

  const asOf = options.asOf ?? new Date();
  const teamId = options.teamId ?? null;
  const order: 'asc' | 'desc' = options.order === 'desc' ? 'desc' : 'asc';
  const limit = options.limit ?? null;
  const offset = options.offset ?? null;

  const teamsRes = await tx.query<TrajectoryTeamRow>(TRAJECTORY_TEAMS_SQL, [editionId]);
  const fixturesRes = await tx.query<TrajectoryFixtureRow>(TRAJECTORY_FIXTURES_SQL, [editionId, asOf]);

  const byTeam = reconstructTrajectories(teamsRes.rows, fixturesRes.rows);

  return assembleSeasonPositionTrajectory(identity, teamsRes.rows, byTeam, { asOf, teamId, order, limit, offset });
}
