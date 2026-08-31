// ─────────────────────────────────────────────────────────────────────────────
// EDITION-WIDE CHRONOLOGICAL RANKING — opponent rank-band reconstruction
//
// S-6 Phase 3B. The historical-ranking substrate the Giant Killer feature needs
// and `football.standing` could NOT provide (Phase 3A: one TOTAL snapshot for the
// whole edition, too sparse/stale for point-in-time opponent ranking).
//
// This is a PURE function of a set of completed edition fixtures. It replays each
// competition edition chronologically and, for every fixture, records the
// opponent's league position AS IT STOOD IMMEDIATELY BEFORE that fixture — bucketed
// into the V1 tertile band. It reads no clock and no database.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A REPLAY, AND WHY IT CANNOT LEAK
//
// A fixture must NEVER contribute to the opponent's rank for itself. Two rules,
// stated by the owner and both load-bearing, guarantee that:
//
//   1. Fixtures are ordered `(kickoffAt ASC, fixtureId ASC)` within an edition —
//      a total order (kickoff alone is not: two fixtures can share an instant).
//   2. The standings snapshot is taken BEFORE the fixture's result is applied to
//      the accumulator, and the result is applied only AFTER the snapshot is
//      recorded. So fixture F's opponent band depends solely on fixtures strictly
//      earlier than F in the edition timeline.
//
// ─────────────────────────────────────────────────────────────────────────────
// V1 FIDELITY (source: jobs/processHistoricalContext.ts)
//
//   table sort ........ points DESC, goal-difference DESC, goals-for DESC   (:131-147)
//   ranked set ........ only teams with games > 0                            (:137)
//   tableSize ......... max(number of ranked teams, 16)  — early-season floor (:580)
//   band .............. third = ceil(tableSize/3);
//                       pos ≤ third → top; pos ≤ 2·third → middle; else bottom (:149-154)
//   opponent gate ..... opponent needs games ≥ 1, else NO band               (:578)
//   snapshot timing ... accumulators advance AFTER snapshotting              (:637-648)
//
// ONE DELIBERATE DETERMINISM DEVIATION FROM V1. V1 leaves teams that are EQUAL on
// points, goal-difference and goals-for in Map-insertion order — arbitrary, and
// fragile across runs. Here a final tiebreak by numeric team id makes the order
// TOTAL and reproducible on any machine (R-2 obligation 1). It changes only the
// relative order of teams that are otherwise exactly tied — which V1 never
// defined — so it is a determinism guarantee, not a semantic change. It can move a
// fully-tied team across a tertile boundary in the rare exact-tie case; that is
// the accepted, documented cost of determinism.
//
// MULTI-STAGE EDITIONS. Ranking is EDITION-scoped (`competition_edition_id`
// encodes competition AND season), replayed as a single flat table — exactly as
// V1 grouped by `tournament:season`. An edition split into group/knockout stages
// would have those stages conflated into one table, inheriting V1's behaviour
// rather than inventing per-stage handling. The verified corpus (edition 18,
// Brasileirão 2026) is a single-table league, where the flat replay is exact.
// A future per-stage refinement is a separate, authorized change.
// ─────────────────────────────────────────────────────────────────────────────

import type { OpponentBand, RankedFixture, RankedTeamHistory } from './types';

/** The early-season league-size floor for tertile banding (V1 `max(size, 16)`). */
export const RANK_TABLE_SIZE_FLOOR = 16;

/**
 * One completed fixture with a result, as read edition-wide (all teams) from
 * `football.fixture` + `football.result`. The input to the replay.
 *
 * Goals are the RAW home/away regulation goals (NOT subject-oriented) — the
 * replay derives each side's points and margin from them directly.
 */
export interface EditionFixture {
  readonly competitionEditionId: string;
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly kickoffAt: Date;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly homeGoals: number;
  readonly awayGoals: number;
}

interface Accumulator {
  points: number;
  games: number;
  gf: number;
  ga: number;
}

/** Points for a scoreline from one side's perspective: 3 win / 1 draw / 0 loss. */
function pointsFor(forGoals: number, againstGoals: number): number {
  if (forGoals > againstGoals) return 3;
  if (forGoals === againstGoals) return 1;
  return 0;
}

/**
 * Reconstructs each subject team's band-annotated completed-fixture history by
 * replaying every edition present in `fixtures` chronologically.
 *
 * Returns a map keyed by team id. A team's fixtures pool ACROSS the editions it
 * played (the feature is ALL_COMPETITIONS), each fixture carrying the opponent's
 * edition-scoped pre-match band. The returned per-team fixtures are in ascending
 * `(kickoffAt, fixtureId)` order.
 *
 * PURE: a function of `fixtures` alone. No clock, no database, no `Date.now`.
 */
export function rankEditionFixtures(
  fixtures: readonly EditionFixture[]
): Map<string, RankedTeamHistory> {
  // Group by edition. Ranking is edition-scoped — one edition's results never
  // rank another's opponents.
  const byEdition = new Map<string, EditionFixture[]>();
  for (const f of fixtures) {
    const list = byEdition.get(f.competitionEditionId);
    if (list) list.push(f);
    else byEdition.set(f.competitionEditionId, [f]);
  }

  const out = new Map<string, RankedFixture[]>();
  const record = (teamId: string, rf: RankedFixture): void => {
    const list = out.get(teamId);
    if (list) list.push(rf);
    else out.set(teamId, [rf]);
  };

  // Editions in a deterministic order. (Cross-edition order does not affect any
  // single edition's bands — each replays independently — but a stable order
  // keeps the whole computation reproducible.)
  const editionIds = [...byEdition.keys()].sort((a, b) => Number(a) - Number(b));

  for (const editionId of editionIds) {
    const editionFixtures = byEdition.get(editionId)!
      .slice()
      .sort(
        (a, b) =>
          a.kickoffAt.getTime() - b.kickoffAt.getTime() ||
          Number(a.fixtureId) - Number(b.fixtureId)
      );

    const acc = new Map<string, Accumulator>();
    const accOf = (teamId: string): Accumulator => {
      let a = acc.get(teamId);
      if (!a) {
        a = { points: 0, games: 0, gf: 0, ga: 0 };
        acc.set(teamId, a);
      }
      return a;
    };

    for (const f of editionFixtures) {
      // ── SNAPSHOT BEFORE APPLYING ────────────────────────────────────────────
      // Rank every team with games > 0. V1 keys, plus a numeric-team-id final
      // tiebreak for total, machine-independent order.
      const ranked = [...acc.entries()]
        .filter(([, a]) => a.games > 0)
        .sort(
          ([aId, a], [bId, b]) =>
            b.points - a.points ||
            (b.gf - b.ga) - (a.gf - a.ga) ||
            b.gf - a.gf ||
            Number(aId) - Number(bId)
        );
      const position = new Map<string, number>();
      ranked.forEach(([teamId], index) => position.set(teamId, index + 1));

      const tableSize = Math.max(ranked.length, RANK_TABLE_SIZE_FLOOR);
      const third = Math.ceil(tableSize / 3);
      const bandOf = (opponentId: string): OpponentBand | null => {
        // Opponent must have played ≥ 1 game to have a position and a band.
        const oa = acc.get(opponentId);
        if (!oa || oa.games < 1) return null;
        const pos = position.get(opponentId);
        if (pos === undefined) return null; // defensive; games>0 ⇒ ranked
        if (pos <= third) return 'top';
        if (pos <= 2 * third) return 'middle';
        return 'bottom';
      };

      const homePts = pointsFor(f.homeGoals, f.awayGoals);
      const awayPts = pointsFor(f.awayGoals, f.homeGoals);

      record(f.homeTeamId, {
        fixtureId: f.fixtureId,
        competitionEditionId: editionId,
        kickoffAt: f.kickoffAt,
        isHome: true,
        pointsEarned: homePts,
        opponentBand: bandOf(f.awayTeamId),
      });
      record(f.awayTeamId, {
        fixtureId: f.fixtureId,
        competitionEditionId: editionId,
        kickoffAt: f.kickoffAt,
        isHome: false,
        pointsEarned: awayPts,
        opponentBand: bandOf(f.homeTeamId),
      });

      // ── APPLY AFTER RECORDING THE SNAPSHOT ──────────────────────────────────
      const home = accOf(f.homeTeamId);
      const away = accOf(f.awayTeamId);
      home.points += homePts;
      home.games += 1;
      home.gf += f.homeGoals;
      home.ga += f.awayGoals;
      away.points += awayPts;
      away.games += 1;
      away.gf += f.awayGoals;
      away.ga += f.homeGoals;
    }
  }

  // Deterministic per-team order. A team appearing in more than one edition has
  // its fixtures interleaved by time, not grouped by edition.
  const result = new Map<string, RankedTeamHistory>();
  for (const [teamId, list] of out) {
    list.sort(
      (a, b) =>
        a.kickoffAt.getTime() - b.kickoffAt.getTime() ||
        Number(a.fixtureId) - Number(b.fixtureId)
    );
    result.set(teamId, { teamId, fixtures: list });
  }
  return result;
}
