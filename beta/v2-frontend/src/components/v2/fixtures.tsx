'use client';
// FIXTURES-BY-DATE WORKSPACE (Phase C) — the two-column fixtures calendar.
//
// Desktop: a compact 4fr fixture list (grouped country → competition/edition →
// fixtures) beside a wider 8fr preview of the SELECTED fixture (built from the payload +
// an "Open full match" link — a preview, NOT a second Match page). The first fixture
// is selected on load; selecting another updates the preview via client state (no
// refetch — the data is already on the page). Mobile: the list only; tapping a row
// navigates to the existing Match workspace (/matches/{slug}); the right pane is not
// stacked underneath. All data comes from GET /api/v2/fixtures/{date}; nothing is
// invented (missing results stay a dash, never 0–0).

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import type { FixturesByDateResponse, CalendarFixture, CalendarCompetitionGroup, MatchIntelligenceResponse } from '@/lib/v2/types';
import {
  type StripDay, statusPresentation, scorePresentation, kickoffHHMM,
} from '@/lib/v2/fixtures';
import { IntelligenceSummary, EdgeGrid, HistoricalResponse } from '@/components/v2/intelligence';

/** One selected fixture's on-demand intelligence, cached per fixture id. */
type IntelState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: MatchIntelligenceResponse | null };

/** Base-path-aware URL for the frontend intelligence proxy (staging may mount the app
 *  under NEXT_PUBLIC_BASE_PATH; production serves from root). */
function intelligenceApiPath(fixtureId: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || '';
  return `${base}/api/v2/matches/${encodeURIComponent(fixtureId)}/intelligence`;
}

// ── small pieces ─────────────────────────────────────────────────────────────────

function StatusChip({ status, result, small = false }: { status: string; result: CalendarFixture['result']; small?: boolean }) {
  const p = statusPresentation(status, result);
  return (
    <span className="mono" aria-label={p.word}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: small ? 9 : 10, letterSpacing: '.1em', color: p.color, border: `1px ${p.dashed ? 'dashed' : 'solid'} ${p.color}`, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>
      <span aria-hidden style={{ fontSize: 8, animation: p.live ? 'pulse-dot 1.8s ease-in-out infinite' : 'none' }}>{p.glyph}</span>{p.label}
    </span>
  );
}

function nameWeight(f: CalendarFixture, side: 'home' | 'away'): React.CSSProperties {
  const s = scorePresentation(f);
  if (!s.show || f.status !== 'COMPLETED' || s.home === null || s.away === null) return { fontWeight: 500, color: 'var(--text)' };
  const win = side === 'home' ? s.home > s.away : s.away > s.home;
  const lose = side === 'home' ? s.home < s.away : s.away < s.home;
  return { fontWeight: win ? 600 : 500, color: lose ? 'var(--text-secondary)' : 'var(--text)' };
}

/** One fixture row. On desktop it selects (handled by the parent); on mobile the
 *  whole row is a link into the Match workspace. It is always a real link, so it
 *  works without JS and is keyboard-operable. */
function FixtureRow({ f, selected, onSelect }: { f: CalendarFixture; selected: boolean; onSelect: (id: string) => void }) {
  const s = scorePresentation(f);
  const href = routes.match({ fixtureId: f.fixtureId, homeTeam: f.homeTeam, awayTeam: f.awayTeam });
  const time = kickoffHHMM(f.kickoffAt);
  const aria = `${f.homeTeam.name} ${s.show ? `${s.home} ${s.away} ` : s.missing ? 'no score ' : ''}${f.awayTeam.name}, ${statusPresentation(f.status, f.result).word}, ${time} UTC. Open match.`;
  const onClick = (e: React.MouseEvent) => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      e.preventDefault();
      onSelect(f.fixtureId);
    }
  };
  return (
    <li style={{ borderTop: '1px solid var(--line)' }}>
      <Link href={href} onClick={onClick} aria-label={aria}
        aria-current={selected ? 'true' : undefined}
        className="hover:bg-raised"
        style={{
          display: 'block', textDecoration: 'none', color: 'inherit',
          borderLeft: `3px solid ${selected ? 'var(--amber)' : 'transparent'}`,
          background: selected ? 'color-mix(in srgb, var(--amber) 5%, transparent)' : 'transparent',
        }}>
        {/* Unified fixture row — the SAME vertical grammar at every width (the
            compact 4fr left panel must never collapse the teams). Three areas:
            TIME/STATUS · vertically-stacked TEAMS (home then away) · stacked SCORES
            aligned with their team. Names truncate with an ellipsis only when the
            column is genuinely too narrow; they are never removed. */}
        <span className="grid" style={{ gridTemplateColumns: '52px minmax(0,1fr) auto', gap: 10, alignItems: 'center', minHeight: 52, padding: '8px 12px' }}>
          {/* 1. TIME + STATUS */}
          <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <time dateTime={f.kickoffAt} className="mono tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{time}</time>
            <StatusChip status={f.status} result={f.result} small />
          </span>
          {/* 2. TEAMS — stacked, home first, away second, graceful truncation */}
          <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameWeight(f, 'home') }}>
              {f.homeTeam.name || <span style={{ color: 'var(--faint)' }}>Home team not specified</span>}
            </span>
            <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameWeight(f, 'away') }}>
              {f.awayTeam.name || <span style={{ color: 'var(--faint)' }}>Away team not specified</span>}
            </span>
          </span>
          {/* 3. SCORE — stacked, aligned with each team; honest dash / blank */}
          <span className="mono tnum" style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end', fontSize: 15, fontWeight: 600 }}>
            <span style={{ color: s.show ? 'var(--text)' : 'var(--faint)' }}>{s.show ? s.home : s.missing ? '—' : ''}</span>
            <span style={{ color: s.show ? 'var(--text)' : 'var(--faint)' }}>{s.show ? s.away : s.missing ? '—' : ''}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

function CompetitionCard({ c, selectedId, onSelect }: { c: CalendarCompetitionGroup; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      <h3 style={{ margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', padding: '10px 14px', background: 'var(--raised)', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{c.name}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{c.edition.seasonLabel}</span>
        <span className="mono tnum" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--faint)' }}>{c.fixtures.length} {c.fixtures.length === 1 ? 'fixture' : 'fixtures'}</span>
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {c.fixtures.map((f) => <FixtureRow key={f.fixtureId} f={f} selected={f.fixtureId === selectedId} onSelect={onSelect} />)}
      </ul>
    </div>
  );
}

/** The selected-fixture preview (desktop right column). The score/result block is
 *  built from the calendar payload; the reading block (module consensus, edges,
 *  historical patterns) is the on-demand intelligence for THIS fixture — the same
 *  sealed read the Match page uses, shown here so a fixture can be evaluated before
 *  opening the full Match workspace. Nothing is invented: an unsealed fixture shows an
 *  honest "no reading yet", a failed load an honest error, missing results a dash. */
function PreviewIntelligence({ intel, homeName, awayName }: { intel: IntelState | undefined; homeName: string; awayName: string }) {
  if (!intel || intel.status === 'loading') {
    return (
      <div aria-busy className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p className="eyebrow" style={{ margin: 0, color: 'var(--faint)' }}>Reading at kickoff</p>
        <div style={{ height: 8, borderRadius: 2, background: 'var(--raised)', width: '60%' }} />
        <div style={{ height: 8, borderRadius: 2, background: 'var(--raised)', width: '85%' }} />
        <div style={{ height: 8, borderRadius: 2, background: 'var(--raised)', width: '40%' }} />
        <span className="sr-only">Loading the reading for this fixture…</span>
      </div>
    );
  }
  if (intel.status === 'error') {
    return (
      <div role="alert" className="panel" style={{ padding: 14 }}>
        <p className="label-cap" style={{ color: 'var(--faint)', margin: 0 }}>The reading for this fixture could not be loaded. Open the full match to try again.</p>
      </div>
    );
  }
  if (intel.data === null) {
    return (
      <div className="panel" style={{ padding: 14, borderColor: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 5%, var(--panel))' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p className="eyebrow" style={{ margin: 0, color: 'var(--amber)' }}>Reading at kickoff</p>
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>not available</span>
        </div>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11, marginTop: 6 }}>The reading appears once it is taken at kickoff. The result and context are shown above.</p>
      </div>
    );
  }
  const { intelligence, context } = intel.data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <IntelligenceSummary intelligence={intelligence} />
      <EdgeGrid verdict={intelligence.verdict} homeName={homeName} awayName={awayName} />
      <HistoricalResponse historicalResponse={context?.historicalResponse} homeName={homeName} awayName={awayName} />
    </div>
  );
}

function SelectedPreview({ f, competitionName, seasonLabel, intel }: {
  f: CalendarFixture; competitionName: string; seasonLabel: string; intel: IntelState | undefined;
}) {
  const s = scorePresentation(f);
  const p = statusPresentation(f.status, f.result);
  const href = routes.match({ fixtureId: f.fixtureId, homeTeam: f.homeTeam, awayTeam: f.awayTeam });
  const r = f.result;
  const rows: { k: string; v: string }[] = [];
  if (r?.final) rows.push({ k: p.label === 'FT' ? 'Full time' : p.label, v: `${r.final.home} – ${r.final.away}` });
  if (r?.halfTime) rows.push({ k: 'Half time', v: `${r.halfTime.home} – ${r.halfTime.away}` });
  if (r?.extraTime) rows.push({ k: 'After extra time', v: `${r.extraTime.home} – ${r.extraTime.away}` });
  if (r?.penalties) rows.push({ k: 'Penalties', v: `${r.penalties.home} – ${r.penalties.away}` });
  return (
    <aside aria-label="Selected fixture" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="label-cap" style={{ color: 'var(--cool)', margin: 0 }}>{competitionName} · {seasonLabel}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
          <span style={{ textAlign: 'right', fontSize: 17, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.homeTeam.name}</span>
          <span className="mono tnum" style={{ fontSize: 26, fontWeight: 700, color: s.show ? 'var(--text)' : 'var(--faint)', whiteSpace: 'nowrap' }}>{s.show ? `${s.home} – ${s.away}` : s.missing ? '—' : '–'}</span>
          <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.awayTeam.name}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
          <StatusChip status={f.status} result={f.result} />
          <span className="mono tnum" style={{ fontSize: 11, color: 'var(--muted)' }}>{kickoffHHMM(f.kickoffAt)} UTC</span>
        </div>
        {rows.length > 0 && (
          <dl style={{ margin: 0, borderTop: '1px solid var(--line)' }}>
            {rows.map((row) => (
              <div key={row.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <dt style={{ fontSize: 13, color: 'var(--muted)' }}>{row.k}</dt>
                <dd className="mono tnum" style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>{row.v}</dd>
              </div>
            ))}
          </dl>
        )}
        {f.status === 'COMPLETED' && !s.show && (
          <p className="label-cap" style={{ color: 'var(--faint)', margin: 0 }}>No confirmed result recorded for this fixture.</p>
        )}
      </div>

      <PreviewIntelligence intel={intel} homeName={f.homeTeam.name} awayName={f.awayTeam.name} />

      <Link href={href} className="mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 4, background: 'var(--raised)', border: '1px solid var(--line)', fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text)', textDecoration: 'none' }}>
        Open full match →
      </Link>
    </aside>
  );
}

// ── date controls ────────────────────────────────────────────────────────────────

function DateControls({ date, prevDate, nextDate, today, isToday }: { date: string; prevDate: string; nextDate: string; today: string; isToday: boolean }) {
  return (
    <div role="group" aria-label="Change date" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Link aria-label="Previous day" href={routes.fixtures(prevDate)} className="mono hover:bg-raised" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text-secondary)', textDecoration: 'none' }}>‹</Link>
      <Link href={routes.fixtures(today)} aria-current={isToday ? 'date' : undefined} className="mono" style={{ height: 36, padding: '0 14px', display: 'flex', alignItems: 'center', background: isToday ? 'var(--amber-dim)' : 'var(--panel)', border: `1px solid ${isToday ? 'var(--amber)' : 'var(--line)'}`, borderRadius: 4, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: isToday ? 'var(--amber)' : 'var(--text)', textDecoration: 'none' }}>Today</Link>
      <Link aria-label="Next day" href={routes.fixtures(nextDate)} className="mono hover:bg-raised" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--text-secondary)', textDecoration: 'none' }}>›</Link>
      <DatePicker date={date} />
    </div>
  );
}

function DatePicker({ date }: { date: string }) {
  return (
    <label className="mono hover:bg-raised" style={{ position: 'relative', height: 36, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--line)', borderRadius: 4, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', cursor: 'pointer' }}>
      <span aria-hidden style={{ width: 10, height: 10, border: '1.5px solid currentColor', borderRadius: 2 }} />
      <span className="hidden sm:inline">Date</span>
      <input type="date" aria-label="Choose a date" defaultValue={date}
        onChange={(e) => { const v = e.target.value; if (v) window.location.assign(routes.fixtures(v)); }}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
    </label>
  );
}

function DateStrip({ strip }: { strip: readonly StripDay[] }) {
  return (
    <nav aria-label="Nearby dates" className="no-scrollbar" style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid var(--line)' }}>
      {strip.map((d) => (
        <Link key={d.iso} href={routes.fixtures(d.iso)} aria-current={d.isCurrent ? 'date' : undefined} aria-label={d.aria}
          className="hover:bg-panel"
          style={{ flex: '0 0 auto', minWidth: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 10px 9px', borderBottom: `2px solid ${d.isCurrent ? 'var(--amber)' : 'transparent'}`, marginBottom: -1, textDecoration: 'none' }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: d.isCurrent ? 'var(--text)' : 'var(--faint)' }}>{d.dow}</span>
          <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: d.isCurrent ? 'var(--text)' : 'var(--muted)' }}>{d.num}</span>
          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '.1em', color: 'var(--amber)', minHeight: 11 }}>{d.isToday ? 'TODAY' : ''}</span>
        </Link>
      ))}
    </nav>
  );
}

// ── workspace ────────────────────────────────────────────────────────────────────

export interface FixturesWorkspaceProps {
  date: string;
  prevDate: string;
  nextDate: string;
  today: string;
  strip: readonly StripDay[];
  response: FixturesByDateResponse | null;
  errored: boolean;
}

/** Compact short UTC date for the left header, e.g. "Sun 6 Sep 2026". */
function formatShortUtc(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The compact left-column header: title + count, the date, and the date controls +
 *  strip. Lives INSIDE the left column (per the reference), not full-width above. */
function LeftHeader({ date, prevDate, nextDate, today, isToday, count, strip }: {
  date: string; prevDate: string; nextDate: string; today: string; isToday: boolean; count: number; strip: readonly StripDay[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <p className="eyebrow" style={{ margin: 0 }}>Fixtures</p>
        <span className="mono tnum" style={{ fontSize: 11, fontWeight: 600, color: count ? 'var(--text-secondary)' : 'var(--faint)' }}>{count} {count === 1 ? 'fixture' : 'fixtures'}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 12px' }}>
        <h1 style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(18px,2.4vw,22px)', lineHeight: 1.15, letterSpacing: '-.01em', color: 'var(--text)' }}>
          {formatShortUtc(date)}
          {isToday && <span className="mono" style={{ fontWeight: 600, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--amber)', background: 'var(--amber-dim)', borderRadius: 4, padding: '1px 6px', marginLeft: 8, verticalAlign: 'middle' }}>TODAY</span>}
        </h1>
        <DateControls date={date} prevDate={prevDate} nextDate={nextDate} today={today} isToday={isToday} />
      </div>
      <DateStrip strip={strip} />
      <p className="mono" style={{ margin: 0, fontSize: 10, color: 'var(--faint)' }}>Times in UTC</p>
    </div>
  );
}

/** Breadcrumb for the right column: Fixtures → competition → this fixture. Uses only
 *  real ids/slugs from the selected fixture's group; no fabricated links. */
function PreviewBreadcrumb({ date, competition, seasonLabel, homeName, awayName }: {
  date: string; competition: CalendarCompetitionGroup; seasonLabel: string; homeName: string; awayName: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="label-cap" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
      <Link href={routes.fixtures(date)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>Fixtures</Link>
      <span aria-hidden style={{ color: 'var(--faint)' }}>/</span>
      <Link href={routes.competition({ id: competition.competitionId, slug: competition.slug })} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{competition.name}</Link>
      <span aria-hidden style={{ color: 'var(--faint)' }}>·</span>
      <span style={{ color: 'var(--faint)' }}>{seasonLabel}</span>
      <span aria-hidden style={{ color: 'var(--faint)' }}>/</span>
      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{homeName} v {awayName}</span>
    </nav>
  );
}

export function FixturesWorkspace({ date, prevDate, nextDate, today, strip, response, errored }: FixturesWorkspaceProps) {
  const groups = response?.countries ?? [];
  const flat: { f: CalendarFixture; competition: CalendarCompetitionGroup }[] = [];
  for (const country of groups) for (const comp of country.competitions) for (const f of comp.fixtures) flat.push({ f, competition: comp });
  const firstId = flat[0]?.f.fixtureId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const selected = flat.find((x) => x.f.fixtureId === selectedId) ?? flat[0] ?? null;
  const count = response?.fixtureCount ?? 0;
  const isToday = date === today;

  // On-demand intelligence for the SELECTED fixture only, cached per id. The browser
  // cannot reach the V2 backend directly, so it goes through the frontend proxy route.
  const [intelById, setIntelById] = useState<Record<string, IntelState>>({});
  const selectedFixtureId = selected?.f.fixtureId ?? null;
  useEffect(() => {
    if (!selectedFixtureId || intelById[selectedFixtureId]) return;
    let cancelled = false;
    setIntelById((m) => ({ ...m, [selectedFixtureId]: { status: 'loading' } }));
    fetch(intelligenceApiPath(selectedFixtureId), { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as MatchIntelligenceResponse | null;
      })
      .then((data) => { if (!cancelled) setIntelById((m) => ({ ...m, [selectedFixtureId]: { status: 'ready', data } })); })
      .catch(() => { if (!cancelled) setIntelById((m) => ({ ...m, [selectedFixtureId]: { status: 'error' } })); });
    return () => { cancelled = true; };
  }, [selectedFixtureId, intelById]);

  const header = <LeftHeader date={date} prevDate={prevDate} nextDate={nextDate} today={today} isToday={isToday} count={count} strip={strip} />;

  if (errored || flat.length === 0) {
    return (
      <main aria-busy={false} className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(16px,3vw,28px) 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {header}
        {errored ? (
          <div role="alert" className="panel" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <span aria-hidden style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--risk)', borderRadius: 4, font: "700 13px 'JetBrains Mono',monospace", color: 'var(--risk)' }}>!</span>
            <h2 style={{ margin: 0, font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>Unable to load fixtures for this date</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>The fixtures service could not be reached. Please try again.</p>
          </div>
        ) : (
          <div role="status" className="panel" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <span aria-hidden style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--line)', borderRadius: 4, font: "400 14px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>○</span>
            <h2 className="label-cap" style={{ margin: 0, color: 'var(--muted)' }}>No fixtures</h2>
            <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)' }}>There are no fixtures recorded for this date.</p>
            <span style={{ fontSize: 12, color: 'var(--faint)' }}>Use ‹ › or the date strip to browse nearby days.</span>
          </div>
        )}
      </main>
    );
  }

  return (
    <main aria-busy={false} className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(16px,3vw,28px) 16px' }}>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]" style={{ gap: 16, alignItems: 'start' }}>
        {/* LEFT — compact header + fixture list. Sticky on desktop; the list scrolls
            inside its own panel when the day is long. On mobile it is the single column
            (no sticky, natural scroll) and rows navigate straight to the Match page. */}
        <div className="md:sticky md:top-4" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {header}
          <div className="no-scrollbar md:max-h-[calc(100vh-2rem)] md:overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
            {groups.map((country, ci) => (
              <section key={country.country?.code ?? `c${ci}`} aria-label={`${country.country?.name ?? 'Country not specified'} fixtures`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }} className="label-cap">
                  <span className="mono" style={{ fontSize: 9, letterSpacing: '.08em', color: 'var(--faint)', border: `1px ${country.country?.code ? 'solid' : 'dashed'} var(--line)`, borderRadius: 3, padding: '1px 4px' }}>{country.country?.code ?? '—'}</span>
                  <span style={{ color: 'var(--muted)' }}>{country.country?.name ?? 'Country not specified'}</span>
                </h2>
                {country.competitions.map((c) => <CompetitionCard key={`${c.competitionId}-${c.edition.editionId}`} c={c} selectedId={selectedId} onSelect={setSelectedId} />)}
              </section>
            ))}
          </div>
        </div>
        {/* RIGHT — breadcrumb + selected-fixture workspace; scrolls with the page.
            Desktop only; mobile taps go straight to /matches/{slug}. */}
        <div className="hidden md:flex" style={{ flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {selected && (
            <>
              <PreviewBreadcrumb date={date} competition={selected.competition} seasonLabel={selected.competition.edition.seasonLabel} homeName={selected.f.homeTeam.name} awayName={selected.f.awayTeam.name} />
              <SelectedPreview f={selected.f} competitionName={selected.competition.name} seasonLabel={selected.competition.edition.seasonLabel} intel={intelById[selected.f.fixtureId]} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
