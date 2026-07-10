'use client';
import { COLORS } from '@/design/tokens';

// ─── TEAM COMPARISON MATRIX ─────────────────────────────────────────────────
// Consolidates data already computed and stored across team_intelligence,
// team_strength_ratings, team_venue_performance, team_season_statistics,
// team_goal_dependency, and team_injury_impact into ONE scannable table —
// replacing what was previously spread across several separate cards on the
// match page. This is purely a presentation consolidation: every number
// here was already being fetched/computed somewhere on the page, just
// never shown side by side with a clear verdict.
//
// Built after reading a real match-preview narrative (Sligo Rovers vs
// Shamrock Rovers, match 750) whose actual outcome — Fitzgerald opened the
// scoring at 13', Byrne equalized at 47', Burke won it for Shamrock at 82'
// (final: 1-2, away win) — matched the readiness/strength gap direction
// this exact kind of comparison table pointed to. The narrative's actual
// SQL had a real formula bug (a second, differently-weighted importance
// score computed inline instead of reusing the already-correct
// player_intelligence.importance_score built earlier this session) — this
// component reuses the real stored values throughout, no parallel formula.

export interface ComparisonRow {
  label: string;
  homeValue: number | null;
  awayValue: number | null;
  /** false = lower is better for this metric (congestion, injury impact,
   *  goals conceded) — flips which side gets the green "edge" color. */
  higherIsBetter: boolean;
  /** How to render the raw number — '%' appends a percent sign, '' is bare. */
  suffix?: string;
  decimals?: number;
}

interface Props {
  homeTeam: string;
  awayTeam: string;
  rows: ComparisonRow[];
  /** Home/Away last-5 form strings (e.g. "DLLL" or "WDWLW"), shown as a
   *  dedicated row since it's not a single comparable number. */
  homeFormString?: string;
  awayFormString?: string;
}

function fmt(v: number | null, decimals = 0, suffix = ''): string {
  if (v == null) return '—';
  return v.toFixed(decimals) + suffix;
}

function edgeColor(homeV: number | null, awayV: number | null, higherIsBetter: boolean, side: 'home' | 'away'): string {
  if (homeV == null || awayV == null || homeV === awayV) return COLORS.text2;
  const homeWins = higherIsBetter ? homeV > awayV : homeV < awayV;
  const thisSideWins = side === 'home' ? homeWins : !homeWins;
  return thisSideWins ? COLORS.green : COLORS.text2;
}

function verdictText(label: string, home: string, homeV: number | null, away: string, awayV: number | null, higherIsBetter: boolean): string {
  if (homeV == null || awayV == null) return '—';
  const diff = Math.abs(homeV - awayV);
  if (diff === 0) return 'Even';
  const homeWins = higherIsBetter ? homeV > awayV : homeV < awayV;
  const winner = homeWins ? home : away;
  return `${winner} +${diff % 1 === 0 ? diff : diff.toFixed(1)}`;
}

function FormPills({ formString }: { formString?: string }) {
  if (!formString) return <span style={{ color: COLORS.dim, fontSize: 11 }}>—</span>;
  const colorFor = (c: string) => c === 'W' ? COLORS.green : c === 'L' ? COLORS.red : COLORS.amber;
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {formString.split('').map((c, i) => (
        <span key={i} style={{
          width: 16, height: 16, borderRadius: '50%', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700,
          background: colorFor(c), color: '#000',
        }}>{c}</span>
      ))}
    </span>
  );
}

export default function TeamComparisonMatrix({ homeTeam, awayTeam, rows, homeFormString, awayFormString }: Props) {
  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: COLORS.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Metric</th>
            <th style={{ textAlign: 'center', padding: '6px 8px', color: COLORS.text, fontSize: 11, fontWeight: 700 }}>{homeTeam}</th>
            <th style={{ textAlign: 'center', padding: '6px 8px', color: COLORS.text, fontSize: 11, fontWeight: 700 }}>{awayTeam}</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', color: COLORS.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Edge</th>
          </tr>
        </thead>
        <tbody>
          {(homeFormString || awayFormString) && (
            <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
              <td style={{ padding: '6px 8px', color: COLORS.muted }}>Last 5 Form</td>
              <td style={{ padding: '6px 8px', textAlign: 'center' }}><FormPills formString={homeFormString} /></td>
              <td style={{ padding: '6px 8px', textAlign: 'center' }}><FormPills formString={awayFormString} /></td>
              <td style={{ padding: '6px 8px' }} />
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
              <td style={{ padding: '6px 8px', color: COLORS.muted }}>{r.label}</td>
              <td style={{
                padding: '6px 8px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700,
                color: edgeColor(r.homeValue, r.awayValue, r.higherIsBetter, 'home'),
              }}>
                {fmt(r.homeValue, r.decimals, r.suffix)}
              </td>
              <td style={{
                padding: '6px 8px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700,
                color: edgeColor(r.homeValue, r.awayValue, r.higherIsBetter, 'away'),
              }}>
                {fmt(r.awayValue, r.decimals, r.suffix)}
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: 10, color: COLORS.dim }}>
                {verdictText(r.label, homeTeam, r.homeValue, awayTeam, r.awayValue, r.higherIsBetter)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
