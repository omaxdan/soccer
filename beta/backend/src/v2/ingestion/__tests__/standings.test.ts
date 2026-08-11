// ─────────────────────────────────────────────────────────────────────────────
// STANDINGS — the first coverage `recordStandings` has ever had
//
// It was written, documented, given a deliberate per-row rejection rule, and
// then left with no caller and no test. Doc 35 named it an "uncalled writer"
// alongside squad.ts; squad.ts got wired, this did not.
//
// The fixture is the REAL captured table (Step A, sha256 15205f21e393): twenty
// rows, positions 1–20, no variant label and no date. Tests that need a
// pathological row build one, because the provider sent none.
// ─────────────────────────────────────────────────────────────────────────────

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';

import {
  OBSERVED_VARIANT,
  ingestStandings,
  interpretStandings,
  type RawStandingRow,
} from '../stages/standings';
import { recordStandings } from '../entities/standings';
import { IngestionCounts } from '../write/index';
import { PROVIDER_CODE } from '../provider/config';
import { EVIDENCE_DIR } from '../discover';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

const CAPTURE = join(EVIDENCE_DIR, 'season_standings__seasonId-87678__tournamentId-325.json');
const hasCapture = existsSync(CAPTURE);
const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

/** The captured provider body, or null where the evidence is not checked out. */
function capturedBody(): { standings?: unknown } {
  return JSON.parse(readFileSync(CAPTURE, 'utf8')).body as { standings?: unknown };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the table — no database
// ─────────────────────────────────────────────────────────────────────────────

describe('standings · reading the captured table', { skip: !hasCapture }, () => {
  it('1. the real capture yields twenty complete rows and rejects nothing', () => {
    const { rows, rejected } = interpretStandings(capturedBody());
    assert.equal(rows.length, 20);
    assert.deepEqual(rejected, [], 'the provider sent nothing uninterpretable');
    assert.deepEqual(
      [...rows].map((row) => row.position).sort((a, b) => a - b),
      Array.from({ length: 20 }, (_, index) => index + 1),
      'positions 1..20, one per team'
    );
    assert.equal(new Set(rows.map((row) => row.teamProviderId)).size, 20, 'one row per team');
  });

  it('2. every captured row satisfies played = won + drawn + lost', () => {
    // If this ever fails, `recordStandings` would reject the row rather than
    // send it — so this asserts the rejection path is NOT being exercised by
    // real data, which is what makes test 6 meaningful.
    for (const row of interpretStandings(capturedBody()).rows) {
      assert.equal(row.played, row.won + row.drawn + row.lost, `team ${row.teamProviderId}`);
    }
  });

  it('3. teamName is read and discarded — it is not identity', () => {
    const rows = interpretStandings(capturedBody()).rows;
    for (const row of rows) {
      assert.ok(!('teamName' in row), 'no display string survives interpretation');
    }
    // And the captured payload really does carry one, so this is not vacuous.
    const raw = capturedBody().standings as Record<string, unknown>[];
    assert.ok(typeof raw[0].teamName === 'string' && raw[0].teamName.length > 0);
  });

  it('4. the observed variant is TOTAL, and nothing else is manufactured', () => {
    assert.equal(OBSERVED_VARIANT, 'TOTAL');
    // The capture carries no grouping and no label; HOME and AWAY must not
    // appear anywhere in this stage.
    const source = readFileSync(join(__dirname, '..', 'stages', 'standings.ts'), 'utf8');
    const executable = source
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'));
    assert.ok(
      !executable.some((line) => /'HOME'|'AWAY'/.test(line)),
      'no HOME or AWAY variant is constructed'
    );
  });
});

describe('standings · rows the provider did not send', () => {
  const good = {
    teamId: 1963, teamName: 'Palmeiras', position: 1,
    played: 22, won: 14, drawn: 6, lost: 2, goalsFor: 38, goalsAgainst: 16, points: 48,
  };

  it('5. a row without a team id is refused, with a reason', () => {
    const { rows, rejected } = interpretStandings({ standings: [{ ...good, teamId: null }] });
    assert.equal(rows.length, 0);
    assert.match(rejected[0], /no teamId/);
  });

  it('6. a negative count is refused rather than left to the CHECK', () => {
    const { rows, rejected } = interpretStandings({ standings: [{ ...good, won: -1 }] });
    assert.equal(rows.length, 0);
    assert.match(rejected[0], /lacks won/);
  });

  it('7. a missing figure is refused, and the reason names it', () => {
    const { rows, rejected } = interpretStandings({ standings: [{ ...good, points: undefined }] });
    assert.equal(rows.length, 0);
    assert.match(rejected[0], /lacks points/);
  });

  it('8. a non-object entry is refused rather than crashing the table', () => {
    const { rows, rejected } = interpretStandings({ standings: ['nonsense', 42, null, good] });
    assert.equal(rows.length, 1, 'the one good row still survives');
    assert.equal(rejected.length, 3);
  });

  it('9. an absent or non-array standings key yields nothing, not a throw', () => {
    assert.deepEqual(interpretStandings({}).rows, []);
    assert.deepEqual(interpretStandings({ standings: 'not an array' }).rows, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Writing — against a real database
// ─────────────────────────────────────────────────────────────────────────────

describe('standings · the writer (requires a V2 database)', { skip: !hasDatabase }, () => {
  const PREFIX = 'STTEST';
  const AS_OF = '2026-08-11';

  after(async () => {
    await closeAllPools();
  });

  async function scenario(fn: (tx: PoolClient, edition: string, teams: string[]) => Promise<void>) {
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      await tx.query('BEGIN');
      try {
        const { rows: comp } = await tx.query<{ id: string }>(
          `INSERT INTO football.competition (provider_code, provider_external_id, name, slug)
           VALUES ($1, $2, 'Standings League', $3)
           ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name = EXCLUDED.name
           RETURNING id::text`,
          [PROVIDER_CODE, `${PREFIX}-C`, `standings-league-${PREFIX.toLowerCase()}`]
        );
        const { rows: ed } = await tx.query<{ id: string }>(
          `INSERT INTO football.competition_edition
             (competition_id, provider_external_id, season_label, season_period)
           VALUES ($1, $2, '2026', daterange('2026-01-01','2027-01-01'))
           ON CONFLICT (provider_external_id) DO UPDATE SET season_label = EXCLUDED.season_label
           RETURNING id::text`,
          [comp[0].id, `${PREFIX}-S`]
        );
        const teams: string[] = [];
        for (let i = 0; i < 20; i++) {
          const { rows } = await tx.query<{ id: string }>(
            `INSERT INTO football.team (provider_code, provider_external_id, name, slug)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name = EXCLUDED.name
             RETURNING id::text`,
            [PROVIDER_CODE, `${PREFIX}-T${i}`, `Team ${i}`, `${PREFIX.toLowerCase()}-t${i}`]
          );
          teams.push(rows[0].id);
        }
        await fn(tx, ed[0].id, teams);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  /** A full table over the seeded teams, mirroring the captured shape. */
  const table = (teams: readonly string[]) =>
    teams.map((teamId, index) => ({
      teamId,
      position: index + 1,
      played: 22,
      won: 20 - index,
      drawn: 0,
      lost: 2 + index,
      goalsFor: 40 - index,
      goalsAgainst: 10 + index,
      points: (20 - index) * 3,
    }));

  const standingRows = async (tx: PoolClient, edition: string) => {
    const { rows } = await tx.query<{
      standing_variant: string; as_of_on: string; position: number; points: number;
    }>(
      `SELECT standing_variant, to_char(as_of_on,'YYYY-MM-DD') AS as_of_on, position, points
         FROM football.standing WHERE competition_edition_id = $1 ORDER BY position`,
      [edition]
    );
    return rows;
  };

  it('10. a twenty-row TOTAL table is written, and reports 20 written / 0 skipped', async () => {
    await scenario(async (tx, edition, teams) => {
      const counts = new IngestionCounts();
      await recordStandings(tx, edition, 'TOTAL', AS_OF, table(teams), counts);

      assert.equal(counts.written, 20);
      assert.equal(counts.skipped, 0);
      assert.equal(counts.rejected, 0);

      const rows = await standingRows(tx, edition);
      assert.equal(rows.length, 20);
      assert.ok(rows.every((row) => row.standing_variant === 'TOTAL'));
      assert.ok(rows.every((row) => row.as_of_on === AS_OF), 'one as-of date for the whole table');
    });
  });

  it('11. an identical second write reports 0 written / 20 skipped — append-only idempotency', async () => {
    // Unlike fixtures, this is honestly reportable from telemetry alone:
    // insertAppendOnly uses ON CONFLICT DO NOTHING and derives skipped from what
    // it offered. F-3 does not reach this relation.
    await scenario(async (tx, edition, teams) => {
      const first = new IngestionCounts();
      await recordStandings(tx, edition, 'TOTAL', AS_OF, table(teams), first);

      const second = new IngestionCounts();
      await recordStandings(tx, edition, 'TOTAL', AS_OF, table(teams), second);

      assert.equal(second.written, 0, 'nothing new');
      assert.equal(second.skipped, 20, 'and every row accounted for');
      assert.equal((await standingRows(tx, edition)).length, 20, 'still twenty rows');
    });
  });

  it('12. a later as-of date is a NEW snapshot, not a duplicate', async () => {
    // The append-only consequence of the as_of_on decision, made explicit so a
    // second table on another day is not read as corruption.
    await scenario(async (tx, edition, teams) => {
      await recordStandings(tx, edition, 'TOTAL', AS_OF, table(teams), new IngestionCounts());
      const later = new IngestionCounts();
      await recordStandings(tx, edition, 'TOTAL', '2026-08-18', table(teams), later);

      assert.equal(later.written, 20);
      assert.equal((await standingRows(tx, edition)).length, 40, 'two snapshots, both retained');
    });
  });

  it('13. an inconsistent row is rejected PER ROW, and the rest of the table lands', async () => {
    await scenario(async (tx, edition, teams) => {
      const rows = table(teams);
      const broken = [...rows];
      broken[5] = { ...broken[5], played: 99 }; // played != won + drawn + lost

      const counts = new IngestionCounts();
      await recordStandings(tx, edition, 'TOTAL', AS_OF, broken, counts);

      assert.equal(counts.rejected, 1, 'one row refused');
      assert.equal(counts.written, 19, 'nineteen valid rows still written');
      assert.equal((await standingRows(tx, edition)).length, 19);
    });
  });

  it('14. a negative count never reaches the table', async () => {
    await scenario(async (tx, edition, teams) => {
      const rows = table(teams);
      const broken = [...rows];
      broken[0] = { ...broken[0], goalsFor: -1 };

      const counts = new IngestionCounts();
      await recordStandings(tx, edition, 'TOTAL', AS_OF, broken, counts);
      assert.equal(counts.rejected, 1);
      assert.equal(counts.written, 19);
    });
  });

  it('15. the stage resolves provider team ids and creates NO shell team', async () => {
    await scenario(async (tx, edition, teams) => {
      const before = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM football.team`);

      const response = {
        standings: [
          { teamId: `${PREFIX}-T0`, teamName: 'Ignored', position: 1, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, points: 3 },
          { teamId: `${PREFIX}-ABSENT`, teamName: 'Not Ingested', position: 2, played: 1, won: 0, drawn: 0, lost: 1, goalsFor: 0, goalsAgainst: 2, points: 0 },
        ],
      };
      const counts = await ingestStandings(tx, {
        competitionEditionId: edition,
        asOfOn: AS_OF,
        response,
      });

      assert.equal(counts.total.written, 1, 'only the resolvable team is written');
      assert.equal(counts.total.rejected, 1, 'and the unresolved one is counted');
      const after = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM football.team`);
      assert.equal(after.rows[0].n, before.rows[0].n, 'no shell team was created');

      const rows = await standingRows(tx, edition);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].standing_variant, 'TOTAL');

      // The written row belongs to the team the PROVIDER id resolved to — not to
      // anything derived from teamName.
      const { rows: owner } = await tx.query<{ provider_external_id: string }>(
        `SELECT t.provider_external_id FROM football.standing s
           JOIN football.team t ON t.id = s.team_id
          WHERE s.competition_edition_id = $1`,
        [edition]
      );
      assert.equal(owner[0].provider_external_id, `${PREFIX}-T0`);
      assert.equal(teams.length, 20);
    });
  });

  it('16. the stage attributes its writes to football.standing', async () => {
    await scenario(async (tx, edition, teams) => {
      const response = {
        standings: [{
          teamId: `${PREFIX}-T1`, position: 1, played: 1, won: 1, drawn: 0, lost: 0,
          goalsFor: 1, goalsAgainst: 0, points: 3,
        }],
      };
      const counts = await ingestStandings(tx, {
        competitionEditionId: edition,
        asOfOn: AS_OF,
        response,
      });
      assert.deepEqual([...counts.byRelation.keys()], ['football.standing']);
      assert.equal(teams.length, 20);
    });
  });

  it('17. the real captured table writes end to end when its teams exist', { skip: !hasCapture }, async () => {
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      await tx.query('BEGIN');
      try {
        const { rows: comp } = await tx.query<{ id: string }>(
          `INSERT INTO football.competition (provider_code, provider_external_id, name, slug)
           VALUES ($1, $2, 'Capture League', $3)
           ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name = EXCLUDED.name
           RETURNING id::text`,
          [PROVIDER_CODE, `${PREFIX}-CAP`, `capture-league-${PREFIX.toLowerCase()}`]
        );
        const { rows: ed } = await tx.query<{ id: string }>(
          `INSERT INTO football.competition_edition
             (competition_id, provider_external_id, season_label, season_period)
           VALUES ($1, $2, '2026', daterange('2026-01-01','2027-01-01'))
           ON CONFLICT (provider_external_id) DO UPDATE SET season_label = EXCLUDED.season_label
           RETURNING id::text`,
          [comp[0].id, `${PREFIX}-CAPS`]
        );

        // Seed exactly the twenty teams the capture names.
        const captured = interpretStandings(capturedBody()).rows as RawStandingRow[];
        for (const row of captured) {
          await tx.query(
            `INSERT INTO football.team (provider_code, provider_external_id, name, slug)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider_code, provider_external_id) DO NOTHING`,
            [PROVIDER_CODE, row.teamProviderId, `Team ${row.teamProviderId}`, `cap-${row.teamProviderId}`]
          );
        }

        const counts = await ingestStandings(tx, {
          competitionEditionId: ed[0].id,
          asOfOn: AS_OF,
          response: capturedBody(),
        });

        assert.equal(counts.total.written, 20, 'the real table writes twenty rows');
        assert.equal(counts.total.rejected, 0);
        assert.equal(counts.total.skipped, 0);

        const { rows } = await tx.query<{ n: string; variants: string; dates: string }>(
          `SELECT count(*)::text AS n,
                  string_agg(DISTINCT standing_variant, ',') AS variants,
                  string_agg(DISTINCT to_char(as_of_on,'YYYY-MM-DD'), ',') AS dates
             FROM football.standing WHERE competition_edition_id = $1`,
          [ed[0].id]
        );
        assert.equal(rows[0].n, '20');
        assert.equal(rows[0].variants, 'TOTAL', 'no HOME or AWAY row exists');
        assert.equal(rows[0].dates, AS_OF, 'one as-of date established once for the run');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });
});
