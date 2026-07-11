import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { toOne } from '@/lib/relations';
import { matchUrl } from '@/lib/urls';
import { COLORS, scoreColor, withAlpha } from '@/design/tokens';

export const metadata = { title: 'Terminal — Betting Intelligence' };
export const revalidate = 900;

/**
 * PITCHTERMINAL BETTING DASHBOARD
 *
 * Today's + tomorrow's matches ranked by opportunity_score (how much
 * exploitable asymmetry the intelligence sees), each carrying its risk
 * band, headline signals, and warnings — all precomputed by
 * processRiskOpportunity on the backend. This page renders; it never
 * computes intelligence. Raw analytics remain fully available on the
 * match pages (Legacy Intelligence).
 */

interface Headline { key: string; text: string; }

const BAND_COLOR: Record<string, string> = {
  LOW: COLORS.green, MEDIUM: COLORS.amber, HIGH: COLORS.red,
};

function confidenceLabel(band: string | null | undefined): { label: string; color: string } {
  const b = (band ?? '').toUpperCase();
  if (b === 'HIGH') return { label: 'High', color: COLORS.green };
  if (b === 'MEDIUM') return { label: 'Medium', color: COLORS.amber };
  if (b === 'LOW') return { label: 'Low', color: COLORS.orange };
  return { label: '—', color: COLORS.dim };
}

async function getTerminalMatches() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 86_400_000);

  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, date, competition, status,
      home_team:teams!matches_home_team_id_fkey(id, name, slug),
      away_team:teams!matches_away_team_id_fkey(id, name, slug),
      match_opportunity(opportunity_score, executive_brief, signals, warnings),
      match_risk_intelligence(risk_score, risk_band, predictability_score),
      match_intelligence(confidence_band, readiness_gap),
      match_signals(market, drivers, rule_key, signal_group, strength)
    `)
    .gte('date', start.toISOString())
    .lt('date', end.toISOString())
    .not('status', 'in', '(postponed,cancelled,canceled,abandoned,finished)')
    .order('date', { ascending: true })
    .limit(300);

  if (error || !data) return [];

  return data
    .map((m: any) => ({
      ...m,
      opp: toOne(m.match_opportunity),
      risk: toOne(m.match_risk_intelligence),
      intel: toOne(m.match_intelligence),
      marketSignals: (m.match_signals ?? []).filter((s: any) => s.signal_group === 'pitchterminal'),
    }))
    .filter((m: any) => m.opp != null)
    .sort((a: any, b: any) => (b.opp?.opportunity_score ?? 0) - (a.opp?.opportunity_score ?? 0));
}

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
      color, background: withAlpha(color, '18'), whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

export default async function TerminalPage() {
  const rows = await getTerminalMatches();

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: 4, fontSize: 12, letterSpacing: 2, color: COLORS.blue, fontFamily: 'var(--font-mono, monospace)' }}>
        PITCHTERMINAL
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: COLORS.text, margin: 0 }}>
        Betting Intelligence Terminal
      </h1>
      <p style={{ color: COLORS.muted, fontSize: 13, marginTop: 6, marginBottom: 24 }}>
        Next 48 hours, ranked by how much exploitable asymmetry the intelligence engine sees.
        Every signal shown here carries a measured historical record.
      </p>

      {rows.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: COLORS.muted, border: COLORS.cardBorder, borderRadius: 10, background: COLORS.surface }}>
          No processed matches in the window yet. The opportunity engine runs on the daily pipeline.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((m: any) => {
          const home = toOne(m.home_team);
          const away = toOne(m.away_team);
          const score = m.opp?.opportunity_score ?? 0;
          const risk = m.risk;
          const conf = confidenceLabel(m.intel?.confidence_band);
          const signals: Headline[] = (m.opp?.signals ?? []).slice(0, 3);
          const warnings: Headline[] = (m.opp?.warnings ?? []).slice(0, 3);
          const ko = new Date(m.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          const day = new Date(m.date).toLocaleDateString('en-GB', { weekday: 'short' });

          return (
            <Link key={m.id} href={matchUrl({ id: m.id, home_team: home, away_team: away } as any)} style={{ textDecoration: 'none' }}>
              <div style={{
                border: COLORS.cardBorder, boxShadow: COLORS.shadowCard, borderRadius: 10,
                background: COLORS.surface, padding: 16,
                display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'start',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.text }}>
                      {home?.name} <span style={{ color: COLORS.dim, fontWeight: 400 }}>vs</span> {away?.name}
                    </span>
                    <span style={{ fontSize: 11, color: COLORS.dim, fontFamily: 'var(--font-mono, monospace)' }}>
                      {day} {ko} · {m.competition}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {risk?.risk_band && <Pill text={`Risk ${risk.risk_band} · ${risk.risk_score}`} color={BAND_COLOR[risk.risk_band] ?? COLORS.dim} />}
                    <Pill text={`Confidence ${conf.label}`} color={conf.color} />
                    {m.marketSignals.slice(0, 3).map((s: any) => (
                      <Pill key={s.rule_key + s.market} text={`▲ ${s.market.replace(/_/g, ' ')}`} color={COLORS.blue} />
                    ))}
                  </div>

                  {signals.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.55 }}>
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

                <div style={{ textAlign: 'center', minWidth: 84 }}>
                  <div style={{
                    fontSize: 30, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)',
                    color: scoreColor(score),
                  }}>
                    {score}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: 1.2, color: COLORS.dim }}>OPPORTUNITY</div>
                  {risk?.predictability_score != null && (
                    <div style={{ fontSize: 10.5, color: COLORS.muted, marginTop: 6 }}>
                      Predictability {risk.predictability_score}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <p style={{ marginTop: 28, fontSize: 11, color: COLORS.dim, lineHeight: 1.6 }}>
        PitchTerminal surfaces football market intelligence for informational purposes only.
        Nothing here is betting advice or a guarantee of outcomes; historical hit rates do not
        predict future results. Bet only where legal for you, and only what you can afford to lose.
      </p>
    </div>
  );
}
