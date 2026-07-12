import { COLORS, withAlpha } from '@/design/tokens';

/**
 * MARKET SIGNAL PANEL — per-market view for the match page.
 *
 * Shows every tracked market. Markets with a published (calibrated) signal
 * get direction + the rule's rationale + its measured historical record;
 * everything else honestly reads "No calibrated signal" — the platform
 * never fills silence with a guess. Calibration transparency is the
 * product's core trust mechanic: every claim carries its receipts.
 *
 * Integration (match page server component):
 *
 *   const { data: sigs } = await supabase.from('match_signals')
 *     .select('*').eq('match_id', id).eq('signal_group', 'pitchterminal');
 *   <MarketSignalPanel signals={sigs ?? []} />
 */

export interface StoredMarketSignal {
  market: string;
  direction: string;       // 'positive' | 'neutral' | 'negative'
  strength: number;        // 1–100, lift-derived
  drivers: string | null;  // rationale + historical record sentence
  rule_key: string | null;
}

const MARKETS: Array<{ key: string; label: string }> = [
  { key: 'HOME_WIN',  label: 'Home Win' },
  { key: 'AWAY_WIN',  label: 'Away Win' },
  { key: 'DRAW',      label: 'Draw' },
  { key: 'OVER_2_5',  label: 'Over 2.5 Goals' },
  { key: 'UNDER_2_5', label: 'Under 2.5 Goals' },
  { key: 'BTTS',      label: 'Both Teams To Score' },
];

const DIR_META: Record<string, { symbol: string; color: string; label: string }> = {
  positive: { symbol: '▲', color: COLORS.green,  label: 'Positive' },
  neutral:  { symbol: '■', color: COLORS.amber,  label: 'Neutral' },
  negative: { symbol: '▼', color: COLORS.red,    label: 'Negative' },
};

export default function MarketSignalPanel({ signals }: { signals: StoredMarketSignal[] }) {
  const byMarket = new Map<string, StoredMarketSignal[]>();
  for (const s of signals) {
    const list = byMarket.get(s.market) ?? [];
    list.push(s);
    byMarket.set(s.market, list);
  }

  return (
    <section style={{
      border: COLORS.cardBorder, boxShadow: COLORS.shadowCard, borderRadius: 12,
      background: COLORS.surface, padding: 18, marginBottom: 16,
    }}>
      <div style={{ fontSize: 10.5, letterSpacing: 2, color: COLORS.blue, fontFamily: 'var(--font-mono, monospace)', marginBottom: 12 }}>
        BETTING SIGNALS
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {MARKETS.map((mkt, i) => {
          const rows = (byMarket.get(mkt.key) ?? [])
            .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
          const top = rows[0] ?? null;
          const dir = top ? (DIR_META[top.direction] ?? DIR_META.neutral) : null;

          return (
            <div key={mkt.key} style={{
              display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12,
              padding: '10px 0',
              borderTop: i === 0 ? 'none' : `1px solid ${COLORS.border}`,
              alignItems: 'start',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>
                {mkt.label}
                {top && dir && (
                  <div style={{
                    marginTop: 4, display: 'inline-block', fontSize: 10.5, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 4,
                    color: dir.color, background: withAlpha(dir.color, '18'),
                  }}>
                    {dir.symbol} {dir.label}
                  </div>
                )}
              </div>

              <div style={{ fontSize: 12.5, lineHeight: 1.55, color: top ? COLORS.text2 : COLORS.dim }}>
                {top?.drivers
                  ? top.drivers
                  : 'No calibrated signal — the engine has no measured edge on this market here, and it will not guess.'}
                {rows.slice(1).map(extra => (
                  <div key={extra.rule_key ?? extra.drivers} style={{ marginTop: 4, color: COLORS.muted }}>
                    {extra.drivers}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: 12, marginBottom: 0, fontSize: 10.5, color: COLORS.dim, lineHeight: 1.5 }}>
        Signals are published only when the underlying rule has a measured historical hit rate above
        the market's base rate (sample ≥ 200). Absence of a signal is information too.
      </p>
    </section>
  );
}
