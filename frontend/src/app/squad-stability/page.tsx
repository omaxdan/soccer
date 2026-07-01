import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { teamUrl } from '@/lib/urls';

export const metadata = { title: 'Squad Stability' };
export const revalidate = 3600;

export default async function SquadStabilityPage() {
  const { data: snapshots } = await supabase
    .from('team_squads_snapshot')
    .select('team_id, players_count, avg_age, foreign_players_count, domestic_players_count, injured_player_count, foreign_player_pct, injured_player_pct, average_market_value, snapshot_date, team:teams!team_id(id, name, slug, country)')
    .order('snapshot_date', { ascending: false })
    .limit(100);

  // NOTE: positional_depth_score, retention_percentage, transfer_activity_score
  // were dropped from team_intelligence in migration 007 — they were
  // duplicates of team_position_depth / team_transfer_intelligence
  // respectively. squad_depth_score and squad_stability_score remain (they
  // are genuine synthesized intelligence outputs, not raw-data copies).
  const { data: intel } = await supabase
    .from('team_intelligence')
    .select('team_id, squad_stability_score, squad_depth_score');

  const { data: transferIntel } = await supabase
    .from('team_transfer_intelligence')
    .select('team_id, retention_percentage, transfer_activity_score');

  const intelMap = new Map((intel ?? []).map((t: any) => [t.team_id, t]));
  const transferMap = new Map((transferIntel ?? []).map((t: any) => [t.team_id, t]));
  const latest = new Map<number, any>();
  for (const s of snapshots ?? []) {
    if (!latest.has(s.team_id)) latest.set(s.team_id, s);
  }
  const rows = Array.from(latest.values()).sort((a, b) => (b.players_count ?? 0) - (a.players_count ?? 0));

  // TODO: the 4 stat cards below still aggregate via .reduce() at request
  // time. Lower severity than the per-row percentage fix (no business
  // judgment encoded, just sums/averages of already-correct numbers) but
  // should still move into platform_daily_summary or a dedicated summary
  // table per the "no calculations at runtime" rule — flagged, not yet done.

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Squad Stability</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>
          {rows.length} teams with squad snapshots · Sync more with sync:squads:v2
        </div>
      </div>

      <div className="grid-4">
        {[
          { label: 'TEAMS SYNCED', value: rows.length, col: 'var(--blue)' },
          { label: 'TOTAL PLAYERS', value: rows.reduce((s, r) => s + (r.players_count ?? 0), 0), col: 'var(--text)' },
          { label: 'TOTAL INJURED', value: rows.reduce((s, r) => s + (r.injured_player_count ?? 0), 0), col: 'var(--red)' },
          { label: 'AVG SQUAD SIZE', value: rows.length ? Math.round(rows.reduce((s, r) => s + (r.players_count ?? 0), 0) / rows.length) : 0, col: 'var(--green)' },
        ].map(c => (
          <div key={c.label} className="card">
            <div className="section-label" style={{ marginBottom: 6 }}>{c.label}</div>
            <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: c.col }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>TEAM</th>
              <th>PLAYERS</th>
              <th>AVG AGE</th>
              <th>FOREIGN</th>
              <th>INJURED</th>
              <th>AVG MARKET VAL</th>
              <th>SNAPSHOT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s: any) => (
              <tr key={s.team_id}>
                <td>
                  <Link href={teamUrl(s.team)} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                    {(s.team as any)?.name ?? '—'}
                  </Link>
                  <div style={{ fontSize: 10, color: 'var(--dim)' }}>{(s.team as any)?.country}</div>
                </td>
                <td className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{s.players_count ?? '—'}</td>
                <td className="mono" style={{ fontSize: 12 }}>{s.avg_age ? Number(s.avg_age).toFixed(1) : '—'}</td>
                <td>
                  <span style={{ fontSize: 11, color: 'var(--blue)' }}>
                    {s.foreign_players_count ?? '—'}
                    {s.foreign_player_pct != null ? ` (${s.foreign_player_pct}%)` : ''}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: 11, color: (s.injured_player_count ?? 0) > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
                    {s.injured_player_count ?? 0}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {s.average_market_value ? `€${(s.average_market_value / 1000000).toFixed(1)}M` : '—'}
                </td>
                <td style={{ fontSize: 10, color: 'var(--dim)' }}>{s.snapshot_date}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)' }}>
                Run sync:squads:v2 first
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
