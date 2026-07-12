import { COLORS, scoreColor, withAlpha } from '@/design/tokens';

/**
 * EXECUTIVE BRIEF — the first thing a user sees on a match page under the
 * PitchTerminal experience. Renders the precomputed narrative + headline
 * signals/warnings + risk/opportunity/predictability strip from
 * match_opportunity and match_risk_intelligence. Presentational only.
 *
 * Deliberately named "Brief", not "Decision" — this is decision SUPPORT.
 * The disclaimer strip is part of the component by design; if it must be
 * moved, keep it visible somewhere on every page that renders signals.
 *
 * Integration (match page server component):
 *
 *   const [{ data: opp }, { data: risk }] = await Promise.all([
 *     supabase.from('match_opportunity').select('*').eq('match_id', id).maybeSingle(),
 *     supabase.from('match_risk_intelligence').select('*').eq('match_id', id).maybeSingle(),
 *   ]);
 *   {opp && <ExecutiveBrief opp={opp} risk={risk} />}
 *
 * Everything below it (readiness breakdown, NBSI, key player battle,
 * lineups) remains untouched — Legacy Intelligence stays fully available.
 */

interface Headline { key: string; text: string; }

export interface ExecutiveBriefProps {
  opp: {
    opportunity_score: number | null;
    executive_brief: string | null;
    signals: Headline[] | null;
    warnings: Headline[] | null;
  };
  risk?: {
    risk_score: number | null;
    risk_band: 'LOW' | 'MEDIUM' | 'HIGH' | null;
    predictability_score: number | null;
    risk_factors?: Array<{ key: string; label: string; points: number }>;
  } | null;
}

const BAND_COLOR: Record<string, string> = {
  LOW: COLORS.green, MEDIUM: COLORS.amber, HIGH: COLORS.red,
};

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 92 }}>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', color }}>
        {value}
      </div>
      <div style={{ fontSize: 9.5, letterSpacing: 1.4, color: COLORS.dim }}>{label}</div>
    </div>
  );
}

export default function ExecutiveBrief({ opp, risk }: ExecutiveBriefProps) {
  const signals = (opp.signals ?? []).slice(0, 3);
  const warnings = (opp.warnings ?? []).slice(0, 3);
  const bandColor = BAND_COLOR[risk?.risk_band ?? ''] ?? COLORS.dim;

  return (
    <section style={{
      border: COLORS.cardBorder, boxShadow: COLORS.shadowCard, borderRadius: 12,
      background: COLORS.surface, padding: 18, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <div style={{ fontSize: 10.5, letterSpacing: 2, color: COLORS.blue, fontFamily: 'var(--font-mono, monospace)', marginBottom: 6 }}>
            EXECUTIVE BRIEF
          </div>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: COLORS.text }}>
            {opp.executive_brief ?? 'Intelligence brief not yet generated for this match.'}
          </p>

          {(signals.length > 0 || warnings.length > 0) && (
            <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.6 }}>
              {signals.map(s => (
                <div key={s.key} style={{ color: COLORS.text2 }}>
                  <span style={{ color: COLORS.green, fontWeight: 700 }}>+ </span>{s.text}
                </div>
              ))}
              {warnings.map(w => (
                <div key={w.key} style={{ color: COLORS.muted }}>
                  <span style={{ color: COLORS.orange, fontWeight: 700 }}>− </span>{w.text}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Stat
            label="OPPORTUNITY"
            value={opp.opportunity_score != null ? String(opp.opportunity_score) : '—'}
            color={scoreColor(opp.opportunity_score)}
          />
          <Stat
            label="MATCH RISK"
            value={risk?.risk_score != null ? `${risk.risk_score}` : '—'}
            color={bandColor}
          />
          <Stat
            label="PREDICTABILITY"
            value={risk?.predictability_score != null ? String(risk.predictability_score) : '—'}
            color={scoreColor(risk?.predictability_score)}
          />
        </div>
      </div>

      {risk?.risk_band && (
        <div style={{
          marginTop: 12, display: 'inline-block', fontSize: 11, fontWeight: 700,
          padding: '3px 10px', borderRadius: 4, color: bandColor,
          background: withAlpha(bandColor, '18'),
        }}>
          {risk.risk_band} RISK MATCH
        </div>
      )}

      <p style={{ marginTop: 12, marginBottom: 0, fontSize: 10.5, color: COLORS.dim, lineHeight: 1.5 }}>
        Informational intelligence, not betting advice. Historical patterns do not guarantee outcomes.
      </p>
    </section>
  );
}
