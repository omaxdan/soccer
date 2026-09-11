// ─────────────────────────────────────────────────────────────────────────────
// S-6 Phase 3B — Giant Killer substrate: edition-wide ranking + team.giant_killer_ppg
//
// PURE ranking tests pin the V1 Stage-A replay: chronological order with a
// same-kickoff fixtureId tiebreak, pre-match snapshot semantics (no self-result
// leakage), points/GD/GF tiebreaks made observable across a tertile boundary, the
// numeric-teamId final tiebreak, the early-season max(size,16) floor, and the
// "opponent with 0 games → no band" rule.
//
// PURE calculator tests pin V1 Stage-B: top-band-only filtering, 3/1/0 points, the
// recency weight 0.5^(daysAgo/45) ANCHORED TO as_of (the R-2 deviation from V1's
// wall clock), the 730-day lower bound, the strict < as_of upper bound (no future
// leakage), the ≥3 top-tier gate (else ABSENT), determinism, and precision.
//
// DB tests pin the edition-wide read: it returns EVERY team's completed-with-result
// fixtures in the editions the subject played in-window, strictly < as_of, and
// excludes editions the subject did not play in-window.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { PROVIDER_CODE } from '../../ingestion/provider/config';
import {
  rankEditionFixtures,
  type EditionFixture,
} from '../calculators/giantKillerRanking';
import { giantKillerPpg } from '../calculators/giantKillerPpg';
import { readEditionRankingFixtures, RANKING_WINDOW_DAYS } from '../read/editionRanking';
import { compare, fromInt, toNumericString } from '../write/scale';
import type {
  CalculationContext,
  OpponentBand,
  RankedFixture,
} from '../calculators/types';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;

// ─────────────────────────────────────────────────────────────────────────────
// PURE — edition-wide chronological ranking replay
// ─────────────────────────────────────────────────────────────────────────────

const REPLAY_BASE = new Date('2026-01-05T12:00:00Z');
const rday = (n: number) => new Date(REPLAY_BASE.getTime() + n * 86_400_000);

function edf(
  ed: string,
  fixtureId: string,
  dayN: number,
  homeId: number,
  awayId: number,
  hg: number,
  ag: number
): EditionFixture {
  const kickoffAt = rday(dayN);
  return {
    competitionEditionId: ed,
    fixtureId,
    fixturePartitionOn: kickoffAt.toISOString().slice(0, 10),
    kickoffAt,
    homeTeamId: String(homeId),
    awayTeamId: String(awayId),
    homeGoals: hg,
    awayGoals: ag,
  };
}

/**
 * An 18-team round 1: pairs (base+1 v base+2) … (base+17 v base+18), the odd
 * home team winning by a margin that decreases with the pair index, so after
 * round 1 the nine winners occupy positions 1–9 strictly ordered by goal
 * difference. `overrides` (keyed by home team id) replaces a pair's [home,away]
 * goals to engineer a specific tie.
 */
function ladderRound1(
  ed: string,
  base: number,
  overrides: Record<number, [number, number]> = {}
): EditionFixture[] {
  const out: EditionFixture[] = [];
  for (let k = 0; k < 9; k++) {
    const home = base + (2 * k + 1);
    const away = base + (2 * k + 2);
    const [hg, ag] = overrides[home] ?? [9 - k, 0];
    out.push(edf(ed, `${ed}-R${k + 1}`, k + 1, home, away, hg, ag));
  }
  return out;
}

/**
 * Builds a ladder edition plus one probe fixture (a fresh team `base+19` at home
 * against a chosen ladder team), replays, and returns the band the probe recorded
 * for that ladder opponent — the opponent's pre-match tertile.
 */
function ladderProbeBand(
  base: number,
  overrides: Record<number, [number, number]>,
  opponentOffset: number
): OpponentBand | null {
  const ed = String(base);
  const fixtures = [
    ...ladderRound1(ed, base, overrides),
    edf(ed, `${ed}-P`, 20, base + 19, base + opponentOffset, 0, 0),
  ];
  const result = rankEditionFixtures(fixtures);
  return result.get(String(base + 19))!.fixtures[0].opponentBand;
}

describe('rankEditionFixtures — V1 Stage-A pre-match rank bands', () => {
  it('pre-match snapshot: a fixture never sees its own or a later result', () => {
    // 501 beats 502 3–0 on day 1; they meet again day 2.
    const fixtures = [
      edf('500', '500-1', 1, 501, 502, 3, 0),
      edf('500', '500-2', 2, 502, 501, 0, 0),
    ];
    const r = rankEditionFixtures(fixtures);
    const t501 = r.get('501')!.fixtures;
    const t502 = r.get('502')!.fixtures;

    // Day-1 fixture: both teams had 0 games ⇒ no band for either (opponent gate),
    // which also proves the day-1 result did not leak into its own snapshot.
    assert.equal(t501[0].opponentBand, null, 'day-1: opponent 502 had 0 games');
    assert.equal(t502[0].opponentBand, null, 'day-1: opponent 501 had 0 games');

    // Day-2 fixture: 501 now has 3 points from day 1, so its opponent-band is set.
    assert.equal(t502[1].opponentBand, 'top', 'day-2: 501 is ranked (top under floor)');
    assert.equal(t501[1].opponentBand, 'top', 'day-2: 502 is ranked (top under floor)');

    // Points accumulation recorded per subject fixture.
    assert.equal(t501[0].pointsEarned, 3);
    assert.equal(t502[0].pointsEarned, 0);
  });

  it('early-season floor: tableSize = max(size, 16), so position 3 of 4 is "top"', () => {
    // Without the floor, third = ceil(4/3) = 2 and position 3 would be "middle".
    const fixtures = [
      edf('400', '400-1', 1, 401, 402, 3, 0), // 401 GD+3 → pos1
      edf('400', '400-2', 1, 403, 404, 1, 0), // 403 GD+1 → pos2; 404 GD−1 → pos3
      edf('400', '400-P', 5, 405, 404, 0, 0), // probe opponent = 404 (pos3)
    ];
    const r = rankEditionFixtures(fixtures);
    assert.equal(r.get('405')!.fixtures[0].opponentBand, 'top', 'floor makes pos3 "top"');
  });

  it('tertile boundary + points/GD tiebreak: pos6 → top, pos7 → middle', () => {
    // 18 ranked teams ⇒ tableSize 18, third 6. pos6 (team+11, GD4) and pos7
    // (team+13, GD3) are BOTH winners on 3 points; goal difference alone orders
    // them across the top/middle boundary.
    assert.equal(ladderProbeBand(100, {}, 11), 'top');
    assert.equal(ladderProbeBand(150, {}, 13), 'middle');
  });

  it('GF tiebreak: teams equal on points AND GD are ordered by goals-for', () => {
    // team+11 wins 4–1 (GD3, GF4), team+13 wins 3–0 (GD3, GF3): equal points and
    // GD, so goals-for puts +11 at pos6 (top) and +13 at pos7 (middle).
    const overrides = (b: number): Record<number, [number, number]> => ({
      [b + 11]: [4, 1],
      [b + 13]: [3, 0],
    });
    assert.equal(ladderProbeBand(200, overrides(200), 11), 'top');
    assert.equal(ladderProbeBand(250, overrides(250), 13), 'middle');
  });

  it('deterministic final tiebreak: fully-tied teams order by numeric team id', () => {
    // team+11 and team+13 both win 3–0 (equal points, GD and GF): the lower id
    // (+11) takes pos6 (top), the higher (+13) pos7 (middle) — a total order V1
    // left to arbitrary map order.
    const overrides = (b: number): Record<number, [number, number]> => ({
      [b + 11]: [3, 0],
      [b + 13]: [3, 0],
    });
    assert.equal(ladderProbeBand(300, overrides(300), 11), 'top');
    assert.equal(ladderProbeBand(350, overrides(350), 13), 'middle');
  });

  it('opponent with zero games receives no band', () => {
    // The ladder team's OWN probe fixture faces the fresh team (0 games) → null.
    const ed = '700';
    const base = 700;
    const fixtures = [
      ...ladderRound1(ed, base),
      edf(ed, `${ed}-P`, 20, base + 19, base + 11, 0, 0),
    ];
    const r = rankEditionFixtures(fixtures);
    const ladderTeamProbe = r.get(String(base + 11))!.fixtures.find((f) => f.fixtureId === `${ed}-P`)!;
    assert.equal(ladderTeamProbe.opponentBand, null, 'fresh probe team had 0 games');
  });

  it('deterministic regardless of input order, including same-kickoff fixtures', () => {
    // Two fixtures share an instant (day 1); a third depends on their standings.
    const inOrder: EditionFixture[] = [
      edf('600', '600-1', 1, 601, 602, 3, 0),
      edf('600', '600-2', 1, 603, 604, 1, 0),
      edf('600', '600-3', 2, 605, 601, 0, 0),
      edf('600', '600-4', 2, 606, 603, 0, 0),
    ];
    const shuffled = [inOrder[3], inOrder[1], inOrder[0], inOrder[2]];
    const a = rankEditionFixtures(inOrder);
    const b = rankEditionFixtures(shuffled);
    const bandsOf = (m: Map<string, { fixtures: readonly RankedFixture[] }>) =>
      [...m.entries()]
        .sort(([x], [y]) => Number(x) - Number(y))
        .map(([id, h]) => [id, h.fixtures.map((f) => `${f.fixtureId}:${f.opponentBand}:${f.pointsEarned}`)]);
    assert.deepEqual(bandsOf(a), bandsOf(b), 'output is independent of input order');
  });

  it('bands are edition-scoped: one edition never ranks another’s opponents', () => {
    // Same two teams in two editions; a strong record in edition X must not
    // influence the band computed in edition Y.
    const fixtures = [
      edf('10', '10-1', 1, 11, 12, 5, 0),
      edf('10', '10-2', 2, 13, 11, 0, 0), // ed 10: 11 is ranked
      edf('20', '20-1', 1, 11, 12, 0, 0), // ed 20: 11 & 12 both start at 0 games
    ];
    const r = rankEditionFixtures(fixtures);
    const ed20 = r.get('11')!.fixtures.find((f) => f.competitionEditionId === '20')!;
    assert.equal(ed20.opponentBand, null, 'in edition 20 the opponent had 0 games there');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PURE — the calculator: V1 Stage-B recency-weighted PPG vs top-tier
// ─────────────────────────────────────────────────────────────────────────────

const AS_OF = new Date('2027-05-02T00:00:00Z');
const KEY = 'team.giant_killer_ppg';
const TEAM = 'T';
const daysBefore = (n: number) => new Date(AS_OF.getTime() - n * 86_400_000);

function rf(
  dayAgo: number,
  band: OpponentBand | null,
  pts: number,
  id = 'F'
): RankedFixture {
  return {
    fixtureId: id,
    competitionEditionId: '1',
    kickoffAt: daysBefore(dayAgo),
    isHome: true,
    pointsEarned: pts,
    opponentBand: band,
  };
}

function ctx(fixtures: readonly RankedFixture[], asOf: Date = AS_OF): CalculationContext {
  return {
    definitions: new Map(),
    subjects: [{ teamId: TEAM, asOf }],
    fixturesByTeam: new Map(),
    editionRankedHistoryByTeam: new Map([[TEAM, { teamId: TEAM, fixtures }]]),
    homeVenueByTeam: new Map(),
    venuesById: new Map(),
    priorValues: new Map(),
  };
}

const run = (fixtures: readonly RankedFixture[], asOf?: Date) =>
  giantKillerPpg.calculate(ctx(fixtures, asOf));

describe('team.giant_killer_ppg — pure V1 Stage-B recency-weighted PPG', () => {
  it('declares itself: calculatorKey, featureKey, needsEditionRankedHistory', () => {
    assert.equal(giantKillerPpg.calculatorKey, 'giant_killer_ppg');
    assert.deepEqual([...giantKillerPpg.featureKeys], [KEY]);
    assert.equal(giantKillerPpg.needsEditionRankedHistory, true);
  });

  it('top-band only: middle/bottom/null opponents are excluded', () => {
    const [c] = run([
      rf(1, 'top', 3, 'a'),
      rf(1, 'top', 3, 'b'),
      rf(1, 'top', 3, 'c'),
      rf(1, 'middle', 0, 'd'),
      rf(1, 'bottom', 0, 'e'),
      rf(1, null, 0, 'f'),
    ]);
    assert.ok(c, 'a value is produced from the three top-tier fixtures');
    assert.equal(c.sampleObservationCount, 3, 'only top-tier fixtures counted');
    // All three top fixtures at the same instant, all 3 points ⇒ ppg 3.
    assert.equal(compare(c.value, fromInt(3)), 0);
    assert.equal(c.featureKey, KEY);
    assert.deepEqual([...c.consumed], []);
  });

  it('fewer than 3 top-tier matches → feature ABSENT (never fabricated)', () => {
    assert.equal(run([rf(1, 'top', 3), rf(2, 'top', 3)]).length, 0, 'n=2 top → absent');
    // Many non-top matches do not help.
    assert.equal(
      run([rf(1, 'top', 3), rf(1, 'middle', 3), rf(1, 'bottom', 3), rf(1, null, 3)]).length,
      0,
      'only 1 top → absent'
    );
  });

  it('points: 3 win / 1 draw / 0 loss, equal recency → simple mean', () => {
    // All at the same instant ⇒ equal weights ⇒ ppg = (3+1+0)/3 = 1.3333333333.
    const [c] = run([rf(5, 'top', 3, 'a'), rf(5, 'top', 1, 'b'), rf(5, 'top', 0, 'c')]);
    assert.ok(toNumericString(c.value).startsWith('1.3333333333'), toNumericString(c.value));
  });

  it('recency: 0.5^(daysAgo/45) weights recent top results more', () => {
    // 45d ago (weight 0.5, 3 pts), 90d ago (weight 0.25, 0 pts), 45d ago (3 pts):
    // ppg = (3·0.5 + 0·0.25 + 3·0.5) / (0.5 + 0.25 + 0.5) = 3 / 1.25 = 2.4.
    // (daysAgo 0 would equal as_of and is excluded by the strict bound, so the
    // half-life points are used rather than weight-1 points.)
    const [c] = run([rf(45, 'top', 3, 'a'), rf(90, 'top', 0, 'b'), rf(45, 'top', 3, 'c')]);
    assert.equal(toNumericString(c.value).slice(0, 3), '2.4');
  });

  it('730-day lower bound: a top match older than the window is excluded', () => {
    // Two in-window top + one just past 730d → n=2 → absent.
    assert.equal(
      run([rf(10, 'top', 3), rf(20, 'top', 3), rf(RANKING_WINDOW_DAYS + 1, 'top', 3)]).length,
      0,
      'the >730d top match does not count'
    );
    // Three in-window top + the stale one → still n=3 (stale excluded).
    const [c] = run([
      rf(10, 'top', 3),
      rf(20, 'top', 0),
      rf(30, 'top', 3),
      rf(RANKING_WINDOW_DAYS + 1, 'top', 3),
    ]);
    assert.equal(c.sampleObservationCount, 3, 'stale top match excluded from the sample');
  });

  it('strict < as_of: a top match exactly at as_of is excluded (no future leakage)', () => {
    // Exactly at as_of (dayAgo 0 → kickoff == as_of) is EXCLUDED by the strict
    // bound, dropping this set to n=2 → ABSENT.
    assert.equal(
      run([rf(0, 'top', 3), rf(1, 'top', 3), rf(2, 'top', 3)]).length,
      0,
      'at-as_of match excluded → only 2 real top matches → absent'
    );
    // With four real (strictly-before) top matches plus one at as_of and one in
    // the future, exactly the four real ones count.
    const [c] = run([
      rf(0, 'top', 3, 'atAsOf'),
      rf(-5, 'top', 3, 'future'),
      rf(1, 'top', 3, 'a'),
      rf(2, 'top', 3, 'b'),
      rf(3, 'top', 3, 'c'),
      rf(4, 'top', 3, 'd'),
    ]);
    assert.equal(c.sampleObservationCount, 4, 'at-as_of and future both excluded');
  });

  it('as_of anchoring, not the wall clock: the value depends on the supplied as_of', () => {
    // A uniform time shift alone cancels in the weighted-mean ratio; as_of matters
    // because it moves the 730-day WINDOW. Here the oldest top match (725d before
    // AS_OF, 3 pts) is inside the window at AS_OF but falls outside it 10 days
    // later, changing the sample and therefore the value.
    const fixtures = [
      rf(10, 'top', 0, 'a'),
      rf(20, 'top', 0, 'b'),
      rf(30, 'top', 3, 'c'),
      rf(725, 'top', 3, 'd'),
    ];
    const atAsOf = run(fixtures, AS_OF);
    const tenDaysLater = run(fixtures, new Date(AS_OF.getTime() + 10 * 86_400_000));
    assert.equal(atAsOf[0].sampleObservationCount, 4, 'all four in window at AS_OF');
    assert.equal(tenDaysLater[0].sampleObservationCount, 3, 'the 725d match leaves the window');
    assert.notEqual(
      toNumericString(atAsOf[0].value),
      toNumericString(tenDaysLater[0].value),
      'the value re-anchors to the supplied as_of'
    );
  });

  it('deterministic: identical input and as_of yield an identical value', () => {
    const f = [rf(3, 'top', 3, 'a'), rf(17, 'top', 1, 'b'), rf(60, 'top', 0, 'c'), rf(4, 'top', 3, 'd')];
    assert.equal(toNumericString(run(f)[0].value), toNumericString(run(f)[0].value));
  });

  it('precision: the weighted mean is bridged to Exact at working precision', () => {
    // (3+1+0)/3 repeating — carried to 10 places before the write boundary rounds.
    const s = toNumericString(run([rf(5, 'top', 3, 'a'), rf(5, 'top', 1, 'b'), rf(5, 'top', 0, 'c')])[0].value);
    assert.ok(/^1\.3333333333/.test(s), `expected sqrt-free repeating decimal, got ${s}`);
  });

  it('absent edition-ranked history → no candidate (never fabricated)', () => {
    const context: CalculationContext = {
      definitions: new Map(),
      subjects: [{ teamId: TEAM, asOf: AS_OF }],
      fixturesByTeam: new Map(),
      editionRankedHistoryByTeam: new Map(), // subject absent
      homeVenueByTeam: new Map(),
      venuesById: new Map(),
      priorValues: new Map(),
    };
    assert.equal(giantKillerPpg.calculate(context).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB — the edition-wide ranking read
// ─────────────────────────────────────────────────────────────────────────────

const TAG = 'S6GK' + (Date.now() % 1_000_000);

describe('readEditionRankingFixtures (edition-wide, window-selected)', { skip: !hasDatabase }, () => {
  const DB_AS_OF = new Date('2027-05-02T00:00:00Z');
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(DB_AS_OF.getTime() - n * 86_400_000);
  let editionMain = '', editionOther = '';
  let teamA = '', teamB = '', teamC = '', teamD = '';

  before(async () => {
    await withConnection(INGESTION_ROLE, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,'GK League',$3,'GB') RETURNING id::text`,
        [PROVIDER_CODE, `${TAG}-C`, `${TAG}-c`.toLowerCase()]
      );
      const edition = async (s: string) =>
        (await tx.query<{ id: string }>(
          `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
           VALUES ($1,$2,$3, daterange('2024-01-01','2028-01-01')) RETURNING id::text`,
          [comp.rows[0].id, `${TAG}-${s}`, `GK ${s}`]
        )).rows[0].id;
      editionMain = await edition('M');
      editionOther = await edition('O');

      const team = async (s: string) =>
        (await tx.query<{ id: string }>(
          `INSERT INTO football.team (provider_code, provider_external_id, name, slug, country_code)
           VALUES ($1,$2,$3,$4,'GB') RETURNING id::text`,
          [PROVIDER_CODE, `${TAG}-T${s}`, `GK ${s}`, `${TAG}-t${s}`.toLowerCase()]
        )).rows[0].id;
      teamA = await team('A'); teamB = await team('B'); teamC = await team('C'); teamD = await team('D');

      let seq = 0;
      const fixture = async (
        edId: string, kickoff: Date, home: string, away: string,
        hg: number | null, ag: number | null, state = 'COMPLETED'
      ) => {
        seq += 1;
        const part = day(kickoff);
        const fx = await tx.query<{ id: string }>(
          `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
             is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
           VALUES ($1,$2,$3::date,$4,false,$5,$6,$7,$8) RETURNING id::text`,
          [PROVIDER_CODE, `${TAG}-F${seq}`, part, edId, home, away, kickoff.toISOString(), state]
        );
        if (hg !== null && ag !== null) {
          await tx.query(
            `INSERT INTO football.result (fixture_partition_on, fixture_id, home_goals, away_goals)
             VALUES ($1::date,$2::bigint,$3,$4)`,
            [part, fx.rows[0].id, hg, ag]
          );
        }
      };

      // editionMain, in window: subject A plays B; and a NON-subject fixture C v D
      // that must still be returned because the edition was selected.
      await fixture(editionMain, daysAgo(10), teamA, teamB, 2, 1);
      await fixture(editionMain, daysAgo(20), teamC, teamD, 0, 0);
      // editionMain boundary exclusions.
      await fixture(editionMain, DB_AS_OF, teamA, teamB, 5, 0);              // exactly at as_of
      await fixture(editionMain, daysAgo(-5), teamA, teamB, 5, 0);           // future
      await fixture(editionMain, daysAgo(30), teamA, teamB, null, null);     // no result
      await fixture(editionMain, daysAgo(3), teamA, teamB, 1, 1, 'SCHEDULED'); // not completed
      // editionOther: A plays ONLY outside the window ⇒ edition not selected. A
      // within-window C v D here must therefore be EXCLUDED.
      await fixture(editionOther, daysAgo(RANKING_WINDOW_DAYS + 5), teamA, teamB, 1, 0);
      await fixture(editionOther, daysAgo(15), teamC, teamD, 3, 0);
    });
  });
  after(async () => { await closeAllPools(); });

  it('returns all teams’ completed-with-result fixtures in the subject’s in-window editions, strictly < as_of', async () => {
    await withConnection(FEATURE_ROLE, async (tx) => {
      const fixtures = await readEditionRankingFixtures(tx, [teamA], DB_AS_OF);
      // editionMain: the A–B (day −10) and C–D (day −20) fixtures. Nothing else.
      assert.equal(fixtures.length, 2, `expected 2, got ${fixtures.length}`);
      assert.ok(fixtures.every((f) => f.competitionEditionId === editionMain), 'only the selected edition');
      assert.ok(fixtures.every((f) => f.kickoffAt.getTime() < DB_AS_OF.getTime()), 'strict < as_of');
      // The edition-wide read includes the non-subject C v D fixture.
      assert.ok(
        fixtures.some((f) => f.homeTeamId === teamC && f.awayTeamId === teamD),
        'edition-wide: a fixture not involving the subject is present'
      );
    });
  });

  it('excludes an edition the subject did not play in-window (even if others did)', async () => {
    await withConnection(FEATURE_ROLE, async (tx) => {
      const fixtures = await readEditionRankingFixtures(tx, [teamA], DB_AS_OF);
      assert.ok(
        !fixtures.some((f) => f.competitionEditionId === editionOther),
        'editionOther is not selected: subject A only played it outside the window'
      );
    });
  });

  it('feeds bands that make A a giant-killer input end-to-end', async () => {
    await withConnection(FEATURE_ROLE, async (tx) => {
      const fixtures = await readEditionRankingFixtures(tx, [teamA], DB_AS_OF);
      const ranked = rankEditionFixtures(fixtures);
      // A’s edition-main fixture exists and is band-annotated (opponent B had 0
      // games before it, so the band is null here — a real, leak-free result).
      const aHistory = ranked.get(teamA);
      assert.ok(aHistory, 'A has a ranked history');
      assert.ok(aHistory!.fixtures.length >= 1);
    });
  });
});
