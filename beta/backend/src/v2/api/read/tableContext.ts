// ─────────────────────────────────────────────────────────────────────────────
// TABLE CONTEXT — read model (composition of two DISTINCT table sources)
//
// "Where is this team in the table, and what is the surrounding context?" — for ONE
// competition edition. Descriptive context; NOT prediction, final-position forecast,
// probability, ranking score, or recommendation.
//
// TWO explicit, never-merged modes (governance-locked):
//   • CURRENT_PROVIDER — the current provider standings snapshot (editionStandings
//     TOTAL table): a single coherent ranked table → position, played, points, W/D/L,
//     GF/GA/GD, plus adjacent above/below and point gaps. Positions/order are the
//     provider's; positionChange is null (a snapshot carries no prior state).
//   • RAW_DETERMINISTIC — historical/as-of reconstruction (Season Position Trajectory):
//     the team's position after its latest completed fixture < asOf, with its
//     cumulative totals and trajectory positionChange. Deterministic comparator
//     (points→GD→GF→teamId); NOT official. Historical adjacency/gaps are NOT exposed
//     (a team's per-fixture currentPosition is not a synchronized edition-wide as-of
//     table; a coherent historical table is a separate future governed capability).
//
// Pure assembly here; the DB composition (readers + governed-exposure gate) lives in
// handlers.getTableContext. No duplicate ranking logic; frozen contracts untouched.
// ─────────────────────────────────────────────────────────────────────────────

import type { EditionStandings, StandingLine } from './editionStandings';
import type { SeasonPositionTrajectoryResponse, TeamTrajectory } from './seasonPositionTrajectory';

export type TableContextMode = 'CURRENT_PROVIDER' | 'RAW_DETERMINISTIC';

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export interface TableContextRow {
  readonly position: number;
  readonly played: number;
  readonly points: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
}

export interface TableContextAdjacent {
  readonly position: number;
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly points: number;
  readonly pointsGap: number; // gap in points to this adjacent team (always ≥ 0 within a coherent table)
}

export interface TableContextTeam {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly table: TableContextRow | null; // null when the team is not present in the source table
  readonly change: { readonly position: number | null } | null; // CURRENT: null; RAW: trajectory positionChange
  readonly adjacent: { readonly above: TableContextAdjacent | null; readonly below: TableContextAdjacent | null };
}

export interface TableContextMethod {
  readonly mode: TableContextMode;
  readonly note: string;
  readonly comparator?: readonly string[]; // RAW_DETERMINISTIC only
  readonly version?: string;               // RAW_DETERMINISTIC only
}

export interface TableContextResponse {
  readonly edition: { readonly id: string; readonly seasonLabel: string };
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: { readonly editionId: string; readonly asOf: string | null; readonly mode: TableContextMode };
  readonly team: TableContextTeam | null;                 // present when a teamId is requested
  readonly teams: readonly TableContextTeam[] | null;     // edition-wide (CURRENT: coherent table; RAW: per-team latest, adjacency null)
  readonly method: TableContextMethod;
  readonly provenance: {
    readonly source: 'editionStandings' | 'seasonPositionTrajectory';
    readonly mode: TableContextMode;
    readonly asOf: string | null;
    readonly standingsAsOf?: string | null;        // CURRENT
    readonly comparator?: readonly string[];        // RAW
    readonly reconstructionVersion?: string;        // RAW
    readonly lastEligibleFixtureId?: string | null; // RAW (team-scoped)
  };
}

export interface TableContextOptions {
  readonly teamId?: string | null;
  readonly asOf?: Date;
}

// ── CURRENT_PROVIDER (coherent provider table) ─────────────────────────────────

function currentTableRow(line: StandingLine): TableContextRow {
  return {
    position: line.position, played: line.played, points: line.points,
    wins: line.won, draws: line.drawn, losses: line.lost,
    goalsFor: line.goalsFor, goalsAgainst: line.goalsAgainst, goalDifference: line.goalDifference,
  };
}

function adjacentOf(line: StandingLine, pointsGap: number): TableContextAdjacent {
  return { position: line.position, team: line.team, points: line.points, pointsGap };
}

/** Build one team's CURRENT context from the coherent provider table (rows ordered by
 *  provider position). Adjacency + gaps from the same table; positionChange null. */
export function buildCurrentTeam(rows: readonly StandingLine[], idx: number): TableContextTeam {
  const line = rows[idx];
  const above = idx > 0 ? adjacentOf(rows[idx - 1], rows[idx - 1].points - line.points) : null;
  const below = idx < rows.length - 1 ? adjacentOf(rows[idx + 1], line.points - rows[idx + 1].points) : null;
  return { team: line.team, table: currentTableRow(line), change: null, adjacent: { above, below } };
}

export interface CurrentStandingsInput {
  readonly edition: { readonly id: string; readonly seasonLabel: string; readonly competition: { readonly id: string; readonly name: string; readonly slug: string } };
  readonly standings: EditionStandings;
}

export function buildCurrentTableContext(std: CurrentStandingsInput, teamId: string | null): TableContextResponse {
  const total = std.standings.tables.find((t) => t.variant === 'TOTAL') ?? null;
  const rows = total ? total.rows : [];
  const edition = { id: std.edition.id, seasonLabel: std.edition.seasonLabel };
  const competition = std.edition.competition;
  const method: TableContextMethod = { mode: 'CURRENT_PROVIDER', note: 'Current provider standings snapshot; positions and order are provider-supplied.' };
  const provenance = { source: 'editionStandings' as const, mode: 'CURRENT_PROVIDER' as const, asOf: null, standingsAsOf: total ? total.asOf : null };
  const scope = { editionId: edition.id, asOf: null, mode: 'CURRENT_PROVIDER' as const };

  if (teamId) {
    const idx = rows.findIndex((r) => r.team.id === teamId);
    const team: TableContextTeam = idx >= 0
      ? buildCurrentTeam(rows, idx)
      : { team: { id: teamId, name: teamId, slug: teamId }, table: null, change: null, adjacent: { above: null, below: null } }; // missing stays missing
    return { edition, competition, scope, team, teams: null, method, provenance };
  }
  const teams = rows.map((_, idx) => buildCurrentTeam(rows, idx));
  return { edition, competition, scope, team: null, teams, method, provenance };
}

// ── RAW_DETERMINISTIC (historical / as-of, via Season Position Trajectory) ──────

/** Build one team's HISTORICAL context from its trajectory (latest point = state after
 *  its latest completed fixture < asOf). Adjacency/gaps are NOT exposed historically. */
export function buildHistoricalTeam(tt: TeamTrajectory): TableContextTeam {
  const pts = tt.trajectory;
  if (pts.length === 0) {
    return { team: tt.team, table: null, change: null, adjacent: { above: null, below: null } };
  }
  const last = pts[pts.length - 1];
  const t = last.table;
  const table: TableContextRow = {
    position: last.positionAfter,
    played: t.wins + t.draws + t.losses,
    points: t.points, wins: t.wins, draws: t.draws, losses: t.losses,
    goalsFor: t.goalsFor, goalsAgainst: t.goalsAgainst, goalDifference: t.goalDifference,
  };
  return { team: tt.team, table, change: { position: last.positionChange }, adjacent: { above: null, below: null } };
}

function lastFixtureIdOf(tt: TeamTrajectory | null): string | null {
  if (!tt || tt.trajectory.length === 0) return null;
  return tt.trajectory[tt.trajectory.length - 1].fixtureId;
}

export function buildHistoricalTableContext(traj: SeasonPositionTrajectoryResponse, teamId: string | null, asOfIso: string): TableContextResponse {
  const edition = traj.edition;
  const competition = traj.competition;
  const method: TableContextMethod = {
    mode: 'RAW_DETERMINISTIC',
    note: 'Reconstructed from completed results strictly before asOf; deterministic comparator, not official ranking. Historical adjacency/gaps are not exposed (per-fixture positions are not a synchronized as-of table).',
    comparator: traj.positionMethod.comparator,
    version: traj.positionMethod.version,
  };
  const scope = { editionId: edition.id, asOf: asOfIso, mode: 'RAW_DETERMINISTIC' as const };

  if (teamId) {
    const tt = traj.teams.find((t) => t.team.id === teamId) ?? null;
    const team: TableContextTeam = tt
      ? buildHistoricalTeam(tt)
      : { team: { id: teamId, name: teamId, slug: teamId }, table: null, change: null, adjacent: { above: null, below: null } };
    const provenance = {
      source: 'seasonPositionTrajectory' as const, mode: 'RAW_DETERMINISTIC' as const, asOf: asOfIso,
      comparator: traj.positionMethod.comparator, reconstructionVersion: traj.positionMethod.version,
      lastEligibleFixtureId: lastFixtureIdOf(tt),
    };
    return { edition, competition, scope, team, teams: null, method, provenance };
  }

  const teams = traj.teams.map((tt) => buildHistoricalTeam(tt));
  const provenance = {
    source: 'seasonPositionTrajectory' as const, mode: 'RAW_DETERMINISTIC' as const, asOf: asOfIso,
    comparator: traj.positionMethod.comparator, reconstructionVersion: traj.positionMethod.version,
    lastEligibleFixtureId: null,
  };
  return { edition, competition, scope, team: null, teams, method, provenance };
}
