// MATCH — Timeline surface (read-only, SSR).
//
// The Timeline tab merges the observed lifecycle transitions with the other known
// instants — kickoff, the intelligence lock, and result confirmation — into one
// chronological dot-timeline (a status change gets a filled dot; a contextual marker an
// outline dot). Every event comes from a real payload field; nothing is fabricated, and
// minute-by-minute match events (not in any payload) are simply not claimed. Observed
// evidence only, design tokens only, no calculation.

import { Kickoff, EmptyState } from '@/components/v2/ui';
import { mergeTimeline } from '@/lib/v2/matchIntelligence';
import type { MatchLifecycle } from '@/lib/v2/types';

export function LifecycleTimeline({ lifecycle, kickoffAt, lockedAt = null, confirmedAt = null }: {
  lifecycle: MatchLifecycle | null;
  kickoffAt: string;
  lockedAt?: string | null;
  confirmedAt?: string | null;
}) {
  const transitions = lifecycle?.transitions ?? [];
  const events = mergeTimeline(transitions, kickoffAt, lockedAt, confirmedAt);
  const noStatus = lifecycle === null || lifecycle.coverage.transitions === 'absent' || transitions.length === 0;
  return (
    <section className="space-y-2" aria-label="timeline" style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Timeline</p>
        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{events.length}</span>
      </div>
      {events.length === 0 ? (
        <EmptyState message="No timeline events are available for this fixture yet." />
      ) : (
        <div className="panel" style={{ padding: 16 }}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {events.map((e, i) => (
              <li key={`${e.at}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 12, paddingBottom: i === events.length - 1 ? 0 : 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span aria-hidden style={{
                    width: 9, height: 9, borderRadius: '50%', marginTop: 3,
                    background: e.filled ? 'var(--amber)' : 'transparent',
                    border: `1.5px solid ${e.filled ? 'var(--amber)' : 'var(--muted)'}`,
                  }} />
                  {i !== events.length - 1 && <span aria-hidden style={{ flex: 1, width: 1, background: 'var(--line)', marginTop: 3 }} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}><Kickoff iso={e.at} /></p>
                  <p style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>{e.title}</p>
                  {e.detail && <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{e.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {noStatus && (
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
          Status history is not recorded for this fixture; only the known instants are shown.
        </p>
      )}
    </section>
  );
}
