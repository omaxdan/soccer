// COMPETITION / EDITION WORKSPACE — presentational components (read-only, SSR-safe).
//
// The Edition workspace chrome and its Overview / Table surfaces: the identity header
// (breadcrumb Country › Competition › Edition, country code block, competition name,
// edition switcher, meta cells) with the three-tab navigation, the governed standings
// table (observed snapshot — never client-computed), the Overview fixture strip, and
// the honest empty / unavailable states the design specifies. The interactive Fixtures
// tab (status filter + pagination) lives in ./editionFixtures ('use client').
//
// Every link is built through the centralized route helpers (namespace-neutral). No
// data fetching, no calculation, no fabrication, no betting language. Backend jargon
// (coverage / provider / snapshot / provenance) is never surfaced as product copy.

import Link from 'next/link';
import { routes, type V2EditionRef } from '@/lib/v2/routes';
import { Breadcrumb } from '@/components/v2/nav';
import {
  EDITION_TABS, editionTabHref, recentResults, nextScheduled, formatAsOf, fixtureShortDate,
  type EditionTab,
} from '@/lib/v2/competition';
import { statusPresentation, kickoffHHMM } from '@/lib/v2/fixtures';
import type { ApiEditionFixture, ApiEditionSummary, StandingTable } from '@/lib/v2/types';

// ── shared presentation helpers ────────────────────────────────────────────────────

/** Goal difference with an always-visible sign (+n / −n / 0) — never colour alone. */
function signedGd(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}
/** GD colour: positive edge, negative risk, level faint. The sign text carries the
 *  meaning regardless of colour. */
function gdColor(n: number): string {
  return n > 0 ? 'var(--edge)' : n < 0 ? 'var(--risk)' : 'var(--faint)';
}
/** Winner/loser weight for a team name, derived from the score of a COMPLETED fixture
 *  only. Missing/level/other statuses → neutral. */
function nameStyle(f: ApiEditionFixture, side: 'home' | 'away'): React.CSSProperties {
  const s = f.score;
  if (f.status !== 'COMPLETED' || !s || s.home === s.away) return { fontWeight: 500, color: 'var(--text)' };
  const win = side === 'home' ? s.home > s.away : s.away > s.home;
  return { fontWeight: win ? 600 : 500, color: win ? 'var(--text)' : 'var(--text-secondary)' };
}

/** A small status chip reusing the app-wide (Phase C) status grammar. Edition fixtures
 *  carry no result breakdown, so AET/PEN never apply here — status only. */
function StatusChip({ status, small = false }: { status: string; small?: boolean }) {
  const p = statusPresentation(status, null);
  return (
    <span className="mono" aria-label={p.word}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: small ? 9 : 10, letterSpacing: '.08em', textTransform: 'uppercase', color: p.color, whiteSpace: 'nowrap' }}>
      <span aria-hidden style={{ fontSize: 8, animation: p.live ? 'pulse-dot 1.8s ease-in-out infinite' : 'none' }}>{p.glyph}</span>{p.label}
    </span>
  );
}

// ── identity header ─────────────────────────────────────────────────────────────────

/** The country code block (BR / BRA). Rendered only when the country is known — never
 *  a fabricated flag or code. */
function CountryCode({ code, alpha3 }: { code: string; alpha3: string | null }) {
  return (
    <span aria-hidden className="panel" style={{ width: 48, height: 48, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
      <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{code}</span>
      {alpha3 && <span className="mono" style={{ fontSize: 8, letterSpacing: '.1em', color: 'var(--faint)' }}>{alpha3}</span>}
    </span>
  );
}

/** Edition (season) switcher. A single tracked edition renders a static label (no
 *  actionable menu); multiple tracked seasons render as selectable chips. Real seasons
 *  only — never a fabricated season. */
function EditionSwitcher({ editions, currentEditionId }: { editions: readonly ApiEditionSummary[]; currentEditionId: string }) {
  const current = editions.find((e) => e.id === currentEditionId);
  if (editions.length <= 1) {
    return (
      <span className="panel" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', fontSize: 13, color: 'var(--text-secondary)' }}>
        {current?.seasonLabel ?? ''}
      </span>
    );
  }
  return (
    <nav aria-label="season" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {editions.map((e) => {
        const active = e.id === currentEditionId;
        return (
          <Link key={e.id} href={routes.edition({ id: e.id, competition: { slug: e.competition.slug }, seasonLabel: e.seasonLabel })}
            aria-current={active ? 'true' : undefined}
            className="tnum" style={{
              padding: '5px 10px', borderRadius: 4, fontSize: 13, textDecoration: 'none',
              color: active ? 'var(--text)' : 'var(--text-secondary)',
              border: `1px solid ${active ? 'var(--amber)' : 'var(--line)'}`,
              background: active ? 'color-mix(in srgb, var(--amber) 10%, var(--panel))' : 'var(--panel)',
            }}>{e.seasonLabel}</Link>
        );
      })}
    </nav>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span>
      <span className="mono tnum" style={{ fontSize: 16, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

export function EditionTabNav({ edition, active }: { edition: string | V2EditionRef; active: EditionTab }) {
  return (
    <nav aria-label="workspace sections" className="no-scrollbar" style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
      {EDITION_TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link key={t.key} href={editionTabHref(edition, t.key)} aria-current={on ? 'page' : undefined}
            style={{
              flex: 'none', padding: '10px 0 12px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', textDecoration: 'none',
              color: on ? 'var(--text)' : 'var(--muted)',
              borderBottom: `2px solid ${on ? 'var(--amber)' : 'transparent'}`, marginBottom: -1,
            }}>{t.label}</Link>
        );
      })}
    </nav>
  );
}

export interface CompetitionHeaderProps {
  country: { code: string; name: string; alpha3Code: string | null } | null;
  competition: { id: string; name: string; slug: string };
  seasonLabel: string;
  editions: readonly ApiEditionSummary[];
  currentEditionId: string;
  editionRef: V2EditionRef;
  fixtureCount: number;
  asOf: string | null;         // standings snapshot date (YYYY-MM-DD) or null
  variantLabel: string | null; // e.g. 'Overall' or null when no table
  activeTab: EditionTab;
}

/** The global Edition workspace header: breadcrumb, identity (country code, name,
 *  season switcher), the always-visible meta cells, and the three-tab navigation. */
export function CompetitionHeader(props: CompetitionHeaderProps) {
  const { country, competition, seasonLabel, editions, currentEditionId, editionRef, fixtureCount, asOf, variantLabel, activeTab } = props;
  const crumbs = [
    { label: 'Competitions', href: routes.leagues() },
    ...(country ? [{ label: country.name, href: routes.country({ code: country.code }) }] : []),
    { label: competition.name, href: routes.competition(competition) },
    { label: seasonLabel },
  ];
  return (
    <header style={{ background: 'var(--ink)', borderBottom: '1px solid var(--line)' }}>
      <div className="mx-auto w-full max-w-6xl" style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Breadcrumb items={crumbs} />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
            {country && <CountryCode code={country.code} alpha3={country.alpha3Code} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <p className="eyebrow" style={{ margin: 0 }}>{country ? `${country.name} · Competition` : 'Competition'}</p>
              <h1 style={{ margin: 0, fontWeight: 600, fontSize: 'clamp(20px,3vw,28px)', lineHeight: 1.1, letterSpacing: '-.01em', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{competition.name}</h1>
              <EditionSwitcher editions={editions} currentEditionId={currentEditionId} />
            </div>
          </div>
          <div className="panel w-full sm:w-auto" style={{ display: 'flex', padding: 0 }}>
            <MetaCell label="Fixtures" value={String(fixtureCount)} />
            <div style={{ borderLeft: '1px solid var(--line)', display: 'flex', flex: 1 }}><MetaCell label="Table as of" value={asOf ? formatAsOf(asOf) : '—'} /></div>
            <div style={{ borderLeft: '1px solid var(--line)', display: 'flex', flex: 1 }}><MetaCell label="Table view" value={variantLabel ?? '—'} /></div>
          </div>
        </div>
        <EditionTabNav edition={editionRef} active={activeTab} />
      </div>
    </header>
  );
}

// ── standings (governed observed snapshot) ──────────────────────────────────────────

const VARIANT_LABEL: Record<string, string> = { TOTAL: 'Overall', HOME: 'Home', AWAY: 'Away' };
/** The product label for a standings variant code (TOTAL → Overall). Backend codes are
 *  never surfaced raw. */
export function standingsVariantLabel(variant: string): string {
  return VARIANT_LABEL[variant] ?? variant;
}

function VariantChip({ label }: { label: string }) {
  return (
    <span className="mono" style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text)', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 7px' }}>{label}</span>
  );
}

const TH: React.CSSProperties = { textAlign: 'right', padding: '0 8px', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400, height: 32, whiteSpace: 'nowrap' };
const TD: React.CSSProperties = { textAlign: 'right', padding: '0 8px', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const stickyBg = 'var(--panel)';

/**
 * The governed standings snapshot as a real semantic table. `mode='full'` shows all ten
 * columns (Pos · Team · P · W · D · L · GF · GA · GD · Pts); `mode='preview'` (Overview)
 * shows the top rows with the compact set (no GF/GA) and a "Full table →" link. Team
 * names link to the Team workspace. GD is signed (+/−/0) with a semantic colour that is
 * never the only signal. Nothing is computed here — rows are the backend read.
 * On narrow viewports the table scrolls horizontally inside its own panel (the page
 * never overflows); Pos and Team stay pinned.
 */
export function StandingsTable({ table, asOf, label, mode = 'full', previewCount = 5, editionRef }: {
  table: StandingTable;
  asOf: string;
  label: string;                 // variant label, e.g. 'Overall'
  mode?: 'full' | 'preview';
  previewCount?: number;
  editionRef?: V2EditionRef;     // required in preview mode for the "Full table →" link
}) {
  const preview = mode === 'preview';
  const rows = preview ? table.rows.slice(0, previewCount) : table.rows;
  const showGoals = !preview; // GF/GA only in the full table

  return (
    <section className="panel" aria-label="league table" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>{preview ? 'Table · top ' + previewCount : 'Standings'}</span>
          <VariantChip label={label} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>As of <span style={{ color: 'var(--text-secondary)' }}>{formatAsOf(asOf)}</span></span>
          {preview && editionRef && (
            <Link href={editionTabHref(editionRef, 'table')} style={{ fontSize: 12, fontWeight: 500, color: 'var(--amber)', textDecoration: 'none' }}>Full table →</Link>
          )}
        </div>
      </div>
      <div style={{ overflowX: 'auto', padding: '6px 8px 8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: showGoals ? 560 : 420 }}>
          <caption className="sr-only">{label} league table, as of {formatAsOf(asOf)}. Scroll sideways for all columns.</caption>
          <thead>
            <tr>
              <th scope="col" style={{ ...TH, textAlign: 'left', position: 'sticky', left: 0, background: stickyBg, zIndex: 2, width: 44 }}>Pos</th>
              <th scope="col" style={{ ...TH, textAlign: 'left', position: 'sticky', left: 44, background: stickyBg, zIndex: 2, minWidth: 132 }}>Team</th>
              <th scope="col" style={TH}>P</th>
              <th scope="col" style={TH}>W</th>
              <th scope="col" style={TH}>D</th>
              <th scope="col" style={TH}>L</th>
              {showGoals && <th scope="col" style={TH}>GF</th>}
              {showGoals && <th scope="col" style={TH}>GA</th>}
              <th scope="col" style={TH}>GD</th>
              <th scope="col" style={{ ...TH, color: 'var(--text)' }}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const zebra = i % 2 === 0 ? 'color-mix(in srgb, var(--raised) 30%, transparent)' : 'transparent';
              return (
                <tr key={r.team.id} style={{ background: zebra }}>
                  <td style={{ ...TD, textAlign: 'left', color: 'var(--muted)', position: 'sticky', left: 0, background: `linear-gradient(${zebra},${zebra}), ${stickyBg}` }}>{r.position}</td>
                  <th scope="row" style={{ ...TD, textAlign: 'left', fontWeight: 500, color: 'var(--text)', position: 'sticky', left: 44, background: `linear-gradient(${zebra},${zebra}), ${stickyBg}`, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Link href={routes.team(r.team)} style={{ color: 'inherit', textDecoration: 'none' }}>{r.team.name}</Link>
                  </th>
                  <td style={TD}>{r.played}</td>
                  <td style={TD}>{r.won}</td>
                  <td style={TD}>{r.drawn}</td>
                  <td style={TD}>{r.lost}</td>
                  {showGoals && <td style={TD}>{r.goalsFor}</td>}
                  {showGoals && <td style={TD}>{r.goalsAgainst}</td>}
                  <td style={{ ...TD, color: gdColor(r.goalDifference) }}>{signedGd(r.goalDifference)}</td>
                  <td style={{ ...TD, fontWeight: 600, color: 'var(--text)' }}>{r.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!preview && (
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>GD shown with sign: +n positive · −n negative · 0 level. Goal difference is a read-layer figure (GF − GA).</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>Observed standings snapshot — shown as published, not recalculated from results.</span>
        </div>
      )}
    </section>
  );
}

/** Standings genuinely empty: coverage present but zero tables. Neutral, no retry. */
export function StandingsEmpty({ seasonLabel }: { seasonLabel: string }) {
  return (
    <section className="panel" aria-label="league table" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Standings</span>
      <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>No table published yet</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 280 }}>{seasonLabel} has no standings snapshot so far.</span>
    </section>
  );
}

/** Standings could not be loaded (fetch error, or the edition is not standings-exposed).
 *  Honest — never a fabricated or client-computed table. */
export function StandingsUnavailable() {
  return (
    <section className="panel" role="alert" aria-label="league table" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--risk)' }}><span aria-hidden>■</span> Unavailable</span>
      <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>League table not available yet</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 320 }}>
        A published standings snapshot is not available for this edition. PitchTerminal shows the table only from a governed read — it never computes one on the fly.
      </span>
    </section>
  );
}

/** The neutral qualification/relegation note. The standings payload supplies no zone
 *  metadata, so no bands or colours are drawn — this is a future product configuration. */
export function QualificationZonesNote() {
  return (
    <div style={{ border: '1px dashed var(--line)', borderRadius: 4, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--warn)' }}>Future product configuration</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Qualification / relegation zones and legend are not supplied by the standings payload, so no bands are drawn.</span>
    </div>
  );
}

// ── rails (Edition facts + Data available) ──────────────────────────────────────────

export function EditionFactsRail({ facts }: { facts: readonly { k: string; v: string }[] }) {
  return (
    <section className="panel" aria-label="edition details" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Edition</span>
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
  );
}

export interface DataAvailabilityItem { k: string; v: string; present: boolean }
/** The "Data available" rail — a plain, user-facing availability list (Available /
 *  pending), derived from coverage but never showing raw backend coverage codes. */
export function DataAvailableRail({ items }: { items: readonly DataAvailabilityItem[] }) {
  return (
    <section className="panel" aria-label="data available" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Data available</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '2px 16px 8px' }}>
        {items.map((it) => (
          <li key={it.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{it.k}</span>
            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: it.present ? 'var(--edge)' : 'var(--faint)' }}>
              <span aria-hidden style={{ fontSize: 9 }}>{it.present ? '●' : '○'}</span>{it.v}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Overview fixture strip ──────────────────────────────────────────────────────────

function StripRow({ f, mode }: { f: ApiEditionFixture; mode: 'result' | 'scheduled' }) {
  return (
    <Link href={routes.match({ fixtureId: f.fixtureId, homeTeam: f.homeTeam, awayTeam: f.awayTeam })}
      className="hover:bg-raised"
      style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) 48px', gap: 10, alignItems: 'center', padding: '6px 8px', borderRadius: 4, textDecoration: 'none', color: 'inherit' }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{fixtureShortDate(f.kickoffAt)}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameStyle(f, 'home') }}>{f.homeTeam.name}</span>
        <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...nameStyle(f, 'away') }}>{f.awayTeam.name}</span>
      </span>
      {mode === 'result' && f.score ? (
        <span className="mono tnum" style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          <span>{f.score.home}</span><span>{f.score.away}</span>
        </span>
      ) : (
        <span className="mono tnum" style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>{kickoffHHMM(f.kickoffAt)}</span>
      )}
    </Link>
  );
}

/** Overview fixtures card: latest results (COMPLETED, newest first) beside next
 *  scheduled (SCHEDULED, soonest first), five each, with a link into the Fixtures tab.
 *  Honest empties per side; rows lead to the Match workspace. */
export function FixtureStrip({ fixtures, editionRef }: { fixtures: readonly ApiEditionFixture[]; editionRef: V2EditionRef }) {
  const latest = recentResults(fixtures, 5);
  const next = nextScheduled(fixtures, 5);
  return (
    <section className="panel" aria-label="fixtures" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Fixtures</span>
        <Link href={editionTabHref(editionRef, 'fixtures')} style={{ fontSize: 12, fontWeight: 500, color: 'var(--amber)', textDecoration: 'none' }}>All fixtures →</Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div style={{ padding: '10px 8px 8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px 6px' }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Latest results</span>
            <StatusChip status="COMPLETED" small />
          </div>
          {latest.length === 0
            ? <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11, padding: '4px 8px' }}>No completed matches yet.</p>
            : latest.map((f) => <StripRow key={f.fixtureId} f={f} mode="result" />)}
        </div>
        <div style={{ padding: '10px 8px 8px' }} className="border-t border-line sm:border-t-0 sm:border-l sm:border-line">
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px 6px' }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Next scheduled</span>
            <StatusChip status="SCHEDULED" small />
          </div>
          {next.length === 0
            ? <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11, padding: '4px 8px' }}>No scheduled fixtures.</p>
            : next.map((f) => <StripRow key={f.fixtureId} f={f} mode="scheduled" />)}
        </div>
      </div>
    </section>
  );
}
