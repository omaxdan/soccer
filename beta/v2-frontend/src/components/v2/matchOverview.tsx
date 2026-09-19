// MATCH OVERVIEW & fixture-centric surfaces (read-only, SSR).
//
// The intelligence-first Match page: a state-aware header, the Match Intelligence
// board (the Overview centrepiece), plain-language Key Signals derived ONLY from
// values the API already returned, and compact previews that link to the canonical
// deep tab rather than repeating it. Plus the full Statistics surface (period +
// grouped, neutral comparison bars) and an honest H2H empty state.
//
// Discipline: no football is COMPUTED here. Numbers are rendered as the API supplied
// them; the only arithmetic is presentation (a bar's share, a 2nd-half score as
// full − half-time from observed scores). Missing data is an honest "Not available"
// / "Not enough data" — never a fabricated value, never a backend code, never a
// prediction. Uses the existing design tokens (--panel/--edge/--risk/--cool/…) only.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { Kickoff, StatusChip, FormStrip, EmptyState } from '@/components/v2/ui';
import { matchTabHref } from '@/lib/v2/matchTabs';
import type {
  MatchDetailResponse, MatchTeamStatistics, MatchResult, MatchVenueInfo,
  TeamStatLine, ApiTeamFeatures, ApiFeatureValue, ApiModuleReading, PeriodStatistics,
} from '@/lib/v2/types';

// ── shared helpers ────────────────────────────────────────────────────────────────

function orDash(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}
/** Round only for display; never invent precision the value doesn't carry. */
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}
function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function statMap(period: PeriodStatistics): Map<string, TeamStatLine> {
  return new Map(period.statistics.map((s) => [s.statisticKey, s]));
}
function periodByCode(stats: MatchTeamStatistics, code: string): PeriodStatistics | null {
  return stats.periods.find((p) => p.period === code) ?? null;
}

function SectionTitle({ children, tag }: { children: React.ReactNode; tag?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <p className="eyebrow">{children}</p>
      {tag ? <span className="label-cap" style={{ color: 'var(--cool)', border: '1px solid var(--cool)', borderRadius: 4, padding: '0 5px', fontSize: 9 }}>{tag}</span> : null}
    </div>
  );
}
function DeeperLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="label-cap" style={{ color: 'var(--cool)', textDecoration: 'none', fontSize: 10 }}>{children} →</Link>;
}

/** A neutral two-sided magnitude bar. Deliberately ONE colour for both sides: a bigger
 *  number is not "better" (more fouls / more xG in a loss), so the bar shows share, not
 *  a verdict. Falls back to nothing when either side is non-numeric. */
function CompareBar({ home, away }: { home: number | null; away: number | null }) {
  if (home === null || away === null) return null;
  const total = Math.abs(home) + Math.abs(away);
  const hp = total === 0 ? 50 : (Math.abs(home) / total) * 100;
  return (
    <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--line)', marginTop: 3 }} aria-hidden>
      <div style={{ width: `${hp}%`, background: 'color-mix(in srgb, var(--cool) 65%, transparent)' }} />
      <div style={{ width: `${100 - hp}%`, background: 'color-mix(in srgb, var(--muted) 45%, transparent)' }} />
    </div>
  );
}

// ═══ STATE-AWARE MATCH HEADER (permanent across all tabs) ════════════════════════════

export function MatchHeader({ context, venue }: { context: MatchDetailResponse; venue: MatchVenueInfo | null }) {
  const { match } = context;
  const completed = match.status === 'COMPLETED';
  const score = match.score;
  const place = venue ? [venue.name, venue.city].filter(Boolean).join(' · ') : null;
  return (
    <header className={`panel${completed ? ' scanlines' : ''}`} style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Link href={routes.competition(match.competition)} className="eyebrow" style={{ color: 'var(--muted)', textDecoration: 'none' }}>{match.competition.name}</Link>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{match.edition.seasonLabel}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 14, alignItems: 'center', marginTop: 14 }}>
        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <Link href={routes.team(match.homeTeam)} style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)', textDecoration: 'none' }}>{match.homeTeam.name}</Link>
        </div>
        <div style={{ textAlign: 'center' }}>
          {completed && score
            ? <div className="mono tnum" style={{ fontSize: 34, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{score.home}<span style={{ color: 'var(--faint)', margin: '0 8px' }}>–</span>{score.away}</div>
            : <div className="label-cap" style={{ fontSize: 16, color: 'var(--faint)' }}>vs</div>}
          <div style={{ marginTop: 8 }}><StatusChip status={match.status} /></div>
        </div>
        <div style={{ textAlign: 'left', minWidth: 0 }}>
          <Link href={routes.team(match.awayTeam)} style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)', textDecoration: 'none' }}>{match.awayTeam.name}</Link>
        </div>
      </div>

      <p className="label-cap tnum" style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 12 }}>
        <Kickoff iso={match.kickoffAt} />
        {place ? <> · {venue ? <Link href={routes.venue(venue)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{place}</Link> : place}{venue?.countryCode ? <span style={{ color: 'var(--faint)' }}> · {venue.countryCode}</span> : null}</> : null}
      </p>
    </header>
  );
}

// ═══ MATCH INTELLIGENCE BOARD — the Overview centrepiece ═════════════════════════════
//
// Current signals side-by-side. Venue-relevant form (home team's home form, away team's
// away form), momentum, rest, congestion, plus home/away context and readiness status.
// Values are shown verbatim; an inactive/absent module reads "Not available"; a
// low-sample value is flagged "limited sample" — never hidden as if it were fabricated.

function splitLabel(reading: ApiModuleReading | null): { text: string; tone: 'ok' | 'faint' } {
  if (!reading || reading.status === 'INACTIVE') return { text: 'Not available', tone: 'faint' };
  const s = reading.status;
  const text = s === 'NEUTRAL' ? 'Neutral' : s.charAt(0) + s.slice(1).toLowerCase();
  return { text, tone: 'ok' };
}
function readinessLabel(reading: ApiModuleReading | null): { text: string; tone: 'ok' | 'faint' } {
  if (!reading || reading.status === 'INACTIVE') return { text: 'Not available', tone: 'faint' };
  return { text: reading.status.charAt(0) + reading.status.slice(1).toLowerCase(), tone: 'ok' };
}
function featureCell(v: ApiFeatureValue | null): { text: string; note: string | null } {
  if (!v) return { text: 'Not available', note: null };
  return { text: fmtNum(v.value), note: v.sampleMeetsThreshold ? `${v.sampleObservationCount} matches` : 'limited sample' };
}

function BoardRow({ label, home, away }: {
  label: string;
  home: { text: string; note?: string | null; tone?: 'ok' | 'faint' };
  away: { text: string; note?: string | null; tone?: 'ok' | 'faint' };
}) {
  const cell = (c: { text: string; note?: string | null; tone?: 'ok' | 'faint' }, align: 'right' | 'left') => (
    <div style={{ textAlign: align }}>
      <span className="mono tnum" style={{ fontSize: 15, fontWeight: 700, color: c.tone === 'faint' ? 'var(--faint)' : 'var(--text)' }}>{c.text}</span>
      {c.note ? <div className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{c.note}</div> : null}
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      {cell(home, 'right')}
      <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10, textAlign: 'center', minWidth: 92 }}>{label}</span>
      {cell(away, 'left')}
    </div>
  );
}

export function IntelligenceBoard({ detail }: { detail: MatchDetailResponse }) {
  const h = detail.teamFeatures.home;
  const a = detail.teamFeatures.away;
  const hi = detail.intelligence.home;
  const ai = detail.intelligence.away;
  const hSplit = splitLabel(hi.homeAwaySplit);
  const aSplit = splitLabel(ai.homeAwaySplit);
  const hForm = featureCell(h.homeForm); // home side → home form is the venue-relevant one
  const aForm = featureCell(a.awayForm); // away side → away form
  const hRest = featureCell(h.rest); const aRest = featureCell(a.rest);
  const hCong = featureCell(h.congestion); const aCong = featureCell(a.congestion);
  const hMom = featureCell(h.momentum); const aMom = featureCell(a.momentum);
  const hReady = readinessLabel(hi.readiness); const aReady = readinessLabel(ai.readiness);
  return (
    <section className="space-y-2">
      <SectionTitle tag="Match intelligence">Signals going into this match</SectionTitle>
      <div className="panel" style={{ padding: '4px 16px 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'baseline', paddingTop: 8 }}>
          <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{detail.match.homeTeam.name}</span>
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, minWidth: 92, textAlign: 'center' }}>signal</span>
          <span style={{ textAlign: 'left', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{detail.match.awayTeam.name}</span>
        </div>
        <BoardRow label="Home / away context" home={{ text: hSplit.text, tone: hSplit.tone }} away={{ text: aSplit.text, tone: aSplit.tone }} />
        <BoardRow label="Recent venue form" home={hForm} away={aForm} />
        <BoardRow label="Momentum" home={hMom} away={aMom} />
        <BoardRow label="Rest (days)" home={hRest} away={aRest} />
        <BoardRow label="Congestion" home={hCong} away={aCong} />
        <BoardRow label="Readiness" home={{ text: hReady.text, tone: hReady.tone }} away={{ text: aReady.text, tone: aReady.tone }} />
      </div>
    </section>
  );
}

// ═══ KEY SIGNALS — plain-language notes derived only from available values ════════════

function buildSignals(detail: MatchDetailResponse, stats: MatchTeamStatistics | null): string[] {
  const out: string[] = [];
  const home = detail.match.homeTeam.name;
  const away = detail.match.awayTeam.name;
  const h = detail.teamFeatures.home; const a = detail.teamFeatures.away;

  // Venue-relevant recent form comparison (home form vs away form), factual, not a forecast.
  if (h.homeForm && a.awayForm) {
    const diff = h.homeForm.value - a.awayForm.value;
    if (Math.abs(diff) >= 5) out.push(`${diff > 0 ? home : away} carry stronger recent ${diff > 0 ? 'home' : 'away'} form (${fmtNum(h.homeForm.value)} vs ${fmtNum(a.awayForm.value)}).`);
    else out.push(`Recent venue form is closely matched (${fmtNum(h.homeForm.value)} vs ${fmtNum(a.awayForm.value)}).`);
  }
  // Momentum tone.
  if (h.momentum && a.momentum) {
    if (h.momentum.value < 0 && a.momentum.value < 0) out.push('Both teams enter on negative recent momentum.');
    else if (h.momentum.value >= 0 && a.momentum.value >= 0) out.push('Both teams enter on positive recent momentum.');
    else out.push(`${h.momentum.value >= 0 ? home : away} hold the stronger recent momentum.`);
  }
  // Home/away split separation.
  const hs = detail.intelligence.home.homeAwaySplit; const as = detail.intelligence.away.homeAwaySplit;
  if (hs?.status === 'NEUTRAL' && as?.status === 'NEUTRAL') out.push('Home/away split shows no clear separation for either side.');
  // Readiness availability.
  const hr = detail.intelligence.home.readiness; const ar = detail.intelligence.away.readiness;
  if ((!hr || hr.status === 'INACTIVE') && (!ar || ar.status === 'INACTIVE')) out.push('Readiness data is not available for this fixture.');
  // Post-match evidence-vs-outcome (completed only): xG against the scoreline.
  if (stats && detail.match.status === 'COMPLETED' && detail.match.score) {
    const all = periodByCode(stats, 'ALL');
    const xg = all ? statMap(all).get('expectedGoals') : undefined;
    const xh = xg ? num(xg.home.value) : null; const xa = xg ? num(xg.away.value) : null;
    if (xh !== null && xa !== null) {
      const winner = detail.match.score.home > detail.match.score.away ? home : detail.match.score.home < detail.match.score.away ? away : null;
      const xgLeader = xh > xa ? home : xh < xa ? away : null;
      if (winner && xgLeader && winner !== xgLeader) out.push(`${xgLeader} recorded the higher expected goals (${home} ${fmtNum(xh)}, ${away} ${fmtNum(xa)}) but did not win — the result ran against the chance quality.`);
      else out.push(`Expected goals: ${home} ${fmtNum(xh)}, ${away} ${fmtNum(xa)}.`);
    }
  }
  return out;
}

export function KeySignals({ detail, stats }: { detail: MatchDetailResponse; stats: MatchTeamStatistics | null }) {
  const signals = buildSignals(detail, stats);
  return (
    <section className="space-y-2">
      <SectionTitle tag="Key signals">What stands out</SectionTitle>
      {signals.length === 0 ? (
        <EmptyState message="Not enough data to summarise signals for this fixture yet." />
      ) : (
        <div className="panel" style={{ padding: 14 }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {signals.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--cool)', lineHeight: 1.3 }}>›</span><span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ═══ MATCH RESULT (completed) / MATCH STATUS (scheduled) — compact ═══════════════════

export function MatchStatePanel({ detail, result }: { detail: MatchDetailResponse; result: MatchResult | null }) {
  const { match } = detail;
  if (match.status === 'COMPLETED' && result) {
    return (
      <section className="space-y-2">
        <SectionTitle>Match result</SectionTitle>
        <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '6px 12px', alignItems: 'baseline' }}>
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Half time</span>
          <span />
          <span className="mono tnum" style={{ color: 'var(--text)', textAlign: 'right' }}>{result.halfTime ? `${result.halfTime.home} – ${result.halfTime.away}` : '—'}</span>
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Full time</span>
          <span />
          <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, textAlign: 'right' }}>{result.final.home} – {result.final.away}</span>
          {result.extraTime ? <><span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Extra time</span><span /><span className="mono tnum" style={{ color: 'var(--text)', textAlign: 'right' }}>{result.extraTime.home} – {result.extraTime.away}</span></> : null}
          {result.penalties ? <><span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Penalties</span><span /><span className="mono tnum" style={{ color: 'var(--text)', textAlign: 'right' }}>{result.penalties.home} – {result.penalties.away}</span></> : null}
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <SectionTitle>Match status</SectionTitle>
      <div className="panel" style={{ padding: 12 }}>
        <StatusChip status={match.status} />
        <p className="label-cap tnum" style={{ color: 'var(--muted)', marginTop: 8 }}><Kickoff iso={match.kickoffAt} /></p>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 4 }}>Match statistics will appear once the fixture has been played.</p>
      </div>
    </section>
  );
}

// ═══ KEY MATCH EVIDENCE (completed, Overview summary) ════════════════════════════════

const EVIDENCE_KEYS: readonly { key: string; label: string }[] = [
  { key: 'ballPossession', label: 'Possession' },
  { key: 'expectedGoals', label: 'Expected goals (xG)' },
  { key: 'totalShotsOnGoal', label: 'Shots' },
  { key: 'shotsOnGoal', label: 'Shots on target' },
  { key: 'bigChanceCreated', label: 'Big chances' },
  { key: 'passes', label: 'Passes' },
];

function EvidenceRow({ line, label }: { line: TeamStatLine | undefined; label: string }) {
  const h = line ? (line.home.display ?? line.home.value) : null;
  const a = line ? (line.away.display ?? line.away.value) : null;
  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'baseline' }}>
        <span className="mono tnum" style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 600 }}>{orDash(h)}</span>
        <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10, textAlign: 'center', minWidth: 120 }}>{label}</span>
        <span className="mono tnum" style={{ textAlign: 'left', color: 'var(--text)', fontWeight: 600 }}>{orDash(a)}</span>
      </div>
      <CompareBar home={line ? num(line.home.value) : null} away={line ? num(line.away.value) : null} />
    </div>
  );
}

export function KeyMatchEvidence({ stats, slug }: { stats: MatchTeamStatistics; slug: string }) {
  const all = periodByCode(stats, 'ALL');
  if (!all) return null;
  const map = statMap(all);
  return (
    <section className="space-y-2">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <SectionTitle tag="Observed">Key match evidence</SectionTitle>
        <DeeperLink href={matchTabHref(slug, 'statistics')}>View full statistics</DeeperLink>
      </div>
      <div className="panel" style={{ padding: '6px 16px 12px' }}>
        {EVIDENCE_KEYS.map((e) => <EvidenceRow key={e.key} line={map.get(e.key)} label={e.label} />)}
      </div>
    </section>
  );
}

// ═══ MATCH PROGRESSION (1st / 2nd half) ══════════════════════════════════════════════

const PROGRESSION_KEYS: readonly { key: string; label: string }[] = [
  { key: 'ballPossession', label: 'Possession' },
  { key: 'expectedGoals', label: 'xG' },
  { key: 'totalShotsOnGoal', label: 'Shots' },
];

function halfCell(period: PeriodStatistics | null, key: string): string {
  if (!period) return '—';
  const s = statMap(period).get(key);
  if (!s) return '—';
  return `${orDash(s.home.display ?? s.home.value)} – ${orDash(s.away.display ?? s.away.value)}`;
}

export function MatchProgression({ stats, result }: { stats: MatchTeamStatistics; result: MatchResult | null }) {
  const first = periodByCode(stats, '1ST');
  const second = periodByCode(stats, '2ND');
  if (!first && !second) return null;
  // Observed scores: half-time is reported; the 2nd-half score is full − half-time.
  const ht = result?.halfTime ?? null;
  const ft = result?.final ?? null;
  const firstScore = ht ? `${ht.home} – ${ht.away}` : '—';
  const secondScore = ht && ft ? `${ft.home - ht.home} – ${ft.away - ht.away}` : '—';
  return (
    <section className="space-y-2">
      <SectionTitle tag="Observed">Match progression</SectionTitle>
      <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
        <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead><tr>
            <th style={{ textAlign: 'left', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' }} />
            <th style={{ textAlign: 'center', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' }}>1st half</th>
            <th style={{ textAlign: 'center', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' }}>2nd half</th>
          </tr></thead>
          <tbody>
            <tr>
              <td className="label-cap" style={{ color: 'var(--muted)', padding: '4px 6px' }}>Score</td>
              <td className="mono" style={{ textAlign: 'center', padding: '4px 6px', color: 'var(--text)', fontWeight: 700 }}>{firstScore}</td>
              <td className="mono" style={{ textAlign: 'center', padding: '4px 6px', color: 'var(--text)', fontWeight: 700 }}>{secondScore}</td>
            </tr>
            {PROGRESSION_KEYS.map((k) => (
              <tr key={k.key}>
                <td className="label-cap" style={{ color: 'var(--muted)', padding: '4px 6px' }}>{k.label}</td>
                <td className="mono" style={{ textAlign: 'center', padding: '4px 6px', color: 'var(--text-secondary)' }}>{halfCell(first, k.key)}</td>
                <td className="mono" style={{ textAlign: 'center', padding: '4px 6px', color: 'var(--text-secondary)' }}>{halfCell(second, k.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ═══ COMPACT PREVIEWS (Overview → link to canonical tab) ═════════════════════════════

export function CompactForm({ detail, slug }: { detail: MatchDetailResponse; slug: string }) {
  return (
    <section className="space-y-2">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <SectionTitle>Recent form</SectionTitle>
        <DeeperLink href={matchTabHref(slug, 'form')}>View full form</DeeperLink>
      </div>
      <div className="panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
        <div>
          <p className="label-cap" style={{ color: 'var(--muted)', marginBottom: 4 }}>{detail.match.homeTeam.name}</p>
          <FormStrip fixtures={detail.form.home.slice(0, 5)} />
        </div>
        <div>
          <p className="label-cap" style={{ color: 'var(--muted)', marginBottom: 4 }}>{detail.match.awayTeam.name}</p>
          <FormStrip fixtures={detail.form.away.slice(0, 5)} />
        </div>
      </div>
    </section>
  );
}

export function CompactVenue({ venue, slug }: { venue: MatchVenueInfo | null; slug: string }) {
  return (
    <section className="space-y-2">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <SectionTitle>Venue</SectionTitle>
        <DeeperLink href={matchTabHref(slug, 'venue')}>View venue</DeeperLink>
      </div>
      {!venue ? <EmptyState message="No venue recorded for this fixture." /> : (
        <div className="panel" style={{ padding: 12 }}>
          <p style={{ color: 'var(--text)', fontWeight: 600 }}><Link href={routes.venue(venue)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{venue.name}</Link></p>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 2 }}>
            {[venue.city, venue.countryCode].filter(Boolean).join(', ') || '—'}{venue.capacity ? <span className="tnum"> · capacity {venue.capacity.toLocaleString()}</span> : null}
          </p>
        </div>
      )}
    </section>
  );
}

// ═══ AVAILABLE DATA FOOTER (Overview, quiet) ═════════════════════════════════════════

export function AvailabilityFooter({ flags }: { flags: readonly (readonly [string, 'present' | 'absent' | 'partial' | 'not-supported'])[] }) {
  const present = flags.filter(([, s]) => s === 'present').map(([l]) => l);
  if (present.length === 0) return null;
  return (
    <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
      Available data: {present.join(' · ')}
    </p>
  );
}

// ═══ H2H — honest empty state (no head-to-head substrate is provided yet) ═════════════

export function HeadToHeadUnavailable() {
  return (
    <section className="space-y-2">
      <SectionTitle>Head to head</SectionTitle>
      <EmptyState message="Head-to-head history is not available for this fixture yet." />
    </section>
  );
}

// ═══ LINEUPS — honest empty state when the lineups read is unavailable ════════════════
//
// Page-level fallback for when the lineups sub-resource returns nothing at all (vs
// MatchLineupsPanel's own absent/partial coverage states). "Not available yet" — it does
// NOT claim players are unavailable, nor that lineups permanently do not exist.

export function LineupsUnavailable() {
  return (
    <section className="space-y-2">
      <SectionTitle>Lineups</SectionTitle>
      <EmptyState message="Lineup information is not available for this fixture yet." />
    </section>
  );
}

// ═══ STATISTICS (canonical) — period + grouped, neutral comparison bars ═══════════════

const GROUP_ORDER = ['Match overview', 'Shots', 'Attack', 'Passes', 'Defending', 'Duels', 'Goalkeeping'];

function StatLineRow({ s }: { s: TeamStatLine }) {
  return (
    <div style={{ padding: '5px 0', borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'baseline' }}>
        <span className="mono tnum" style={{ textAlign: 'right', color: 'var(--text)' }}>{orDash(s.home.display ?? s.home.value)}</span>
        <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10, textAlign: 'center', minWidth: 130 }}>{s.statisticName ?? s.statisticKey}</span>
        <span className="mono tnum" style={{ textAlign: 'left', color: 'var(--text)' }}>{orDash(s.away.display ?? s.away.value)}</span>
      </div>
      <CompareBar home={num(s.home.value)} away={num(s.away.value)} />
    </div>
  );
}

function PeriodBlock({ period, homeName, awayName, open }: { period: PeriodStatistics; homeName: string; awayName: string; open: boolean }) {
  const groups = new Map<string, TeamStatLine[]>();
  for (const s of period.statistics) {
    const g = groups.get(s.groupName) ?? [];
    g.push(s); groups.set(s.groupName, g);
  }
  const ordered = [...groups.keys()].sort((x, y) => {
    const ix = GROUP_ORDER.indexOf(x); const iy = GROUP_ORDER.indexOf(y);
    return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
  });
  const periodLabel = period.period === 'ALL' ? 'Full match' : period.period === '1ST' ? 'First half' : period.period === '2ND' ? 'Second half' : period.period;
  const body = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 8 }}>
      {ordered.map((g) => (
        <div key={g} className="panel" style={{ padding: '4px 12px 10px' }}>
          <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10, padding: '8px 0 2px' }}>{g}</p>
          {(groups.get(g) ?? []).map((s) => <StatLineRow key={s.statisticKey} s={s} />)}
        </div>
      ))}
    </div>
  );
  if (open) {
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'baseline', padding: '4px 4px 0' }}>
          <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontSize: 12 }}>{homeName}</span>
          <span className="eyebrow">{periodLabel}</span>
          <span style={{ textAlign: 'left', fontWeight: 700, color: 'var(--text)', fontSize: 12 }}>{awayName}</span>
        </div>
        {body}
      </div>
    );
  }
  return (
    <details className="panel" style={{ padding: 12 }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
        <span className="eyebrow">{periodLabel}</span>
        <span className="label-cap" style={{ color: 'var(--cool)', fontSize: 9, marginLeft: 8 }}>toggle →</span>
      </summary>
      {body}
    </details>
  );
}

export function MatchStatisticsFull({ stats, homeName, awayName }: { stats: MatchTeamStatistics; homeName: string; awayName: string }) {
  const { periods, coverage } = stats;
  if (coverage.teamStatistics === 'absent' || periods.length === 0) {
    return (
      <section className="space-y-2">
        <SectionTitle tag="Observed">Match statistics</SectionTitle>
        <EmptyState message="No team statistics recorded for this fixture." />
      </section>
    );
  }
  const all = periodByCode(stats, 'ALL');
  const halves = periods.filter((p) => p.period !== 'ALL');
  return (
    <section className="space-y-3">
      <SectionTitle tag="Observed">Match statistics</SectionTitle>
      {all ? <PeriodBlock period={all} homeName={homeName} awayName={awayName} open /> : null}
      {halves.map((p) => <PeriodBlock key={p.period} period={p} homeName={homeName} awayName={awayName} open={false} />)}
      {coverage.provider ? <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Larger bars show share of the two-team total, not which side performed better.</p> : null}
    </section>
  );
}
