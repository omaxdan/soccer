# Beta Processor Patch Spec — Read Integrity + last_5_results

## Finding P0 — systemic silent truncation in processDbOnly.ts

`fetchAllRows` (37 call sites) is the minority: **61 multiline raw
`await db.from(...)` reads bypass it**. Any of them returning >1000 rows is
silently capped by PostgREST. Confirmed corrupt at current data volumes
(verified 2026-07-10, worsening as the warehouse grows):

| Line (old backend) | Read | Corrupts |
|---|---|---|
| 253 | matches −30d..+14d (~44 days × 57 leagues, at/over cap) | congestion forward windows — future matches cut first (ascending order) |
| 1123 | ALL team_form_history for 323 teams, date desc | `form_index`, `last_5_points`, `last_10_points` for teams without very recent fixtures |
| 1165 | 90 days of matches | `active_competitions` undercount |
| 3761 | ALL team_form_history (goals) | **Poisson scoreline predictions** built from truncated goal histories |

Lines 1138/1151 (fixture/travel snapshots, desc) survive by accident —
the latest snapshot date's ~323 rows land inside the first page — but break
the day a team misses a snapshot. Treat as unsafe.

## Beta rule (non-negotiable)

Every multi-row `.select()` read goes through `fetchAllRows` (v2, ordered —
see `src/db/fetchAllRows.ts`). Raw awaits are allowed only for:
single-row reads (`.single()` / `.maybeSingle()`), explicitly `.limit(n)`'d
reads where n < 1000 by design, and writes (insert/upsert/update/delete/rpc).

Enforce with ESLint `no-restricted-syntax` on
`AwaitExpression > CallExpression[callee.object.callee.property.name='select']`
or, simpler, a CI grep: any `await db` followed by `.select(` outside
`fetchAllRows(`, `.single(`, `.maybeSingle(`, `.limit(` fails the build.

## Patch — team intelligence form read (old line ~1122)

```ts
// BEFORE (raw, truncated, points only)
const { data: formRecords, error: fErr } = await db
  .from('team_form_history')
  .select('team_id, points, match_date')
  .in('team_id', teamIds)
  .order('match_date', { ascending: false });

// AFTER (paginated + carries result letters for last_5_results)
const formRecords = await fetchAllRows(
  db.from('team_form_history')
    .select('team_id, points, result, match_date')
    .in('team_id', teamIds)
    .order('match_date', { ascending: false })
);
```

Map carries both facts now:

```ts
const formByTeam = new Map<number, { points: number; result: string }[]>();
for (const f of formRecords || []) {
  if (!formByTeam.has(f.team_id)) formByTeam.set(f.team_id, []);
  formByTeam.get(f.team_id)!.push({ points: f.points ?? 0, result: f.result });
}
```

Per-team loop (old lines ~1290–1294):

```ts
const rows5   = (formByTeam.get(teamId) || []).slice(0, 5);
const rows10  = (formByTeam.get(teamId) || []).slice(0, 10);
const last5Points  = rows5.reduce((s, r) => s + r.points, 0);
const last10Points = rows10.reduce((s, r) => s + r.points, 0);
const last5Results = rows5
  .map(r => r.result)
  .filter(r => r === 'W' || r === 'D' || r === 'L')
  .join('') || null;   // most recent first, e.g. 'WWDLW'
```

Output row gains one field:

```ts
last_5_results: last5Results,
```

Requires migration 023 Part D. After deploying, run
`process:team-intelligence` once to backfill all 323 teams.

## Patch — player_match_load atomic replace (old lines 197–198)

```ts
// BEFORE: two transactions, empty-table window, non-atomic
await db.from('player_match_load').delete().neq('id', 0);
const { error } = await db.from('player_match_load').insert(rows);

// AFTER: one transaction (migration 024)
const { error } = await db.rpc('replace_player_match_load', { p_rows: rows });
```

## Verification after first beta processor run

```sql
-- Every tracked team with form history has pills:
SELECT count(*) FROM team_intelligence
WHERE last_5_points IS NOT NULL AND last_5_results IS NULL;  -- expect 0

-- Spot-check truncation recovery: teams whose last fixture is >30 days old
-- should now have non-null form_index (previously nulled by the cap).
```
