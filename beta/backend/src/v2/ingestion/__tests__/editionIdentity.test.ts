// ─────────────────────────────────────────────────────────────────────────────
// F-1 — COMPETITION EDITION IDENTITY
//
// The defect these pin: `seasonPeriod` took the fixture's kickoff and used it
// whenever `season.name` failed to parse. `season.name` is prose — "Brasileiro
// Serie A 2026" — so it always failed, every fixture derived a period from ITS
// OWN date, and the resolver's conflict target WAS that period. One provider
// season therefore became two editions when its fixtures straddled 1 July.
//
// And the mirror, which is worse and which no single season can reveal: two
// provider seasons of a calendar-year league derive OVERLAPPING periods, so the
// 2025 season's second half and the 2026 season's first half resolve to the same
// edition row.
//
// Both close the same way — resolve on the provider season id, date from
// `season.year`, and never from a fixture. The first half of that is testable
// without a database and is where the regression lives.
// ─────────────────────────────────────────────────────────────────────────────

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { seasonPeriod } from '../stages/schedule';
import { resolveCompetitionEdition } from '../entities/reference';
import { IngestionCounts } from '../write/index';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { writeEvents } from './support/replay';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

// ─────────────────────────────────────────────────────────────────────────────
// The derivation — pure
// ─────────────────────────────────────────────────────────────────────────────

describe('F-1 · a season is dated from its own year token', () => {
  it('1. a four-digit calendar season', () => {
    assert.deepEqual(seasonPeriod('2026'), { startsOn: '2026-01-01', endsOn: '2027-01-01' });
    assert.deepEqual(seasonPeriod('2015'), { startsOn: '2015-01-01', endsOn: '2016-01-01' });
  });

  it('2. a split season, in every shape the provider writes', () => {
    const expected = { startsOn: '2020-07-01', endsOn: '2021-07-01' };
    // `20/21` is the form in the captured season list for competition 325.
    assert.deepEqual(seasonPeriod('20/21'), expected);
    assert.deepEqual(seasonPeriod('2020/21'), expected);
    assert.deepEqual(seasonPeriod('2020/2021'), expected);
    assert.deepEqual(seasonPeriod('2020-21'), expected);
    assert.deepEqual(seasonPeriod('2020–21'), expected, 'en dash');
    assert.deepEqual(seasonPeriod(' 20 / 21 '), expected, 'whitespace');
  });

  it('3. the two-digit pivot puts 99/00 in the last century, not the next', () => {
    assert.deepEqual(seasonPeriod('99/00'), { startsOn: '1999-07-01', endsOn: '2000-07-01' });
  });

  it('4. THE F-1 REGRESSION — the same season yields the same period, always', () => {
    // The old signature was seasonPeriod(label, kickoff). There is no kickoff to
    // pass now, which is the fix: a period that cannot see a fixture cannot
    // differ between two fixtures of one season.
    assert.equal(seasonPeriod.length, 1, 'exactly one parameter, and it is not a date');
    const may = seasonPeriod('2026');
    const august = seasonPeriod('2026');
    assert.deepEqual(may, august);
    assert.deepEqual(may, { startsOn: '2026-01-01', endsOn: '2027-01-01' });
  });

  it('5. consecutive calendar seasons do not overlap — the F-1b regression', () => {
    const y2025 = seasonPeriod('2025')!;
    const y2026 = seasonPeriod('2026')!;
    assert.equal(y2025.endsOn, y2026.startsOn, 'adjacent, never overlapping');
    assert.notDeepEqual(y2025, y2026);
  });

  it('6. an uninterpretable year token is REFUSED, never guessed', () => {
    for (const token of [
      'Brasileiro Serie A 2026', // the prose the old code parsed — `name`, not `year`
      'Apertura',
      '',
      '   ',
      '26',                      // a lone two-digit year is ambiguous
      '2025/2027',               // not one year boundary
      '2026/2025',               // backwards
      '2026/',
      '20/21/22',
    ]) {
      assert.equal(seasonPeriod(token), null, JSON.stringify(token));
    }
    assert.equal(seasonPeriod(null), null);
    assert.equal(seasonPeriod(undefined), null);
  });

  it('7. a sponsor year inside prose is not mistaken for the season', () => {
    // The trap in the tempting one-line fix: extract any four digits from the
    // label. "Copa 2000 Trophy 2026" has two candidates and no rule to choose.
    assert.equal(seasonPeriod('Copa 2000 Trophy 2026'), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The resolver — against a real database
// ─────────────────────────────────────────────────────────────────────────────

describe('F-1 · edition resolution (requires a V2 database)', { skip: !hasDatabase }, () => {
  const PREFIX = 'F1TEST';

  after(async () => {
    await closeAllPools();
  });

  async function scenario(fn: (tx: PoolClient) => Promise<void>): Promise<void> {
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      await tx.query('BEGIN');
      try {
        await fn(tx);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  /** A competition to hang editions from. */
  async function competition(tx: PoolClient, suffix = '1'): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO football.competition (provider_code, provider_external_id, name, slug)
       VALUES ('SPORTSAPI_API', $1, $2, $3)
       ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text`,
      [`${PREFIX}-C${suffix}`, `F1 League ${suffix}`, `f1-league-${suffix}-${PREFIX.toLowerCase()}`]
    );
    return rows[0].id;
  }

  const edition = (
    tx: PoolClient,
    competitionId: string,
    externalId: string,
    label: string,
    startsOn: string,
    endsOn: string
  ): Promise<string> =>
    resolveCompetitionEdition(
      tx,
      competitionId,
      { externalId, label, startsOn, endsOn },
      new IngestionCounts()
    );

  it('8. repeated resolution of one provider season returns the same edition', async () => {
    await scenario(async (tx) => {
      const c = await competition(tx);
      const first = await edition(tx, c, `${PREFIX}-S1`, 'Season 2026', '2026-01-01', '2027-01-01');
      const again = await edition(tx, c, `${PREFIX}-S1`, 'Season 2026', '2026-01-01', '2027-01-01');
      assert.equal(again, first);
      assert.equal(await editionCount(tx, c), 1);
    });
  });

  it('9. two different provider seasons never collapse into one edition', async () => {
    await scenario(async (tx) => {
      const c = await competition(tx);
      const y2025 = await edition(tx, c, `${PREFIX}-S25`, '2025', '2025-01-01', '2026-01-01');
      const y2026 = await edition(tx, c, `${PREFIX}-S26`, '2026', '2026-01-01', '2027-01-01');
      assert.notEqual(y2025, y2026);
      assert.equal(await editionCount(tx, c), 2);
    });
  });

  it('10. the provider alternate key is enforced by the database', async () => {
    await scenario(async (tx) => {
      const c = await competition(tx);
      await edition(tx, c, `${PREFIX}-S1`, '2026', '2026-01-01', '2027-01-01');
      // A second row for one provider season — what F-1 produced — is now
      // refused by the constraint, not merely avoided by the resolver.
      //
      // The period is deliberately NON-OVERLAPPING, so the overlap exclusion
      // cannot fire and the alternate key is the only thing that can refuse
      // this. With an overlapping period the test would pass on the wrong
      // constraint and prove nothing about F-1.
      await assert.rejects(
        () =>
          tx.query(
            `INSERT INTO football.competition_edition
               (competition_id, provider_external_id, season_label, season_period)
             VALUES ($1, $2, '2028', daterange('2028-01-01','2029-01-01'))`,
            [c, `${PREFIX}-S1`]
          ),
        (error: unknown) => {
          const failure = error as { code?: string; constraint?: string };
          assert.equal(failure.code, '23505', 'unique violation');
          assert.equal(failure.constraint, 'uq_competition_edition__provider_external_id');
          return true;
        }
      );
    });
  });

  it('10a. one season cannot be re-parented to a second competition, silently or otherwise', async () => {
    // The consequence of Decision 1: UNIQUE (provider_external_id), matching
    // venue and official rather than the two-column form. The narrower
    // (competition_id, provider_external_id) form would have accepted a second
    // row here. The global form makes it a conflict — and because the resolver
    // upserts, the conflict would otherwise RESOLVE to the first edition and
    // repoint it, moving every fixture, standing and statistic of one
    // competition under another without a word.
    await scenario(async (tx) => {
      const a = await competition(tx, 'A');
      const b = await competition(tx, 'B');
      const first = await edition(tx, a, `${PREFIX}-SHARED`, '2026', '2026-01-01', '2027-01-01');

      await assert.rejects(
        () => edition(tx, b, `${PREFIX}-SHARED`, '2026', '2026-01-01', '2027-01-01'),
        /already belongs to competition .* provider identity anomaly/s
      );

      const { rows } = await tx.query<{ competition_id: string; n: string }>(
        `SELECT competition_id::text, count(*) OVER ()::text AS n
           FROM football.competition_edition WHERE provider_external_id = $1`,
        [`${PREFIX}-SHARED`]
      );
      assert.equal(rows.length, 1, 'one edition, not two');
      assert.equal(rows[0].competition_id, a, 'and it did NOT move to the second competition');
      assert.equal(first, rows[0] && first, 'the original edition is untouched');
    });
  });

  it('11. the existing business key is intact and still enforced', async () => {
    await scenario(async (tx) => {
      const c = await competition(tx);
      await edition(tx, c, `${PREFIX}-S1`, '2026', '2026-01-01', '2027-01-01');
      // Same competition, same period, a DIFFERENT provider season. The
      // business key must still refuse it.
      await assert.rejects(
        () =>
          tx.query(
            `INSERT INTO football.competition_edition
               (competition_id, provider_external_id, season_label, season_period)
             VALUES ($1, $2, '2026 again', daterange('2026-01-01','2027-01-01'))`,
            [c, `${PREFIX}-S1-OTHER`]
          ),
        (error: unknown) => {
          const failure = error as { code?: string; constraint?: string };
          // Either the business key or the overlap exclusion may fire first;
          // both are the guarantee this test exists to prove is still there.
          assert.ok(
            failure.constraint === 'uq_competition_edition__competition_period' ||
              failure.constraint === 'ex_competition_edition__periods_do_not_overlap',
            `unexpected constraint: ${failure.constraint}`
          );
          return true;
        }
      );
    });
  });

  it('12. an edition with no provider season id is refused before it is written', async () => {
    await scenario(async (tx) => {
      const c = await competition(tx);
      await assert.rejects(
        () =>
          resolveCompetitionEdition(
            tx,
            c,
            { externalId: null, label: '2026', startsOn: '2026-01-01', endsOn: '2027-01-01' },
            new IngestionCounts()
          ),
        /requires a provider season id/
      );
      assert.equal(await editionCount(tx, c), 0);
    });
  });

  it('13. season_period is immutable once established', async () => {
    await scenario(async (tx) => {
      const c = await competition(tx);
      const id = await edition(tx, c, `${PREFIX}-S1`, '2026', '2026-01-01', '2027-01-01');
      // A later resolution offering a different period must not move it: the
      // period is half the business key, and LC-02 forbids reassigning identity.
      await edition(tx, c, `${PREFIX}-S1`, '2026 revised', '2026-07-01', '2027-07-01');

      const { rows } = await tx.query<{ period: string; label: string }>(
        `SELECT season_period::text AS period, season_label AS label
           FROM football.competition_edition WHERE id = $1`,
        [id]
      );
      assert.equal(rows[0].period, '[2026-01-01,2027-01-01)', 'the period did not move');
      assert.equal(rows[0].label, '2026 revised', 'but the label, which is not identity, did');
      // AND THERE IS STILL ONE ROW. This is F-1 at the resolver level, stripped
      // of the derivation: one season offered under two periods. With the old
      // conflict target the second offer missed and inserted.
      assert.equal(await editionCount(tx, c), 1, 'one season, one edition, two periods offered');
    });
  });

  it('13a. `season.year` wins when the two fields disagree', async () => {
    // Decision 2's ordering, pinned. If both fields parse, `year` is the machine
    // field and decides. Preferring `name` — the original code's order — would
    // date this calendar season as a split one.
    await scenario(async (tx) => {
      const event = brazilEvent('F1-DISAGREE', Date.UTC(2026, 4, 31, 14, 0));
      (event.season as Record<string, unknown>).year = '2026';
      (event.season as Record<string, unknown>).name = '2025/2026';
      await writeEvents(tx, [event], 'disagree');

      const { rows } = await tx.query<{ period: string; label: string }>(
        `SELECT season_period::text AS period, season_label AS label
           FROM football.competition_edition WHERE provider_external_id = $1`,
        [`${PREFIX}-S26`]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].period, '[2026-01-01,2027-01-01)', 'dated from year, not from name');
      assert.equal(rows[0].label, '2025/2026', 'the label is still what the provider displays');
    });
  });

  it('14. a season straddling 1 July resolves to ONE edition — the F-1 regression', async () => {
    // Through the whole stage, with events shaped as the provider sends them:
    // `season.name` is prose and `season.year` is "2026", one fixture in May and
    // one in August. The old code derived two periods and wrote two editions.
    await scenario(async (tx) => {
      await writeEvents(
        tx,
        [
          brazilEvent('F1-MAY', Date.UTC(2026, 4, 31, 14, 0)),
          brazilEvent('F1-AUG', Date.UTC(2026, 7, 9, 22, 30)),
        ],
        'f1-straddle'
      );

      const { rows } = await tx.query<{ n: string; period: string }>(
        `SELECT count(*)::text AS n, min(ce.season_period::text) AS period
           FROM football.competition_edition ce
           JOIN football.competition c ON c.id = ce.competition_id
          WHERE c.provider_external_id = $1`,
        [`${PREFIX}-BRA`]
      );
      assert.equal(rows[0].n, '1', 'one provider season is one edition');
      assert.equal(rows[0].period, '[2026-01-01,2027-01-01)', 'dated from season.year, not a kickoff');
    });
  });

  it('15. two provider seasons of one competition stay separate — the F-1b regression', async () => {
    await scenario(async (tx) => {
      await writeEvents(
        tx,
        [
          // 2025 season, second half — the old code derived [2025-07-01, 2026-07-01)
          brazilEvent('F1-25B', Date.UTC(2025, 10, 2, 20, 0), { id: `${PREFIX}-S25`, year: '2025' }),
          // 2026 season, first half — the old code derived THE SAME period
          brazilEvent('F1-26A', Date.UTC(2026, 4, 31, 14, 0), { id: `${PREFIX}-S26`, year: '2026' }),
        ],
        'f1b'
      );

      const { rows } = await tx.query<{ ext: string; period: string }>(
        `SELECT ce.provider_external_id AS ext, ce.season_period::text AS period
           FROM football.competition_edition ce
           JOIN football.competition c ON c.id = ce.competition_id
          WHERE c.provider_external_id = $1
          ORDER BY ce.season_period`,
        [`${PREFIX}-BRA`]
      );
      assert.equal(rows.length, 2, 'two provider seasons are two editions');
      assert.deepEqual(rows.map((row) => row.ext), [`${PREFIX}-S25`, `${PREFIX}-S26`]);
      assert.deepEqual(
        rows.map((row) => row.period),
        ['[2025-01-01,2026-01-01)', '[2026-01-01,2027-01-01)'],
        'adjacent, and neither derived from a fixture'
      );
    });
  });

  it('15a. `name` is a fallback only when it IS a year token, never when it is prose', async () => {
    await scenario(async (tx) => {
      // No `year`, and a name that happens to be a clean token: accepted.
      const clean = brazilEvent('F1-NOYEAR', Date.UTC(2026, 8, 1, 18, 0));
      delete (clean.season as Record<string, unknown>).year;
      (clean.season as Record<string, unknown>).name = '2026/2027';
      await writeEvents(tx, [clean], 'fallback-clean');

      const { rows } = await tx.query<{ period: string }>(
        `SELECT season_period::text AS period FROM football.competition_edition
          WHERE provider_external_id = $1`,
        [`${PREFIX}-S26`]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].period, '[2026-07-01,2027-07-01)', 'parsed as a split season');
    });
  });

  it('16. a fixture whose season cannot be dated is rejected, not silently derived', async () => {
    await scenario(async (tx) => {
      const counts = await writeEvents(
        tx,
        [brazilEvent('F1-BAD', Date.UTC(2026, 4, 31, 14, 0), { id: `${PREFIX}-SX`, year: 'Apertura' })],
        'f1-unparseable'
      );

      assert.equal(counts.total.rejected >= 1, true, 'the refusal is counted');
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM football.competition_edition
          WHERE provider_external_id = $1`,
        [`${PREFIX}-SX`]
      );
      assert.equal(rows[0].n, '0', 'no edition was invented for an undatable season');
    });
  });

  async function editionCount(tx: PoolClient, competitionId: string): Promise<number> {
    const { rows } = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM football.competition_edition WHERE competition_id = $1`,
      [competitionId]
    );
    return Number(rows[0].n);
  }

  /** An event in the shape the provider actually sends: prose name, machine year. */
  function brazilEvent(
    id: string,
    kickoffMs: number,
    season: { id: string; year: string } = { id: `${PREFIX}-S26`, year: '2026' }
  ): Record<string, unknown> {
    return {
      id: `${PREFIX}-${id}`,
      startTimestamp: Math.floor(kickoffMs / 1000),
      tournament: {
        uniqueTournament: {
          id: `${PREFIX}-BRA`,
          name: 'Brasileirão Betano',
          category: { name: 'Brazil' },
        },
      },
      // NAME IS PROSE. This is the field the old code parsed, and why it never did.
      season: { id: season.id, name: `Brasileiro Serie A ${season.year}`, year: season.year },
      roundInfo: { round: 1 },
      venue: { id: `${PREFIX}-V1`, name: 'F1 Arena', city: { name: 'Rio' }, country: { name: 'Brazil' } },
      homeTeam: { id: `${PREFIX}-H1`, name: 'F1 Home', country: { name: 'Brazil' } },
      awayTeam: { id: `${PREFIX}-A1`, name: 'F1 Away', country: { name: 'Brazil' } },
      status: { code: 100, description: 'Ended' },
      winnerCode: 1,
      homeScore: { current: 1, normaltime: 1, period1: 1 },
      awayScore: { current: 0, normaltime: 0, period1: 0 },
    };
  }
});
