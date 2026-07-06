'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getLeagueGapSummary, getLeagueGapTiers, LeagueGapSummaryRow, LeagueGapTierRow } from '@/lib/queries';
import { COLORS } from '@/design/tokens';

// ─── LEAGUE ANALYTICS ───────────────────────────────────────────────────────
// Read-only accountability layer: how well the platform's readiness gaps have
// historically tracked real outcomes, per league. STRICTLY INFORMATIONAL —
// neutral "Hit Rate / Historically Consistent / Historically Volatile"
// framing, never ROI / Green-Light / capital-allocation language. Reports the
// losses as plainly as the wins; the user draws their own conclusions.
// See docs/league-gap-analytics-spec.md.

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

  // ── summary cards (gated leagues only — a headline drawn from thin data
  //    would be exactly the false precision this platform avoids) ──
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
    // Which gap tier held up best across all leagues, sample-weighted.
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
      <div style={{ padding: '2rem', maxWidth: '48rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.text, marginBottom: '0.75rem' }}>League Performance &amp; Gap Analytics</h1>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '1.25rem', color: COLORS.muted, fontSize: '0.8125rem', lineHeight: 1.6 }}>
          No analytics yet. This page fills in once the readiness archive has accumulated finished matches and the nightly aggregation has run. The archive is append-only and builds over time — accuracy figures appear per league as each accrues enough completed fixtures to be meaningful.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '75rem', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: COLORS.text }}>League Performance &amp; Gap Analytics</h1>
        <p style={{ fontSize: '0.75rem', color: COLORS.dim, marginTop: '0.25rem', lineHeight: 1.5, maxWidth: '44rem' }}>
          How reliably the platform&rsquo;s readiness gaps have tracked real outcomes, per league. Every figure is the platform&rsquo;s own historical track record — reported as plainly for the misses as the hits. Informational only; not betting advice.
          {freshness && <span> · Updated {freshness}</span>}
        </p>
      </div>

      {/* ── summary cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '0.75rem' }}>
        <SummaryCard
          title="Most Consistent League"
          league={mostConsistent?.league_name}
          primary={mostConsistent ? `${fmtPct(mostConsistent.hit_rate_strict)} strict` : '—'}
          sub={mostConsistent ? `Lift ${fmtLift(mostConsistent.lift_over_baseline)}pp over baseline · N=${mostConsistent.total_picks}` : 'No league meets the sample gate yet'}
          color={COLORS.green}
        />
        <SummaryCard
          title="Most Reliable Signal Tier"
          league={bestTier ? TIER_LABEL[bestTier.tier] : undefined}
          primary={bestTier ? `${bestTier.rate.toFixed(1)}% strict` : '—'}
          sub={bestTier ? `Across all leagues · N=${bestTier.total}` : 'Insufficient data'}
          color={COLORS.text}
        />
        <SummaryCard
          title="Highest-Variance League"
          league={mostVolatile?.league_name}
          primary={mostVolatile ? `${fmtPct(mostVolatile.hit_rate_strict)} strict` : '—'}
          sub={mostVolatile ? `Readiness gaps least reliable here · N=${mostVolatile.total_picks}` : 'None flagged'}
          color={COLORS.orange}
        />
      </div>

      {/* ── filters ── */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {([['all', 'All Leagues'], ['consistent', 'Historically Consistent'], ['volatile', 'Historically Volatile']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              fontSize: '0.75rem', fontWeight: 600, padding: '0.375rem 0.75rem', borderRadius: 6, cursor: 'pointer',
              background: filter === k ? COLORS.surface2 : 'transparent',
              border: `1px solid ${filter === k ? COLORS.text2 : COLORS.border}`,
              color: filter === k ? COLORS.text : COLORS.muted,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── matrix ── */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem', minWidth: '46rem' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                <Th label="League" />
                <Th label="Picks" sortKey="total_picks" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Hit % (strict)" sortKey="hit_rate_strict" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Hit % (lenient)" sortKey="hit_rate_lenient" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Lift vs Baseline" sortKey="lift_over_baseline" active={sortKey} dir={sortDir} onSort={setSort} numeric />
                <Th label="Avg Win Gap" sortKey="avg_winning_gap" active={sortKey} dir={sortDir} onSort={setSort} numeric />
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
                      <td style={{ padding: '0.625rem 0.875rem', color: COLORS.text, fontWeight: 600 }}>
                        <span style={{ color: COLORS.dim, marginRight: '0.5rem', fontSize: '0.6875rem' }}>{isOpen ? '▾' : '▸'}</span>
                        {row.league_name}
                      </td>
                      <Td mono>{row.total_picks}</Td>
                      <Td mono>{fmtPct(row.hit_rate_strict)}</Td>
                      <Td mono>{fmtPct(row.hit_rate_lenient)}</Td>
                      <Td mono color={row.lift_over_baseline != null ? (row.lift_over_baseline > 0 ? COLORS.green : COLORS.orange) : COLORS.dim}>{fmtLift(row.lift_over_baseline)}</Td>
                      <Td mono>{fmtNum(row.avg_winning_gap)}</Td>
                      <td style={{ padding: '0.625rem 0.875rem' }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: st.color, background: `${st.color}20`, border: `1px solid ${st.color}40`, borderRadius: 4, padding: '0.125rem 0.5rem', whiteSpace: 'nowrap' }}>{st.label}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, background: COLORS.surface2 }}>
                          <div style={{ padding: '0.75rem 1rem 1rem' }}>
                            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Per Gap Tier</div>
                            {leagueTiers.length === 0 ? (
                              <div style={{ fontSize: '0.75rem', color: COLORS.dim }}>No tier breakdown available.</div>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                                <thead>
                                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                    {['Tier', 'Picks', 'Hit % (strict)', 'Hit % (lenient)', 'Avg Win Gap', 'Avg Loss Gap', 'Versatility Cov.'].map(h => (
                                      <th key={h} style={{ padding: '0.375rem 0.625rem', textAlign: h === 'Tier' ? 'left' : 'right', fontSize: '0.625rem', color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {leagueTiers.map(t => (
                                    <tr key={t.gap_tier} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                      <td style={{ padding: '0.375rem 0.625rem', color: COLORS.text2 }}>{TIER_LABEL[t.gap_tier] ?? t.gap_tier}</td>
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
                            )}
                            <div style={{ fontSize: '0.6875rem', color: COLORS.dim, marginTop: '0.625rem', lineHeight: 1.5 }}>
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
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</div>
      <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: COLORS.text, minHeight: '1.25rem' }}>{league ?? '—'}</div>
      <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '1.25rem', fontWeight: 700, color, lineHeight: 1.1 }}>{primary}</div>
      <div style={{ fontSize: '0.6875rem', color: COLORS.muted, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

function Th({ label, sortKey, active, dir, onSort, numeric }: { label: string; sortKey?: SortKey; active?: SortKey; dir?: 'asc' | 'desc'; onSort?: (k: SortKey) => void; numeric?: boolean }) {
  const isActive = sortKey && active === sortKey;
  return (
    <th
      onClick={sortKey && onSort ? () => onSort(sortKey) : undefined}
      style={{
        padding: '0.5rem 0.875rem', textAlign: numeric ? 'right' : 'left',
        fontSize: '0.625rem', color: isActive ? COLORS.text : COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700,
        cursor: sortKey ? 'pointer' : 'default', whiteSpace: 'nowrap', userSelect: 'none',
      }}
    >
      {label}{isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}

function Td({ children, mono, color }: { children: React.ReactNode; mono?: boolean; color?: string }) {
  return (
    <td style={{ padding: '0.625rem 0.875rem', textAlign: 'right', fontFamily: mono ? '"JetBrains Mono",monospace' : undefined, color: color ?? COLORS.text2, fontWeight: mono ? 600 : 400 }}>
      {children}
    </td>
  );
}

function DetailTd({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '0.375rem 0.625rem', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted }}>{children}</td>;
}
