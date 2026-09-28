// MATCH INTELLIGENCE — sealed reading surfaces (read-only, SSR).
//
// The Match Intelligence tab presents the reading taken at kickoff, composed to the
// authoritative Match wireframe: a locked SUMMARY (consensus counts + segment bar +
// completeness), the comparative EDGES, the numbered MODULE READINGS, the
// PREPAREDNESS panel, and — in the rail — the CITED EVIDENCE table.
//
// It renders the /matches/:id/intelligence contract WITHOUT exposing any internal
// vocabulary: no "sealed", "governed", "snapshot", "provenance", version, checksum or
// id ever reaches the page. It computes no football — consensus counts, edges, module
// verdicts, preparedness points and cited values are shown exactly as supplied; a null
// edge / confidence / risk / preparedness score is an honest "not recorded", never a
// fabricated 0. Comparative edges are home-relative BY CONTRACT, so "Favours <team>"
// from the sign is a faithful read, not an inference.

import type {
  MatchIntelligence, CitedEvidenceItem, IntelligenceModuleReading, PreparednessSideView,
  HistoricalResponseSide,
} from '@/lib/v2/types';
import {
  formatRatioPercent, trimNumericText, humanizeFeatureKey, preparednessScoreDisplay,
  shortUtcDate, subjectLabel, evidenceKindLabel, moduleStatusWord,
  edgeFavours, EDGE_FIELDS, consensusSegments,
} from '@/lib/v2/matchIntelligence';

function Unavailable({ text }: { text: string }) {
  return <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 11 }}>{text}</span>;
}

// ── 1. INTELLIGENCE SUMMARY — lock band + consensus + completeness ──────────────────

function ConsensusCount({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 64 }}>
      <span className="mono tnum" style={{ color, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{count}</span>
      <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 9 }}>{label}</span>
    </div>
  );
}

/** The locked summary of the reading: when it was locked, the non-directional module
 *  consensus with a per-module segment bar, and the evidence completeness. */
export function IntelligenceSummary({ intelligence }: { intelligence: MatchIntelligence }) {
  const { verdict, provenance } = intelligence;
  const segments = consensusSegments(verdict);
  return (
    <section className="space-y-3" aria-label="reading at kickoff">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <p className="eyebrow" style={{ color: 'var(--amber)', letterSpacing: '0.16em' }}>Reading at kickoff</p>
        <span className="label-cap" style={{ marginLeft: 'auto', color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, padding: '1px 7px', fontSize: 9 }}>
          Locked at kickoff · {shortUtcDate(provenance.sealedAt)}
        </span>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 9, marginBottom: 8 }}>Module consensus</p>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <ConsensusCount label="Supports" count={verdict.consensusSupportsCount} color="var(--edge)" />
          <ConsensusCount label="Counters" count={verdict.consensusContradictsCount} color="var(--risk)" />
          <ConsensusCount label="Neutral" count={verdict.consensusNeutralCount} color="var(--cool)" />
          <ConsensusCount label="Inactive" count={verdict.consensusInactiveCount} color="var(--faint)" />
        </div>
        {segments.length > 0 && (
          <div aria-hidden style={{ display: 'flex', gap: 2, marginTop: 12 }}>
            {segments.map((s, i) => (
              <div key={i} style={{ flex: 1, height: 6, borderRadius: 1, background: s.color }} />
            ))}
          </div>
        )}
      </div>

      <div className="panel" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="label-cap" style={{ color: 'var(--text-secondary)' }}>Completeness</span>
          <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700 }}>{formatRatioPercent(verdict.completenessRatio, 0)}</span>
        </div>
        <div aria-hidden style={{ height: 5, borderRadius: 2, background: 'var(--line)', marginTop: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: formatRatioPercent(verdict.completenessRatio, 0), background: 'var(--amber)' }} />
        </div>
        <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 6 }}>
          {verdict.evidenceCount} module{verdict.evidenceCount === 1 ? '' : 's'} with evidence inputs
        </p>
      </div>
    </section>
  );
}

// ── 2. EDGE GRID — six home-relative comparative edges ──────────────────────────────

/** The comparative edges the reading recorded, as tiles. Each shows the signed
 *  magnitude and the favoured side ("Favours <team>"), or an honest "Not available"
 *  for a null edge — never a fabricated 0. */
export function EdgeGrid({ verdict, homeName, awayName }: {
  verdict: MatchIntelligence['verdict']; homeName: string; awayName: string;
}) {
  return (
    <section className="space-y-2" aria-label="comparative edges">
      <p className="eyebrow">Edges</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        {EDGE_FIELDS.map((e) => {
          const d = edgeFavours(e.pick(verdict), homeName, awayName);
          return (
            <div key={e.label} className="panel" style={{ padding: '10px 12px' }}>
              <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 9 }}>{e.label}</p>
              {d.present ? (
                <>
                  <p className="mono tnum" style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700, marginTop: 2 }}>{d.magnitude}</p>
                  <p className="label-cap" style={{ color: d.favours ? 'var(--text-secondary)' : 'var(--faint)', fontSize: 9, marginTop: 2 }}>
                    {d.favours ? `Favours ${d.favours}` : 'Level'}
                  </p>
                </>
              ) : (
                <>
                  <p className="mono" style={{ color: 'var(--faint)', fontSize: 18, marginTop: 2 }}>—</p>
                  <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 2 }}>Not available</p>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Edges are descriptive comparisons over the stated window — not forecasts or recommendations.
      </p>
    </section>
  );
}

// ── 3. MODULE READINGS — numbered, expandable ───────────────────────────────────────

/** The individual module readings the consensus was tallied from, in display order.
 *  Each shows its number, name, subject (a team or the fixture), status word, verbatim
 *  verdict and sample; the detail expands in place. No module version or id is shown. */
export function ModuleReadingList({ modules, homeTeamId, homeName, awayTeamId, awayName }: {
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
            const hasDetail = sw.engaged && !!m.verdictText;
            const Head = (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span className="mono tnum" style={{ color: 'var(--faint)', fontSize: 11 }}>{String(m.displayNumber).padStart(2, '0')}</span>
                <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{m.displayName}</span>
                <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{subject}</span>
                <span className="label-cap" style={{ marginLeft: 'auto', color: sw.color, fontWeight: 700 }}>{sw.word}</span>
              </div>
            );
            const meta = (
              <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 4 }}>
                {subject === 'Fixture' ? 'Fixture' : 'Match'} · {m.sampleObservationCount} obs{m.sampleMeetsThreshold ? '' : ' · low sample'}
              </p>
            );
            return hasDetail ? (
              <details key={`${m.moduleKey}-${m.subjectTeamId ?? 'fixture'}-${m.displayNumber}`} className="panel-raised" style={{ padding: 12, borderRadius: 8 }}>
                <summary style={{ cursor: 'pointer', listStyle: 'none' }}>{Head}</summary>
                <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 6 }}>{m.verdictText}</p>
                {meta}
              </details>
            ) : (
              <div key={`${m.moduleKey}-${m.subjectTeamId ?? 'fixture'}-${m.displayNumber}`} className="panel-raised" style={{ padding: 12, borderRadius: 8 }}>
                {Head}
                {meta}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── 4. PREPAREDNESS — per-side absolute points + coverage ───────────────────────────

function PreparednessCard({ view, name }: { view: PreparednessSideView; name: string }) {
  const score = preparednessScoreDisplay(view.preparednessPoints, view.declaredPoints);
  return (
    <div className="panel" style={{ padding: 12 }}>
      <p className="label-cap" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{name}</p>
      <p className="mono tnum" style={{ color: score.present ? 'var(--text)' : 'var(--faint)', fontSize: 20, fontWeight: 700, marginTop: 6 }}>{score.text}</p>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 2 }}>
        {score.present ? `coverage ${formatRatioPercent(view.coverageRatio, 0)}` : 'no component recorded'}
      </p>
    </div>
  );
}

/** Sealed Team Preparedness per side (an absolute points sum in [0, available]). Empty
 *  → an honest "No preparedness readings for this match.", never a fabricated score. */
export function PreparednessPanel({ preparedness, homeName, awayName }: {
  preparedness: readonly PreparednessSideView[]; homeName: string; awayName: string;
}) {
  const home = preparedness.find((p) => p.side === 'HOME') ?? null;
  const away = preparedness.find((p) => p.side === 'AWAY') ?? null;
  return (
    <section className="space-y-2" aria-label="preparedness">
      <p className="eyebrow">Preparedness</p>
      {!home && !away ? (
        <div className="panel" style={{ padding: 14 }}>
          <Unavailable text="No preparedness readings for this match." />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {home ? <PreparednessCard view={home} name={homeName} /> : null}
          {away ? <PreparednessCard view={away} name={awayName} /> : null}
        </div>
      )}
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        An absolute points sum over the components present — a missing component lowers the reachable maximum, never inflates the rest.
      </p>
    </section>
  );
}

// ── 5. CITED EVIDENCE — the inputs the reading referenced (rail) ─────────────────────

function EvidenceRows({ items, team }: { items: readonly CitedEvidenceItem[]; team: string }) {
  if (items.length === 0) return null;
  return (
    <>
      <tr><th scope="rowgroup" colSpan={4} style={{ ...tdL, color: 'var(--muted)', fontWeight: 700, paddingTop: 10 }}>{team}</th></tr>
      {items.map((it, i) => (
        <tr key={`${it.featureKey}-${i}`} style={{ background: i % 2 === 0 ? 'color-mix(in srgb, var(--raised) 30%, transparent)' : 'transparent' }}>
          <th scope="row" style={{ ...tdL, fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'normal' }}>{humanizeFeatureKey(it.featureKey)}</th>
          <td style={tdR} className="mono tnum">{trimNumericText(it.value)}</td>
          <td style={tdL}>{evidenceKindLabel(it.provenanceClassCode)}</td>
          <td style={{ ...tdR, color: it.sampleMeetsThreshold ? 'var(--text)' : 'var(--warn)' }} className="tnum">{it.sampleObservationCount}</td>
        </tr>
      ))}
    </>
  );
}

/** The evidence the reading cited, grouped by team: input · value · kind · obs. Feature
 *  ids, versions and checksums are never shown; obs below the sample threshold is amber. */
export function EvidenceTable({ citedEvidence, homeTeamId, homeName, awayTeamId, awayName }: {
  citedEvidence: readonly CitedEvidenceItem[];
  homeTeamId: string | null; homeName: string; awayTeamId: string | null; awayName: string;
}) {
  const n = citedEvidence.length;
  const homeItems = citedEvidence.filter((c) => c.subjectTeamId !== null && c.subjectTeamId === homeTeamId);
  const awayItems = citedEvidence.filter((c) => c.subjectTeamId !== null && c.subjectTeamId === awayTeamId);
  const otherItems = citedEvidence.filter((c) => c.subjectTeamId === null || (c.subjectTeamId !== homeTeamId && c.subjectTeamId !== awayTeamId));
  return (
    <section className="space-y-2" aria-label="cited evidence">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Cited evidence</p>
        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 10, marginLeft: 'auto' }}>{n} input{n === 1 ? '' : 's'}</span>
      </div>
      {n === 0 ? (
        <div className="panel" style={{ padding: 12 }}><Unavailable text="No cited inputs recorded." /></div>
      ) : (
        <div className="panel" style={{ padding: '4px 12px 10px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 300 }}>
            <caption className="sr-only">Evidence cited by the reading at kickoff, grouped by team.</caption>
            <thead><tr>
              <th scope="col" style={thL}>Input</th>
              <th scope="col" style={thR}>Value</th>
              <th scope="col" style={thL}>Kind</th>
              <th scope="col" style={thR}>Obs</th>
            </tr></thead>
            <tbody>
              <EvidenceRows items={homeItems} team={homeName} />
              <EvidenceRows items={awayItems} team={awayName} />
              <EvidenceRows items={otherItems} team="Fixture" />
            </tbody>
          </table>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 6 }}>
            Values are shown as recorded; nothing is recomputed. Obs is amber below the sample threshold.
          </p>
        </div>
      )}
    </section>
  );
}

// ── HISTORICAL RESPONSE (Overview — past, not part of the kickoff reading) ──────────

function TriggerLine({ label, t }: { label: string; t: { engaged: boolean; n: number; response: { wins: number; draws: number; losses: number } } }) {
  const total = t.response.wins + t.response.draws + t.response.losses;
  const pct = (x: number) => (total === 0 ? 0 : (x / total) * 100);
  return (
    <div style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span className="label-cap" style={{ color: 'var(--muted)' }}>
          {label}
          {t.engaged && <span className="label-cap" style={{ color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, padding: '0 5px', fontSize: 8, marginLeft: 6 }}>APPLIES TO THIS MATCH</span>}
        </span>
        <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 12 }}>
          W{t.response.wins} D{t.response.draws} L{t.response.losses}
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginLeft: 6 }}>n {t.n}</span>
        </span>
      </div>
      {total > 0 && (
        <div aria-hidden style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--line)', marginTop: 4 }}>
          <div style={{ width: `${pct(t.response.wins)}%`, background: 'var(--edge)' }} />
          <div style={{ width: `${pct(t.response.draws)}%`, background: 'var(--muted)' }} />
          <div style={{ width: `${pct(t.response.losses)}%`, background: 'var(--risk)' }} />
        </div>
      )}
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
 *  marks the trigger relevant to this fixture. Historical context — explicitly not part
 *  of the kickoff reading, and never linked to this match's result. */
export function HistoricalResponse({ historicalResponse, homeName, awayName }: {
  historicalResponse: { home: HistoricalResponseSide | null; away: HistoricalResponseSide | null } | null | undefined;
  homeName: string; awayName: string;
}) {
  if (!historicalResponse) return null;
  return (
    <section className="space-y-2" aria-label="historical patterns">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Historical patterns</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>past · not part of the kickoff reading</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <HistoricalSide name={homeName} side={historicalResponse.home} />
        <HistoricalSide name={awayName} side={historicalResponse.away} />
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
