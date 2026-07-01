'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

function scoreClass(s: number | null) {
  if (s == null) return '#555570';
  if (s >= 85) return '#00e676';
  if (s >= 65) return '#69f0ae';
  if (s >= 45) return '#ffb300';
  if (s >= 25) return '#ff6d00';
  return '#ff1744';
}

function TeamSearch({ label, onSelect, selected }: {
  label: string;
  onSelect: (t: any) => void;
  selected: any | null;
}) {
  const [q, setQ]         = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen]   = useState(false);
  const ref               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      supabase
        .from('team_intelligence')
        .select('team_id, readiness_score, form_index, congestion_score, travel_fatigue_score, active_competitions, last_5_points, last_10_points, squad_depth_score, injury_burden_score, squad_stability_score, team:teams!team_id(id, name, short_name, country, slug)')
        .ilike('team:teams!team_id.name', `%${q}%`)
        .not('readiness_score', 'is', null)
        .limit(10)
        .then(({ data }: { data: any[] | null }) => {
          setResults(data ?? []);
          setOpen(true);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{selected.team?.name}</div>
            <div style={{ fontSize: 11, color: 'var(--dim)' }}>{selected.team?.country}</div>
          </div>
          <button
            onClick={() => { onSelect(null); setQ(''); }}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
          >×</button>
        </div>
      ) : (
        <input
          value={q}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={`Search team…`}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 14px', color: 'var(--text)',
            fontSize: 14, outline: 'none',
          }}
        />
      )}
      {open && results.length > 0 && !selected && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, marginTop: 4, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {results.map((r: any) => (
            <div
              key={r.team_id}
              onClick={() => { onSelect(r); setOpen(false); setQ(''); }}
              style={{
                padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
              className="compare-search-item"
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{r.team?.name}</div>
                <div style={{ fontSize: 11, color: 'var(--dim)' }}>{r.team?.country}</div>
              </div>
              <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 14, fontWeight: 700, color: scoreClass(r.readiness_score) }}>
                {Math.round(r.readiness_score ?? 0)}
              </div>
            </div>
          ))}
        </div>
      )}
      <style>{`.compare-search-item:hover { background: var(--surface2); }`}</style>
    </div>
  );
}

export default function ComparePage() {
  const [teamA, setTeamA] = useState<any>(null);
  const [teamB, setTeamB] = useState<any>(null);

  const metrics = [
    { label: 'Readiness Score',   key: 'readiness_score',       inverse: false },
    { label: 'Form Index',        key: 'form_index',             inverse: false },
    { label: 'Congestion Score',  key: 'congestion_score',       inverse: true },
    { label: 'Travel Fatigue',    key: 'travel_fatigue_score',   inverse: true },
    { label: 'Squad Depth',       key: 'squad_depth_score',      inverse: false, squad: true },
    { label: 'Injury Burden',     key: 'injury_burden_score',    inverse: true,  squad: true },
    { label: 'Squad Stability',   key: 'squad_stability_score',  inverse: false, squad: true },
    { label: 'Active Comps',      key: 'active_competitions',    inverse: true,  max: 5 },
    { label: 'Last 5 Pts',        key: 'last_5_points',          inverse: false, max: 15 },
    { label: 'Last 10 Pts',       key: 'last_10_points',         inverse: false, max: 30 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Team Comparison</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>Search from 400+ tracked teams</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <TeamSearch label="TEAM A" onSelect={setTeamA} selected={teamA} />
        <TeamSearch label="TEAM B" onSelect={setTeamB} selected={teamB} />
      </div>

      {teamA && teamB && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 8, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', textAlign: 'center' }}>{teamA.team?.short_name ?? teamA.team?.name}</div>
            <div style={{ fontSize: 9, color: 'var(--dim)', textAlign: 'center', alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '0.08em' }}>METRIC</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', textAlign: 'center' }}>{teamB.team?.short_name ?? teamB.team?.name}</div>
          </div>

          {metrics.map(m => {
            const rawA = teamA[m.key] as number | null;
            const rawB = teamB[m.key] as number | null;
            const aVal = rawA != null ? Math.round(rawA) : null;
            const bVal = rawB != null ? Math.round(rawB) : null;
            const max  = (m as any).max ?? 100;
            const aW   = aVal != null ? Math.min(100, (aVal / max) * 100) : 0;
            const bW   = bVal != null ? Math.min(100, (bVal / max) * 100) : 0;
            const aScore = aVal != null ? (m.inverse ? 100 - aVal : aVal) : null;
            const bScore = bVal != null ? (m.inverse ? 100 - bVal : bVal) : null;
            const aWins  = aScore != null && bScore != null && aScore > bScore;
            const bWins  = aScore != null && bScore != null && bScore > aScore;
            const isSquad = (m as any).squad;

            return (
              <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 8, padding: '10px 12px', background: 'var(--surface)', borderRadius: 8, alignItems: 'center' }}>
                {/* Team A value */}
                <div style={{ textAlign: 'center' }}>
                  {aVal != null ? (
                    <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 16, fontWeight: 700, color: aWins ? '#00e676' : 'var(--text)' }}>
                      {aVal}{(m as any).max ? `/${max}` : ''}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--dim)' }}>{isSquad ? 'No squad data' : '—'}</span>
                  )}
                </div>

                {/* Bar + Label */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--dim)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {m.label}{isSquad ? ' 🔬' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 3, height: 6, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ flex: 1, background: 'var(--border)', borderRadius: '4px 0 0 4px', overflow: 'hidden', display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ width: `${aW}%`, height: '100%', background: aWins ? '#00e676' : '#4444aa', borderRadius: '4px 0 0 4px' }} />
                    </div>
                    <div style={{ flex: 1, background: 'var(--border)', borderRadius: '0 4px 4px 0', overflow: 'hidden' }}>
                      <div style={{ width: `${bW}%`, height: '100%', background: bWins ? '#00e676' : '#4444aa', borderRadius: '0 4px 4px 0' }} />
                    </div>
                  </div>
                </div>

                {/* Team B value */}
                <div style={{ textAlign: 'center' }}>
                  {bVal != null ? (
                    <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 16, fontWeight: 700, color: bWins ? '#00e676' : 'var(--text)' }}>
                      {bVal}{(m as any).max ? `/${max}` : ''}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--dim)' }}>{isSquad ? 'No squad data' : '—'}</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Squad data notice */}
          {(teamA.squad_depth_score == null || teamB.squad_depth_score == null) && (
            <div style={{ padding: '10px 14px', background: '#ffb30015', border: '1px solid #ffb30030', borderRadius: 8, fontSize: 11, color: '#ffb300' }}>
              🔬 Squad metrics (depth/injury/stability) show "No squad data" for teams not yet synced via sync:squads:v2
            </div>
          )}
        </div>
      )}

      {(!teamA || !teamB) && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
          Search and select two teams above to compare their intelligence metrics
        </div>
      )}
    </div>
  );
}
