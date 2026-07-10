'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getLeagueGapSummary, getLeagueGapTiers, LeagueGapSummaryRow, LeagueGapTierRow } from '@/lib/queries';
import { COLORS } from '@/design/tokens';

const TIER_LABEL: Record<string, string> = {
  strong: 'Strong Edge (20+)',
  moderate: 'Moderate Edge (10–20)',
  small: 'Small Edge (0–10)',
  negative: 'Negative Edge (<0)',
};
const TIER_ORDER = ['strong', 'moderate', 'small', 'negative'];

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  consistent:   { label: 'Consistent',        color: COLORS.green },
  mixed:        { label: 'Mixed',             color: COLORS.amber },
  volatile:     { label: 'Volatile',          color: COLORS.orange },
  insufficient: { label: 'Insufficient sample', color: COLORS.dim },
};

type SortKey = 'total_picks' | 'hit_rate_strict' | 'hit_rate_lenient' | 'lift_over_baseline' | 'avg_winning_gap';

const fmtPct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);
const fmtNum = (v: number | null) => (v == null ? '—' : v.toFixed(1));
const fmtLift = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`);

export default function LeagueAnalyticsPage() {
  const [summary, setSummary] = useState<LeagueGapSummaryRow[]>([]);
  const [tiers, setTiers] = useState<LeagueGapTierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('total_picks');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState<'all' | 'consistent' | 'volatile'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [s, t] = await Promise.all([getLeagueGapSummary(), getLeagueGapTiers()]);
      setSummary(s);
      setTiers(t);
      setLoading(false);
    })();
  }, []);

  const tiersByLeague = useMemo(() => {
    const m = new Map<string, LeagueGapTierRow[]>();
    for (const t of tiers) {
      if (!m.has(t.league_name)) m.set(t.league_name, []);
      m.get(t.league_name)!.push(t);
    }
    for (const arr of m.values()) arr.sort((a, b) => TIER_ORDER.indexOf(a.gap_tier) - TIER_ORDER.indexOf(b.gap_tier));
    return m;
  }, [tiers]);

  const gated = useMemo(() => summary.filter(s => s.meets_sample_gate), [summary]);
  const mostConsistent = useMemo(
    () => [...gated].filter(s => (s.lift_over_baseline ?? -999) > 0)
      .sort((a, b) => (b.lift_over_baseline ?? 0) - (a.lift_over_baseline ?? 0))[0] ?? null,
    [gated],
  );
  const mostVolatile = useMemo(
    () => [...gated].filter(s => s.readiness_status === 'volatile')
      .sort((a, b) => (a.lift_over_baseline ?? 0) - (b.lift_over_baseline ?? 0))[0] ?? null,
    [gated],
  );
  const bestTier = useMemo(() => {
    const agg = new Map<string, { correct: number; total: number }>();
    for (const t of tiers) {
      if (t.total_picks < 10 || t.hit_rate_strict == null) continue;
      const a = agg.get(t.gap_tier) ?? { correct: 0, total: 0 };
      a.correct += (t.hit_rate_strict / 100) * t.total_picks;
      a.total += t.total_picks;
      agg.set(t.gap_tier, a);
    }
    let best: { tier: string; rate: number; total: number } | null = null;
    for (const [tier, a] of agg) {
      const rate = a.total > 0 ? (a.correct / a.total) * 100 : 0;
      if (!best || rate > best.rate) best = { tier, rate, total: a.total };
    }
    return best;
  }, [tiers]);

  const filtered = useMemo(() => {
    let rows = summary;
    if (filter === 'consistent') rows = rows.filter(s => s.readiness_status === 'consistent');
    else if (filter === 'volatile') rows = rows.filter(s => s.readiness_status === 'volatile');
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => ((a[sortKey] ?? -999) as number) > ((b[sortKey] ?? -999) as number) ? dir : -dir);
  }, [summary, filter, sortKey, sortDir]);

  const freshness = summary[0]?.computed_at ? new Date(summary[0].computed_at).toLocaleDateString() : null;

  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  if (loading) {
    return <div style={{ padding: '2rem', color: COLORS.dim, fontSize: '0.875rem' }}>Loading league analytics…</div>;
  }

  if (summary.length === 0) {
    return (
      <div style={{ padding: '1.5rem', maxWidth: '48rem', width: '100%', boxSizing: 'border-box' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.text, marginBottom: '0.75rem' }}>League Performance &amp; Gap Analytics</h1>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '1.25rem', color: COLORS.muted, fontSize: '0.8125rem', lineHeight: 1.6 }}>
          No analytics yet. This page fills in once the readiness archive has accumulated finished matches and the nightly aggregation has run. The archive is append-only and builds over time — accuracy figures appear per league as each accrues enough completed fixtures to be meaningful.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '100%', width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '75rem', margin: '0 auto', width: '100%' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.text }}>League Performance &amp; Gap Analytics</h1>
        <p style={{ fontSize: '0.75rem', color: COLORS.dim, marginTop: '0.25rem', lineHeight: 1.5, maxWidth: '44rem' }}>
          How reliably the platform&rsquo;s readiness gaps have tracked real outcomes, per league. Every figure is the platform&rsquo;s own historical track record — reported as plainly for the misses as the hits. Informational only; not betting advice.
          {freshness && <span> · Updated {freshness}</span>}
        </p>
      </div>

      {/* Summary cards with horizontal scroll on mobile */}
      <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'nowrap', minWidth: 'min-content', padding: '0 1.5rem 0 0' }}>
          <SummaryCard
            title="Most Consistent League"
            league={mostConsistent?.league_name}
            primary={mostConsistent ? `${mostConsistent.lift_over_baseline?.toFixed(1) ?? '—'}%` : '—'}
            sub={mostConsistent ? STATUS_STYLE[mostConsistent.readiness_status ?? 'insufficient'].label : 'Insufficient sample'}
            color={mostConsistent ? STATUS_STYLE[mostConsistent.readiness_status ?? 'insufficient'].color : COLORS.dim}
          />
          <SummaryCard
            title="Most Reliable"
            league={bestTier ? `${TIER_LABEL[bestTier.tier] ?? bestTier.tier}` : '—'}
            primary={bestTier ? `${bestTier.rate?.toFixed(1) ?? '—'}%` : '—'}
            sub={bestTier ? `across ${bestTier.total} picks` : 'Insufficient data'}
            color={bestTier ? COLORS.green : COLORS.dim}
          />
          <SummaryCard
            title="Most Volatile"
            league={mostVolatile?.league_name}
            primary={mostVolatile ? `${mostVolatile.lift_over_baseline?.toFixed(1) ?? '—'}%` : '—'}
            sub={mostVolatile ? STATUS_STYLE[mostVolatile.readiness_status ?? 'insufficient'].label : 'Insufficient sample'}
            color={mostVolatile ? COLORS.orange : COLORS.dim}
          />
        </div>
      </div>

      {/* Filter pills with horizontal scroll on mobile */}
      <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'nowrap', minWidth: 'min-content', paddingRight: '1.5rem' }}>
          {[
            { k: 'all' as const, label: 'All Leagues' },
            { k: 'consistent' as const, label: 'Historically Consistent' },
            { k: 'volatile' as const, label: 'Historically Volatile' },
          ].map(({ k, label }) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                padding: '0.375rem 0.875rem',
                border: `1px solid ${filter === k ? COLORS.text : COLORS.border}`,
                borderRadius: 20,
                background: filter === k ? COLORS.surface2 : 'transparent',
                fontSize: '0.6875rem',
                fontWeight: filter === k ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                color: filter === k ? COLORS.text : COLORS.muted,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main table with strict boundary constraints */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%', maxWidth: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem', minWidth: 'auto' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                <Th label="League" />
                <Th label="Picks" sortKey="total_picks" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Hit % (S)" sortKey="hit_rate_strict" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Hit % (L)" sortKey="hit_rate_lenient" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Lift" sortKey="lift_over_baseline" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Avg Gap" sortKey="avg_winning_gap" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Status" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const st = STATUS_STYLE[row.readiness_status ?? 'insufficient'] ?? STATUS_STYLE.insufficient;
                const isOpen = expanded === row.league_name;
                const leagueTiers = tiersByLeague.get(row.league_name) ?? [];
                return (
                  <React.Fragment key={row.league_name}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : row.league_name)}
                      style={{ borderBottom: `1px solid ${COLORS.border}`, cursor: 'pointer', background: isOpen ? COLORS.surface2 : 'transparent' }}
                    >
                      <td style={{ padding: '0.5rem 0.5rem', color: COLORS.text, fontWeight: 600, minWidth: '40%', maxWidth: '45%', wordBreak: 'break-word' }}>
                        <span style={{ color: COLORS.dim, marginRight: '0.25rem', fontSize: '0.6875rem' }}>{isOpen ? '▾' : '▸'}</span>
                        <span style={{ fontSize: '0.8125rem', lineHeight: 1.4 }}>{row.league_name}</span>
                      </td>
                      <Td mono>{row.total_picks}</Td>
                      <Td mono>{fmtPct(row.hit_rate_strict)}</Td>
                      <Td mono>{fmtPct(row.hit_rate_lenient)}</Td>
                      <Td mono color={row.lift_over_baseline != null ? (row.lift_over_baseline > 0 ? COLORS.green : COLORS.orange) : COLORS.dim}>{fmtLift(row.lift_over_baseline)}</Td>
                      <Td mono>{fmtNum(row.avg_winning_gap)}</Td>
                      <td style={{ padding: '0.5rem 0.5rem' }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: st.color, background: `${st.color}20`, border: `1px solid ${st.color}40`, borderRadius: 4, padding: '0.125rem 0.375rem', whiteSpace: 'nowrap', display: 'inline-block' }}>{st.label}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, background: COLORS.surface2 }}>
                          <div style={{ padding: '0.75rem 0.75rem 1rem' }}>
                            <div style={{ fontSize: '0.625rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Per Gap Tier</div>
                            {leagueTiers.length === 0 ? (
                              <div style={{ fontSize: '0.75rem', color: COLORS.dim }}>No tier breakdown available.</div>
                            ) : (
                              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6875rem', minWidth: '100%' }}>
                                  <thead>
                                    <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                      {['Tier', 'Picks', 'Hit%(S)', 'Hit%(L)', 'Avg Win', 'Avg Loss', 'Vers'].map(h => (
                                        <th key={h} style={{ padding: '0.25rem 0.375rem', textAlign: h === 'Tier' ? 'left' : 'right', fontSize: '0.562rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {leagueTiers.map(t => (
                                      <tr key={t.gap_tier} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                        <td style={{ padding: '0.25rem 0.375rem', color: COLORS.text2, maxWidth: '35%', wordBreak: 'break-word' }}>
                                          <span style={{ fontSize: '0.65rem', lineHeight: 1.2 }}>{TIER_LABEL[t.gap_tier] ?? t.gap_tier}</span>
                                        </td>
                                        <DetailTd>{t.total_picks}</DetailTd>
                                        <DetailTd>{fmtPct(t.hit_rate_strict)}</DetailTd>
                                        <DetailTd>{fmtPct(t.hit_rate_lenient)}</DetailTd>
                                        <DetailTd>{fmtNum(t.avg_winning_gap)}</DetailTd>
                                        <DetailTd>{fmtNum(t.avg_losing_gap)}</DetailTd>
                                        <DetailTd>{t.versatility_coverage != null ? `${t.versatility_coverage.toFixed(0)}%` : '—'}</DetailTd>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            <div style={{ fontSize: '0.625rem', color: COLORS.dim, marginTop: '0.5rem', lineHeight: 1.4 }}>
                              Versatility coverage = share of these fixtures where the squad-versatility metric was available. A correlation drawn from low coverage is a hypothesis, not a conclusion.
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: '0.6875rem', color: COLORS.dim, lineHeight: 1.6, maxWidth: '44rem' }}>
        <strong style={{ color: COLORS.muted }}>Reading this page.</strong> Hit Rate is how often the readiness-favored side matched the result — strict counts only outright wins for the favored side; lenient counts a draw as the edge holding. Lift vs Baseline is how much the readiness pick beat naively guessing the league&rsquo;s most common outcome — the honest measure of whether the signal adds anything. Leagues below the sample gate show &ldquo;Insufficient sample&rdquo; rather than a falsely precise number. Nothing here is a recommendation to bet.
      </div>
    </div>
  );
}

function SummaryCard({ title, league, primary, sub, color }: { title: string; league?: string; primary: string; sub: string; color: string }) {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '0.75rem 0.875rem', display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '13rem', flexShrink: 0 }}>
      <div style={{ fontSize: '0.625rem', fontWeight: 700, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: COLORS.text, minHeight: '1rem', wordBreak: 'break-word' }}>{league ?? '—'}</div>
      <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '1rem', fontWeight: 700, color, lineHeight: 1.1 }}>{primary}</div>
      <div style={{ fontSize: '0.625rem', color: COLORS.muted, lineHeight: 1.3 }}>{sub}</div>
    </div>
  );
}

function Th({ label, sortKey, active, dir, onSort, numeric }: { label: string; sortKey?: SortKey; active?: SortKey; dir?: 'asc' | 'desc'; onSort?: (k: SortKey) => void; numeric?: boolean }) {
  const isActive = sortKey && active === sortKey;
  return (
    <th
      onClick={sortKey && onSort ? () => onSort(sortKey) : undefined}
      style={{
        padding: '0.375rem 0.5rem', textAlign: numeric ? 'right' : 'left',
        fontSize: '0.562rem', color: isActive ? COLORS.text : COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700,
        cursor: sortKey ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none',
      }}
    >
      {label}{isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

function Td({ children, mono, color }: { children: React.ReactNode; mono?: boolean; color?: string }) {
  return (
    <td style={{ padding: '0.375rem 0.5rem', textAlign: 'right', fontFamily: mono ? '"JetBrains Mono",monospace' : undefined, color: color ?? COLORS.text2, fontWeight: mono ? 600 : 400, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
      {children}
    </td>
  );
}

function DetailTd({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '0.1875rem 0.375rem', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted, fontSize: '0.625rem', whiteSpace: 'nowrap' }}>{children}</td>;
}
