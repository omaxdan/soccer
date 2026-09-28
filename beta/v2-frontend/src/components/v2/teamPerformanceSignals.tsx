'use client';
// TEAM PERFORMANCE SIGNALS (Phase E) — the descriptive signal table on the Performance tab.
//
// A group switcher (Scoring · Conceding · Results · Both scored · Finishing vs xG ·
// Defending vs xGA · Chance creation) over the real GET /teams/{id}/performance-signals
// windows (Previous 5 · Last 5 · Season · Home · Away). Every cell is the API's own
// `displayValue`, rendered verbatim — no formulas, no recomputation, no invented trend.
// A missing value is an em dash, never a fabricated zero. The signal table scrolls
// horizontally inside its own panel on narrow viewports (the page never overflows).

import { useState } from 'react';
import type { SignalWindow, SignalMetric, SignalStreak } from '@/lib/v2/types';

type GroupKey = 'scoring' | 'conceding' | 'result' | 'btts' | 'attack' | 'defensiveXg' | 'creation';

const GROUPS: readonly { key: GroupKey; label: string }[] = [
  { key: 'scoring', label: 'Scoring' },
  { key: 'conceding', label: 'Conceding' },
  { key: 'result', label: 'Results' },
  { key: 'btts', label: 'Both scored' },
  { key: 'attack', label: 'Finishing vs xG' },
  { key: 'defensiveXg', label: 'Defending vs xGA' },
  { key: 'creation', label: 'Chance creation' },
];

const WINDOW_COLS: readonly { key: keyof TeamSignalWindows; label: string }[] = [
  { key: 'previous5', label: 'Prev 5' },
  { key: 'last5', label: 'Last 5' },
  { key: 'season', label: 'Season' },
  { key: 'seasonHome', label: 'Home' },
  { key: 'seasonAway', label: 'Away' },
];

interface TeamSignalWindows {
  last5: SignalWindow; previous5: SignalWindow; season: SignalWindow;
  seasonHome: SignalWindow; seasonAway: SignalWindow;
}

/** Union of metric keys present for a group across all windows, in the season window's
 *  order (falling back to whichever window has them). Keeps a stable row order. */
function metricRows(windows: TeamSignalWindows, group: GroupKey): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  const order: string[] = [];
  for (const wk of ['season', 'last5', 'previous5', 'seasonHome', 'seasonAway'] as const) {
    for (const m of windows[wk][group] as SignalMetric[]) {
      if (!seen.has(m.key)) { seen.set(m.key, m.label); order.push(m.key); }
    }
  }
  return order.map((key) => ({ key, label: seen.get(key)! }));
}

function displayFor(win: SignalWindow, group: GroupKey, key: string): string {
  const m = (win[group] as SignalMetric[]).find((x) => x.key === key);
  return m && m.displayValue !== null && m.displayValue !== undefined ? m.displayValue : '—';
}

const TH: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400, whiteSpace: 'nowrap' };
const TD: React.CSSProperties = { textAlign: 'right', padding: '4px 8px', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

export function TeamPerformanceSignals({ windows }: { windows: TeamSignalWindows }) {
  const [group, setGroup] = useState<GroupKey>('scoring');
  const rows = metricRows(windows, group);
  const streaks = (windows.season.streaks ?? []).filter((s: SignalStreak) => s.length > 0);

  return (
    <section className="space-y-2">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Performance signals</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>context</span>
      </div>

      <div role="radiogroup" aria-label="Signal group" className="no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        {GROUPS.map((g) => {
          const on = g.key === group;
          return (
            <button key={g.key} type="button" role="radio" aria-checked={on} onClick={() => setGroup(g.key)}
              style={{ flex: 'none', minHeight: 32, padding: '0 12px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--line)', borderBottom: `2px solid ${on ? 'var(--amber)' : 'var(--line)'}`, background: on ? 'var(--raised)' : 'var(--panel)', color: on ? 'var(--text)' : 'var(--muted)', fontSize: 12, fontWeight: 500 }}>
              {g.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <div className="panel" style={{ padding: 20, textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>No signals recorded for this group.</p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
            <caption className="sr-only">Performance signals by window. Values are shown as supplied.</caption>
            <thead>
              <tr>
                <th scope="col" style={{ ...TH, textAlign: 'left' }}>Signal</th>
                {WINDOW_COLS.map((c) => <th key={c.key} scope="col" style={TH}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} style={{ background: i % 2 === 0 ? 'color-mix(in srgb, var(--raised) 30%, transparent)' : 'transparent' }}>
                  <th scope="row" style={{ ...TD, textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'normal' }}>{r.label}</th>
                  {WINDOW_COLS.map((c) => <td key={c.key} style={TD}>{displayFor(windows[c.key], group, r.key)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {streaks.length > 0 && (
        <div className="panel" style={{ padding: 12 }}>
          <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10, marginBottom: 6 }}>Current runs</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '4px 16px' }}>
            {streaks.map((s) => (
              <li key={s.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
                <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 600 }}>{s.length}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Descriptive signals across all competitions, shown exactly as supplied for each window — context only, never a rating or forecast.
      </p>
    </section>
  );
}
