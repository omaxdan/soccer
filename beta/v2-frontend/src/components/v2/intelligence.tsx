// MATCH INTELLIGENCE — SEALED SURFACE COMPONENTS (read-only, SSR).
//
// Presentational components for the governed, sealed Match Intelligence. They
// render the /api/v2/matches/:id/intelligence `intelligence` object and NOTHING
// else — context is rendered by separate, clearly-labelled surfaces on the page so
// the two can never be confused. These components:
//   • surface provenance prominently (sealed snapshot, as-of, composition version);
//   • show governed values, and honest "no governed value" / "not yet calibrated"
//     states for null graded fields — never a fabricated 0 or percentage;
//   • distinguish a preparedness component that is PRESENT (show its value, incl. a
//     real 0) from one that is ABSENT (show "No data") — never zero-filling absence.
// No data fetching, no calculation.

import type {
  MatchIntelligence, IntelligenceProvenance, IntelligenceVerdict,
  PreparednessSideView, CitedEvidenceItem,
} from '@/lib/v2/types';
import {
  VERDICT_GRADED_FIELDS, verdictFieldDisplay, resolveTeamComponents,
  preparednessScoreDisplay, formatRatioPercent, formatProvenanceTime,
  humanizeFeatureKey, trimNumericText, type ResolvedComponent,
} from '@/lib/v2/matchIntelligence';

// ── shared bits ──────────────────────────────────────────────────────────────

/** The badge that marks a surface as the governed, sealed calculation (vs context). */
export function SealedBadge() {
  return (
    <span
      className="label-cap"
      title="Governed, immutable sealed snapshot — the calculation, not live context"
      style={{
        color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4,
        padding: '0 5px', fontSize: 9, whiteSpace: 'nowrap',
      }}
    >sealed · governed</span>
  );
}

/** A value that is not yet governed/calibrated, rendered in the quiet tier so it
 *  never reads as a real value (and never as a zero). */
function Unavailable({ text }: { text: string }) {
  return <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 11 }}>{text}</span>;
}

// ── 1. PROVENANCE BAR ──────────────────────────────────────────────────────────

/**
 * Makes the origin of the intelligence obvious: this is a SEALED, governed
 * calculation, as of a point in time, under a named composition version — distinct
 * from the live/contextual information elsewhere on the page.
 */
export function ProvenanceBar({ provenance }: { provenance: IntelligenceProvenance }) {
  return (
    <header
      className="panel"
      aria-label="match intelligence provenance"
      style={{ padding: '12px 14px', borderColor: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 6%, var(--panel))' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <p className="eyebrow" style={{ color: 'var(--amber)', letterSpacing: '0.16em' }}>Match Intelligence</p>
        <SealedBadge />
      </div>
      <p className="label-cap tnum" style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 6, letterSpacing: '0.06em' }}>
        Sealed snapshot · As of {formatProvenanceTime(provenance.snapshotAsOf)} · Composition {provenance.verdictCompositionVersion}
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        <ProvenanceFact label="Snapshot" value={`#${provenance.matchSnapshotId} · ${provenance.snapshotPointCode.replace(/_/g, ' ')}`} />
        <ProvenanceFact label="Sealed" value={formatProvenanceTime(provenance.sealedAt)} />
        <ProvenanceFact label="Integrity" value={`checksum ${provenance.checksumAlgorithmVersion} · immutable`} />
      </div>
    </header>
  );
}

function ProvenanceFact({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
      <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</span>
      <span className="mono tnum" style={{ color: 'var(--muted)', fontSize: 11 }}>{value}</span>
    </span>
  );
}

// ── 2. VERDICT / EDGES BAND ──────────────────────────────────────────────────────

function CountChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="panel-raised" style={{ padding: '8px 10px', borderRadius: 6, minWidth: 84, flex: '1 1 84px' }}>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
      <p className="mono tnum" style={{ fontSize: 18, fontWeight: 700, color, marginTop: 2 }}>{count}</p>
    </div>
  );
}

/**
 * The sealed verdict: non-directional module consensus counts + completeness, then
 * the governed comparative edges and the graded fields — with governed values shown
 * plainly and ungoverned/uncalibrated fields shown as honest unavailable states.
 * Never a prediction, an odds figure, or a fabricated confidence.
 */
export function VerdictBand({ verdict }: { verdict: IntelligenceVerdict }) {
  return (
    <section className="space-y-3" aria-label="sealed verdict">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow" style={{ color: 'var(--amber)' }}>Verdict</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>module consensus · non-directional</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <CountChip label="Supports" count={verdict.consensusSupportsCount} color="var(--edge)" />
        <CountChip label="Contradicts" count={verdict.consensusContradictsCount} color="var(--risk)" />
        <CountChip label="Neutral" count={verdict.consensusNeutralCount} color="var(--muted)" />
        <CountChip label="Inactive" count={verdict.consensusInactiveCount} color="var(--faint)" />
      </div>
      <div className="panel" style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="label-cap" style={{ color: 'var(--text-secondary)' }}>Evidence completeness</span>
          <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700 }}>
            {formatRatioPercent(verdict.completenessRatio)}
            <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginLeft: 6 }}>
              {verdict.evidenceCount} module{verdict.evidenceCount === 1 ? '' : 's'} with evidence
            </span>
          </span>
        </div>
      </div>
      <div>
        <p className="label-cap" style={{ color: 'var(--muted)', marginBottom: 4 }}>Governed edges &amp; graded fields</p>
        <div className="panel" style={{ padding: '4px 12px' }}>
          {VERDICT_GRADED_FIELDS.map((spec) => {
            const d = verdictFieldDisplay(spec, verdict);
            return (
              <div key={spec.label} className="hairline"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="label-cap" style={{ color: 'var(--text-secondary)' }}>{spec.label}</span>
                {d.present
                  ? <span className="mono tnum" style={{ color: 'var(--edge)', fontWeight: 700 }}>{d.text}</span>
                  : <Unavailable text={d.text} />}
              </div>
            );
          })}
        </div>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 6 }}>
          Edges are governed comparative readings, not predictions or odds. Fields with no governed value are shown as such —
          never as zero or a fabricated confidence.
        </p>
      </div>
    </section>
  );
}

// ── 4/5. TEAM PREPAREDNESS + COMPONENT BREAKDOWN ────────────────────────────────

function ComponentRow({ c }: { c: ResolvedComponent }) {
  const absent = c.presence === 'absent';
  return (
    <div className="hairline"
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ minWidth: 0 }}>
        <span className="label-cap" style={{ color: absent ? 'var(--faint)' : 'var(--text-secondary)' }}>{c.label}</span>
        <span className="label-cap" style={{ display: 'block', color: 'var(--faint)', fontSize: 9 }}>{c.note} · {c.declaredPoints} pts</span>
      </span>
      <span style={{ textAlign: 'right' }}>
        {absent
          ? <Unavailable text="No data" />
          : (
            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              {/* A cited zero is a real value and is shown as 0 — not "No data". */}
              <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14 }}>{trimNumericText(c.value!)}</span>
              {c.sampleMeetsThreshold === false && (
                <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>low sample ({c.sampleObservationCount})</span>
              )}
            </span>
          )}
      </span>
    </div>
  );
}

/** One side's preparedness: absolute score, coverage, and the per-component
 *  breakdown resolved from cited evidence (present / present-zero / absent). */
export function PreparednessCard({ side, teamName, view, cited }: {
  side: 'HOME' | 'AWAY'; teamName: string; view: PreparednessSideView | undefined; cited: readonly CitedEvidenceItem[];
}) {
  if (!view) {
    return (
      <div className="panel-raised" style={{ padding: 14, borderRadius: 8 }}>
        <p className="eyebrow">{side} · {teamName}</p>
        <p style={{ color: 'var(--faint)', marginTop: 6, fontSize: 13 }}>No preparedness recorded</p>
      </div>
    );
  }
  const score = preparednessScoreDisplay(view.preparednessPoints, view.declaredPoints);
  const components = resolveTeamComponents(side, view.teamId, cited);
  return (
    <div className="panel-raised" style={{ padding: 14, borderRadius: 8 }} aria-label={`${side} preparedness`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow" style={{ color: 'var(--amber)' }}>{side}</p>
        <span className="label-cap" style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teamName}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
        {score.present
          ? <span className="mono tnum" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)' }}>{score.text}</span>
          : <Unavailable text={score.text} />}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Available / declared</span>
          <span className="mono tnum" style={{ color: 'var(--muted)', fontSize: 12 }}>{trimNumericText(view.availablePoints)} / {trimNumericText(view.declaredPoints)}</span>
        </span>
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Coverage</span>
          <span className="mono tnum" style={{ color: 'var(--muted)', fontSize: 12 }}>{formatRatioPercent(view.coverageRatio)}</span>
        </span>
      </div>
      <div style={{ marginTop: 10 }}>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginBottom: 2 }}>Components cited</p>
        {components.map((c) => <ComponentRow key={c.featureKey + c.label} c={c} />)}
      </div>
    </div>
  );
}

/** HOME and AWAY preparedness side by side (stacked on mobile). */
export function PreparednessBand({ intelligence, homeName, awayName }: {
  intelligence: MatchIntelligence; homeName: string; awayName: string;
}) {
  const home = intelligence.preparedness.find((p) => p.side === 'HOME');
  const away = intelligence.preparedness.find((p) => p.side === 'AWAY');
  return (
    <section className="space-y-2" aria-label="team preparedness">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow" style={{ color: 'var(--amber)' }}>Team preparedness</p>
        <SealedBadge />
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>
        An absolute readiness score per side, composed at seal from present governed components. Absent components are shown as
        “No data”, never zero; the coverage figure discloses how much of the declared composition was present.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PreparednessCard side="HOME" teamName={homeName} view={home} cited={intelligence.citedEvidence} />
        <PreparednessCard side="AWAY" teamName={awayName} view={away} cited={intelligence.citedEvidence} />
      </div>
    </section>
  );
}

// ── 6. CITED EVIDENCE — "Cited by calculation" ───────────────────────────────────

function CitedRow({ item }: { item: CitedEvidenceItem }) {
  return (
    <div role="listitem" className="hairline"
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ minWidth: 0 }}>
        <span className="label-cap" style={{ color: 'var(--text-secondary)' }}>{humanizeFeatureKey(item.featureKey)}</span>
        <span className="mono" style={{ display: 'block', color: 'var(--faint)', fontSize: 9 }}>
          {item.featureKey} · v{item.featureVersionId} · {item.provenanceClassCode.toLowerCase()}
          {item.sampleMeetsThreshold ? '' : ` · below threshold (${item.sampleObservationCount})`}
        </span>
      </span>
      <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, textAlign: 'right' }}>{trimNumericText(item.value)}</span>
    </div>
  );
}

/**
 * The evidence the sealed calculation ACTUALLY cited — labelled unambiguously so it
 * is never mistaken for generic live context. Collapsible for progressive
 * disclosure; the count stays visible on the summary.
 */
export function CitedEvidencePanel({ citedEvidence }: { citedEvidence: readonly CitedEvidenceItem[] }) {
  const n = citedEvidence.length;
  return (
    <details className="panel" style={{ padding: '10px 12px' }}>
      <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, listStyle: 'none' }}>
        <span className="eyebrow" style={{ color: 'var(--amber)' }}>Cited by calculation</span>
        <SealedBadge />
        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 10, marginLeft: 'auto' }}>{n} input{n === 1 ? '' : 's'}</span>
      </summary>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 6 }}>
        The exact feature values the sealed calculation referenced, with lineage. These are the calculation’s inputs — not the
        contextual information shown separately below.
      </p>
      {n === 0
        ? <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11, marginTop: 8 }}>No cited inputs recorded</p>
        : (
          <div role="list" aria-label="cited evidence" style={{ marginTop: 6 }}>
            {citedEvidence.map((it) => <CitedRow key={it.featureValueId} item={it} />)}
          </div>
        )}
    </details>
  );
}

// ── honest unavailable state (no sealed snapshot) ────────────────────────────────

/** Shown in place of the sealed surfaces when a fixture has no sealed snapshot yet.
 *  The fixture and its context still render — intelligence is honestly "not sealed",
 *  never fabricated from live data. */
export function IntelligenceUnavailable() {
  return (
    <section className="panel" aria-label="match intelligence unavailable"
      style={{ padding: 16, borderColor: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 5%, var(--panel))' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow" style={{ color: 'var(--amber)' }}>Match Intelligence</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, border: '1px solid var(--faint)', borderRadius: 4, padding: '0 5px' }}>not yet sealed</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 13 }}>
        No sealed intelligence snapshot exists for this fixture yet.
      </p>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 6 }}>
        The governed verdict, Team Preparedness and cited evidence appear once a snapshot is sealed. The contextual match
        information below is available now — it is not part of the sealed calculation.
      </p>
    </section>
  );
}
