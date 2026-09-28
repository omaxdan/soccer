'use client';

// MATCH — client-interactive panels (faithful to the authoritative Match wireframe).
//
// The wireframe specifies in-place interactions the static server surfaces cannot give:
//   • Statistics — Full match / 1st half / 2nd half period switch
//   • Lineups    — starting XI grouped by position, collapsible substitutes, and a
//                  mobile team switcher (two panels on wider screens)
//   • Venue form — "This fixture" / "Reversed" switch
//   • Recent form — expand from the last 10 to the full list
//   • Match factors — factor rows that expand to their evidence sub-row
//
// Discipline unchanged from the SSR surfaces: NO football is computed. Numbers are the
// API's; the only arithmetic is presentation (a bar's share). Missing data is an honest
// "—" / "Not available", never a fabricated value, never a backend code or id.

import { useState } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { FormBadge } from '@/components/v2/ui';
import { buildMatchFactors, moduleStatusWord, type MatchFactor } from '@/lib/v2/matchIntelligence';
import { formResult, type FormResult } from '@/lib/v2/types';
import type {
  MatchDetailResponse, MatchTeamStatistics, PeriodStatistics, TeamStatLine,
  MatchLineups, TeamLineup, LineupPlayer, ApiFormFixture, ApiRecentFormRow, ApiTeamRecentVenueForm,
} from '@/lib/v2/types';

function orDash(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}
function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ═══ STATISTICS — period switch + grouped compare rows ═══════════════════════════════

const STAT_PERIODS: readonly { code: string; label: string }[] = [
  { code: 'ALL', label: 'Full match' },
  { code: '1ST', label: '1st half' },
  { code: '2ND', label: '2nd half' },
];
const STAT_GROUP_ORDER = ['Match overview', 'Shots', 'Attack', 'Passes', 'Duels', 'Defending', 'Goalkeeping'];

/** A two-sided compare row. The better side (per the observed compareCode: 1 home,
 *  2 away, 3 level) is brighter and bold; the bar shows share of the two-team total —
 *  never a verdict, never a computed "better". */
function StatCompareRow({ s }: { s: TeamStatLine }) {
  const h = num(s.home.value); const a = num(s.away.value);
  const homeBetter = s.compareCode === '1';
  const awayBetter = s.compareCode === '2';
  const total = h !== null && a !== null ? Math.abs(h) + Math.abs(a) : 0;
  const hp = h !== null && a !== null ? (total === 0 ? 50 : (Math.abs(h) / total) * 100) : 50;
  const sideStyle = (better: boolean): React.CSSProperties => ({
    color: better ? 'var(--text)' : 'var(--text-secondary)', fontWeight: better ? 700 : 500,
  });
  return (
    <div style={{ padding: '5px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'baseline' }}>
        <span className="mono tnum" style={{ textAlign: 'right', ...sideStyle(homeBetter) }}>{orDash(s.home.display ?? s.home.value)}</span>
        <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10, textAlign: 'center', minWidth: 130 }}>{s.statisticName ?? s.statisticKey}</span>
        <span className="mono tnum" style={{ textAlign: 'left', ...sideStyle(awayBetter) }}>{orDash(s.away.display ?? s.away.value)}</span>
      </div>
      {h !== null && a !== null && (
        <div aria-hidden style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--line)', marginTop: 3 }}>
          <div style={{ width: `${hp}%`, background: homeBetter ? 'var(--edge)' : 'color-mix(in srgb, var(--cool) 55%, transparent)' }} />
          <div style={{ width: `${100 - hp}%`, background: awayBetter ? 'var(--edge)' : 'color-mix(in srgb, var(--muted) 45%, transparent)' }} />
        </div>
      )}
    </div>
  );
}

function groupStats(period: PeriodStatistics): [string, TeamStatLine[]][] {
  const groups = new Map<string, TeamStatLine[]>();
  for (const s of period.statistics) {
    const g = groups.get(s.groupName) ?? [];
    g.push(s); groups.set(s.groupName, g);
  }
  return [...groups.keys()]
    .sort((x, y) => {
      const ix = STAT_GROUP_ORDER.indexOf(x); const iy = STAT_GROUP_ORDER.indexOf(y);
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    })
    .map((g) => [g, groups.get(g) ?? []] as [string, TeamStatLine[]]);
}

export function StatisticsTab({ stats, homeName, awayName }: {
  stats: MatchTeamStatistics; homeName: string; awayName: string;
}) {
  const available = STAT_PERIODS.filter((p) => stats.periods.some((sp) => sp.period === p.code));
  const [active, setActive] = useState(available[0]?.code ?? 'ALL');
  const period = stats.periods.find((p) => p.period === active) ?? null;
  const groups = period ? groupStats(period) : [];
  return (
    <section className="space-y-3" aria-label="match statistics">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p className="eyebrow">Statistics</p>
        <div role="tablist" aria-label="statistics period" style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {available.map((p) => {
            const on = p.code === active;
            return (
              <button key={p.code} role="tab" aria-selected={on} onClick={() => setActive(p.code)}
                className="label-cap" style={{
                  padding: '4px 10px', borderRadius: 4, cursor: 'pointer', background: on ? 'var(--raised)' : 'transparent',
                  color: on ? 'var(--text)' : 'var(--muted)', border: `1px solid ${on ? 'var(--line)' : 'transparent'}`,
                }}>{p.label}</button>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'baseline', padding: '0 4px' }}>
        <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontSize: 12 }}>{homeName}</span>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>vs</span>
        <span style={{ textAlign: 'left', fontWeight: 700, color: 'var(--text)', fontSize: 12 }}>{awayName}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {groups.map(([g, lines]) => (
          <div key={g} className="panel" style={{ padding: '4px 12px 10px' }}>
            <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10, padding: '8px 0 2px' }}>{g}</p>
            {lines.map((s) => <StatCompareRow key={s.statisticKey} s={s} />)}
          </div>
        ))}
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        The brighter, bolder side is the one the data provider marks ahead on that metric; bars show share of the two-team total.
      </p>
    </section>
  );
}

// ═══ LINEUPS — position groups, collapsible subs, mobile team switcher ════════════════

const POSITION_GROUP_ORDER = ['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD'];
const POSITION_GROUP_LABEL: Record<string, string> = {
  GOALKEEPER: 'Goalkeeper', DEFENDER: 'Defence', MIDFIELDER: 'Midfield', FORWARD: 'Attack',
};

function groupPlayers(players: readonly LineupPlayer[]): [string, LineupPlayer[]][] {
  const groups = new Map<string, LineupPlayer[]>();
  for (const p of players) {
    const g = (p.positionGroup ?? 'OTHER').toUpperCase();
    const list = groups.get(g) ?? [];
    list.push(p); groups.set(g, list);
  }
  return [...groups.keys()]
    .sort((x, y) => {
      const ix = POSITION_GROUP_ORDER.indexOf(x); const iy = POSITION_GROUP_ORDER.indexOf(y);
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    })
    .map((g) => [g, groups.get(g) ?? []] as [string, LineupPlayer[]]);
}

function PlayerRow({ p }: { p: LineupPlayer }) {
  return (
    <li style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12, alignItems: 'center' }}>
      <span className="mono tnum" style={{ color: 'var(--faint)', minWidth: 22, textAlign: 'right' }}>{orDash(p.shirtNumber)}</span>
      <Link href={routes.player(p.player)} style={{ color: 'var(--text)', textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.player.fullName}</Link>
      <span className="label-cap" style={{ color: 'var(--faint)', marginLeft: 'auto' }}>{orDash(p.positionName ?? p.positionCode)}</span>
    </li>
  );
}

function LineupPanel({ side }: { side: TeamLineup | null }) {
  if (!side) return <div className="panel" style={{ padding: 12 }}><p className="label-cap" style={{ color: 'var(--faint)' }}>No lineup reported.</p></div>;
  const groups = groupPlayers(side.starting);
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="label-cap" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{side.team.name}</p>
        {side.formation ? <span className="mono" style={{ color: 'var(--amber)', fontSize: 12 }}>{side.formation}</span> : null}
      </div>
      {groups.map(([g, players]) => (
        <div key={g} style={{ marginTop: 8 }}>
          <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 9 }}>{POSITION_GROUP_LABEL[g] ?? 'Other'}</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '2px 0 0' }}>{players.map((p) => <PlayerRow key={p.player.id} p={p} />)}</ul>
        </div>
      ))}
      {side.substitutes.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="label-cap" style={{ color: 'var(--cool)', cursor: 'pointer', fontSize: 10 }}>Substitutes · {side.substitutes.length}</summary>
          <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>{side.substitutes.map((p) => <PlayerRow key={p.player.id} p={p} />)}</ul>
        </details>
      )}
    </div>
  );
}

export function LineupsTab({ lineups }: { lineups: MatchLineups }) {
  const both = !lineups.home && !lineups.away;
  const [side, setSide] = useState<'home' | 'away'>('home');
  if (lineups.coverage.lineups === 'absent' || both) {
    return (
      <section className="space-y-2" aria-label="lineups">
        <p className="eyebrow">Lineups</p>
        <div className="panel" style={{ padding: 12 }}><p className="label-cap" style={{ color: 'var(--faint)' }}>No lineups reported for this fixture.</p></div>
      </section>
    );
  }
  return (
    <section className="space-y-2" aria-label="lineups">
      <p className="eyebrow">Lineups</p>
      {/* Mobile: team switcher (single panel). Wider: two panels side by side. */}
      <div className="md:hidden">
        <div role="tablist" aria-label="lineup team" style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['home', 'away'] as const).map((s) => {
            const on = s === side; const team = s === 'home' ? lineups.home : lineups.away;
            return (
              <button key={s} role="tab" aria-selected={on} onClick={() => setSide(s)}
                className="label-cap" style={{
                  flex: 1, padding: '10px', borderRadius: 4, cursor: 'pointer', minHeight: 44,
                  background: on ? 'var(--raised)' : 'transparent', color: on ? 'var(--text)' : 'var(--muted)',
                  border: `1px solid ${on ? 'var(--line)' : 'var(--line)'}`,
                }}>{team?.team.name ?? (s === 'home' ? 'Home' : 'Away')}</button>
            );
          })}
        </div>
        <LineupPanel side={side === 'home' ? lineups.home : lineups.away} />
      </div>
      <div className="hidden md:grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <LineupPanel side={lineups.home} />
        <LineupPanel side={lineups.away} />
      </div>
    </section>
  );
}

// ═══ RECENT FORM — last 10, expand to the full list ══════════════════════════════════

export function RecentFormPanel({ detail }: { detail: MatchDetailResponse }) {
  const [openAll, setOpenAll] = useState(false);
  const cap = openAll ? Infinity : 10;
  const Side = ({ name, fixtures }: { name: string; fixtures: ApiFormFixture[] }) => (
    <div>
      <p className="label-cap" style={{ color: 'var(--muted)', marginBottom: 4 }}>{name}</p>
      {fixtures.length === 0
        ? <p className="label-cap" style={{ color: 'var(--faint)' }}>No recent completed matches</p>
        : <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} role="list" aria-label={`${name} recent form`}>
            {fixtures.slice(0, cap).map((f) => <div key={f.fixtureId} role="listitem"><FormBadge fixture={f} /></div>)}
          </div>}
    </div>
  );
  const maxLen = Math.max(detail.form.home.length, detail.form.away.length);
  return (
    <section className="space-y-2" aria-label="recent form">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Recent form</p>
        {maxLen > 10 && (
          <button onClick={() => setOpenAll((v) => !v)} className="label-cap"
            style={{ marginLeft: 'auto', color: 'var(--cool)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10 }}>
            {openAll ? 'Show last 10' : `Show all ${maxLen}`}
          </button>
        )}
      </div>
      <div className="panel" style={{ padding: 12, display: 'grid', gap: 12 }}>
        <Side name={detail.match.homeTeam.name} fixtures={detail.form.home} />
        <Side name={detail.match.awayTeam.name} fixtures={detail.form.away} />
      </div>
    </section>
  );
}

// ═══ MATCH FACTORS — expandable rows with an evidence sub-row ═════════════════════════

function FactorRow({ f }: { f: MatchFactor }) {
  const r = f.reading;
  const sw = r ? moduleStatusWord(r.status) : { word: 'Not available', color: 'var(--faint)', engaged: false };
  const lowSample = !!r && !r.sampleMeetsThreshold;
  const evidenceItems = r?.evidence?.items ?? [];
  const hasEvidence = evidenceItems.length > 0;
  const Head = (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
      <span className="label-cap" style={{ color: sw.color, border: `1px solid ${sw.color}`, borderRadius: 4, padding: '0 6px', fontWeight: 700, fontSize: 9 }}>{sw.word}</span>
      <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{f.label}</span>
      {f.subject ? <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{f.subject}</span> : null}
      {lowSample && <span className="label-cap" style={{ marginLeft: 'auto', color: 'var(--warn)', fontSize: 9 }}>Low sample · {r!.sampleObservationCount} obs</span>}
    </div>
  );
  // Inactive / absent readings never surface the backend inactiveReason CODE — an
  // honest plain sentence instead (missing data is not a value).
  const body = (
    <>
      {r && sw.engaged && r.verdictText
        ? <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{r.verdictText}</p>
        : <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11, marginTop: 4 }}>No data recorded for this match.</p>}
    </>
  );
  if (!hasEvidence) {
    return <div className="panel" style={{ padding: 12 }}>{Head}{body}</div>;
  }
  return (
    <details className="panel" style={{ padding: 12 }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
        {Head}{body}
        <span className="label-cap" style={{ color: 'var(--cool)', fontSize: 9 }}>Evidence · {evidenceItems.length} ▸</span>
      </summary>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        {evidenceItems.map((it, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
            <span className="label-cap" style={{ color: 'var(--text-secondary)' }}>{it.displayName ?? it.featureKey ?? 'Input'}</span>
            <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 11 }}>{it.value === null ? '—' : it.value}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function MatchFactorList({ detail }: { detail: MatchDetailResponse }) {
  const factors = buildMatchFactors(detail);
  return (
    <section className="space-y-2" aria-label="match factors">
      <p className="eyebrow">Match factors</p>
      <div className="space-y-2">
        {factors.map((f) => <FactorRow key={f.key} f={f} />)}
      </div>
    </section>
  );
}

// ═══ VENUE FORM — "This fixture" / "Reversed" switch (rail) ═══════════════════════════

function venueRowResult(r: ApiRecentFormRow): FormResult {
  return formResult({ goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst });
}
const RESULT_COLOR: Record<'W' | 'D' | 'L', string> = { W: 'var(--edge)', D: 'var(--muted)', L: 'var(--risk)' };

function VenueFormList({ name, rows, side }: { name: string; rows: ApiRecentFormRow[]; side: string }) {
  return (
    <div>
      <p className="label-cap" style={{ color: 'var(--muted)' }}>{name} <span style={{ color: 'var(--faint)' }}>· {side}</span></p>
      {rows.length === 0 ? (
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11, marginTop: 4 }}>No recent matches recorded.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
          {rows.map((r) => {
            const res = venueRowResult(r);
            return (
              <li key={r.fixtureId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12 }}>
                <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, minWidth: 54 }}>{new Date(r.kickoffAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</span>
                <Link href={routes.team(r.opponent)} style={{ color: 'var(--text-secondary)', textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.opponent.name}</Link>
                <span className="mono tnum" style={{ color: 'var(--text)', marginLeft: 'auto' }}>{r.goalsFor ?? '—'}–{r.goalsAgainst ?? '—'}</span>
                {res && <span className="label-cap" style={{ color: RESULT_COLOR[res], fontWeight: 700, minWidth: 12 }}>{res}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function VenueFormRail({ homeName, awayName, home, away }: {
  homeName: string; awayName: string; home: ApiTeamRecentVenueForm; away: ApiTeamRecentVenueForm;
}) {
  const [reversed, setReversed] = useState(false);
  // Default ("this fixture"): home team at home, away team away. Reversed swaps the split.
  const homeRows = reversed ? home.lastAway : home.lastHome;
  const awayRows = reversed ? away.lastHome : away.lastAway;
  return (
    <section className="space-y-2" aria-label="venue form">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">Venue form</p>
        <button onClick={() => setReversed((v) => !v)} className="label-cap"
          style={{ marginLeft: 'auto', color: 'var(--cool)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 10 }}>
          {reversed ? 'Reversed' : 'This fixture'}
        </button>
      </div>
      <div className="panel" style={{ padding: 12, display: 'grid', gap: 12 }}>
        <VenueFormList name={homeName} rows={homeRows} side={reversed ? 'away' : 'home'} />
        <VenueFormList name={awayName} rows={awayRows} side={reversed ? 'home' : 'away'} />
      </div>
    </section>
  );
}
