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

import { useState } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import type { FixturesByDateResponse, CalendarFixture, CalendarCompetitionGroup } from '@/lib/v2/types';
import {
  type StripDay, statusPresentation, scorePresentation, kickoffHHMM, formatLongUtc,
} from '@/lib/v2/fixtures';

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

function ScoreCell({ f }: { f: CalendarFixture }) {
  const s = scorePresentation(f);
  const text = s.show ? `${s.home} – ${s.away}` : s.missing ? '—' : '–';
  return (
    <span className="mono tnum" style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '3px 8px', borderRadius: 4, background: 'var(--ink)', border: '1px solid var(--line)', fontSize: 14, fontWeight: 600, color: s.show ? 'var(--text)' : 'var(--faint)' }}>{text}</span>
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
        {/* desktop grid */}
        <span className="hidden md:grid" style={{ gridTemplateColumns: '64px minmax(0,1fr) 88px minmax(0,1fr) 132px 14px', gap: 14, alignItems: 'center', minHeight: 44, padding: '0 14px' }}>
          <time dateTime={f.kickoffAt} className="mono tnum" style={{ fontSize: 12, color: 'var(--muted)' }}>{time}</time>
          <span style={{ textAlign: 'right', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameWeight(f, 'home') }}>{f.homeTeam.name}</span>
          <ScoreCell f={f} />
          <span style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameWeight(f, 'away') }}>{f.awayTeam.name}</span>
          <span style={{ justifySelf: 'end' }}><StatusChip status={f.status} result={f.result} /></span>
          <span aria-hidden className="mono" style={{ fontSize: 13, color: 'var(--faint)', textAlign: 'right' }}>›</span>
        </span>
        {/* mobile stacked */}
        <span className="grid md:hidden" style={{ gridTemplateColumns: '68px minmax(0,1fr) 40px', gap: 10, alignItems: 'center', minHeight: 60, padding: '8px 12px' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <time dateTime={f.kickoffAt} className="mono tnum" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{time}</time>
            <StatusChip status={f.status} result={f.result} small />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameWeight(f, 'home') }}>{f.homeTeam.name}</span>
            <span style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameWeight(f, 'away') }}>{f.awayTeam.name}</span>
          </span>
          <span className="mono tnum" style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end', fontSize: 15, fontWeight: 600, color: s.show ? 'var(--text)' : 'var(--faint)' }}>
            <span>{s.show ? s.home : s.missing ? '—' : ''}</span><span>{s.show ? s.away : s.missing ? '—' : ''}</span>
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

/** The selected-fixture preview (desktop right column). Built from the calendar
 *  payload only — a preview that leads into the full Match workspace, never a
 *  second Match page. */
function SelectedPreview({ f, competitionName, seasonLabel }: { f: CalendarFixture; competitionName: string; seasonLabel: string }) {
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
    <aside aria-label="Selected fixture" className="panel md:sticky md:top-4" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p className="label-cap" style={{ color: 'var(--cool)', margin: 0 }}>{competitionName} · {seasonLabel}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
        <span style={{ textAlign: 'right', fontSize: 15, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.homeTeam.name}</span>
        <span className="mono tnum" style={{ fontSize: 22, fontWeight: 700, color: s.show ? 'var(--text)' : 'var(--faint)', whiteSpace: 'nowrap' }}>{s.show ? `${s.home} – ${s.away}` : s.missing ? '—' : '–'}</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.awayTeam.name}</span>
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

export function FixturesWorkspace({ date, prevDate, nextDate, today, strip, response, errored }: FixturesWorkspaceProps) {
  const groups = response?.countries ?? [];
  const flat: { f: CalendarFixture; competitionName: string; seasonLabel: string }[] = [];
  for (const country of groups) for (const comp of country.competitions) for (const f of comp.fixtures) flat.push({ f, competitionName: comp.name, seasonLabel: comp.edition.seasonLabel });
  const firstId = flat[0]?.f.fixtureId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const selected = flat.find((x) => x.f.fixtureId === selectedId) ?? flat[0] ?? null;
  const count = response?.fixtureCount ?? 0;
  const isToday = date === today;

  return (
    <main aria-busy={false} className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(16px,3vw,28px) 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* header + date navigation */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <p className="eyebrow" style={{ margin: 0 }}>Fixtures</p>
            <h1 style={{ margin: 0, fontWeight: 700, fontSize: 'clamp(22px,3vw,26px)', lineHeight: 1.15, letterSpacing: '-.01em', color: 'var(--text)' }}>{formatLongUtc(date)}</h1>
            <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', fontSize: 11, color: 'var(--faint)' }}>
              <span style={{ fontWeight: 600, color: count ? 'var(--text-secondary)' : 'var(--faint)' }}>{count} {count === 1 ? 'fixture' : 'fixtures'}</span>
              <span>·</span><span>Times in UTC</span>
              {isToday && <span style={{ fontWeight: 600, fontSize: 9, letterSpacing: '.1em', color: 'var(--amber)', background: 'var(--amber-dim)', borderRadius: 4, padding: '1px 6px' }}>TODAY</span>}
            </div>
          </div>
          <DateControls date={date} prevDate={prevDate} nextDate={nextDate} today={today} isToday={isToday} />
        </div>
        <DateStrip strip={strip} />
      </div>

      {/* body */}
      {errored ? (
        <div role="alert" className="panel" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <span aria-hidden style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--risk)', borderRadius: 4, font: "700 13px 'JetBrains Mono',monospace", color: 'var(--risk)' }}>!</span>
          <h2 style={{ margin: 0, font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>Unable to load fixtures for this date</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>The fixtures service could not be reached. Please try again.</p>
        </div>
      ) : flat.length === 0 ? (
        <div role="status" className="panel" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <span aria-hidden style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--line)', borderRadius: 4, font: "400 14px 'JetBrains Mono',monospace", color: 'var(--faint)' }}>○</span>
          <h2 className="label-cap" style={{ margin: 0, color: 'var(--muted)' }}>No fixtures</h2>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--text-secondary)' }}>There are no fixtures recorded for this date.</p>
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>Use ‹ › or the date strip to browse nearby days.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]" style={{ gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
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
          {/* right preview — desktop only; mobile taps go straight to /matches/{slug} */}
          <div className="hidden md:block">
            {selected && <SelectedPreview f={selected.f} competitionName={selected.competitionName} seasonLabel={selected.seasonLabel} />}
          </div>
        </div>
      )}
    </main>
  );
}
