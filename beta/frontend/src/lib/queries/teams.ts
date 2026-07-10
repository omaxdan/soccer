import { supabase } from '../supabase';

/**
 * getTeamIntelligenceList — beta rewrite.
 *
 * V1 issued 5 queries; two of them (team_form_history, team_travel_load for
 * ALL tracked teams) exceeded PostgREST's silent 1000-row cap, so form pills
 * and travel figures were wrong for any team without a very recent fixture.
 *
 * V2 collapses to 3 bounded queries, none of which can exceed ~350 rows:
 *   1. team_intelligence     — one row per team; now carries last_5_results
 *                              (migration 023) and travel_load_km, so the
 *                              form-history and travel-load queries are gone.
 *   2. tournament_standings  — one row per team.
 *   3. team_intelligence_history — scoped to a SINGLE snapshot date (the
 *                              most recent one ≥5 days old), found first with
 *                              a 1-row query. One row per team, bounded.
 *
 * Rule going forward: list endpoints read only precomputed one-row-per-team
 * tables. Anything needing "N rows per team across all teams" must be
 * precomputed by the pipeline — PostgREST cannot express per-group limits
 * and the row cap makes the naive query silently wrong.
 */

export interface TeamIntelRow {
  id: number;
  name: string;
  short_name: string | null;
  slug: string | null;
  country: string | null;
  crest_storage_path: string | null;
  league: string | null;
  position: number | null;
  readiness_score: number | null;
  form_index: number | null;
  congestion_score: number | null;
  rest_days_avg: number | null;
  active_competitions: number | null;
  travel_14d: number | null;
  form_pills: ('W' | 'D' | 'L')[];
  trend_7d: number | null;
}

export async function getTeamIntelligenceList(
  trackedTeamIds: number[]
): Promise<TeamIntelRow[]> {
  const q = supabase
    .from('team_intelligence')
    .select(
      `team_id, readiness_score, form_index, congestion_score, rest_days_avg,
       active_competitions, travel_load_km, last_5_results,
       team:teams!team_id(id, name, short_name, slug, country, crest_storage_path)`
    )
    .not('readiness_score', 'is', null)
    .order('readiness_score', { ascending: false });
  if (trackedTeamIds.length > 0) q.in('team_id', trackedTeamIds);

  const { data: intelRows, error } = await q;
  if (error) throw error;
  if (!intelRows || intelRows.length === 0) return [];

  const ids = intelRows.map((r: any) => r.team_id);

  // Trend baseline: the single most recent snapshot date that is ≥5 days
  // old. Two-step keeps the second query bounded at one row per team.
  const cutoff = new Date(Date.now() - 5 * 86400000)
    .toISOString()
    .split('T')[0];

  const [standingsRes, baselineDateRes] = await Promise.all([
    supabase
      .from('tournament_standings')
      .select('team_id, position, tournament:tournaments(name)')
      .in('team_id', ids),
    supabase
      .from('team_intelligence_history')
      .select('snapshot_date')
      .lte('snapshot_date', cutoff)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (standingsRes.error) throw standingsRes.error;

  const standingsMap = new Map<
    number,
    { position: number | null; league: string | null }
  >();
  for (const s of standingsRes.data ?? []) {
    if (!standingsMap.has(s.team_id)) {
      standingsMap.set(s.team_id, {
        position: s.position ?? null,
        league: (s.tournament as any)?.name ?? null,
      });
    }
  }

  const trendMap = new Map<number, number | null>();
  const baselineDate = baselineDateRes.data?.snapshot_date ?? null;
  if (baselineDate) {
    const { data: baseline, error: bErr } = await supabase
      .from('team_intelligence_history')
      .select('team_id, readiness_score')
      .eq('snapshot_date', baselineDate)
      .in('team_id', ids);
    if (bErr) throw bErr;
    const baseMap = new Map(
      (baseline ?? []).map((b: any) => [b.team_id, b.readiness_score])
    );
    for (const r of intelRows as any[]) {
      const prev = baseMap.get(r.team_id);
      trendMap.set(
        r.team_id,
        prev != null && r.readiness_score != null
          ? Math.round((r.readiness_score - prev) * 10) / 10
          : null
      );
    }
  }

  return (intelRows as any[]).map((r) => {
    const standing = standingsMap.get(r.team_id);
    const pills = (r.last_5_results ?? '')
      .split('')
      .filter((c: string): c is 'W' | 'D' | 'L' =>
        c === 'W' || c === 'D' || c === 'L'
      );
    return {
      id: r.team.id,
      name: r.team.name,
      short_name: r.team.short_name,
      slug: r.team.slug,
      country: r.team.country,
      crest_storage_path: r.team.crest_storage_path ?? null,
      league: standing?.league ?? null,
      position: standing?.position ?? null,
      readiness_score: r.readiness_score,
      form_index: r.form_index,
      congestion_score: r.congestion_score,
      rest_days_avg: r.rest_days_avg,
      active_competitions: r.active_competitions,
      travel_14d: r.travel_load_km ?? null,
      form_pills: pills,
      trend_7d: trendMap.get(r.team_id) ?? null,
    };
  });
}
