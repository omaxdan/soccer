'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getTeamComparisonExtras, TeamComparisonExtras } from '@/lib/queries';
import { teamUrl, matchUrl } from '@/lib/urls';
import { COLORS, scoreColor } from '@/design/tokens';

function scoreClass(s: number | null) {
  if (s == null) return COLORS.dim;
  return scoreColor(s);
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
        .select('team_id, readiness_score, form_index, congestion_score, travel_fatigue_score, active_competitions, last_5_points, last_10_points, squad_depth_score, injury_burden_score, squad_stability_score, rest_days_avg, team:teams!team_id(id, name, short_name, country, slug)')
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
      <div style={{ fontSize: 10, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '10px 14px' }}>
          <div>
            <div style={{ fontWeight: 700, color: COLORS.text, fontSize: 14 }}>{selected.team?.name}</div>
            <div style={{ fontSize: 11, color: COLORS.dim }}>{selected.team?.country}</div>
          </div>
          <button onClick={() => { onSelect(null); setQ(''); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: COLORS.dim, cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
        </div>
      ) : (
        <input
          value={q}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search team…"
          style={{ width: '100%', boxSizing: 'border-box', background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '10px 14px', color: COLORS.text, fontSize: 14, outline: 'none' }}
        />
      )}
      {open && results.length > 0 && !selected && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, marginTop: 4, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {results.map((r: any) => (
            <div key={r.team_id} onClick={() => { onSelect(r); setOpen(false); setQ(''); }} style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} className="compare-search-item">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.text }}>{r.team?.name}</div>
                <div style={{ fontSize: 11, color: COLORS.dim }}>{r.team?.country}</div>
              </div>
              <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 14, fontWeight: 700, color: scoreClass(r.readiness_score) }}>{Math.round(r.readiness_score ?? 0)}</div>
            </div>
          ))}
        </div>
      )}
      <style>{`.compare-search-item:hover { background: ${COLORS.surface2}; }`}</style>
    </div>
  );
}

function GaugeSmall({ score }: { score: number | null }) {
  const pct = score != null ? Math.min(100, Math.max(0, score)) : 0;
  const r = 34, circ = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: 80, height: 80 }}>
      <svg width={80} height={80} viewBox="0 0 80 80">
        <circle cx={40} cy={40} r={r} fill="none" stroke={COLORS.border} strokeWidth={7} />
        {score != null && (
          <circle cx={40} cy={40} r={r} fill="none" stroke={scoreClass(score)} strokeWidth={7}
            strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ}
            strokeLinecap="round" transform="rotate(-90 40 40)" />
        )}
      </svg>
    </div>
  );
}

const FORM_COLOR: Record<'W' | 'D' | 'L', string> = { W: COLORS.green, D: COLORS.amber, L: COLORS.red };

export default function ComparePage() {
  const [teamA, setTeamA] = useState<any>(null);
  const [teamB, setTeamB] = useState<any>(null);
  const [extras, setExtras] = useState<TeamComparisonExtras | null>(null);
  const [loadingExtras, setLoadingExtras] = useState(false);

  useEffect(() => {
    if (teamA?.team?.id && teamB?.team?.id) {
      setLoadingExtras(true);
      getTeamComparisonExtras(teamA.team.id, teamB.team.id)
        .then(setExtras)
        .finally(() => setLoadingExtras(false));
    } else {
      setExtras(null);
    }
  }, [teamA?.team?.id, teamB?.team?.id]);

  const keyFactors = teamA && teamB ? [
    { label: 'Form (Last 5)', a: teamA.last_5_points, b: teamB.last_5_points, max: 15 },
    { label: 'Rest Days (Avg)', a: teamA.rest_days_avg, b: teamB.rest_days_avg, max: 7 },
    { label: 'Fixture Congestion', a: teamA.congestion_score, b: teamB.congestion_score, max: 100, invert: true },
    { label: 'Squad Stability', a: teamA.squad_stability_score, b: teamB.squad_stability_score, max: 100 },
  ] : [];

  const statsA = extras?.seasonStats[teamA?.team?.id];
  const statsB = extras?.seasonStats[teamB?.team?.id];
  const matchesA = statsA?.matches ?? 0;
  const matchesB = statsB?.matches ?? 0;

  const detailedStats = (statsA || statsB) ? [
    { label: 'Points Per Game', a: extras?.ppg10[teamA?.team?.id], b: extras?.ppg10[teamB?.team?.id], higher: true },
    { label: 'Goals Scored (Per Match)', a: matchesA > 0 ? Math.round((statsA?.goals_scored / matchesA) * 100) / 100 : null, b: matchesB > 0 ? Math.round((statsB?.goals_scored / matchesB) * 100) / 100 : null, higher: true },
    { label: 'Goals Conceded (Per Match)', a: matchesA > 0 ? Math.round((statsA?.goals_conceded / matchesA) * 100) / 100 : null, b: matchesB > 0 ? Math.round((statsB?.goals_conceded / matchesB) * 100) / 100 : null, higher: false },
    { label: 'xG (Season, Approx.)', a: statsA?.approx_xg_total != null ? Math.round(statsA.approx_xg_total * 10) / 10 : null, b: statsB?.approx_xg_total != null ? Math.round(statsB.approx_xg_total * 10) / 10 : null, higher: true, note: true },
    { label: 'Possession %', a: statsA?.avg_possession, b: statsB?.avg_possession, higher: true, suffix: '%' },
    { label: 'Pass Accuracy %', a: statsA?.accurate_passes_pct, b: statsB?.accurate_passes_pct, higher: true, suffix: '%' },
    { label: 'Clean Sheets %', a: matchesA > 0 ? Math.round((statsA?.clean_sheets / matchesA) * 1000) / 10 : null, b: matchesB > 0 ? Math.round((statsB?.clean_sheets / matchesB) * 1000) / 10 : null, higher: true, suffix: '%' },
    { label: 'Big Chances Created', a: statsA?.big_chances_created, b: statsB?.big_chances_created, higher: true },
    { label: 'Big Chances Missed', a: statsA?.big_chances_missed, b: statsB?.big_chances_missed, higher: false },
    { label: 'Tackles (Per Match)', a: matchesA > 0 ? Math.round((statsA?.tackles / matchesA) * 10) / 10 : null, b: matchesB > 0 ? Math.round((statsB?.tackles / matchesB) * 10) / 10 : null, higher: true },
    { label: 'Interceptions (Per Match)', a: matchesA > 0 ? Math.round((statsA?.interceptions / matchesA) * 10) / 10 : null, b: matchesB > 0 ? Math.round((statsB?.interceptions / matchesB) * 10) / 10 : null, higher: true },
    { label: 'Yellow Cards (Per Match)', a: matchesA > 0 ? Math.round((statsA?.yellow_cards / matchesA) * 10) / 10 : null, b: matchesB > 0 ? Math.round((statsB?.yellow_cards / matchesB) * 10) / 10 : null, higher: false },
    { label: 'Red Cards (Total)', a: statsA?.red_cards, b: statsB?.red_cards, higher: false },
  ] : [];

  // Overall Comparison radar — derived composite indices, NOT raw stats.
  // Explicitly a new derived formula (same category as the team strength
  // change): Attack = goals/match normalized; Defense = inverse goals
  // conceded/match; Form = form_index directly; Squad = squad_stability_score
  // directly; Schedule = inverse congestion_score. Worth confirming this
  // blend is what's wanted, same as the strength_score formula change.
  const radarData = teamA && teamB ? [
    { axis: 'Attack', a: matchesA > 0 ? Math.min(100, Math.round((statsA?.goals_scored / matchesA) * 33)) : 0, b: matchesB > 0 ? Math.min(100, Math.round((statsB?.goals_scored / matchesB) * 33)) : 0 },
    { axis: 'Defense', a: matchesA > 0 ? Math.max(0, 100 - Math.round((statsA?.goals_conceded / matchesA) * 40)) : 0, b: matchesB > 0 ? Math.max(0, 100 - Math.round((statsB?.goals_conceded / matchesB) * 40)) : 0 },
    { axis: 'Form', a: Math.round(teamA.form_index ?? 0), b: Math.round(teamB.form_index ?? 0) },
    { axis: 'Squad', a: Math.round(teamA.squad_stability_score ?? 0), b: Math.round(teamB.squad_stability_score ?? 0) },
    { axis: 'Schedule', a: Math.max(0, 100 - Math.round(teamA.congestion_score ?? 0)), b: Math.max(0, 100 - Math.round(teamB.congestion_score ?? 0)) },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>Team Comparison</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>Compare teams side-by-side with readiness intelligence</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <TeamSearch label="TEAM A" onSelect={setTeamA} selected={teamA} />
        <TeamSearch label="TEAM B" onSelect={setTeamB} selected={teamB} />
      </div>

      {teamA && teamB && (
        <>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '14px 20px' }}>
            <Link href={teamUrl(teamA.team)} style={{ textDecoration: 'none', flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>{teamA.team?.name}</div>
              <div style={{ fontSize: 11, color: COLORS.dim }}>{teamA.team?.country}</div>
            </Link>
            <div style={{ fontSize: 13, color: COLORS.dim, fontWeight: 700, padding: '0 20px' }}>VS</div>
            <Link href={teamUrl(teamB.team)} style={{ textDecoration: 'none', flex: 1, textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>{teamB.team?.name}</div>
              <div style={{ fontSize: 11, color: COLORS.dim }}>{teamB.team?.country}</div>
            </Link>
          </div>

          {/* Readiness scores */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
              <GaugeSmall score={teamA.readiness_score} />
              <div>
                <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>Readiness Score</div>
                <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 28, fontWeight: 800, color: scoreClass(teamA.readiness_score) }}>{Math.round(teamA.readiness_score ?? 0)}</div>
              </div>
            </div>
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', marginBottom: 8 }}>Readiness Gap</div>
              <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 32, fontWeight: 800, color: scoreClass(Math.abs((teamA.readiness_score ?? 0) - (teamB.readiness_score ?? 0)) * 2) }}>
                {(teamA.readiness_score ?? 0) >= (teamB.readiness_score ?? 0) ? '+' : '-'}{Math.round(Math.abs((teamA.readiness_score ?? 0) - (teamB.readiness_score ?? 0)))}
              </div>
              <div style={{ fontSize: 10, color: COLORS.dim, marginTop: 4 }}>{(teamA.readiness_score ?? 0) >= (teamB.readiness_score ?? 0) ? teamA.team?.name : teamB.team?.name} Advantage</div>
            </div>
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'flex-end' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>Readiness Score</div>
                <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 28, fontWeight: 800, color: scoreClass(teamB.readiness_score) }}>{Math.round(teamB.readiness_score ?? 0)}</div>
              </div>
              <GaugeSmall score={teamB.readiness_score} />
            </div>
          </div>

          {/* Key factors */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Key Factors Comparison</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              {keyFactors.map(f => {
                const aVal = f.a ?? 0, bVal = f.b ?? 0;
                const aScore = f.invert ? 100 - aVal : aVal;
                const bScore = f.invert ? 100 - bVal : bVal;
                const aWins = aScore > bScore;
                return (
                  <div key={f.label}>
                    <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', marginBottom: 6 }}>{f.label}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, marginBottom: 4 }}>
                      <span style={{ color: aWins ? COLORS.green : COLORS.text }}>{f.a != null ? f.a.toFixed(1) : '—'}</span>
                      <span style={{ color: !aWins ? COLORS.green : COLORS.text }}>{f.b != null ? f.b.toFixed(1) : '—'}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 2, height: 4 }}>
                      <div style={{ flex: 1, background: COLORS.border, borderRadius: '3px 0 0 3px', overflow: 'hidden', display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{ width: `${Math.min(100, (aVal / f.max) * 100)}%`, height: '100%', background: aWins ? COLORS.green : COLORS.blue }} />
                      </div>
                      <div style={{ flex: 1, background: COLORS.border, borderRadius: '0 3px 3px 0', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, (bVal / f.max) * 100)}%`, height: '100%', background: !aWins ? COLORS.green : COLORS.blue }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
            {/* Detailed stat table */}
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Detailed Stat Comparison</div>
              {!statsA && !statsB && <div style={{ fontSize: 11, color: COLORS.dim, padding: '16px 0' }}>No season statistics synced yet for these teams — run sync:team-stats</div>}
              {(statsA || statsB) && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 10, color: COLORS.dim, marginBottom: 6 }}>
                    <span>{teamA.team?.name}</span><span>{teamB.team?.name}</span>
                  </div>
                  {loadingExtras && <div style={{ fontSize: 11, color: COLORS.dim }}>Loading…</div>}
                  {!loadingExtras && detailedStats.map(s => {
                    const aWins = s.a != null && s.b != null && (s.higher ? s.a > s.b : s.a < s.b);
                    const bWins = s.a != null && s.b != null && (s.higher ? s.b > s.a : s.b < s.a);
                    return (
                      <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '6px 0', borderTop: `1px solid ${COLORS.border}`, alignItems: 'center', fontSize: 11 }}>
                        <span style={{ color: COLORS.muted }}>{s.label}{s.note && <span style={{ color: COLORS.dim, fontSize: 9 }}> (approx.)</span>}</span>
                        <div style={{ display: 'flex', gap: 16, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700 }}>
                          <span style={{ color: aWins ? COLORS.green : COLORS.text, minWidth: 40, textAlign: 'right' }}>{s.a != null ? `${s.a}${s.suffix ?? ''}` : '—'}</span>
                          <span style={{ color: bWins ? COLORS.green : COLORS.text, minWidth: 40, textAlign: 'right' }}>{s.b != null ? `${s.b}${s.suffix ?? ''}` : '—'}</span>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* Overall comparison radar + recent form + H2H */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {radarData.length > 0 && (
                <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Overall Comparison</div>
                  <div style={{ fontSize: 9, color: COLORS.dim, marginBottom: 10 }}>Derived composite index — not raw match stats</div>
                  {radarData.map(r => (
                    <div key={r.axis} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: COLORS.dim, marginBottom: 2 }}><span>{r.axis}</span></div>
                      <div style={{ display: 'flex', gap: 2, height: 5 }}>
                        <div style={{ flex: 1, background: COLORS.border, borderRadius: '3px 0 0 3px', display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
                          <div style={{ width: `${r.a}%`, height: '100%', background: COLORS.green }} />
                        </div>
                        <div style={{ flex: 1, background: COLORS.border, borderRadius: '0 3px 3px 0', overflow: 'hidden' }}>
                          <div style={{ width: `${r.b}%`, height: '100%', background: COLORS.blue }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Recent Form (Last 10)</div>
                {[teamA, teamB].map((t, idx) => (
                  <div key={idx} style={{ marginBottom: idx === 0 ? 10 : 0 }}>
                    <div style={{ fontSize: 11, color: COLORS.text, fontWeight: 600, marginBottom: 4 }}>{t.team?.name}</div>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {(extras?.formPills[t.team?.id] ?? []).map((r: 'W' | 'D' | 'L', j: number) => (
                        <span key={j} style={{ width: 16, height: 16, borderRadius: 3, background: FORM_COLOR[r] + '30', color: FORM_COLOR[r], border: `1px solid ${FORM_COLOR[r]}50`, fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r}</span>
                      ))}
                      {extras && (extras.formPills[t.team?.id] ?? []).length > 0 && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: COLORS.dim, alignSelf: 'center' }}>{extras.ppg10[t.team?.id]} PPG</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {extras && extras.headToHead.length > 0 && (
                <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Head to Head (Last {extras.headToHead.length})</div>
                  {(() => {
                    let winsA = 0, winsB = 0, draws = 0;
                    for (const m of extras.headToHead) {
                      if (m.home_score == null || m.away_score == null) continue;
                      const aIsHome = m.home_team_id === teamA.team.id;
                      const aScore = aIsHome ? m.home_score : m.away_score;
                      const bScore = aIsHome ? m.away_score : m.home_score;
                      if (aScore > bScore) winsA++; else if (bScore > aScore) winsB++; else draws++;
                    }
                    return (
                      <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', marginBottom: 10 }}>
                        <div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 20, fontWeight: 800, color: COLORS.green }}>{winsA}</div><div style={{ fontSize: 9, color: COLORS.dim }}>{teamA.team?.name} Wins</div></div>
                        <div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 20, fontWeight: 800, color: COLORS.dim }}>{draws}</div><div style={{ fontSize: 9, color: COLORS.dim }}>Draws</div></div>
                        <div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 20, fontWeight: 800, color: COLORS.blue }}>{winsB}</div><div style={{ fontSize: 9, color: COLORS.dim }}>{teamB.team?.name} Wins</div></div>
                      </div>
                    );
                  })()}
                  {extras.headToHead.map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '4px 0', borderTop: `1px solid ${COLORS.border}`, color: COLORS.muted }}>
                      <span>{new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span style={{ fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>{m.home_score ?? '?'}–{m.away_score ?? '?'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Insights */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Insights</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              {(() => {
                const gap = Math.abs((teamA.readiness_score ?? 0) - (teamB.readiness_score ?? 0));
                const favTeam = (teamA.readiness_score ?? 0) >= (teamB.readiness_score ?? 0) ? teamA : teamB;
                const insights = [];
                if (gap >= 5) insights.push(<div key="1" style={{ display: 'flex', gap: 6 }}><span>📈</span><span style={{ color: COLORS.text2 }}><strong>{favTeam.team?.name}</strong> have the higher readiness score due to better form and lower congestion.</span></div>);
                const restDiff = (teamA.rest_days_avg ?? 0) - (teamB.rest_days_avg ?? 0);
                if (Math.abs(restDiff) >= 1) insights.push(<div key="2" style={{ display: 'flex', gap: 6 }}><span>🛌</span><span style={{ color: COLORS.text2 }}><strong>{restDiff > 0 ? teamA.team?.name : teamB.team?.name}</strong> have more rest days.</span></div>);
                if (gap < 5) insights.push(<div key="3" style={{ display: 'flex', gap: 6 }}><span>⭐</span><span style={{ color: COLORS.text2 }}>This is a high-quality matchup with a very small readiness gap.</span></div>);
                if ((teamA.readiness_score ?? 0) >= 75 && (teamB.readiness_score ?? 0) >= 75) insights.push(<div key="4" style={{ display: 'flex', gap: 6 }}><span>🏆</span><span style={{ color: COLORS.text2 }}>Both teams are performing at an elite level this season.</span></div>);
                return insights;
              })()}
            </div>
          </div>

          {/* Upcoming fixtures */}
          {extras && (extras.upcoming[teamA.team.id]?.length > 0 || extras.upcoming[teamB.team.id]?.length > 0) && (
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Upcoming Fixtures</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {[teamA, teamB].map((t, idx) => (
                  <div key={idx}>
                    <div style={{ fontSize: 11, color: COLORS.text, fontWeight: 700, marginBottom: 6 }}>{t.team?.name}</div>
                    {(extras.upcoming[t.team.id] ?? []).slice(0, 5).map((u: any, i: number) => {
                      const opp = u.home_team?.id === t.team.id ? u.away_team?.name : u.home_team?.name;
                      const ha = u.home_team?.id === t.team.id ? 'H' : 'A';
                      return (
                        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '4px 0', borderTop: `1px solid ${COLORS.border}` }}>
                          <span style={{ color: COLORS.dim, minWidth: 42 }}>{new Date(u.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                          <span style={{ color: COLORS.text, flex: 1 }}>{opp}</span>
                          <span style={{ color: ha === 'H' ? COLORS.green : COLORS.amber, fontWeight: 700 }}>{ha}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {(!teamA || !teamB) && (
        <div style={{ padding: 40, textAlign: 'center', color: COLORS.dim, fontSize: 13 }}>
          Search and select two teams above to compare their intelligence metrics
        </div>
      )}
    </div>
  );
}
