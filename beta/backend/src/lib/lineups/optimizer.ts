/**
 * PREDICTED LINEUPS ENGINE — maximum-weight assignment
 *
 * WHY THIS EXISTS
 *
 * The v1 engine filled slots left to right: pick the best goalkeeper, then the
 * best right-back, then the best centre-back, and so on. That is a greedy
 * algorithm, and greedy algorithms lose real information on this problem.
 *
 * Two players, two slots:
 *
 *            RB      CB
 *   Player A 0.95    1.00
 *   Player B 0.94    0.30
 *
 * Filling RB first takes A (0.95), leaving B at CB (0.30) for 1.25 total. The
 * optimal pairing is B at RB and A at CB, for 1.94 — the same two players,
 * 55% more total quality, purely from the order slots were filled in. Real
 * squads are full of this shape: a versatile player is the best option
 * everywhere, and every slot that grabs him first wastes a specialist.
 *
 * THE ALGORITHM
 *
 * This is the Hungarian algorithm (Kuhn–Munkres) in its O(n²m) shortest
 * augmenting path form, which handles a rectangular matrix directly — rows are
 * the eleven slots, columns are the candidate players, and there are always
 * more players than slots. It returns the assignment maximizing total score
 * with a global optimality guarantee, not a locally sensible sequence of
 * picks.
 *
 * Cost is minimized internally, so scores are negated on the way in. Runtime
 * for an XI against a 40-player squad is on the order of tens of thousands of
 * operations — negligible next to a single database round trip, and it runs
 * once per formation per team.
 */

/** Sentinel for "this player may not fill this slot" (e.g. an outfielder in goal). */
export const FORBIDDEN = Number.NEGATIVE_INFINITY;

/**
 * Solves the rectangular maximum-weight assignment problem.
 *
 * @param score  score[row][col] — the value of assigning row (slot) to col
 *               (player). Use FORBIDDEN to forbid a pairing outright.
 * @returns      For each row, the column assigned to it, or -1 when the row
 *               could not be assigned (only possible when every column for
 *               that row is FORBIDDEN, or there are fewer columns than rows).
 *
 * Rows must not outnumber columns; callers guarantee this by checking squad
 * size before evaluating a formation.
 */
export function maximumWeightAssignment(score: number[][]): number[] {
  const n = score.length;
  if (n === 0) return [];
  const m = score[0].length;
  if (m < n) throw new Error(`maximumWeightAssignment: ${n} rows exceeds ${m} columns`);

  // Convert to a minimization problem over finite costs. FORBIDDEN pairings
  // become a penalty large enough that the solver only ever picks one when
  // there is genuinely no alternative — using Infinity directly would make the
  // potentials NaN and break the augmenting-path search.
  let maxFinite = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const s = score[i][j];
      if (Number.isFinite(s) && s > maxFinite) maxFinite = s;
    }
  }
  const BIG = (maxFinite + 1) * (n + 1);
  const cost: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(m);
    for (let j = 0; j < m; j++) {
      row[j] = Number.isFinite(score[i][j]) ? maxFinite - score[i][j] : BIG;
    }
    cost[i] = row;
  }

  // Standard 1-indexed formulation. u/v are the dual potentials, p[j] is the
  // row currently matched to column j (0 = unmatched), way[j] records the
  // alternating path used to backtrack an augmentation.
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);

    // Grow a shortest augmenting path from row i until it reaches a free column.
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      // Re-tighten the duals so the path stays admissible.
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    // Walk the path back, flipping matched/unmatched edges.
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) rowToCol[p[j] - 1] = j - 1;
  }

  // A row that only had FORBIDDEN options may have been forced onto one. Report
  // it as unassigned rather than silently emitting an illegal pairing.
  for (let i = 0; i < n; i++) {
    const j = rowToCol[i];
    if (j >= 0 && !Number.isFinite(score[i][j])) rowToCol[i] = -1;
  }

  return rowToCol;
}
