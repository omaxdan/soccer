// MATCH INTELLIGENCE — reading surface (read-only, SSR).
//
// The Match Intelligence tab presents the reading taken at kickoff, in product
// language. It renders the /matches/:id/intelligence contract WITHOUT exposing any
// internal vocabulary — no "sealed", "governed", "snapshot", "provenance", version,
// checksum or feature id ever reaches the page. It computes no football: consensus
// counts, edges, module verdicts and cited values are shown exactly as supplied, and
// a null edge / confidence / risk is an honest "not recorded", never a fabricated 0.
//
// Structure (per the Match wireframe): the reading at kickoff (dates + consensus +
// edges), the module readings behind it, the evidence it cited, how each side has
// responded historically, and an honest near-future note.

import type {
  MatchIntelligence, IntelligenceVerdict, CitedEvidenceItem, IntelligenceModuleReading,
  HistoricalResponseSide,
} from '@/lib/v2/types';
import {
  formatRatioPercent, trimNumericText, humanizeFeatureKey,
  shortUtcDate, readingDates, subjectLabel, evidenceKindLabel, moduleStatusWord,
} from '@/lib/v2/matchIntelligence';

// ── shared bits ──────────────────────────────────────────────────────────────────

function Unavailable({ text }: { text: string }) {
  return <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 11 }}>{text}</span>;
}

// ── 1. READING AT KICKOFF (the NOW reading) ────────────────────────────────────────

function CountChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="panel-raised" style={{ padding: '8px 10px', borderRadius: 6, minWidth: 80, flex: '1 1 80px' }}>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
      <p className="mono tnum" style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{count}</p>
    </div>
  );
}

// The comparative edges the reading recorded, in order. Only non-null edges are shown;
// the rest are summarised honestly ("not recorded") — never listed as zero.
const EDGE_FIELDS: readonly { label: string; pick: (v: IntelligenceVerdict) => string | null }[] = [
  { label: 'Form edge', pick: (v) => v.formEdge },
  { label: 'Rest edge', pick: (v) => v.restEdge },
  { label: 'Readiness edge', pick: (v) => v.readinessEdge },
  { label: 'Travel edge', pick: (v) => v.travelEdge },
  { label: 'Congestion edge', pick: (v) => v.congestionEdge },
  { label: 'Availability edge', pick: (v) => v.availabilityEdge },
];

/**
 * The reading at kickoff: when it was taken / locked / evidence-dated, the
 * non-directional consensus across modules, the evidence completeness, and the
 * comparative edges that were recorded. Edges/risk/confidence that were not recorded
 * are stated as such, never shown as zero.
 */
export function ReadingAtKickoff({ intelligence }: { intelligence: MatchIntelligence }) {
  const { verdict, modules, citedEvidence, provenance } = intelligence;
  const dates = readingDates(provenance, modules, citedEvidence);
  const edges = EDGE_FIELDS.map((e) => ({ label: e.label, value: e.pick(verdict) })).filter((e) => e.value !== null) as { label: string; value: string }[];
  const missing = EDGE_FIELDS.filter((e) => e.pick(verdict) === null).map((e) => e.label);
  return (
    <section className="space-y-3" aria-label="reading at kickoff">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <p className="eyebrow" style={{ color: 'var(--amber)', letterSpacing: '0.16em' }}>Reading at kickoff</p>
      </div>
      <p className="label-cap tnum" style={{ color: 'var(--text-secondary)', fontSize: 11, letterSpacing: '0.04em' }}>
        Taken at kickoff {shortUtcDate(dates.takenAt)} · Locked {shortUtcDate(dates.lockedAt)}
        {dates.evidenceAsOf ? ` · Evidence as of ${shortUtcDate(dates.evidenceAsOf)}` : ''}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <CountChip label="Supports" count={verdict.consensusSupportsCount} color="var(--edge)" />
        <CountChip label="Contradicts" count={verdict.consensusContradictsCount} color="var(--risk)" />
        <CountChip label="Neutral" count={verdict.consensusNeutralCount} color="var(--muted)" />
        <CountChip label="Not enough data" count={verdict.consensusInactiveCount} color="var(--faint)" />
      </div>

      <div className="panel" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="label-cap" style={{ color: 'var(--text-secondary)' }}>Evidence completeness</span>
        <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700 }}>
          {formatRatioPercent(verdict.completenessRatio)}
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginLeft: 6 }}>
            {verdict.evidenceCount} module{verdict.evidenceCount === 1 ? '' : 's'} with evidence
          </span>
        </span>
      </div>

      {edges.length > 0 && (
        <div>
          <p className="label-cap" style={{ color: 'var(--muted)', marginBottom: 4 }}>Comparative edges (home relative)</p>
          <div className="panel" style={{ padding: '4px 12px' }}>
            {edges.map((e) => (
              <div key={e.label} className="hairline" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="label-cap" style={{ color: 'var(--text-secondary)' }}>{e.label}</span>
                <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700 }}>{trimNumericText(e.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Edges are descriptive comparisons over the stated window — not forecasts or recommendations.
        {missing.length > 0 ? ` Not recorded for this match: ${missing.join(', ').toLowerCase()}${verdict.riskScore === null ? ', risk' : ''}${verdict.confidence === null ? ', confidence' : ''}.` : ''}
      </p>
    </section>
  );
}

// ── 2. MODULE READINGS (flat, in display order) ─────────────────────────────────────

/**
 * The individual module readings the consensus was tallied from, in the reading's own
 * display order. Each shows its number, name, subject (a team, or the fixture), status
 * word, verbatim verdict and sample. No module version or internal id is shown.
 */
export function ModuleReadings({ modules, homeTeamId, homeName, awayTeamId, awayName }: {
  modules: readonly IntelligenceModuleReading[];
  homeTeamId: string | null; homeName: string; awayTeamId: string | null; awayName: string;
}) {
  const ordered = [...modules].sort((a, b) => a.displayNumber - b.displayNumber);
  return (
    <section className="space-y-2" aria-label="module readings">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Module readings</p>
        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{ordered.length}</span>
      </div>
      {ordered.length === 0 ? (
        <Unavailable text="No module readings recorded for this match." />
      ) : (
        <div className="space-y-2">
          {ordered.map((m) => {
            const sw = moduleStatusWord(m.status);
            const subject = subjectLabel(m.subjectKindCode, m.subjectTeamId, homeTeamId, homeName, awayTeamId, awayName);
            return (
              <div key={`${m.moduleKey}-${m.subjectTeamId ?? 'fixture'}-${m.displayNumber}`} className="panel-raised" style={{ padding: 12, borderRadius: 8 }}
                aria-label={`${m.displayName} · ${subject} · ${sw.word}`}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span className="mono tnum" style={{ color: 'var(--faint)', fontSize: 11 }}>{String(m.displayNumber).padStart(2, '0')}</span>
                  <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{m.displayName}</span>
                  <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{subject}</span>
                  <span className="label-cap" style={{ marginLeft: 'auto', color: sw.color, fontWeight: 700 }}>{sw.word}</span>
                </div>
                {sw.engaged && m.verdictText && <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{m.verdictText}</p>}
                <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 4 }}>
                  sample {m.sampleObservationCount}{m.sampleMeetsThreshold ? '' : ' · small sample'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── 3. CITED EVIDENCE ───────────────────────────────────────────────────────────────

/** The evidence the reading cited: input, team, value, kind (Recorded / Derived) and
 *  sample. Feature ids, versions and checksums are never shown. */
export function CitedEvidenceTable({ citedEvidence, homeTeamId, homeName, awayTeamId, awayName }: {
  citedEvidence: readonly CitedEvidenceItem[];
  homeTeamId: string | null; homeName: string; awayTeamId: string | null; awayName: string;
}) {
  const n = citedEvidence.length;
  const team = (id: string | null) => (id && id === homeTeamId ? homeName : id && id === awayTeamId ? awayName : '—');
  return (
    <details className="panel" style={{ padding: '10px 12px' }}>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none' }}>
        <span className="eyebrow">Cited evidence</span>
        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 10, marginLeft: 'auto' }}>{n} input{n === 1 ? '' : 's'}</span>
      </summary>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 6 }}>
        The exact inputs the reading referenced. Values are shown as recorded; nothing is recomputed.
      </p>
      {n === 0 ? (
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11, marginTop: 8 }}>No cited inputs recorded.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 420 }}>
            <caption className="sr-only">Evidence cited by the reading at kickoff.</caption>
            <thead><tr>
              <th scope="col" style={thL}>Input</th>
              <th scope="col" style={thL}>Team</th>
              <th scope="col" style={thR}>Value</th>
              <th scope="col" style={thL}>Kind</th>
              <th scope="col" style={thR}>Sample</th>
            </tr></thead>
            <tbody>
              {citedEvidence.map((it, i) => (
                <tr key={`${it.featureKey}-${it.subjectTeamId ?? 'x'}-${i}`} style={{ background: i % 2 === 0 ? 'color-mix(in srgb, var(--raised) 30%, transparent)' : 'transparent' }}>
                  <th scope="row" style={{ ...tdL, fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'normal' }}>{humanizeFeatureKey(it.featureKey)}</th>
                  <td style={tdL}>{team(it.subjectTeamId)}</td>
                  <td style={tdR} className="mono tnum">{trimNumericText(it.value)}</td>
                  <td style={tdL}>{evidenceKindLabel(it.provenanceClassCode)}</td>
                  <td style={tdR} className="tnum">{it.sampleObservationCount}{it.sampleMeetsThreshold ? '' : '*'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 4 }}>* small sample.</p>
        </div>
      )}
    </details>
  );
}

// ── 4. HISTORICAL RESPONSE (PAST — not part of the kickoff reading) ─────────────────

function TriggerLine({ label, t }: { label: string; t: { engaged: boolean; n: number; response: { wins: number; draws: number; losses: number } } }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
      <span className="label-cap" style={{ color: 'var(--muted)' }}>
        {label}
        {t.engaged && <span className="label-cap" style={{ color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, padding: '0 5px', fontSize: 8, marginLeft: 6 }}>APPLIES</span>}
      </span>
      <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 12 }}>
        W{t.response.wins} D{t.response.draws} L{t.response.losses}
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginLeft: 6 }}>n {t.n}</span>
      </span>
    </div>
  );
}

function HistoricalSide({ name, side }: { name: string; side: HistoricalResponseSide | null }) {
  return (
    <div className="panel" style={{ padding: 12 }}>
      <p className="label-cap" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{name}</p>
      {!side ? (
        <Unavailable text="No historical response recorded." />
      ) : (
        <>
          <TriggerLine label="After a win" t={side.triggers.POST_WIN} />
          <TriggerLine label="After a loss" t={side.triggers.POST_LOSS} />
        </>
      )}
    </div>
  );
}

/** How each side has historically responded after a win / after a loss. "APPLIES"
 *  marks the trigger relevant to this fixture. This is historical context — explicitly
 *  not part of the kickoff reading, and never linked to this match's result. */
export function HistoricalResponse({ historicalResponse, homeName, awayName }: {
  historicalResponse: { home: HistoricalResponseSide | null; away: HistoricalResponseSide | null } | null | undefined;
  homeName: string; awayName: string;
}) {
  if (!historicalResponse) return null;
  return (
    <section className="space-y-2" aria-label="historical response">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Historical response</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>past · not part of the kickoff reading</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <HistoricalSide name={homeName} side={historicalResponse.home} />
        <HistoricalSide name={awayName} side={historicalResponse.away} />
      </div>
    </section>
  );
}

// ── 5. NEAR FUTURE (honest none) ────────────────────────────────────────────────────

export function NearFutureNote() {
  return (
    <section className="space-y-2" aria-label="near future">
      <p className="eyebrow">Near future</p>
      <div className="panel" style={{ padding: 14 }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>No forward-looking reading is recorded for this fixture.</p>
      </div>
    </section>
  );
}

// ── honest unavailable state (no reading) ────────────────────────────────────────────

/** Shown when a fixture has no kickoff reading yet. The fixture and its context still
 *  render — intelligence is honestly "not available", never fabricated from live data. */
export function IntelligenceUnavailable() {
  return (
    <section className="panel" aria-label="match intelligence unavailable"
      style={{ padding: 16, borderColor: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 5%, var(--panel))' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow" style={{ color: 'var(--amber)' }}>Match Intelligence</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, border: '1px solid var(--faint)', borderRadius: 4, padding: '0 5px' }}>not available</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>
        Intelligence is not available for this match yet.
      </p>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 6 }}>
        The reading at kickoff — consensus, edges, module readings and the evidence behind them — appears once it is taken. The contextual match information is available now.
      </p>
    </section>
  );
}

const thL: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400, whiteSpace: 'nowrap' };
const thR: React.CSSProperties = { ...thL, textAlign: 'right' };
const tdL: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap' };
const tdR: React.CSSProperties = { ...tdL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
