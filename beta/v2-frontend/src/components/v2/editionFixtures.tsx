'use client';
// EDITION FIXTURES TAB (Phase D) — the edition-scoped fixture list.
//
// The interactive Fixtures surface of the Competition/Edition workspace, over the real
// GET /api/v2/editions/{id}/fixtures read (passed in as props by the server page — this
// component fetches nothing). A segmented status filter (only statuses actually present
// appear), fixtures grouped by kickoff day (UTC), and completed results paginated
// (latest 20 + "Load earlier results"). Rows lead to the existing Match workspace; the
// status grammar and score treatment match the Phase-C fixtures workspace. Status is
// displayed exactly as supplied — never relabelled by the clock. Missing scores stay a
// dash, never a fabricated 0–0. Grouping is by kickoff date only: the payload carries no
// round/matchday, venue or team-filter data (surfaced honestly in the rail).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import {
  statusCounts, fixturesForStatus, groupFixturesByDay, fixtureDayLabel,
} from '@/lib/v2/competition';
import { statusPresentation, kickoffHHMM } from '@/lib/v2/fixtures';
import type { ApiEditionFixture } from '@/lib/v2/types';

const RESULTS_PAGE = 20;

const FILTER_LABEL: Record<string, string> = {
  COMPLETED: 'Results', SCHEDULED: 'Scheduled', POSTPONED: 'Postponed',
  IN_PROGRESS: 'Live', ABANDONED: 'Abandoned', CANCELLED: 'Cancelled',
};

function nameStyle(f: ApiEditionFixture, side: 'home' | 'away'): React.CSSProperties {
  const s = f.score;
  if (f.status !== 'COMPLETED' || !s || s.home === s.away) return { fontWeight: 500, color: 'var(--text)' };
  const win = side === 'home' ? s.home > s.away : s.away > s.home;
  return { fontWeight: win ? 600 : 500, color: win ? 'var(--text)' : 'var(--text-secondary)' };
}

function StatusChip({ status, small = false }: { status: string; small?: boolean }) {
  const p = statusPresentation(status, null);
  return (
    <span className="mono" aria-label={p.word}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: small ? 9 : 10, letterSpacing: '.08em', textTransform: 'uppercase', color: p.color, whiteSpace: 'nowrap' }}>
      <span aria-hidden style={{ fontSize: 8, animation: p.live ? 'pulse-dot 1.8s ease-in-out infinite' : 'none' }}>{p.glyph}</span>{p.label}
    </span>
  );
}

function ScoreBox({ f }: { f: ApiEditionFixture }) {
  const show = f.status === 'COMPLETED' && !!f.score;
  return (
    <span className="mono tnum" style={{ justifySelf: 'center', minWidth: 56, textAlign: 'center', padding: '3px 0', borderRadius: 4, background: 'var(--ink)', border: '1px solid var(--line)', fontSize: 13, fontWeight: 600, color: show ? 'var(--text)' : 'var(--faint)' }}>
      {show ? `${f.score!.home} – ${f.score!.away}` : '–'}
    </span>
  );
}

function FixtureRow({ f }: { f: ApiEditionFixture }) {
  const time = kickoffHHMM(f.kickoffAt);
  const s = f.score;
  const scored = f.status === 'COMPLETED' && !!s;
  const aria = `${f.homeTeam.name} ${scored ? `${s!.home} ${s!.away} ` : ''}${f.awayTeam.name}, ${statusPresentation(f.status, null).word}, ${time} UTC. Open match.`;
  return (
    <li style={{ listStyle: 'none' }}>
      <Link href={routes.match({ fixtureId: f.fixtureId, homeTeam: f.homeTeam, awayTeam: f.awayTeam })} aria-label={aria} className="hover:bg-raised" style={{ display: 'block', borderRadius: 4, textDecoration: 'none', color: 'inherit' }}>
        {/* desktop */}
        <span className="hidden md:grid" style={{ gridTemplateColumns: '64px minmax(0,1fr) 72px minmax(0,1fr) 108px', gap: 14, alignItems: 'center', height: 42, padding: '0 12px' }}>
          <time dateTime={f.kickoffAt} className="mono tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>{time}</time>
          <span style={{ textAlign: 'right', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameStyle(f, 'home') }}>{f.homeTeam.name}</span>
          <ScoreBox f={f} />
          <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameStyle(f, 'away') }}>{f.awayTeam.name}</span>
          <span style={{ justifySelf: 'end' }}><StatusChip status={f.status} /></span>
        </span>
        {/* mobile */}
        <span className="grid md:hidden" style={{ gridTemplateColumns: '56px minmax(0,1fr) 32px', gap: 10, alignItems: 'center', minHeight: 56, padding: '8px 10px' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <time dateTime={f.kickoffAt} className="mono tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{time}</time>
            <StatusChip status={f.status} small />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameStyle(f, 'home') }}>{f.homeTeam.name}</span>
            <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameStyle(f, 'away') }}>{f.awayTeam.name}</span>
          </span>
          <span className="mono tnum" style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', fontSize: 14, fontWeight: 600, color: scored ? 'var(--text)' : 'var(--faint)' }}>
            <span>{scored ? s!.home : ''}</span><span>{scored ? s!.away : ''}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

function DayGroup({ dayKey, fixtures }: { dayKey: string; fixtures: readonly ApiEditionFixture[] }) {
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', background: 'var(--raised)', borderBottom: '1px solid var(--line)' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>{fixtureDayLabel(dayKey)}</span>
        <span className="mono tnum" style={{ fontSize: 11, color: 'var(--faint)' }}>{fixtures.length} {fixtures.length === 1 ? 'fixture' : 'fixtures'}</span>
      </div>
      <ul style={{ margin: 0, padding: '4px 8px 6px' }}>
        {fixtures.map((f) => <FixtureRow key={f.fixtureId} f={f} />)}
      </ul>
    </div>
  );
}

export interface EditionFixturesTabProps {
  fixtures: ApiEditionFixture[];
  facts: { k: string; v: string }[];       // edition-fixtures rail facts
  tableVsResults: string | null;            // "table is dated … results run to …" note
}

export function EditionFixturesTab({ fixtures, facts, tableVsResults }: EditionFixturesTabProps) {
  const counts = useMemo(() => statusCounts(fixtures), [fixtures]);
  const firstStatus = counts.find((c) => c.status === 'COMPLETED')?.status ?? counts[0]?.status ?? null;
  const [status, setStatus] = useState<string | null>(firstStatus);
  const [shown, setShown] = useState(RESULTS_PAGE);

  const active = status ?? firstStatus;
  const selected = useMemo(() => (active ? fixturesForStatus(fixtures, active) : []), [fixtures, active]);
  const paginated = active === 'COMPLETED';
  const visible = paginated ? selected.slice(0, shown) : selected;
  const days = useMemo(() => groupFixturesByDay(visible), [visible]);
  const more = paginated && selected.length > visible.length;

  const note = active
    ? paginated
      ? `Showing latest ${visible.length} of ${selected.length} ${selected.length === 1 ? 'result' : 'results'}`
      : `All ${selected.length} ${(FILTER_LABEL[active] ?? active.toLowerCase())} fixtures${active === 'POSTPONED' ? ' · original kickoff shown' : ''}`
    : '';

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]" style={{ gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {/* status filter — only statuses actually present appear */}
        {counts.length > 0 && (
          <div role="group" aria-label="Filter by status" className="no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
            {counts.map((c) => {
              const on = c.status === active;
              return (
                <button key={c.status} type="button" onClick={() => { setStatus(c.status); setShown(RESULTS_PAGE); }}
                  aria-pressed={on}
                  style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 14px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--line)', borderBottom: `2px solid ${on ? 'var(--amber)' : 'var(--line)'}`, background: on ? 'var(--raised)' : 'var(--panel)', color: on ? 'var(--text)' : 'var(--muted)', fontSize: 13, fontWeight: 500 }}>
                  {FILTER_LABEL[c.status] ?? c.status.replace(/_/g, ' ')}
                  <span className="mono tnum" style={{ fontSize: 11, color: 'var(--faint)' }}>{c.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {days.length === 0 ? (
          <div role="status" className="panel" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>No fixtures for this filter.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {days.map((d) => <DayGroup key={d.dayKey} dayKey={d.dayKey} fixtures={d.fixtures} />)}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{note}</span>
          {more && (
            <button type="button" onClick={() => setShown((n) => n + RESULTS_PAGE)}
              className="hover:bg-raised" style={{ minHeight: 32, padding: '0 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 4, fontSize: 12, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>
              Load earlier results
            </button>
          )}
        </div>
        <p className="mono" style={{ fontSize: 10, color: 'var(--faint)', margin: 0 }}>Times in UTC · status shown as supplied, never relabelled by the clock.</p>
      </div>

      {/* rail */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="panel" aria-label="edition fixtures" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Edition fixtures</span>
          </div>
          <dl style={{ margin: 0, padding: '2px 16px 8px' }}>
            {facts.map((f) => (
              <div key={f.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <dt style={{ fontSize: 12, color: 'var(--muted)' }}>{f.k}</dt>
                <dd className="mono" style={{ margin: 0, fontSize: 12, color: 'var(--text)', textAlign: 'right' }}>{f.v}</dd>
              </div>
            ))}
          </dl>
        </section>
        {tableVsResults && (
          <section className="panel" aria-label="table versus results" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Table vs results</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tableVsResults}</span>
          </section>
        )}
        <div style={{ border: '1px dashed var(--line)', borderRadius: 4, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--warn)' }}>Not in payload</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Round / matchday, venue and team-filter data. Fixtures are grouped by kickoff date only.</span>
        </div>
      </div>
    </div>
  );
}
